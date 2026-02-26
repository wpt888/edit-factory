"""
Multi-Variant Pipeline API Routes

Orchestrates end-to-end pipeline:
1. Generate N script variants from an idea (Phase 14 script generation)
2. Preview segment matching per variant (Phase 15 assembly preview)
3. Batch-render selected variants with progress tracking (Phase 15 assembly render)
4. Status tracking for all variants in a pipeline

This is the glue layer connecting script generation and assembly into a single workflow.
"""
import hashlib
import logging
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional, Dict
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context


def _stable_hash(text: str) -> str:
    """Stable hash that persists across Python process restarts (unlike built-in hash())."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
from app.db import get_supabase
from app.services.script_generator import get_script_generator
from app.services.assembly_service import get_assembly_service, strip_product_group_tags

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pipeline", tags=["Multi-Variant Pipeline"])

# In-memory pipeline state storage
_pipelines: Dict[str, dict] = {}
_MAX_PIPELINE_ENTRIES = 1000

# Lock for library project creation (prevents duplicate projects from concurrent renders)
_library_project_lock = threading.Lock()


def _evict_old_pipelines():
    """Remove oldest entries if store exceeds max size."""
    if len(_pipelines) > _MAX_PIPELINE_ENTRIES:
        to_remove = sorted(_pipelines.keys(),
            key=lambda k: _pipelines[k].get("created_at", "")
        )[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
        logger.info(f"Evicting {len(to_remove)} old pipelines (cache size: {len(_pipelines)})")
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
        tts_previews_json = {str(k): v for k, v in pipeline_dict.get("tts_previews", {}).items()}

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
            "tts_previews": tts_previews_json,
            "source_video_ids": pipeline_dict.get("source_video_ids", []),
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

        tts_previews = {}
        for k, v in (row.get("tts_previews") or {}).items():
            tts_previews[int(k)] = v
            # Verify audio_path still exists on disk
            if isinstance(v, dict) and v.get("audio_path") and not Path(v["audio_path"]).exists():
                v["audio_path"] = None

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
            "tts_previews": tts_previews,
            "source_video_ids": row.get("source_video_ids") or [],
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
    is_auto_filled: bool = False
    source_video_id: Optional[str] = None
    segment_start_time: Optional[float] = None
    segment_end_time: Optional[float] = None
    thumbnail_path: Optional[str] = None


class PipelinePreviewResponse(BaseModel):
    """Response model for preview endpoint (same as AssemblyPreviewResponse)."""
    audio_duration: float
    srt_content: str
    matches: List[MatchPreview]
    total_phrases: int
    matched_count: int
    unmatched_count: int
    available_segments: List[dict] = []


class PipelineRenderRequest(BaseModel):
    """Request model for batch render."""
    variant_indices: List[int]          # Which variants to render
    preset_name: str = "TikTok"
    source_video_ids: Optional[List[str]] = None  # Filter segments to these source videos
    # Timeline editor overrides: variant_index -> list of match dicts (with optional duration_override)
    match_overrides: Optional[Dict[int, List[dict]]] = None
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
    # ElevenLabs voice settings overrides
    voice_settings: Optional[Dict[str, Any]] = None
    # Subtitle word grouping
    words_per_subtitle: int = 2


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
    thumbnail_path: Optional[str] = None
    error: Optional[str] = None
    library_saved: Optional[bool] = None
    library_error: Optional[str] = None


class VariantPreviewInfo(BaseModel):
    """Preview info for a variant (audio/SRT availability)."""
    has_audio: bool = False
    audio_duration: float = 0.0
    has_srt: bool = False


class VariantTtsInfo(BaseModel):
    """TTS preview info for a variant (Step 2 per-script TTS)."""
    has_audio: bool = False
    audio_duration: float = 0.0


class PipelineStatusResponse(BaseModel):
    """Response model for status endpoint."""
    pipeline_id: str
    scripts: List[str]
    provider: str
    variants: List[VariantStatus]
    preview_info: Dict[str, VariantPreviewInfo] = {}
    tts_info: Dict[str, VariantTtsInfo] = {}


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


class SourceSelectionRequest(BaseModel):
    """Request model for updating source video selection."""
    source_video_ids: List[str]


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
    # Remove from DB (verify ownership first, then clean up in-memory cache)
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

    # Remove from in-memory cache only after ownership verified and DB delete succeeded
    _pipelines.pop(pipeline_id, None)

    return {"status": "deleted", "pipeline_id": pipeline_id}


@router.get("/{pipeline_id}/source-selection")
async def get_source_selection(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Return the stored source_video_ids for a given pipeline.

    Used by the frontend to restore the source video selection when reopening the page.
    Returns an empty list if the column does not exist yet (migration pending).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")
    return {"source_video_ids": pipeline.get("source_video_ids", [])}


@router.put("/{pipeline_id}/source-selection")
async def update_source_selection(
    pipeline_id: str,
    request: SourceSelectionRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Save the selected source video IDs to in-memory state and DB.

    Called whenever the user changes their source video selection on the pipeline page.
    Gracefully degrades if the DB column does not exist yet (migration pending).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    pipeline["source_video_ids"] = request.source_video_ids
    _pipelines[pipeline_id] = pipeline

    # Persist to DB — gracefully handle missing column (migration 021 not yet applied)
    db_persisted = False
    try:
        supabase = get_supabase()
        if supabase:
            supabase.table("editai_pipelines").update({
                "source_video_ids": request.source_video_ids
            }).eq("id", pipeline_id).execute()
            db_persisted = True
    except Exception as e:
        logger.warning(f"Failed to save source selection for {pipeline_id}: {e}")

    return {"source_video_ids": request.source_video_ids, "db_persisted": db_persisted}


class PipelineUpdateScriptsRequest(BaseModel):
    """Request model for updating scripts in an existing pipeline."""
    scripts: List[str]


@router.put("/{pipeline_id}/scripts")
async def update_pipeline_scripts(
    pipeline_id: str,
    request: PipelineUpdateScriptsRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Update scripts for an existing pipeline.

    Used by the frontend auto-save when the user edits script text in Step 2 (Review Scripts).
    Updates both in-memory cache and Supabase.
    """
    if not request.scripts:
        raise HTTPException(status_code=400, detail="scripts list cannot be empty")

    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

    # Invalidate TTS cache for scripts that changed
    # Compare cleaned text (tags stripped) — tag-only changes don't invalidate TTS
    old_scripts = pipeline.get("scripts", [])
    tts_previews = pipeline.setdefault("tts_previews", {})
    for i, new_script in enumerate(request.scripts):
        if i < len(old_scripts):
            old_cleaned = strip_product_group_tags(old_scripts[i])
            new_cleaned = strip_product_group_tags(new_script)
            if _stable_hash(new_cleaned) != _stable_hash(old_cleaned):
                tts_previews.pop(str(i), None)
                tts_previews.pop(i, None)
                logger.info(f"Invalidated TTS cache for pipeline {pipeline_id} variant {i} (script changed)")

    # Update scripts in memory
    pipeline["scripts"] = request.scripts
    pipeline["variant_count"] = len(request.scripts)

    # Persist to DB — convert int keys to strings for JSONB compatibility
    try:
        supabase = get_supabase()
        if supabase:
            tts_previews_json = {str(k): v for k, v in pipeline.get("tts_previews", {}).items()}
            supabase.table("editai_pipelines").update({
                "scripts": request.scripts,
                "variant_count": len(request.scripts),
                "tts_previews": tts_previews_json,
            }).eq("id", pipeline_id).execute()
    except Exception as e:
        logger.warning(f"Failed to update scripts for pipeline {pipeline_id} in DB: {e}")

    logger.info(
        f"[Profile {profile.profile_id}] Updated scripts for pipeline {pipeline_id} "
        f"({len(request.scripts)} scripts)"
    )

    return {"status": "updated", "pipeline_id": pipeline_id, "script_count": len(request.scripts)}


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

    # Fetch unique keywords from editai_segments table, grouped by product_group
    supabase = get_supabase()
    unique_keywords = []
    product_groups_dict = {}  # {group_label: [keywords]}

    if supabase:
        try:
            result = supabase.table("editai_segments")\
                .select("keywords, product_group")\
                .eq("profile_id", profile.profile_id)\
                .execute()

            # Flatten and deduplicate keywords, and group by product_group
            all_keywords = set()
            for seg in result.data:
                keywords_list = seg.get("keywords") or []
                pg = seg.get("product_group")
                for kw in keywords_list:
                    all_keywords.add(kw)
                    if pg:
                        if pg not in product_groups_dict:
                            product_groups_dict[pg] = set()
                        product_groups_dict[pg].add(kw)

            unique_keywords = sorted(all_keywords)
            # Convert sets to sorted lists
            product_groups_dict = {k: sorted(v) for k, v in product_groups_dict.items()}

            logger.info(
                f"[Profile {profile.profile_id}] Fetched {len(unique_keywords)} unique keywords "
                f"from {len(result.data)} segments, {len(product_groups_dict)} product groups"
            )
        except Exception as e:
            logger.warning(f"Failed to fetch keywords from database: {e}")
    else:
        logger.warning("Supabase not available, continuing without keywords")

    # Fetch AI instructions from profile
    ai_instructions = ""
    if supabase:
        try:
            profile_result = supabase.table("profiles")\
                .select("ai_instructions")\
                .eq("id", profile.profile_id)\
                .single()\
                .execute()
            if profile_result.data:
                ai_instructions = profile_result.data.get("ai_instructions") or ""
        except Exception as e:
            logger.warning(f"Failed to fetch AI instructions for profile {profile.profile_id}: {e}")

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
            provider=request.provider,
            product_groups=product_groups_dict if product_groups_dict else None,
            ai_instructions=ai_instructions
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


class PipelineTtsRequest(BaseModel):
    """Request model for per-script TTS generation."""
    elevenlabs_model: str = "eleven_flash_v2_5"
    voice_id: Optional[str] = None
    voice_settings: Optional[Dict[str, Any]] = None
    words_per_subtitle: int = 2


class PipelineTtsResponse(BaseModel):
    """Response model for per-script TTS generation."""
    status: str
    audio_duration: float


class PipelineTtsFromLibraryRequest(BaseModel):
    """Request model for adopting a TTS library asset into the pipeline."""
    asset_id: str


@router.post("/tts-from-library/{pipeline_id}/{variant_index}", response_model=PipelineTtsResponse)
async def adopt_library_tts(
    pipeline_id: str,
    variant_index: int,
    request: PipelineTtsFromLibraryRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Adopt a TTS library asset into the pipeline for a specific variant.

    Skips TTS generation by reusing an existing voice-over from the TTS library.
    The adopted audio is stored in pipeline["tts_previews"] with the same shape
    as generated TTS, plus a library_asset_id flag.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}"
        )

    # Fetch the TTS asset from the library
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_tts_assets")\
            .select("*")\
            .eq("id", request.asset_id)\
            .eq("profile_id", profile.profile_id)\
            .eq("status", "ready")\
            .single()\
            .execute()
    except Exception as e:
        raise HTTPException(status_code=404, detail="TTS asset not found in library")

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found in library")

    asset = result.data
    audio_path = asset.get("mp3_path")
    if not audio_path or not Path(audio_path).exists():
        raise HTTPException(status_code=404, detail="TTS audio file no longer exists on disk")

    audio_duration = asset.get("audio_duration", 0.0)
    script_text = pipeline["scripts"][variant_index]

    # Store into pipeline tts_previews with library flag
    if "tts_previews" not in pipeline:
        pipeline["tts_previews"] = {}

    pipeline["tts_previews"][variant_index] = {
        "audio_path": audio_path,
        "audio_duration": audio_duration,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "script_hash": _stable_hash(script_text),
        "voice_settings": None,  # Not applicable for library audio
        "library_asset_id": request.asset_id,
        "srt_content": asset.get("srt_content"),
        "tts_timestamps": asset.get("tts_timestamps"),
    }

    # Persist to DB
    _db_save_pipeline(pipeline_id, pipeline)

    logger.info(
        f"[Profile {profile.profile_id}] Adopted library TTS asset {request.asset_id} "
        f"for pipeline {pipeline_id} variant {variant_index} ({audio_duration:.1f}s)"
    )

    return PipelineTtsResponse(
        status="ok",
        audio_duration=audio_duration
    )


@router.post("/tts/{pipeline_id}/{variant_index}", response_model=PipelineTtsResponse)
async def generate_variant_tts(
    pipeline_id: str,
    variant_index: int,
    request: PipelineTtsRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generate TTS audio for a single script variant without segment matching.

    Lightweight endpoint for Step 2 per-script voice-over preview.
    Stores result in pipeline["tts_previews"] for later playback.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid variant_index: {variant_index}. Must be between 0 and {len(pipeline['scripts']) - 1}"
        )

    script_text = pipeline["scripts"][variant_index]
    # Strip [ProductGroup] tags before TTS — tags must not be spoken
    cleaned_text = strip_product_group_tags(script_text)

    logger.info(
        f"[Profile {profile.profile_id}] Generating TTS for pipeline {pipeline_id} variant {variant_index}"
    )

    try:
        assembly_service = get_assembly_service()

        audio_path, audio_duration, _timestamps = await assembly_service.generate_tts_with_timestamps(
            script_text=cleaned_text,
            profile_id=profile.profile_id,
            elevenlabs_model=request.elevenlabs_model,
            voice_id=request.voice_id,
            voice_settings=request.voice_settings
        )

        # Store TTS preview result (include voice_settings for reuse invalidation)
        # Use cleaned_text hash so tag changes don't invalidate audio cache
        if "tts_previews" not in pipeline:
            pipeline["tts_previews"] = {}

        pipeline["tts_previews"][variant_index] = {
            "audio_path": str(audio_path),
            "audio_duration": audio_duration,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "script_hash": _stable_hash(cleaned_text),
            "voice_settings": request.voice_settings,
            "words_per_subtitle": request.words_per_subtitle,
        }

        # Persist to DB
        _db_save_pipeline(pipeline_id, pipeline)

        return PipelineTtsResponse(
            status="ok",
            audio_duration=audio_duration
        )

    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] TTS generation failed for variant {variant_index}: {e}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")


@router.get("/tts-audio/{pipeline_id}/{variant_index}")
async def get_variant_tts_audio(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Stream the TTS preview audio for a specific pipeline variant.

    Reads from tts_previews (Step 2 per-script TTS) rather than previews (Step 3 full preview).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    tts_preview = pipeline.get("tts_previews", {}).get(variant_index)
    if not tts_preview:
        raise HTTPException(status_code=404, detail="No TTS preview available for this variant")

    audio_path_str = tts_preview.get("audio_path")
    if not audio_path_str:
        raise HTTPException(status_code=404, detail="No audio file for this variant")

    audio_path = Path(audio_path_str)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file no longer exists on disk")

    return FileResponse(
        path=str(audio_path),
        media_type="audio/mpeg",
        filename=f"pipeline_{pipeline_id}_tts_variant_{variant_index}.mp3"
    )


@router.post("/preview/{pipeline_id}/{variant_index}", response_model=PipelinePreviewResponse)
async def preview_variant(
    pipeline_id: str,
    variant_index: int,
    profile: ProfileContext = Depends(get_profile_context),
    elevenlabs_model: str = Body("eleven_flash_v2_5", embed=True),
    voice_id: Optional[str] = Body(None, embed=True),
    source_video_ids: Optional[List[str]] = Body(None, embed=True),
    voice_settings: Optional[Dict[str, Any]] = Body(None, embed=True),
    words_per_subtitle: int = Body(2, embed=True)
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
    cleaned_text = strip_product_group_tags(script_text)

    logger.info(
        f"[Profile {profile.profile_id}] Previewing pipeline {pipeline_id} variant {variant_index}"
    )

    # Check if TTS audio already exists from Step 2 preview
    existing_tts = pipeline.get("tts_previews", {}).get(variant_index)
    reuse_audio_path = None
    reuse_audio_duration = None
    if existing_tts:
        # Verify script and voice settings haven't changed since TTS was generated
        # TTS hashes use cleaned text (tags stripped) so tag edits don't invalidate
        stored_hash = existing_tts.get("script_hash")
        current_hash = _stable_hash(cleaned_text)
        script_match = stored_hash == current_hash
        # For library audio: skip voice_settings check (same logic as render endpoint)
        is_library = bool(existing_tts.get("library_asset_id"))
        stored_settings = existing_tts.get("voice_settings")
        settings_match = is_library or stored_settings == voice_settings
        if not script_match:
            logger.info(
                f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                f"script_hash mismatch (stored={stored_hash}, current={current_hash})"
            )
        if not settings_match:
            logger.info(
                f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                f"voice_settings mismatch (stored={stored_settings}, incoming={voice_settings})"
            )
        if script_match and settings_match:
            audio_path_str = existing_tts.get("audio_path")
            if audio_path_str and Path(audio_path_str).exists():
                reuse_audio_path = audio_path_str
                reuse_audio_duration = existing_tts.get("audio_duration")
                logger.info(
                    f"[Profile {profile.profile_id}] Reusing Step 2 TTS audio for variant {variant_index}"
                )
            else:
                logger.info(
                    f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                    f"audio_path missing or not on disk (path={audio_path_str})"
                )

    try:
        assembly_service = get_assembly_service()

        preview_data = await assembly_service.preview_matches(
            script_text=script_text,
            profile_id=profile.profile_id,
            elevenlabs_model=elevenlabs_model,
            voice_id=voice_id,
            source_video_ids=source_video_ids,
            variant_index=variant_index,
            reuse_audio_path=reuse_audio_path,
            reuse_audio_duration=reuse_audio_duration,
            voice_settings=voice_settings,
            max_words_per_phrase=words_per_subtitle
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
                confidence=m["confidence"],
                is_auto_filled=m.get("is_auto_filled", False),
                source_video_id=m.get("source_video_id"),
                segment_start_time=m.get("segment_start_time"),
                segment_end_time=m.get("segment_end_time"),
                thumbnail_path=m.get("thumbnail_path"),
            )
            for m in preview_data["matches"]
        ]

        return PipelinePreviewResponse(
            audio_duration=preview_data["audio_duration"],
            srt_content=preview_data["srt_content"],
            matches=matches,
            total_phrases=preview_data["total_phrases"],
            matched_count=preview_data["matched_count"],
            unmatched_count=preview_data["unmatched_count"],
            available_segments=preview_data.get("available_segments", [])
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

    # Build subtitle settings dict (camelCase keys to match SubtitleStyleConfig.from_dict)
    subtitle_settings = {
        "fontSize": request.font_size,
        "fontFamily": request.font_family,
        "textColor": request.text_color,
        "outlineColor": request.outline_color,
        "outlineWidth": request.outline_width,
        "positionY": request.position_y,
        "shadowDepth": request.shadow_depth,
        "enableGlow": request.enable_glow,
        "glowBlur": request.glow_blur,
        "adaptiveSizing": request.adaptive_sizing
    }

    # Store source_video_ids in pipeline state for reference
    if request.source_video_ids:
        pipeline["source_video_ids"] = request.source_video_ids

    # Initialize render jobs for each variant
    for variant_index in request.variant_indices:
        existing_job = pipeline["render_jobs"].get(variant_index)
        if existing_job and existing_job.get("status") == "processing":
            continue  # Skip — already rendering this variant

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

                # Extract match overrides for this variant (from timeline editor)
                variant_match_overrides = None
                if request.match_overrides:
                    variant_match_overrides = request.match_overrides.get(vid) or request.match_overrides.get(str(vid))
                    if variant_match_overrides:
                        logger.info(
                            f"[Profile {profile.profile_id}] Using {len(variant_match_overrides)} "
                            f"match overrides for variant {vid}"
                        )

                # Check for reusable TTS audio from pipeline state
                reuse_audio_path = None
                reuse_audio_duration = None
                reuse_srt_content = None

                # Hash comparison uses cleaned text (tags stripped) to match stored hash
                cleaned_render_text = strip_product_group_tags(script_text)
                existing_tts = pipeline.get("tts_previews", {}).get(vid)
                if existing_tts:
                    script_match = existing_tts.get("script_hash") == _stable_hash(cleaned_render_text)
                    if script_match:
                        # For library audio: skip voice_settings check
                        # For generated audio: compare voice_settings
                        is_library = bool(existing_tts.get("library_asset_id"))
                        settings_match = is_library or existing_tts.get("voice_settings") == request.voice_settings

                        if settings_match:
                            audio_path_str = existing_tts.get("audio_path")
                            if audio_path_str and Path(audio_path_str).exists():
                                reuse_audio_path = audio_path_str
                                reuse_audio_duration = existing_tts.get("audio_duration")
                                reuse_srt_content = existing_tts.get("srt_content")
                                logger.info(
                                    f"[Profile {profile.profile_id}] Reusing "
                                    f"{'library' if is_library else 'cached'} TTS audio "
                                    f"for variant {vid}"
                                )
                                # Skip TTS generation step — jump to segment matching
                                job["current_step"] = "Matching segments"
                                job["progress"] = 30

                # Progress callback: assembly_service calls this at each major step
                def on_progress(step_name: str, pct: int):
                    job["current_step"] = step_name
                    job["progress"] = pct

                # Run full assembly
                final_video_path = await assembly_service.assemble_and_render(
                    script_text=script_text,
                    profile_id=profile.profile_id,
                    preset_data=preset_data,
                    subtitle_settings=subtitle_settings,
                    elevenlabs_model=request.elevenlabs_model,
                    voice_id=request.voice_id,
                    source_video_ids=request.source_video_ids,
                    match_overrides=variant_match_overrides,
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
                    adaptive_sizing=request.adaptive_sizing,
                    variant_index=vid,
                    voice_settings=request.voice_settings,
                    reuse_audio_path=reuse_audio_path,
                    reuse_audio_duration=reuse_audio_duration,
                    reuse_srt_content=reuse_srt_content,
                    on_progress=on_progress,
                    max_words_per_phrase=request.words_per_subtitle
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

                # Save rendered clip to library
                job["library_saved"] = False
                try:
                    supabase_lib = get_supabase()
                    if supabase_lib:
                        # Step A: Get or create a library project (locked to prevent duplicates)
                        library_project_id = pipeline.get("library_project_id")

                        if not library_project_id:
                            with _library_project_lock:
                                # Re-check after acquiring lock (another variant may have created it)
                                library_project_id = pipeline.get("library_project_id")
                                if not library_project_id:
                                    pipeline_name = f"Pipeline: {pipeline.get('idea', '')[:80]}"
                                    existing = supabase_lib.table("editai_projects")\
                                        .select("id")\
                                        .eq("profile_id", profile.profile_id)\
                                        .eq("name", pipeline_name)\
                                        .limit(1)\
                                        .execute()

                                    if existing.data:
                                        library_project_id = existing.data[0]["id"]
                                    else:
                                        proj_result = supabase_lib.table("editai_projects").insert({
                                            "profile_id": profile.profile_id,
                                            "name": pipeline_name,
                                            "description": f"Auto-generated from pipeline {pipeline_id}",
                                            "status": "completed",
                                        }).execute()
                                        if proj_result.data:
                                            library_project_id = proj_result.data[0]["id"]

                                    if library_project_id:
                                        pipeline["library_project_id"] = library_project_id

                        if library_project_id:
                            # Step B: Generate thumbnail
                            thumb_path = None
                            try:
                                thumb_dir = final_video_path.parent / "thumbnails"
                                thumb_dir.mkdir(parents=True, exist_ok=True)
                                thumb_path = thumb_dir / f"{final_video_path.stem}_thumb.jpg"
                                subprocess.run([
                                    "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                                    str(thumb_path)
                                ], capture_output=True, timeout=30)
                                if thumb_path.exists():
                                    job["thumbnail_path"] = str(thumb_path)
                                else:
                                    thumb_path = None
                            except Exception as thumb_err:
                                logger.warning(f"Thumbnail generation failed: {thumb_err}")
                                thumb_path = None

                            # Step C: Get video duration
                            duration = None
                            try:
                                dur_result = subprocess.run([
                                    "ffprobe", "-v", "error", "-show_entries",
                                    "format=duration",
                                    "-of", "default=noprint_wrappers=1:nokey=1",
                                    str(final_video_path)
                                ], capture_output=True, text=True, timeout=30)
                                if dur_result.returncode == 0:
                                    duration = float(dur_result.stdout.strip())
                            except Exception as dur_err:
                                logger.warning(f"Duration probe failed: {dur_err}")

                            # Step D: Insert clip row
                            supabase_lib.table("editai_clips").insert({
                                "project_id": library_project_id,
                                "profile_id": profile.profile_id,
                                "variant_index": vid,
                                "variant_name": f"variant_{vid + 1}",
                                "raw_video_path": str(final_video_path),
                                "final_video_path": str(final_video_path),
                                "thumbnail_path": str(thumb_path) if thumb_path else None,
                                "duration": duration,
                                "is_selected": False,
                                "is_deleted": False,
                                "final_status": "completed"
                            }).execute()

                            job["library_saved"] = True
                            logger.info(
                                f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                                f"variant {vid} saved to library project {library_project_id}"
                            )
                        else:
                            job["library_error"] = "Failed to create or find library project"
                    else:
                        job["library_error"] = "Supabase unavailable"
                except Exception as lib_err:
                    job["library_error"] = str(lib_err)
                    logger.error(
                        f"[Profile {profile.profile_id}] Failed to save pipeline variant "
                        f"{vid} to library: {lib_err}",
                        exc_info=True
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

    **Intentionally public** (no auth) — the pipeline UUID acts as an
    unguessable capability token, enabling status polling without
    re-authenticating on every request.  This is safe because:
    - UUIDs are 128-bit random (2^122 entropy with v4)
    - Pipeline IDs are never exposed in URLs visible to other users
    - Pipelines auto-expire after 30 days
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
                thumbnail_path=job.get("thumbnail_path"),
                error=job.get("error"),
                library_saved=job.get("library_saved"),
                library_error=job.get("library_error")
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

    # Build tts_info from stored tts_previews (Step 2 per-script TTS)
    tts_info: Dict[str, VariantTtsInfo] = {}
    for idx_key, tts_data in pipeline.get("tts_previews", {}).items():
        if isinstance(tts_data, dict):
            audio_path_str = tts_data.get("audio_path")
            has_audio = bool(audio_path_str and Path(audio_path_str).exists())
            audio_duration = tts_data.get("audio_duration", 0.0) if has_audio else 0.0
            tts_info[str(idx_key)] = VariantTtsInfo(
                has_audio=has_audio,
                audio_duration=audio_duration,
            )

    return PipelineStatusResponse(
        pipeline_id=pipeline_id,
        scripts=pipeline["scripts"],
        provider=pipeline["provider"],
        variants=variants,
        preview_info=preview_info,
        tts_info=tts_info,
    )


@router.post("/sync-to-library/{pipeline_id}")
async def sync_pipeline_to_library(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Sync completed pipeline render jobs to the library.

    Creates a library project (if not exists) and inserts clips for each
    completed variant that doesn't already have a clip row.  This is a
    recovery mechanism for when the post-render library-save step failed
    silently.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline["profile_id"] != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    render_jobs: dict = pipeline.get("render_jobs", {})
    completed_variants = {
        int(k): v for k, v in render_jobs.items()
        if isinstance(v, dict) and v.get("status") == "completed" and v.get("final_video_path")
    }

    if not completed_variants:
        return {"synced": 0, "message": "No completed variants to sync"}

    # Get or create a library project for this pipeline
    pipeline_name = f"Pipeline: {pipeline.get('idea', '')[:80]}"
    existing = supabase.table("editai_projects")\
        .select("id")\
        .eq("profile_id", profile.profile_id)\
        .eq("name", pipeline_name)\
        .limit(1)\
        .execute()

    if existing.data:
        library_project_id = existing.data[0]["id"]
    else:
        proj_result = supabase.table("editai_projects").insert({
            "profile_id": profile.profile_id,
            "name": pipeline_name,
            "description": f"Auto-generated from pipeline {pipeline_id}",
            "status": "completed",
        }).execute()
        if not proj_result.data:
            raise HTTPException(status_code=500, detail="Failed to create library project")
        library_project_id = proj_result.data[0]["id"]

    # Check which clips already exist
    existing_clips = supabase.table("editai_clips")\
        .select("variant_index")\
        .eq("project_id", library_project_id)\
        .execute()
    existing_indices = {c["variant_index"] for c in (existing_clips.data or [])}

    synced = 0
    for vid, job in sorted(completed_variants.items()):
        if vid in existing_indices:
            continue

        final_video_path = Path(job["final_video_path"])
        if not final_video_path.exists():
            logger.warning(f"Pipeline {pipeline_id} variant {vid}: video file not found at {final_video_path}")
            continue

        # Thumbnail
        thumb_path = None
        try:
            thumb_dir = final_video_path.parent / "thumbnails"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumb_dir / f"{final_video_path.stem}_thumb.jpg"
            if not thumb_path.exists():
                subprocess.run([
                    "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                    str(thumb_path)
                ], capture_output=True, timeout=30)
            if not thumb_path.exists():
                thumb_path = None
        except Exception:
            thumb_path = None

        # Duration
        duration = None
        try:
            dur_result = subprocess.run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(final_video_path)
            ], capture_output=True, text=True, timeout=30)
            if dur_result.returncode == 0:
                duration = float(dur_result.stdout.strip())
        except Exception:
            pass

        # Insert clip
        supabase.table("editai_clips").insert({
            "project_id": library_project_id,
            "profile_id": profile.profile_id,
            "variant_index": vid,
            "variant_name": f"variant_{vid + 1}",
            "raw_video_path": str(final_video_path),
            "final_video_path": str(final_video_path),
            "thumbnail_path": str(thumb_path) if thumb_path else None,
            "duration": duration,
            "is_selected": False,
            "is_deleted": False,
            "final_status": "completed"
        }).execute()

        # Mark as saved in render_jobs so status endpoint reflects it
        job["library_saved"] = True
        job.pop("library_error", None)

        synced += 1
        logger.info(f"Pipeline {pipeline_id} variant {vid} synced to library project {library_project_id}")

    # Persist updated render_jobs (with library_saved flags)
    if synced > 0:
        _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

    # Update project variants_count
    if synced > 0:
        total_clips = supabase.table("editai_clips")\
            .select("id", count="exact")\
            .eq("project_id", library_project_id)\
            .execute()
        supabase.table("editai_projects")\
            .update({"variants_count": total_clips.count or synced})\
            .eq("id", library_project_id)\
            .execute()

    return {
        "synced": synced,
        "library_project_id": library_project_id,
        "message": f"Synced {synced} variant(s) to library"
    }


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
        # Fall back to Step 2 TTS preview audio
        tts_preview = pipeline.get("tts_previews", {}).get(variant_index) or \
                      pipeline.get("tts_previews", {}).get(str(variant_index))
        if tts_preview:
            audio_path_str = tts_preview.get("audio_path")
            if audio_path_str:
                audio_path = Path(audio_path_str)
                if audio_path.exists():
                    return FileResponse(path=str(audio_path), media_type="audio/mpeg",
                        filename=f"pipeline_{pipeline_id}_variant_{variant_index}.mp3")
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
