"""
Multi-Variant Pipeline API Routes

Orchestrates end-to-end pipeline:
1. Generate N script variants from an idea (Phase 14 script generation)
2. Preview segment matching per variant (Phase 15 assembly preview)
3. Batch-render selected variants with progress tracking (Phase 15 assembly render)
4. Status tracking for all variants in a pipeline

This is the glue layer connecting script generation and assembly into a single workflow.
"""
import logging
import uuid
from datetime import datetime
from typing import List, Optional, Dict
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.services.script_generator import get_script_generator
from app.services.assembly_service import get_assembly_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pipeline", tags=["Multi-Variant Pipeline"])

# Supabase client (lazy initialization)
_supabase_client = None

def get_supabase():
    """Get Supabase client with lazy initialization."""
    global _supabase_client
    if _supabase_client is None:
        try:
            from supabase import create_client
            from app.config import get_settings
            settings = get_settings()
            if settings.supabase_url and settings.supabase_key:
                _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("Supabase client initialized for pipeline routes")
            else:
                logger.warning("Supabase credentials not configured")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")
    return _supabase_client


# In-memory pipeline state storage
_pipelines: Dict[str, dict] = {}


# ============== PYDANTIC MODELS ==============

class PipelineGenerateRequest(BaseModel):
    """Request model for pipeline generation."""
    idea: str                           # User's video idea/concept
    context: str = ""                   # Product/brand context
    variant_count: int = 3              # Number of script variants (1-10)
    provider: str = "gemini"            # "gemini" or "claude"


class PipelineGenerateResponse(BaseModel):
    """Response model for pipeline generation."""
    pipeline_id: str                    # Unique pipeline identifier
    scripts: List[str]                  # Generated script texts
    provider: str                       # Which AI provider was used
    keyword_count: int                  # How many keywords were available
    variant_count: int                  # Number of variants generated


class MatchPreview(BaseModel):
    """Preview of a single SRT match."""
    srt_index: int
    srt_text: str
    srt_start: float
    srt_end: float
    segment_id: Optional[str]
    segment_keywords: List[str]
    matched_keyword: Optional[str]
    confidence: float


class PipelinePreviewResponse(BaseModel):
    """Response model for preview endpoint (same as AssemblyPreviewResponse)."""
    audio_duration: float
    srt_content: str
    matches: List[MatchPreview]
    total_phrases: int
    matched_count: int
    unmatched_count: int


class PipelineRenderRequest(BaseModel):
    """Request model for batch render."""
    variant_indices: List[int]          # Which variants to render
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
    # TTS model
    elevenlabs_model: str = "eleven_flash_v2_5"


class PipelineRenderResponse(BaseModel):
    """Response model for render endpoint."""
    pipeline_id: str
    rendering_variants: List[int]       # Which variants are being rendered
    total_variants: int                 # Total variants in pipeline


class VariantStatus(BaseModel):
    """Status of a single variant in the pipeline."""
    variant_index: int
    status: str                         # "not_started", "processing", "completed", "failed"
    progress: int                       # 0-100
    current_step: str
    final_video_path: Optional[str] = None
    error: Optional[str] = None


class PipelineStatusResponse(BaseModel):
    """Response model for status endpoint."""
    pipeline_id: str
    scripts: List[str]
    provider: str
    variants: List[VariantStatus]


# ============== ENDPOINTS ==============

@router.post("/generate", response_model=PipelineGenerateResponse)
async def generate_pipeline(
    request: PipelineGenerateRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate N script variants and create a pipeline.

    This is step 1 of the multi-variant workflow: create scripts with AI.
    Next steps: preview each variant, then batch-render selected variants.
    """
    # Validate input
    if request.variant_count < 1 or request.variant_count > 10:
        raise HTTPException(
            status_code=400,
            detail="variant_count must be between 1 and 10"
        )

    if request.provider not in ["gemini", "claude"]:
        raise HTTPException(
            status_code=400,
            detail="provider must be 'gemini' or 'claude'"
        )

    if not request.idea.strip():
        raise HTTPException(
            status_code=400,
            detail="idea cannot be empty"
        )

    # Fetch unique keywords from editai_segments table
    supabase = get_supabase()
    unique_keywords = []

    if supabase:
        try:
            result = supabase.table("editai_segments")\
                .select("keywords")\
                .eq("profile_id", profile.profile_id)\
                .execute()

            # Flatten and deduplicate keywords
            all_keywords = set()
            for seg in result.data:
                keywords_list = seg.get("keywords") or []
                for kw in keywords_list:
                    all_keywords.add(kw)

            unique_keywords = sorted(all_keywords)

            logger.info(
                f"[Profile {profile.profile_id}] Fetched {len(unique_keywords)} unique keywords "
                f"from {len(result.data)} segments"
            )
        except Exception as e:
            logger.warning(f"Failed to fetch keywords from database: {e}")
    else:
        logger.warning("Supabase not available, continuing without keywords")

    # Generate scripts
    logger.info(
        f"[Profile {profile.profile_id}] Generating pipeline with {request.variant_count} variants "
        f"using {request.provider}"
    )

    try:
        generator = get_script_generator()
        scripts = generator.generate_scripts(
            idea=request.idea,
            context=request.context,
            keywords=unique_keywords,
            variant_count=request.variant_count,
            provider=request.provider
        )

        # Generate pipeline ID
        pipeline_id = str(uuid.uuid4())

        # Store pipeline state
        _pipelines[pipeline_id] = {
            "pipeline_id": pipeline_id,
            "scripts": scripts,
            "provider": request.provider,
            "idea": request.idea,
            "context": request.context,
            "variant_count": len(scripts),
            "keyword_count": len(unique_keywords),
            "previews": {},
            "render_jobs": {},
            "created_at": datetime.now().isoformat(),
            "profile_id": profile.profile_id
        }

        logger.info(
            f"[Profile {profile.profile_id}] Created pipeline {pipeline_id} "
            f"with {len(scripts)} scripts"
        )

        return PipelineGenerateResponse(
            pipeline_id=pipeline_id,
            scripts=scripts,
            provider=request.provider,
            keyword_count=len(unique_keywords),
            variant_count=len(scripts)
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pipeline generation failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Pipeline generation service unavailable: {str(e)}"
        )


@router.post("/preview/{pipeline_id}/{variant_index}", response_model=PipelinePreviewResponse)
async def preview_variant(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context),
    elevenlabs_model: str = "eleven_flash_v2_5"
):
    """
    Preview segment matching for a single variant.

    Runs TTS, SRT generation, and keyword matching without expensive render.
    This is step 2 of the workflow: preview before rendering.
    """
    # Validate pipeline exists
    if pipeline_id not in _pipelines:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    pipeline = _pipelines[pipeline_id]

    # Validate ownership
    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Validate variant index
    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}. Must be between 0 and {len(pipeline['scripts']) - 1}"
        )

    script_text = pipeline["scripts"][variant_index]

    logger.info(
        f"[Profile {profile.profile_id}] Previewing pipeline {pipeline_id} variant {variant_index}"
    )

    try:
        assembly_service = get_assembly_service()

        preview_data = await assembly_service.preview_matches(
            script_text=script_text,
            profile_id=profile.profile_id,
            elevenlabs_model=elevenlabs_model
        )

        # Store preview result in pipeline state
        pipeline["previews"][variant_index] = {
            "timestamp": datetime.now().isoformat(),
            "elevenlabs_model": elevenlabs_model,
            "preview_data": preview_data
        }

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

        return PipelinePreviewResponse(
            audio_duration=preview_data["audio_duration"],
            srt_content=preview_data["srt_content"],
            matches=matches,
            total_phrases=preview_data["total_phrases"],
            matched_count=preview_data["matched_count"],
            unmatched_count=preview_data["unmatched_count"]
        )

    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Preview failed for variant {variant_index}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/render/{pipeline_id}", response_model=PipelineRenderResponse)
async def render_variants(
    pipeline_id: str,
    request: PipelineRenderRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Start batch rendering of selected variants.

    This is step 3 of the workflow: render the variants you want.
    Each variant renders independently in background. Poll /status for progress.
    """
    # Validate pipeline exists
    if pipeline_id not in _pipelines:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    pipeline = _pipelines[pipeline_id]

    # Validate ownership
    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Validate all variant indices
    for idx in request.variant_indices:
        if idx < 0 or idx >= len(pipeline["scripts"]):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid variant_index: {idx}. Must be between 0 and {len(pipeline['scripts']) - 1}"
            )

    logger.info(
        f"[Profile {profile.profile_id}] Starting render for pipeline {pipeline_id}, "
        f"variants: {request.variant_indices}"
    )

    # Fetch preset data
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        preset_result = supabase.table("editai_export_presets")\
            .select("*")\
            .eq("name", request.preset_name)\
            .single()\
            .execute()

        if preset_result.data:
            preset_data = preset_result.data
        else:
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

    # Initialize render jobs for each variant
    for variant_index in request.variant_indices:
        if variant_index not in pipeline["render_jobs"]:
            pipeline["render_jobs"][variant_index] = {
                "status": "processing",
                "progress": 0,
                "current_step": "Initializing render",
                "final_video_path": None,
                "error": None,
                "started_at": datetime.now().isoformat()
            }

            # Create background task for this variant
            async def do_render(vid=variant_index):
                try:
                    logger.info(
                        f"[Profile {profile.profile_id}] Rendering pipeline {pipeline_id} "
                        f"variant {vid}"
                    )

                    job = pipeline["render_jobs"][vid]
                    script_text = pipeline["scripts"][vid]

                    # Update progress
                    job["current_step"] = "Generating TTS audio"
                    job["progress"] = 10

                    assembly_service = get_assembly_service()

                    # Run full assembly
                    final_video_path = await assembly_service.assemble_and_render(
                        script_text=script_text,
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
                    job["status"] = "completed"
                    job["progress"] = 100
                    job["current_step"] = "Render complete"
                    job["final_video_path"] = str(final_video_path)
                    job["completed_at"] = datetime.now().isoformat()

                    logger.info(
                        f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                        f"variant {vid} completed: {final_video_path}"
                    )

                except Exception as e:
                    logger.error(
                        f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                        f"variant {vid} failed: {e}"
                    )
                    job["status"] = "failed"
                    job["progress"] = 0
                    job["current_step"] = "Render failed"
                    job["error"] = str(e)
                    job["failed_at"] = datetime.now().isoformat()

            # Add background task
            background_tasks.add_task(do_render)

    return PipelineRenderResponse(
        pipeline_id=pipeline_id,
        rendering_variants=request.variant_indices,
        total_variants=len(pipeline["scripts"])
    )


@router.get("/status/{pipeline_id}", response_model=PipelineStatusResponse)
async def get_pipeline_status(pipeline_id: str):
    """
    Get status of all variants in a pipeline.

    Public endpoint (no auth) - pipeline_id is the secret.
    Returns status for all variants (rendered and not-yet-rendered).
    """
    if pipeline_id not in _pipelines:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    pipeline = _pipelines[pipeline_id]

    # Build variants status list
    variants = []
    for idx in range(len(pipeline["scripts"])):
        if idx in pipeline["render_jobs"]:
            # Variant has a render job
            job = pipeline["render_jobs"][idx]
            variants.append(VariantStatus(
                variant_index=idx,
                status=job["status"],
                progress=job["progress"],
                current_step=job["current_step"],
                final_video_path=job.get("final_video_path"),
                error=job.get("error")
            ))
        else:
            # Variant not yet rendered
            variants.append(VariantStatus(
                variant_index=idx,
                status="not_started",
                progress=0,
                current_step="Not started",
                final_video_path=None,
                error=None
            ))

    return PipelineStatusResponse(
        pipeline_id=pipeline_id,
        scripts=pipeline["scripts"],
        provider=pipeline["provider"],
        variants=variants
    )
