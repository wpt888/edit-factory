"""
Buffer Social Media Publishing Routes.
Publishes videos to TikTok (and other platforms) via Buffer GraphQL API.
Videos are temporarily uploaded to Supabase Storage for public URL access.
"""
import asyncio
import re
import threading
import uuid
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Request
from pydantic import BaseModel

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/buffer", tags=["buffer"])


def smart_truncate(text: str, limit: int = 150) -> str:
    """Truncate text at word boundary, preferring sentence-end punctuation."""
    if not text or len(text) <= limit:
        return text or ""
    # Reserve space for ellipsis
    cut = limit - 3
    # Prefer breaking at last sentence-ending punctuation within limit
    for punct in [". ", "! ", "? "]:
        idx = text.rfind(punct, 0, cut + 1)
        if idx != -1:
            return text[:idx + 1] + "..."
    # Fall back to last space
    space_idx = text.rfind(" ", 0, cut + 1)
    if space_idx > 0:
        return text[:space_idx] + "..."
    # No spaces at all — hard cut
    return text[:cut] + "..."


# ============== PYDANTIC MODELS ==============

class BufferChannelResponse(BaseModel):
    id: str
    name: str
    service: str
    type: str
    avatar: Optional[str] = None
    is_disconnected: bool = False


class BufferStatusResponse(BaseModel):
    configured: bool
    connected: bool
    channels_count: int = 0
    channels: List[BufferChannelResponse] = []
    error: Optional[str] = None


class BufferPublishRequest(BaseModel):
    clip_id: str
    caption: str
    channel_id: str
    schedule_date: Optional[str] = None  # ISO format datetime
    tiktok_title: Optional[str] = None


class BufferBulkPublishRequest(BaseModel):
    clip_ids: List[str]
    caption: str = ""
    captions: Optional[Dict[str, str]] = None  # clip_id → caption
    channel_id: str
    schedule_date: Optional[str] = None
    schedule_interval_minutes: int = 30
    tiktok_title: Optional[str] = None


class BufferPublishResponse(BaseModel):
    status: str
    job_id: Optional[str] = None
    message: str
    post_id: Optional[str] = None


# ============== PROGRESS TRACKING ==============
_publish_progress: Dict[str, dict] = {}
_publish_progress_lock = threading.Lock()
_MAX_PROGRESS_ENTRIES = 1000


def _evict_old_progress():
    if len(_publish_progress) >= _MAX_PROGRESS_ENTRIES:
        to_remove = sorted(
            _publish_progress.keys(),
            key=lambda k: _publish_progress[k].get("updated_at", "")
        )[:len(_publish_progress) - _MAX_PROGRESS_ENTRIES]
        for key in to_remove:
            _publish_progress.pop(key, None)


def update_progress(job_id: str, step: str, percentage: int, status: str = "in_progress"):
    with _publish_progress_lock:
        _evict_old_progress()
        _publish_progress[job_id] = {
            "step": step,
            "percentage": percentage,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }


def get_progress(job_id: str) -> Optional[dict]:
    with _publish_progress_lock:
        return _publish_progress.get(job_id)


# ============== ENDPOINTS ==============

@router.get("/status", response_model=BufferStatusResponse)
async def get_buffer_status(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Check Buffer API connectivity and list connected channels."""
    from app.services.buffer_service import is_buffer_configured, get_buffer_publisher

    result = BufferStatusResponse(configured=False, connected=False)

    try:
        if not is_buffer_configured(profile.profile_id):
            result.error = "Buffer credentials not configured"
            return result

        result.configured = True
        publisher = get_buffer_publisher(profile.profile_id)
        channels = await publisher.get_channels()

        result.connected = True
        result.channels_count = len(channels)
        result.channels = [
            BufferChannelResponse(
                id=ch.id, name=ch.name, service=ch.service,
                type=ch.type, avatar=ch.avatar,
                is_disconnected=ch.is_disconnected,
            )
            for ch in channels if not ch.is_disconnected
        ]

    except ValueError as e:
        result.error = str(e)
    except Exception as e:
        result.error = str(e)
        logger.error(f"[Profile {profile.profile_id}] Buffer status check failed: {e}")

    return result


@router.get("/channels", response_model=List[BufferChannelResponse])
async def get_channels(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get all connected Buffer channels."""
    from app.services.buffer_service import is_buffer_configured, get_buffer_publisher

    if not is_buffer_configured(profile.profile_id):
        return []

    try:
        publisher = get_buffer_publisher(profile.profile_id)
        channels = await publisher.get_channels()
        return [
            BufferChannelResponse(
                id=ch.id, name=ch.name, service=ch.service,
                type=ch.type, avatar=ch.avatar,
                is_disconnected=ch.is_disconnected,
            )
            for ch in channels if not ch.is_disconnected
        ]
    except ValueError:
        return []
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Failed to get Buffer channels: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch Buffer channels")


@router.post("/publish", response_model=BufferPublishResponse)
async def publish_clip(
    background_tasks: BackgroundTasks,
    request: BufferPublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Publish a rendered clip via Buffer.

    Flow: upload to Supabase Storage → create Buffer post → cleanup after posting.
    """
    logger.info(f"[Profile {profile.profile_id}] Buffer publish clip {request.clip_id} to channel {request.channel_id}")
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify clip exists and belongs to profile
    try:
        result = repo.table_query(
            "editai_clips", "select",
            filters=QueryFilters(
                select="*, editai_projects!inner(profile_id)",
                eq={"id": request.clip_id}, limit=1,
            )
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Clip not found")

    if not result.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip = result.data[0]
    if clip["editai_projects"]["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    if not clip.get("final_video_path"):
        raise HTTPException(status_code=400, detail="Clip must be rendered before publishing")

    video_path = Path(clip["final_video_path"])
    if not video_path.exists():
        settings = get_settings()
        video_path = settings.output_dir / clip["final_video_path"]
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")

    # Parse schedule date
    schedule_dt = None
    if request.schedule_date:
        try:
            schedule_dt = datetime.fromisoformat(request.schedule_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid schedule_date format")

    job_id = str(uuid.uuid4())

    background_tasks.add_task(
        _publish_clip_task,
        job_id=job_id,
        clip_id=request.clip_id,
        profile_id=profile.profile_id,
        video_path=str(video_path),
        caption=request.caption,
        channel_id=request.channel_id,
        schedule_date=schedule_dt,
        tiktok_title=request.tiktok_title,
    )

    return BufferPublishResponse(
        status="processing",
        job_id=job_id,
        message="Publishing via Buffer..."
    )


@router.post("/bulk-publish", response_model=BufferPublishResponse)
async def bulk_publish_clips(
    background_tasks: BackgroundTasks,
    request: BufferBulkPublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Publish multiple clips via Buffer with staggered scheduling."""
    logger.info(f"[Profile {profile.profile_id}] Buffer bulk publish {len(request.clip_ids)} clips, schedule_date={request.schedule_date!r}, interval={request.schedule_interval_minutes}")
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    settings = get_settings()

    # Fetch and validate all clips
    try:
        result = repo.table_query(
            "editai_clips", "select",
            filters=QueryFilters(
                select="id, final_video_path, editai_projects!inner(profile_id)",
                in_={"id": request.clip_ids},
            )
        )
        clips_by_id = {c["id"]: c for c in (result.data or [])}
    except Exception:
        clips_by_id = {}

    valid_clips = []
    for clip_id in request.clip_ids:
        clip_data = clips_by_id.get(clip_id)
        if not clip_data or not clip_data.get("final_video_path"):
            continue
        if clip_data["editai_projects"]["profile_id"] != profile.profile_id:
            continue
        video_path = Path(clip_data["final_video_path"])
        if not video_path.exists():
            video_path = settings.output_dir / clip_data["final_video_path"]
        if video_path.exists():
            valid_clips.append({"id": clip_id, "video_path": str(video_path)})

    if not valid_clips:
        raise HTTPException(status_code=400, detail="No valid rendered clips found")

    schedule_dt = None
    if request.schedule_date:
        try:
            schedule_dt = datetime.fromisoformat(request.schedule_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid schedule_date format")

    job_id = str(uuid.uuid4())

    background_tasks.add_task(
        _bulk_publish_task,
        job_id=job_id,
        profile_id=profile.profile_id,
        clips=valid_clips,
        caption=request.caption,
        captions=request.captions,
        channel_id=request.channel_id,
        schedule_start=schedule_dt,
        interval_minutes=request.schedule_interval_minutes,
        tiktok_title=request.tiktok_title,
    )

    return BufferPublishResponse(
        status="processing",
        job_id=job_id,
        message=f"Publishing {len(valid_clips)} clips via Buffer..."
    )


@router.get("/publish/{job_id}/progress")
async def get_publish_job_progress(
    job_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get progress of a Buffer publish job."""
    progress = get_progress(job_id)
    if not progress:
        return {"status": "not_found", "percentage": 0}
    result = dict(progress)
    if result.get("status") == "failed" and ("Error:" in result.get("step", "") or "Failed:" in result.get("step", "")):
        result["step"] = "Publishing failed. Check server logs for details."
    return result


@router.get("/posts/{post_id}/status")
async def get_post_status(
    post_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Check status of a Buffer post."""
    from app.services.buffer_service import get_buffer_publisher

    try:
        publisher = get_buffer_publisher(profile.profile_id)
        return await publisher.get_post_status(post_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Failed to get Buffer post status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get post status")


# ============== BACKGROUND TASKS ==============

async def _publish_clip_task(
    job_id: str,
    clip_id: str,
    profile_id: str,
    video_path: str,
    caption: str,
    channel_id: str,
    schedule_date: Optional[datetime],
    tiktok_title: Optional[str] = None,
):
    """Background task: upload to Supabase Storage → post via Buffer → cleanup."""
    from app.services.buffer_service import get_buffer_publisher

    logger.info(f"[Profile {profile_id}] Buffer publish clip {clip_id} (job {job_id})")
    update_progress(job_id, "Initializing...", 0)
    storage_path = None

    try:
        publisher = get_buffer_publisher(profile_id)

        # Step 1: Upload to Supabase Storage
        update_progress(job_id, "Uploading video...", 10)
        storage_path, public_url = await asyncio.to_thread(
            publisher.upload_to_storage, Path(video_path)
        )

        # Step 2: Create Buffer post (TikTok has 150 char limit)
        caption = smart_truncate(caption, 150)
        update_progress(job_id, "Creating Buffer post...", 50)
        result = await publisher.create_post(
            video_url=public_url,
            channel_id=channel_id,
            caption=caption,
            schedule_date=schedule_date,
            tiktok_title=tiktok_title,
        )

        if result.success:
            repo = get_repository()
            if repo:
                # Always update clip status (even if publication tracking fails)
                try:
                    repo.update_clip(clip_id, {
                        "postiz_status": "sent",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception as e:
                    logger.warning(f"Failed to update clip status: {e}")
                # Track publication (best-effort)
                try:
                    pub_status = "scheduled" if schedule_date else "published"
                    repo.table_query("editai_postiz_publications", "insert", data={
                        "clip_id": clip_id,
                        "profile_id": profile_id,
                        "postiz_post_id": f"buffer:{result.post_id}",
                        "platform": "tiktok (buffer)",
                        "caption": caption[:500],
                        "scheduled_at": schedule_date.isoformat() if schedule_date else None,
                        "published_at": None if schedule_date else datetime.now(timezone.utc).isoformat(),
                        "status": pub_status,
                        "storage_path": storage_path,
                    })
                except Exception as e:
                    logger.warning(f"Failed to track Buffer publication: {e}")

            if result.post_id and storage_path:
                publisher.schedule_cleanup_monitor(
                    post_id=result.post_id,
                    storage_path=storage_path,
                )

            # Cleanup is handled by the server-side cron job (minio-cleanup.sh)
            # which deletes videos 20 min after scheduled_at. No eager deletion —
            # Buffer needs time to download the video asynchronously.

            msg = f"Scheduled for {schedule_date.strftime('%Y-%m-%d %H:%M')}" if schedule_date else "Published!"
            update_progress(job_id, msg, 100, "completed")
        else:
            # Cleanup storage on failure
            if storage_path:
                publisher.delete_from_storage(storage_path)
            update_progress(job_id, f"Failed: {result.error}", 100, "failed")

    except Exception as e:
        logger.error(f"Buffer publish job {job_id} failed: {e}")
        # Cleanup storage on error
        if storage_path:
            try:
                from app.services.buffer_service import get_buffer_publisher
                pub = get_buffer_publisher(profile_id)
                pub.delete_from_storage(storage_path)
            except Exception:
                pass
        update_progress(job_id, f"Error: {str(e)}", 100, "failed")


async def _bulk_publish_task(
    job_id: str,
    profile_id: str,
    clips: List[dict],
    caption: str,
    captions: Optional[Dict[str, str]],
    channel_id: str,
    schedule_start: Optional[datetime],
    interval_minutes: int,
    tiktok_title: Optional[str] = None,
):
    """Background task: bulk publish multiple clips via Buffer."""
    from app.services.buffer_service import get_buffer_publisher

    logger.info(f"[Profile {profile_id}] Buffer bulk publish {len(clips)} clips (job {job_id})")
    update_progress(job_id, "Starting bulk publish...", 0)

    try:
        publisher = get_buffer_publisher(profile_id)
        repo = get_repository()
        logger.info(f"[Job {job_id}] Publisher ready, processing {len(clips)} clips, schedule_start={schedule_start}")
        total = len(clips)
        successful = 0
        failed = 0

        for idx, clip in enumerate(clips):
            storage_path = None
            progress_pct = int(((idx + 0.5) / total) * 100)
            update_progress(job_id, f"Publishing clip {idx + 1}/{total}...", progress_pct)

            try:
                # Upload to storage
                storage_path, public_url = await asyncio.to_thread(
                    publisher.upload_to_storage, Path(clip["video_path"])
                )

                # Calculate schedule time
                clip_schedule = None
                if schedule_start:
                    clip_schedule = schedule_start + timedelta(minutes=idx * interval_minutes)

                clip_caption = (captions or {}).get(clip["id"], caption)
                # Fallback: fetch caption from DB if frontend didn't supply one
                if not clip_caption and repo:
                    try:
                        content_row = repo.table_query(
                            "editai_clip_content", "select",
                            filters=QueryFilters(
                                select="tts_text, srt_content",
                                eq={"clip_id": clip["id"]}, limit=1,
                            )
                        )
                        if content_row.data:
                            row = content_row.data[0]
                            raw = row.get("tts_text") or row.get("srt_content") or ""
                            # Collapse newlines into flowing text — tts_text has \n\n between sentences
                            clip_caption = re.sub(r'\s+', ' ', raw).strip()
                            if clip_caption:
                                logger.info(f"[Job {job_id}] Resolved caption from DB for clip {clip['id']} (len={len(clip_caption)})")
                    except Exception as e:
                        logger.warning(f"[Job {job_id}] Failed to fetch caption from DB for clip {clip['id']}: {e}")
                # TikTok via Buffer has 150 char limit
                clip_caption = smart_truncate(clip_caption or "", 150)
                logger.info(f"[Job {job_id}] Calling create_post: url={public_url[:60]}..., schedule={clip_schedule}, caption_len={len(clip_caption or '')}")

                result = await publisher.create_post(
                    video_url=public_url,
                    channel_id=channel_id,
                    caption=clip_caption,
                    schedule_date=clip_schedule,
                    tiktok_title=tiktok_title,
                )
                logger.info(f"[Job {job_id}] create_post result: success={result.success}, post_id={result.post_id}, status={result.status}, error={result.error}")

                if result.success:
                    successful += 1
                    if repo:
                        # Always update clip status (even if publication tracking fails)
                        try:
                            repo.update_clip(clip["id"], {
                                "postiz_status": "sent",
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            })
                        except Exception as e:
                            logger.warning(f"Failed to update clip status for {clip['id']}: {e}")
                        # Track publication (best-effort)
                        try:
                            pub_status = "scheduled" if clip_schedule else "published"
                            repo.table_query("editai_postiz_publications", "insert", data={
                                "clip_id": clip["id"],
                                "profile_id": profile_id,
                                "postiz_post_id": f"buffer:{result.post_id}",
                                "platform": "tiktok (buffer)",
                                "caption": (clip_caption or "")[:500],
                                "scheduled_at": clip_schedule.isoformat() if clip_schedule else None,
                                "published_at": None if clip_schedule else datetime.now(timezone.utc).isoformat(),
                                "status": pub_status,
                                "storage_path": storage_path,
                            })
                        except Exception as e:
                            logger.warning(f"Failed to track Buffer publication for clip {clip['id']}: {e}")

                    if result.post_id and storage_path:
                        publisher.schedule_cleanup_monitor(
                            post_id=result.post_id,
                            storage_path=storage_path,
                        )

                    # Cleanup handled by server-side cron (minio-cleanup.sh)
                else:
                    failed += 1
                    if storage_path:
                        publisher.delete_from_storage(storage_path)

            except Exception as e:
                import traceback
                logger.error(f"Failed to publish clip {clip['id']} via Buffer: {e}\n{traceback.format_exc()}")
                failed += 1
                if storage_path:
                    try:
                        publisher.delete_from_storage(storage_path)
                    except Exception:
                        pass

        status = "completed" if failed == 0 else "completed_with_errors"
        update_progress(
            job_id,
            f"Done: {successful} published, {failed} failed",
            100,
            status,
        )

    except Exception as e:
        logger.error(f"Buffer bulk publish job {job_id} failed: {e}")
        update_progress(job_id, f"Error: {str(e)}", 100, "failed")
