"""
Multi-Variant Pipeline API Routes

Orchestrates end-to-end pipeline:
1. Generate N script variants from an idea (Phase 14 script generation)
2. Preview segment matching per variant (Phase 15 assembly preview)
3. Batch-render selected variants with progress tracking (Phase 15 assembly render)
4. Status tracking for all variants in a pipeline

This is the glue layer connecting script generation and assembly into a single workflow.
"""
import asyncio
import hashlib
import logging
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional, Dict
from pathlib import Path

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Body, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.db import get_supabase
from app.rate_limit import limiter
from app.services.script_generator import get_script_generator
from app.services.assembly_service import get_assembly_service, strip_product_group_tags

# Global FFmpeg concurrency — shared across ALL routes (library, pipeline, product)
from app.services.ffmpeg_semaphore import acquire_render_slot, acquire_preview_slot, check_disk_space, safe_ffmpeg_run, is_nvenc_available


def _stable_hash(text: str) -> str:
    """Stable hash that persists across Python process restarts (unlike built-in hash())."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pipeline", tags=["Multi-Variant Pipeline"])

# In-memory pipeline state storage
_pipelines: Dict[str, dict] = {}
_MAX_PIPELINE_ENTRIES = 1000

# Lock for library project creation (prevents duplicate projects from concurrent renders)
_library_project_lock = threading.Lock()

# Per-pipeline render locks (prevents race conditions in concurrent variant renders)
_render_locks: Dict[str, threading.Lock] = {}
_render_locks_timestamps: Dict[str, float] = {}  # pipeline_id -> last acquired time
_RENDER_LOCK_TTL = 3600  # 1 hour

# Cancel infrastructure for pipeline renders
import time as _time_mod

_cancelled_pipelines: Dict[str, float] = {}  # pipeline_id -> monotonic timestamp
_cancelled_pipelines_lock = threading.Lock()
_MAX_CANCELLED_PIPELINES = 200


def is_pipeline_cancelled(pipeline_id: str) -> bool:
    """Check if a pipeline has been flagged for cancellation."""
    with _cancelled_pipelines_lock:
        return pipeline_id in _cancelled_pipelines


def mark_pipeline_cancelled(pipeline_id: str):
    """Flag a pipeline for cancellation."""
    with _cancelled_pipelines_lock:
        _cancelled_pipelines[pipeline_id] = _time_mod.monotonic()
        if len(_cancelled_pipelines) > _MAX_CANCELLED_PIPELINES:
            sorted_ids = sorted(_cancelled_pipelines, key=_cancelled_pipelines.get)
            for pid in sorted_ids[:len(_cancelled_pipelines) - _MAX_CANCELLED_PIPELINES]:
                _cancelled_pipelines.pop(pid, None)


def clear_pipeline_cancelled(pipeline_id: str):
    """Clear the cancellation flag for a pipeline."""
    with _cancelled_pipelines_lock:
        _cancelled_pipelines.pop(pipeline_id, None)


def _evict_stale_render_locks():
    """Evict render locks not acquired for over 1 hour.

    Only evicts a lock if it can be acquired non-blocking (i.e., nobody holds it).
    This prevents deleting a lock while another render is still using it.
    """
    import time
    now = time.monotonic()
    stale = [k for k, ts in _render_locks_timestamps.items() if now - ts > _RENDER_LOCK_TTL]
    evicted = 0
    for k in stale:
        lock = _render_locks.get(k)
        if lock is None:
            # Lock already removed, just clean up timestamp
            _render_locks_timestamps.pop(k, None)
            evicted += 1
            continue
        # Only evict if we can acquire the lock (nobody is holding it)
        if lock.acquire(blocking=False):
            lock.release()
            _render_locks.pop(k, None)
            _render_locks_timestamps.pop(k, None)
            evicted += 1
        else:
            # Lock is held — skip eviction, update timestamp to retry later
            logger.debug(f"Skipping eviction of render lock {k} — still held")
    if evicted:
        logger.debug(f"Evicted {evicted} stale render lock(s)")


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
            "profile_id": pipeline_dict.get("profile_id"),
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
            try:
                previews[int(k)] = v
            except (ValueError, TypeError):
                logger.warning(f"Skipping invalid preview key: {k}")
                continue
            # Verify audio_path still exists on disk
            if isinstance(v, dict) and "preview_data" in v:
                pd = v["preview_data"]
                if pd.get("audio_path") and not Path(pd["audio_path"]).exists():
                    pd["audio_path"] = None

        render_jobs = {}
        for k, v in (row.get("render_jobs") or {}).items():
            try:
                render_jobs[int(k)] = v
            except (ValueError, TypeError):
                logger.warning(f"Skipping invalid render_jobs key: {k}")
                continue

        tts_previews = {}
        for k, v in (row.get("tts_previews") or {}).items():
            try:
                tts_previews[int(k)] = v
            except (ValueError, TypeError):
                logger.warning(f"Skipping invalid tts_previews key: {k}")
                continue
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


def _compute_segment_duration(profile_id: str) -> float:
    """Compute total duration of all segments for a profile."""
    supabase = get_supabase()
    if not supabase:
        return 0.0
    try:
        result = supabase.table("editai_segments")\
            .select("start_time, end_time")\
            .eq("profile_id", profile_id)\
            .execute()
        total = 0.0
        for seg in result.data:
            start = seg.get("start_time")
            end = seg.get("end_time")
            if start is not None and end is not None:
                total += max(0, float(end) - float(start))
        return round(total, 1)
    except Exception as e:
        logger.warning(f"Failed to compute segment duration: {e}")
        return 0.0


def _voice_settings_match(a: Optional[dict], b: Optional[dict]) -> bool:
    """Compare voice settings dicts with tolerance for float precision differences."""
    if a is None or b is None:
        return a is b
    if set(a.keys()) != set(b.keys()):
        return False
    for key in a:
        va, vb = a[key], b[key]
        if isinstance(va, (int, float)) and isinstance(vb, (int, float)):
            if abs(va - vb) > 0.01:
                return False
        elif va != vb:
            return False
    return True


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
    total_segment_duration: float = 0.0 # Total duration (seconds) of available video segments


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
    merge_group: Optional[int] = None
    merge_group_duration: Optional[float] = None


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
    # Minimum video segment duration (seconds) — groups short SRT phrases
    min_segment_duration: float = 3.0
    # Ultra-rapid intro: 3-4 micro-segments at the start for hook effect
    ultra_rapid_intro: bool = True
    # Interstitial product image slides: variant_index -> list of slide configs
    # Phase 46 will implement FFmpeg rendering — this phase just stores the data
    interstitial_slides: Optional[Dict[str, List[dict]]] = None
    # PiP overlay configs: segment_id -> { image_url, position, size, animation }
    pip_overlays: Optional[Dict[str, dict]] = None


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
    clip_id: Optional[str] = None
    error: Optional[str] = None
    library_saved: Optional[bool] = None
    library_error: Optional[str] = None
    render_fingerprint: Optional[str] = None


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


@router.post("/{pipeline_id}/cancel")
async def cancel_pipeline_render(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cancel an in-progress pipeline render."""
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Not authorized")

    mark_pipeline_cancelled(pipeline_id)

    # Mark all processing render jobs as cancelled
    for idx, job in pipeline.get("render_jobs", {}).items():
        if job.get("status") == "processing":
            job["status"] = "cancelled"
            job["current_step"] = "Cancelled by user"
            job["progress"] = 0

    _db_update_render_jobs(pipeline_id, pipeline.get("render_jobs", {}))

    return {"status": "cancelled", "pipeline_id": pipeline_id}


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
    if pipeline.get("profile_id") != profile.profile_id:
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
    if pipeline.get("profile_id") != profile.profile_id:
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
    if len(request.scripts) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 scripts allowed")
    for i, script in enumerate(request.scripts):
        if len(script) > 5000:
            raise HTTPException(status_code=400, detail=f"Script {i+1} exceeds 5000 character limit ({len(script)} chars)")

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

    # Clean up orphan TTS entries for removed script indices
    new_count = len(request.scripts)
    orphan_keys = []
    for k in list(tts_previews.keys()):
        try:
            if int(str(k)) >= new_count:
                orphan_keys.append(k)
        except (ValueError, TypeError):
            orphan_keys.append(k)  # Remove invalid keys
    for k in orphan_keys:
        tts_previews.pop(k, None)

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

        except Exception as e:
            logger.warning(f"Failed to fetch keywords from database: {e}")
    else:
        logger.warning("Supabase not available, continuing without keywords")

    # Compute total segment duration using shared helper
    total_segment_duration = _compute_segment_duration(profile.profile_id)

    logger.info(
        f"[Profile {profile.profile_id}] Fetched {len(unique_keywords)} unique keywords, "
        f"{len(product_groups_dict)} product groups, "
        f"total segment duration: {total_segment_duration:.1f}s"
    )

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
            ai_instructions=ai_instructions,
            target_duration=total_segment_duration if total_segment_duration > 0 else None
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
            variant_count=len(scripts),
            total_segment_duration=round(total_segment_duration, 1)
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Pipeline generation failed: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Pipeline generation service unavailable: {str(e)}"
        )


@router.get("/segment-duration")
async def get_segment_duration(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Return total duration (seconds) of all segments for the current profile."""
    total = _compute_segment_duration(profile.profile_id)
    return {"total_segment_duration": total}


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
    srt_content: Optional[str] = None
    script_word_count: Optional[int] = None
    srt_word_count: Optional[int] = None


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

    if pipeline.get("profile_id") != profile.profile_id:
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

    if pipeline.get("profile_id") != profile.profile_id:
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

        # Generate SRT from timestamps for subtitle preview
        srt_content = None
        script_word_count = None
        srt_word_count = None
        if _timestamps:
            wpf = request.words_per_subtitle or 2
            srt_content = await assembly_service.generate_srt_from_timestamps(
                _timestamps,
                max_words_per_phrase=wpf
            )
            # Populate SRT cache so Step 3 preview_matches finds a hit
            # (prevents unnecessary TTS regeneration that produces different audio)
            if srt_content:
                from app.services.tts_cache import srt_cache_store
                _srt_cache_key = {
                    "text": cleaned_text,
                    "voice_id": request.voice_id or "",
                    "model_id": request.elevenlabs_model,
                    "provider": "elevenlabs_ts",
                    "wpf": wpf
                }
                srt_cache_store(_srt_cache_key, srt_content)
            # Count words in script vs SRT for validation
            script_word_count = len(cleaned_text.split())
            if srt_content:
                srt_word_count = sum(
                    len(line.split())
                    for line in srt_content.split('\n')
                    if line.strip() and not line.strip().isdigit() and '-->' not in line
                )
            else:
                srt_word_count = 0

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
            "srt_content": srt_content,
            "script_word_count": script_word_count,
            "srt_word_count": srt_word_count,
        }

        # Persist to DB
        _db_save_pipeline(pipeline_id, pipeline)

        return PipelineTtsResponse(
            status="ok",
            audio_duration=audio_duration,
            srt_content=srt_content,
            script_word_count=script_word_count,
            srt_word_count=srt_word_count
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
    pipeline = await asyncio.to_thread(_get_pipeline_or_load, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
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
        content_disposition_type="inline",
        headers={"Cache-Control": "public, max-age=3600"}
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
    words_per_subtitle: int = Body(2, embed=True),
    min_segment_duration: float = Body(3.0, embed=True),
    ultra_rapid_intro: bool = Body(True, embed=True)
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
    if pipeline.get("profile_id") != profile.profile_id:
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
    # Normalize key lookup: prefer int key, fall back to str for legacy entries
    _tts_previews = pipeline.get("tts_previews", {})
    existing_tts = _tts_previews.get(variant_index) or _tts_previews.get(str(variant_index))
    reuse_audio_path = None
    reuse_audio_duration = None
    reuse_srt_content = None
    if existing_tts:
        # Verify script and voice settings haven't changed since TTS was generated
        # TTS hashes use cleaned text (tags stripped) so tag edits don't invalidate
        stored_hash = existing_tts.get("script_hash")
        current_hash = _stable_hash(cleaned_text)
        script_match = stored_hash == current_hash
        # For library audio: skip voice_settings check (same logic as render endpoint)
        is_library = bool(existing_tts.get("library_asset_id"))
        stored_settings = existing_tts.get("voice_settings")
        settings_match = is_library or _voice_settings_match(stored_settings, voice_settings)
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
            if audio_path_str and Path(audio_path_str).exists() and Path(audio_path_str).stat().st_size > 100:
                reuse_audio_path = audio_path_str
                reuse_audio_duration = existing_tts.get("audio_duration")
                # Also grab SRT content from Step 2 to avoid TTS regeneration
                stored_srt = existing_tts.get("srt_content")
                stored_wpf = existing_tts.get("words_per_subtitle")
                if stored_srt and stored_wpf == words_per_subtitle:
                    reuse_srt_content = stored_srt
                logger.info(
                    f"[Profile {profile.profile_id}] Reusing Step 2 TTS audio for variant {variant_index}"
                    f"{' (with SRT)' if reuse_srt_content else ' (SRT not available)'}"
                )
            else:
                logger.info(
                    f"[Profile {profile.profile_id}] TTS reuse SKIP for variant {variant_index}: "
                    f"audio_path missing or not on disk (path={audio_path_str})"
                )

    try:
        assembly_service = get_assembly_service()

        # Cross-variant deprioritization: gather segments used by OTHER variants
        avoid_ids = set()
        for other_idx, used_set in pipeline.get("segment_usage", {}).items():
            if str(other_idx) != str(variant_index):
                avoid_ids.update(used_set)
        if avoid_ids:
            logger.info(
                f"[Profile {profile.profile_id}] Variant {variant_index}: "
                f"deprioritizing {len(avoid_ids)} segments used by other variants"
            )

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
            max_words_per_phrase=words_per_subtitle,
            min_segment_duration=min_segment_duration,
            avoid_segment_ids=avoid_ids if avoid_ids else None,
            ultra_rapid_intro=ultra_rapid_intro,
            reuse_srt_content=reuse_srt_content
        )

        # Track which segments this variant used (for cross-variant deprioritization)
        used_segment_ids = list({
            m["segment_id"] for m in preview_data.get("matches", [])
            if m.get("segment_id")
        })
        pipeline.setdefault("segment_usage", {})[str(variant_index)] = used_segment_ids

        # Store preview result in pipeline state
        pipeline["previews"][variant_index] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "elevenlabs_model": elevenlabs_model,
            "preview_data": preview_data
        }

        # Persist SRT content into tts_previews so Step 3 render can reuse it
        # without calling ElevenLabs a second time just to get subtitle timestamps.
        if "tts_previews" not in pipeline:
            pipeline["tts_previews"] = {}
        if variant_index not in pipeline["tts_previews"]:
            pipeline["tts_previews"][variant_index] = {}
        pipeline["tts_previews"][variant_index]["srt_content"] = preview_data.get("srt_content", "")
        pipeline["tts_previews"][variant_index]["words_per_subtitle"] = words_per_subtitle
        # Also persist audio info from preview_data if tts_previews was empty
        # (covers the case where Step 2 standalone TTS was skipped entirely)
        if not pipeline["tts_previews"][variant_index].get("audio_path"):
            pipeline["tts_previews"][variant_index]["audio_path"] = preview_data.get("audio_path", "")
            pipeline["tts_previews"][variant_index]["audio_duration"] = preview_data.get("audio_duration", 0.0)
            pipeline["tts_previews"][variant_index]["script_hash"] = _stable_hash(cleaned_text)
            pipeline["tts_previews"][variant_index]["timestamp"] = datetime.now(timezone.utc).isoformat()

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
                merge_group=m.get("merge_group"),
                merge_group_duration=m.get("merge_group_duration"),
            )
            for m in preview_data.get("matches", [])
        ]

        return PipelinePreviewResponse(
            audio_duration=preview_data.get("audio_duration", 0.0),
            srt_content=preview_data.get("srt_content", ""),
            matches=matches,
            total_phrases=preview_data.get("total_phrases", 0),
            matched_count=preview_data.get("matched_count", 0),
            unmatched_count=preview_data.get("unmatched_count", 0),
            available_segments=preview_data.get("available_segments", [])
        )

    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Preview failed for variant {variant_index}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/render/{pipeline_id}", response_model=PipelineRenderResponse)
@limiter.limit("5/minute")
async def render_variants(
    request: Request,
    pipeline_id: str,
    render_request: PipelineRenderRequest,
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
    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    # Validate all variant indices
    for idx in render_request.variant_indices:
        if idx < 0 or idx >= len(pipeline["scripts"]):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid variant_index: {idx}. Must be between 0 and {len(pipeline['scripts']) - 1}"
            )

    logger.info(
        f"[Profile {profile.profile_id}] Starting render for pipeline {pipeline_id}, "
        f"variants: {render_request.variant_indices}"
    )
    if render_request.interstitial_slides:
        logger.info(
            "[Profile %s] Received %d variant(s) with interstitial slides",
            profile.profile_id, len(render_request.interstitial_slides)
        )
    if render_request.pip_overlays:
        logger.info(
            "[Profile %s] Received %d segment(s) with PiP overlays",
            profile.profile_id, len(render_request.pip_overlays)
        )

    # Fetch preset data
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        preset_result = supabase.table("editai_export_presets")\
            .select("*")\
            .eq("name", render_request.preset_name)\
            .single()\
            .execute()

        if preset_result.data:
            preset_data = preset_result.data
        else:
            logger.warning(f"Preset '{render_request.preset_name}' not found, using default")
            preset_data = {
                "name": render_request.preset_name,
                "width": 1080,
                "height": 1920,
                "fps": 30,
                "video_codec": "h264_nvenc" if is_nvenc_available() else "libx264",
                "audio_codec": "aac",
                "video_bitrate": "3M",
                "audio_bitrate": "192k"
            }
    except Exception as e:
        logger.error(f"Failed to fetch preset: {e}")
        preset_data = {
            "name": render_request.preset_name,
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "video_codec": "h264_nvenc" if is_nvenc_available() else "libx264",
            "audio_codec": "aac",
            "video_bitrate": "3M",
            "audio_bitrate": "192k"
        }

    # Build subtitle settings dict (camelCase keys to match SubtitleStyleConfig.from_dict)
    subtitle_settings = {
        "fontSize": render_request.font_size,
        "fontFamily": render_request.font_family,
        "textColor": render_request.text_color,
        "outlineColor": render_request.outline_color,
        "outlineWidth": render_request.outline_width,
        "positionY": render_request.position_y,
        "shadowDepth": render_request.shadow_depth,
        "enableGlow": render_request.enable_glow,
        "glowBlur": render_request.glow_blur,
        "adaptiveSizing": render_request.adaptive_sizing
    }

    # Store source_video_ids in pipeline state for reference
    if render_request.source_video_ids:
        pipeline["source_video_ids"] = render_request.source_video_ids

    # Lock to guard concurrent writes to pipeline["render_jobs"]
    pipeline_id_str = str(pipeline_id)
    _evict_stale_render_locks()
    if pipeline_id_str not in _render_locks:
        _render_locks[pipeline_id_str] = threading.Lock()
    import time as _time
    _render_locks_timestamps[pipeline_id_str] = _time.monotonic()
    render_jobs_lock = _render_locks[pipeline_id_str]

    # Initialize render jobs for each variant and collect which ones to render
    variant_indices_to_render = []
    for variant_index in render_request.variant_indices:
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
        variant_indices_to_render.append(variant_index)

    # Define render function for a single variant
    async def do_render(vid):
        try:
            # ── Render fingerprint: unique hash of ALL render-affecting parameters ──
            import hashlib as _hashlib
            _fp_parts = [
                f"vid={vid}",
                f"preset={render_request.preset_name}",
                f"voice={render_request.voice_id}",
                f"model={render_request.elevenlabs_model}",
                f"wpf={render_request.words_per_subtitle}",
                f"min_seg={render_request.min_segment_duration}",
                f"ultra_rapid={render_request.ultra_rapid_intro}",
                f"font={render_request.font_size}/{render_request.font_family}",
                f"colors={render_request.text_color}/{render_request.outline_color}",
                f"denoise={render_request.enable_denoise}/{render_request.denoise_strength}",
                f"sharpen={render_request.enable_sharpen}/{render_request.sharpen_amount}",
                f"color={render_request.enable_color}/{render_request.brightness}/{render_request.contrast}/{render_request.saturation}",
            ]
            # Include match_overrides segment IDs in fingerprint
            _mo = render_request.match_overrides
            if _mo:
                _mo_variant = _mo.get(vid) or _mo.get(str(vid))
                if _mo_variant:
                    _seg_ids = [m.get("segment_id", "none") for m in _mo_variant]
                    _fp_parts.append(f"segments={','.join(str(s) for s in _seg_ids)}")
            _render_fingerprint = _hashlib.md5("|".join(_fp_parts).encode()).hexdigest()[:12]

            logger.info(
                f"[Profile {profile.profile_id}] ═══ RENDER START ═══ "
                f"pipeline={pipeline_id} variant={vid} fingerprint={_render_fingerprint}"
            )
            logger.info(
                f"[RENDER {_render_fingerprint}] Parameters: {' | '.join(_fp_parts)}"
            )

            job = pipeline["render_jobs"][vid]
            script_text = pipeline["scripts"][vid]

            # Check for cancellation before starting
            if is_pipeline_cancelled(pipeline_id):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["current_step"] = "Cancelled by user"
                    job["progress"] = 0
                logger.info(f"Pipeline {pipeline_id} variant {vid} cancelled before start")
                return

            # Update progress
            with render_jobs_lock:
                job["current_step"] = "Generating TTS audio"
                job["progress"] = 10

            # Pre-render disk space check
            from app.config import get_settings as _get_settings
            check_disk_space(_get_settings().output_dir)

            assembly_service = get_assembly_service()

            # Extract match overrides for this variant (from timeline editor)
            variant_match_overrides = None
            if render_request.match_overrides:
                variant_match_overrides = render_request.match_overrides.get(vid) or render_request.match_overrides.get(str(vid))
                if variant_match_overrides:
                    logger.info(
                        f"[RENDER {_render_fingerprint}] Using {len(variant_match_overrides)} "
                        f"match overrides for variant {vid}"
                    )
                    # Log each match override for debugging
                    for _mi, _mo_entry in enumerate(variant_match_overrides[:10]):  # first 10
                        logger.info(
                            f"[RENDER {_render_fingerprint}]   override[{_mi}]: "
                            f"srt_idx={_mo_entry.get('srt_index')} "
                            f"seg_id={_mo_entry.get('segment_id', 'NONE')!r} "
                            f"text={_mo_entry.get('srt_text', '')[:40]!r} "
                            f"start={_mo_entry.get('srt_start'):.2f}-{_mo_entry.get('srt_end'):.2f}"
                        )
                else:
                    logger.warning(
                        f"[RENDER {_render_fingerprint}] match_overrides present but EMPTY "
                        f"for variant {vid} (keys: {list(render_request.match_overrides.keys())})"
                    )
            else:
                logger.warning(
                    f"[RENDER {_render_fingerprint}] NO match_overrides sent — "
                    f"render will use auto-matching (may differ from preview!)"
                )

            # Extract interstitial slides for this variant (stored for Phase 46 render integration)
            variant_interstitial_slides = None
            if render_request.interstitial_slides:
                variant_interstitial_slides = render_request.interstitial_slides.get(str(vid)) or render_request.interstitial_slides.get(vid)
                if variant_interstitial_slides:
                    logger.info(
                        f"[Profile {profile.profile_id}] Received {len(variant_interstitial_slides)} "
                        f"interstitial slide(s) for variant {vid} (stored for Phase 46 render)"
                    )

            # Check for reusable TTS audio from pipeline state
            reuse_audio_path = None
            reuse_audio_duration = None
            reuse_srt_content = None

            # Hash comparison uses cleaned text (tags stripped) to match stored hash
            cleaned_render_text = strip_product_group_tags(script_text)
            # Normalize key lookup: prefer int key, fall back to str for legacy entries
            _tts_previews_render = pipeline.get("tts_previews", {})
            existing_tts = _tts_previews_render.get(vid) or _tts_previews_render.get(str(vid))
            if existing_tts:
                script_match = existing_tts.get("script_hash") == _stable_hash(cleaned_render_text)
                if script_match:
                    # For library audio: skip voice_settings check
                    # For generated audio: compare voice_settings
                    is_library = bool(existing_tts.get("library_asset_id"))
                    settings_match = is_library or _voice_settings_match(existing_tts.get("voice_settings"), render_request.voice_settings)

                    if settings_match:
                        audio_path_str = existing_tts.get("audio_path")
                        if audio_path_str and Path(audio_path_str).exists() and Path(audio_path_str).stat().st_size > 100:
                            reuse_audio_path = audio_path_str
                            reuse_audio_duration = existing_tts.get("audio_duration")

                            # ── SRT reuse guard ──────────────────────────────
                            # Only reuse cached SRT if words_per_subtitle hasn't
                            # changed since the preview generated it.  The SRT
                            # groups words into subtitle phrases using this param;
                            # reusing a stale SRT would show wrong subtitle grouping.
                            cached_wpf = existing_tts.get("words_per_subtitle")
                            render_wpf = render_request.words_per_subtitle
                            if cached_wpf is not None and cached_wpf != render_wpf:
                                logger.info(
                                    f"[RENDER {_render_fingerprint}] SRT reuse BLOCKED: "
                                    f"words_per_subtitle changed ({cached_wpf} -> {render_wpf})"
                                )
                                # Audio is still reusable, only SRT needs regeneration
                                reuse_srt_content = None
                            else:
                                reuse_srt_content = existing_tts.get("srt_content")

                            logger.info(
                                f"[RENDER {_render_fingerprint}] Reusing "
                                f"{'library' if is_library else 'cached'} TTS audio "
                                f"for variant {vid} "
                                f"(srt_reused={'YES' if reuse_srt_content else 'NO'})"
                            )
                            # Skip TTS generation step — jump to segment matching
                            with render_jobs_lock:
                                job["current_step"] = "Matching segments"
                                job["progress"] = 30
                    else:
                        logger.info(
                            f"[RENDER {_render_fingerprint}] TTS reuse BLOCKED: "
                            f"voice_settings mismatch"
                        )
                else:
                    logger.info(
                        f"[RENDER {_render_fingerprint}] TTS reuse BLOCKED: "
                        f"script_hash mismatch"
                    )
            else:
                logger.info(
                    f"[RENDER {_render_fingerprint}] No cached TTS found — "
                    f"will generate fresh audio"
                )

            # Progress callback: assembly_service calls this at each major step
            def on_progress(step_name: str, pct: int):
                with render_jobs_lock:
                    job["current_step"] = step_name
                    job["progress"] = pct

            # Extract overlay params for this variant
            # interstitial_slides is keyed by variant index (string); pip_overlays is shared (keyed by segment_id)
            variant_interstitial_slides = None
            if render_request.interstitial_slides:
                variant_slides = render_request.interstitial_slides.get(str(vid), [])
                if variant_slides:
                    variant_interstitial_slides = variant_slides
                    logger.info(f"[Pipeline {pipeline_id}] Variant {vid}: {len(variant_slides)} interstitial slides")

            variant_pip_overlays = render_request.pip_overlays if render_request.pip_overlays else None
            if variant_pip_overlays:
                logger.info(f"[Pipeline {pipeline_id}] Variant {vid}: {len(variant_pip_overlays)} PiP overlays")

            # Cross-variant deprioritization for render
            render_avoid_ids = set()
            for other_idx, used_set in pipeline.get("segment_usage", {}).items():
                if str(other_idx) != str(vid):
                    if isinstance(used_set, list):
                        render_avoid_ids.update(used_set)
                    else:
                        render_avoid_ids.update(used_set)

            # Check for cancellation before heavy render
            if is_pipeline_cancelled(pipeline_id):
                with render_jobs_lock:
                    job["status"] = "cancelled"
                    job["current_step"] = "Cancelled by user"
                    job["progress"] = 0
                logger.info(f"Pipeline {pipeline_id} variant {vid} cancelled before render")
                return

            # Run full assembly (with 15-minute timeout)
            try:
                final_video_path = await asyncio.wait_for(
                    assembly_service.assemble_and_render(
                        script_text=script_text,
                        profile_id=profile.profile_id,
                        preset_data=preset_data,
                        subtitle_settings=subtitle_settings,
                        elevenlabs_model=render_request.elevenlabs_model,
                        voice_id=render_request.voice_id,
                        source_video_ids=render_request.source_video_ids,
                        match_overrides=variant_match_overrides,
                        enable_denoise=render_request.enable_denoise,
                        denoise_strength=render_request.denoise_strength,
                        enable_sharpen=render_request.enable_sharpen,
                        sharpen_amount=render_request.sharpen_amount,
                        enable_color=render_request.enable_color,
                        brightness=render_request.brightness,
                        contrast=render_request.contrast,
                        saturation=render_request.saturation,
                        shadow_depth=render_request.shadow_depth,
                        enable_glow=render_request.enable_glow,
                        glow_blur=render_request.glow_blur,
                        adaptive_sizing=render_request.adaptive_sizing,
                        variant_index=vid,
                        voice_settings=render_request.voice_settings,
                        reuse_audio_path=reuse_audio_path,
                        reuse_audio_duration=reuse_audio_duration,
                        reuse_srt_content=reuse_srt_content,
                        on_progress=on_progress,
                        max_words_per_phrase=render_request.words_per_subtitle,
                        min_segment_duration=render_request.min_segment_duration,
                        ultra_rapid_intro=render_request.ultra_rapid_intro,
                        interstitial_slides=variant_interstitial_slides,
                        pip_overlays=variant_pip_overlays,
                        avoid_segment_ids=render_avoid_ids if render_avoid_ids else None,
                    ),
                    timeout=900
                )
            except asyncio.TimeoutError:
                raise Exception("Render timed out after 15 minutes")
            except RuntimeError as rt_err:
                # Catch specific assembly errors (e.g., "No segments found in library.")
                # so the job is marked failed with a clear message instead of stuck in "processing"
                logger.error(
                    f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                    f"variant {vid} assembly error: {rt_err}"
                )
                with render_jobs_lock:
                    job["status"] = "failed"
                    job["progress"] = 0
                    job["current_step"] = "Assembly failed"
                    job["error"] = str(rt_err)
                    job["failed_at"] = datetime.now(timezone.utc).isoformat()
                    _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])
                return

            # Success — acquire lock before writing shared render_jobs dict
            with render_jobs_lock:
                job["status"] = "completed"
                job["progress"] = 100
                job["current_step"] = "Render complete"
                job["final_video_path"] = str(final_video_path)
                job["render_fingerprint"] = _render_fingerprint
                job["completed_at"] = datetime.now(timezone.utc).isoformat()

                # Log final output for debugging stale-video reports
                _file_size_mb = 0
                try:
                    _file_size_mb = final_video_path.stat().st_size / (1024 * 1024)
                except Exception:
                    pass
                logger.info(
                    f"[RENDER {_render_fingerprint}] ═══ RENDER COMPLETE ═══ "
                    f"output={final_video_path.name} size={_file_size_mb:.1f}MB"
                )

                logger.info(
                    f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                    f"variant {vid} completed: {final_video_path}"
                )

                # Persist render result to DB
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

            # Save rendered clip to library
            with render_jobs_lock:
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

                                # Insert-or-fetch: attempt insert first, fall back to
                                # select if a concurrent request already created the row.
                                # This eliminates the TOCTOU race between SELECT and INSERT.
                                try:
                                    proj_result = supabase_lib.table("editai_projects").insert({
                                        "profile_id": profile.profile_id,
                                        "name": pipeline_name,
                                        "description": f"Auto-generated from pipeline {pipeline_id}",
                                        "status": "completed",
                                    }).execute()
                                    if proj_result.data:
                                        library_project_id = proj_result.data[0]["id"]
                                except Exception as insert_err:
                                    # Likely a unique-constraint violation (duplicate).
                                    # Fetch the existing project instead.
                                    logger.debug(
                                        f"Project insert conflict, fetching existing: {insert_err}"
                                    )
                                    existing = supabase_lib.table("editai_projects")\
                                        .select("id")\
                                        .eq("profile_id", profile.profile_id)\
                                        .eq("name", pipeline_name)\
                                        .limit(1)\
                                        .execute()
                                    if existing.data:
                                        library_project_id = existing.data[0]["id"]
                                    else:
                                        raise

                                if library_project_id:
                                    pipeline["library_project_id"] = library_project_id

                    if library_project_id:
                        # Step B: Generate thumbnail
                        thumb_path = None
                        try:
                            thumb_dir = final_video_path.parent / "thumbnails"
                            thumb_dir.mkdir(parents=True, exist_ok=True)
                            thumb_path = thumb_dir / f"{final_video_path.stem}_thumb.jpg"
                            await asyncio.to_thread(safe_ffmpeg_run, [
                                "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                                "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                                str(thumb_path)
                            ], 30, "thumbnail")
                            if thumb_path.exists():
                                with render_jobs_lock:
                                    job["thumbnail_path"] = str(thumb_path)
                            else:
                                thumb_path = None
                        except Exception as thumb_err:
                            logger.warning(f"Thumbnail generation failed: {thumb_err}")
                            thumb_path = None

                        # Step C: Get video duration
                        duration = None
                        try:
                            dur_result = await asyncio.to_thread(safe_ffmpeg_run, [
                                "ffprobe", "-v", "error", "-show_entries",
                                "format=duration",
                                "-of", "default=noprint_wrappers=1:nokey=1",
                                str(final_video_path)
                            ], 30, "duration probe")
                            if dur_result.returncode == 0:
                                try:
                                    duration = float(dur_result.stdout.strip())
                                except ValueError:
                                    logger.warning(f"ffprobe returned non-numeric duration: {dur_result.stdout.strip()!r}")
                        except Exception as dur_err:
                            logger.warning(f"Duration probe failed: {dur_err}")

                        # Step D: Upsert clip row (update if already exists for this variant)
                        existing_clip = supabase_lib.table("editai_clips")\
                            .select("id")\
                            .eq("project_id", library_project_id)\
                            .eq("variant_index", vid)\
                            .eq("is_deleted", False)\
                            .limit(1)\
                            .execute()
                        if not existing_clip.data:
                            clip_result = supabase_lib.table("editai_clips").insert({
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
                            if clip_result.data and len(clip_result.data) > 0:
                                with render_jobs_lock:
                                    job["clip_id"] = clip_result.data[0].get("id")
                        else:
                            # Existing clip — UPDATE with new video path and metadata
                            existing_id = existing_clip.data[0].get("id")
                            supabase_lib.table("editai_clips").update({
                                "raw_video_path": str(final_video_path),
                                "final_video_path": str(final_video_path),
                                "thumbnail_path": str(thumb_path) if thumb_path else None,
                                "duration": duration,
                                "final_status": "completed",
                                "is_deleted": False,
                            }).eq("id", existing_id).execute()
                            with render_jobs_lock:
                                job["clip_id"] = existing_id
                            logger.info(
                                f"Updated existing clip {existing_id} with new video path"
                            )

                        with render_jobs_lock:
                            job["library_saved"] = True
                        logger.info(
                            f"[Profile {profile.profile_id}] Pipeline {pipeline_id} "
                            f"variant {vid} saved to library project {library_project_id}"
                        )
                    else:
                        with render_jobs_lock:
                            job["library_error"] = "Failed to create or find library project"
                else:
                    with render_jobs_lock:
                        job["library_error"] = "Supabase unavailable"
            except Exception as lib_err:
                with render_jobs_lock:
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
            # Acquire lock before writing shared render_jobs dict
            with render_jobs_lock:
                job["status"] = "failed"
                job["progress"] = 0
                job["current_step"] = "Render failed"
                job["error"] = str(e)
                job["failed_at"] = datetime.now(timezone.utc).isoformat()

                # Persist failure to DB
                _db_update_render_jobs(pipeline_id, pipeline["render_jobs"])

    # Run all variant renders in parallel via asyncio.gather (throttled by semaphore)
    async def _render_all_variants():
        async def _throttled_render(vid):
            async with acquire_render_slot():
                await do_render(vid)
        tasks = [_throttled_render(vid) for vid in variant_indices_to_render]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error(f"Render variant {variant_indices_to_render[i]} failed: {result}")
        # Clear cancellation flag after all renders complete
        clear_pipeline_cancelled(pipeline_id)

    if variant_indices_to_render:
        background_tasks.add_task(_render_all_variants)

    return PipelineRenderResponse(
        pipeline_id=pipeline_id,
        rendering_variants=render_request.variant_indices,
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
    - Pipelines expire after 30 days (TTL enforced on read).
    """
    # Try in-memory first, then DB fallback
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    # Enforce 30-day TTL
    created_at = pipeline.get("created_at", "")
    if created_at:
        try:
            created_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - created_dt).days > 30:
                raise HTTPException(status_code=404, detail="Pipeline expired")
        except (ValueError, TypeError):
            pass  # Can't parse date, skip TTL check

    # Build variants status list
    variants = []
    for idx in range(len(pipeline["scripts"])):
        if idx in pipeline["render_jobs"]:
            # Variant has a render job
            job = pipeline["render_jobs"][idx]
            # Sanitize error details for public endpoint
            sanitized_error = "Processing failed. Check server logs for details." if job.get("error") else None
            sanitized_lib_error = "Library save failed. Check server logs for details." if job.get("library_error") else None
            variants.append(VariantStatus(
                variant_index=idx,
                status=job["status"],
                progress=job["progress"],
                current_step=job["current_step"],
                final_video_path=job.get("final_video_path"),
                thumbnail_path=job.get("thumbnail_path"),
                clip_id=job.get("clip_id"),
                error=sanitized_error,
                library_saved=job.get("library_saved"),
                library_error=sanitized_lib_error,
                render_fingerprint=job.get("render_fingerprint")
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

    if pipeline.get("profile_id") != profile.profile_id:
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

    # Check which clips already exist (fetch id + variant_index for update)
    existing_clips = supabase.table("editai_clips")\
        .select("id, variant_index")\
        .eq("project_id", library_project_id)\
        .eq("is_deleted", False)\
        .execute()
    existing_map = {c["variant_index"]: c["id"] for c in (existing_clips.data or [])}

    synced = 0
    for vid, job in sorted(completed_variants.items()):
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
                await asyncio.to_thread(safe_ffmpeg_run, [
                    "ffmpeg", "-y", "-ss", "1", "-i", str(final_video_path),
                    "-vframes", "1", "-vf", "scale=320:-1", "-q:v", "3",
                    str(thumb_path)
                ], 30, "sync thumbnail")
            if not thumb_path.exists():
                thumb_path = None
        except Exception:
            thumb_path = None

        # Duration
        duration = None
        try:
            dur_result = await asyncio.to_thread(safe_ffmpeg_run, [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(final_video_path)
            ], 30, "sync duration probe")
            if dur_result.returncode == 0:
                try:
                    duration = float(dur_result.stdout.strip())
                except ValueError:
                    logger.warning(f"ffprobe returned non-numeric duration: {dur_result.stdout.strip()!r}")
        except Exception:
            pass

        # Upsert clip (update if exists, insert if new)
        if vid in existing_map:
            existing_id = existing_map[vid]
            supabase.table("editai_clips").update({
                "raw_video_path": str(final_video_path),
                "final_video_path": str(final_video_path),
                "thumbnail_path": str(thumb_path) if thumb_path else None,
                "duration": duration,
                "final_status": "completed",
                "is_deleted": False,
            }).eq("id", existing_id).execute()
            job["clip_id"] = existing_id
            logger.info(f"Pipeline {pipeline_id} variant {vid}: updated existing clip {existing_id}")
        else:
            clip_result = supabase.table("editai_clips").insert({
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
            if clip_result.data and len(clip_result.data) > 0:
                job["clip_id"] = clip_result.data[0].get("id")

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
            .eq("is_deleted", False)\
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


@router.get("/{pipeline_id}/restore-previews")
async def restore_previews(
    pipeline_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Return stored preview match data for all variants in a pipeline.

    Used by the frontend to restore full preview state when importing a
    pipeline from history that already has previews generated. Returns
    the same shape as PipelinePreviewResponse keyed by variant index.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    stored_previews = pipeline.get("previews", {})
    if not stored_previews:
        return {"previews": {}, "available_segments": []}

    result_previews = {}
    all_available_segments = []

    for idx_key, preview_entry in stored_previews.items():
        pd = preview_entry.get("preview_data", {}) if isinstance(preview_entry, dict) else {}
        if not pd or not pd.get("matches"):
            continue

        matches = [
            {
                "srt_index": m.get("srt_index", 0),
                "srt_text": m.get("srt_text", ""),
                "srt_start": m.get("srt_start", 0),
                "srt_end": m.get("srt_end", 0),
                "segment_id": m.get("segment_id"),
                "segment_keywords": m.get("segment_keywords", []),
                "matched_keyword": m.get("matched_keyword"),
                "confidence": m.get("confidence", 0),
                "is_auto_filled": m.get("is_auto_filled", False),
                "source_video_id": m.get("source_video_id"),
                "segment_start_time": m.get("segment_start_time"),
                "segment_end_time": m.get("segment_end_time"),
                "thumbnail_path": m.get("thumbnail_path"),
                "merge_group": m.get("merge_group"),
                "merge_group_duration": m.get("merge_group_duration"),
            }
            for m in pd.get("matches", [])
        ]

        result_previews[str(idx_key)] = {
            "audio_duration": pd.get("audio_duration", 0),
            "srt_content": pd.get("srt_content", ""),
            "matches": matches,
            "total_phrases": pd.get("total_phrases", len(matches)),
            "matched_count": pd.get("matched_count", 0),
            "unmatched_count": pd.get("unmatched_count", 0),
            "available_segments": pd.get("available_segments", []),
        }

        # Grab available_segments from the first preview that has them
        if not all_available_segments and pd.get("available_segments"):
            all_available_segments = pd["available_segments"]

    return {"previews": result_previews, "available_segments": all_available_segments}


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
    pipeline = await asyncio.to_thread(_get_pipeline_or_load, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
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
                        content_disposition_type="inline",
                        headers={"Cache-Control": "public, max-age=3600"})
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
        content_disposition_type="inline",
        headers={"Cache-Control": "public, max-age=3600"}
    )


# ============== SERVER-SIDE PREVIEW RENDER ENDPOINTS ==============

class PreviewRenderRequest(BaseModel):
    """Request model for server-side FFmpeg preview render."""
    match_overrides: List[dict]
    source_video_ids: Optional[List[str]] = None
    min_segment_duration: float = 3.0
    subtitle_settings: Optional[dict] = None
    words_per_subtitle: int = 2


class PreviewRenderStatusResponse(BaseModel):
    """Response model for preview render status."""
    status: str  # "processing", "completed", "failed"
    progress: int = 0
    current_step: str = ""
    matches_fingerprint: Optional[str] = None
    error: Optional[str] = None


@router.post("/render-preview/{pipeline_id}/{variant_index}")
@limiter.limit("10/minute")
async def render_preview(
    request: Request,
    pipeline_id: str,
    variant_index: int,
    render_request: PreviewRenderRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Start a fast server-side FFmpeg preview render for a variant.

    Uses 540x960, ultrafast encoding, CRF 32, no loudnorm.
    Produces a real MP4 that matches the final render's segment order.
    Requires TTS audio + SRT to already exist in pipeline["tts_previews"].
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if pipeline.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=403, detail="Access denied to this pipeline")

    if variant_index < 0 or variant_index >= len(pipeline["scripts"]):
        raise HTTPException(status_code=400, detail=f"Invalid variant_index: {variant_index}")

    # Validate TTS audio exists
    _tts = pipeline.get("tts_previews", {})
    tts_data = _tts.get(variant_index) or _tts.get(str(variant_index))
    if not tts_data:
        raise HTTPException(status_code=400, detail="TTS audio not generated yet. Run Preview All first.")

    audio_path_str = tts_data.get("audio_path")
    if not audio_path_str or not Path(audio_path_str).exists():
        raise HTTPException(status_code=400, detail="TTS audio file missing from disk. Re-run Preview All.")

    # Compute fingerprint from segment IDs
    seg_ids = [str(m.get("segment_id", "none")) for m in render_request.match_overrides]
    matches_fingerprint = hashlib.md5("|".join(seg_ids).encode()).hexdigest()[:12]

    # Initialize preview_renders dict if needed
    if "preview_renders" not in pipeline:
        pipeline["preview_renders"] = {}

    # Cache hit: if fingerprint matches + file exists, return completed immediately
    existing = pipeline["preview_renders"].get(variant_index)
    if existing:
        if (existing.get("matches_fingerprint") == matches_fingerprint
                and existing.get("status") == "completed"
                and existing.get("preview_video_path")
                and Path(existing["preview_video_path"]).exists()):
            return {"status": "completed", "matches_fingerprint": matches_fingerprint}

        # Clean up old preview file before starting new render
        old_path = existing.get("preview_video_path")
        if old_path and Path(old_path).exists():
            try:
                Path(old_path).unlink()
            except Exception:
                pass

    # Initialize render state
    pipeline["preview_renders"][variant_index] = {
        "status": "processing",
        "progress": 0,
        "current_step": "Starting preview render",
        "preview_video_path": None,
        "matches_fingerprint": matches_fingerprint,
        "error": None,
    }

    script_text = pipeline["scripts"][variant_index]
    reuse_srt_content = tts_data.get("srt_content")
    reuse_audio_duration = tts_data.get("audio_duration")

    async def _do_preview_render():
        render_state = pipeline["preview_renders"][variant_index]
        try:
            async with acquire_preview_slot():
                assembly_service = get_assembly_service()

                def on_progress(step_name: str, pct: int):
                    render_state["current_step"] = step_name
                    render_state["progress"] = pct

                preview_path = await asyncio.wait_for(
                    assembly_service.assemble_and_render_preview(
                        script_text=script_text,
                        profile_id=profile.profile_id,
                        pipeline_id=pipeline_id,
                        variant_index=variant_index,
                        match_overrides=render_request.match_overrides,
                        source_video_ids=render_request.source_video_ids,
                        reuse_audio_path=audio_path_str,
                        reuse_audio_duration=reuse_audio_duration,
                        reuse_srt_content=reuse_srt_content,
                        subtitle_settings=render_request.subtitle_settings,
                        min_segment_duration=render_request.min_segment_duration,
                        on_progress=on_progress,
                        max_words_per_phrase=render_request.words_per_subtitle,
                    ),
                    timeout=300  # 5-minute timeout for preview
                )

                render_state["status"] = "completed"
                render_state["progress"] = 100
                render_state["current_step"] = "Preview ready"
                render_state["preview_video_path"] = str(preview_path)
                logger.info(f"Preview render completed: {preview_path}")

        except asyncio.TimeoutError:
            render_state["status"] = "failed"
            render_state["error"] = "Preview render timed out after 5 minutes"
            render_state["current_step"] = "Failed"
            logger.error(f"Preview render timeout for pipeline {pipeline_id} variant {variant_index}")
        except Exception as e:
            render_state["status"] = "failed"
            render_state["error"] = str(e)
            render_state["current_step"] = "Failed"
            logger.error(f"Preview render failed for pipeline {pipeline_id} variant {variant_index}: {e}")

    background_tasks.add_task(_do_preview_render)

    return {"status": "processing", "matches_fingerprint": matches_fingerprint}


@router.get("/preview-status/{pipeline_id}/{variant_index}", response_model=PreviewRenderStatusResponse)
async def get_preview_status(
    pipeline_id: str,
    variant_index: int,
):
    """
    Get status of a server-side preview render.

    Intentionally public (same pattern as /status endpoint) — pipeline UUID
    acts as capability token.
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    render_state = pipeline.get("preview_renders", {}).get(variant_index)
    if not render_state:
        return PreviewRenderStatusResponse(
            status="not_started",
            progress=0,
            current_step="Not started",
        )

    return PreviewRenderStatusResponse(
        status=render_state.get("status", "not_started"),
        progress=render_state.get("progress", 0),
        current_step=render_state.get("current_step", ""),
        matches_fingerprint=render_state.get("matches_fingerprint"),
        error=render_state.get("error"),
    )


@router.get("/preview-video/{pipeline_id}/{variant_index}")
async def get_preview_video(
    pipeline_id: str,
    variant_index: int,
):
    """
    Stream the preview MP4 video for a variant.

    Supports HTTP Range requests for seeking. Intentionally public
    (same pattern as /status endpoint).
    """
    pipeline = _get_pipeline_or_load(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    render_state = pipeline.get("preview_renders", {}).get(variant_index)
    if not render_state or render_state.get("status") != "completed":
        raise HTTPException(status_code=404, detail="Preview not ready")

    video_path_str = render_state.get("preview_video_path")
    if not video_path_str or not Path(video_path_str).exists():
        raise HTTPException(status_code=404, detail="Preview video file not found")

    return FileResponse(
        path=video_path_str,
        media_type="video/mp4",
        content_disposition_type="inline",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=300",
        }
    )
