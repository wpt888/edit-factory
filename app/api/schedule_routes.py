"""
Schedule Routes - Smart Schedule Publishing

Endpoints for previewing, creating, monitoring and managing
scheduled post plans that distribute clips across days.
"""

import logging
import threading
import uuid
import asyncio
from datetime import date, time, datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.schedule_service import build_schedule_plan, execute_schedule_plan

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/schedule", tags=["Smart Schedule"])

# --- In-memory progress tracking ---
_schedule_progress: Dict[str, dict] = {}
_schedule_progress_lock = threading.Lock()
_MAX_PROGRESS_ENTRIES = 200


def _evict_old_progress():
    if len(_schedule_progress) > _MAX_PROGRESS_ENTRIES:
        sorted_keys = sorted(
            _schedule_progress.keys(),
            key=lambda k: _schedule_progress[k].get("updated_at", ""),
        )
        for key in sorted_keys[:len(sorted_keys) - _MAX_PROGRESS_ENTRIES]:
            del _schedule_progress[key]


def _update_progress(job_id: str, percentage: int, step: str, status: str = "running",
                     items_done: int = 0, items_total: int = 0):
    with _schedule_progress_lock:
        _schedule_progress[job_id] = {
            "percentage": percentage,
            "step": step,
            "status": status,
            "items_done": items_done,
            "items_total": items_total,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        _evict_old_progress()


# --- Pydantic Models ---

class SchedulePreviewRequest(BaseModel):
    collection_ids: List[str]
    start_date: str  # ISO date string YYYY-MM-DD
    post_time: str = "09:00"  # HH:MM
    timezone: str = "Europe/Bucharest"


class ScheduleAssignmentResponse(BaseModel):
    clip_id: str
    project_id: str
    project_name: str
    clip_name: str
    scheduled_date: str
    scheduled_at: str
    thumbnail_path: Optional[str] = None
    duration: Optional[float] = None


class SchedulePreviewResponse(BaseModel):
    days_used: int
    clips_per_day: Dict[str, int]
    total_clips: int
    collections_count: int
    assignments: List[ScheduleAssignmentResponse]
    excluded_collections: List[dict] = []


class CreateSchedulePlanRequest(BaseModel):
    collection_ids: List[str]
    start_date: str
    post_time: str = "09:00"
    timezone: str = "Europe/Bucharest"
    integration_ids: List[str]
    caption_template: str = ""
    name: str = ""


class SchedulePlanResponse(BaseModel):
    plan_id: str
    job_id: str
    status: str
    message: str


class ScheduleProgressResponse(BaseModel):
    percentage: int
    step: str
    status: str
    items_done: int
    items_total: int


# --- Helper: fetch collection clips from DB ---

def _fetch_collection_clips(collection_ids: List[str], profile_id: str):
    """
    Fetch rendered clips grouped by project, with ownership verification.
    Returns (collection_clips, collection_names) tuple.
    """
    repo = get_repository()

    # Verify all projects belong to this profile
    projects_resp = repo.table_query("editai_projects", "select",
        filters=QueryFilters(
            select="id, name",
            in_={"id": collection_ids},
            eq={"profile_id": profile_id},
        ))

    if not projects_resp.data:
        raise HTTPException(status_code=404, detail="No projects found or access denied")

    valid_project_ids = [p["id"] for p in projects_resp.data]
    collection_names = {p["id"]: p["name"] for p in projects_resp.data}

    # Check for requested but not found/not owned projects
    missing = set(collection_ids) - set(valid_project_ids)
    if missing:
        logger.warning(f"Projects not found or not owned: {missing}")

    # Fetch rendered clips for all valid projects
    clips_resp = repo.table_query("editai_clips", "select",
        filters=QueryFilters(
            select="id, project_id, variant_index, variant_name, thumbnail_path, duration, final_video_path, final_status, postiz_status, is_deleted",
            in_={"project_id": valid_project_ids},
            eq={"final_status": "completed"},
            or_="is_deleted.is.null,is_deleted.eq.false",
            order_by="variant_index",
        ))

    clips = clips_resp.data if clips_resp.data else []

    # Group by project
    collection_clips: Dict[str, List[dict]] = {pid: [] for pid in valid_project_ids}
    for clip in clips:
        pid = clip["project_id"]
        if pid in collection_clips:
            collection_clips[pid].append(clip)

    return collection_clips, collection_names


# --- Endpoints ---

@router.post("/preview", response_model=SchedulePreviewResponse)
async def preview_schedule(
    request: SchedulePreviewRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Preview the schedule distribution without creating anything."""
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="No collections selected")

    try:
        start_dt = date.fromisoformat(request.start_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")

    try:
        parts = request.post_time.split(":")
        post_tm = time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid post_time format. Use HH:MM")

    collection_clips, collection_names = _fetch_collection_clips(
        request.collection_ids, profile.profile_id
    )

    try:
        plan = build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=start_dt,
            post_time=post_tm,
            user_timezone=request.timezone,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return SchedulePreviewResponse(
        days_used=plan.days_used,
        clips_per_day=plan.clips_per_day,
        total_clips=plan.total_clips,
        collections_count=plan.collections_count,
        assignments=[
            ScheduleAssignmentResponse(
                clip_id=a.clip_id,
                project_id=a.project_id,
                project_name=a.project_name,
                clip_name=a.clip_name,
                scheduled_date=a.scheduled_date.isoformat(),
                scheduled_at=a.scheduled_at.isoformat(),
                thumbnail_path=a.thumbnail_path,
                duration=a.duration,
            )
            for a in plan.assignments
        ],
        excluded_collections=plan.excluded_collections,
    )


@router.post("/plans", response_model=SchedulePlanResponse)
async def create_schedule_plan(
    request: CreateSchedulePlanRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Create and execute a schedule plan."""
    if not request.collection_ids:
        raise HTTPException(status_code=400, detail="No collections selected")
    if not request.integration_ids:
        raise HTTPException(status_code=400, detail="No integrations selected")

    try:
        start_dt = date.fromisoformat(request.start_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid start_date format")

    try:
        parts = request.post_time.split(":")
        post_tm = time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="Invalid post_time format")

    # Build the plan (re-computed server-side, not trusting client)
    collection_clips, collection_names = _fetch_collection_clips(
        request.collection_ids, profile.profile_id
    )

    try:
        plan = build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=start_dt,
            post_time=post_tm,
            user_timezone=request.timezone,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Generate IDs
    plan_id = str(uuid.uuid4())
    job_id = uuid.uuid4().hex[:12]
    plan_name = request.name or f"Schedule {start_dt.isoformat()}"

    repo = get_repository()

    # Insert plan record
    repo.create_schedule_plan({
        "id": plan_id,
        "profile_id": profile.profile_id,
        "name": plan_name,
        "status": "pending",
        "integration_ids": request.integration_ids,
        "start_date": start_dt.isoformat(),
        "post_time": request.post_time,
        "timezone": request.timezone,
        "collection_ids": request.collection_ids,
        "caption_template": request.caption_template,
        "total_clips": plan.total_clips,
        "scheduled_count": 0,
        "failed_count": 0,
        "summary": {
            "days_used": plan.days_used,
            "clips_per_day": plan.clips_per_day,
            "collections_count": plan.collections_count,
        },
    })

    # Insert schedule items
    items_to_insert = []
    for a in plan.assignments:
        items_to_insert.append({
            "plan_id": plan_id,
            "clip_id": a.clip_id,
            "project_id": a.project_id,
            "scheduled_date": a.scheduled_date.isoformat(),
            "scheduled_at": a.scheduled_at.isoformat(),
            "status": "pending",
        })

    if items_to_insert:
        # Insert in batches of 50
        for i in range(0, len(items_to_insert), 50):
            batch = items_to_insert[i:i+50]
            repo.table_query("editai_schedule_items", "insert", data=batch)

    # Launch background task
    _update_progress(job_id, 0, "Initializing schedule...", "running", 0, plan.total_clips)
    with _schedule_progress_lock:
        _schedule_progress[job_id]["plan_id"] = plan_id
        _schedule_progress[job_id]["profile_id"] = profile.profile_id

    background_tasks.add_task(
        _execute_schedule_plan_task,
        plan_id=plan_id,
        profile_id=profile.profile_id,
        caption_template=request.caption_template,
        integration_ids=request.integration_ids,
        job_id=job_id,
    )

    return SchedulePlanResponse(
        plan_id=plan_id,
        job_id=job_id,
        status="processing",
        message=f"Schedule plan created with {plan.total_clips} clips across {plan.days_used} days",
    )


@router.get("/plans")
async def list_schedule_plans(
    status: Optional[str] = None,
    limit: int = 20,
    profile: ProfileContext = Depends(get_profile_context),
):
    """List all schedule plans for the current profile."""
    repo = get_repository()

    eq_filters = {"profile_id": profile.profile_id}
    if status:
        eq_filters["status"] = status

    result = repo.table_query("editai_schedule_plans", "select",
        filters=QueryFilters(
            eq=eq_filters,
            order_by="created_at",
            order_desc=True,
            limit=limit,
        ))

    return {"plans": result.data or []}


@router.get("/plans/{plan_id}")
async def get_schedule_plan(
    plan_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get a schedule plan with all its items."""
    repo = get_repository()

    # Fetch plan with ownership check
    plan_resp = repo.table_query("editai_schedule_plans", "select",
        filters=QueryFilters(
            eq={"id": plan_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not plan_resp.data:
        raise HTTPException(status_code=404, detail="Plan not found")

    plan = plan_resp.data[0]

    # Fetch items with clip info
    items_resp = repo.table_query("editai_schedule_items", "select",
        filters=QueryFilters(
            select="*, editai_clips(variant_name, thumbnail_path, duration, final_video_path)",
            eq={"plan_id": plan_id},
            order_by="scheduled_date",
        ))

    plan["items"] = items_resp.data or []
    return plan


@router.get("/plans/{plan_id}/progress", response_model=ScheduleProgressResponse)
async def get_schedule_progress(
    plan_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get execution progress for a schedule plan."""
    # Try in-memory progress first (keyed by job_id, but we also check plan_id + profile ownership)
    with _schedule_progress_lock:
        for job_id, progress in _schedule_progress.items():
            if progress.get("plan_id") == plan_id and progress.get("profile_id") == profile.profile_id:
                return ScheduleProgressResponse(**{
                    k: progress[k] for k in ["percentage", "step", "status", "items_done", "items_total"]
                })

    # Fallback: check DB for plan status
    repo = get_repository()
    plan_resp = repo.table_query("editai_schedule_plans", "select",
        filters=QueryFilters(
            select="status, scheduled_count, failed_count, total_clips",
            eq={"id": plan_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not plan_resp.data:
        raise HTTPException(status_code=404, detail="Plan not found")

    plan = plan_resp.data[0]
    done = (plan.get("scheduled_count", 0) or 0) + (plan.get("failed_count", 0) or 0)
    total = plan.get("total_clips", 0) or 1

    return ScheduleProgressResponse(
        percentage=min(100, int(done / total * 100)),
        step=f"Completed: {plan['status']}",
        status="completed" if plan["status"] in ("completed", "completed_with_errors", "failed", "cancelled") else "running",
        items_done=done,
        items_total=total,
    )


@router.delete("/plans/{plan_id}")
async def cancel_schedule_plan(
    plan_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Cancel a schedule plan (does not cancel already-sent Postiz posts)."""
    repo = get_repository()

    # Verify ownership
    plan_resp = repo.table_query("editai_schedule_plans", "select",
        filters=QueryFilters(
            select="id, status",
            eq={"id": plan_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not plan_resp.data:
        raise HTTPException(status_code=404, detail="Plan not found")

    current_status = plan_resp.data[0]["status"]
    if current_status in ("completed", "completed_with_errors", "failed"):
        raise HTTPException(status_code=400, detail=f"Cannot cancel plan with status: {current_status}")

    repo.update_schedule_plan(plan_id, {
        "status": "cancelled",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    return {"status": "cancelled", "message": "Plan cancelled. Already-scheduled posts on Postiz are not affected."}


@router.get("/calendar")
async def get_schedule_calendar(
    start_date: str,  # YYYY-MM-DD query param
    end_date: str,    # YYYY-MM-DD query param
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get combined calendar view: Postiz posts + local schedule items."""
    from app.services.postiz_service import get_postiz_publisher, is_postiz_configured

    try:
        start_dt = date.fromisoformat(start_date)
        end_dt = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    repo = get_repository()
    result = {"postiz_posts": [], "schedule_items": [], "days": {}}

    # 1. Fetch from Postiz API (if configured)
    try:
        if is_postiz_configured(profile.profile_id):
            publisher = get_postiz_publisher(profile.profile_id)
            start_utc = datetime.combine(start_dt, time(0, 0), tzinfo=timezone.utc)
            end_utc = datetime.combine(end_dt, time(23, 59, 59), tzinfo=timezone.utc)
            postiz_posts = await publisher.get_posts(start_utc, end_utc)

            # Normalize posts
            for post in postiz_posts:
                publish_date = post.get("publishDate", "")
                integration = post.get("integration", {}) or {}
                result["postiz_posts"].append({
                    "id": post.get("id"),
                    "content": (post.get("content", "") or "")[:200],
                    "publish_date": publish_date,
                    "state": post.get("state", "UNKNOWN"),
                    "release_url": post.get("releaseURL"),
                    "platform": integration.get("providerIdentifier", "unknown"),
                    "platform_name": integration.get("name", ""),
                    "platform_picture": integration.get("picture"),
                })
    except Exception as e:
        logger.warning(f"Failed to fetch Postiz calendar: {e}")

    # 2. Fetch local schedule items for the date range
    try:
        items_resp = repo.table_query("editai_schedule_items", "select",
            filters=QueryFilters(
                select="*, editai_clips(variant_name, thumbnail_path, duration, final_video_path)",
                gte={"scheduled_date": start_date},
                lte={"scheduled_date": end_date},
            ))

        # Filter by profile: join through plan
        if items_resp.data:
            plan_ids = list(set(item["plan_id"] for item in items_resp.data))
            plans_resp = repo.table_query("editai_schedule_plans", "select",
                filters=QueryFilters(
                    select="id",
                    in_={"id": plan_ids},
                    eq={"profile_id": profile.profile_id},
                ))
            valid_plan_ids = set(p["id"] for p in (plans_resp.data or []))

            for item in items_resp.data:
                if item["plan_id"] in valid_plan_ids:
                    clip_data = item.get("editai_clips", {}) or {}
                    result["schedule_items"].append({
                        "id": item["id"],
                        "clip_id": item["clip_id"],
                        "clip_name": clip_data.get("variant_name", ""),
                        "thumbnail_path": clip_data.get("thumbnail_path"),
                        "final_video_path": clip_data.get("final_video_path"),
                        "scheduled_date": item["scheduled_date"],
                        "scheduled_at": item["scheduled_at"],
                        "status": item["status"],
                        "postiz_post_id": item.get("postiz_post_id"),
                        "error_message": item.get("error_message"),
                    })
    except Exception as e:
        logger.warning(f"Failed to fetch local schedule items: {e}")

    # 3. Build per-day summary
    from collections import defaultdict
    days = defaultdict(lambda: {"postiz_count": 0, "scheduled_count": 0, "published_count": 0})

    for post in result["postiz_posts"]:
        pd = post.get("publish_date", "")[:10]
        if pd:
            days[pd]["postiz_count"] += 1
            if post.get("state") == "PUBLISHED":
                days[pd]["published_count"] += 1

    for item in result["schedule_items"]:
        sd = item.get("scheduled_date", "")
        if sd:
            days[sd]["scheduled_count"] += 1

    result["days"] = dict(days)
    return result


@router.post("/plans/{plan_id}/sync")
async def sync_plan_status(
    plan_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Sync status of schedule items with Postiz (check if posts were published)."""
    from app.services.postiz_service import get_postiz_publisher

    repo = get_repository()

    # Verify ownership
    plan_resp = repo.table_query("editai_schedule_plans", "select",
        filters=QueryFilters(
            select="id",
            eq={"id": plan_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not plan_resp.data:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Fetch items that have postiz_post_id (were successfully scheduled)
    items_resp = repo.table_query("editai_schedule_items", "select",
        filters=QueryFilters(
            select="id, clip_id, postiz_post_id, status",
            eq={"plan_id": plan_id, "status": "scheduled"},
            not_is={"postiz_post_id": "null"},
        ))

    items = items_resp.data or []
    if not items:
        return {"synced": 0, "message": "No scheduled items to sync"}

    publisher = get_postiz_publisher(profile.profile_id)
    updated = 0

    for item in items:
        try:
            post_status = await publisher.get_post_status(item["postiz_post_id"])
            state = post_status.get("state", "")

            new_status = None
            if state == "PUBLISHED":
                new_status = "published"
            elif state == "ERROR":
                new_status = "failed"
            # QUEUE means still waiting, no update needed

            if new_status and new_status != item["status"]:
                repo.table_query("editai_schedule_items", "update", data={
                    "status": new_status,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }, filters=QueryFilters(eq={"id": item["id"]}))

                # Also update clip status
                if item.get("clip_id"):
                    clip_status = "sent" if new_status == "published" else "failed"
                    repo.update_clip(item["clip_id"], {
                        "postiz_status": clip_status,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })

                updated += 1
        except Exception as e:
            logger.warning(f"Failed to sync item {item['id']}: {e}")

    return {"synced": updated, "total": len(items), "message": f"Synced {updated}/{len(items)} items"}


# --- Background Task ---

async def _execute_schedule_plan_task(
    plan_id: str,
    profile_id: str,
    caption_template: str,
    integration_ids: List[str],
    job_id: str,
):
    """Background task that executes a schedule plan."""
    repo = get_repository()

    try:
        # Update plan status to running
        repo.update_schedule_plan(plan_id, {
            "status": "running",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

        # Store plan_id in progress for lookup
        with _schedule_progress_lock:
            _schedule_progress[job_id] = {
                "plan_id": plan_id,
                "profile_id": profile_id,
                "percentage": 0,
                "step": "Starting schedule execution...",
                "status": "running",
                "items_done": 0,
                "items_total": 0,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

        def progress_callback(done: int, total: int, step: str):
            pct = min(100, int(done / max(total, 1) * 100))
            with _schedule_progress_lock:
                _schedule_progress[job_id] = {
                    "plan_id": plan_id,
                    "profile_id": profile_id,
                    "percentage": pct,
                    "step": step,
                    "status": "running",
                    "items_done": done,
                    "items_total": total,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }

        scheduled_count, failed_count = await execute_schedule_plan(
            plan_id=plan_id,
            profile_id=profile_id,
            caption_template=caption_template,
            integration_ids=integration_ids,
            progress_callback=progress_callback,
        )

        # Determine final status
        if failed_count == 0:
            final_status = "completed"
        elif scheduled_count > 0:
            final_status = "completed_with_errors"
        else:
            final_status = "failed"

        # Update plan in DB
        repo.update_schedule_plan(plan_id, {
            "status": final_status,
            "scheduled_count": scheduled_count,
            "failed_count": failed_count,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

        # Update progress
        total = scheduled_count + failed_count
        _update_progress(
            job_id, 100,
            f"Done: {scheduled_count} scheduled, {failed_count} failed",
            "completed", total, total,
        )
        with _schedule_progress_lock:
            _schedule_progress[job_id]["plan_id"] = plan_id
            _schedule_progress[job_id]["profile_id"] = profile_id

        logger.info(f"Schedule plan {plan_id} completed: {final_status}")

    except Exception as e:
        logger.error(f"Schedule plan {plan_id} failed: {e}")

        try:
            repo.update_schedule_plan(plan_id, {
                "status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass

        _update_progress(job_id, 100, f"Failed: {str(e)[:200]}", "failed", 0, 0)
        with _schedule_progress_lock:
            _schedule_progress[job_id]["plan_id"] = plan_id
            _schedule_progress[job_id]["profile_id"] = profile_id
