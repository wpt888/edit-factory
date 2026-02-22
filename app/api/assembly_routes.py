"""
Assembly API Routes

Endpoints for Script-to-Video Assembly pipeline:
- Preview matching (TTS + SRT + match without render)
- Render assembly (full pipeline in background)
- Status polling (get job progress)
"""
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase
from app.services.assembly_service import get_assembly_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/assembly", tags=["assembly"])

# Job storage (in-memory, same pattern as library_routes _generation_progress)
_assembly_jobs = {}


# ============== DB PERSISTENCE HELPERS ==============

def _db_create_assembly_job(job_id: str, profile_id: str, job: dict):
    """Insert a new assembly job into editai_assembly_jobs. Graceful degradation."""
    try:
        supabase = get_supabase()
        if not supabase:
            return
        row = {
            "id": job_id,
            "profile_id": profile_id,
            "status": job.get("status", "processing"),
            "progress": job.get("progress", 0),
            "current_step": job.get("current_step", "Initializing assembly"),
            "final_video_path": job.get("final_video_path"),
            "error": job.get("error"),
            "started_at": job.get("started_at"),
        }
        supabase.table("editai_assembly_jobs").insert(row).execute()
        logger.debug(f"Assembly job {job_id} created in DB")
    except Exception as e:
        logger.warning(f"Failed to create assembly job {job_id} in DB: {e}")


def _db_update_assembly_job(job_id: str, job: dict):
    """Update assembly job status/progress in DB. Graceful degradation."""
    try:
        supabase = get_supabase()
        if not supabase:
            return
        update = {
            "status": job.get("status"),
            "progress": job.get("progress"),
            "current_step": job.get("current_step"),
            "final_video_path": job.get("final_video_path"),
            "error": job.get("error"),
        }
        if job.get("completed_at"):
            update["completed_at"] = job["completed_at"]
        if job.get("failed_at"):
            update["failed_at"] = job["failed_at"]

        supabase.table("editai_assembly_jobs").update(update).eq("id", job_id).execute()
        logger.debug(f"Assembly job {job_id} updated in DB")
    except Exception as e:
        logger.warning(f"Failed to update assembly job {job_id} in DB: {e}")


def _db_load_assembly_job(job_id: str) -> Optional[dict]:
    """Load assembly job from DB into _assembly_jobs cache. Returns job dict or None."""
    try:
        supabase = get_supabase()
        if not supabase:
            return None
        result = supabase.table("editai_assembly_jobs")\
            .select("*")\
            .eq("id", job_id)\
            .single()\
            .execute()
        if not result.data:
            return None

        row = result.data
        job = {
            "status": row.get("status", "processing"),
            "progress": row.get("progress", 0),
            "current_step": row.get("current_step", ""),
            "final_video_path": row.get("final_video_path"),
            "error": row.get("error"),
            "started_at": row.get("started_at"),
            "completed_at": row.get("completed_at"),
            "failed_at": row.get("failed_at"),
        }

        # Cache in memory
        _assembly_jobs[job_id] = job
        logger.info(f"Assembly job {job_id} loaded from DB")
        return job

    except Exception as e:
        logger.warning(f"Failed to load assembly job {job_id} from DB: {e}")
        return None


# ============== PYDANTIC MODELS ==============

class AssemblyPreviewRequest(BaseModel):
    script_text: str
    elevenlabs_model: str = "eleven_flash_v2_5"


class MatchPreview(BaseModel):
    srt_index: int
    srt_text: str
    srt_start: float
    srt_end: float
    segment_id: Optional[str]
    segment_keywords: List[str]
    matched_keyword: Optional[str]
    confidence: float


class AssemblyPreviewResponse(BaseModel):
    audio_duration: float
    srt_content: str
    matches: List[MatchPreview]
    total_phrases: int
    matched_count: int
    unmatched_count: int


class AssemblyRenderRequest(BaseModel):
    script_text: str
    elevenlabs_model: str = "eleven_flash_v2_5"
    preset_name: str = "TikTok"
    # Subtitle settings
    font_size: int = 48
    font_family: str = "Montserrat"
    text_color: str = "#FFFFFF"
    outline_color: str = "#000000"
    outline_width: int = 3
    position_y: int = 85
    shadow_depth: int = 0
    enable_glow: bool = False
    glow_blur: int = 0
    adaptive_sizing: bool = False
    # Video filters
    enable_denoise: bool = False
    denoise_strength: float = 2.0
    enable_sharpen: bool = False
    sharpen_amount: float = 0.5
    enable_color: bool = False
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0


class AssemblyRenderResponse(BaseModel):
    job_id: str
    status: str


class AssemblyStatusResponse(BaseModel):
    status: str  # "processing", "completed", "failed"
    progress: int  # 0-100
    current_step: str
    final_video_path: Optional[str] = None
    error: Optional[str] = None


# ============== ENDPOINTS ==============

@router.post("/preview", response_model=AssemblyPreviewResponse)
async def preview_assembly(
    request: AssemblyPreviewRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Preview script-to-video matching without rendering.

    Performs TTS generation, SRT creation, and keyword matching to show
    which segments will be used, but does NOT trigger expensive video render.
    """
    logger.info(f"[Profile {profile.profile_id}] Preview assembly for script ({len(request.script_text)} chars)")

    try:
        assembly_service = get_assembly_service()

        preview_data = await assembly_service.preview_matches(
            script_text=request.script_text,
            profile_id=profile.profile_id,
            elevenlabs_model=request.elevenlabs_model
        )

        # Convert matches to MatchPreview models
        matches = [
            MatchPreview(
                srt_index=m["srt_index"],
                srt_text=m["srt_text"],
                srt_start=m["srt_start"],
                srt_end=m["srt_end"],
                segment_id=m["segment_id"],
                segment_keywords=m["segment_keywords"],
                matched_keyword=m["matched_keyword"],
                confidence=m["confidence"]
            )
            for m in preview_data["matches"]
        ]

        return AssemblyPreviewResponse(
            audio_duration=preview_data["audio_duration"],
            srt_content=preview_data["srt_content"],
            matches=matches,
            total_phrases=preview_data["total_phrases"],
            matched_count=preview_data["matched_count"],
            unmatched_count=preview_data["unmatched_count"]
        )

    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/render", response_model=AssemblyRenderResponse)
async def render_assembly(
    request: AssemblyRenderRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Start background assembly render job.

    Returns job_id immediately. Client polls /assembly/status/{job_id} for progress.
    """
    logger.info(f"[Profile {profile.profile_id}] Starting assembly render for script ({len(request.script_text)} chars)")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Fetch preset data
    try:
        preset_result = supabase.table("editai_export_presets")\
            .select("*")\
            .eq("name", request.preset_name)\
            .single()\
            .execute()

        if preset_result.data:
            preset_data = preset_result.data
        else:
            # Fallback to default preset
            logger.warning(f"Preset '{request.preset_name}' not found, using default")
            preset_data = {
                "name": request.preset_name,
                "width": 1080,
                "height": 1920,
                "fps": 30,
                "video_codec": "libx264",
                "audio_codec": "aac",
                "video_bitrate": "3M",
                "audio_bitrate": "192k"
            }
    except Exception as e:
        logger.error(f"Failed to fetch preset: {e}")
        # Use default
        preset_data = {
            "name": request.preset_name,
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "video_codec": "libx264",
            "audio_codec": "aac",
            "video_bitrate": "3M",
            "audio_bitrate": "192k"
        }

    # Build subtitle settings dict
    subtitle_settings = {
        "font_size": request.font_size,
        "font_family": request.font_family,
        "text_color": request.text_color,
        "outline_color": request.outline_color,
        "outline_width": request.outline_width,
        "position_y": request.position_y,
        "shadow_depth": request.shadow_depth,
        "enable_glow": request.enable_glow,
        "glow_blur": request.glow_blur,
        "adaptive_sizing": request.adaptive_sizing
    }

    # Initialize job status
    _assembly_jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "current_step": "Initializing assembly",
        "final_video_path": None,
        "error": None,
        "started_at": datetime.now().isoformat()
    }

    # Persist to DB
    _db_create_assembly_job(job_id, profile.profile_id, _assembly_jobs[job_id])

    # Background task function
    async def do_assembly():
        try:
            logger.info(f"[Profile {profile.profile_id}] Background assembly job {job_id} started")

            # Update progress
            _assembly_jobs[job_id]["current_step"] = "Generating TTS audio"
            _assembly_jobs[job_id]["progress"] = 10

            assembly_service = get_assembly_service()

            # Run full assembly
            final_video_path = await assembly_service.assemble_and_render(
                script_text=request.script_text,
                profile_id=profile.profile_id,
                preset_data=preset_data,
                subtitle_settings=subtitle_settings,
                elevenlabs_model=request.elevenlabs_model,
                enable_denoise=request.enable_denoise,
                denoise_strength=request.denoise_strength,
                enable_sharpen=request.enable_sharpen,
                sharpen_amount=request.sharpen_amount,
                enable_color=request.enable_color,
                brightness=request.brightness,
                contrast=request.contrast,
                saturation=request.saturation,
                shadow_depth=request.shadow_depth,
                enable_glow=request.enable_glow,
                glow_blur=request.glow_blur,
                adaptive_sizing=request.adaptive_sizing
            )

            # Success
            _assembly_jobs[job_id]["status"] = "completed"
            _assembly_jobs[job_id]["progress"] = 100
            _assembly_jobs[job_id]["current_step"] = "Assembly complete"
            _assembly_jobs[job_id]["final_video_path"] = str(final_video_path)
            _assembly_jobs[job_id]["completed_at"] = datetime.now().isoformat()

            logger.info(f"[Profile {profile.profile_id}] Assembly job {job_id} completed: {final_video_path}")

            # Persist to DB
            _db_update_assembly_job(job_id, _assembly_jobs[job_id])

        except Exception as e:
            logger.error(f"[Profile {profile.profile_id}] Assembly job {job_id} failed: {e}")
            _assembly_jobs[job_id]["status"] = "failed"
            _assembly_jobs[job_id]["progress"] = 0
            _assembly_jobs[job_id]["current_step"] = "Assembly failed"
            _assembly_jobs[job_id]["error"] = str(e)
            _assembly_jobs[job_id]["failed_at"] = datetime.now().isoformat()

            # Persist to DB
            _db_update_assembly_job(job_id, _assembly_jobs[job_id])

    # Add background task
    background_tasks.add_task(do_assembly)

    return AssemblyRenderResponse(
        job_id=job_id,
        status="processing"
    )


@router.get("/status/{job_id}", response_model=AssemblyStatusResponse)
async def get_assembly_status(job_id: str):
    """
    Get assembly job status.

    Public endpoint (no auth) - job_id is the secret.
    """
    # Try in-memory first, then DB fallback
    if job_id not in _assembly_jobs:
        loaded = _db_load_assembly_job(job_id)
        if not loaded:
            raise HTTPException(status_code=404, detail="Job not found")

    job = _assembly_jobs[job_id]

    return AssemblyStatusResponse(
        status=job["status"],
        progress=job["progress"],
        current_step=job["current_step"],
        final_video_path=job.get("final_video_path"),
        error=job.get("error")
    )
