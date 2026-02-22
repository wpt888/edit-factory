"""
Postiz Social Media Publishing Routes.
Handles video publishing to social media via Postiz API.
"""
import uuid
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/postiz", tags=["postiz"])


# ============== PYDANTIC MODELS ==============

class PostizIntegrationResponse(BaseModel):
    id: str
    name: str
    type: str
    identifier: Optional[str] = None
    picture: Optional[str] = None
    disabled: bool = False


class UploadRequest(BaseModel):
    clip_id: str
    video_path: str


class BulkUploadRequest(BaseModel):
    clips: List[dict]  # List of {clip_id: str, video_path: str}


class PublishRequest(BaseModel):
    clip_id: str
    caption: str
    integration_ids: List[str]
    schedule_date: Optional[str] = None  # ISO format datetime


class BulkPublishRequest(BaseModel):
    clip_ids: List[str]
    caption: str
    integration_ids: List[str]
    schedule_date: Optional[str] = None
    schedule_interval_minutes: int = 30  # Interval between posts for bulk


class PublishResponse(BaseModel):
    status: str
    job_id: Optional[str] = None
    message: str
    post_id: Optional[str] = None


class PostizStatusResponse(BaseModel):
    configured: bool
    connected: bool
    api_url: Optional[str] = None
    integrations_count: int = 0
    error: Optional[str] = None


# ============== PROGRESS TRACKING ==============
_publish_progress: Dict[str, dict] = {}


def update_publish_progress(job_id: str, step: str, percentage: int, status: str = "in_progress"):
    """Update progress for a publish job."""
    _publish_progress[job_id] = {
        "step": step,
        "percentage": percentage,
        "status": status,
        "updated_at": datetime.now().isoformat()
    }


def get_publish_progress(job_id: str) -> Optional[dict]:
    """Get progress for a publish job."""
    return _publish_progress.get(job_id)


# ============== HELPER FUNCTIONS ==============

# ============== ENDPOINTS ==============

@router.get("/status", response_model=PostizStatusResponse)
async def get_postiz_status(
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Check Postiz API connectivity and configuration.
    Returns connection status and available integrations count.
    Uses profile-specific Postiz credentials if configured.
    """
    logger.info(f"[Profile {profile.profile_id}] Checking Postiz status")

    result = PostizStatusResponse(
        configured=False,
        connected=False,
        api_url=None,
        integrations_count=0,
        error=None
    )

    try:
        from app.services.postiz_service import get_postiz_publisher, is_postiz_configured

        # Check if Postiz is configured for this profile (or globally)
        if not is_postiz_configured(profile.profile_id):
            result.error = "Postiz API credentials not configured for this profile"
            return result

        result.configured = True

        # Try to get publisher and connect
        publisher = get_postiz_publisher(profile.profile_id)
        result.api_url = publisher.api_url
        integrations = await publisher.get_integrations(profile_id=profile.profile_id)

        result.connected = True
        result.integrations_count = len(integrations)

    except ValueError as e:
        # No credentials configured
        result.error = str(e)
        logger.warning(f"[Profile {profile.profile_id}] Postiz not configured: {e}")
    except Exception as e:
        result.error = str(e)
        logger.error(f"[Profile {profile.profile_id}] Failed to connect to Postiz: {e}")

    return result


@router.get("/integrations", response_model=List[PostizIntegrationResponse])
async def get_integrations(
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Get all connected social media accounts from Postiz.
    Returns list of platforms user can publish to.
    Uses profile-specific Postiz credentials.
    """
    logger.info(f"[Profile {profile.profile_id}] Fetching Postiz integrations")

    try:
        from app.services.postiz_service import get_postiz_publisher
        publisher = get_postiz_publisher(profile.profile_id)
        integrations = await publisher.get_integrations(profile_id=profile.profile_id)

        # Filter out disabled integrations
        active = [i for i in integrations if not i.disabled]

        return [PostizIntegrationResponse(
            id=i.id,
            name=i.name,
            type=i.type,
            identifier=i.identifier,
            picture=i.picture,
            disabled=i.disabled
        ) for i in active]

    except ValueError as e:
        logger.warning(f"[Profile {profile.profile_id}] Postiz not configured: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Failed to get integrations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_to_postiz(
    request: UploadRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Upload a video directly to Postiz library without creating a post.
    Just uploads the file - scheduling/posting is done in n8n.
    Uses profile-specific Postiz credentials.
    """
    logger.info(f"[Profile {profile.profile_id}] Uploading clip {request.clip_id} to Postiz")
    settings = get_settings()

    # Resolve video path
    video_path = Path(request.video_path)
    if not video_path.exists():
        # Try with output directory prefix
        video_path = settings.output_dir / request.video_path
        if not video_path.exists():
            # Try base directory
            video_path = settings.base_dir / request.video_path
            if not video_path.exists():
                raise HTTPException(status_code=404, detail=f"Video file not found: {request.video_path}")

    try:
        from app.services.postiz_service import get_postiz_publisher
        publisher = get_postiz_publisher(profile.profile_id)

        # Just upload the video to Postiz library
        logger.info(f"[Profile {profile.profile_id}] Uploading video to Postiz: {video_path}")
        media = await publisher.upload_video(video_path, profile_id=profile.profile_id)

        # Update clip status in database
        supabase = get_supabase()
        if supabase:
            try:
                supabase.table("editai_clips").update({
                    "postiz_status": "sent",
                    "updated_at": datetime.now().isoformat()
                }).eq("id", request.clip_id).execute()
            except Exception as e:
                logger.warning(f"Failed to update clip status: {e}")

        logger.info(f"[Profile {profile.profile_id}] Video uploaded to Postiz successfully: media_id={media.id}")
        return {
            "status": "success",
            "media_id": media.id,
            "media_path": media.path,
            "message": "Video uploaded to Postiz library"
        }

    except ValueError as e:
        logger.warning(f"[Profile {profile.profile_id}] Postiz not configured: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Failed to upload to Postiz: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bulk-upload")
async def bulk_upload_to_postiz(
    request: BulkUploadRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Upload multiple videos to Postiz library without creating posts.
    Just uploads the files - scheduling/posting is done separately.
    Uses profile-specific Postiz credentials.
    """
    logger.info(f"[Profile {profile.profile_id}] Bulk uploading {len(request.clips)} clips to Postiz")
    settings = get_settings()

    if not request.clips:
        raise HTTPException(status_code=400, detail="No clips provided")

    try:
        from app.services.postiz_service import get_postiz_publisher
        publisher = get_postiz_publisher(profile.profile_id)
    except ValueError as e:
        logger.warning(f"[Profile {profile.profile_id}] Postiz not configured: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    uploaded = []
    failed = []
    supabase = get_supabase()

    for clip_info in request.clips:
        clip_id = clip_info.get("clip_id")
        video_path_str = clip_info.get("video_path")

        if not clip_id or not video_path_str:
            failed.append({"clip_id": clip_id, "error": "Missing clip_id or video_path"})
            continue

        # Resolve video path
        video_path = Path(video_path_str)
        if not video_path.exists():
            video_path = settings.output_dir / video_path_str
            if not video_path.exists():
                video_path = settings.base_dir / video_path_str
                if not video_path.exists():
                    failed.append({"clip_id": clip_id, "error": f"Video file not found: {video_path_str}"})
                    continue

        try:
            logger.info(f"Bulk upload: uploading {video_path} to Postiz")
            media = await publisher.upload_video(video_path, profile_id=profile.profile_id)

            # Update clip status in database
            if supabase:
                try:
                    supabase.table("editai_clips").update({
                        "postiz_status": "sent",
                        "updated_at": datetime.now().isoformat()
                    }).eq("id", clip_id).execute()
                except Exception as e:
                    logger.warning(f"Failed to update clip {clip_id} status: {e}")

            uploaded.append({
                "clip_id": clip_id,
                "media_id": media.id,
                "media_path": media.path
            })
            logger.info(f"Bulk upload: successfully uploaded clip {clip_id}")

        except Exception as e:
            logger.error(f"Failed to upload clip {clip_id} to Postiz: {e}")
            failed.append({"clip_id": clip_id, "error": str(e)})

    return {
        "status": "completed",
        "uploaded_count": len(uploaded),
        "uploaded": uploaded,
        "failed_count": len(failed),
        "failed": failed
    }


@router.post("/publish", response_model=PublishResponse)
async def publish_clip(
    background_tasks: BackgroundTasks,
    request: PublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Publish a rendered clip to selected social media platforms.

    Requirements:
    - Clip must have final_video_path (must be rendered)
    - At least one integration must be selected

    Returns job_id for progress tracking.
    """
    logger.info(f"[Profile {profile.profile_id}] Publishing clip {request.clip_id} to {len(request.integration_ids)} platforms")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify clip exists, has final_video_path, and belongs to profile (via project)
    try:
        result = supabase.table("editai_clips")\
            .select("*, editai_projects!inner(profile_id)")\
            .eq("id", request.clip_id)\
            .single()\
            .execute()
    except Exception:
        raise HTTPException(status_code=404, detail="Clip not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip = result.data

    # Verify ownership
    if clip["editai_projects"]["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    if not clip.get("final_video_path"):
        raise HTTPException(
            status_code=400,
            detail="Clip must be rendered before publishing. No final_video_path found."
        )

    video_path = Path(clip["final_video_path"])
    if not video_path.exists():
        # Try with output directory prefix
        settings = get_settings()
        video_path = settings.output_dir / clip["final_video_path"]
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")

    if not request.integration_ids:
        raise HTTPException(status_code=400, detail="At least one platform must be selected")

    # Create job for tracking
    job_id = uuid.uuid4().hex[:12]

    # Parse schedule date if provided
    schedule_dt = None
    if request.schedule_date:
        try:
            schedule_dt = datetime.fromisoformat(request.schedule_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid schedule_date format. Use ISO format.")

    # Launch background task
    background_tasks.add_task(
        _publish_clip_task,
        job_id=job_id,
        clip_id=request.clip_id,
        profile_id=profile.profile_id,
        video_path=str(video_path),
        caption=request.caption,
        integration_ids=request.integration_ids,
        schedule_date=schedule_dt
    )

    return PublishResponse(
        status="processing",
        job_id=job_id,
        message=f"Publishing to {len(request.integration_ids)} platform(s)..."
    )


@router.post("/bulk-publish", response_model=PublishResponse)
async def bulk_publish_clips(
    background_tasks: BackgroundTasks,
    request: BulkPublishRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Publish multiple clips to selected platforms.

    If schedule_date is provided, posts will be scheduled at intervals
    (schedule_interval_minutes apart) starting from schedule_date.
    """
    logger.info(f"[Profile {profile.profile_id}] Bulk publishing {len(request.clip_ids)} clips")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    settings = get_settings()

    # Verify all clips exist, have final_video_path, and belong to profile
    valid_clips = []
    for clip_id in request.clip_ids:
        try:
            result = supabase.table("editai_clips")\
                .select("*, editai_projects!inner(profile_id)")\
                .eq("id", clip_id)\
                .single()\
                .execute()
        except Exception:
            continue
        if result.data and result.data.get("final_video_path"):
            # Verify ownership
            if result.data["editai_projects"]["profile_id"] != profile.profile_id:
                continue
            video_path = Path(result.data["final_video_path"])
            if not video_path.exists():
                video_path = settings.output_dir / result.data["final_video_path"]
            if video_path.exists():
                valid_clips.append({
                    "id": clip_id,
                    "video_path": str(video_path)
                })

    if not valid_clips:
        raise HTTPException(
            status_code=400,
            detail="No valid clips found. Clips must be rendered before publishing."
        )

    job_id = uuid.uuid4().hex[:12]

    # Parse schedule date
    schedule_dt = None
    if request.schedule_date:
        try:
            schedule_dt = datetime.fromisoformat(request.schedule_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid schedule_date format")

    background_tasks.add_task(
        _bulk_publish_task,
        job_id=job_id,
        profile_id=profile.profile_id,
        clips=valid_clips,
        caption=request.caption,
        integration_ids=request.integration_ids,
        schedule_start=schedule_dt,
        interval_minutes=request.schedule_interval_minutes
    )

    return PublishResponse(
        status="processing",
        job_id=job_id,
        message=f"Publishing {len(valid_clips)} clips to {len(request.integration_ids)} platform(s)..."
    )


@router.get("/publish/{job_id}/progress")
async def get_publish_job_progress(job_id: str):
    """Get progress of a publish job."""
    progress = get_publish_progress(job_id)
    if not progress:
        return {"status": "not_found", "percentage": 0}
    return progress


# ============== BACKGROUND TASKS ==============

async def _publish_clip_task(
    job_id: str,
    clip_id: str,
    profile_id: str,
    video_path: str,
    caption: str,
    integration_ids: List[str],
    schedule_date: Optional[datetime]
):
    """Background task to publish a single clip using profile-specific Postiz."""
    from app.services.postiz_service import get_postiz_publisher

    logger.info(f"[Profile {profile_id}] Publishing clip {clip_id} (job {job_id})")
    update_publish_progress(job_id, "Initializing...", 0)

    try:
        publisher = get_postiz_publisher(profile_id)

        # Get integrations info for platform-specific settings
        update_publish_progress(job_id, "Fetching platform info...", 10)
        integrations = await publisher.get_integrations(profile_id=profile_id)
        integrations_info = {i.id: i.type for i in integrations}

        # Upload video
        update_publish_progress(job_id, "Uploading video to Postiz...", 20)
        media = await publisher.upload_video(Path(video_path), profile_id=profile_id)

        update_publish_progress(job_id, "Creating post...", 70)

        # Create post
        result = await publisher.create_post(
            media_id=media.id,
            media_path=media.path,
            caption=caption,
            integration_ids=integration_ids,
            schedule_date=schedule_date,
            integrations_info=integrations_info,
            profile_id=profile_id
        )

        if result.success:
            # Track in database (optional)
            supabase = get_supabase()
            if supabase:
                try:
                    supabase.table("editai_postiz_publications").insert({
                        "clip_id": clip_id,
                        "postiz_post_id": result.post_id,
                        "platforms": result.platforms or [],
                        "caption": caption[:500],  # Truncate for storage
                        "scheduled_at": schedule_date.isoformat() if schedule_date else None,
                        "published_at": None if schedule_date else datetime.now().isoformat(),
                        "status": "scheduled" if schedule_date else "published"
                    }).execute()
                except Exception as e:
                    logger.warning(f"Failed to track publication (table may not exist): {e}")

            update_publish_progress(
                job_id,
                "Published successfully!" if not schedule_date else f"Scheduled for {schedule_date.strftime('%Y-%m-%d %H:%M')}",
                100,
                "completed"
            )
        else:
            update_publish_progress(job_id, f"Failed: {result.error}", 100, "failed")

    except Exception as e:
        logger.error(f"Publish job {job_id} failed: {e}")
        update_publish_progress(job_id, f"Error: {str(e)}", 100, "failed")


async def _bulk_publish_task(
    job_id: str,
    profile_id: str,
    clips: List[dict],
    caption: str,
    integration_ids: List[str],
    schedule_start: Optional[datetime],
    interval_minutes: int
):
    """Background task to publish multiple clips using profile-specific Postiz."""
    from app.services.postiz_service import get_postiz_publisher

    logger.info(f"[Profile {profile_id}] Bulk publishing {len(clips)} clips (job {job_id})")
    update_publish_progress(job_id, "Starting bulk publish...", 0)

    try:
        publisher = get_postiz_publisher(profile_id)

        # Get integrations info
        integrations = await publisher.get_integrations(profile_id=profile_id)
        integrations_info = {i.id: i.type for i in integrations}

        total = len(clips)
        successful = 0
        failed = 0

        for idx, clip in enumerate(clips):
            progress_pct = int(((idx + 0.5) / total) * 100)
            update_publish_progress(
                job_id,
                f"Publishing clip {idx + 1}/{total}...",
                progress_pct
            )

            try:
                # Upload video
                media = await publisher.upload_video(Path(clip["video_path"]), profile_id=profile_id)

                # Calculate schedule time for this clip
                clip_schedule = None
                if schedule_start:
                    clip_schedule = schedule_start + timedelta(minutes=idx * interval_minutes)

                # Create post
                result = await publisher.create_post(
                    media_id=media.id,
                    media_path=media.path,
                    caption=caption,
                    integration_ids=integration_ids,
                    schedule_date=clip_schedule,
                    integrations_info=integrations_info,
                    profile_id=profile_id
                )

                if result.success:
                    successful += 1
                else:
                    failed += 1
                    logger.error(f"Failed to publish clip {clip['id']}: {result.error}")

            except Exception as e:
                logger.error(f"Failed to publish clip {clip['id']}: {e}")
                failed += 1

        status = "completed" if failed == 0 else "completed_with_errors"
        update_publish_progress(
            job_id,
            f"Completed: {successful} published, {failed} failed",
            100,
            status
        )

    except Exception as e:
        logger.error(f"Bulk publish job {job_id} failed: {e}")
        update_publish_progress(job_id, f"Error: {str(e)}", 100, "failed")
