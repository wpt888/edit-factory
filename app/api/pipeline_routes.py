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
from datetime import datetime, timezone
from typing import List, Optional, Dict
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase
from app.services.script_generator import get_script_generator
from app.services.assembly_service import get_assembly_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pipeline", tags=["Multi-Variant Pipeline"])

# In-memory pipeline state storage
_pipelines: Dict[str, dict] = {}
_MAX_PIPELINE_ENTRIES = 1000


def _evict_old_pipelines():
    """Remove oldest entries if store exceeds max size."""
    if len(_pipelines) > _MAX_PIPELINE_ENTRIES:
        to_remove = sorted(_pipelines.keys())[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
        for key in to_remove:
            _pipelines.pop(key, None)


# ============== DB PERSISTENCE HELPERS ==============

def _db_save_pipeline(pipeline_id: str, pipeline_dict: dict):
    """Upsert full pipeline state to editai_pipelines. Graceful degradation."""
    try:
        supabase = get_supabase()
        if not supabase:
            return
        # Convert int keys in previews/render_jobs to strings for JSON
        previews_json = {str(k): v for k, v in pipeline_dict.get("previews", {}).items()}
        render_jobs_json = {str(k): v for k, v in pipeline_dict.get("render_jobs", {}).items()}

        row = {
            "id": pipeline_id,
            "profile_id": pipeline_dict["profile_id"],
            "idea": pipeline_dict.get("idea", ""),
            "context": pipeline_dict.get("context", ""),
            "provider": pipeline_dict.get("provider", "gemini"),
            "variant_count": pipeline_dict.get("variant_count", 0),
            "keyword_count": pipeline_dict.get("keyword_count", 0),
            "scripts": pipeline_dict.get("scripts", []),
            "previews": previews_json,
            "render_jobs": render_jobs_json,
        }
        supabase.table("editai_pipelines").upsert(row).execute()
        logger.debug(f"Pipeline {pipeline_id} saved to DB")
    except Exception as e:
        logger.warning(f"Failed to save pipeline {pipeline_id} to DB: {e}")


def _db_update_render_jobs(pipeline_id: str, render_jobs: dict):
    """Update only render_jobs column for a pipeline. Graceful degradation."""
    try:
        supabase = get_supabase()
        if not supabase:
            return
        render_jobs_json = {str(k): v for k, v in render_jobs.items()}
        supabase.table("editai_pipelines").update({
            "render_jobs": render_jobs_json
        }).eq("id", pipeline_id).execute()
        logger.debug(f"Pipeline {pipeline_id} render_jobs updated in DB")
    except Exception as e:
        logger.warning(f"Failed to update render_jobs for {pipeline_id}: {e}")


def _db_load_pipeline(pipeline_id: str) -> Optional[dict]:
    """Load pipeline from DB into _pipelines cache. Returns pipeline dict or None."""
    try:
        supabase = get_supabase()
        if not supabase:
            return None
        result = supabase.table("editai_pipelines")\
            .select("*")\
            .eq("id", pipeline_id)\
            .single()\
            .execute()
        if not result.data:
            return None

        row = result.data
        # Convert string keys back to int for previews and render_jobs
        previews = {}
        for k, v in (row.get("previews") or {}).items():
            previews[int(k)] = v
            # Verify audio_path still exists on disk
            if isinstance(v, dict) and "preview_data" in v:
                pd = v["preview_data"]
                if pd.get("audio_path") and not Path(pd["audio_path"]).exists():
                    pd["audio_path"] = None

        render_jobs = {}
        for k, v in (row.get("render_jobs") or {}).items():
            render_jobs[int(k)] = v

        pipeline = {
            "pipeline_id": pipeline_id,
            "profile_id": row["profile_id"],
            "idea": row.get("idea", ""),
            "context": row.get("context", ""),
            "provider": row.get("provider", "gemini"),
            "variant_count": row.get("variant_count", 0),
            "keyword_count": row.get("keyword_count", 0),
            "scripts": row.get("scripts") or [],
            "previews": previews,
            "render_jobs": render_jobs,
            "created_at": row.get("created_at", ""),
        }

        # Cache in memory
        _pipelines[pipeline_id] = pipeline
        logger.info(f"Pipeline {pipeline_id} loaded from DB")
        return pipeline

    except Exception as e:
        logger.warning(f"Failed to load pipeline {pipeline_id} from DB: {e}")
        return None


def _get_pipeline_or_load(pipeline_id: str) -> Optional[dict]:
    """Get pipeline from in-memory cache, falling back to DB load."""
    if pipeline_id in _pipelines:
        return _pipelines[pipeline_id]
    return _db_load_pipeline(pipeline_id)


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
    # TTS voice
    voice_id: Optional[str] = None


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


class VariantPreviewInfo(BaseModel):
    """Preview info for a variant (audio/SRT availability)."""
    has_audio: bool = False
    audio_duration: float = 0.0
    has_srt: bool = False


class PipelineStatusResponse(BaseModel):
    """Response model for status endpoint."""
    pipeline_id: str
    scripts: List[str]
    provider: str
    variants: List[VariantStatus]
    preview_info: Dict[str, VariantPreviewInfo] = {}


class PipelineImportRequest(BaseModel):
    """Request model for importing scripts into a new pipeline (from history)."""
    scripts: List[str]
    idea: str = "Imported from history"
    context: str = ""
    provider: str = "imported"


class PipelineListItem(BaseModel):
    """Lightweight pipeline summary for list endpoint."""
    pipeline_id: str
    idea: str
    provider: str
    variant_count: int
    keyword_count: int
    created_at: str


class PipelineListResponse(BaseModel):
    """Response model for list endpoint."""
    pipelines: List[PipelineListItem]
    total: int


# ============== ENDPOINTS ==============

@router.get("/list", response_model=PipelineListResponse)
async def list_pipelines(
    profile: ProfileContext = Depends(get_profile_context),
    limit: int = Query(20, ge=1, le=100)
):
    """
    List recent pipelines for the current profile.

    Returns lightweight summaries (no scripts/previews) ordered by creation date.
    Falls back to in-memory pipelines if DB is unavailable.
    """
    items = []

    # Try DB first
    try:
        supabase = get_supabase()
        if supabase:
            result = supabase.table("editai_pipelines")\
                .select("id, idea, provider, variant_count, keyword_count, created_at")\
                .eq("profile_id", profile.profile_id)\
                .order("created_at", desc=True)\
                .limit(limit)\
                .execute()
            if result.data:
                for row in result.data:
                    items.append(PipelineListItem(
                        pipeline_id=row["id"],
                        idea=row.get("idea", ""),
                        provider=row.get("provider", "gemini"),
                        variant_count=row.get("variant_count", 0),
                        keyword_count=row.get("keyword_count", 0),
                        created_at=row.get("created_at", "")
                    ))
                return PipelineListResponse(pipelines=items, total=len(items))
    except Exception as e:
        logger.warning(f"Failed to list pipelines from DB: {e}")

    # Fallback to in-memory
    profile_pipelines = [
        p for p in _pipelines.values()
        if p.get("profile_id") == profile.profile_id
    ]
    profile_pipelines.sort(key=lambda p: p.get("created_at", ""), reverse=True)

    for p in profile_pipelines[:limit]:
        items.append(PipelineListItem(
            pipeline_id=p["pipeline_id"],
            idea=p.get("idea", ""),
            provider=p.get("provider", "gemini"),
            variant_count=p.get("variant_count", 0),
            keyword_count=p.get("keyword_count", 0),
            created_at=p.get("created_at", "")
        ))

    return PipelineListResponse(pipelines=items, total=len(items))


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Delete a pipeline and all its data from DB and in-memory cache.
    Only the owning profile can delete their pipelines.
    """
    # Remove from in-memory cache
    _pipelines.pop(pipeline_id, None)

    # Remove from DB
    try:
        supabase = get_supabase()
        if supabase:
            # Verify ownership before deleting
            result = supabase.table("editai_pipelines")\
                .select("id, profile_id")\
                .eq("id", pipeline_id)\
                .single()\
                .execute()
            if result.data:
                if result.data.get("profile_id") != profile.profile_id:
                    raise HTTPException(status_code=403, detail="Not authorized to delete this pipeline")
                supabase.table("editai_pipelines")\
                    .delete()\
                    .eq("id", pipeline_id)\
                    .execute()
                logger.info(f"Pipeline {pipeline_id} deleted from DB")
            else:
                raise HTTPException(status_code=404, detail="Pipeline not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to delete pipeline {pipeline_id} from DB: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete pipeline")

    return {"status": "deleted", "pipeline_id": pipeline_id}


@router.post("/import", response_model=PipelineGenerateResponse)
async def import_pipeline(
    request: PipelineImportRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Import scripts into a new pipeline without AI generation.

    Used by the history sidebar to reload scripts from a previous pipeline,
    optionally with a subset of the original scripts.
    """
    if not request.scripts:
        raise HTTPException(status_code=400, detail="scripts list cannot be empty")

    pipeline_id = str(uuid.uuid4())

    _evict_old_pipelines()
    _pipelines[pipeline_id] = {
        "pipeline_id": pipeline_id,
        "scripts": request.scripts,
        "provider": request.provider,
        "idea": request.idea,
        "context": request.context,
        "variant_count": len(request.scripts),
        "keyword_count": 0,
        "previews": {},
        "render_jobs": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "profile_id": profile.profile_id
    }

    _db_save_pipeline(pipeline_id, _pipelines[pipeline_id])

    logger.info(
        f"[Profile {profile.profile_id}] Imported pipeline {pipeline_id} "
        f"with {len(request.scripts)} scripts"
    )

    return PipelineGenerateResponse(
        pipeline_id=pipeline_id,
        scripts=request.scripts,
        provider=request.provider,
        keyword_count=0,
        variant_count=len(request.scripts)
    )


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

        # Store pipeline state (with eviction)
        _evict_old_pipelines()
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
            "created_at": datetime.now(timezone.utc).isoformat(),
            "profile_id": profile.profile_id
        }

        # Persist to DB
        _db_save_pipeline(pipeline_id, _pipelines[pipeline_id])

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
    elevenlabs_model: str = Body("eleven_flash_v2_5", embed=True),
    voice_id: Optional[str] = Body(None, embed=True)
):
    """
    Preview segment matching for a single variant.

    Runs TTS, SRT generation, and keyword matching without expensive render.
    This is step 2 of the workflow: preview before rendering.
    """
    # Validate pipeline exists (with DB fallback)
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

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
            elevenlabs_model=elevenlabs_model,
            voice_id=voice_id
        )

        # Store preview result in pipeline state
        pipeline["previews"][variant_index] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elevenlabs_model": elevenlabs_model,
            "preview_data": preview_data
        }

        # Persist to DB
        _db_save_pipeline(pipeline_id, pipeline)

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
        raise HTTPException(status_code=500, detail="Internal server error")


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
    # Validate pipeline exists (with DB fallback)
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

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
                "started_at": datetime.now(timezone.utc).isoformat()
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
                        voice_id=request.voice_id,
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
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()

                    logger.info(
                        f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                        f"variant {vid} completed: {final_video_path}"
                    )

                    # Persist render result to DB
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

                except Exception as e:
                    logger.error(
                        f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                        f"variant {vid} failed: {e}"
                    )
                    job["status"] = "failed"
                    job["progress"] = 0
                    job["current_step"] = "Render failed"
                    job["error"] = str(e)
                    job["failed_at"] = datetime.now(timezone.utc).isoformat()

                    # Persist failure to DB
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

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
    # Try in-memory first, then DB fallback
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

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

    # Build preview_info from stored previews
    preview_info: Dict[str, VariantPreviewInfo] = {}
    for idx_key, preview_data in pipeline.get("previews", {}).items():
        pd = preview_data.get("preview_data", {}) if isinstance(preview_data, dict) else {}
        audio_path_str = pd.get("audio_path")
        has_audio = bool(audio_path_str and Path(audio_path_str).exists())
        audio_duration = pd.get("audio_duration", 0.0) if has_audio else 0.0
        has_srt = bool(pd.get("srt_content"))
        preview_info[str(idx_key)] = VariantPreviewInfo(
            has_audio=has_audio,
            audio_duration=audio_duration,
            has_srt=has_srt
        )

    return PipelineStatusResponse(
        pipeline_id=pipeline_id,
        scripts=pipeline["scripts"],
        provider=pipeline["provider"],
        variants=variants,
        preview_info=preview_info
    )


@router.get("/audio/{pipeline_id}/{variant_index}")
async def get_pipeline_audio(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Stream the preview audio MP3 for a specific pipeline variant.

    Requires authentication — only the owning profile can access audio.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Look up audio path from preview data
    preview = pipeline.get("previews", {}).get(variant_index)
    if not preview:
        raise HTTPException(status_code=404, detail="No preview available for this variant")

    preview_data = preview.get("preview_data", {})
    audio_path_str = preview_data.get("audio_path")

    if not audio_path_str:
        raise HTTPException(status_code=404, detail="No audio file for this variant")

    audio_path = Path(audio_path_str)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer exists on disk")

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        filename=f"pipeline_{pipeline_id}_variant_{variant_index}.mp3"
    )
