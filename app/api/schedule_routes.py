"""
Schedule Routes - Smart Schedule Publishing

Endpoints for previewing, creating, monitoring and managing
scheduled post plans that distribute clips across days.
"""

import logging
import threading
import uuid
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
    post_time: str = "09:00"  # HH:MM (fallback when platform_times not set)
    timezone: str = "Europe/Bucharest"
    # V2 smart schedule fields
    integration_ids: Optional[List[str]] = None
    platform_times: Optional[Dict[str, str]] = None  # {integration_id: "HH:MM"}
    jitter_minutes: int = Field(default=0, ge=0, le=720)
    clip_ids: Optional[List[str]] = None  # Filter to specific clips (from pipeline selection)


class ScheduleAssignmentResponse(BaseModel):
    clip_id: str
    project_id: str
    project_name: str
    clip_name: str
    scheduled_date: str
    scheduled_at: str
    thumbnail_path: Optional[str] = None
    duration: Optional[float] = None
    final_video_path: Optional[str] = None
    # V2 smart schedule fields
    integration_id: Optional[str] = None
    platform_type: Optional[str] = None
    jitter_offset_minutes: int = 0
    variant_index: Optional[int] = None


class SchedulePreviewResponse(BaseModel):
    days_used: int
    clips_per_day: Dict[str, int]
    total_clips: int
    collections_count: int
    assignments: List[ScheduleAssignmentResponse]
    excluded_collections: List[dict] = []
    variant_routing: Optional[Dict[str, int]] = None
    jitter_seed: Optional[int] = None


class CreateSchedulePlanRequest(BaseModel):
    collection_ids: List[str]
    start_date: str
    post_time: str = "09:00"
    timezone: str = "Europe/Bucharest"
    integration_ids: List[str]
    caption_template: str = ""
    name: str = ""
    # V2 smart schedule fields
    platform_times: Optional[Dict[str, str]] = None  # {integration_id: "HH:MM"}
    jitter_minutes: int = Field(default=15, ge=0, le=720)
    clip_ids: Optional[List[str]] = None  # Filter to specific clips (from pipeline selection)
    # Per-clip captions (from Library BulkScheduleDialog)
    captions: Optional[Dict[str, str]] = None  # {clip_id: "caption text"}
    youtube_title: Optional[str] = None


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

def _fetch_collection_clips(collection_ids: List[str], profile_id: str, clip_ids: Optional[List[str]] = None):
    """
    Fetch rendered clips grouped by project, with ownership verification.
    When clip_ids is provided, only those clips are included (respects pipeline UI selection).
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
            select="id, project_id, variant_index, variant_name, visual_version, thumbnail_path, duration, final_video_path, final_status, postiz_status, is_deleted",
            in_={"project_id": valid_project_ids},
            eq={"final_status": "completed"},
            or_="is_deleted.is.null,is_deleted.eq.false",
            order_by="variant_index",
        ))

    clips = clips_resp.data if clips_resp.data else []

    # Filter to specific clip IDs if provided (respects pipeline UI selection).
    # When meta multiplication exists, pipeline Step 4 selects base variant clip IDs
    # while the scheduler still needs the paired A/B renders for platform-specific routing.
    if clip_ids:
        clip_id_set = set(clip_ids)
        selected_variants_by_project: Dict[str, set] = {}
        for clip in clips:
            if clip["id"] in clip_id_set:
                selected_variants_by_project.setdefault(clip["project_id"], set()).add(
                    clip.get("variant_index", 0)
                )

        clips = [
            c for c in clips
            if c["id"] in clip_id_set
            or c.get("variant_index", 0) in selected_variants_by_project.get(c["project_id"], set())
        ]

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
        request.collection_ids, profile.profile_id, clip_ids=request.clip_ids
    )

    # Resolve integration platform types for V2
    integrations_info: Dict[str, str] = {}
    if request.integration_ids:
        try:
            from app.services.postiz_service import get_postiz_publisher
            publisher = get_postiz_publisher(profile.profile_id)
            integrations = await publisher.get_integrations()
            integrations_info = {i.id: i.type for i in integrations}
        except Exception as e:
            # V2 REQUIRES integration info for Meta safety — fail hard
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch Postiz integrations (required for smart schedule): {e}"
            )

    try:
        plan = build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=start_dt,
            post_time=post_tm,
            user_timezone=request.timezone,
            integration_ids=request.integration_ids,
            integrations_info=integrations_info,
            platform_times=request.platform_times,
            jitter_minutes=request.jitter_minutes,
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
                final_video_path=a.final_video_path,
                integration_id=a.integration_id,
                platform_type=a.platform_type,
                jitter_offset_minutes=a.jitter_offset_minutes,
                variant_index=a.variant_index,
            )
            for a in plan.assignments
        ],
        excluded_collections=plan.excluded_collections,
        variant_routing=plan.variant_routing,
        jitter_seed=plan.jitter_seed,
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
        request.collection_ids, profile.profile_id, clip_ids=request.clip_ids
    )

    # V2 activates when platform_times OR integration_ids with 2+ entries are provided
    # (smart routing needs integration info to classify Meta vs non-Meta)
    is_v2 = bool(request.platform_times) or len(request.integration_ids) >= 2
    integrations_info: Dict[str, str] = {}
    if is_v2:
        try:
            from app.services.postiz_service import get_postiz_publisher
            publisher = get_postiz_publisher(profile.profile_id)
            integrations = await publisher.get_integrations()
            integrations_info = {i.id: i.type for i in integrations}
        except Exception as e:
            # V2 REQUIRES integration info for Meta safety — fail hard
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch Postiz integrations (required for smart schedule): {e}"
            )

    try:
        plan = build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=start_dt,
            post_time=post_tm,
            user_timezone=request.timezone,
            integration_ids=request.integration_ids if is_v2 else None,
            integrations_info=integrations_info if is_v2 else None,
            platform_times=request.platform_times,
            jitter_minutes=request.jitter_minutes if is_v2 else 0,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Generate IDs
    plan_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    plan_name = request.name or f"Schedule {start_dt.isoformat()}"
    plan_version = 2 if is_v2 else 1

    repo = get_repository()

    # Insert plan record
    plan_record = {
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
        "plan_version": plan_version,
    }
    if is_v2:
        plan_record["platform_times"] = request.platform_times
        plan_record["jitter_minutes"] = request.jitter_minutes
        plan_record["jitter_seed"] = plan.jitter_seed
        plan_record["variant_routing"] = plan.variant_routing

    repo.create_schedule_plan(plan_record)

    # Insert schedule items
    items_to_insert = []
    for a in plan.assignments:
        item = {
            "plan_id": plan_id,
            "clip_id": a.clip_id,
            "project_id": a.project_id,
            "scheduled_date": a.scheduled_date.isoformat(),
            "scheduled_at": a.scheduled_at.isoformat(),
            "status": "pending",
        }
        if is_v2:
            item["integration_id"] = a.integration_id
            item["platform_type"] = a.platform_type
            item["jitter_offset_minutes"] = a.jitter_offset_minutes
            item["variant_index"] = a.variant_index
        items_to_insert.append(item)

    if items_to_insert:
        # Insert in batches of 50
        for i in range(0, len(items_to_insert), 50):
            batch = items_to_insert[i:i+50]
            repo.table_query("editai_schedule_items", "insert", data=batch)

    # Persist per-clip captions to editai_clip_content (for V2 executor to read)
    if request.captions:
        for clip_id, caption_text in request.captions.items():
            repo.table_query(
                "editai_clip_content", "upsert",
                data={"clip_id": clip_id, "caption": caption_text},
                filters=QueryFilters(on_conflict="clip_id"),
            )

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
                    "group": post.get("group"),
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
                        # V2 fields
                        "integration_id": item.get("integration_id"),
                        "platform_type": item.get("platform_type"),
                        "jitter_offset_minutes": item.get("jitter_offset_minutes", 0),
                        "variant_index": item.get("variant_index"),
                    })
    except Exception as e:
        logger.warning(f"Failed to fetch local schedule items: {e}")

    # 2b. Enrich postiz_posts with local video data from editai_postiz_publications
    # Posts published via Quick Schedule / direct publish have clip data in publications table
    try:
        postiz_ids = [p["id"] for p in result["postiz_posts"] if p.get("id")]
        # Find which postiz_post_ids already have schedule_items (already linked)
        linked_postiz_ids = set(
            item["postiz_post_id"] for item in result["schedule_items"]
            if item.get("postiz_post_id")
        )
        # Only look up unlinked posts
        unlinked_ids = [pid for pid in postiz_ids if pid not in linked_postiz_ids]

        if unlinked_ids and repo:
            pubs_resp = repo.table_query("editai_postiz_publications", "select",
                filters=QueryFilters(
                    select="postiz_post_id, clip_id",
                    in_={"postiz_post_id": unlinked_ids},
                    eq={"profile_id": profile.profile_id},
                ))
            if pubs_resp.data:
                # Get clip details for these publications
                clip_ids = list(set(p["clip_id"] for p in pubs_resp.data if p.get("clip_id")))
                if clip_ids:
                    clips_resp = repo.table_query("editai_clips", "select",
                        filters=QueryFilters(
                            select="id, variant_name, thumbnail_path, duration, final_video_path",
                            in_={"id": clip_ids},
                        ))
                    clips_by_id = {c["id"]: c for c in (clips_resp.data or [])}

                    # Build postiz_post_id -> clip data map
                    pub_clip_map = {}
                    for pub in pubs_resp.data:
                        if pub.get("clip_id") and pub["clip_id"] in clips_by_id:
                            pub_clip_map[pub["postiz_post_id"]] = clips_by_id[pub["clip_id"]]

                    # Inject as synthetic schedule items so frontend can link them
                    for postiz_post_id, clip in pub_clip_map.items():
                        result["schedule_items"].append({
                            "id": f"pub-{postiz_post_id}",
                            "clip_id": clip["id"],
                            "clip_name": clip.get("variant_name", ""),
                            "thumbnail_path": clip.get("thumbnail_path"),
                            "final_video_path": clip.get("final_video_path"),
                            "scheduled_date": None,
                            "scheduled_at": None,
                            "status": "published",
                            "postiz_post_id": postiz_post_id,
                            "error_message": None,
                        })
    except Exception as e:
        logger.warning(f"Failed to enrich posts from publications: {e}")

    # 2c. Fetch Buffer publications (not present in Postiz API — live only in our DB)
    # These have postiz_post_id prefixed with "buffer:" and must be surfaced
    # as synthetic postiz_posts + schedule_items so the calendar renders them.
    try:
        start_iso = datetime.combine(start_dt, time(0, 0), tzinfo=timezone.utc).isoformat()
        end_iso = datetime.combine(end_dt, time(23, 59, 59), tzinfo=timezone.utc).isoformat()

        # Pull scheduled-range and published-range separately, then merge.
        buf_scheduled = repo.table_query("editai_postiz_publications", "select",
            filters=QueryFilters(
                select="postiz_post_id, platform, status, scheduled_at, published_at, caption, clip_id",
                eq={"profile_id": profile.profile_id},
                like={"postiz_post_id": "buffer:%"},
                gte={"scheduled_at": start_iso},
                lte={"scheduled_at": end_iso},
            ))
        buf_published = repo.table_query("editai_postiz_publications", "select",
            filters=QueryFilters(
                select="postiz_post_id, platform, status, scheduled_at, published_at, caption, clip_id",
                eq={"profile_id": profile.profile_id},
                like={"postiz_post_id": "buffer:%"},
                gte={"published_at": start_iso},
                lte={"published_at": end_iso},
            ))

        # Dedupe by postiz_post_id (a single row may match both windows)
        buffer_pubs: Dict[str, dict] = {}
        for row in (buf_scheduled.data or []) + (buf_published.data or []):
            pid = row.get("postiz_post_id")
            if pid:
                buffer_pubs.setdefault(pid, row)

        if buffer_pubs:
            # Fetch clip metadata in one query for thumbnails / video paths
            clip_ids = list({r["clip_id"] for r in buffer_pubs.values() if r.get("clip_id")})
            clips_by_id: Dict[str, dict] = {}
            if clip_ids:
                clips_resp = repo.table_query("editai_clips", "select",
                    filters=QueryFilters(
                        select="id, variant_name, thumbnail_path, duration, final_video_path",
                        in_={"id": clip_ids},
                    ))
                clips_by_id = {c["id"]: c for c in (clips_resp.data or [])}

            status_to_state = {
                "published": "PUBLISHED",
                "scheduled": "QUEUE",
                "failed": "ERROR",
                "pending": "QUEUE",
            }

            for pid, row in buffer_pubs.items():
                publish_ts = row.get("scheduled_at") or row.get("published_at")
                if not publish_ts:
                    continue  # Skip rows with no usable date
                state = status_to_state.get((row.get("status") or "").lower(), "UNKNOWN")
                raw_platform = (row.get("platform") or "").lower()
                # Normalize: "tiktok (buffer)" → platform="tiktok", clear name
                platform_key = raw_platform.split(" ")[0] if raw_platform else "tiktok"
                platform_display = {
                    "tiktok": "TikTok",
                    "instagram": "Instagram",
                    "youtube": "YouTube",
                    "facebook": "Facebook",
                    "twitter": "Twitter/X",
                    "x": "Twitter/X",
                    "linkedin": "LinkedIn",
                    "pinterest": "Pinterest",
                    "threads": "Threads",
                }.get(platform_key, platform_key.title() or "TikTok")

                result["postiz_posts"].append({
                    "id": pid,
                    "content": (row.get("caption") or "")[:200],
                    "publish_date": publish_ts,
                    "state": state,
                    "release_url": None,
                    "platform": platform_key or "tiktok",
                    "platform_name": f"{platform_display} (via Buffer)",
                    "platform_picture": None,
                    "source": "buffer",
                })

                clip = clips_by_id.get(row.get("clip_id")) if row.get("clip_id") else None
                if clip:
                    # Derive date string for schedule_items grouping
                    sched_date = publish_ts[:10] if isinstance(publish_ts, str) else None
                    result["schedule_items"].append({
                        "id": f"buf-{pid}",
                        "clip_id": clip["id"],
                        "clip_name": clip.get("variant_name", ""),
                        "thumbnail_path": clip.get("thumbnail_path"),
                        "final_video_path": clip.get("final_video_path"),
                        "scheduled_date": sched_date,
                        "scheduled_at": publish_ts,
                        "status": row.get("status") or "scheduled",
                        "postiz_post_id": pid,
                        "error_message": None,
                        "platform_type": platform_key,
                        "source": "buffer",
                    })
    except Exception as e:
        logger.warning(f"Failed to fetch Buffer publications for calendar: {e}")

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
        progress_status = "failed" if final_status == "failed" else "completed"
        _update_progress(
            job_id, 100,
            f"Done: {scheduled_count} scheduled, {failed_count} failed",
            progress_status, total, total,
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
