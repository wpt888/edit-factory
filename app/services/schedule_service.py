"""
Smart Schedule Publishing Service V2

Distributes clips from multiple collections (projects) across days
with per-platform variant routing, time slots, and random jitter.

V2 features:
- All platforms get the SAME variant per day (1 variant = 1 day)
- Instagram gets visual version B, all others get version A
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
    "instagram": "B",
    "instagram-standalone": "B",
    "threads": "A",
    "facebook": "A",
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
    final_video_path: Optional[str] = None
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

    All platforms receive the SAME base variant index (0). Differentiation
    between platforms happens only through visual_version routing (A/B):
    Instagram gets version B, all others get version A.

    Args:
        integration_ids: All selected integration IDs
        integrations_info: {integration_id: platform_type}
        variant_count: Number of available variants per project

    Returns:
        {integration_id: variant_index}  — all mapped to 0
    """
    return {iid: 0 for iid in integration_ids}


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
    Pick the best clip for a platform, using visual version routing:
    - Instagram → version B
    - All other platforms (Meta and non-Meta) → version A, then base fallback
    """
    preferred_visual_version = get_required_visual_version(platform_type)
    variant_candidates = available_variants.get(target_variant, [])

    # 1. Try preferred visual version (B for Instagram, A for others)
    if preferred_visual_version:
        for clip in variant_candidates:
            if clip.get("visual_version") == preferred_visual_version:
                return clip

    # 2. Non-Meta platforms: prefer version A, then base (no visual_version)
    if not preferred_visual_version:
        for clip in variant_candidates:
            if clip.get("visual_version") == "A":
                return clip
        for clip in variant_candidates:
            if not clip.get("visual_version"):
                return clip

    # 3. Any clip from target variant
    if variant_candidates:
        return variant_candidates[0]

    # 4. Fallback: try other variant indices
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
            if clip.get("visual_version") == "A":
                return clip
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

    # V1 fallback: no integration_ids → old behavior (with jitter support)
    if not integration_ids:
        return _build_schedule_plan_v1(
            active_collections, collection_names, start_date, post_time, tz, excluded,
            jitter_minutes=jitter_minutes, jitter_seed=jitter_seed,
        )

    # V2: smart schedule with per-platform routing
    integrations_info = integrations_info or {}
    platform_times = platform_times or {}

    required_visual_versions = list_required_visual_versions(integration_ids, integrations_info)

    # Build clip index per collection FIRST so we can validate per variant_index
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

    # Validate per variant_index: each variant that will become a scheduled day
    # must have ALL required visual versions (A and B)
    incomplete_variants: List[str] = []
    for cid, variants in clip_by_variant.items():
        cname = collection_names.get(cid, "Unknown")
        for vi, vi_clips in variants.items():
            vi_versions = {c.get("visual_version") for c in vi_clips}
            missing = [v for v in required_visual_versions if v not in vi_versions]
            if missing:
                incomplete_variants.append(
                    f'"{cname}" variant {vi + 1} (missing: {", ".join(missing)})'
                )

    if incomplete_variants:
        raise ValueError(
            "Some variants are missing required Meta render versions: "
            + "; ".join(incomplete_variants)
            + ". Re-render with Meta multiplication enabled or deselect the affected Meta platforms."
        )

    variant_routing = compute_variant_routing(integration_ids, integrations_info, 1)

    # Initialize jitter RNG
    seed = jitter_seed if jitter_seed is not None else random.randint(0, 2**31)
    rng = random.Random(seed)

    # V2 algorithm: each variant = 1 day. All platforms receive the SAME
    # variant, differentiated only by visual version (A for most, B for Instagram).
    # Collections are interleaved: variant 0 of collection A, variant 0 of collection B,
    # then variant 1 of collection A, etc.
    collection_ids = sorted(active_collections.keys())

    # Gather all (collection, variant_index) pairs spread across days
    day_units: List[Tuple[str, int]] = []
    max_variants = max(len(variants) for variants in clip_by_variant.values())
    for vi_offset in range(max_variants):
        for cid in collection_ids:
            variant_indices = sorted(clip_by_variant.get(cid, {}).keys())
            if vi_offset < len(variant_indices):
                day_units.append((cid, variant_indices[vi_offset]))

    assignments: List[ScheduleAssignment] = []

    for day_offset, (cid, target_vi) in enumerate(day_units):
        current_date = start_date + timedelta(days=day_offset)
        available_variants = clip_by_variant.get(cid, {})
        first_variant_clips = available_variants.get(target_vi, [])
        first_clip = first_variant_clips[0] if first_variant_clips else None

        # Create one assignment per platform — all use the same variant
        for iid in integration_ids:
            platform_type = integrations_info.get(iid, "")
            clip = _pick_clip_for_platform(available_variants, target_vi, platform_type)
            if clip is None and first_clip is not None:
                logger.warning(
                    "Platform %s missing clip for variant %s in collection %s",
                    iid, target_vi, cid,
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
                final_video_path=clip.get("final_video_path"),
                integration_id=iid,
                platform_type=platform_type,
                jitter_offset_minutes=jitter,
                variant_index=clip.get("variant_index", 0),
            ))

    # Build clips_per_day summary
    clips_per_day: Dict[str, int] = {}
    for a in assignments:
        key = a.scheduled_date.isoformat()
        clips_per_day[key] = clips_per_day.get(key, 0) + 1

    return SchedulePlan(
        assignments=assignments,
        days_used=len(day_units),
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
    jitter_minutes: int = 0,
    jitter_seed: Optional[int] = None,
) -> SchedulePlan:
    """V1 legacy algorithm: one assignment per project per day, no per-platform routing.

    Applies optional jitter (±N minutes) per assignment so multiple clips on the
    same day don't all land on the exact same minute.
    """
    collection_ids = sorted(active_collections.keys())
    queues: Dict[str, List[dict]] = {
        cid: list(clips) for cid, clips in active_collections.items()
    }

    seed = jitter_seed if jitter_seed is not None else random.randint(0, 2**31)
    rng = random.Random(seed)

    assignments: List[ScheduleAssignment] = []
    day_offset = 0

    while any(q for q in queues.values()):
        current_date = start_date + timedelta(days=day_offset)

        for cid in collection_ids:
            if not queues.get(cid):
                continue
            clip = queues[cid].pop(0)

            jitter = rng.randint(-jitter_minutes, jitter_minutes) if jitter_minutes > 0 else 0

            naive_dt = datetime.combine(current_date, post_time) + timedelta(minutes=jitter)
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
                final_video_path=clip.get("final_video_path"),
                jitter_offset_minutes=jitter,
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
        jitter_seed=seed,
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
