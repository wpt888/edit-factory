"""
Smart Schedule Publishing Service

Distributes clips from multiple collections (projects) across days,
ensuring maximum 1 clip per collection per day. Uses round-robin
algorithm for even distribution.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, time, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Callable
import zoneinfo

logger = logging.getLogger(__name__)


@dataclass
class ScheduleAssignment:
    clip_id: str
    project_id: str
    project_name: str
    clip_name: str
    scheduled_date: date
    scheduled_at: datetime  # UTC
    thumbnail_path: Optional[str] = None
    duration: Optional[float] = None


@dataclass
class SchedulePlan:
    assignments: List[ScheduleAssignment]
    days_used: int
    clips_per_day: Dict[str, int]  # date_str -> count
    collections_count: int
    total_clips: int
    excluded_collections: List[Dict[str, str]] = field(default_factory=list)


def build_schedule_plan(
    collection_clips: Dict[str, List[dict]],
    collection_names: Dict[str, str],
    start_date: date,
    post_time: time,
    user_timezone: str = "UTC",
) -> SchedulePlan:
    """
    Build a schedule plan using round-robin distribution.

    Args:
        collection_clips: {project_id: [clip_dicts]} - only rendered clips
        collection_names: {project_id: project_name}
        start_date: First day of schedule
        post_time: Time of day to post (in user's timezone)
        user_timezone: IANA timezone string

    Returns:
        SchedulePlan with assignments distributed across days

    Raises:
        ValueError: If no clips available to schedule
    """
    tz = zoneinfo.ZoneInfo(user_timezone)

    # Filter out empty collections and track excluded
    excluded = []
    active_collections: Dict[str, List[dict]] = {}
    for cid, clips in collection_clips.items():
        if clips:
            active_collections[cid] = list(clips)
        else:
            excluded.append({
                "id": cid,
                "name": collection_names.get(cid, "Unknown"),
                "reason": "No rendered clips available"
            })

    if not active_collections:
        raise ValueError("No clips available to schedule. Ensure collections have rendered clips (final_status='completed').")

    # Deterministic order by project_id
    collection_ids = sorted(active_collections.keys())
    queues: Dict[str, List[dict]] = {
        cid: list(clips) for cid, clips in active_collections.items()
    }

    assignments: List[ScheduleAssignment] = []
    day_offset = 0

    while any(q for q in queues.values()):
        current_date = start_date + timedelta(days=day_offset)

        # Skip weekends if they fall on Saturday/Sunday (optional, keeping all days for now)
        for cid in collection_ids:
            if not queues.get(cid):
                continue
            clip = queues[cid].pop(0)

            # Build exact UTC datetime
            naive_dt = datetime.combine(current_date, post_time)
            local_dt = naive_dt.replace(tzinfo=tz)
            utc_dt = local_dt.astimezone(timezone.utc)

            assignments.append(ScheduleAssignment(
                clip_id=clip["id"],
                project_id=cid,
                project_name=collection_names.get(cid, "Unknown"),
                clip_name=clip.get("variant_name", f"Clip {clip.get('variant_index', '?')}"),
                scheduled_date=current_date,
                scheduled_at=utc_dt,
                thumbnail_path=clip.get("thumbnail_path"),
                duration=clip.get("duration"),
            ))

        day_offset += 1

    # Build clips_per_day summary
    clips_per_day: Dict[str, int] = {}
    for a in assignments:
        key = a.scheduled_date.isoformat()
        clips_per_day[key] = clips_per_day.get(key, 0) + 1

    return SchedulePlan(
        assignments=assignments,
        days_used=day_offset,
        clips_per_day=clips_per_day,
        collections_count=len(active_collections),
        total_clips=len(assignments),
        excluded_collections=excluded,
    )


async def execute_schedule_plan(
    plan_id: str,
    profile_id: str,
    caption_template: str,
    integration_ids: List[str],
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> Tuple[int, int]:
    """
    Execute a schedule plan by uploading and scheduling clips via Postiz.

    Args:
        plan_id: UUID of the plan in editai_schedule_plans
        profile_id: Profile ID for Postiz publisher
        caption_template: Template with {collection_name} placeholder
        integration_ids: List of Postiz integration IDs to post to
        progress_callback: Optional callback(done, total, step_message)

    Returns:
        Tuple of (scheduled_count, failed_count)
    """
    from app.services.postiz_service import get_postiz_publisher
    from app.repositories.factory import get_repository
    from app.repositories.models import QueryFilters
    from app.config import get_settings

    settings = get_settings()
    repo = get_repository()
    publisher = get_postiz_publisher(profile_id)

    # Fetch pending items
    items_result = repo.list_schedule_items(
        plan_id,
        filters=QueryFilters(
            select="*, editai_clips(final_video_path, variant_name, project_id)",
            eq={"status": "pending"},
            order_by="scheduled_date", order_desc=False,
        ),
    )

    items = items_result.data if items_result.data else []
    total = len(items)
    scheduled_count = 0
    failed_count = 0

    logger.info(f"Executing schedule plan {plan_id}: {total} items to process")

    # Fetch integrations once to build platform type mapping for proper settings
    integrations_info: Dict[str, str] = {}
    try:
        integrations = await publisher.get_integrations()
        integrations_info = {i.id: i.type for i in integrations}
        logger.info(f"Loaded {len(integrations_info)} integration types for platform settings")
    except Exception as e:
        logger.warning(f"Could not fetch integrations info (platform settings will be empty): {e}")

    for idx, item in enumerate(items):
        clip_data = item.get("editai_clips", {}) or {}
        final_video_path = clip_data.get("final_video_path", "")
        clip_id = item["clip_id"]
        project_id = item["project_id"]
        scheduled_at_str = item["scheduled_at"]
        # Parse string from Supabase into datetime (create_post expects datetime, not str)
        scheduled_at = datetime.fromisoformat(scheduled_at_str.replace("Z", "+00:00"))

        step_msg = f"Processing clip {idx + 1}/{total}"
        if progress_callback:
            progress_callback(idx, total, step_msg)

        try:
            # Resolve video path
            video_path = _resolve_video_path(final_video_path, settings)
            if not video_path:
                raise FileNotFoundError(f"Video file not found: {final_video_path}")

            # Build caption from template
            # Fetch project name for the template
            project_name = ""
            if caption_template and "{collection_name}" in caption_template:
                proj = repo.get_project(project_id)
                if proj:
                    project_name = proj.get("name", "")

            caption = caption_template.replace("{collection_name}", project_name) if caption_template else ""

            # Upload video to Postiz
            logger.info(f"Uploading clip {clip_id} to Postiz...")
            media = await publisher.upload_video(Path(video_path), profile_id=profile_id)

            # Create scheduled post
            logger.info(f"Scheduling clip {clip_id} for {scheduled_at}...")
            result = await publisher.create_post(
                media_id=media.id,
                media_path=media.path,
                caption=caption,
                integration_ids=integration_ids,
                schedule_date=scheduled_at,
                integrations_info=integrations_info,
                profile_id=profile_id,
            )

            if result.success:
                # Update schedule item
                repo.update_schedule_item(item["id"], {
                    "status": "scheduled",
                    "postiz_post_id": result.post_id,
                    "caption": caption[:500] if caption else None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

                # Update clip
                repo.update_clip(clip_id, {
                    "postiz_status": "scheduled",
                    "postiz_post_id": result.post_id,
                    "postiz_scheduled_at": scheduled_at.isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

                scheduled_count += 1
                logger.info(f"Clip {clip_id} scheduled successfully (post_id: {result.post_id})")
            else:
                raise Exception(result.error or "Postiz create_post failed")

        except Exception as e:
            failed_count += 1
            error_msg = str(e)[:500]
            logger.error(f"Failed to schedule clip {clip_id}: {error_msg}")

            try:
                repo.update_schedule_item(item["id"], {
                    "status": "failed",
                    "error_message": error_msg,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as db_err:
                logger.warning(f"Failed to update item status: {db_err}")

        # Small delay between API calls to avoid rate limiting
        await asyncio.sleep(0.5)

    # Final progress update
    if progress_callback:
        progress_callback(total, total, "Schedule execution completed")

    logger.info(f"Plan {plan_id} execution complete: {scheduled_count} scheduled, {failed_count} failed")
    return scheduled_count, failed_count


def _resolve_video_path(video_path: str, settings) -> Optional[str]:
    """Resolve video path trying multiple base directories, with path traversal protection."""
    import os

    if not video_path:
        return None

    allowed_dirs = []
    if hasattr(settings, 'output_dir') and settings.output_dir:
        allowed_dirs.append(Path(settings.output_dir).resolve())
    if hasattr(settings, 'base_dir') and settings.base_dir:
        allowed_dirs.append(Path(settings.base_dir).resolve())

    # Try absolute path first
    if os.path.isabs(video_path) and os.path.exists(video_path):
        resolved = Path(video_path).resolve()
        if not allowed_dirs or not any(resolved.is_relative_to(d) for d in allowed_dirs):
            logger.warning(f"Path traversal blocked: {video_path}")
            return None
        return str(resolved)

    # Try relative to output_dir
    if hasattr(settings, 'output_dir') and settings.output_dir:
        candidate = Path(os.path.join(settings.output_dir, video_path)).resolve()
        if candidate.exists() and candidate.is_relative_to(Path(settings.output_dir).resolve()):
            return str(candidate)

    # Try relative to base_dir
    if hasattr(settings, 'base_dir') and settings.base_dir:
        candidate = Path(os.path.join(settings.base_dir, video_path)).resolve()
        if candidate.exists() and candidate.is_relative_to(Path(settings.base_dir).resolve()):
            return str(candidate)

    return None
