"""
Edit Factory - API Routes
"""
import asyncio
import uuid
import shutil
import subprocess
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.config import get_settings, APP_VERSION
from app.services.file_storage import get_file_storage
from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import (
    validate_upload_size, validate_tts_text_length,
    validate_file_mime_type, ALLOWED_VIDEO_MIMES, ALLOWED_AUDIO_MIMES, ALLOWED_SUBTITLE_MIMES,
)
from app.rate_limit import limiter
from app.utils import sanitize_filename as _sanitize_filename
from app.services.ffmpeg_semaphore import safe_ffmpeg_run
from app.models import (
    JobStatus, JobResponse, HealthResponse, VideoInfo, VideoSegment
)
from app.services.video_processor import VideoProcessorService

import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Job storage - unified Supabase storage (with in-memory fallback)
from app.services.job_storage import get_job_storage

# All jobs now use get_job_storage() for persistent storage
# This provides: Supabase persistence, automatic fallback to memory if unavailable


def get_processor(profile_id: Optional[str] = "default") -> VideoProcessorService:
    """
    Get video processor service instance.

    Args:
        profile_id: Profile ID for temp directory scoping. Defaults to "default" for backward compatibility.
    """
    settings = get_settings()
    # Profile-scoped temp directory to prevent cross-profile file collisions
    temp_dir = settings.base_dir / "temp" / profile_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    return VideoProcessorService(
        input_dir=settings.input_dir,
        output_dir=settings.output_dir,
        temp_dir=temp_dir,
        profile_id=profile_id
    )


@router.get("/costs")
async def get_costs(
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Get logged API costs from all operations.
    Returns totals, today's costs, and last 10 entries.
    """
    from app.services.cost_tracker import get_cost_tracker

    tracker = get_cost_tracker()
    logger.info(f"[Profile {profile.profile_id}] Fetching cost summary")
    return tracker.get_summary(profile_id=profile.profile_id)


@router.get("/costs/all")
async def get_all_costs(
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Get all cost entries for the current profile.
    Used by the usage page to display the full cost log.
    Returns {"entries": [...]} with all cost records.
    """
    from app.services.cost_tracker import get_cost_tracker
    from app.db import get_supabase

    tracker = get_cost_tracker()
    supabase = get_supabase()

    if supabase:
        try:
            query = supabase.table("api_costs")\
                .select("*")\
                .eq("profile_id", profile.profile_id)\
                .order("created_at", desc=True)\
                .limit(500)
            result = query.execute()
            return {"entries": result.data or [], "source": "supabase"}
        except Exception as e:
            logger.warning(f"Failed to fetch all costs from Supabase: {e}")

    # Fallback to local log
    summary = tracker.get_summary(profile_id=profile.profile_id)
    return {"entries": summary.get("last_entries", []), "source": "local"}


@router.get("/usage")
async def get_usage_stats(
    profile: ProfileContext = Depends(get_profile_context),
):
    """
    Get usage statistics from all ElevenLabs accounts and Gemini.
    Uses ElevenLabsAccountManager to show all configured accounts.
    """
    from app.services.elevenlabs_account_manager import get_account_manager

    settings = get_settings()
    manager = get_account_manager()
    result = {
        "elevenlabs": None,
        "elevenlabs_accounts": [],
        "gemini": None,
        "errors": [],
    }

    # ElevenLabs Usage — fetch from all accounts via account manager
    try:
        accounts = manager.list_accounts(profile.profile_id)
        all_accounts = []
        primary_account = None

        for acc in accounts:
            chars_used = acc.get("characters_used") or 0
            chars_limit = acc.get("character_limit") or 0
            chars_remaining = chars_limit - chars_used
            usage_pct = round((chars_used / chars_limit * 100), 1) if chars_limit > 0 else 0
            estimated_cost = round(chars_used * 0.00022, 2)

            entry = {
                "id": acc.get("id"),
                "label": acc.get("label", "Unknown"),
                "api_key_hint": acc.get("api_key_hint", ""),
                "is_primary": acc.get("is_primary", False),
                "is_active": acc.get("is_active", True),
                "is_env_default": acc.get("is_env_default", False),
                "tier": acc.get("tier") or "unknown",
                "characters_used": chars_used,
                "characters_limit": chars_limit,
                "characters_remaining": chars_remaining,
                "usage_percent": usage_pct,
                "estimated_cost_usd": estimated_cost,
                "last_error": acc.get("last_error"),
            }
            all_accounts.append(entry)

            if acc.get("is_primary"):
                primary_account = entry

        result["elevenlabs_accounts"] = all_accounts

        # Keep backward-compat: elevenlabs = primary account data
        if primary_account:
            result["elevenlabs"] = primary_account
        elif all_accounts:
            result["elevenlabs"] = all_accounts[0]

    except Exception as e:
        result["errors"].append(f"ElevenLabs error: {str(e)}")

    if not result["elevenlabs"] and not result["elevenlabs_accounts"]:
        result["errors"].append("No ElevenLabs API keys configured")

    # Gemini
    if settings.gemini_api_key:
        result["gemini"] = {
            "configured": True,
            "model": settings.gemini_model,
            "note": "Gemini usage tracking requires Google Cloud Console billing reports",
            "estimated_cost_per_video": 1.20,
        }
    else:
        result["errors"].append("Gemini API key not configured")

    return result


@router.get("/gemini/status")
async def get_gemini_status():
    """
    Test Gemini API connectivity and return status.
    Returns connection status, model info, and link to check balance.
    """
    settings = get_settings()
    result = {
        "configured": False,
        "connected": False,
        "model": None,
        "error": None,
        "balance_url": "https://aistudio.google.com/apikey",
        "billing_url": "https://console.cloud.google.com/billing"
    }

    if not settings.gemini_api_key:
        result["error"] = "Gemini API key not configured"
        return result

    result["configured"] = True
    result["model"] = settings.gemini_model

    # Test connection with a simple request
    try:
        from google import genai

        client = genai.Client(api_key=settings.gemini_api_key)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents="Say OK"
        )

        if response and response.text:
            result["connected"] = True
            result["test_response"] = response.text.strip()[:50]  # Limit response
        else:
            result["error"] = "Empty response from Gemini"

    except Exception as e:
        error_str = str(e)
        logger.warning(f"Gemini connection test failed: {error_str}")

        # Scrub internal details — only return safe, classified error messages
        if "quota" in error_str.lower():
            result["error"] = "Quota exceeded - check billing"
        elif "invalid" in error_str.lower() and "key" in error_str.lower():
            result["error"] = "Invalid API key"
        elif "billing" in error_str.lower():
            result["error"] = "Billing not enabled"
        else:
            result["error"] = "Connection failed — check API key and network"

    return result


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Check health of all dependencies."""
    # Check FFmpeg
    ffmpeg_ok = False
    try:
        result = await asyncio.to_thread(subprocess.run, ["ffmpeg", "-version"], capture_output=True, timeout=5)
        ffmpeg_ok = result.returncode == 0
    except Exception:
        pass

    # Check Supabase connectivity
    supabase_ok = False
    try:
        from app.db import get_supabase
        supabase = get_supabase()
        if supabase:
            # Lightweight query: count with limit 0 — no data transfer
            await asyncio.to_thread(
                lambda: supabase.table("editai_projects").select("id", count="exact").limit(0).execute()
            )
            supabase_ok = True  # If we got here without exception, DB is reachable
    except Exception:
        pass

    # Check Redis (optional — Redis being down does NOT degrade overall status)
    redis_ok = False
    try:
        import redis
        settings = get_settings()
        r = redis.from_url(settings.redis_url)
        try:
            r.ping()
            redis_ok = True
        finally:
            r.close()
    except Exception:
        pass

    # Determine overall status
    # "ok"       = Supabase AND FFmpeg are up (Redis is optional)
    # "degraded" = one of Supabase/FFmpeg is down
    # "unhealthy" = both Supabase AND FFmpeg are down
    if supabase_ok and ffmpeg_ok:
        overall = "ok"
    elif not supabase_ok and not ffmpeg_ok:
        overall = "unhealthy"
    else:
        overall = "degraded"

    return HealthResponse(
        status=overall,
        version=APP_VERSION,
        ffmpeg_available=ffmpeg_ok,
        redis_available=redis_ok,
        supabase_status="ok" if supabase_ok else "unavailable",
        ffmpeg_status="ok" if ffmpeg_ok else "unavailable",
        redis_status="ok" if redis_ok else "unavailable",
    )


@router.post("/video-info")
@limiter.limit("10/minute")
async def get_video_info(request: Request, video: UploadFile = File(...)):
    """
    Obtine informatii despre video (rezolutie, durata, fps).
    Folosit pentru preview-ul subtitrarii.
    """
    # Validate MIME type before processing (blocks disguised malicious files)
    await validate_file_mime_type(video, ALLOWED_VIDEO_MIMES, "video")

    settings = get_settings()

    temp_video = settings.input_dir / f"info_{uuid.uuid4().hex[:8]}_{_sanitize_filename(video.filename)}"

    try:
        with open(temp_video, "wb") as f:
            shutil.copyfileobj(video.file, f)

        # Folosim ffprobe pentru informatii rapide (inclusiv rotation din side_data)
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration,r_frame_rate:stream_side_data=rotation:stream_tags=rotate",
            "-show_entries", "format=duration",
            "-of", "json",
            str(temp_video)
        ]

        result = await asyncio.to_thread(safe_ffmpeg_run, probe_cmd, 30, "ffprobe-analyze")

        if result.returncode != 0:
            raise HTTPException(status_code=400, detail="Could not analyze video")

        import json as json_lib
        data = json_lib.loads(result.stdout)

        stream = data.get("streams", [{}])[0]
        format_info = data.get("format", {})

        width = stream.get("width", 1920)
        height = stream.get("height", 1080)

        # Verificam rotatia din side_data sau tags
        rotation = 0
        side_data_list = stream.get("side_data_list", [])
        for side_data in side_data_list:
            if "rotation" in side_data:
                rotation = abs(int(side_data.get("rotation", 0)))
                break

        # Sau din tags
        if rotation == 0:
            tags = stream.get("tags", {})
            rotation = abs(int(tags.get("rotate", 0)))

        # Daca rotation e 90 sau 270, inversam width/height
        if rotation in [90, 270]:
            width, height = height, width
            logger.info(f"Video rotated {rotation}°, swapped dimensions to {width}x{height}")

        # Parse duration
        duration = float(format_info.get("duration", stream.get("duration", 0)))

        # Parse frame rate (poate fi "30/1" sau "29.97")
        fps_str = stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) > 0 else 30
        else:
            fps = float(fps_str)

        # Determinam aspect ratio
        if width > height:
            aspect_ratio = "landscape"
        elif height > width:
            aspect_ratio = "portrait"
        else:
            aspect_ratio = "square"

        return {
            "width": width,
            "height": height,
            "duration": duration,
            "fps": round(fps, 2),
            "aspect_ratio": aspect_ratio,
            "is_vertical": height > width
        }

    finally:
        temp_video.unlink(missing_ok=True)


@router.post("/jobs", response_model=JobResponse)
@limiter.limit("10/minute")
async def create_job(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    audio: Optional[UploadFile] = File(default=None),
    srt: Optional[UploadFile] = File(default=None),
    output_name: Optional[str] = Form(default=None),
    target_duration: float = Form(default=20.0),
    script_text: Optional[str] = Form(default=None),
    context_text: Optional[str] = Form(default=None),
    subtitle_settings: Optional[str] = Form(default=None),
    variant_count: int = Form(default=1),
    generate_audio: str = Form(default="true"),  # String to handle "true"/"false" from frontend
    mute_source_voice: str = Form(default="false"),  # Mute voice from source video (keep effects)
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Creeaza un job de procesare video.
    Procesarea ruleaza in background.

    Args:
        subtitle_settings: JSON string cu setari subtitrari (fontSize, fontFamily, textColor, etc.)
        variant_count: Numarul de variante video de generat (1-10)
        mute_source_voice: Daca sa muta vocea din video-ul sursa (pastreaza efectele sonore)
    """
    settings = get_settings()
    settings.ensure_dirs()

    job_id = uuid.uuid4().hex[:12]
    if not output_name:
        output_name = f"reel_{job_id}"

    # Reject oversized uploads before reading into memory (STAB-05)
    await validate_upload_size(video)
    # Validate actual MIME type via magic-number inspection (blocks disguised malicious files)
    await validate_file_mime_type(video, ALLOWED_VIDEO_MIMES, "video")

    # Salvam fisierele
    video_path = settings.input_dir / f"{job_id}_{_sanitize_filename(video.filename)}"
    with open(video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    audio_path = None
    if audio:
        await validate_upload_size(audio)
        await validate_file_mime_type(audio, ALLOWED_AUDIO_MIMES, "audio")
        audio_path = settings.input_dir / f"{job_id}_{_sanitize_filename(audio.filename)}"
        with open(audio_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

    srt_path = None
    if srt:
        await validate_file_mime_type(srt, ALLOWED_SUBTITLE_MIMES, "subtitle")
        srt_path = settings.input_dir / f"{job_id}_{_sanitize_filename(srt.filename)}"
        with open(srt_path, "wb") as f:
            shutil.copyfileobj(srt.file, f)

    # Parse subtitle settings din JSON
    parsed_subtitle_settings = None
    if subtitle_settings:
        try:
            parsed_subtitle_settings = json.loads(subtitle_settings)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid JSON in subtitle_settings: {str(e)}"
            )

    # Limitam variant_count la 1-10
    variant_count = max(1, min(10, variant_count))

    # Parse generate_audio string to boolean
    generate_audio_bool = generate_audio.lower() in ("true", "1", "yes", "on")

    # Parse mute_source_voice string to boolean
    mute_source_voice_bool = mute_source_voice.lower() in ("true", "1", "yes", "on")

    # Cream job-ul
    job = {
        "job_id": job_id,
        "profile_id": profile.profile_id,
        "status": JobStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": None,
        "progress": "Queued",
        "video_path": str(video_path),
        "audio_path": str(audio_path) if audio_path else None,
        "srt_path": str(srt_path) if srt_path else None,
        "output_name": output_name,
        "target_duration": target_duration,
        "script_text": script_text,
        "context_text": context_text,
        "subtitle_settings": parsed_subtitle_settings,
        "variant_count": variant_count,
        "generate_audio": generate_audio_bool,
        "mute_source_voice": mute_source_voice_bool,
        "result": None,
        "error": None
    }
    get_job_storage().create_job(job)

    # Lansam procesarea in background
    background_tasks.add_task(process_job, job_id)

    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=job["created_at"],
        progress="Queued for processing"
    )


async def process_job(job_id: str):
    """Proceseaza un job in background."""
    job = get_job_storage().get_job(job_id)
    if not job:
        return

    job["status"] = JobStatus.PROCESSING
    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    job["progress"] = "Starting..."
    # Persist PROCESSING status immediately so polling clients see correct state
    get_job_storage().update_job(job_id, {
        "status": job["status"],
        "progress": job["progress"],
        "updated_at": job["updated_at"]
    })

    def update_progress(step: str, status: str):
        job["progress"] = f"{step}: {status}"
        job["updated_at"] = datetime.now(timezone.utc).isoformat()
        get_job_storage().update_job(job_id, {
            "status": job["status"],
            "progress": job["progress"],
            "updated_at": job["updated_at"]
        })

    try:
        processor = get_processor(profile_id=job.get("profile_id", "default"))
        video_path = Path(job["video_path"])

        # Voice muting e acum integrat în process_video pentru mute selectiv per segment
        result = await asyncio.to_thread(
            processor.process_video,
            video_path=video_path,
            output_name=job["output_name"],
            target_duration=job["target_duration"],
            audio_path=Path(job["audio_path"]) if job["audio_path"] else None,
            srt_path=Path(job["srt_path"]) if job["srt_path"] else None,
            subtitle_settings=job.get("subtitle_settings"),
            variant_count=job.get("variant_count", 1),
            progress_callback=update_progress,
            context_text=job.get("context_text"),
            generate_audio=job.get("generate_audio", True),
            mute_source_voice=job.get("mute_source_voice", False)  # Mute selectiv în segmente
        )

        if result["status"] == "success":
            job["status"] = JobStatus.COMPLETED
            job["result"] = result
            job["progress"] = "Completed successfully"

            # Stergem fisierele din input dupa procesare reusita
            _cleanup_input_files(job)
        else:
            job["status"] = JobStatus.FAILED
            job["error"] = result.get("error", "Unknown error")
            job["progress"] = "Failed"
            # Clean up input files even on failure to prevent disk leaks
            _cleanup_input_files(job)

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        job["status"] = JobStatus.FAILED
        job["error"] = str(e)
        job["progress"] = f"Failed: {e}"
        # Clean up input files even on exception to prevent disk leaks
        _cleanup_input_files(job)

    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Persist final job state to storage
    get_job_storage().update_job(job_id, job)


def _cleanup_input_files(job: dict):
    """Sterge fisierele input dupa procesare reusita."""
    for key in ["video_path", "audio_path", "srt_path"]:
        if job.get(key):
            try:
                Path(job[key]).unlink(missing_ok=True)
                logger.info(f"Deleted input file: {job[key]}")
            except Exception as e:
                logger.warning(f"Failed to delete {job[key]}: {e}")


@router.get("/jobs/{job_id}/stream")
async def stream_job_progress(job_id: str, request: Request):
    """Stream job progress via Server-Sent Events.

    No auth required — job IDs are UUIDs (unguessable) and the endpoint is read-only.
    EventSource browsers cannot send custom headers, so auth is done via the regular
    GET /jobs/{job_id} endpoint for programmatic access.
    """
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        import time as _time
        stream_start = _time.monotonic()
        max_stream_duration = 600  # 10 minutes

        last_progress = None
        last_status = None
        heartbeat_counter = 0

        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            # Timeout after max duration to prevent stuck SSE streams
            if _time.monotonic() - stream_start > max_stream_duration:
                yield f"event: timeout\ndata: {json.dumps({'job_id': job_id, 'error': 'Stream timed out'})}\n\n"
                break

            current_job = get_job_storage().get_job(job_id)
            if not current_job:
                yield f"event: failed\ndata: {json.dumps({'job_id': job_id, 'error': 'Job not found'})}\n\n"
                break

            current_progress = current_job.get("progress")
            current_status = current_job.get("status")

            # Only send event when something changed
            if current_progress != last_progress or current_status != last_status:
                last_progress = current_progress
                last_status = current_status

                if current_status == "completed":
                    # Build result payload
                    result_data = current_job.get("result")
                    # For assembly jobs, include final_video_path
                    if current_job.get("job_type") == "assembly" and current_job.get("final_video_path"):
                        result_data = {"final_video_path": current_job["final_video_path"]}
                    payload = {
                        "job_id": job_id,
                        "status": "completed",
                        "progress": "100",
                        "result": result_data,
                    }
                    yield f"event: completed\ndata: {json.dumps(payload)}\n\n"
                    break

                elif current_status == "failed":
                    payload = {
                        "job_id": job_id,
                        "status": "failed",
                        "error": current_job.get("error", "Unknown error"),
                    }
                    yield f"event: failed\ndata: {json.dumps(payload)}\n\n"
                    break

                else:
                    payload = {
                        "job_id": job_id,
                        "status": current_status,
                        "progress": current_progress or "",
                    }
                    yield f"event: progress\ndata: {json.dumps(payload)}\n\n"

            # Heartbeat every 15 seconds to keep connection alive
            heartbeat_counter += 1
            if heartbeat_counter >= 15:
                heartbeat_counter = 0
                yield f"event: heartbeat\ndata: {json.dumps({'ts': int(asyncio.get_running_loop().time())})}\n\n"

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering if behind proxy
        },
    )


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Obtine statusul unui job."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Job not found")

    response = JobResponse(
        job_id=job["job_id"],
        status=job["status"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        progress=job["progress"],
        error=job.get("error")
    )

    # Assembly-specific fields
    if job.get("job_type") == "assembly":
        response.progress = job.get("current_step", job.get("progress", ""))
        if job.get("final_video_path"):
            response.result = {"final_video_path": job["final_video_path"]}
    elif job.get("result"):
        response.result = job["result"]
        if "video_info" in job["result"]:
            response.video_info = VideoInfo(**job["result"]["video_info"])
        if "segments" in job["result"]:
            response.segments = [VideoSegment(**s) for s in job["result"]["segments"]]

    return response


@router.get("/jobs")
async def list_jobs(profile: ProfileContext = Depends(get_profile_context)):
    """Lista toate job-urile pentru profilul curent."""
    all_jobs = get_job_storage().list_jobs(profile_id=profile.profile_id)
    return {
        "jobs": [
            {
                "job_id": j.get("job_id"),
                "status": j.get("status"),
                "created_at": j.get("created_at"),
                "progress": j.get("progress")
            }
            for j in all_jobs
        ]
    }


@router.get("/jobs/{job_id}/download")
async def download_result(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Descarca rezultatul unui job finalizat."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Job not completed yet")

    result = job.get("result", {})
    final_video = result.get("final_video")

    if not final_video:
        raise HTTPException(status_code=404, detail="Output file not found")

    local_path = Path(final_video)
    if not local_path.exists():
        # May be a remote storage key — attempt retrieval
        file_storage = get_file_storage()
        settings = get_settings()
        cache_path = settings.output_dir / ".storage_cache" / Path(final_video).name
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            local_path = file_storage.retrieve(final_video, cache_path)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"FileStorage.retrieve failed for {final_video}: {e}")

    if not local_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")

    return FileResponse(
        path=str(local_path),
        media_type="video/mp4",
        filename=f"{job['output_name']}_final.mp4"
    )


@router.get("/tts/cache/stats")
async def get_tts_cache_stats(profile: ProfileContext = Depends(get_profile_context)):
    """Return TTS cache hit/miss metrics and current size."""
    from app.services.tts_cache import cache_stats
    return cache_stats()


@router.post("/tts/generate")
@limiter.limit("20/minute")
async def generate_tts(
    request: Request,
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    remove_silence: str = Form(default="true"),
    min_silence_duration: float = Form(default=0.3, ge=0.1, le=2.0),
    silence_padding: float = Form(default=0.08, ge=0.02, le=0.3),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate TTS audio from text using ElevenLabs API.
    Automatically removes silence/dead space from the audio.

    Args:
        text: Text to convert to speech
        remove_silence: Whether to remove silence (default: true)
        min_silence_duration: Pauses shorter than this are kept for natural rhythm (seconds)
        silence_padding: Padding around words to avoid cutting (seconds)

    Returns:
        Job ID for tracking - processing runs in background
    """
    settings = get_settings()
    settings.ensure_dirs()

    # Validate text
    text = validate_tts_text_length(text)

    job_id = uuid.uuid4().hex[:12]

    # Parse remove_silence
    remove_silence_bool = remove_silence.lower() in ("true", "1", "yes", "on")

    job = {
        "job_id": job_id,
        "job_type": "tts_generate",
        "profile_id": profile.profile_id,
        "status": JobStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": None,
        "progress": "Queued for TTS generation",
        "text": text,
        "remove_silence": remove_silence_bool,
        "min_silence_duration": min_silence_duration,
        "silence_padding": silence_padding,
        "result": None,
        "error": None
    }
    get_job_storage().create_job(job)

    background_tasks.add_task(process_tts_generate_job, job_id)

    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=job["created_at"],
        progress="Queued for TTS generation"
    )


async def process_tts_generate_job(job_id: str):
    """Process TTS generation job in background."""
    from app.services.elevenlabs_tts import get_elevenlabs_tts

    job = get_job_storage().get_job(job_id)
    if not job:
        return

    job["status"] = JobStatus.PROCESSING
    job["updated_at"] = datetime.now(timezone.utc)
    job["progress"] = "Generating voice-over with ElevenLabs..."

    try:
        tts = get_elevenlabs_tts()
        if tts is None:
            raise Exception("ElevenLabs TTS unavailable - API key or voice ID not configured")
        settings = get_settings()

        # Output path
        output_dir = settings.output_dir
        output_path = output_dir / f"tts_{job_id}.mp3"

        # Generate with silence removal
        if job["remove_silence"]:
            job["progress"] = "Generating TTS and removing silence..."
            job["updated_at"] = datetime.now(timezone.utc)

            audio_path, silence_stats = await tts.generate_audio_trimmed(
                text=job["text"],
                output_path=output_path,
                remove_silence=True,
                min_silence_duration=job["min_silence_duration"],
                silence_padding=job["silence_padding"]
            )

            job["result"] = {
                "status": "success",
                "audio_path": str(audio_path),
                "text_length": len(job["text"]),
                "silence_removal": silence_stats
            }

            # Calculate time saved
            if "original_duration" in silence_stats and "new_duration" in silence_stats:
                saved = silence_stats["original_duration"] - silence_stats["new_duration"]
                job["progress"] = f"Completed - saved {saved:.1f}s of silence"
            else:
                job["progress"] = "Completed"
        else:
            job["progress"] = "Generating TTS..."
            job["updated_at"] = datetime.now(timezone.utc)

            await tts.generate_audio(job["text"], output_path)

            job["result"] = {
                "status": "success",
                "audio_path": str(output_path),
                "text_length": len(job["text"]),
                "silence_removal": {"enabled": False}
            }
            job["progress"] = "Completed"

        job["status"] = JobStatus.COMPLETED

    except Exception as e:
        logger.error(f"TTS generate job {job_id} failed: {e}")
        job["status"] = JobStatus.FAILED
        job["error"] = str(e)
        job["progress"] = f"Failed: {e}"

    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Persist final job state to storage
    get_job_storage().update_job(job_id, job)


@router.get("/tts/{job_id}/download")
async def download_tts_audio(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Download generated TTS audio file."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Ownership check
    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("job_type") != "tts_generate":
        raise HTTPException(status_code=400, detail="Not a TTS generation job")

    if job["status"] != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="TTS generation not completed yet")

    audio_path = job.get("result", {}).get("audio_path")
    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(
        path=audio_path,
        media_type="audio/mpeg",
        filename=f"voiceover_{job_id}.mp3"
    )


@router.post("/tts/add-to-videos")
async def add_tts_to_videos(
    background_tasks: BackgroundTasks,
    video_paths: str = Form(...),  # JSON array of video paths
    tts_text: str = Form(...),
    output_suffix: str = Form(default="_with_tts"),
    remove_silence: str = Form(default="true"),
    min_silence_duration: float = Form(default=0.3, ge=0.1, le=2.0),
    silence_padding: float = Form(default=0.08, ge=0.02, le=0.3),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Add TTS audio to selected video variants.
    Automatically removes silence/dead space from the TTS audio.

    Args:
        video_paths: JSON array of video file paths
        tts_text: Text to convert to speech
        output_suffix: Suffix for output filenames
        remove_silence: Whether to remove silence from TTS (default: true)
        min_silence_duration: Pauses shorter than this are kept (natural rhythm)
        silence_padding: Padding around words to avoid cutting
    """
    import json as json_lib

    settings = get_settings()

    try:
        paths = json_lib.loads(video_paths)
        if not isinstance(paths, list) or len(paths) == 0:
            raise HTTPException(status_code=400, detail="video_paths must be a non-empty JSON array")
    except json_lib.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in video_paths")

    # Validate text (empty + length check)
    tts_text = validate_tts_text_length(tts_text, "tts_text")

    # Parse remove_silence
    remove_silence_bool = remove_silence.lower() in ("true", "1", "yes", "on")

    # Create job for TTS processing
    job_id = uuid.uuid4().hex[:12]

    job = {
        "job_id": job_id,
        "job_type": "tts",
        "profile_id": profile.profile_id,
        "status": JobStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": None,
        "progress": "Queued for TTS processing",
        "video_paths": paths,
        "tts_text": tts_text,
        "output_suffix": output_suffix,
        "remove_silence": remove_silence_bool,
        "min_silence_duration": min_silence_duration,
        "silence_padding": silence_padding,
        "result": None,
        "error": None
    }
    get_job_storage().create_job(job)

    # Process in background
    background_tasks.add_task(process_tts_job, job_id, profile.profile_id)

    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=job["created_at"],
        progress="Queued for TTS processing"
    )


async def process_tts_job(job_id: str, profile_id: Optional[str] = "default"):
    """Process TTS job in background with automatic silence removal."""
    from app.services.elevenlabs_tts import get_elevenlabs_tts

    job = get_job_storage().get_job(job_id)
    if not job:
        return

    job["status"] = JobStatus.PROCESSING
    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    job["progress"] = "Initializing TTS..."

    try:
        tts = get_elevenlabs_tts()
        if tts is None:
            raise Exception("ElevenLabs TTS unavailable - API key or voice ID not configured")
        settings = get_settings()

        video_paths = job["video_paths"]
        tts_text = job["tts_text"]
        output_suffix = job["output_suffix"]
        remove_silence = job.get("remove_silence", True)
        min_silence_duration = job.get("min_silence_duration", 0.3)
        silence_padding = job.get("silence_padding", 0.08)

        # Validate text length (ElevenLabs limit is ~5000 chars per request)
        tts_text = validate_tts_text_length(tts_text, "tts_text")

        # Generate TTS audio with silence removal
        # Profile-scoped temp directory to prevent cross-profile file collisions
        temp_dir = settings.base_dir / "temp" / profile_id
        temp_dir.mkdir(parents=True, exist_ok=True)
        audio_path = temp_dir / f"tts_{job_id}.mp3"

        silence_stats = {}
        if remove_silence:
            job["progress"] = "Generating voice-over and removing silence..."
            job["updated_at"] = datetime.now(timezone.utc)

            audio_path, silence_stats = await tts.generate_audio_trimmed(
                text=tts_text,
                output_path=audio_path,
                remove_silence=True,
                min_silence_duration=min_silence_duration,
                silence_padding=silence_padding
            )
            logger.info(f"TTS audio generated with silence removal: {audio_path}")

            if "original_duration" in silence_stats and "new_duration" in silence_stats:
                saved = silence_stats["original_duration"] - silence_stats["new_duration"]
                logger.info(f"Silence removed: {saved:.1f}s saved")
        else:
            job["progress"] = "Generating voice-over with ElevenLabs..."
            job["updated_at"] = datetime.now(timezone.utc)

            await tts.generate_audio(tts_text, audio_path)
            logger.info(f"TTS audio generated: {audio_path}")

        # Add audio to each video
        results = []
        for i, video_path_str in enumerate(video_paths):
            job["progress"] = f"Adding voice-over to video {i + 1}/{len(video_paths)}..."
            job["updated_at"] = datetime.now(timezone.utc)

            video_path = Path(video_path_str)
            if not video_path.exists():
                logger.warning(f"Video not found: {video_path}")
                results.append({
                    "original": str(video_path),
                    "error": "Video file not found",
                    "status": "failed"
                })
                continue

            # Create output path
            output_path = video_path.parent / f"{video_path.stem}{output_suffix}.mp4"

            try:
                tts.add_audio_to_video(video_path, audio_path, output_path)
                results.append({
                    "original": str(video_path),
                    "with_tts": str(output_path),
                    "status": "success"
                })
                logger.info(f"Added TTS to: {output_path}")
            except Exception as e:
                logger.error(f"Failed to add TTS to {video_path}: {e}")
                results.append({
                    "original": str(video_path),
                    "error": str(e),
                    "status": "failed"
                })

        # Cleanup temp audio
        try:
            audio_path.unlink()
        except Exception:
            pass

        job["status"] = JobStatus.COMPLETED
        job["result"] = {
            "status": "success",
            "processed_videos": results,
            "total": len(video_paths),
            "successful": len([r for r in results if r["status"] == "success"]),
            "silence_removal": silence_stats if silence_stats else {"enabled": False}
        }

        # Progress message with silence info
        success_count = job['result']['successful']
        total_count = job['result']['total']
        if silence_stats and "original_duration" in silence_stats:
            saved = silence_stats["original_duration"] - silence_stats["new_duration"]
            job["progress"] = f"Completed: {success_count}/{total_count} videos, saved {saved:.1f}s of silence"
        else:
            job["progress"] = f"Completed: {success_count}/{total_count} videos processed"

    except Exception as e:
        logger.error(f"TTS job {job_id} failed: {e}")
        job["status"] = JobStatus.FAILED
        job["error"] = str(e)
        job["progress"] = f"Failed: {e}"

    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Persist final job state to storage
    get_job_storage().update_job(job_id, job)


@router.get("/files/{file_path:path}")
async def serve_file(file_path: str, download: bool = False, profile: ProfileContext = Depends(get_profile_context)):
    """Serve a file from the output directory."""
    settings = get_settings()

    # Decode the file path
    from urllib.parse import unquote
    import os
    decoded_path = unquote(file_path)

    # Security: only allow files from output directory
    full_path = Path(decoded_path)
    if not full_path.is_absolute():
        full_path = settings.output_dir / decoded_path

    # Verify the file is within allowed directories
    try:
        full_path = full_path.resolve()
        if not full_path.is_relative_to(settings.output_dir.resolve()):
            raise HTTPException(status_code=403, detail="Access denied")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine content disposition and media type
    import mimetypes
    filename = full_path.name
    media_type = mimetypes.guess_type(str(full_path))[0] or "application/octet-stream"
    if download:
        return FileResponse(
            path=str(full_path),
            media_type=media_type,
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    else:
        return FileResponse(
            path=str(full_path),
            media_type=media_type
        )


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Cancel a running job."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") in ("completed", "failed", "cancelled"):
        return {"status": "already_finished", "job_id": job_id}

    get_job_storage().cancel_job(job_id)
    return {"status": "cancelled", "job_id": job_id}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Sterge un job si fisierele asociate."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Ownership check
    if job.get("profile_id") and job["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=404, detail="Job not found")

    # Stergem fisierele
    for key in ["video_path", "audio_path", "srt_path"]:
        if job.get(key):
            Path(job[key]).unlink(missing_ok=True)

    # Stergem output-urile
    if job.get("result"):
        for key in ["segments_video", "video_with_audio", "final_video"]:
            if job["result"].get(key):
                Path(job["result"][key]).unlink(missing_ok=True)

    get_job_storage().delete_job(job_id)
    return {"status": "deleted", "job_id": job_id}
