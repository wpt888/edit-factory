"""
Edit Factory - API Routes
"""
import uuid
import shutil
import subprocess
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends
from fastapi.responses import FileResponse

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import validate_upload_size, validate_tts_text_length
from app.models import (
    JobStatus, JobCreate, JobResponse, AnalyzeRequest,
    AnalyzeResponse, HealthResponse, VideoInfo, VideoSegment
)
from app.services.video_processor import VideoProcessorService

import logging
from typing import Dict

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
        temp_dir=temp_dir
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
    """Get all cost entries (full history)."""
    from app.services.cost_tracker import get_cost_tracker

    tracker = get_cost_tracker()
    return {"entries": tracker.get_all_entries(profile_id=profile.profile_id)}


@router.post("/costs/reset")
async def reset_cost_tracker_endpoint(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Reset and reinitialize the cost tracker (reconnect to Supabase)."""
    from app.services.cost_tracker import reset_cost_tracker, get_cost_tracker

    reset_cost_tracker()
    tracker = get_cost_tracker()
    return {
        "status": "reset",
        "supabase_connected": tracker._supabase is not None
    }


@router.get("/usage")
async def get_usage_stats():
    """
    Get usage statistics from ElevenLabs and Gemini APIs.
    Returns character/token consumption and costs.
    """
    import httpx

    settings = get_settings()
    result = {
        "elevenlabs": None,
        "gemini": None,
        "errors": []
    }

    # ElevenLabs Usage
    if settings.elevenlabs_api_key:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://api.elevenlabs.io/v1/user/subscription",
                    headers={"xi-api-key": settings.elevenlabs_api_key}
                )
                if response.status_code == 200:
                    data = response.json()
                    chars_used = data.get("character_count", 0)
                    chars_limit = data.get("character_limit", 0)
                    chars_remaining = chars_limit - chars_used
                    next_reset = data.get("next_character_count_reset_unix")

                    # Estimate cost (approximate based on Creator plan ~$0.22/1000 chars)
                    estimated_cost = round(chars_used * 0.00022, 2)

                    result["elevenlabs"] = {
                        "characters_used": chars_used,
                        "characters_limit": chars_limit,
                        "characters_remaining": chars_remaining,
                        "usage_percent": round((chars_used / chars_limit * 100), 1) if chars_limit > 0 else 0,
                        "next_reset_unix": next_reset,
                        "tier": data.get("tier", "unknown"),
                        "estimated_cost_usd": estimated_cost
                    }
                else:
                    result["errors"].append(f"ElevenLabs API error: {response.status_code}")
        except Exception as e:
            result["errors"].append(f"ElevenLabs error: {str(e)}")
    else:
        result["errors"].append("ElevenLabs API key not configured")

    # Gemini - nu are usage API direct, dar putem estima din logs
    # Pentru acum, returnăm info despre configurare
    if settings.gemini_api_key:
        result["gemini"] = {
            "configured": True,
            "model": settings.gemini_model,
            "note": "Gemini usage tracking requires Google Cloud Console billing reports",
            "estimated_cost_per_video": 1.20  # ~60 frames × $0.02
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
        result["error"] = error_str

        # Check for common errors
        if "quota" in error_str.lower():
            result["error"] = "Quota exceeded - check billing"
        elif "invalid" in error_str.lower() and "key" in error_str.lower():
            result["error"] = "Invalid API key"
        elif "billing" in error_str.lower():
            result["error"] = "Billing not enabled"

    return result


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Verifica starea serviciului."""
    # Check ffmpeg
    ffmpeg_ok = False
    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True)
        ffmpeg_ok = result.returncode == 0
    except Exception:
        pass

    # Check redis (optional)
    redis_ok = False
    try:
        import redis
        settings = get_settings()
        r = redis.from_url(settings.redis_url)
        r.ping()
        redis_ok = True
    except Exception:
        pass

    return HealthResponse(
        status="healthy" if ffmpeg_ok else "degraded",
        version="1.0.0",
        ffmpeg_available=ffmpeg_ok,
        redis_available=redis_ok
    )


def _sanitize_filename(filename: str) -> str:
    """Sanitizează numele fișierului pentru a preveni path traversal."""
    if not filename:
        return "unnamed"
    # Eliminăm orice path components și caractere periculoase
    import re
    # Luăm doar numele fișierului (fără cale)
    safe_name = Path(filename).name
    # Eliminăm caractere speciale, păstrăm doar alfanumerice, puncte, liniuțe
    safe_name = re.sub(r'[^\w\-_\.]', '_', safe_name)
    # Limităm lungimea
    if len(safe_name) > 100:
        safe_name = safe_name[:100]
    return safe_name or "unnamed"


@router.post("/detect-voice")
async def detect_voice_in_video(
    video: UploadFile = File(...),
    threshold: float = Form(default=0.5, ge=0.0, le=1.0),
    min_speech_duration: float = Form(default=0.25, ge=0.1, le=10.0)
):
    """
    Detectează segmentele cu voce umană în video.
    Returnează lista de intervale cu voce pentru preview/verificare.

    Args:
        video: Fișierul video de analizat
        threshold: Pragul de detecție (0-1). Mai mare = mai strict
        min_speech_duration: Durata minimă pentru a considera un segment ca voce (secunde)
    """
    settings = get_settings()
    settings.ensure_dirs()

    # Sanitizăm filename pentru a preveni path traversal
    safe_filename = _sanitize_filename(video.filename)
    temp_video = settings.input_dir / f"vad_{uuid.uuid4().hex[:8]}_{safe_filename}"

    try:
        with open(temp_video, "wb") as f:
            shutil.copyfileobj(video.file, f)

        # Import voice detector
        try:
            from app.services.voice_detector import VoiceDetector
        except ImportError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Voice detection not available. Install torch: {e}"
            )

        detector = VoiceDetector(threshold=threshold, min_speech_duration=min_speech_duration)
        voice_segments = detector.detect_voice(temp_video)

        # Calculate total voice duration
        total_voice_duration = sum(seg.duration for seg in voice_segments)

        return {
            "status": "success",
            "voice_segments": [seg.to_dict() for seg in voice_segments],
            "total_voice_duration": round(total_voice_duration, 2),
            "segments_count": len(voice_segments),
            "threshold_used": threshold
        }

    except Exception as e:
        logger.error(f"Voice detection failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

    finally:
        temp_video.unlink(missing_ok=True)


@router.post("/mute-voice")
async def mute_voice_in_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    keep_percentage: float = Form(default=0.0),
    output_name: Optional[str] = Form(default=None)
):
    """
    Detectează și mută segmentele cu voce din video.
    Păstrează efectele sonore, elimină doar vocea umană.

    Args:
        video: Fișierul video de procesat
        keep_percentage: Cât din volumul original să păstreze (0-1). 0 = mute complet
        output_name: Numele pentru fișierul output

    Returns:
        Job ID pentru tracking - procesarea rulează în background
    """
    settings = get_settings()
    settings.ensure_dirs()

    job_id = uuid.uuid4().hex[:12]
    if not output_name:
        output_name = f"muted_{job_id}"

    # Salvăm video-ul
    video_path = settings.input_dir / f"{job_id}_{_sanitize_filename(video.filename)}"
    with open(video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    # Creăm job-ul
    job_storage = get_job_storage()
    job = {
        "job_id": job_id,
        "job_type": "voice_mute",
        "status": JobStatus.PENDING,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None,
        "progress": "Queued for voice muting",
        "video_path": str(video_path),
        "output_name": output_name,
        "keep_percentage": keep_percentage,
        "result": None,
        "error": None
    }
    job_storage.create_job(job)

    # Lansăm procesarea în background
    background_tasks.add_task(process_voice_mute_job, job_id)

    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=job["created_at"],
        progress="Queued for voice muting"
    )


async def process_voice_mute_job(job_id: str):
    """Procesează un job de voice muting în background."""
    job_storage = get_job_storage()
    job = job_storage.get_job(job_id)
    if not job:
        return

    job_storage.update_job(job_id, {
        "status": JobStatus.PROCESSING,
        "progress": "Detecting voice segments..."
    })

    try:
        from app.services.voice_detector import VoiceDetector, mute_voice_segments

        settings = get_settings()
        video_path = Path(job["video_path"])
        output_path = settings.output_dir / f"{job['output_name']}_voice_muted.mp4"

        # Detectăm voce
        detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)
        voice_segments = detector.detect_voice(video_path)

        job_storage.update_job(job_id, {
            "progress": f"Found {len(voice_segments)} voice segments. Muting..."
        })

        if voice_segments:
            # Aplicăm mute
            success = mute_voice_segments(
                video_path=video_path,
                output_path=output_path,
                voice_segments=voice_segments,
                fade_duration=0.05,
                keep_percentage=job.get("keep_percentage", 0.0)
            )

            if not success:
                raise Exception("FFmpeg muting failed")
        else:
            # No voice detected, just copy
            shutil.copy(video_path, output_path)

        job_storage.update_job(job_id, {
            "status": JobStatus.COMPLETED,
            "result": {
                "status": "success",
                "final_video": str(output_path),
                "voice_segments": [seg.to_dict() for seg in voice_segments],
                "segments_muted": len(voice_segments),
                "total_voice_duration": round(sum(seg.duration for seg in voice_segments), 2)
            },
            "progress": f"Completed - muted {len(voice_segments)} voice segments"
        })

        # Cleanup input
        video_path.unlink(missing_ok=True)

    except Exception as e:
        logger.error(f"Voice mute job {job_id} failed: {e}")
        job_storage.update_job(job_id, {
            "status": JobStatus.FAILED,
            "error": str(e),
            "progress": f"Failed: {e}"
        })


@router.post("/analyze")
async def analyze_video(
    video: UploadFile = File(...),
    target_duration: float = Form(default=20.0)
):
    """
    Analizeaza un video si returneaza segmentele recomandate.
    Nu proceseaza - doar analiza.
    """
    settings = get_settings()
    settings.ensure_dirs()

    # Salvam video-ul temporar
    temp_video = settings.input_dir / f"analyze_{uuid.uuid4().hex[:8]}_{_sanitize_filename(video.filename)}"

    try:
        with open(temp_video, "wb") as f:
            shutil.copyfileobj(video.file, f)

        processor = get_processor()
        result = processor.analyze_video(temp_video, target_duration)

        return result

    finally:
        # Stergem fisierul temporar
        temp_video.unlink(missing_ok=True)


@router.post("/video-info")
async def get_video_info(video: UploadFile = File(...)):
    """
    Obtine informatii despre video (rezolutie, durata, fps).
    Folosit pentru preview-ul subtitrarii.
    """
    settings = get_settings()
    settings.ensure_dirs()

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

        result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=30)

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
async def create_job(
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

    # Salvam fisierele
    video_path = settings.input_dir / f"{job_id}_{_sanitize_filename(video.filename)}"
    with open(video_path, "wb") as f:
        shutil.copyfileobj(video.file, f)

    audio_path = None
    if audio:
        await validate_upload_size(audio)
        audio_path = settings.input_dir / f"{job_id}_{_sanitize_filename(audio.filename)}"
        with open(audio_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

    srt_path = None
    if srt:
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

    def update_progress(step: str, status: str):
        job["progress"] = f"{step}: {status}"
        job["updated_at"] = datetime.now(timezone.utc).isoformat()
        get_job_storage().update_job(job_id, {"progress": job["progress"], "updated_at": job["updated_at"]})

    try:
        processor = get_processor()
        video_path = Path(job["video_path"])

        # Voice muting e acum integrat în process_video pentru mute selectiv per segment
        result = processor.process_video(
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

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}")
        job["status"] = JobStatus.FAILED
        job["error"] = str(e)
        job["progress"] = f"Failed: {e}"

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


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    """Obtine statusul unui job."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = JobResponse(
        job_id=job["job_id"],
        status=job["status"],
        created_at=job["created_at"],
        updated_at=job["updated_at"],
        progress=job["progress"],
        error=job.get("error")
    )

    if job.get("result"):
        response.result = job["result"]
        if "video_info" in job["result"]:
            response.video_info = VideoInfo(**job["result"]["video_info"])
        if "segments" in job["result"]:
            response.segments = [VideoSegment(**s) for s in job["result"]["segments"]]

    return response


@router.get("/jobs")
async def list_jobs():
    """Lista toate job-urile."""
    all_jobs = get_job_storage().list_jobs()
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
async def download_result(job_id: str):
    """Descarca rezultatul unui job finalizat."""
    job = get_job_storage().get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job["status"] != JobStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Job not completed yet")

    result = job.get("result", {})
    final_video = result.get("final_video")

    if not final_video or not Path(final_video).exists():
        raise HTTPException(status_code=404, detail="Output file not found")

    return FileResponse(
        path=final_video,
        media_type="video/mp4",
        filename=f"{job['output_name']}_final.mp4"
    )


@router.post("/jobs/multi-video", response_model=JobResponse)
async def create_multi_video_job(
    background_tasks: BackgroundTasks,
    main_video: UploadFile = File(...),
    srt: UploadFile = File(...),  # SRT obligatoriu pentru keyword detection
    secondary_video_1: Optional[UploadFile] = File(default=None),
    secondary_keywords_1: Optional[str] = Form(default=None),  # Comma-separated keywords
    secondary_video_2: Optional[UploadFile] = File(default=None),
    secondary_keywords_2: Optional[str] = Form(default=None),
    secondary_video_3: Optional[UploadFile] = File(default=None),
    secondary_keywords_3: Optional[str] = Form(default=None),
    audio: Optional[UploadFile] = File(default=None),
    output_name: Optional[str] = Form(default=None),
    target_duration: float = Form(default=20.0),
    subtitle_settings: Optional[str] = Form(default=None),
    variant_count: int = Form(default=1),
    secondary_segment_duration: float = Form(default=2.0)
):
    """
    Creeaza un job de procesare multi-video cu keyword triggers.

    Când un cuvânt cheie apare în SRT (ex: "decant"), se inserează
    un clip din video-ul secundar asociat cu acel keyword.

    Args:
        main_video: Video-ul principal
        srt: Fișierul SRT pentru keyword detection
        secondary_video_X: Video-uri secundare (max 3)
        secondary_keywords_X: Keywords pentru fiecare video secundar (comma-separated)
        audio: Audio opțional (TTS)
        subtitle_settings: JSON string cu setări subtitrări
        variant_count: Numărul de variante (1-10)
        secondary_segment_duration: Durata clipurilor secundare (secunde)
    """
    settings = get_settings()
    settings.ensure_dirs()

    job_id = uuid.uuid4().hex[:12]
    if not output_name:
        output_name = f"multi_{job_id}"

    # Salvăm video-ul principal
    main_video_path = settings.input_dir / f"{job_id}_main_{_sanitize_filename(main_video.filename)}"
    with open(main_video_path, "wb") as f:
        shutil.copyfileobj(main_video.file, f)

    # Salvăm SRT
    srt_path = settings.input_dir / f"{job_id}_{_sanitize_filename(srt.filename)}"
    with open(srt_path, "wb") as f:
        shutil.copyfileobj(srt.file, f)

    # Citim conținutul SRT
    with open(srt_path, "r", encoding="utf-8") as f:
        srt_content = f.read()

    # Procesăm video-urile secundare
    secondary_videos = []
    for i, (video_file, keywords_str) in enumerate([
        (secondary_video_1, secondary_keywords_1),
        (secondary_video_2, secondary_keywords_2),
        (secondary_video_3, secondary_keywords_3)
    ], 1):
        if video_file and keywords_str:
            # Salvăm video-ul secundar
            sec_path = settings.input_dir / f"{job_id}_secondary_{i}_{_sanitize_filename(video_file.filename)}"
            with open(sec_path, "wb") as f:
                shutil.copyfileobj(video_file.file, f)

            # Parsăm keywords (comma-separated)
            keywords = [kw.strip() for kw in keywords_str.split(",") if kw.strip()]

            secondary_videos.append({
                "path": str(sec_path),
                "keywords": keywords
            })
            logger.info(f"Secondary video {i}: {sec_path.name} with keywords {keywords}")

    # Salvăm audio dacă există
    audio_path = None
    if audio:
        audio_path = settings.input_dir / f"{job_id}_{_sanitize_filename(audio.filename)}"
        with open(audio_path, "wb") as f:
            shutil.copyfileobj(audio.file, f)

    # Parse subtitle settings
    parsed_subtitle_settings = None
    if subtitle_settings:
        try:
            parsed_subtitle_settings = json.loads(subtitle_settings)
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid JSON in subtitle_settings: {str(e)}"
            )

    # Limitări
    variant_count = max(1, min(10, variant_count))
    secondary_segment_duration = max(0.5, min(5.0, secondary_segment_duration))

    # Creăm job-ul
    job = {
        "job_id": job_id,
        "job_type": "multi_video",
        "status": JobStatus.PENDING,
        "created_at": datetime.now(timezone.utc),
        "updated_at": None,
        "progress": "Queued",
        "main_video_path": str(main_video_path),
        "secondary_videos": secondary_videos,
        "srt_path": str(srt_path),
        "srt_content": srt_content,
        "audio_path": str(audio_path) if audio_path else None,
        "output_name": output_name,
        "target_duration": target_duration,
        "subtitle_settings": parsed_subtitle_settings,
        "variant_count": variant_count,
        "secondary_segment_duration": secondary_segment_duration,
        "result": None,
        "error": None
    }
    get_job_storage().create_job(job)

    # Lansăm procesarea în background
    background_tasks.add_task(process_multi_video_job, job_id)

    return JobResponse(
        job_id=job_id,
        status=JobStatus.PENDING,
        created_at=job["created_at"],
        progress="Queued for multi-video processing"
    )


async def process_multi_video_job(job_id: str):
    """Procesează un job multi-video în background."""
    job = get_job_storage().get_job(job_id)
    if not job:
        return

    job["status"] = JobStatus.PROCESSING
    job["updated_at"] = datetime.now(timezone.utc)
    job["progress"] = "Starting multi-video processing..."

    def update_progress(step: str, status: str):
        job["progress"] = f"{step}: {status}"
        job["updated_at"] = datetime.now(timezone.utc)

    try:
        processor = get_processor()

        # Convertim paths din strings
        secondary_videos = [
            {"path": Path(sv["path"]), "keywords": sv["keywords"]}
            for sv in job["secondary_videos"]
        ]

        result = processor.process_video_with_keywords(
            main_video_path=Path(job["main_video_path"]),
            secondary_videos=secondary_videos,
            srt_content=job["srt_content"],
            output_name=job["output_name"],
            target_duration=job["target_duration"],
            audio_path=Path(job["audio_path"]) if job["audio_path"] else None,
            subtitle_settings=job.get("subtitle_settings"),
            variant_count=job.get("variant_count", 1),
            secondary_segment_duration=job.get("secondary_segment_duration", 2.0),
            progress_callback=update_progress
        )

        if result["status"] == "success":
            job["status"] = JobStatus.COMPLETED
            job["result"] = result
            job["progress"] = "Completed successfully"

            # Cleanup input files
            _cleanup_multi_video_input_files(job)
        else:
            job["status"] = JobStatus.FAILED
            job["error"] = result.get("error", "Unknown error")
            job["progress"] = "Failed"

    except Exception as e:
        logger.error(f"Multi-video job {job_id} failed: {e}")
        job["status"] = JobStatus.FAILED
        job["error"] = str(e)
        job["progress"] = f"Failed: {e}"

    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    # Persist final job state to storage
    get_job_storage().update_job(job_id, job)


def _cleanup_multi_video_input_files(job: dict):
    """Șterge fișierele input după procesare reușită pentru job multi-video."""
    # Main video
    if job.get("main_video_path"):
        try:
            Path(job["main_video_path"]).unlink(missing_ok=True)
            logger.info(f"Deleted main video: {job['main_video_path']}")
        except Exception as e:
            logger.warning(f"Failed to delete main video: {e}")

    # Secondary videos
    for sv in job.get("secondary_videos", []):
        try:
            Path(sv["path"]).unlink(missing_ok=True)
            logger.info(f"Deleted secondary video: {sv['path']}")
        except Exception as e:
            logger.warning(f"Failed to delete secondary video: {e}")

    # Audio & SRT
    for key in ["audio_path", "srt_path"]:
        if job.get(key):
            try:
                Path(job[key]).unlink(missing_ok=True)
                logger.info(f"Deleted {key}: {job[key]}")
            except Exception as e:
                logger.warning(f"Failed to delete {key}: {e}")


@router.post("/tts/generate")
async def generate_tts(
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
async def download_tts_audio(job_id: str):
    """Download generated TTS audio file."""
    job = get_job_storage().get_job(job_id)
    if not job:
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
async def serve_file(file_path: str, download: bool = False):
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
    # Use os.path.normcase for Windows case-insensitive comparison
    try:
        full_path = full_path.resolve()
        output_dir = settings.output_dir.resolve()
        # Normalize paths for Windows (lowercase, consistent separators)
        full_path_normalized = os.path.normcase(str(full_path))
        output_dir_normalized = os.path.normcase(str(output_dir))
        if not full_path_normalized.startswith(output_dir_normalized):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine content disposition
    filename = full_path.name
    if download:
        return FileResponse(
            path=str(full_path),
            media_type="video/mp4",
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename=\"{filename}\""}
        )
    else:
        return FileResponse(
            path=str(full_path),
            media_type="video/mp4"
        )


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """Sterge un job si fisierele asociate."""
    job = get_job_storage().get_job(job_id)
    if not job:
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
