"""
Smart Schedule Publishing Service V2

Distributes clips from multiple collections (projects) across days
with per-platform variant routing, time slots, and random jitter.

V2 features:
- Each platform gets a different variant (Meta platforms get unique variants)
- Per-platform posting times
- Random jitter (±N minutes) for anti-bot detection
- Upload caching to avoid duplicate Postiz uploads
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import date, time, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Callable, Set
import zoneinfo

logger = logging.getLogger(__name__)

META_PLATFORMS: Set[str] = {"instagram-standalone", "instagram", "facebook", "threads"}
META_VISUAL_VERSION_BY_PLATFORM: Dict[str, str] = {
    "instagram": "A",
    "instagram-standalone": "A",
    "threads": "A",
    "facebook": "B",
}


@dataclass
class ScheduleAssignment:
    clip_id: str
    project_id: str
    project_name: str
    clip_name: str
    scheduled_date: date
    scheduled_at: datetime  # UTC (includes jitter)
    thumbnail_path: Optional[str] = None
    duration: Optional[float] = None
    integration_id: Optional[str] = None
    platform_type: Optional[str] = None
    jitter_offset_minutes: int = 0
    variant_index: Optional[int] = None


@dataclass
class SchedulePlan:
    assignments: List[ScheduleAssignment]
    days_used: int
    clips_per_day: Dict[str, int]  # date_str -> count
    collections_count: int
    total_clips: int
    excluded_collections: List[Dict[str, str]] = field(default_factory=list)
    variant_routing: Optional[Dict[str, int]] = None
    jitter_seed: Optional[int] = None


def compute_variant_routing(
    integration_ids: List[str],
    integrations_info: Dict[str, str],
    variant_count: int,
) -> Dict[str, int]:
    """
    Assign base variant indices to integrations.

    Meta platforms may still resolve to different rendered assets through
    visual_version routing (A/B), so they are not hard-blocked on distinct
    base variants.

    Args:
        integration_ids: All selected integration IDs
        integrations_info: {integration_id: platform_type}
        variant_count: Number of available variants per project

    Returns:
        {integration_id: variant_index}
    """
    meta_ids = sorted(
        [iid for iid in integration_ids if integrations_info.get(iid, "") in META_PLATFORMS]
    )
    non_meta_ids = sorted(
        [iid for iid in integration_ids if integrations_info.get(iid, "") not in META_PLATFORMS]
    )

    routing: Dict[str, int] = {}

    # Meta platforms consume base variants first. The final rendered asset is
    # refined later using platform-specific visual_version routing.
    for i, iid in enumerate(meta_ids):
        routing[iid] = i % variant_count

    # Non-Meta platforms use the remaining slots, wrapping as needed.
    offset = len(meta_ids)
    for i, iid in enumerate(non_meta_ids):
        routing[iid] = (offset + i) % variant_count

    return routing


def get_required_visual_version(platform_type: str) -> Optional[str]:
    """Return the preferred visual version label for platforms with Meta-specific renders."""
    return META_VISUAL_VERSION_BY_PLATFORM.get((platform_type or "").lower())


def list_required_visual_versions(integration_ids: List[str], integrations_info: Dict[str, str]) -> List[str]:
    versions = {
        get_required_visual_version(integrations_info.get(iid, ""))
        for iid in integration_ids
    }
    return sorted(v for v in versions if v)


def _pick_clip_for_platform(
    available_variants: Dict[int, List[dict]],
    target_variant: int,
    platform_type: str,
) -> Optional[dict]:
    """
    Pick the best clip for a platform, preferring the required Meta visual version
    when available and otherwise falling back deterministically.
    """
    preferred_visual_version = get_required_visual_version(platform_type)
    variant_candidates = available_variants.get(target_variant, [])

    if preferred_visual_version:
        for clip in variant_candidates:
            if clip.get("visual_version") == preferred_visual_version:
                return clip

    if not preferred_visual_version:
        for clip in variant_candidates:
            if not clip.get("visual_version"):
                return clip

    if variant_candidates:
        return variant_candidates[0]

    all_variant_indices = sorted(available_variants.keys())
    if not all_variant_indices:
        return None

    fallback_variant = all_variant_indices[target_variant % len(all_variant_indices)]
    fallback_candidates = available_variants.get(fallback_variant, [])

    if preferred_visual_version:
        for clip in fallback_candidates:
            if clip.get("visual_version") == preferred_visual_version:
                return clip

    if not preferred_visual_version:
        for clip in fallback_candidates:
            if not clip.get("visual_version"):
                return clip

    return fallback_candidates[0] if fallback_candidates else None


def build_schedule_plan(
    collection_clips: Dict[str, List[dict]],
    collection_names: Dict[str, str],
    start_date: date,
    post_time: time,
    user_timezone: str = "UTC",
    integration_ids: Optional[List[str]] = None,
    integrations_info: Optional[Dict[str, str]] = None,
    platform_times: Optional[Dict[str, str]] = None,
    jitter_minutes: int = 0,
    jitter_seed: Optional[int] = None,
) -> SchedulePlan:
    """
    Build a schedule plan with per-platform variant routing and jitter.

    When integration_ids is provided, creates one assignment per platform per project
    per day (V2 smart schedule). Otherwise falls back to V1 behavior.

    Args:
        collection_clips: {project_id: [clip_dicts]} - only rendered clips
        collection_names: {project_id: project_name}
        start_date: First day of schedule
        post_time: Default time of day (fallback when platform_times not set)
        user_timezone: IANA timezone string
        integration_ids: Postiz integration IDs (enables V2 mode)
        integrations_info: {integration_id: platform_type}
        platform_times: {integration_id: "HH:MM"} per-platform posting times
        jitter_minutes: Random offset range (±N minutes)
        jitter_seed: Seed for reproducible jitter

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

    # V1 fallback: no integration_ids → old behavior
    if not integration_ids:
        return _build_schedule_plan_v1(
            active_collections, collection_names, start_date, post_time, tz, excluded
        )

    # V2: smart schedule with per-platform routing
    integrations_info = integrations_info or {}
    platform_times = platform_times or {}

    required_visual_versions = list_required_visual_versions(integration_ids, integrations_info)
    insufficient_collections = []
    for cid, clips in active_collections.items():
        unique_variants = len({c.get("variant_index", 0) for c in clips})
        missing_visual_versions = [
            version for version in required_visual_versions
            if not any(c.get("visual_version") == version for c in clips)
        ]

        if required_visual_versions and missing_visual_versions:
            insufficient_collections.append({
                "id": cid,
                "name": collection_names.get(cid, "Unknown"),
                "missing_visual_versions": missing_visual_versions,
            })
            continue

        non_meta_count = sum(
            1 for iid in integration_ids
            if integrations_info.get(iid, "") not in META_PLATFORMS
        )
        if non_meta_count > 0 and unique_variants < non_meta_count:
            insufficient_collections.append({
                "id": cid,
                "name": collection_names.get(cid, "Unknown"),
                "variants": unique_variants,
                "non_meta_needed": non_meta_count,
            })

    if insufficient_collections:
        visual_issues = [
            f'"{c["name"]}" (missing visual versions: {", ".join(c["missing_visual_versions"])})'
            for c in insufficient_collections
            if c.get("missing_visual_versions")
        ]
        variant_issues = [
            f'"{c["name"]}" ({c["variants"]} variants)'
            for c in insufficient_collections
            if c.get("non_meta_needed")
        ]
        if visual_issues:
            raise ValueError(
                "Collections missing required Meta render versions: "
                + ", ".join(visual_issues)
                + ". Re-render with Meta multiplication enabled or deselect the affected Meta platforms."
            )
        raise ValueError(
            f"Collections with too few base variants for {non_meta_count} non-Meta platforms: "
            + ", ".join(variant_issues)
            + ". Generate more variants or deselect some non-Meta platforms."
        )

    # Use the MINIMUM unique base variant count across collections for safe routing.
    # Meta A/B renders share the same variant_index and are chosen later by visual_version.
    min_variants = min(len({c.get("variant_index", 0) for c in clips}) for clips in active_collections.values())
    variant_routing = compute_variant_routing(integration_ids, integrations_info, min_variants)

    # Build clip index per collection: {project_id: {variant_index: [clip_dicts...]}}
    clip_by_variant: Dict[str, Dict[int, List[dict]]] = {}
    for cid, clips in active_collections.items():
        clip_by_variant[cid] = {}
        ordered_clips = sorted(
            clips,
            key=lambda c: (
                c.get("variant_index", 0),
                0 if not c.get("visual_version") else 1,
                c.get("visual_version") or "",
                c.get("id") or "",
            ),
        )
        for clip in ordered_clips:
            vi = clip.get("variant_index", 0)
            clip_by_variant[cid].setdefault(vi, []).append(clip)

    # Initialize jitter RNG
    seed = jitter_seed if jitter_seed is not None else random.randint(0, 2**31)
    rng = random.Random(seed)

    # V2 algorithm: each collection = 1 day of content (all variants go to platforms)
    # Round-robin across collections: collection A on day 1, collection B on day 2, etc.
    collection_ids = sorted(active_collections.keys())
    scheduled_collections: Set[str] = set()

    assignments: List[ScheduleAssignment] = []
    day_offset = 0

    while len(scheduled_collections) < len(collection_ids):
        current_date = start_date + timedelta(days=day_offset)

        for cid in collection_ids:
            if cid in scheduled_collections:
                continue

            # Mark this collection as consumed — all its variants go out today
            scheduled_collections.add(cid)

            available_variants = clip_by_variant.get(cid, {})
            first_variant_clips = next(iter(available_variants.values())) if available_variants else []
            first_clip = first_variant_clips[0] if first_variant_clips else None

            # Create one assignment per platform
            for iid in integration_ids:
                target_variant = variant_routing.get(iid, 0)
                platform_type = integrations_info.get(iid, "")
                clip = _pick_clip_for_platform(available_variants, target_variant, platform_type)
                if clip is None and first_clip is not None:
                    logger.warning(
                        "Platform %s missing schedulable clip for variant %s in collection %s",
                        iid, target_variant, cid,
                    )
                    clip = first_clip
                if clip is None:
                    continue

                # Determine posting time for this platform
                time_str = platform_times.get(iid)
                if time_str:
                    parts = time_str.split(":")
                    platform_post_time = time(int(parts[0]), int(parts[1]))
                else:
                    platform_post_time = post_time

                # Apply jitter
                jitter = rng.randint(-jitter_minutes, jitter_minutes) if jitter_minutes > 0 else 0

                # Build UTC datetime
                naive_dt = datetime.combine(current_date, platform_post_time)
                naive_dt = naive_dt + timedelta(minutes=jitter)
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
                    integration_id=iid,
                    platform_type=platform_type,
                    jitter_offset_minutes=jitter,
                    variant_index=clip.get("variant_index", 0),
                ))

            # Only 1 collection per day (round-robin)
            break

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
        variant_routing=variant_routing,
        jitter_seed=seed,
    )


def _build_schedule_plan_v1(
    active_collections: Dict[str, List[dict]],
    collection_names: Dict[str, str],
    start_date: date,
    post_time: time,
    tz: zoneinfo.ZoneInfo,
    excluded: List[Dict[str, str]],
) -> SchedulePlan:
    """V1 legacy algorithm: one assignment per project per day, no per-platform routing."""
    collection_ids = sorted(active_collections.keys())
    queues: Dict[str, List[dict]] = {
        cid: list(clips) for cid, clips in active_collections.items()
    }

    assignments: List[ScheduleAssignment] = []
    day_offset = 0

    while any(q for q in queues.values()):
        current_date = start_date + timedelta(days=day_offset)

        for cid in collection_ids:
            if not queues.get(cid):
                continue
            clip = queues[cid].pop(0)

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

    For V2 plans (plan_version=2): each schedule item targets a single platform
    with its own clip variant. Uploads are cached to avoid duplicates.

    For V1 plans (plan_version=1 or NULL): legacy behavior unchanged.

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

    # Check plan version
    plan_record = repo.get_schedule_plan(plan_id)
    plan_version = (plan_record or {}).get("plan_version", 1) or 1

    # Fetch pending items
    items_result = repo.list_schedule_items(
        plan_id,
        filters=QueryFilters(
            select="*, editai_clips(final_video_path, variant_name, project_id)",
            eq={"status": "pending"},
            order_by="scheduled_at" if plan_version >= 2 else "scheduled_date",
            order_desc=False,
        ),
    )

    items = items_result.data if items_result.data else []
    total = len(items)
    scheduled_count = 0
    failed_count = 0

    logger.info(f"Executing schedule plan {plan_id} (v{plan_version}): {total} items to process")

    # Fetch integrations once for platform type mapping
    integrations_info: Dict[str, str] = {}
    try:
        integrations = await publisher.get_integrations()
        integrations_info = {i.id: i.type for i in integrations}
        logger.info(f"Loaded {len(integrations_info)} integration types")
    except Exception as e:
        logger.warning(f"Could not fetch integrations info: {e}")

    if plan_version >= 2:
        return await _execute_v2(
            items, total, plan_id, profile_id, caption_template,
            publisher, repo, settings, integrations_info, progress_callback,
        )
    else:
        return await _execute_v1(
            items, total, plan_id, profile_id, caption_template,
            integration_ids, publisher, repo, settings, integrations_info, progress_callback,
        )


async def _execute_v2(
    items: list,
    total: int,
    plan_id: str,
    profile_id: str,
    caption_template: str,
    publisher,
    repo,
    settings,
    integrations_info: Dict[str, str],
    progress_callback: Optional[Callable],
) -> Tuple[int, int]:
    """V2 execution: one Postiz post per platform per item, with upload caching."""
    scheduled_count = 0
    failed_count = 0

    # Upload cache: video_path → PostizMedia
    upload_cache: Dict[str, object] = {}

    for idx, item in enumerate(items):
        clip_data = item.get("editai_clips", {}) or {}
        final_video_path = clip_data.get("final_video_path", "")
        clip_id = item["clip_id"]
        project_id = item["project_id"]
        item_integration_id = item.get("integration_id")
        scheduled_at_str = item["scheduled_at"]
        scheduled_at = datetime.fromisoformat(scheduled_at_str.replace("Z", "+00:00"))

        step_msg = f"Processing item {idx + 1}/{total}"
        if progress_callback:
            progress_callback(idx, total, step_msg)

        try:
            # Resolve video path
            video_path = _resolve_video_path(final_video_path, settings)
            if not video_path:
                raise FileNotFoundError(f"Video file not found: {final_video_path}")

            # Build caption: prefer per-clip stored caption, fall back to template
            caption = ""
            try:
                clip_content = repo.table_query(
                    "editai_clip_content", "select",
                    filters=QueryFilters(
                        select="caption",
                        eq={"clip_id": clip_id},
                        limit=1,
                    ),
                )
                if clip_content.data and clip_content.data[0].get("caption"):
                    caption = clip_content.data[0]["caption"]
            except Exception:
                pass  # table may not exist or query failed — fall through to template

            if not caption and caption_template:
                project_name = ""
                if "{collection_name}" in caption_template:
                    proj = repo.get_project(project_id)
                    if proj:
                        project_name = proj.get("name", "")
                caption = caption_template.replace("{collection_name}", project_name)

            # Upload video (cached)
            if video_path not in upload_cache:
                logger.info(f"Uploading clip {clip_id} to Postiz...")
                media = await publisher.upload_video(Path(video_path), profile_id=profile_id)
                upload_cache[video_path] = media
            else:
                media = upload_cache[video_path]
                logger.info(f"Using cached upload for clip {clip_id}")

            # Create post for SINGLE platform
            target_ids = [item_integration_id] if item_integration_id else []
            if not target_ids:
                raise ValueError(f"No integration_id on schedule item {item['id']}")

            logger.info(f"Scheduling clip {clip_id} for {scheduled_at} on {item.get('platform_type', '?')}...")
            result = await publisher.create_post(
                media_id=media.id,
                media_path=media.path,
                caption=caption,
                integration_ids=target_ids,
                schedule_date=scheduled_at,
                integrations_info=integrations_info,
                profile_id=profile_id,
            )

            if result.success:
                repo.update_schedule_item(item["id"], {
                    "status": "scheduled",
                    "postiz_post_id": result.post_id,
                    "caption": caption[:500] if caption else None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

                repo.update_clip(clip_id, {
                    "postiz_status": "scheduled",
                    "postiz_post_id": result.post_id,
                    "postiz_scheduled_at": scheduled_at.isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })

                scheduled_count += 1
                logger.info(f"Clip {clip_id} scheduled on {item.get('platform_type')} (post_id: {result.post_id})")
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

        # Anti rate-limit delay (3s for V2 — more calls per plan)
        await asyncio.sleep(3)

    if progress_callback:
        progress_callback(total, total, "Schedule execution completed")

    logger.info(f"Plan {plan_id} V2 execution: {scheduled_count} scheduled, {failed_count} failed")
    return scheduled_count, failed_count


async def _execute_v1(
    items: list,
    total: int,
    plan_id: str,
    profile_id: str,
    caption_template: str,
    integration_ids: List[str],
    publisher,
    repo,
    settings,
    integrations_info: Dict[str, str],
    progress_callback: Optional[Callable],
) -> Tuple[int, int]:
    """V1 legacy execution: one Postiz post per item, all platforms at once."""
    scheduled_count = 0
    failed_count = 0

    for idx, item in enumerate(items):
        clip_data = item.get("editai_clips", {}) or {}
        final_video_path = clip_data.get("final_video_path", "")
        clip_id = item["clip_id"]
        project_id = item["project_id"]
        scheduled_at_str = item["scheduled_at"]
        scheduled_at = datetime.fromisoformat(scheduled_at_str.replace("Z", "+00:00"))

        step_msg = f"Processing clip {idx + 1}/{total}"
        if progress_callback:
            progress_callback(idx, total, step_msg)

        try:
            video_path = _resolve_video_path(final_video_path, settings)
            if not video_path:
                raise FileNotFoundError(f"Video file not found: {final_video_path}")

            project_name = ""
            if caption_template and "{collection_name}" in caption_template:
                proj = repo.get_project(project_id)
                if proj:
                    project_name = proj.get("name", "")
            caption = caption_template.replace("{collection_name}", project_name) if caption_template else ""

            logger.info(f"Uploading clip {clip_id} to Postiz...")
            media = await publisher.upload_video(Path(video_path), profile_id=profile_id)

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
                repo.update_schedule_item(item["id"], {
                    "status": "scheduled",
                    "postiz_post_id": result.post_id,
                    "caption": caption[:500] if caption else None,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
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

        await asyncio.sleep(0.5)

    if progress_callback:
        progress_callback(total, total, "Schedule execution completed")

    logger.info(f"Plan {plan_id} V1 execution: {scheduled_count} scheduled, {failed_count} failed")
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
