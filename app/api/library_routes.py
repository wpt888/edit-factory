"""
EditAI Library & Workflow Routes
Gestionează proiecte, clipuri, asocieri și exporturi pentru noul workflow.
"""
import asyncio
import time as _time_mod
import uuid
import shutil
import shlex
import subprocess
import json
import mimetypes
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Depends, Response, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.services.file_storage import get_file_storage
from app.services.media_manager import get_media_manager
from app.api.auth import ProfileContext, get_profile_context
from app.api.ml_gating import _enforce_ml_installed
from app.api.validators import (
    validate_upload_size, validate_tts_text_length,
    validate_file_mime_type, ALLOWED_VIDEO_MIMES,
)
from app.core.rate_limit import limiter
from app.services.encoding_presets import get_preset, EncodingPreset, apply_quality_mode, get_default_quality_mode
from app.services.audio.normalizer import measure_loudness, build_loudnorm_filter
from app.services.video_effects.filters import VideoFilters, DenoiseConfig, SharpenConfig, ColorConfig
from app.services.video_effects.subtitle_styler import build_subtitle_filter
from app.services.tts_subtitle_generator import generate_srt_from_timestamps
from app.services.srt_validator import sanitize_srt_text, sanitize_srt_full, SRTValidator
from app.utils import sanitize_filename as _sanitize_filename, normalize_path

import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/library", tags=["library"])

# ============== PROJECT LOCKS (prevent race conditions) ==============
_project_locks: Dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()  # Meta-lock for managing project locks
_cancelled_projects: Dict[str, float] = {}  # project_id -> timestamp of cancellation
_cancelled_lock = threading.Lock()
_MAX_CANCELLED = 200

# ============== FFmpeg CONCURRENCY LIMIT ==============
# Global semaphore shared across ALL routes (library, pipeline, product)
from app.services.ffmpeg_semaphore import (
    acquire_render_slot, acquire_prep_slot, safe_ffmpeg_run, check_disk_space,
    is_nvenc_available, get_prep_codec_params, safe_ffmpeg_run_with_progress,
)
# Keep legacy name for backwards compat with product_generate_routes import
_ffmpeg_render_semaphore = None  # DEPRECATED — use acquire_render_slot() instead

# ============== FFmpeg EXTRA FLAGS ALLOWLIST ==============
SAFE_FFMPEG_FLAGS = {"-movflags", "-max_muxing_queue_size", "-brand", "-fflags"}
SAFE_FFMPEG_VALUES = {"+faststart", "+genpts", "+igndts"}


def _validate_extra_flags(flags_str: str) -> list:
    """Validate extra FFmpeg flags against an allowlist to prevent command injection."""
    tokens = shlex.split(flags_str)
    validated = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in SAFE_FFMPEG_FLAGS:
            validated.append(token)
            # Include the next token as value if it exists
            if i + 1 < len(tokens) and not tokens[i + 1].startswith("-"):
                validated.append(tokens[i + 1])
                i += 1
        elif token in SAFE_FFMPEG_VALUES:
            validated.append(token)
        elif token.startswith("-") and token not in SAFE_FFMPEG_FLAGS:
            # Skip unknown flag and its value
            i += 1  # skip value
        # Unknown non-flag tokens are silently dropped
        i += 1
    return validated


def _evict_old_cancelled():
    """Evict oldest entries when _cancelled_projects exceeds limit. Caller must hold _cancelled_lock."""
    if len(_cancelled_projects) <= _MAX_CANCELLED:
        return
    sorted_ids = sorted(_cancelled_projects, key=_cancelled_projects.get)
    to_remove = sorted_ids[:len(_cancelled_projects) - _MAX_CANCELLED]
    for pid in to_remove:
        _cancelled_projects.pop(pid, None)


def is_project_cancelled(project_id: str) -> bool:
    """Check if a project has been flagged for cancellation."""
    with _cancelled_lock:
        return project_id in _cancelled_projects


def mark_project_cancelled(project_id: str):
    """Flag a project for cancellation."""
    with _cancelled_lock:
        _cancelled_projects[project_id] = _time_mod.monotonic()
        _evict_old_cancelled()


def clear_project_cancelled(project_id: str):
    """Clear the cancellation flag for a project."""
    with _cancelled_lock:
        _cancelled_projects.pop(project_id, None)


def _cleanup_stale_locks():
    """Remove lock entries for projects that are not currently being processed.

    A lock is considered stale if it can be acquired non-blocking (meaning no
    task holds it). Called under _locks_lock to prevent TOCTOU race conditions.
    Caller must hold _locks_lock.
    """
    stale_keys = []
    for pid, lock in list(_project_locks.items()):
        if lock.acquire(blocking=False):
            # Nobody holds it — it's stale
            lock.release()
            stale_keys.append(pid)
    for pid in stale_keys:
        # Re-check: only delete if the lock is still uncontested
        lock = _project_locks.get(pid)
        if lock and lock.acquire(blocking=False):
            lock.release()
            _project_locks.pop(pid, None)
    if stale_keys:
        logger.debug(f"[locks] Cleaned up stale project lock(s)")


def get_project_lock(project_id: str) -> threading.Lock:
    """Get or create a lock for a specific project.

    Automatically purges stale lock entries when the dict exceeds 50 entries
    to prevent unbounded growth.
    """
    with _locks_lock:
        if len(_project_locks) > 50:
            _cleanup_stale_locks()
        if project_id not in _project_locks:
            _project_locks[project_id] = threading.Lock()
        return _project_locks[project_id]


def is_project_locked(project_id: str) -> bool:
    """Return True if a project lock is currently held (a task is in progress)."""
    with _locks_lock:
        lock = _project_locks.get(project_id)
    if lock is None:
        return False
    acquired = lock.acquire(blocking=False)
    if acquired:
        lock.release()
        return False
    return True


def cleanup_project_lock(project_id: str):
    """Remove project lock only if it's not currently held by another task."""
    with _locks_lock:
        lock = _project_locks.get(project_id)
        if lock is None:
            return
        # Only delete if we can acquire (meaning nobody else holds it)
        acquired = lock.acquire(blocking=False)
        if acquired:
            lock.release()
            del _project_locks[project_id]
        # If we can't acquire, another task holds the lock — leave it in place

# ============== PROGRESS TRACKING ==============
_generation_progress: Dict[str, dict] = {}
_progress_lock = threading.Lock()
_MAX_PROGRESS_ENTRIES = 500

from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters


def _evict_old_progress():
    """Evict oldest entries when _generation_progress exceeds limit. Caller must hold _progress_lock."""
    if len(_generation_progress) <= _MAX_PROGRESS_ENTRIES:
        return
    sorted_keys = sorted(_generation_progress, key=lambda k: _generation_progress[k].get("updated_at", "1970-01-01T00:00:00+00:00"))  # DB-25: proper ISO default for missing updated_at
    to_remove = sorted_keys[:len(_generation_progress) - _MAX_PROGRESS_ENTRIES]
    for key in to_remove:
        _generation_progress.pop(key, None)


def update_generation_progress(project_id: str, percentage: int, current_step: str,
                                estimated_remaining: Optional[int] = None,
                                job_id: Optional[str] = None):
    """Update generation progress for a project (in-memory + optional JobStorage persistence)."""
    with _progress_lock:
        _generation_progress[project_id] = {
            "percentage": percentage,
            "current_step": current_step,
            "estimated_remaining": estimated_remaining,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        _evict_old_progress()
    if job_id:
        try:
            from app.services.job_storage import get_job_storage
            get_job_storage().update_job(job_id, {
                "progress": current_step,
                "progress_percentage": percentage,
                "estimated_remaining": estimated_remaining,
            })
        except Exception as e:
            logger.warning(f"Failed to persist progress for job {job_id}: {e}")


def get_generation_progress(project_id: str) -> Optional[dict]:
    """Get generation progress for a project. Memory-first, falls back to JobStorage."""
    with _progress_lock:
        mem = _generation_progress.get(project_id)
        if mem:
            return mem
    # Fallback: query JobStorage by project_id directly (no O(N) scan)
    try:
        from app.services.job_storage import get_job_storage
        active_jobs = get_job_storage().get_jobs_by_project(project_id, status="processing")
        if not active_jobs:
            active_jobs = get_job_storage().get_jobs_by_project(project_id, status="pending")
        if active_jobs:
            job = active_jobs[0]  # Most recent
            data = job.get("data", job)  # Handle both raw and nested formats
            return {
                "percentage": data.get("progress_percentage", 0),
                "current_step": data.get("progress", "Processing..."),
                "estimated_remaining": data.get("estimated_remaining"),
                "updated_at": job.get("updated_at"),
            }
    except Exception as e:
        logger.warning(f"Failed to load progress from JobStorage: {e}")
    return None


def clear_generation_progress(project_id: str):
    """Clear generation progress for a project."""
    with _progress_lock:
        _generation_progress.pop(project_id, None)


# ============== PYDANTIC MODELS ==============

class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=200)  # DB-13: max_length validators
    description: Optional[str] = Field(default=None, max_length=2000)  # DB-13
    target_duration: int = 20
    context_text: Optional[str] = None

class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    status: str
    target_duration: int
    context_text: Optional[str]
    variants_count: int
    selected_count: int
    exported_count: int
    created_at: str

class ClipResponse(BaseModel):
    id: str
    project_id: str
    variant_index: int
    variant_name: Optional[str]
    raw_video_path: str
    thumbnail_path: Optional[str]
    duration: Optional[float]
    is_selected: bool
    is_deleted: bool
    final_video_path: Optional[str]
    final_status: str
    created_at: str

class ClipContentUpdate(BaseModel):
    tts_text: Optional[str] = None
    srt_content: Optional[str] = None
    subtitle_settings: Optional[dict] = None

class ExportPresetResponse(BaseModel):
    id: str
    name: str
    display_name: str
    width: int
    height: int
    fps: int
    video_bitrate: str
    crf: int
    audio_bitrate: str
    is_default: bool



# ============== HELPER FUNCTIONS ==============

def verify_project_ownership(project_id: str, profile_id: str) -> dict:
    """Verify project exists and belongs to profile. Returns project or raises 404."""
    try:
        repo = get_repository()
        proj = repo.get_project(project_id)

        if not proj or proj.get("profile_id") != profile_id:
            raise HTTPException(status_code=404, detail="Project not found")

        return proj
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying project ownership: {e}")
        raise HTTPException(status_code=503, detail="Database unavailable")


# ============== FILE SERVING ==============

@router.get("/files/{file_path:path}")
async def serve_file(
    file_path: str,
    download: bool = Query(default=False),
    profile: ProfileContext = Depends(get_profile_context),
):
    """
    Servește fișiere (thumbnails, videos) din directoarele output.
    Security: Permite doar fișiere din directoarele permise.

    Supports both local file paths and remote storage keys (when FILE_STORAGE_BACKEND=supabase).
    Remote keys are retrieved locally before serving.
    """
    settings = get_settings()
    file_path = normalize_path(file_path)
    # Normalise backslashes to forward slashes so that DB paths stored with
    # Windows separators (e.g. "output\profile_id\…") match the "output/" prefix
    # check below and don't cause double-directory or tenant-check failures.
    file_path = file_path.replace("\\", "/")
    full_path = Path(file_path)
    if not full_path.is_absolute():
        # Handle paths that start with "output/" - strip the prefix since output_dir already ends with /output
        if file_path.startswith("output/"):
            relative_path = file_path[7:]  # Remove "output/"
            full_path = settings.output_dir / relative_path
        else:
            full_path = settings.output_dir / file_path

    allowed_dirs = [settings.output_dir, settings.input_dir, settings.base_dir / "temp", settings.media_dir]

    try:
        resolved_path = full_path.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    is_allowed = False
    for allowed_dir in allowed_dirs:
        try:
            resolved_path.relative_to(allowed_dir.resolve())
            is_allowed = True
            break
        except ValueError:
            continue

    if not is_allowed:
        raise HTTPException(status_code=403, detail="Access denied")

    # Multi-tenant: verify the file belongs to the requesting profile
    try:
        rel_to_output = resolved_path.relative_to(settings.output_dir.resolve())
        top_dir = rel_to_output.parts[0] if rel_to_output.parts else None
        if top_dir and top_dir != profile.profile_id:
            raise HTTPException(status_code=403, detail="Access denied")
    except ValueError:
        # File is in media_dir or input_dir — check via project_id in path
        try:
            rel_to_media = resolved_path.relative_to(settings.media_dir.resolve())
            # media/{project_id}/... — verify project ownership
            project_id_candidate = rel_to_media.parts[0] if rel_to_media.parts else None
            if project_id_candidate:
                repo = get_repository()
                if repo:
                    proj = repo.get_project(project_id_candidate)
                    if proj and proj.get("profile_id") != profile.profile_id:
                        raise HTTPException(status_code=403, detail="Access denied")
        except ValueError:
            pass  # input_dir or temp — allow (shared resources)

    # If the file doesn't exist locally, try retrieving it from the storage backend
    if not resolved_path.exists():
        file_storage = get_file_storage()
        # For non-local backends, remote_key is the relative key (not an absolute path)
        if not full_path.is_absolute() or not Path(file_path).is_absolute():
            remote_key = file_path  # Use the original key passed in
        else:
            remote_key = file_path
        try:
            import hashlib as _hl
            cache_name = _hl.md5(file_path.encode()).hexdigest() + Path(file_path).suffix
            cache_path = settings.output_dir / ".storage_cache" / cache_name
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            resolved_path = file_storage.retrieve(remote_key, cache_path)
        except Exception as e:
            logger.warning(f"FileStorage.retrieve failed for {file_path}: {e}")
            raise HTTPException(status_code=404, detail="File not found")

    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not resolved_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    media_type, _ = mimetypes.guess_type(str(resolved_path))
    # FIX: Use proper caching for video files to enable smooth seeking/playback.
    # "no-cache" forced the browser to re-fetch on every seek, causing stuttering.
    is_video = media_type and media_type.startswith("video/")
    cache_header = "public, max-age=300" if is_video else "no-cache, must-revalidate"
    return FileResponse(
        path=str(resolved_path),
        media_type=media_type or "application/octet-stream",
        filename=resolved_path.name if download else None,
        headers={"Cache-Control": cache_header}
    )


# ============== CLIP ASSET DOWNLOADS (SRT, Audio) ==============

@router.get("/clips/{clip_id}/srt")
async def download_clip_srt(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Download SRT subtitle file for a clip."""
    repo = get_repository()

    # Verify ownership (T-80-01-01: profile_id check after repo.get_clip)
    clip = repo.get_clip(clip_id)
    if not clip or clip.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    content_row = repo.get_clip_content(clip_id)
    if not content_row or not content_row.get("srt_content"):
        raise HTTPException(status_code=404, detail="No subtitles available for this clip")

    return Response(
        content=content_row["srt_content"],
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="clip_{clip_id[:8]}.srt"'}
    )


@router.get("/clips/{clip_id}/audio")
async def download_clip_audio(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Download TTS audio (MP3) file for a clip."""
    repo = get_repository()

    # Verify ownership (T-80-01-01: profile_id check after repo.get_clip)
    clip = repo.get_clip(clip_id)
    if not clip or clip.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    content_row = repo.get_clip_content(clip_id)
    if not content_row or not content_row.get("tts_audio_path"):
        raise HTTPException(status_code=404, detail="No audio available for this clip")

    settings = get_settings()
    file_path = Path(content_row["tts_audio_path"])
    if not file_path.is_absolute():
        file_path = settings.base_dir / file_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        filename=f"clip_{clip_id[:8]}.mp3",
        headers={"Cache-Control": "no-cache, must-revalidate"}
    )


@router.get("/clips/{clip_id}/download")
async def download_clip_video(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Download the final (or raw) video file for a clip."""
    repo = get_repository()

    # Verify ownership (T-80-01-01: profile_id check after repo.get_clip)
    clip_row = repo.get_clip(clip_id)
    if not clip_row or clip_row.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")

    video_path_str = clip_row.get("final_video_path") or clip_row.get("raw_video_path")
    if not video_path_str:
        raise HTTPException(status_code=404, detail="No video file associated with this clip")

    settings = get_settings()
    video_path_str = video_path_str.replace("\\", "/")
    file_path = Path(video_path_str)
    if not file_path.is_absolute():
        # Try output_dir first, then media_dir
        candidate = settings.output_dir / file_path
        if candidate.exists():
            file_path = candidate
        elif hasattr(settings, "media_dir") and settings.media_dir:
            candidate = Path(settings.media_dir) / file_path
            if candidate.exists():
                file_path = candidate

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=f"clip_{clip_id[:8]}.mp4",
        headers={"Cache-Control": "no-cache, must-revalidate"}
    )


# ============== PROJECTS ==============

@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Creează un proiect nou."""
    repo = get_repository()

    try:
        proj = repo.create_project({
            "name": project.name,
            "description": project.description,
            "target_duration": project.target_duration,
            "context_text": project.context_text,
            "status": "draft",
            "profile_id": profile.profile_id
        })

        logger.info(f"[Profile {profile.profile_id}] Created project: {proj['id']}")
        return ProjectResponse(
            id=proj["id"],
            name=proj["name"],
            description=proj.get("description"),
            status=proj["status"],
            target_duration=proj["target_duration"],
            context_text=proj.get("context_text"),
            variants_count=proj.get("variants_count", 0),
            selected_count=proj.get("selected_count", 0),
            exported_count=proj.get("exported_count", 0),
            created_at=proj["created_at"]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/projects")
async def list_projects(
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Listează toate proiectele."""
    repo = get_repository()

    try:
        eq_filters = {}
        if status:
            eq_filters["status"] = status
        filters = QueryFilters(
            eq=eq_filters,
            order_by="created_at",
            order_desc=True,
            limit=limit,
            offset=offset,
            count=True,
        )
        result = repo.list_projects(profile.profile_id, filters)
        total = result.count if result.count is not None else len(result.data)
        return {"projects": result.data, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        logger.error(f"Error listing projects: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține detaliile unui proiect."""
    repo = get_repository()

    try:
        proj = repo.get_project(project_id)
        if not proj or proj.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Project not found")

        return ProjectResponse(
            id=proj["id"],
            name=proj["name"],
            description=proj.get("description"),
            status=proj["status"],
            target_duration=proj["target_duration"],
            context_text=proj.get("context_text"),
            variants_count=proj.get("variants_count", 0),
            selected_count=proj.get("selected_count", 0),
            exported_count=proj.get("exported_count", 0),
            created_at=proj["created_at"]
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting project: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/projects/{project_id}/progress")
async def get_project_progress(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține progresul generării pentru un proiect."""
    progress = get_generation_progress(project_id)
    if progress:
        return progress

    # If no progress tracked, check project status from repository
    repo = get_repository()
    try:
        proj = repo.get_project(project_id)
        if not proj or proj.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Progress not found")
        status = proj.get("status")
        if status == "generating":
            return {"percentage": 0, "current_step": "Initializing...", "estimated_remaining": None}
        elif status == "ready_for_triage":
            return {"percentage": 100, "current_step": "Complete", "estimated_remaining": 0}
        elif status == "failed":
            return {"percentage": 100, "current_step": "Failed", "estimated_remaining": 0}
        elif status in ("draft", "cancelled"):
            return {"percentage": 0, "current_step": "Not started", "estimated_remaining": None}
    except HTTPException:
        raise
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="Progress not found")


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str,
    updates: dict,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează un proiect."""
    repo = get_repository()

    # Verify ownership first (before lock check to prevent oracle attack)
    proj = repo.get_project(project_id)
    if not proj or proj.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # DB-20: Check if project is currently locked by a background task (after ownership)
    if is_project_locked(project_id):
        raise HTTPException(status_code=409, detail="Project is currently being processed")

    allowed_fields = ["name", "description", "target_duration", "context_text"]
    filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}

    # Validate target_duration range
    if "target_duration" in filtered_updates:
        td = filtered_updates["target_duration"]
        if td is not None:
            try:
                td = float(td)
            except (TypeError, ValueError):
                raise HTTPException(status_code=422, detail="target_duration must be a number")
            if td <= 0 or td > 300:
                raise HTTPException(status_code=422, detail="target_duration must be between 0 and 300 seconds (5 minutes max)")
            filtered_updates["target_duration"] = td

    filtered_updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        updated = repo.update_project(project_id, filtered_updates)
        return {"status": "updated", "project": updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating project: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/projects/{project_id}/cancel")
async def cancel_generation(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cancel an in-progress generation for a project."""
    repo = get_repository()

    verify_project_ownership(project_id, profile.profile_id)
    mark_project_cancelled(project_id)
    clear_generation_progress(project_id)
    # Clean up any stale lock entry so get_project_lock() starts fresh on next run
    cleanup_project_lock(project_id)

    try:
        repo.update_project(project_id, {
            "status": "cancelled",
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        logger.error(f"Failed to update project status on cancel: {e}")

    return {"status": "cancelled"}


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Șterge un proiect și toate clipurile asociate."""
    repo = get_repository()

    # Verify ownership first
    proj = repo.get_project(project_id)
    if not proj or proj.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Check if project is currently being processed
    if is_project_locked(project_id):
        raise HTTPException(
            status_code=409,
            detail="Project is currently being processed. Cancel generation first before deleting."
        )

    try:
        # Delete in order: files → child rows → parent row
        # Each step is resilient so partial failure doesn't leave orphaned data
        clips_result = repo.list_clips(project_id)

        # Step 1: Delete clip files from disk (non-critical)
        for clip in (clips_result.data or []):
            try:
                _delete_clip_files(clip)
            except Exception as e:
                logger.warning(f"Failed to delete files for clip {clip.get('id')}: {e}")

        # Step 2: Delete child DB rows (clip_content, clips)
        if clips_result.data:
            clip_ids = [c["id"] for c in clips_result.data]
            try:
                repo.delete_clip_content_by_clip_ids(clip_ids)
            except Exception as e:
                logger.warning(f"Failed to delete clip_content for project {project_id}: {e}")
            try:
                repo.delete_clips_by_ids(clip_ids)
            except Exception as e:
                logger.warning(f"Failed to delete clips for project {project_id}: {e}")

        # Step 3: Clean up project media directory
        try:
            media_manager = get_media_manager()
            deleted_count = media_manager.delete_project_media(project_id)
            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} media files for project {project_id}")
        except Exception as e:
            logger.warning(f"Failed to clean up media directory for project {project_id}: {e}")

        # Step 4: Delete the project record (must succeed)
        repo.delete_project(project_id)
        return {"status": "deleted", "project_id": project_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting project: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============== GENERATE RAW CLIPS ==============

@router.post("/projects/{project_id}/generate")
@limiter.limit("10/minute")
async def generate_raw_clips(
    request: Request,
    background_tasks: BackgroundTasks,
    project_id: str,
    video: UploadFile = File(default=None),
    video_path: str = Form(default=None),
    variant_count: int = Form(default=3),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generează clipuri RAW (fără audio, fără subtitrări) pentru triaj.
    Aceasta este prima etapă a workflow-ului nou.

    Accepts either:
    - video: uploaded file
    - video_path: local path to video file (for testing)
    """
    repo = get_repository()

    settings = get_settings()
    settings.ensure_dirs()

    # Verify the project exists and belongs to the profile
    project_data = verify_project_ownership(project_id, profile.profile_id)

    # Acquire lock non-blocking to eliminate TOCTOU race (STAB-03 + C4)
    lock = get_project_lock(project_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Project is currently being processed. Wait for the current job to finish before starting a new one."
        )

    # Determine video source: uploaded file or local path
    # Lock is already held — release it if anything fails before dispatching the background task.
    try:
        if video and video.filename:
            # Reject oversized uploads before reading the file into memory (STAB-05)
            await validate_upload_size(video)
            # Validate actual MIME type via magic-number inspection (blocks disguised malicious files)
            await validate_file_mime_type(video, ALLOWED_VIDEO_MIMES, "video")

            # User uploaded a file — store under project-scoped media directory
            job_id = str(uuid.uuid4())
            media_manager = get_media_manager()
            final_video_path = media_manager.upload_path(project_id, job_id, video.filename)

            try:
                with open(final_video_path, "wb") as f:
                    shutil.copyfileobj(video.file, f)
            except OSError as e:
                if final_video_path.exists():
                    final_video_path.unlink(missing_ok=True)
                logger.error(f"Failed to write uploaded file: {e}")
                raise HTTPException(status_code=507, detail="Failed to save uploaded file")
        elif video_path:
            # User provided local path (for testing)
            local_path = Path(video_path)
            if not local_path.exists():
                raise HTTPException(status_code=400, detail=f"Video file not found: {video_path}")
            final_video_path = local_path
        else:
            raise HTTPException(status_code=400, detail="Must provide either video file or video_path")

        # Get video info (offload to thread - spawns ffprobe subprocess)
        video_info = await asyncio.to_thread(_get_video_info, final_video_path)

        # Constraints
        variant_count = max(1, min(10, variant_count))

        # Launch generation in background (lock ownership transferred to task)
        background_tasks.add_task(
            _generate_raw_clips_task,
            project_id=project_id,
            profile_id=profile.profile_id,
            video_path=str(final_video_path),
            video_info=video_info,
            variant_count=variant_count,
            target_duration=project_data["target_duration"],
            context_text=project_data.get("context_text"),
            held_lock=lock
        )
    except Exception:
        # Release lock if background task was never dispatched
        lock.release()
        raise

    return {
        "status": "generating",
        "project_id": project_id,
        "variant_count": variant_count,
        "message": f"Generating {variant_count} raw clip variants..."
    }


async def _generate_raw_clips_task(
    project_id: str,
    video_path: str,
    video_info: dict,
    variant_count: int,
    target_duration: int,
    context_text: Optional[str],
    profile_id: Optional[str] = None,  # DB-08: default None instead of "default"
    held_lock: Optional[threading.Lock] = None  # C4: lock pre-acquired by endpoint
):
    """Task pentru generarea clipurilor raw în background."""
    from app.services.video_processor import VideoProcessorService

    # DB-08: Guard against missing profile_id
    if not profile_id:
        logger.error(f"Cannot generate raw clips for project {project_id}: profile_id is required")
        # Set project status to failed so it doesn't stay stuck on "generating"
        try:
            _repo = get_repository()
            if _repo:
                _repo.update_project(project_id, {"status": "failed"})
        except Exception:
            pass
        if held_lock:
            held_lock.release()
        return

    logger.info(f"[Profile {profile_id}] Starting raw clip generation for project {project_id}")

    repo = get_repository()
    if not repo:
        logger.error(f"[Profile {profile_id}] Repository not available for raw clips generation. Project {project_id} may be stuck in 'generating'.")
        try:
            # Attempt direct Supabase update as last resort
            from app.db import get_supabase
            _sb = get_supabase()
            if _sb:
                _sb.table("editai_projects").update({"status": "failed"}).eq("id", project_id).execute()
                logger.info(f"[Profile {profile_id}] Marked project {project_id} as failed via direct Supabase fallback")
        except Exception as _e:
            logger.error(f"[Profile {profile_id}] Failed to mark project {project_id} as failed: {_e}")
        if held_lock:
            held_lock.release()
        return

    settings = get_settings()

    # Use pre-acquired lock from endpoint (C4), or acquire here for backward compat
    if held_lock:
        lock = held_lock
    else:
        lock = get_project_lock(project_id)
        if not lock.acquire(blocking=False):
            logger.warning(f"Project {project_id} is already being processed, skipping")
            return

    result = None  # BUG-1.2: track result for cleanup decision in finally block
    # Create a job record for crash recovery (previously only Phase 2 had one)
    job_id = f"rawgen_{project_id}"
    try:
        from app.services.job_storage import get_job_storage
        get_job_storage().create_job({
            "job_id": job_id,
            "job_type": "raw_clip_generation",
            "project_id": project_id,
            "status": "processing",
            "progress": "Starting raw clip generation...",
        }, profile_id=profile_id)
    except Exception as _je:
        logger.warning(f"Failed to create job record for raw generation: {_je}")
    try:
        # Update project status now that we hold the lock
        try:
            repo.update_project(project_id, {
                "source_video_path": video_path,
                "source_video_duration": video_info.get("duration", 0),
                "source_video_width": video_info.get("width", 1080),
                "source_video_height": video_info.get("height", 1920),
                "status": "generating"
            })
        except Exception as e:
            logger.error(f"Failed to update project status to generating: {e}")

        # Profile-scoped temp directory to prevent cross-profile file collisions
        temp_dir = settings.base_dir / "temp" / profile_id
        temp_dir.mkdir(parents=True, exist_ok=True)

        processor = VideoProcessorService(
            input_dir=settings.input_dir,
            output_dir=settings.output_dir,
            temp_dir=temp_dir
        )

        # Check for cancellation before starting heavy processing
        if is_project_cancelled(project_id):
            logger.info(f"Project {project_id} was cancelled before processing started")
            clear_project_cancelled(project_id)
            repo.update_project(project_id, {"status": "cancelled"})
            return

        # Generate RAW clips (no audio, no subtitles)
        result = await asyncio.to_thread(
            processor.process_video,
            video_path=Path(video_path),
            output_name=f"project_{project_id[:8]}",
            target_duration=target_duration,
            audio_path=None,  # No audio
            srt_path=None,    # No subtitles
            subtitle_settings=None,
            variant_count=variant_count,
            # BUG-6.8: Use update_generation_progress instead of plain logger
            progress_callback=lambda step, status: update_generation_progress(project_id, 50, f"{step}: {status}"),
            context_text=context_text,
            generate_audio=False,  # IMPORTANT: Do not generate audio
            mute_source_voice=False
        )

        # Check for cancellation after processing completes
        if is_project_cancelled(project_id):
            logger.info(f"Project {project_id} was cancelled during processing")
            clear_project_cancelled(project_id)
            repo.update_project(project_id, {"status": "cancelled"})
            return

        if result["status"] == "success":
            # Save clips to DB
            variants = result.get("variants", [])
            if not variants and result.get("final_video"):
                # Single variant case
                variants = [{
                    "variant_index": 1,
                    "variant_name": "variant_1",
                    "final_video": result["final_video"]
                }]

            # Find highest existing variant_index to accumulate clips instead of overwriting
            start_variant_index = 1
            try:
                existing = repo.list_clips(
                    project_id,
                    QueryFilters(
                        eq={"profile_id": profile_id, "is_deleted": False},
                        select="variant_index",
                    ),
                )
                if existing.data:
                    max_index = max((c.get("variant_index") or 0) for c in existing.data)
                    start_variant_index = max_index + 1
                    logger.info(
                        f"Found {len(existing.data)} existing clips, new variants start from {start_variant_index}"
                    )
            except Exception as e:
                logger.warning(f"Could not check existing clips, starting from 1: {e}")

            # Re-index variants to continue from start_variant_index
            for i, variant in enumerate(variants):
                variant["variant_index"] = start_variant_index + i
                variant["variant_name"] = f"variant_{start_variant_index + i}"

            for variant in variants:
                video_file = Path(variant["final_video"])
                duration = await asyncio.to_thread(_get_video_duration, video_file)

                # Generate thumbnail
                thumbnail_path = await asyncio.to_thread(_generate_thumbnail, video_file, project_id)

                # Insert into DB
                try:
                    repo.create_clip({
                        "project_id": project_id,
                        "profile_id": profile_id,
                        "variant_index": variant["variant_index"],
                        "variant_name": variant["variant_name"],
                        "raw_video_path": str(video_file),
                        "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
                        "duration": duration,
                        "is_selected": False,
                        "is_deleted": False,
                        "final_status": "pending"
                    })
                except Exception as clip_err:
                    logger.error(f"Failed to insert clip {variant['variant_index']}: {clip_err}")
                    continue  # Continue with next clip instead of aborting

            # Update the project
            # BUG-5.2: Use the actual max variant index instead of just len(variants)
            # to reflect accumulated clips across multiple generation runs
            max_variant_idx = max(v["variant_index"] for v in variants) if variants else 0
            repo.update_project(project_id, {
                "status": "ready_for_triage",
                "variants_count": max_variant_idx
            })

            logger.info(f"Generated {len(variants)} raw clips for project {project_id}")
        else:
            # Eroare
            repo.update_project(project_id, {"status": "failed"})
            logger.error(f"Failed to generate clips for project {project_id}: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error generating raw clips for {project_id}: {e}", exc_info=True)
        try:
            repo.update_project(project_id, {"status": "failed"})
        except Exception as db_err:
            logger.error(f"Failed to update project {project_id} status to failed: {db_err}")
    finally:
        # BUG-1.2: Only clean up uploaded input file on FAILURE to avoid deleting
        # the source video that Phase 2 rendering still needs.
        if result is None or result.get("status") != "success":
            try:
                input_file = Path(video_path)
                if input_file.exists() and (str(settings.input_dir) in str(input_file.parent) or str(settings.media_dir) in str(input_file.parent)):
                    input_file.unlink(missing_ok=True)
                    logger.debug(f"Cleaned up input video after failure: {video_path}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to cleanup input video {video_path}: {cleanup_err}")

        # Update job record with final status
        try:
            from app.services.job_storage import get_job_storage
            final_status = "completed" if (result and result.get("status") == "success") else "failed"
            get_job_storage().update_job(job_id, {"status": final_status, "progress": "Done"}, profile_id=profile_id)
        except Exception:
            pass
        # Clear stale progress entry
        clear_generation_progress(project_id)
        # Always release and cleanup the lock
        lock.release()
        cleanup_project_lock(project_id)
        logger.debug(f"Released and cleaned up lock for project {project_id}")


# ============== GENERATE FROM SEGMENTS ==============

class GenerateFromSegmentsRequest(BaseModel):
    variant_count: int = 3
    selection_mode: str = "random"
    target_duration: int = 30
    tts_text: Optional[str] = None
    generate_tts: bool = False
    mute_source_voice: bool = False

@router.post("/projects/{project_id}/generate-from-segments")
async def generate_from_segments(
    background_tasks: BackgroundTasks,
    project_id: str,
    request: GenerateFromSegmentsRequest = GenerateFromSegmentsRequest(),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Generează clipuri din segmentele pre-selectate ale proiectului.

    Args:
        project_id: ID-ul proiectului
        variant_count: Numărul de variante de generat (1-10)
        selection_mode: random, sequential, weighted
        target_duration: Durata țintă în secunde
        tts_text: Text opțional pentru TTS
        generate_tts: Dacă să genereze audio TTS
        mute_source_voice: Dacă să suprime vocea din video sursă
    """
    repo = get_repository()

    settings = get_settings()
    settings.ensure_dirs()

    # ML-04 gate: conditional inline check (mute_source_voice is a request body field,
    # so FastAPI Depends() cannot read it — must check after body parse).
    if request.mute_source_voice:
        _enforce_ml_installed("voice_mute")

    # Verify the project exists and belongs to the profile
    project_data = verify_project_ownership(project_id, profile.profile_id)

    # Acquire lock atomically in the endpoint to prevent TOCTOU race (like generate_raw_clips)
    lock = get_project_lock(project_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Project is currently being processed. Wait for the current job to finish before starting a new one."
        )

    try:
        # Fetch project segments and compose nested shape expected by the background task.
        # Replaces PostgREST nested-join syntax with explicit repo composition so the
        # route works under DATA_BACKEND=sqlite.
        ps_result = repo.list_project_segments(project_id, QueryFilters(order_by="sequence_order"))
        composed_segments = []
        for ps in (ps_result.data or []):
            seg_id = ps.get("segment_id") or ps.get("editai_segment_id")
            if not seg_id:
                # Some Supabase responses embed the joined editai_segments row directly
                embedded = ps.get("editai_segments") or {}
                seg_id = embedded.get("id") if isinstance(embedded, dict) else None
            if not seg_id:
                continue
            seg = repo.get_segment(seg_id)
            if not seg:
                continue
            source_video_id = seg.get("source_video_id")
            source_video = repo.get_source_video(source_video_id) if source_video_id else None
            composed_segments.append({
                **ps,
                "editai_segments": {
                    **seg,
                    "editai_source_videos": source_video or {},
                },
            })
        if not composed_segments:
            raise HTTPException(status_code=400, detail="No segments assigned to this project")

        # Find the highest existing variant_index to continue from there
        existing = repo.list_clips(
            project_id,
            QueryFilters(
                eq={"profile_id": profile.profile_id, "is_deleted": False},
                select="variant_index",
            ),
        )
        start_variant_index = 1
        if existing.data:
            max_index = max((clip.get("variant_index") or 0) for clip in existing.data)
            start_variant_index = max_index + 1
            logger.info(f"Found {len(existing.data)} existing clips, starting from variant {start_variant_index}")

        # Validate TTS text length before dispatching background task
        if request.generate_tts and request.tts_text:
            validate_tts_text_length(request.tts_text, "tts_text")

        # Constraints
        variant_count = max(1, min(10, request.variant_count))

        # Launch generation in background (lock is held, will be released by the task)
        background_tasks.add_task(
            _generate_from_segments_task,
            project_id=project_id,
            profile_id=profile.profile_id,
            segments=composed_segments,
            variant_count=variant_count,
            selection_mode=request.selection_mode,
            target_duration=request.target_duration,
            tts_text=request.tts_text if request.generate_tts else None,
            mute_source_voice=request.mute_source_voice,
            start_variant_index=start_variant_index,
            held_lock=lock
        )
    except Exception:
        lock.release()
        raise

    return {
        "status": "generating",
        "project_id": project_id,
        "variant_count": variant_count,
        "segments_count": len(composed_segments),
        "message": f"Generating {variant_count} clip variants from {len(composed_segments)} segments..."
    }


# ============== HELPER FUNCTIONS FOR VOICE MUTING ==============

def _get_overlapping_voice_mutes(
    segment_start: float,
    segment_end: float,
    voice_segments: list
) -> list:
    """
    Calculează porțiunile de voce care se suprapun cu un segment video.

    Args:
        segment_start: Timpul de start al segmentului video (în video original)
        segment_end: Timpul de end al segmentului video (în video original)
        voice_segments: Lista de VoiceSegment detectate

    Returns:
        Lista de tuple (start_relativ, end_relativ) - timpuri RELATIVE la segmentul extras
        Exemplu: segment video 10-15s, voce la 11-13s → returnează [(1.0, 3.0)]
    """
    overlapping = []

    for vs in voice_segments:
        # Check for overlap
        voice_start = vs.start_time if hasattr(vs, 'start_time') else vs.get('start', 0)
        voice_end = vs.end_time if hasattr(vs, 'end_time') else vs.get('end', 0)

        # Calculate the intersection
        overlap_start = max(segment_start, voice_start)
        overlap_end = min(segment_end, voice_end)

        if overlap_start < overlap_end:
            # Overlap exists - convert to relative time
            relative_start = overlap_start - segment_start
            relative_end = overlap_end - segment_start
            overlapping.append((relative_start, relative_end))

    return overlapping


def _merge_close_intervals(intervals: list, gap_threshold: float = 0.3) -> list:
    """
    Combină intervalele care sunt foarte apropiate pentru a evita audio sacadat.

    Args:
        intervals: Lista de (start, end) tuplu
        gap_threshold: Distanța minimă între intervale pentru a le păstra separate

    Returns:
        Lista de intervale combinate
    """
    if not intervals:
        return []

    sorted_intervals = sorted(intervals, key=lambda x: x[0])
    merged = [sorted_intervals[0]]

    for start, end in sorted_intervals[1:]:
        last_start, last_end = merged[-1]
        # If current interval starts before the previous one ends + gap
        if start <= last_end + gap_threshold:
            # Extindem intervalul precedent
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged


def _build_mute_filter(mute_intervals: list, fade_duration: float = 0.8, min_volume: float = 0.03) -> Optional[str]:
    """
    Construiește filtrul FFmpeg pentru mute selectiv cu fade exponențial profesional.

    Implementare stil Adobe Premiere "Exponential Fade":
    - Fade out: curba exponențială (slow start, fast drop)
    - Fade in: curba exponențială inversă (fast rise, slow settle)
    - Nu merge la 0 complet, ci la min_volume pentru a păstra naturalețea

    Args:
        mute_intervals: Lista de (start, end) în secunde, relative la segment
        fade_duration: Durata fade in/out în secunde (default 0.8s pentru tranziție smoothă)
        min_volume: Volumul minim în timpul vocii (default 0.03 = aproape inaudibil)

    Returns:
        String cu filtrul audio pentru FFmpeg
    """
    if not mute_intervals:
        return None

    # Merge nearby intervals to avoid choppy audio
    merged_intervals = _merge_close_intervals(mute_intervals, gap_threshold=0.4)

    if not merged_intervals:
        return None

    # BUG-6.7: For a single interval, use volume filter instead of afade chain.
    # afade applies globally and the second afade can undo the first's effect.
    # volume=enable='between(t,start,end)':volume=0 is precise and composable.
    if len(merged_intervals) == 1:
        start, end = merged_intervals[0]
        return f"volume=enable='between(t,{start:.3f},{end:.3f})':volume={min_volume}"

    # For multiple intervals, build a complex volume expression
    # Formula for exponential fade:
    # - Fade out (t aproape de voice_start): pow(distance/fade_duration, 2)
    # - Fade in (t after voice_end): 1 - pow(1 - distance/fade_duration, 2)

    fd = fade_duration
    mv = min_volume

    # Build the expression for each interval
    # Volume for each interval: 1 when far, fade when close, min_volume inside
    interval_expressions = []

    for start, end in merged_intervals:
        # Expression for this interval:
        # - t < start - fd: volum = 1 (departe, niciun efect)
        # - start - fd <= t < start: exponential fade out
        # - start <= t <= end: volum = min_volume
        # - end < t <= end + fd: exponential fade in
        # - t > end + fd: volum = 1 (departe, niciun efect)

        fade_start = start - fd
        fade_end = end + fd

        # Exponential curve: pow(x, 2) for slow-start/fast-end
        # x = (start - t) / fd for fade out, normalized to [0, 1]
        # result: 1 when t = start - fd, 0 when t = start

        expr = (
            f"if(lt(t,{fade_start:.3f}),1,"  # before fade: volume 1
            f"if(lt(t,{start:.3f}),"  # in fade out zone
            f"{mv}+(1-{mv})*pow((({start:.3f}-t)/{fd:.3f}),2),"  # exponential fade toward min_volume
            f"if(lt(t,{end:.3f}),{mv},"  # in voice zone: min_volume
            f"if(lt(t,{fade_end:.3f}),"  # in fade in zone
            f"{mv}+(1-{mv})*(1-pow((1-(t-{end:.3f})/{fd:.3f}),2)),"  # exponential fade from min_volume
            f"1))))"  # after fade: volume 1
        )
        interval_expressions.append(expr)

    # Combine all expressions - take minimum for overlapping intervals
    if len(interval_expressions) == 1:
        volume_expr = interval_expressions[0]
    else:
        # Multiply expressions - if any interval wants reduced volume, it applies
        volume_expr = "*".join([f"({e})" for e in interval_expressions])

    return f"volume='{volume_expr}':eval=frame"


async def _generate_from_segments_task(
    project_id: str,
    segments: List[dict],
    variant_count: int,
    selection_mode: str,
    target_duration: int,
    tts_text: Optional[str],
    mute_source_voice: bool,
    start_variant_index: int = 1,
    profile_id: Optional[str] = None,  # DB-08: default None instead of "default"
    held_lock: Optional[threading.Lock] = None  # Lock pre-acquired by endpoint
):
    """Task pentru generarea clipurilor din segmente în background."""
    import subprocess
    import random

    # DB-08: Guard against missing profile_id
    if not profile_id:
        logger.error(f"Cannot generate from segments for project {project_id}: profile_id is required")
        # Set project status to failed so it doesn't stay stuck on "generating"
        try:
            _repo = get_repository()
            if _repo:
                _repo.update_project(project_id, {"status": "failed"})
        except Exception:
            pass
        if held_lock:
            held_lock.release()
        return

    logger.info(f"[Profile {profile_id}] Starting clip generation from segments for project {project_id}")

    repo = get_repository()

    settings = get_settings()

    # Create a durable job record in JobStorage for crash recovery
    from app.services.job_storage import get_job_storage
    _gen_job_id = str(uuid.uuid4())
    try:
        get_job_storage().create_job({
            "job_id": _gen_job_id,
            "job_type": "clip_generation",
            "status": "processing",
            "progress": "Starting...",
            "project_id": project_id,
            "profile_id": profile_id,
        }, profile_id=profile_id)
    except Exception as _e:
        logger.warning(f"Failed to create job record for segment generation: {_e}")
        _gen_job_id = None

    # Use pre-acquired lock from endpoint, or acquire one if called directly
    lock = held_lock or get_project_lock(project_id)
    if not held_lock and not lock.acquire(blocking=False):
        logger.warning(f"Project {project_id} is already being processed, skipping")
        if _gen_job_id:
            try:
                get_job_storage().update_job(_gen_job_id, {
                    "status": "failed",
                    "progress": "Project already being processed",
                })
            except Exception:
                pass
        return

    try:
        # BUG-5.3: Recompute start_variant_index inside the background task (after
        # acquiring the lock) to avoid TOCTOU race with concurrent requests.
        try:
            _existing = repo.list_clips(
                project_id,
                QueryFilters(
                    eq={"profile_id": profile_id, "is_deleted": False},
                    select="variant_index",
                ),
            )
            if _existing.data:
                _max_idx = max((clip.get("variant_index") or 0) for clip in _existing.data)
                start_variant_index = _max_idx + 1
                logger.info(f"[BUG-5.3] Recomputed start_variant_index={start_variant_index} inside lock")
        except Exception as _e:
            logger.warning(f"Failed to recompute start_variant_index, using passed value {start_variant_index}: {_e}")

        # Update project status now that we hold the lock
        try:
            repo.update_project(project_id, {
                "status": "generating",
                "target_duration": target_duration,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as e:
            logger.warning(f"Failed to update project status to 'generating': {e} — continuing anyway")

        # Initial progress
        update_generation_progress(project_id, 5, "Se pregătesc segmentele...", job_id=_gen_job_id)

        # Prepare segment list with their files
        available_segments = []
        for ps in segments:
            seg = ps.get("editai_segments", {})
            source_video = seg.get("editai_source_videos", {})
            file_path = source_video.get("file_path")

            if file_path and Path(file_path).exists():
                available_segments.append({
                    "id": seg.get("id"),
                    "file_path": file_path,
                    "start_time": seg.get("start_time", 0),
                    "end_time": seg.get("end_time", 0),
                    "duration": (seg.get("end_time") or 0) - (seg.get("start_time") or 0),
                    "source_name": source_video.get("name", "unknown")
                })

        if not available_segments:
            raise Exception("No valid segments with existing video files")

        logger.info(f"Processing {len(available_segments)} segments for project {project_id}")

        # ============== VOICE DETECTION (if mute_source_voice is enabled) ==============
        voice_segments_by_file = {}
        if mute_source_voice:
            update_generation_progress(project_id, 8, "Se detectează vocile din video-uri sursă...", job_id=_gen_job_id)
            try:
                from app.services.voice_detector import VoiceDetector
                detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)  # Balanced threshold

                # Detect voices for each unique source file
                unique_files = set(seg["file_path"] for seg in available_segments)
                for idx, file_path in enumerate(unique_files):
                    try:
                        logger.info(f"Detecting voice in: {file_path}")
                        voice_segs = detector.detect_voice(Path(file_path))
                        if voice_segs:
                            voice_segments_by_file[file_path] = voice_segs
                            total_voice_duration = sum(v.duration for v in voice_segs)
                            logger.info(f"  Found {len(voice_segs)} voice segments ({total_voice_duration:.1f}s total)")
                        else:
                            logger.info(f"  No voice detected")
                    except Exception as e:
                        logger.warning(f"Voice detection failed for {file_path}: {e}")

                logger.info(f"Voice detection complete: {len(voice_segments_by_file)} files with voice")
            except Exception as e:
                logger.error(f"Voice detection initialization failed: {e}")
                # Continue without mute if detection fails
                voice_segments_by_file = {}

        # Generate variants
        variants_created = []
        end_variant_index = start_variant_index + variant_count

        for variant_idx in range(start_variant_index, end_variant_index):
            # Check for cancellation
            if is_project_cancelled(project_id):
                logger.info(f"[Profile {profile_id}] Generation cancelled for project {project_id}")
                clear_project_cancelled(project_id)
                break

            try:
                # Update progress for this variant (relative to this batch)
                relative_idx = variant_idx - start_variant_index + 1
                base_pct = 10 + int(((relative_idx - 1) / variant_count) * 80)
                update_generation_progress(
                    project_id,
                    base_pct,
                    f"Se generează varianta {variant_idx} ({relative_idx} din {variant_count} noi)...",
                    job_id=_gen_job_id
                )

                # BUG-1.3: Select segments for this variant with cross-variant diversity.
                # Each variant gets a different ordering/offset to avoid identical outputs.
                relative_idx = variant_idx - start_variant_index
                if selection_mode == "sequential":
                    # Offset by variant index to start from different positions
                    step = max(1, len(available_segments) // max(variant_count, 1))
                    offset = relative_idx * step
                    selected = available_segments[offset:] + available_segments[:offset]
                elif selection_mode == "weighted":
                    # For weighted, prioritize longer segments but offset per variant
                    sorted_segs = sorted(available_segments, key=lambda x: x["duration"], reverse=True)
                    step = max(1, len(sorted_segs) // max(variant_count, 1))
                    offset = relative_idx * step
                    selected = sorted_segs[offset:] + sorted_segs[:offset]
                else:  # random
                    selected = available_segments.copy()
                    random.shuffle(selected)

                # Collect segments until we reach target duration
                segments_for_variant = []
                current_duration = 0

                logger.info(f"Variant {variant_idx}: target_duration={target_duration}s, available segments={len(selected)}")

                for seg in selected:
                    if current_duration >= target_duration:
                        logger.info(f"  Stopping: current_duration ({current_duration:.1f}s) >= target ({target_duration}s)")
                        break

                    remaining_duration = target_duration - current_duration

                    # If segment exceeds remaining duration, truncate it
                    if seg["duration"] > remaining_duration:
                        # Add truncated segment
                        truncated_seg = seg.copy()
                        truncated_seg["duration"] = remaining_duration
                        truncated_seg["end_time"] = seg["start_time"] + remaining_duration
                        truncated_seg["truncated"] = True
                        segments_for_variant.append(truncated_seg)
                        logger.info(f"  Added truncated segment: {seg['duration']:.1f}s -> {remaining_duration:.1f}s")
                        current_duration = target_duration
                        break
                    else:
                        segments_for_variant.append(seg)
                        current_duration += seg["duration"]
                        logger.info(f"  Added segment: {seg['duration']:.1f}s, total={current_duration:.1f}s")

                logger.info(f"  Final selection: {len(segments_for_variant)} segments, {current_duration:.1f}s")

                if not segments_for_variant:
                    logger.warning(f"No segments selected for variant {variant_idx}")
                    continue

                # Create video for this variant
                output_filename = f"project_{project_id[:8]}_variant_{variant_idx}.mp4"
                output_path = settings.output_dir / output_filename

                # Build file list for concat
                # Profile-scoped temp directory to prevent cross-profile file collisions
                concat_list_path = settings.base_dir / "temp" / profile_id / f"concat_{project_id}_{variant_idx}.txt"
                concat_list_path.parent.mkdir(parents=True, exist_ok=True)

                with open(concat_list_path, "w") as f:
                    for seg in segments_for_variant:
                        # Extract segment from source video
                        seg_id_short = (seg['id'] or 'unknown')[:8]
                        segment_output = settings.base_dir / "temp" / profile_id / f"seg_{project_id}_{variant_idx}_{seg_id_short}.mp4"

                        # ============== VOICE MUTING: Build audio filter if needed ==============
                        audio_filter_args = []
                        if mute_source_voice and seg["file_path"] in voice_segments_by_file:
                            voice_segs = voice_segments_by_file[seg["file_path"]]
                            overlapping_mutes = _get_overlapping_voice_mutes(
                                seg["start_time"],
                                seg["end_time"],
                                voice_segs
                            )
                            if overlapping_mutes:
                                audio_filter = _build_mute_filter(overlapping_mutes)
                                if audio_filter:
                                    # Add noise cancelling after mute to reduce residual voices
                                    # afftdn: FFT-based denoiser (mai agresiv)
                                    # - nr=25: strong noise reduction (25dB)
                                    # - nf=-20: noise floor mai ridicat
                                    # - tn=1: track noise (adaptiv)
                                    noise_filter = "afftdn=nr=25:nf=-20:tn=1"
                                    combined_filter = f"{audio_filter},{noise_filter}"
                                    audio_filter_args = ["-af", combined_filter]
                                    logger.info(f"    Applying voice mute filter: {len(overlapping_mutes)} intervals + noise reduction")

                        # If we don't have mute filter but mute_source_voice is enabled,
                        # apply only noise cancelling to reduce undetected voices
                        if mute_source_voice and not audio_filter_args:
                            noise_filter = "afftdn=nr=25:nf=-20:tn=1"
                            audio_filter_args = ["-af", noise_filter]

                        # Build audio args: if we have audio filters, keep audio and re-encode;
                        # otherwise just copy audio as-is with AAC codec
                        if audio_filter_args:
                            audio_codec_args = [*audio_filter_args, "-c:a", "aac"]
                        else:
                            audio_codec_args = ["-c:a", "aac"]

                        extract_cmd = [
                            "ffmpeg", "-y", "-threads", "4",
                            "-ss", str(seg["start_time"]),
                            "-i", seg["file_path"],
                            "-t", str(seg["duration"]),
                            *get_prep_codec_params(include_audio=False),
                            *audio_codec_args,
                            "-avoid_negative_ts", "make_zero",
                            str(segment_output)
                        ]

                        try:
                            async with await acquire_prep_slot():
                                result = await asyncio.to_thread(safe_ffmpeg_run, extract_cmd, 300, "segment extract")
                        except (subprocess.CalledProcessError, RuntimeError) as ffmpeg_err:
                            logger.error(f"FFmpeg extract failed: {ffmpeg_err}")
                            continue
                        if result.returncode != 0:
                            logger.error(f"FFmpeg extract error: {result.stderr}")
                            continue

                        escaped_path = str(segment_output).replace("\\", "\\\\").replace("'", "\\'")
                        f.write(f"file '{escaped_path}'\n")

                # Concatenate segments
                concat_cmd = [
                    "ffmpeg", "-y", "-threads", "4",
                    "-f", "concat", "-safe", "0",
                    "-i", str(concat_list_path),
                    *get_prep_codec_params(),
                    str(output_path)
                ]

                async with await acquire_prep_slot():
                    result = await asyncio.to_thread(safe_ffmpeg_run, concat_cmd, 300, "segment concat")
                if result.returncode != 0:
                    logger.error(f"FFmpeg concat error: {result.stderr}")
                    continue

                # Verify the file was created
                if not output_path.exists():
                    logger.error(f"Output file not created: {output_path}")
                    continue

                # Get actual duration
                actual_duration = await asyncio.to_thread(_get_video_duration, output_path)

                # Generate thumbnail
                thumbnail_path = await asyncio.to_thread(_generate_thumbnail, output_path, project_id)

                # Save to DB
                try:
                    repo.create_clip({
                        "project_id": project_id,
                        "profile_id": profile_id,
                        "variant_index": variant_idx,
                        "variant_name": f"variant_{variant_idx}",
                        "raw_video_path": str(output_path),
                        "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
                        "duration": actual_duration,
                        "is_selected": False,
                        "is_deleted": False,
                        "final_status": "pending",
                    })
                except Exception as db_err:
                    logger.error(f"Failed to save clip for variant {variant_idx}: {db_err}")
                    continue

                variants_created.append({
                    "variant_index": variant_idx,
                    "path": str(output_path),
                    "duration": actual_duration
                })

                # Increment usage_count for segments used in this variant
                try:
                    used_seg_ids = [s["id"] for s in segments_for_variant if s.get("id")]
                    if used_seg_ids:
                        _increment_segment_usage(used_seg_ids)
                        logger.info(
                            f"Incremented usage_count for {len(used_seg_ids)} "
                            f"segments (variant {variant_idx})"
                        )
                except Exception as usage_err:
                    logger.warning(
                        f"Failed to increment segment usage_count "
                        f"for variant {variant_idx}: {usage_err}"
                    )

                logger.info(f"Created variant {variant_idx} for project {project_id}: {actual_duration:.1f}s")

                # Update progress after variant created
                done_pct = min(10 + int(((variant_idx - start_variant_index + 1) / variant_count) * 80), 95)
                update_generation_progress(
                    project_id,
                    done_pct,
                    f"Varianta {variant_idx} completă ({actual_duration:.1f}s)",
                    job_id=_gen_job_id
                )

            except Exception as e:
                logger.error(f"Error creating variant {variant_idx}: {e}")
                continue
            finally:
                # Clean up segment temp files for this variant
                try:
                    temp_dir = settings.base_dir / "temp" / profile_id
                    for tmp_file in temp_dir.glob(f"seg_{project_id}_{variant_idx}_*.mp4"):
                        tmp_file.unlink(missing_ok=True)
                    concat_path = temp_dir / f"concat_{project_id}_{variant_idx}.txt"
                    concat_path.unlink(missing_ok=True)
                except Exception:
                    pass

        # Final progress update
        update_generation_progress(project_id, 95, "Se finalizează...", job_id=_gen_job_id)

        # Update the project
        if variants_created:
            # Re-count AFTER all variants are created (must be fresh to avoid stale values).
            # count_clips is profile-scoped; add eq filter on project_id to scope further.
            try:
                total_count = repo.count_clips(
                    profile_id,
                    QueryFilters(eq={"project_id": project_id, "is_deleted": False}),
                )
            except Exception as _cnt_err:
                logger.warning(f"Failed to re-count clips for project {project_id}: {_cnt_err}")
                total_count = len(variants_created)

            try:
                repo.update_project(project_id, {
                    "status": "ready_for_triage",
                    "variants_count": total_count,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as _upd_err:
                logger.warning(f"Status update failed for project {project_id}: {_upd_err}")
            logger.info(f"Added {len(variants_created)} new clips (total: {total_count}) for project {project_id}")
            # DB-03: Mark generation job as completed on success
            if _gen_job_id:
                try:
                    get_job_storage().update_job(_gen_job_id, {
                        "status": "completed",
                        "progress": f"Generated {len(variants_created)} clips",
                    })
                except Exception:
                    pass
        else:
            try:
                repo.update_project(project_id, {
                    "status": "failed",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as _upd_err:
                logger.warning(f"Status update failed for project {project_id}: {_upd_err}")
            logger.error(f"Failed to generate any clips for project {project_id}")

    except Exception as e:
        logger.error(f"Error generating from segments for {project_id}: {e}", exc_info=True)
        try:
            repo.update_project(project_id, {
                "status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as db_err:
            logger.error(f"Failed to update project {project_id} status to failed: {db_err}")
    finally:
        # DB-03: Ensure generation job is always closed (completed or failed)
        if _gen_job_id:
            try:
                job = get_job_storage().get_job(_gen_job_id)
                if job and job.get("status") == "processing":
                    # If we get here with status still "processing", mark as failed
                    get_job_storage().update_job(_gen_job_id, {
                        "status": "failed",
                        "progress": "Job did not complete normally",
                    })
            except Exception as _je:
                logger.warning(f"Failed to close generation job {_gen_job_id}: {_je}")
        lock.release()
        cleanup_project_lock(project_id)
        clear_generation_progress(project_id)
        logger.debug(f"Released lock for project {project_id}")


# ============== CLIPS (LIBRARY) ==============

@router.get("/projects/{project_id}/clips")
async def list_project_clips(
    project_id: str,
    include_deleted: bool = False,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Listează toate clipurile unui proiect (pentru galerie/triaj)."""
    repo = get_repository()

    # Verify project ownership
    verify_project_ownership(project_id, profile.profile_id)

    try:
        eq_filters = {"profile_id": profile.profile_id}
        if not include_deleted:
            eq_filters["is_deleted"] = False
        filters = QueryFilters(
            eq=eq_filters,
            order_by="variant_index",
            order_desc=False,
        )
        result = repo.list_clips(project_id, filters)
        return {"clips": result.data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing clips: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/tags")
async def list_tags(profile: ProfileContext = Depends(get_profile_context)):
    """Return all unique tags used across clips for this profile."""
    repo = get_repository()
    try:
        result = repo.list_clips_by_profile(
            profile.profile_id,
            QueryFilters(eq={"is_deleted": False}, select="tags"),
        )

        # Flatten and deduplicate all tags
        all_tags: set = set()
        for row in (result.data or []):
            for tag in (row.get("tags") or []):
                all_tags.add(tag)

        return {"tags": sorted(all_tags)}
    except Exception as e:
        logger.error(f"Error listing tags: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


def _get_or_create_sync_project(profile_id: str) -> str:
    """Find or create the 'Imported from disk' project for orphan clip sync."""
    repo = get_repository()
    existing = repo.get_project_by_name(profile_id, "Imported from disk")
    if existing:
        return existing["id"]
    created = repo.create_project({
        "profile_id": profile_id,
        "name": "Imported from disk",
        "description": "Auto-imported videos found on disk",
        "status": "completed",
    })
    return created["id"]


def _is_syncable_orphan_video(video_file: Path) -> bool:
    """Return True only for final rendered videos that should appear in library."""
    if video_file.suffix.lower() != ".mp4":
        return False
    if video_file.name.endswith("_raw.mp4"):
        return False
    return True


async def _sync_orphan_clips(profile_id: str) -> int:
    """Scan output/{profile_id}/ for .mp4 files not in DB and insert them."""
    repo = get_repository()
    settings = get_settings()
    profile_dir = settings.output_dir / profile_id
    if not profile_dir.is_dir():
        return 0

    mp4_files = [f for f in profile_dir.glob("*.mp4") if _is_syncable_orphan_video(f)]
    if not mp4_files:
        return 0

    # Get all known video filenames for this profile (including soft-deleted)
    known_result = repo.list_clips_by_profile(
        profile_id,
        QueryFilters(select="raw_video_path, final_video_path"),
    )
    known_names: set = set()
    for row in (known_result.data or []):
        for field in ("raw_video_path", "final_video_path"):
            val = row.get(field)
            if val:
                known_names.add(Path(val).name)

    orphans = [f for f in mp4_files if f.name not in known_names]
    if not orphans:
        return 0

    sync_project_id = _get_or_create_sync_project(profile_id)
    inserted = 0
    for video_file in orphans:
        try:
            duration = await asyncio.to_thread(_get_video_duration, video_file)
            thumbnail = await asyncio.to_thread(_generate_thumbnail, video_file, sync_project_id)
            repo.create_clip({
                "project_id": sync_project_id,
                "profile_id": profile_id,
                "variant_index": 0,
                "variant_name": video_file.stem,
                "raw_video_path": str(video_file),
                "final_video_path": str(video_file),
                "thumbnail_path": str(thumbnail) if thumbnail else None,
                "duration": duration,
                "is_selected": False,
                "is_deleted": False,
                "final_status": "completed",
            })
            inserted += 1
        except Exception as e:
            logger.warning(f"Failed to sync orphan clip {video_file.name}: {e}")
    if inserted:
        logger.info(f"Synced {inserted} orphan clips for profile {profile_id}")
    return inserted


@router.get("/all-clips")
async def list_all_clips(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    cursor: Optional[str] = Query(default=None, description="ISO 8601 timestamp — return clips older than this value (cursor-based pagination)"),
    tag: Optional[str] = Query(default=None, description="Filter clips by tag"),
    sync_orphans: bool = Query(default=True, description="Sync orphaned rendered videos from disk before listing clips"),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Listează toate clipurile pentru librărie cu suport cursor-based pagination."""
    repo = get_repository()

    if sync_orphans and not cursor:
        import time as _time
        _now = _time.monotonic()
        _last = getattr(list_all_clips, "_last_orphan_sync", {}).get(profile.profile_id, 0)
        if _now - _last > 300:  # 5 minutes
            try:
                await _sync_orphan_clips(profile.profile_id)
                if not hasattr(list_all_clips, "_last_orphan_sync"):
                    list_all_clips._last_orphan_sync = {}
                list_all_clips._last_orphan_sync[profile.profile_id] = _now
            except Exception as e:
                logger.warning(f"Orphan clip sync failed: {e}")

    try:
        # Total count via repository
        count_filters = QueryFilters(eq={"is_deleted": False})
        if tag:
            count_filters.contains = {"tags": [tag]}
        total = repo.count_clips(profile.profile_id, count_filters)

        # List query — apply cursor or offset (T-80-02-01: list_clips_by_profile
        # is profile-scoped, ensuring per-clip get_clip_content cannot leak rows
        # belonging to other profiles).
        list_filters = QueryFilters(
            eq={"is_deleted": False},
            order_by="created_at",
            order_desc=True,
            limit=limit,
        )
        if tag:
            list_filters.contains = {"tags": [tag]}
        if cursor:
            # Original PostgREST used .lte("created_at", cursor); preserve semantics
            list_filters.lte = {"created_at": cursor}
        else:
            list_filters.offset = offset
        clips_result = repo.list_clips_by_profile(profile.profile_id, list_filters)

        if not clips_result.data:
            return {"clips": [], "total": total, "limit": limit, "offset": offset, "next_cursor": None, "has_more": False}

        # Collect unique project IDs and fetch project metadata once each
        project_ids = sorted({c["project_id"] for c in clips_result.data if c.get("project_id")})
        project_cache: Dict[str, Dict] = {}
        for pid in project_ids:
            proj = repo.get_project(pid)
            if proj:
                project_cache[pid] = proj

        # Fetch content per clip (T-80-02-02: N+1 accepted for v13 desktop scale —
        # typical page size ≤ 200; batch-by-clip-ids optimization deferred to v14)
        content_map: Dict[str, Dict] = {}
        for clip in clips_result.data:
            content = repo.get_clip_content(clip["id"])
            if content:
                content_map[clip["id"]] = content

        # Build response with has_subtitles and has_voiceover flags
        clips_with_info = []
        for clip in clips_result.data:
            content = content_map.get(clip["id"], {})
            project_data = project_cache.get(clip.get("project_id"), {})

            # Check audio presence — use content data if available, fallback to filename heuristic
            video_path = clip.get("final_video_path") or clip.get("raw_video_path", "")
            has_audio = content.get("tts_audio_path") is not None if content else "_noaudio" not in video_path

            clips_with_info.append({
                "id": clip["id"],
                "project_id": clip["project_id"],
                "project_name": project_data.get("name", "Unknown"),
                "variant_index": clip["variant_index"],
                "variant_name": clip.get("variant_name"),
                "raw_video_path": clip["raw_video_path"],
                "thumbnail_path": clip.get("thumbnail_path"),
                "duration": clip.get("duration"),
                "final_video_path": clip.get("final_video_path"),
                "final_status": clip.get("final_status", "pending"),
                "created_at": clip["created_at"],
                "postiz_status": clip.get("postiz_status") or "not_sent",
                "postiz_post_id": clip.get("postiz_post_id"),
                "postiz_scheduled_at": clip.get("postiz_scheduled_at"),
                "has_subtitles": bool(content.get("srt_content")),
                "has_voiceover": bool(content.get("tts_audio_path")),
                "has_audio": has_audio,
                "tags": clip.get("tags") or [],
                "context_text": project_data.get("context_text") or None,
                "tiktok_posted": clip.get("tiktok_posted") or False,
                "instagram_posted": clip.get("instagram_posted") or False,
                "youtube_posted": clip.get("youtube_posted") or False,
                "facebook_posted": clip.get("facebook_posted") or False,
                "is_downloaded_posted": clip.get("is_downloaded_posted") or False,
                "qc_verified": clip.get("qc_verified") or False,
                "srt_content": content.get("srt_content") or None,
                "tts_text": content.get("tts_text") or None,
            })

        # Compute next_cursor: the created_at of the last clip if a full page was returned
        has_more = len(clips_with_info) == limit
        next_cursor = clips_with_info[-1]["created_at"] if has_more else None

        return {
            "clips": clips_with_info,
            "total": total,
            "limit": limit,
            "offset": offset,
            "next_cursor": next_cursor,
            "has_more": has_more,
        }
    except Exception as e:
        logger.error(f"Error listing all clips: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/sync-orphans")
async def sync_orphan_clips(
    profile: ProfileContext = Depends(get_profile_context),
):
    """Explicitly import orphaned mp4 files from disk into the library."""
    try:
        inserted = await _sync_orphan_clips(profile.profile_id)
        return {"status": "completed", "inserted": inserted}
    except Exception as e:
        logger.error(f"Error syncing orphan clips: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/clips/{clip_id}")
async def get_clip(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține detaliile unui clip, inclusiv conținutul asociat."""
    repo = get_repository()

    try:
        clip = repo.get_clip(clip_id)
        if not clip or clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        content = repo.get_clip_content(clip_id)

        return {
            "clip": clip,
            "content": content
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting clip: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class ClipUpdateRequest(BaseModel):
    variant_name: Optional[str] = None
    is_selected: Optional[bool] = None
    postiz_status: Optional[str] = None
    postiz_post_id: Optional[str] = None
    postiz_scheduled_at: Optional[str] = None
    tags: Optional[List[str]] = None  # User-defined tags for clip organization
    tiktok_posted: Optional[bool] = None
    instagram_posted: Optional[bool] = None
    youtube_posted: Optional[bool] = None
    facebook_posted: Optional[bool] = None
    is_downloaded_posted: Optional[bool] = None
    qc_verified: Optional[bool] = None


@router.patch("/clips/{clip_id}")
async def update_clip(
    clip_id: str,
    request: ClipUpdateRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează un clip (nume, selecție, status Postiz)."""
    repo = get_repository()

    try:
        # Verify ownership first
        existing = repo.get_clip(clip_id)
        if not existing or existing.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

        if request.variant_name is not None:
            update_data["variant_name"] = request.variant_name
        if request.is_selected is not None:
            update_data["is_selected"] = request.is_selected
        if request.postiz_status is not None:
            update_data["postiz_status"] = request.postiz_status
        if request.postiz_post_id is not None:
            update_data["postiz_post_id"] = request.postiz_post_id
        if request.postiz_scheduled_at is not None:
            update_data["postiz_scheduled_at"] = request.postiz_scheduled_at
        if request.tags is not None:
            # Normalize tags: lowercase, strip whitespace, deduplicate, limit to 20 tags
            clean_tags = list(set(tag.strip().lower() for tag in request.tags if tag.strip()))[:20]
            update_data["tags"] = clean_tags
        if request.tiktok_posted is not None:
            update_data["tiktok_posted"] = request.tiktok_posted
        if request.instagram_posted is not None:
            update_data["instagram_posted"] = request.instagram_posted
        if request.youtube_posted is not None:
            update_data["youtube_posted"] = request.youtube_posted
        if request.facebook_posted is not None:
            update_data["facebook_posted"] = request.facebook_posted
        if request.is_downloaded_posted is not None:
            update_data["is_downloaded_posted"] = request.is_downloaded_posted
        if request.qc_verified is not None:
            update_data["qc_verified"] = request.qc_verified

        updated = repo.update_clip(clip_id, update_data)
        if not updated:
            raise HTTPException(status_code=404, detail="Clip not found")

        if request.is_selected is not None:
            await _update_project_counts(updated["project_id"], profile.profile_id)
        return {"status": "updated", "clip": updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.patch("/clips/{clip_id}/select")
async def toggle_clip_selection(
    clip_id: str,
    selected: bool,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Selectează/deselectează un clip pentru procesare ulterioară."""
    repo = get_repository()

    try:
        clip = repo.get_clip(clip_id)
        if not clip or clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        updated = repo.update_clip(clip_id, {
            "is_selected": selected,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

        # Update counter in project
        await _update_project_counts(updated["project_id"], profile.profile_id)
        return {"status": "updated", "clip_id": clip_id, "is_selected": selected}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip selection: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/clips/bulk-select")
async def bulk_select_clips(
    clip_ids: List[str],
    selected: bool,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Selectează/deselectează mai multe clipuri odată."""
    repo = get_repository()

    try:
        updated_clips = repo.bulk_update_clips(clip_ids, profile.profile_id, {
            "is_selected": selected,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })

        # Collect unique project IDs from updated clips to refresh counts
        project_ids = list(set(c["project_id"] for c in updated_clips))

        # Update counters
        for project_id in project_ids:
            await _update_project_counts(project_id, profile.profile_id)

        return {"status": "updated", "count": len(updated_clips), "is_selected": selected}
    except Exception as e:
        logger.error(f"Error bulk selecting clips: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/clips/{clip_id}/remove-audio")
async def remove_clip_audio(
    clip_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Elimină definitiv pista audio dintr-un videoclip.
    Creează o versiune nouă a videoclipului fără sunet.
    """
    repo = get_repository()

    try:
        # Get clip info (T-80-01-01: profile_id check after repo.get_clip)
        clip = repo.get_clip(clip_id)
        if not clip or clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Check if project is currently being processed
        clip_project_id = clip.get("project_id")
        if clip_project_id and is_project_locked(clip_project_id):
            raise HTTPException(status_code=409, detail="Project is currently being processed")

        path_str = clip.get("final_video_path") or clip.get("raw_video_path")
        if not path_str:
            raise HTTPException(status_code=404, detail="No video path available")
        video_path = Path(path_str)

        if not video_path.exists():
            raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

        # Create output path for video without audio
        output_dir = video_path.parent
        output_filename = f"{video_path.stem}_noaudio{video_path.suffix}"
        output_path = output_dir / output_filename

        # FFmpeg command to remove audio
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-c:v", "copy",  # Copy video stream without re-encoding
            "-an",  # Remove audio
            str(output_path)
        ]

        logger.info(f"Removing audio from clip {clip_id}: {video_path} -> {output_path}")
        from app.services.ffmpeg_semaphore import safe_ffmpeg_run
        result = await asyncio.to_thread(safe_ffmpeg_run, cmd, 120, "remove clip audio")

        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            # Clean up partial output file on failure
            if output_path.exists():
                output_path.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail="Failed to remove audio")

        # Update database with new video path
        update_data = {
            "raw_video_path": str(output_path),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # If there was a final_video_path, clear it since we've modified the source
        if clip.get("final_video_path"):
            update_data["final_video_path"] = str(output_path)

        repo.update_clip(clip_id, update_data)

        # Clear TTS audio path in clip content so has_audio state stays consistent (P7-3)
        try:
            repo.update_clip_content(clip_id, {
                "tts_audio_path": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as content_err:
            logger.warning(f"Failed to clear tts_audio_path for clip {clip_id}: {content_err}")

        logger.info(f"Audio removed successfully for clip {clip_id}")
        return {
            "status": "success",
            "clip_id": clip_id,
            "video_path": str(output_path),
            "has_audio": False,
            "message": "Audio removed successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing audio from clip {clip_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/clips/{clip_id}")
async def delete_clip(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Permanently delete a clip (files + DB record)."""
    repo = get_repository()

    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip = repo.get_clip(clip_id)
        if (
            not clip
            or clip.get("profile_id") != profile.profile_id
            or clip.get("is_deleted")
        ):
            raise HTTPException(status_code=404, detail="Clip not found")
        # Hard-delete: remove files from disk
        _delete_clip_files(clip)
        # Delete content row (child) then clip row (parent)
        repo.delete_clip_content_by_clip_ids([clip_id])
        repo.delete_clip(clip_id)
        logger.info(f"Hard-deleted clip {clip_id} (files + DB)")
        return {"status": "deleted", "clip_id": clip_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting clip: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class BulkDeleteRequest(BaseModel):
    clip_ids: List[str]


@router.post("/clips/bulk-delete")
async def bulk_delete_clips(
    request: BulkDeleteRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Permanently delete multiple clips (files + DB records)."""
    repo = get_repository()

    deleted = []
    failed = []
    clip_ids = request.clip_ids

    try:
        # T-80-01-01: per-id ownership check via repo.get_clip
        # Loop approach (vs in_() select) to reuse existing ABC methods.
        # T-80-01-06: silently skip non-owned IDs (accepted threat).
        found_clips = []
        for cid in clip_ids:
            clip = repo.get_clip(cid)
            if (
                clip
                and clip.get("profile_id") == profile.profile_id
                and not clip.get("is_deleted")
            ):
                found_clips.append(clip)
        found_ids = {clip["id"] for clip in found_clips}

        # Mark missing clips as failed
        for clip_id in clip_ids:
            if clip_id not in found_ids:
                failed.append({"id": clip_id, "error": "Not found"})

        if found_clips:
            found_id_list = list(found_ids)
            # Hard-delete: remove files from disk
            for clip in found_clips:
                _delete_clip_files(clip)
            # Delete content rows (child) then clip rows (parent)
            repo.delete_clip_content_by_clip_ids(found_id_list)
            repo.delete_clips_by_ids(found_id_list)

        deleted = list(found_ids)
        for clip_id in deleted:
            logger.info(f"Hard-deleted clip {clip_id} (files + DB)")

    except Exception as e:
        logger.error(f"Error in bulk delete: {e}")
        # If batch operation failed, mark all non-already-failed as failed
        for clip_id in clip_ids:
            if clip_id not in [f["id"] for f in failed] and clip_id not in deleted:
                failed.append({"id": clip_id, "error": "Internal error"})

    return {
        "status": "completed",
        "deleted_count": len(deleted),
        "deleted": deleted,
        "failed_count": len(failed),
        "failed": failed
    }



# ============== TRASH (SOFT-DELETE MANAGEMENT) ==============

@router.get("/trash")
async def list_trash(profile: ProfileContext = Depends(get_profile_context)):
    """List soft-deleted clips (trash view)."""
    repo = get_repository()
    try:
        result = repo.list_clips_by_profile(
            profile.profile_id,
            QueryFilters(
                eq={"is_deleted": True},
                order_by="deleted_at",
                order_desc=True,
                select="id, project_id, variant_index, variant_name, raw_video_path, thumbnail_path, duration, final_video_path, final_status, created_at, deleted_at",
            ),
        )
        # Enrich with project names (N small per-project lookups; trash is bounded)
        clips = result.data or []
        project_ids = list({c["project_id"] for c in clips if c.get("project_id")})
        project_names: Dict[str, str] = {}
        for pid in project_ids:
            project_row = repo.get_project(pid)
            if project_row and project_row.get("name"):
                project_names[pid] = project_row["name"]
        for clip in clips:
            clip["project_name"] = project_names.get(clip.get("project_id"), "Unknown")
            # Calculate days remaining before permanent deletion
            if clip.get("deleted_at"):
                from datetime import timedelta
                deleted = datetime.fromisoformat(clip["deleted_at"].replace("Z", "+00:00"))
                days_elapsed = (datetime.now(timezone.utc) - deleted).days
                clip["days_remaining"] = max(0, 30 - days_elapsed)
            else:
                clip["days_remaining"] = 30
        return {"clips": clips, "total": len(clips)}
    except Exception as e:
        logger.error(f"Error listing trash: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/trash/empty")
async def empty_trash(profile: ProfileContext = Depends(get_profile_context)):
    """Permanently delete ALL clips in trash (files + DB)."""
    repo = get_repository()
    try:
        result = repo.list_clips_by_profile(
            profile.profile_id,
            QueryFilters(
                eq={"is_deleted": True},
                select="id, raw_video_path, thumbnail_path, final_video_path",
            ),
        )
        clips = result.data or []
        if not clips:
            return {"status": "empty", "deleted_count": 0}
        for clip in clips:
            _delete_clip_files(clip)
        clip_ids = [c["id"] for c in clips]
        repo.delete_clip_content_by_clip_ids(clip_ids)
        repo.delete_clips_by_ids(clip_ids)
        logger.info(f"Emptied trash: {len(clips)} clips permanently deleted")
        return {"status": "emptied", "deleted_count": len(clips)}
    except Exception as e:
        logger.error(f"Error emptying trash: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/clips/{clip_id}/restore")
async def restore_clip(clip_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Restore a soft-deleted clip from trash."""
    repo = get_repository()
    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip = repo.get_clip(clip_id)
        if (
            not clip
            or clip.get("profile_id") != profile.profile_id
            or not clip.get("is_deleted")
        ):
            raise HTTPException(status_code=404, detail="Clip not found in trash")

        thumbnail_path = clip.get("thumbnail_path")
        if thumbnail_path and not Path(thumbnail_path).exists():
            video_path_str = clip.get("final_video_path") or clip.get("raw_video_path")
            if video_path_str:
                video_path = Path(video_path_str)
                if video_path.exists():
                    regenerated_thumb = await asyncio.to_thread(
                        _generate_thumbnail,
                        video_path,
                        clip.get("project_id"),
                    )
                    if regenerated_thumb:
                        thumbnail_path = str(regenerated_thumb)

        # T-80-01-01: ownership already verified above; update is safe
        repo.update_clip(clip_id, {
            "is_deleted": False,
            "deleted_at": None,
            "thumbnail_path": thumbnail_path,
        })
        logger.info(f"Restored clip {clip_id} from trash")
        return {"status": "restored", "clip_id": clip_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error restoring clip: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/clips/{clip_id}/permanent")
async def permanently_delete_clip(clip_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Permanently delete a clip from trash (files + DB)."""
    repo = get_repository()
    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip = repo.get_clip(clip_id)
        if (
            not clip
            or clip.get("profile_id") != profile.profile_id
            or not clip.get("is_deleted")
        ):
            raise HTTPException(status_code=404, detail="Clip not found in trash")
        _delete_clip_files(clip)
        # Delete content first (child), then clip record (parent)
        repo.delete_clip_content_by_clip_ids([clip_id])
        repo.delete_clip(clip_id)
        logger.info(f"Permanently deleted clip {clip_id}")
        return {"status": "permanently_deleted", "clip_id": clip_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error permanently deleting clip: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============== CLIP CONTENT (TTS + SUBTITLES) ==============

@router.put("/clips/{clip_id}/content")
async def update_clip_content(
    clip_id: str,
    content: ClipContentUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează conținutul asociat unui clip (TTS text, SRT, stil)."""
    repo = get_repository()

    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip = repo.get_clip(clip_id)
        if not clip or clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Prepare data for upsert
        content_data = {
            "clip_id": clip_id,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        if content.tts_text is not None:
            validate_tts_text_length(content.tts_text)
            content_data["tts_text"] = content.tts_text
        if content.srt_content is not None:
            content_data["srt_content"] = sanitize_srt_text(content.srt_content)
        if content.subtitle_settings is not None:
            content_data["subtitle_settings"] = content.subtitle_settings

        # Upsert via table_query escape hatch (update_clip_content is UPDATE-only;
        # both backends implement upsert with on_conflict in table_query).
        result = repo.table_query(
            "editai_clip_content",
            "upsert",
            data=content_data,
            filters=QueryFilters(on_conflict="clip_id"),
        )

        return {"status": "updated", "content": result.data[0] if result.data else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip content: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/clips/{clip_id}/content/copy-from/{source_clip_id}")
async def copy_content_from_clip(
    clip_id: str,
    source_clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Copiază conținutul (TTS, SRT, stil) de la un alt clip."""
    repo = get_repository()

    try:
        # T-80-01-01: profile_id check for both clips
        dest_clip = repo.get_clip(clip_id)
        if not dest_clip or dest_clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Destination clip not found")

        src_clip = repo.get_clip(source_clip_id)
        if not src_clip or src_clip.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Source clip not found")

        source_row = repo.get_clip_content(source_clip_id)
        if not source_row:
            raise HTTPException(status_code=404, detail="Source content not found")

        # Copy to destination
        content_data = {
            "clip_id": clip_id,
            "tts_text": source_row.get("tts_text"),
            "tts_voice_id": source_row.get("tts_voice_id"),
            "srt_content": source_row.get("srt_content"),
            "subtitle_settings": source_row.get("subtitle_settings"),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }

        # Upsert via table_query escape hatch (update_clip_content is UPDATE-only).
        result = repo.table_query(
            "editai_clip_content",
            "upsert",
            data=content_data,
            filters=QueryFilters(on_conflict="clip_id"),
        )

        return {"status": "copied", "content": result.data[0] if result.data else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error copying content: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============== EXPORT PRESETS ==============

@router.get("/export-presets")
async def list_export_presets(
    profile: ProfileContext = Depends(get_profile_context)
):
    """Listează toate preset-urile de export disponibile."""
    repo = get_repository()
    try:
        # list_export_presets ABC already emits "profile_id = ? OR profile_id IS NULL"
        # in SQLite impl (sqlite_repo.py:844-875) and the same OR semantics in Supabase impl.
        result = repo.list_export_presets(
            profile.profile_id,
            QueryFilters(order_by="is_default", order_desc=True),
        )
        return {"presets": result.data}
    except Exception as e:
        logger.error(f"Error listing presets: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# ============== MAINTENANCE ==============

@router.post("/maintenance/cleanup-temp")
async def cleanup_temp_files(
    max_age_hours: int = 24,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Cleanup orphaned temp files older than specified hours.
    Useful for manual maintenance or scheduled cleanup.
    """
    deleted = cleanup_orphaned_temp_files(max_age_hours)
    return {"status": "completed", "deleted_files": deleted}


@router.post("/maintenance/cleanup-output")
async def cleanup_output_endpoint(
    max_age_hours: int = 72,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Cleanup output files older than specified hours.
    Targets output/finals/ and output/tts/ directories.
    Raw video files in output/ root are never touched.
    """
    result = cleanup_output_files(max_age_hours)
    return {"status": "completed", **result}


@router.post("/maintenance/cleanup-exports")
async def cleanup_old_exports(
    max_age_days: int = Query(default=90, ge=1, le=365),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cleanup export records older than specified days to prevent unbounded table growth."""
    repo = get_repository()
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
        deleted_count = repo.delete_exports_older_than(profile.profile_id, cutoff)
        return {"status": "completed", "deleted_exports": deleted_count}
    except Exception as e:
        logger.error(f"Failed to cleanup exports: {e}")
        raise HTTPException(status_code=500, detail="Failed to cleanup exports")


# ============== FINAL RENDER ==============

@router.post("/clips/{clip_id}/render")
@limiter.limit("5/minute")
async def render_final_clip(
    request: Request,
    background_tasks: BackgroundTasks,
    clip_id: str,
    preset_name: str = Form(default="instagram_reels"),
    # Video enhancement filters (Phase 9)
    enable_denoise: str = Form(default="false"),
    denoise_strength: float = Form(default=2.0),
    enable_sharpen: str = Form(default="false"),
    sharpen_amount: float = Form(default=0.5),
    enable_color: str = Form(default="false"),
    brightness: float = Form(default=0.0),
    contrast: float = Form(default=1.0),
    saturation: float = Form(default=1.0),
    # Subtitle enhancement (Phase 11)
    shadow_depth: int = Form(default=0),
    enable_glow: str = Form(default="false"),
    glow_blur: int = Form(default=0),
    adaptive_sizing: str = Form(default="false"),
    # TTS model selection (Phase 12)
    elevenlabs_model: str = Form(default="eleven_flash_v2_5"),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Randează clipul final cu TTS și subtitrări.
    Folosește preset-ul de export specificat pentru encoding optimizat.
    """
    repo = get_repository()

    # Parse boolean strings (HTML forms send strings)
    enable_denoise_bool = enable_denoise.lower() in ("true", "1", "yes", "on")
    enable_sharpen_bool = enable_sharpen.lower() in ("true", "1", "yes", "on")
    enable_color_bool = enable_color.lower() in ("true", "1", "yes", "on")
    enable_glow_bool = enable_glow.lower() in ("true", "1", "yes", "on")
    adaptive_sizing_bool = adaptive_sizing.lower() in ("true", "1", "yes", "on")

    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip_row = repo.get_clip(clip_id)
        if not clip_row or clip_row.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Reject if this clip is already being rendered
        if clip_row.get("final_status") == "processing":
            raise HTTPException(status_code=409, detail="Clip is already being rendered. Please wait for the current render to finish.")

        # Reject immediately if a task is already running for this project (STAB-03)
        render_project_id = clip_row.get("project_id")
        if render_project_id and is_project_locked(render_project_id):
            raise HTTPException(
                status_code=409,
                detail="Project is currently being processed. Wait for the current job to finish before rendering."
            )

        content_row = repo.get_clip_content(clip_id)

        # Get the preset by name
        preset_row = repo.get_export_preset_by_name(preset_name)
        if not preset_row:
            raise HTTPException(status_code=404, detail=f"Preset '{preset_name}' not found")

        # Launch render in background (status update moved inside task after lock acquired)
        background_tasks.add_task(
            _render_final_clip_task,
            clip_id=clip_id,
            project_id=clip_row["project_id"],
            profile_id=profile.profile_id,
            clip_data=clip_row,
            content_data=content_row,
            preset_data=preset_row,
            # Video enhancement filters (Phase 9)
            enable_denoise=enable_denoise_bool,
            denoise_strength=denoise_strength,
            enable_sharpen=enable_sharpen_bool,
            sharpen_amount=sharpen_amount,
            enable_color=enable_color_bool,
            brightness=brightness,
            contrast=contrast,
            saturation=saturation,
            # Subtitle enhancement (Phase 11)
            shadow_depth=shadow_depth,
            enable_glow=enable_glow_bool,
            glow_blur=glow_blur,
            adaptive_sizing=adaptive_sizing_bool,
            # TTS model selection (Phase 12)
            elevenlabs_model=elevenlabs_model
        )

        return {
            "status": "processing",
            "clip_id": clip_id,
            "preset": preset_name,
            "message": "Rendering final clip with TTS and subtitles..."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting render: {e}")
        raise HTTPException(status_code=500, detail="Internal error starting render")


# ============== REGENERATE VOICE-OVER (audio-only replacement) ==============

@router.post("/clips/{clip_id}/regenerate-voiceover")
@limiter.limit("5/minute")
async def regenerate_voiceover(
    request: Request,
    background_tasks: BackgroundTasks,
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Regenerează voice-over-ul unui clip: generează TTS nou la viteza naturală
    și reconstruiește tot videoclipul de la zero (segmente noi + render complet).
    Scriptul rămâne același.
    """
    repo = get_repository()

    try:
        # T-80-01-01: profile_id check after repo.get_clip
        clip_row = repo.get_clip(clip_id)
        if not clip_row or clip_row.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Clip not found")

        if clip_row.get("final_status") == "processing":
            raise HTTPException(status_code=409, detail="Clip is already being processed.")

        if not clip_row.get("final_video_path"):
            raise HTTPException(status_code=400, detail="Clip has no rendered video. Use full render first.")

        settings = get_settings()
        final_video = Path(clip_row["final_video_path"])
        if not final_video.is_absolute():
            candidate = settings.output_dir / final_video
            if candidate.exists():
                final_video = candidate
            elif hasattr(settings, "media_dir") and settings.media_dir:
                candidate = Path(settings.media_dir) / final_video
                if candidate.exists():
                    final_video = candidate
        if not final_video.exists():
            raise HTTPException(status_code=400, detail="Rendered video file not found on disk. Use full render.")
        # Pass the resolved absolute path to the background task
        clip_row = {**clip_row, "final_video_path": str(final_video)}

        content_data = repo.get_clip_content(clip_id)
        if not content_data or not content_data.get("tts_text"):
            raise HTTPException(status_code=400, detail="No TTS text found for this clip.")

        background_tasks.add_task(
            _regenerate_voiceover_task,
            clip_id=clip_id,
            profile_id=profile.profile_id,
            clip_data=clip_row,
            content_data=content_data,
        )

        return {
            "status": "processing",
            "clip_id": clip_id,
            "message": "Regenerating voice-over (full re-render from scratch)..."
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting voiceover regeneration: {e}")
        raise HTTPException(status_code=500, detail="Internal error starting voiceover regeneration")


async def _regenerate_voiceover_task(
    clip_id: str,
    profile_id: str,
    clip_data: dict,
    content_data: dict,
):
    """
    Background task: generează TTS nou la viteza naturală și reconstruiește
    tot videoclipul de la zero via assemble_and_render (selectare segmente +
    render complet cu subtitrări).  Scriptul rămâne același, totul altceva e nou.
    """
    from app.services.tts.elevenlabs import ElevenLabsTTSService

    logger.info(f"[Profile {profile_id}] Starting voiceover regeneration for clip {clip_id}")

    repo = get_repository()

    # Mark as processing
    try:
        repo.update_clip(clip_id, {
            "final_status": "processing",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.error(f"Failed to set processing status: {e}")

    settings = get_settings()
    temp_dir = Path(settings.output_dir) / "temp" / f"vo_regen_{clip_id}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        final_video_path = Path(clip_data["final_video_path"])
        media_manager = get_media_manager()

        # 1. Generate TTS with original voice settings (assembly pipeline adapts video to audio)
        tts_voice_id = content_data.get("tts_voice_id") or content_data.get("voice_id")
        tts_model = content_data.get("tts_model", "eleven_flash_v2_5")

        # Default voice settings — used when clip has no saved voice_settings
        DEFAULT_VOICE_SETTINGS = {
            "speed": 1.18,
            "stability": 0.50,
            "similarity_boost": 0.73,
            "style": 0.22,
            "use_speaker_boost": True,
        }
        voice_settings = content_data.get("voice_settings") or DEFAULT_VOICE_SETTINGS

        tts_service = ElevenLabsTTSService(
            output_dir=temp_dir,
            model_id=tts_model,
            voice_id=tts_voice_id,
            profile_id=profile_id
        )

        _tts_kwargs = {}
        for _key in ("stability", "similarity_boost", "style", "use_speaker_boost"):
            if _key in voice_settings:
                _tts_kwargs[_key] = voice_settings[_key]

        original_speed = float(voice_settings.get("speed", 1.18))

        natural_audio_path = temp_dir / f"tts_natural_{clip_id}.mp3"
        tts_result, tts_timestamps = await tts_service.generate_audio_with_timestamps(
            text=content_data["tts_text"],
            voice_id=tts_voice_id or tts_service._voice_id,
            output_path=natural_audio_path,
            model_id=tts_model,
            speed=original_speed,
            **_tts_kwargs
        )
        audio_path = tts_result.audio_path
        natural_duration = await asyncio.to_thread(_get_audio_duration, audio_path)

        if natural_duration <= 0:
            raise RuntimeError("TTS generated empty audio")

        logger.info(f"Voiceover regen clip {clip_id}: TTS generated at speed={original_speed:.2f}, duration={natural_duration:.1f}s")

        # 2. Generate SRT from TTS timestamps
        new_srt_content = None
        if tts_timestamps:
            _max_wpf = content_data.get("max_words_per_phrase", content_data.get("words_per_subtitle", 2)) or 7
            new_srt_content = generate_srt_from_timestamps(tts_timestamps, max_words_per_phrase=_max_wpf)
            if new_srt_content:
                new_srt_content = sanitize_srt_full(new_srt_content)
                logger.info(f"Voiceover regen clip {clip_id}: generated new SRT from TTS timestamps")

        # 3. Remove long artificial pauses (assembly pipeline handles normalization)
        try:
            from app.services.audio.silence_remover import SilenceRemover

            trimmed_audio_path = temp_dir / f"tts_trimmed_{clip_id}.mp3"
            remover = SilenceRemover(
                min_silence_duration=0.25,
                padding=0.06,
                target_pause_duration=0.1,
            )
            silence_result = await asyncio.to_thread(remover.remove_silence, audio_path, trimmed_audio_path)
            if trimmed_audio_path.exists() and trimmed_audio_path.stat().st_size > 0:
                logger.info(
                    f"Voiceover regen clip {clip_id}: silence removal "
                    f"{silence_result.original_duration:.1f}s -> {silence_result.new_duration:.1f}s"
                )
                audio_path = trimmed_audio_path
        except Exception as silence_err:
            logger.warning(f"Voiceover regen clip {clip_id}: silence removal skipped: {silence_err}")

        processed_audio_duration = await asyncio.to_thread(_get_audio_duration, audio_path)
        if processed_audio_duration <= 0:
            processed_audio_duration = natural_duration

        # 4. Persist TTS asset and metadata to DB before re-render
        try:
            tts_persist_path = media_manager.tts_path(clip_data["project_id"], clip_id)
            shutil.copy2(str(audio_path), str(tts_persist_path))
            upsert_data = {
                "clip_id": clip_id,
                "tts_audio_path": str(tts_persist_path),
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
            if new_srt_content:
                upsert_data["srt_content"] = new_srt_content
            if tts_timestamps:
                upsert_data["tts_timestamps"] = json.dumps(tts_timestamps)
            upsert_data["voice_settings"] = voice_settings
            # update_clip_content is UPDATE-only on both backends; use table_query
            # upsert (established pattern from Plan 80-01) so the row is created
            # when missing.
            repo.table_query(
                "editai_clip_content",
                "upsert",
                data=upsert_data,
                filters=QueryFilters(on_conflict="clip_id"),
            )
        except Exception as persist_err:
            logger.warning(f"Failed to persist regenerated TTS for clip {clip_id}: {persist_err}")

        # 5. Full re-render via assembly service
        from app.services.assembly_service import get_assembly_service

        assembly_service = get_assembly_service()

        # Determine preset from final_video_path filename
        preset_name = "TikTok"  # default
        _fp_stem = final_video_path.stem.lower()
        if "instagram_reels" in _fp_stem or "reels" in _fp_stem:
            preset_name = "Instagram Reels"
        elif "youtube_shorts" in _fp_stem:
            preset_name = "YouTube Shorts"
        elif "tiktok" in _fp_stem:
            preset_name = "TikTok"

        preset_data = {
            "name": preset_name,
            "width": 1080,
            "height": 1920,
            "fps": 30,
            "video_codec": "h264_nvenc" if is_nvenc_available() else "libx264",
        }

        # Resolve subtitle settings (3-tier fallback: clip content → profile → assembly defaults)
        sub_settings = content_data.get("subtitle_settings")
        if not sub_settings:
            try:
                _profile_row = repo.get_profile(profile_id)
                if _profile_row and _profile_row.get("subtitle_settings"):
                    sub_settings = _profile_row["subtitle_settings"]
            except Exception:
                pass
        # Don't set defaults here — assemble_and_render will handle default subtitle_settings

        # Get voice settings
        voice_id = content_data.get("tts_voice_id") or content_data.get("voice_id")
        voice_settings_dict = content_data.get("voice_settings")

        # Get words per phrase setting
        max_wpf = content_data.get("max_words_per_phrase", content_data.get("words_per_subtitle", 2)) or 7

        # Load stored segment composition to preserve original segments
        stored_composition = content_data.get("segment_composition")
        source_video_ids_filter = None

        if stored_composition and isinstance(stored_composition, list) and len(stored_composition) > 0:
            logger.info(
                f"Voiceover regen clip {clip_id}: reusing {len(stored_composition)} "
                f"stored segment selections from original render"
            )
            # Extract source_video_ids from composition for segment filtering
            source_video_ids_filter = list({
                seg.get("source_video_id")
                for seg in stored_composition
                if seg.get("source_video_id")
            })
        else:
            stored_composition = None
            # Fallback for legacy clips: trace clip → project → pipeline → previews/source_video_ids
            logger.info(
                f"Voiceover regen clip {clip_id}: no stored segment_composition, "
                f"attempting to recover from pipeline data..."
            )
            try:
                project_id = clip_data.get("project_id")
                if project_id:
                    proj_row = repo.get_project(project_id)
                    pipeline_id = proj_row.get("pipeline_id") if proj_row else None

                    if pipeline_id:
                        pipe_data = repo.get_pipeline(pipeline_id)
                        if pipe_data:
                            # Try to recover match data from pipeline previews
                            variant_idx = clip_data.get("variant_index", 0)
                            previews = pipe_data.get("previews") or {}
                            preview_entry = previews.get(str(variant_idx)) or previews.get(variant_idx)
                            if preview_entry and isinstance(preview_entry, dict):
                                preview_data = preview_entry.get("preview_data") or {}
                                matches = preview_data.get("matches")
                                if matches and isinstance(matches, list) and len(matches) > 0:
                                    stored_composition = matches
                                    source_video_ids_filter = list({
                                        m.get("source_video_id")
                                        for m in matches
                                        if m.get("source_video_id")
                                    })
                                    logger.info(
                                        f"Voiceover regen clip {clip_id}: recovered {len(matches)} "
                                        f"match entries from pipeline {pipeline_id} preview data"
                                    )

                            # Fallback: at least filter by pipeline's source_video_ids
                            if not stored_composition:
                                pipe_sv_ids = pipe_data.get("source_video_ids")
                                if pipe_sv_ids and isinstance(pipe_sv_ids, list):
                                    source_video_ids_filter = pipe_sv_ids
                                    logger.info(
                                        f"Voiceover regen clip {clip_id}: using {len(pipe_sv_ids)} "
                                        f"source_video_ids from pipeline {pipeline_id} as filter"
                                    )
            except Exception as fallback_err:
                logger.warning(
                    f"Voiceover regen clip {clip_id}: fallback recovery failed: {fallback_err}"
                )

            if not stored_composition and not source_video_ids_filter:
                logger.warning(
                    f"Voiceover regen clip {clip_id}: no composition or pipeline data found, "
                    f"will use fresh keyword matching across entire library"
                )

        # Call full assembly pipeline with reused audio (audio_path is silence-removed,
        # the assembly render pipeline handles its own normalization)
        new_final_path, new_raw_path, new_seg_composition = await asyncio.wait_for(
            assembly_service.assemble_and_render(
                script_text=content_data["tts_text"],
                profile_id=profile_id,
                preset_data=preset_data,
                subtitle_settings=sub_settings,
                elevenlabs_model=content_data.get("tts_model", "eleven_flash_v2_5"),
                voice_id=voice_id,
                source_video_ids=source_video_ids_filter,
                match_overrides=stored_composition,
                reuse_audio_path=str(audio_path),
                reuse_audio_duration=processed_audio_duration,
                reuse_srt_content=new_srt_content,
                max_words_per_phrase=max_wpf,
                voice_settings=voice_settings_dict,
            ),
            timeout=600  # 10 minutes for full re-render
        )

        # 6. Replace the original final video with the new render
        shutil.move(str(new_final_path), str(final_video_path))
        logger.info(f"Voiceover re-rendered for clip {clip_id}: {final_video_path}")

        # Update raw_video_path to the new truly raw assembly (subtitle-free)
        if new_raw_path and Path(new_raw_path).exists():
            raw_dest = final_video_path.parent / f"{final_video_path.stem}_raw.mp4"
            shutil.move(str(new_raw_path), str(raw_dest))
            repo.update_clip(clip_id, {
                "raw_video_path": str(raw_dest),
            })

        # 7. Persist updated segment composition for future regenerations
        if new_seg_composition:
            try:
                repo.update_clip_content(clip_id, {
                    "segment_composition": new_seg_composition,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
                logger.info(f"Updated segment_composition for clip {clip_id} ({len(new_seg_composition)} segments)")
            except Exception as comp_err:
                logger.warning(f"Failed to update segment_composition for clip {clip_id}: {comp_err}")

        # 8. Mark completed
        repo.update_clip(clip_id, {
            "final_status": "completed",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

        logger.info(f"Voiceover regeneration completed for clip {clip_id}")

    except Exception as e:
        logger.error(f"Voiceover regeneration failed for clip {clip_id}: {e}")
        try:
            repo.update_clip(clip_id, {
                "final_status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            logger.critical(f"Clip {clip_id} stuck in processing — DB update for failed status also failed.")
    finally:
        # Cleanup temp files
        try:
            shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception:
            pass


async def _render_final_clip_task(
    clip_id: str,
    project_id: str,
    profile_id: str,
    clip_data: dict,
    content_data: Optional[dict],
    preset_data: dict,
    # Video enhancement filters (Phase 9)
    enable_denoise: bool = False,
    denoise_strength: float = 2.0,
    enable_sharpen: bool = False,
    sharpen_amount: float = 0.5,
    enable_color: bool = False,
    brightness: float = 0.0,
    contrast: float = 1.0,
    saturation: float = 1.0,
    # Subtitle enhancement (Phase 11)
    shadow_depth: int = 0,
    enable_glow: bool = False,
    glow_blur: int = 0,
    adaptive_sizing: bool = False,
    # TTS model selection (Phase 12)
    elevenlabs_model: str = "eleven_flash_v2_5"
):
    """
    Task pentru randarea finală în background.

    SYNC LOGIC (Script-First Workflow):
    1. Generează TTS cu silence removal → audio dinamic
    2. Compară durata video cu audio:
       - Video < Audio: extinde video cu mai multe segmente
       - Video > Audio: trimează video la durata audio
    3. Render final cu video sincronizat
    """
    from app.services.elevenlabs_tts import get_elevenlabs_tts

    logger.info(f"[Profile {profile_id}] Starting final render for clip {clip_id} in project {project_id}")

    repo = get_repository()

    settings = get_settings()

    # C5: Hold project lock only for the brief DB status update, not the entire render.
    # This prevents starving the threadpool when multiple clips render concurrently.
    lock = get_project_lock(project_id) if project_id else None
    if lock:
        acquired = lock.acquire(blocking=False)
        if acquired:
            try:
                repo.update_clip(clip_id, {
                    "final_status": "processing",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.error(f"Failed to update clip status to processing: {e}")
            finally:
                lock.release()
        else:
            # Lock held — update status without lock (best-effort)
            logger.debug(f"Project lock held for {project_id}, updating status without lock")
            try:
                repo.update_clip(clip_id, {
                    "final_status": "processing",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                logger.error(f"Failed to update clip status to processing: {e}")
    else:
        # No project_id — just update status
        try:
            repo.update_clip(clip_id, {
                "final_status": "processing",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as e:
            logger.error(f"Failed to update clip status to processing: {e}")

    # Initialize temp file paths for cleanup in finally block
    audio_path = None
    original_audio_path = None  # Pre-trim TTS file, cleaned up separately
    srt_path = None
    adjusted_video_path = None
    tts_timestamps = None
    output_path = None  # Track partial output for cleanup on failure
    render_succeeded = False

    # Profile-scoped temp directory to prevent cross-profile file collisions
    temp_dir = settings.base_dir / "temp" / profile_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw_video_str = clip_data.get("raw_video_path")
        if not raw_video_str:
            raise FileNotFoundError(f"Clip {clip_id} has no raw_video_path in database")
        raw_video_path = Path(raw_video_str)
        if not raw_video_path.exists():
            raise FileNotFoundError(f"Raw video not found: {raw_video_path}")

        # Output directory — use project-scoped media dir for new renders
        media_manager = get_media_manager()
        output_dir = settings.output_dir / "finals"
        output_dir.mkdir(parents=True, exist_ok=True)

        video_duration = await asyncio.to_thread(_get_video_duration, raw_video_path)
        audio_duration = None
        final_video_path = raw_video_path  # Default: use raw video

        # 1. Generate TTS if we have text (with silence removal for dynamism)
        if content_data and content_data.get("tts_text"):
            # Use new TTS service with timestamps support
            from app.services.tts.elevenlabs import ElevenLabsTTSService

            audio_path = temp_dir / f"tts_{clip_id}.mp3"
            tts_timestamps = None
            silence_stats = None

            try:
                # Initialize TTS service with user-selected model (profile_id enables multi-account failover)
                tts_voice_id = content_data.get("tts_voice_id") or content_data.get("voice_id")
                voice_settings = content_data.get("voice_settings", {})
                tts_service = ElevenLabsTTSService(
                    output_dir=temp_dir,
                    model_id=elevenlabs_model,
                    voice_id=tts_voice_id,
                    profile_id=profile_id
                )

                # Build voice_settings kwargs for TTS call
                _tts_kwargs = {}
                if voice_settings:
                    for _vs_key in ("stability", "similarity_boost", "style", "speed", "use_speaker_boost"):
                        if _vs_key in voice_settings:
                            _tts_kwargs[_vs_key] = voice_settings[_vs_key]

                # Generate with timestamps for downstream subtitle sync
                tts_result, tts_timestamps = await tts_service.generate_audio_with_timestamps(
                    text=content_data["tts_text"],
                    voice_id=tts_voice_id or tts_service._voice_id,
                    output_path=audio_path,
                    model_id=elevenlabs_model,
                    **_tts_kwargs
                )
                audio_path = tts_result.audio_path
                logger.info(f"TTS with timestamps generated for clip {clip_id}: {tts_result.duration_seconds:.1f}s, model={elevenlabs_model}")

                # Apply silence removal to timestamped audio
                original_audio_path = audio_path
                # BUG-6.9: Save copy of timestamps before remap so we can restore on failure
                original_tts_timestamps = list(tts_timestamps) if tts_timestamps else None
                try:
                    from app.services.audio.silence_remover import SilenceRemover
                    remover = SilenceRemover(min_silence_duration=0.25, padding=0.06, target_pause_duration=0.1)
                    trimmed_path = temp_dir / f"tts_trimmed_{clip_id}.mp3"
                    silence_result = await asyncio.to_thread(remover.remove_silence, audio_path, trimmed_path)
                    audio_path = trimmed_path
                    silence_stats = {
                        'original_duration': silence_result.original_duration,
                        'removed_duration': silence_result.removed_duration
                    }
                    logger.info(f"Silence removal: {silence_result.original_duration:.1f}s -> {silence_result.new_duration:.1f}s")

                    # Remap TTS timestamps to match the trimmed audio
                    if silence_result.segments_map and tts_timestamps:
                        try:
                            from app.services.tts_subtitle_generator import remap_timestamps_dict
                            tts_timestamps = remap_timestamps_dict(tts_timestamps, silence_result.segments_map)
                            logger.info(f"Remapped TTS timestamps after silence removal ({len(silence_result.segments_map)} regions)")
                        except Exception as remap_err:
                            # BUG-6.9: Remap failed — revert BOTH audio and timestamps
                            logger.warning(f"Timestamp remapping failed, reverting to original audio and timestamps: {remap_err}")
                            audio_path = original_audio_path
                            tts_timestamps = original_tts_timestamps
                            silence_stats = None
                except Exception as e:
                    logger.warning(f"Silence removal failed, using raw audio: {e}")
                    audio_path = original_audio_path
                    tts_timestamps = original_tts_timestamps

            except Exception as e:
                # Fallback to legacy TTS without timestamps
                logger.warning(f"Timestamps generation failed, falling back to standard TTS: {e}")
                from app.services.elevenlabs_tts import get_elevenlabs_tts
                tts = get_elevenlabs_tts()
                legacy_tts_ok = False
                if tts is not None:
                    try:
                        audio_path, silence_stats = await tts.generate_audio_trimmed(
                            text=content_data["tts_text"],
                            output_path=audio_path,
                            remove_silence=True,
                            min_silence_duration=0.25,
                            silence_padding=0.06
                        )
                        legacy_tts_ok = True
                    except Exception as legacy_err:
                        logger.warning(f"Legacy ElevenLabs TTS also failed: {legacy_err}")
                if not legacy_tts_ok:
                    # Fallback to Edge TTS — try to match user's configured voice language
                    logger.info("Using Edge TTS fallback")
                    from app.services.edge_tts_service import EdgeTTSService, POPULAR_VOICES
                    edge_tts_fallback = EdgeTTSService()
                    # Derive Edge TTS voice from user's ElevenLabs voice ID or content language
                    _edge_voice = "ro-RO-EmilNeural"  # default
                    _tts_voice = content_data.get("tts_voice_id") or content_data.get("voice_id") or ""
                    _tts_lang = content_data.get("tts_language", "").lower()
                    if _tts_lang.startswith("en") or "english" in _tts_voice.lower():
                        _edge_voice = POPULAR_VOICES.get("en_us_male", "en-US-GuyNeural")
                    elif _tts_lang.startswith("ro") or "romanian" in _tts_voice.lower():
                        _edge_voice = POPULAR_VOICES.get("ro_male", "ro-RO-EmilNeural")
                    await edge_tts_fallback.generate_audio(
                        text=content_data["tts_text"],
                        output_path=str(audio_path),
                        voice=_edge_voice
                    )
                    silence_stats = None

            audio_duration = await asyncio.to_thread(_get_audio_duration, audio_path)

            # DB-17: Use upsert with on_conflict to prevent duplicate key errors.
            # update_clip_content is UPDATE-only on both backends; use table_query upsert.
            if tts_timestamps:
                try:
                    repo.table_query(
                        "editai_clip_content",
                        "upsert",
                        data={
                            "clip_id": clip_id,
                            "tts_timestamps": tts_timestamps,
                            "tts_model": elevenlabs_model,
                            "updated_at": datetime.now(timezone.utc).isoformat(),
                        },
                        filters=QueryFilters(on_conflict="clip_id"),
                    )
                    logger.info(f"TTS timestamps persisted for clip {clip_id}")
                except Exception as e:
                    logger.warning(f"Failed to persist TTS timestamps: {e}")

            if silence_stats:
                logger.info(f"TTS generated for clip {clip_id}: {silence_stats.get('original_duration', 0):.1f}s → {audio_duration:.1f}s (removed {silence_stats.get('removed_duration', 0):.1f}s silence)")
            else:
                logger.info(f"TTS generated for clip {clip_id}: {audio_duration:.1f}s")

            # Auto-save to TTS Library (non-blocking)
            try:
                from app.services.tts_library_service import get_tts_library_service
                from app.services.tts_subtitle_generator import generate_srt_from_timestamps as _gen_srt
                _max_wpf = content_data.get("max_words_per_phrase", content_data.get("words_per_subtitle", 2)) if content_data else 7
                _srt_for_lib = _gen_srt(tts_timestamps, max_words_per_phrase=_max_wpf) if tts_timestamps else None
                tts_lib = get_tts_library_service()
                tts_lib.save_from_pipeline(
                    profile_id=profile_id,
                    text=content_data["tts_text"],
                    audio_path=str(audio_path),
                    srt_content=_srt_for_lib,
                    timestamps=tts_timestamps,
                    model=elevenlabs_model,
                    duration=audio_duration or 0.0,
                )
            except Exception as e:
                logger.warning(f"Failed to save TTS to library: {e}")

            # Persist TTS audio to permanent location for later download
            tts_persist_failed = False
            try:
                tts_persist_path = media_manager.tts_path(project_id, clip_id)
                shutil.copy2(str(audio_path), str(tts_persist_path))
                # DB-17: Use upsert with on_conflict to prevent duplicate key errors.
                # update_clip_content is UPDATE-only on both backends; use table_query upsert.
                repo.table_query(
                    "editai_clip_content",
                    "upsert",
                    data={
                        "clip_id": clip_id,
                        "tts_audio_path": str(tts_persist_path),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    filters=QueryFilters(on_conflict="clip_id"),
                )
                logger.info(f"TTS audio persisted for clip {clip_id}: {tts_persist_path}")
            except Exception as e:
                tts_persist_failed = True
                logger.warning(f"TTS PERSIST FAILED for clip {clip_id}: audio was generated but could not be saved for download: {e}")

        # 2. SYNC: Adjust video to audio duration
        if audio_duration and audio_duration > 0:
            duration_diff = video_duration - audio_duration

            if abs(duration_diff) < 0.2:
                # Negligible difference (<200ms), use original video
                logger.info(f"Video sync OK: video={video_duration:.1f}s, audio={audio_duration:.1f}s (diff={abs(duration_diff)*1000:.0f}ms)")
                final_video_path = raw_video_path

            elif duration_diff > 0:
                # VIDEO LONGER: Trim video to audio duration
                logger.info(f"Video > Audio ({video_duration:.1f}s > {audio_duration:.1f}s): trimming video")
                adjusted_video_path = temp_dir / f"trimmed_{clip_id}.mp4"
                async with await acquire_prep_slot():
                    trim_ok = await asyncio.to_thread(_trim_video_to_duration, raw_video_path, adjusted_video_path, audio_duration)
                if trim_ok and adjusted_video_path.exists():
                    final_video_path = adjusted_video_path
                else:
                    logger.warning(f"Trim failed for clip {clip_id}, using original video")
                    final_video_path = raw_video_path

            else:
                # VIDEO SHORTER: Extend with additional segments
                needed_duration = audio_duration - video_duration
                logger.info(f"Video < Audio ({video_duration:.1f}s < {audio_duration:.1f}s): extending by {needed_duration:.1f}s")

                # Try to extend with segments from project
                adjusted_video_path = temp_dir / f"extended_{clip_id}.mp4"
                async with await acquire_prep_slot():
                    extended = await asyncio.to_thread(
                        _extend_video_with_segments,
                        base_video=raw_video_path,
                        target_duration=audio_duration,
                        project_id=project_id,
                        output_path=adjusted_video_path,
                        profile_id=profile_id,
                    )

                if extended and adjusted_video_path.exists():
                    final_video_path = adjusted_video_path
                else:
                    # Fallback: loop video to fill the gap
                    logger.warning(f"Could not extend with segments, using loop fallback")
                    async with await acquire_prep_slot():
                        await asyncio.to_thread(_loop_video_to_duration, raw_video_path, adjusted_video_path, audio_duration)
                    if adjusted_video_path.exists():
                        final_video_path = adjusted_video_path

        # 3. Generate SRT - user-provided takes priority, then auto-generate from TTS timestamps
        if content_data and content_data.get("srt_content"):
            srt_path = temp_dir / f"srt_{clip_id}.srt"
            # Validate and fix SRT before writing
            validator = SRTValidator()
            is_valid, fixed_srt, issues = validator.validate_and_fix(content_data["srt_content"])
            if issues:
                logger.warning(f"SRT validation issues for clip {clip_id}: {issues[:3]}")
            srt_text = sanitize_srt_full(fixed_srt)
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write(srt_text)
            logger.info(f"Using user-provided SRT for clip {clip_id}")
        elif tts_timestamps:
            # Auto-generate SRT from TTS character-level timestamps (Phase 13)
            try:
                # Check SRT cache first
                from app.services.tts_cache import srt_cache_lookup, srt_cache_store
                _tts_voice = content_data.get("tts_voice_id", "")
                # Include voice_settings in SRT cache key to prevent stale SRT when settings change
                _voice_settings = content_data.get("voice_settings", {})
                _vs_key = ""
                if _voice_settings:
                    _spk_boost = "1" if _voice_settings.get("use_speaker_boost", True) else "0"
                    _vs_key = f"{_voice_settings.get('stability', 0.5):.2f}_{_voice_settings.get('similarity_boost', 0.75):.2f}_{_voice_settings.get('style', 0.0):.2f}_{_voice_settings.get('speed', 1.0):.2f}_{_spk_boost}"
                _srt_cache_key = {"text": content_data["tts_text"], "voice_id": _tts_voice, "model_id": elevenlabs_model, "provider": "elevenlabs_ts", "pause_version": "v2", "vs": _vs_key}
                cached_srt = srt_cache_lookup(_srt_cache_key)
                if cached_srt:
                    auto_srt = cached_srt  # Already sanitized when stored
                else:
                    _render_max_wpf = content_data.get("max_words_per_phrase", content_data.get("words_per_subtitle", 2))
                    auto_srt = generate_srt_from_timestamps(tts_timestamps, max_words_per_phrase=_render_max_wpf)
                    if auto_srt:
                        srt_cache_store(_srt_cache_key, auto_srt)

                if auto_srt:
                    srt_path = temp_dir / f"srt_{clip_id}.srt"
                    # Only sanitize if not from cache (cached content is already sanitized)
                    srt_to_write = auto_srt if cached_srt else sanitize_srt_full(auto_srt)
                    with open(srt_path, "w", encoding="utf-8") as f:
                        f.write(srt_to_write)
                    logger.info(f"Auto-generated SRT from TTS timestamps for clip {clip_id}")
                else:
                    logger.warning(f"TTS timestamps produced empty SRT for clip {clip_id}")
            except Exception as e:
                logger.warning(f"Failed to generate SRT from TTS timestamps: {e}")

        # Inject Phase 11 subtitle enhancement settings into subtitle_settings dict
        if content_data and content_data.get("subtitle_settings"):
            content_data["subtitle_settings"]["shadowDepth"] = shadow_depth
            content_data["subtitle_settings"]["enableGlow"] = enable_glow
            content_data["subtitle_settings"]["glowBlur"] = glow_blur
            content_data["subtitle_settings"]["adaptiveSizing"] = adaptive_sizing

        # Ensure subtitle_settings exist when SRT is available (default styling for auto-generated subtitles)
        if srt_path and (not content_data or not content_data.get("subtitle_settings")):
            if not content_data:
                content_data = {}
            content_data["subtitle_settings"] = {
                "fontSize": 48,
                "fontFamily": "Montserrat",
                "textColor": "#FFFFFF",
                "outlineColor": "#000000",
                "outlineWidth": 3,
                "positionY": 85,
                "shadowDepth": shadow_depth,
                "enableGlow": enable_glow,
                "glowBlur": glow_blur,
                "adaptiveSizing": adaptive_sizing
            }
            logger.info(f"Applied default subtitle styling for auto-generated SRT")

        # 4. Render with FFmpeg using the preset (limited by global concurrency semaphore)
        output_path = media_manager.render_path(project_id, clip_id, preset_data['name'])

        # Pre-render disk space check
        check_disk_space(output_path.parent)

        async with await acquire_render_slot():
            await _render_with_preset(
                video_path=final_video_path,
                audio_path=audio_path,
                srt_path=srt_path,
                subtitle_settings=content_data.get("subtitle_settings") if content_data else None,
                preset=preset_data,
                output_path=output_path,
                # Video enhancement filters (Phase 9)
                enable_denoise=enable_denoise,
                denoise_strength=denoise_strength,
                enable_sharpen=enable_sharpen,
                sharpen_amount=sharpen_amount,
                enable_color=enable_color,
                brightness=brightness,
                contrast=contrast,
                saturation=saturation
            )

        # Store final video via FileStorage abstraction (local by default, Supabase when configured)
        file_storage = get_file_storage()
        storage_key = f"output/{profile_id}/{project_id}/{clip_id}_final.mp4"
        stored_path = file_storage.store(output_path, storage_key)
        logger.debug(f"FileStorage.store for clip {clip_id}: {output_path} -> {stored_path}")

        # Mark render as succeeded BEFORE DB update to prevent file deletion on DB failure
        render_succeeded = True

        # Update the clip
        repo.update_clip(clip_id, {
            "final_video_path": stored_path,
            "final_status": "completed",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

        # Save the export — non-critical, must not revert clip status on failure
        try:
            repo.create_export({
                "clip_id": clip_id,
                "preset_name": preset_data["name"],
                "output_path": stored_path,
                "file_size": output_path.stat().st_size if output_path.exists() else 0,
                "status": "completed",
            })
        except Exception as e:
            logger.warning(f"Failed to insert export record for clip {clip_id}: {e}")

        # Update project counter
        await _update_project_counts(clip_data["project_id"], profile_id)

        logger.info(f"Rendered final clip {clip_id} -> {output_path}")

    except Exception as e:
        logger.error(f"Error rendering clip {clip_id}: {e}", exc_info=True)
        try:
            repo.update_clip(clip_id, {
                "final_status": "failed",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception as db_err:
            logger.error(f"CRITICAL: Failed to mark clip {clip_id} as failed in DB: {db_err}")
    finally:
        # Always cleanup temp files (even on error)
        try:
            if audio_path:
                Path(audio_path).unlink(missing_ok=True)
                logger.debug(f"Cleaned up temp audio: {audio_path}")
            # Clean up original (pre-trim) TTS file if it differs from audio_path
            if original_audio_path and original_audio_path != audio_path:
                Path(original_audio_path).unlink(missing_ok=True)
                logger.debug(f"Cleaned up original TTS audio: {original_audio_path}")
            if srt_path:
                Path(srt_path).unlink(missing_ok=True)
                logger.debug(f"Cleaned up temp srt: {srt_path}")
            if adjusted_video_path:
                Path(adjusted_video_path).unlink(missing_ok=True)
                logger.debug(f"Cleaned up adjusted video: {adjusted_video_path}")
        except Exception as cleanup_err:
            logger.warning(f"Failed to cleanup temp files: {cleanup_err}")
        # Clean up partial output file on failure (FFmpeg -y creates file before completion)
        if not render_succeeded and output_path and Path(output_path).exists():
            try:
                Path(output_path).unlink()
                logger.info(f"Cleaned up partial output file: {output_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup partial output: {e}")

        # C5: Lock is no longer held during render — no release needed here.
        # Cleanup stale lock entries if project has no active tasks.
        if project_id:
            cleanup_project_lock(project_id)


class BulkRenderRequest(BaseModel):
    clip_ids: List[str]
    preset_name: str = "instagram_reels"

    @field_validator("clip_ids")
    @classmethod
    def validate_clip_ids(cls, v):
        if len(v) > 50:
            raise ValueError("Maximum 50 clips per bulk render request")
        if len(v) == 0:
            raise ValueError("At least one clip_id is required")
        return v


@router.post("/clips/bulk-render")
@limiter.limit("5/minute")
async def bulk_render_clips(
    http_request: Request,
    background_tasks: BackgroundTasks,
    request: BulkRenderRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Randează mai multe clipuri selectate cu același preset."""
    background_tasks.add_task(
        _bulk_render_sequential,
        clip_ids=request.clip_ids,
        preset_name=request.preset_name,
        profile_id=profile.profile_id
    )

    return {
        "status": "processing",
        "count": len(request.clip_ids),
        "preset": request.preset_name,
        "message": f"Rendering {len(request.clip_ids)} clips..."
    }


async def _bulk_render_sequential(clip_ids: list, preset_name: str, profile_id: str):
    """Process bulk renders sequentially instead of spawning N concurrent tasks."""
    for clip_id in clip_ids:
        try:
            await _start_render_for_clip(
                clip_id=clip_id,
                preset_name=preset_name,
                profile_id=profile_id
            )
        except Exception as e:
            logger.error(f"Bulk render failed for clip {clip_id}: {e}")
            # Continue with next clip instead of aborting entire batch


async def _start_render_for_clip(clip_id: str, preset_name: str, profile_id: str = None):
    """Helper pentru bulk render."""
    repo = get_repository()

    try:
        # T-80-01-01 IDOR mitigation: profile_id check after repo.get_clip
        clip_row = repo.get_clip(clip_id)
        if not clip_row:
            return
        if profile_id and clip_row.get("profile_id") != profile_id:
            return

        # Check project lock before starting render (same guard as single-clip endpoint)
        _proj_id = clip_row.get("project_id")
        if _proj_id and is_project_locked(_proj_id):
            logger.warning(f"Skipping bulk render for clip {clip_id}: project {_proj_id} is locked")
            return

        clip_content = repo.get_clip_content(clip_id)
        preset_row = repo.get_export_preset_by_name(preset_name)

        if preset_row:
            # Extract filter/subtitle settings from stored clip content
            sub_settings = clip_content.get("subtitle_settings", {}) if clip_content and isinstance(clip_content.get("subtitle_settings"), dict) else {}

            await _render_final_clip_task(
                clip_id=clip_id,
                project_id=clip_row["project_id"],
                profile_id=clip_row["profile_id"],
                clip_data=clip_row,
                content_data=clip_content,
                preset_data=preset_row,
                # Apply stored filter/subtitle settings from clip content
                enable_denoise=sub_settings.get("enableDenoise", False),
                enable_sharpen=sub_settings.get("enableSharpen", False),
                enable_color=sub_settings.get("enableColor", False),
                shadow_depth=sub_settings.get("shadowDepth", 0),
                enable_glow=sub_settings.get("enableGlow", False),
                glow_blur=sub_settings.get("glowBlur", 0),
                adaptive_sizing=sub_settings.get("adaptiveSizing", False),
            )
    except Exception as e:
        logger.error(f"Error in bulk render for {clip_id}: {e}")


# ============== HELPER FUNCTIONS ==============

def _get_video_info(video_path: Path) -> dict:
    """Obține informații despre video."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration,r_frame_rate",
            "-show_entries", "format=duration",
            "-of", "json",
            str(video_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=30, operation="ffprobe video info")
        if result.returncode == 0:
            data = json.loads(result.stdout)
            stream = data.get("streams", [{}])[0]
            format_info = data.get("format", {})
            return {
                "width": stream.get("width", 1080),
                "height": stream.get("height", 1920),
                "duration": float(format_info.get("duration", stream.get("duration", 0)))
            }
    except Exception as e:
        logger.warning(f"Failed to get video info for {video_path}: {e}")
    logger.warning(f"Returning hardcoded video info defaults (1080x1920, 0s duration) for {video_path} — downstream processing may produce incorrect results")
    return {"width": 1080, "height": 1920, "duration": 0}


def _increment_segment_usage(segment_ids: list):
    """Increment usage_count for segments after a successful generation.

    Delegates to repo.increment_segment_usage which handles both backends:
    - SupabaseRepository: tries RPC `increment_segment_usage_batch` first,
      falls back to per-id read-modify-write.
    - SQLiteRepository: single UPDATE with IN clause (atomic).
    """
    if not segment_ids:
        return
    try:
        get_repository().increment_segment_usage(segment_ids)
    except Exception as e:
        logging.getLogger(__name__).warning(
            f"Failed to increment usage_count for segments: {e}"
        )


def _get_video_duration(video_path: Path) -> float:
    """Get video duration via ffprobe. Returns 0.0 on failure (logged)."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=30, operation="ffprobe duration")
        if result.returncode == 0:
            duration = float(result.stdout.strip())
            if duration > 0:
                return duration
            logger.warning(f"ffprobe returned 0 duration for {video_path}")
        else:
            logger.warning(f"ffprobe failed for {video_path}: {result.stderr[:200] if result.stderr else 'no stderr'}")
    except Exception as e:
        logger.warning(f"Failed to get video duration for {video_path}: {e}")
    return 0.0


def _generate_thumbnail(video_path: Path, project_id: Optional[str] = None) -> Optional[Path]:
    """Generează thumbnail pentru un video."""
    try:
        settings = get_settings()
        if project_id:
            media_manager = get_media_manager()
            thumb_path = media_manager.thumbnail_path(project_id, video_path.stem)
        else:
            # Backward compat: use legacy output_dir path
            thumb_dir = settings.output_dir / "thumbnails"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumb_dir / f"{video_path.stem}_thumb.jpg"

        # Get video duration to pick a safe seek time (avoid -ss 1 for clips under 1s)
        duration = _get_video_duration(video_path)
        seek_time = str(min(1, duration / 2)) if duration > 0 else "0.1"

        cmd = [
            "ffmpeg", "-y",
            "-ss", seek_time,
            "-i", str(video_path),
            "-vframes", "1",
            "-vf", "scale=320:-1",  # Width 320px, height auto
            "-q:v", "3",
            str(thumb_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=30, operation="thumbnail")
        if result.returncode == 0 and thumb_path.exists():
            return thumb_path
    except Exception as e:
        logger.warning(f"Failed to generate thumbnail: {e}")
    return None


def _delete_clip_files(clip: dict):
    """Șterge fișierele asociate unui clip."""
    for key in ["raw_video_path", "thumbnail_path", "final_video_path"]:
        if clip.get(key):
            try:
                Path(clip[key]).unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to delete {clip[key]}: {e}")


def _update_project_counts_sync(project_id: str, profile_id: Optional[str] = None):
    """Actualizează contoarele de clipuri în proiect (sync — run via asyncio.to_thread)."""
    repo = get_repository()

    try:
        # List all non-deleted clips for this project
        eq_filters = {"is_deleted": False}
        if profile_id:
            eq_filters["profile_id"] = profile_id
        result = repo.list_clips(project_id, QueryFilters(eq=eq_filters))
        clips = result.data or []

        total = len(clips)
        selected = sum(1 for c in clips if c.get("is_selected"))
        exported = sum(1 for c in clips if c.get("final_status") == "completed")

        repo.update_project(project_id, {
            "variants_count": total,
            "selected_count": selected,
            "exported_count": exported,
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        logger.warning(f"Failed to update project counts: {e}")


async def _update_project_counts(project_id: str, profile_id: Optional[str] = None):
    """Async wrapper — offloads sync Supabase calls to threadpool to avoid blocking event loop."""
    await asyncio.to_thread(_update_project_counts_sync, project_id, profile_id)


# ============== VIDEO SYNC HELPERS (Script-First Workflow) ==============

def _get_audio_duration(audio_path: Path) -> float:
    """Obține durata fișierului audio în secunde."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=30, operation="ffprobe audio duration")
        if result.returncode == 0:
            return float(result.stdout.strip())
    except Exception as e:
        logger.warning(f"Failed to get audio duration: {e}")
    return 0.0


def _trim_video_to_duration(input_path: Path, output_path: Path, target_duration: float) -> bool:
    """
    Trimează video-ul la durata specificată.
    Folosește -t pentru a tăia precis la durată.
    """
    try:
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-i", str(input_path),
            "-t", str(target_duration),
            *get_prep_codec_params(),
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=300, operation="trim video")
        if result.returncode == 0 and output_path.exists():
            logger.info(f"Trimmed video to {target_duration:.1f}s: {output_path.name}")
            return True
        else:
            logger.error(f"Failed to trim video: {result.stderr[:200]}")
            return False
    except Exception as e:
        logger.error(f"Error trimming video: {e}")
        return False


def _loop_video_to_duration(input_path: Path, output_path: Path, target_duration: float) -> bool:
    """
    Loopează video-ul pentru a atinge durata specificată.
    Fallback când nu avem segmente disponibile.
    """
    try:
        # Use stream_loop for looping and -t to cut to duration
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-stream_loop", "-1",  # Loop infinit
            "-i", str(input_path),
            "-t", str(target_duration),
            *get_prep_codec_params(),
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=300, operation="loop video")
        if result.returncode == 0 and output_path.exists():
            logger.info(f"Looped video to {target_duration:.1f}s: {output_path.name}")
            return True
        else:
            logger.error(f"Failed to loop video: {result.stderr[:200]}")
            return False
    except Exception as e:
        logger.error(f"Error looping video: {e}")
        return False


def _extend_video_with_segments(
    base_video: Path,
    target_duration: float,
    project_id: str,
    output_path: Path,
    profile_id: Optional[str] = None,
) -> bool:
    """
    Extinde video-ul cu segmente adiționale din proiect pentru a atinge durata țintă.

    NOTE: This sync function runs multiple safe_ffmpeg_run calls internally.
    The caller MUST wrap it in acquire_prep_slot() to gate all FFmpeg processes
    as a single logical operation.

    Algoritm:
    1. Obține segmentele disponibile din proiect
    2. Calculează cât mai avem nevoie
    3. Extrage și concatenează segmente până atingem target_duration
    """
    profile_id = profile_id or "default"
    repo = get_repository()
    try:
        current_duration = _get_video_duration(base_video)
        needed_duration = target_duration - current_duration

        if needed_duration <= 0:
            return False

        # Get project segments — compose repo methods instead of nested join
        ps_result = repo.list_project_segments(
            project_id,
            QueryFilters(order_by="sequence_order"),
        )

        if not ps_result.data:
            logger.warning(f"No segments found for project {project_id}")
            return False

        # Prepare segment list — fetch segment + source_video per project-segment
        available_segments = []
        for ps in ps_result.data:
            seg_id = ps.get("segment_id") or ps.get("editai_segment_id")
            if not seg_id:
                embedded = ps.get("editai_segments") or {}
                seg_id = embedded.get("id") if isinstance(embedded, dict) else None
            if not seg_id:
                continue
            seg = repo.get_segment(seg_id)
            if not seg:
                continue

            source_video_id = seg.get("source_video_id")
            source_video = repo.get_source_video(source_video_id) if source_video_id else None
            source_path = source_video.get("file_path") if source_video else None

            if source_path and Path(source_path).exists():
                available_segments.append({
                    "id": seg.get("id"),
                    "single_use": seg.get("single_use", False),
                    "source_path": source_path,
                    "start_time": seg["start_time"],
                    "end_time": seg["end_time"],
                    "duration": seg["end_time"] - seg["start_time"]
                })

        # Exclude single_use segments from extension pool (conservative:
        # we can't know which segments are in the base video)
        non_single_use = [s for s in available_segments if not s.get("single_use")]
        if non_single_use:
            available_segments = non_single_use

        if not available_segments:
            logger.warning("No valid segments available for extension")
            return False

        # Select segments to fill the gap
        import random
        random.shuffle(available_segments)

        selected_segments = []
        accumulated = 0
        for seg in available_segments:
            if accumulated >= needed_duration:
                break
            selected_segments.append(seg)
            accumulated += seg["duration"]

        if not selected_segments:
            return False

        settings = get_settings()
        # Profile-scoped temp directory to prevent cross-profile file collisions
        # BUG-5.4: Include unique suffix in temp dir name to avoid cross-clip collisions
        temp_dir = settings.base_dir / "temp" / profile_id / f"extend_{project_id[:8]}_{uuid.uuid4().hex[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Extract additional segments
            # Re-encode base video without audio to match extension segments (all -an)
            base_no_audio = temp_dir / "base_no_audio.mp4"
            base_cmd = [
                "ffmpeg", "-y", "-threads", "4",
                "-i", str(base_video),
                *get_prep_codec_params(include_audio=False),
                "-an",
                "-pix_fmt", "yuv420p",
                str(base_no_audio)
            ]
            base_result = safe_ffmpeg_run(base_cmd, timeout=300, operation="strip audio from base")
            if base_result.returncode != 0 or not base_no_audio.exists():
                logger.error(f"Failed to strip audio from base video: {base_result.stderr[:200]}")
                return False

            segment_files = [base_no_audio]  # Start with audio-stripped base video

            for idx, seg in enumerate(selected_segments):
                seg_output = temp_dir / f"ext_seg_{idx:03d}.mp4"

                cmd = [
                    "ffmpeg", "-y", "-threads", "4",
                    "-ss", str(seg["start_time"]),
                    "-i", seg["source_path"],
                    "-t", str(seg["duration"]),
                    *get_prep_codec_params(include_audio=False),
                    "-an",  # No audio - will be replaced with TTS
                    "-pix_fmt", "yuv420p",
                    str(seg_output)
                ]

                result = safe_ffmpeg_run(cmd, timeout=300, operation="extend segment extract")
                if result.returncode == 0 and seg_output.exists():
                    segment_files.append(seg_output)

            if len(segment_files) <= 1:
                logger.warning("No additional segments extracted")
                return False

            # Create concat list
            concat_list = temp_dir / "concat.txt"
            with open(concat_list, "w") as f:
                for sf in segment_files:
                    # BUG-6.3: Convert backslashes to forward slashes for FFmpeg concat
                    safe_path = str(sf).replace('\\', '/').replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")

            # Concatenate and trim to exact duration
            cmd = [
                "ffmpeg", "-y", "-threads", "4",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list),
                "-t", str(target_duration),  # Trim to exact duration
                *get_prep_codec_params(include_audio=False),
                "-an",  # No audio
                "-movflags", "+faststart",
                str(output_path)
            ]

            result = safe_ffmpeg_run(cmd, timeout=300, operation="extend concat")

            if result.returncode == 0 and output_path.exists():
                logger.info(f"Extended video to {target_duration:.1f}s with {len(selected_segments)} additional segments")
                return True
            else:
                logger.error(f"Failed to concat extended video: {result.stderr[:200]}")
                return False

        finally:
            # Cleanup temp files
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        logger.error(f"Error extending video with segments: {e}")
        return False


def cleanup_orphaned_temp_files(max_age_hours: int = 24, profile_id: Optional[str] = None):
    """
    Cleanup orphaned temp files older than max_age_hours.
    Called periodically or on startup to prevent temp dir from growing.

    Args:
        max_age_hours: Maximum age in hours for temp files before deletion
        profile_id: If provided, only clean this profile's temp directory. If None, clean all profiles.
    """
    try:
        settings = get_settings()
        temp_base_dir = settings.base_dir / "temp"
        if not temp_base_dir.exists():
            return 0

        from datetime import timedelta
        import time

        cutoff_time = time.time() - (max_age_hours * 3600)
        deleted_count = 0

        # Determine which directories to clean
        if profile_id:
            # Clean only specific profile's temp directory
            temp_dirs = [temp_base_dir / profile_id]
        else:
            # Clean all profile temp directories
            temp_dirs = [d for d in temp_base_dir.iterdir() if d.is_dir()]
            # Also include flat files in temp root (legacy)
            temp_dirs.append(temp_base_dir)

        for temp_dir in temp_dirs:
            if not temp_dir.exists():
                continue

            for temp_file in sorted(temp_dir.rglob("*"), key=lambda p: len(str(p)), reverse=True):
                try:
                    if temp_file.is_file() and temp_file.stat().st_mtime < cutoff_time:
                        temp_file.unlink()
                        deleted_count += 1
                        logger.debug(f"Cleaned up orphaned temp file: {temp_file.name}")
                    elif temp_file.is_dir() and not any(temp_file.iterdir()):
                        temp_file.rmdir()
                        logger.debug(f"Cleaned up empty temp dir: {temp_file.name}")
                except Exception as e:
                    logger.warning(f"Failed to cleanup {temp_file}: {e}")

        if deleted_count > 0:
            logger.info(f"Cleaned up {deleted_count} orphaned temp files")
        return deleted_count

    except Exception as e:
        logger.error(f"Error cleaning up temp files: {e}")
        return 0


def cleanup_output_files(max_age_hours: int = 72):
    """
    Remove output files older than max_age_hours from output/finals/ and output/tts/.

    Does NOT touch:
    - Raw video clips in output/ root (source files)
    - Files in output/raw/ if it exists
    - Any file newer than max_age_hours

    Args:
        max_age_hours: Maximum age in hours. Files older than this are deleted.

    Returns:
        dict with deleted_count and freed_bytes
    """
    import time
    settings = get_settings()

    cutoff_time = time.time() - (max_age_hours * 3600)
    deleted_count = 0
    freed_bytes = 0

    # Target subdirectories only — NOT the output root
    target_dirs = [
        settings.output_dir / "finals",
        settings.output_dir / "tts",
    ]

    for target_dir in target_dirs:
        if not target_dir.exists():
            continue

        # Walk deepest-first so empty parent dirs can be removed
        for item in sorted(target_dir.rglob("*"), key=lambda p: len(str(p)), reverse=True):
            try:
                if item.is_file() and item.stat().st_mtime < cutoff_time:
                    size = item.stat().st_size
                    item.unlink()
                    deleted_count += 1
                    freed_bytes += size
                    logger.debug(f"Output cleanup: deleted {item.name} ({size} bytes)")
                elif item.is_dir() and not any(item.iterdir()):
                    item.rmdir()
                    logger.debug(f"Output cleanup: removed empty dir {item.name}")
            except Exception as e:
                logger.warning(f"Output cleanup failed for {item}: {e}")

    if deleted_count > 0:
        mb_freed = freed_bytes / (1024 * 1024)
        logger.info(f"Output cleanup: deleted {deleted_count} files, freed {mb_freed:.1f} MB")

    return {"deleted_count": deleted_count, "freed_bytes": freed_bytes}


def _hex_to_ass_color(hex_color: str) -> str:
    """Convertește HEX (#RRGGBB) în format ASS (&HBBGGRR&). ASS folosește BGR!"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H{b}{g}{r}&".upper()
    return "&HFFFFFF&"

async def _render_with_preset(
    video_path: Path,
    audio_path: Optional[Path],
    srt_path: Optional[Path],
    subtitle_settings: Optional[dict],
    preset: dict,
    output_path: Path,
    # Video enhancement filters (Phase 9)
    enable_denoise: bool = False,
    denoise_strength: float = 2.0,
    enable_sharpen: bool = False,
    sharpen_amount: float = 0.5,
    enable_color: bool = False,
    brightness: float = 0.0,
    contrast: float = 1.0,
    saturation: float = 1.0,
    # Preview mode: skip loudnorm, use ultrafast codec
    _preview_mode: bool = False,
    force_cpu: bool = False,
    # Optional encode-progress callback: receives a fraction 0.0-1.0 as ffmpeg
    # encodes. Used to drive a real (not fake) progress bar during the final
    # render. None = no streaming (plain safe_ffmpeg_run).
    on_encode_progress=None,
    # Render quality/speed mode (Wave 2.1): "speed" | "balanced" | "max".
    # None = use the configured default (env RENDER_QUALITY_MODE, else balanced).
    quality_mode: Optional[str] = None,
):
    """
    Randează video-ul final cu preset optimizat pentru social media.

    Video enhancement filters (Phase 9) are applied AFTER scale/crop, BEFORE subtitles.
    Filter order is locked: denoise -> sharpen -> color (don't sharpen noise).
    """
    # Initialize encoding variables at function scope to prevent UnboundLocalError
    _use_gpu = False
    encoding_params = []

    # Build FFmpeg command
    cmd = ["ffmpeg", "-y", "-i", str(video_path)]

    # Add audio input (real or silent)
    if audio_path and audio_path.exists():
        cmd.extend(["-i", str(audio_path)])
        has_audio = True
    else:
        # Add silent audio source BEFORE video settings
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
        has_audio = False

    # Build filter complex
    filters = []

    # Scale to fill portrait frame (crop excess, no letterboxing)
    # increase = scale up to fill entire frame, then crop to exact size
    filters.append(f"scale={preset['width']}:{preset['height']}:force_original_aspect_ratio=increase")
    filters.append(f"crop={preset['width']}:{preset['height']}")

    # Video enhancement filters (Phase 9) - apply AFTER scale/crop, BEFORE subtitles
    # Order is locked: denoise -> sharpen -> color (don't sharpen noise)
    if enable_denoise:
        # hqdn3d filter: luma_spatial:chroma_spatial:luma_temporal:chroma_temporal
        # Auto-derive chroma/temporal from luma_spatial
        chroma_spatial = denoise_strength * 0.75
        luma_temporal = denoise_strength * 1.5
        chroma_temporal = chroma_spatial * 1.5
        filters.append(f"hqdn3d={denoise_strength:.1f}:{chroma_spatial:.2f}:{luma_temporal:.1f}:{chroma_temporal:.2f}")
        logger.info(f"Applying denoise filter: luma_spatial={denoise_strength}")

    if enable_sharpen:
        # unsharp filter: luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
        # NEVER sharpen chroma (chroma_amount=0.0) - prevents color artifacts
        matrix_size = 5  # Standard 5x5 kernel
        filters.append(f"unsharp={matrix_size}:{matrix_size}:{sharpen_amount:.2f}:{matrix_size}:{matrix_size}:0.0")
        logger.info(f"Applying sharpen filter: luma_amount={sharpen_amount}")

    if enable_color:
        # eq filter: only include non-default parameters
        color_params = []
        if abs(brightness) > 0.001:
            color_params.append(f"brightness={brightness:.2f}")
        if abs(contrast - 1.0) > 0.001:
            color_params.append(f"contrast={contrast:.2f}")
        if abs(saturation - 1.0) > 0.001:
            color_params.append(f"saturation={saturation:.2f}")

        if color_params:
            filters.append(f"eq={':'.join(color_params)}")
            logger.info(f"Applying color correction: {', '.join(color_params)}")

    # Add subtitles if available (Phase 11: uses subtitle_styler service for shadow/glow/adaptive)
    if srt_path and srt_path.exists() and subtitle_settings:
        subtitles_filter = build_subtitle_filter(
            srt_path=srt_path,
            subtitle_settings=subtitle_settings,
            video_width=preset.get('subtitle_ref_width', preset.get('width', 1080)),
            video_height=preset.get('subtitle_ref_height', preset.get('height', 1920))
        )
        filters.append(subtitles_filter)
        logger.info(f"Added subtitle filter with enhancement settings")

    # Apply filters
    if filters:
        vf_str = ",".join(filters)
        cmd.extend(["-vf", vf_str])
        # DEBUG: Log the complete -vf filter string to diagnose subtitle transparency
        logger.debug(f"[RENDER-DEBUG] Complete -vf filter: {vf_str}")

    # Audio normalization (two-pass loudnorm) — skip in preview mode for speed
    audio_filters = []
    encoding_preset = None  # Will be set in audio normalization or encoding params block

    if not _preview_mode and has_audio and audio_path:  # Only normalize real audio, not silent
        # Get encoding preset to check if normalization is enabled
        preset_name = preset.get("name", "Generic")
        platform_map = {
            # Display names (from UI)
            "TikTok": "tiktok",
            "Instagram Reels": "reels",
            "YouTube Shorts": "youtube_shorts",
            "Generic": "generic",
            "Preview": "generic",
            # DB preset names (lowercase from editai_presets table)
            "tiktok": "tiktok",
            "instagram_reels": "reels",
            "youtube_shorts": "youtube_shorts",
            "facebook_reels": "generic",
            "instagram_story": "generic",
            "generic": "generic",
        }
        platform_key = platform_map.get(preset_name, "generic")
        encoding_preset = get_preset(platform_key)

        if encoding_preset.normalize_audio:
            logger.info(f"Performing two-pass audio normalization (target: {encoding_preset.target_lufs} LUFS)")

            # First pass: Measure loudness
            measurement = await measure_loudness(
                audio_path,
                target_lufs=encoding_preset.target_lufs,
                target_tp=encoding_preset.target_tp,
                target_lra=encoding_preset.target_lra
            )

            if measurement:
                # Second pass: Build normalization filter
                loudnorm_filter = build_loudnorm_filter(
                    measurement,
                    target_lufs=encoding_preset.target_lufs,
                    target_tp=encoding_preset.target_tp,
                    target_lra=encoding_preset.target_lra
                )
                audio_filters.append(loudnorm_filter)
                logger.info(f"Audio normalization: {measurement.input_i:.1f} LUFS -> {encoding_preset.target_lufs} LUFS")
            else:
                logger.warning("Audio normalization measurement failed, rendering without normalization")

    # Apply audio filters if any
    if audio_filters:
        cmd.extend(["-af", ",".join(audio_filters)])

    # Preview mode: use ultrafast codec params, skip encoding preset
    if _preview_mode:
        from app.services.ffmpeg_semaphore import get_preview_codec_params
        _use_gpu = False if force_cpu else is_nvenc_available()
        encoding_params = get_preview_codec_params(use_gpu=_use_gpu)
        # Add audio codec
        encoding_params.extend(["-c:a", "aac", "-b:a", "128k"])
        logger.info(f"Preview mode: using {'CPU forced' if force_cpu else ('GPU' if _use_gpu else 'CPU')} ultrafast encoding")
    else:
        # Reuse encoding_preset from audio normalization block (or compute if first time)
        if not encoding_preset:
            preset_name = preset.get("name", "Generic")
            platform_map = {
                # Display names (from UI)
                "TikTok": "tiktok",
                "Instagram Reels": "reels",
                "YouTube Shorts": "youtube_shorts",
                "Generic": "generic",
                "Preview": "generic",
                # DB preset names (lowercase from editai_presets table)
                "tiktok": "tiktok",
                "instagram_reels": "reels",
                "youtube_shorts": "youtube_shorts",
                "facebook_reels": "generic",
                "instagram_story": "generic",
                "generic": "generic",
            }
            platform_key = platform_map.get(preset_name, "generic")
            encoding_preset = get_preset(platform_key)

        # Override encoding preset fields from DB preset_data (if present)
        _db_overrides = {}
        if preset.get("encoding_mode"):
            _db_overrides["encoding_mode"] = preset["encoding_mode"]
        if preset.get("target_bitrate_kbps"):
            _db_overrides["target_bitrate_kbps"] = int(preset["target_bitrate_kbps"])
        if preset.get("video_profile"):
            _db_overrides["video_profile"] = preset["video_profile"]
        if preset.get("video_level"):
            _db_overrides["video_level"] = preset["video_level"]
        if _db_overrides:
            encoding_preset = encoding_preset.model_copy(update=_db_overrides)
            logger.info(f"Applied DB overrides to encoding preset: {_db_overrides}")

        logger.info(f"Using encoding preset: {encoding_preset.name} (platform: {encoding_preset.platform}, mode: {encoding_preset.encoding_mode})")

        # Wave 2.1: resolve the effective encode path from the render quality mode.
        # balanced/speed + GPU -> NVENC single-pass (3-5x faster, frees CPU);
        # max -> CPU libx264 2-pass. This is what stops the GPU from being wasted.
        _qmode = (quality_mode or get_default_quality_mode())
        _gpu_ok = (not force_cpu) and is_nvenc_available()
        encoding_preset = apply_quality_mode(encoding_preset, _qmode, gpu_available=_gpu_ok)
        logger.info(f"Render quality mode: {_qmode} (gpu_available={_gpu_ok}) -> encoding_mode={encoding_preset.encoding_mode}")

        # Use GPU encoding when NVENC is available (much faster + frees CPU)
        _use_gpu = False if force_cpu else is_nvenc_available()
        if force_cpu:
            logger.info("Encoding with CPU forced")

    # Extract audio bitrate from encoding params for comparison (skip in preview mode)
    if not _preview_mode and encoding_preset:
        # Override audio bitrate if database preset has higher value
        db_audio_bitrate = preset.get("audio_bitrate", "320k")
        if db_audio_bitrate:
            try:
                db_bitrate_val = int(db_audio_bitrate.lower().replace("k", ""))
                preset_bitrate_val = int(encoding_preset.audio_bitrate.lower().replace("k", ""))
            except (ValueError, AttributeError):
                db_bitrate_val = 320
                preset_bitrate_val = 320
            if db_bitrate_val > preset_bitrate_val:
                logger.info(f"Database audio bitrate {db_audio_bitrate} higher than preset {encoding_preset.audio_bitrate}, using database value")
                encoding_preset = encoding_preset.model_copy(update={"audio_bitrate": db_audio_bitrate})

    # Determine audio duration (needed for both single-pass and 2-pass)
    _audio_dur = 0
    if audio_path and audio_path.exists():
        try:
            _probe = safe_ffmpeg_run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
                timeout=30, operation="ffprobe audio duration (render)"
            )
            _audio_dur = float(_probe.stdout.strip()) if _probe.returncode == 0 else 0
        except Exception:
            _audio_dur = 0
        # BUG-6.4: If audio file exists but duration probe returned 0, try fallback
        if _audio_dur == 0 and audio_path.stat().st_size > 0:
            logger.warning(f"Audio file exists ({audio_path.stat().st_size} bytes) but ffprobe returned duration=0, using -shortest fallback")
            # _audio_dur stays 0, -shortest will be used — which is correct for real audio

    # ── 2-Pass VBR Rendering ──
    if not _preview_mode and encoding_preset and encoding_preset.needs_two_pass():
        import os
        import tempfile
        _passlog_prefix = str(output_path.parent / f"ffmpeg2pass_{uuid.uuid4().hex[:8]}")
        _fps = str(preset.get("fps", 30))

        try:
            # ── PASS 1: Video analysis (no audio, no subtitles) ──
            logger.info(f"VBR 2-pass: Starting pass 1 (analysis) — target {encoding_preset.target_bitrate_kbps}k")
            pass1_cmd = ["ffmpeg", "-y", "-i", str(video_path)]

            # Build video filters WITHOUT subtitles for pass 1 (saves time)
            pass1_filters = []
            pass1_filters.append(f"scale={preset['width']}:{preset['height']}:force_original_aspect_ratio=increase")
            pass1_filters.append(f"crop={preset['width']}:{preset['height']}")
            if enable_denoise:
                chroma_spatial = denoise_strength * 0.75
                luma_temporal = denoise_strength * 1.5
                chroma_temporal = chroma_spatial * 1.5
                pass1_filters.append(f"hqdn3d={denoise_strength:.1f}:{chroma_spatial:.2f}:{luma_temporal:.1f}:{chroma_temporal:.2f}")
            if enable_sharpen:
                matrix_size = 5
                pass1_filters.append(f"unsharp={matrix_size}:{matrix_size}:{sharpen_amount:.2f}:{matrix_size}:{matrix_size}:0.0")
            if enable_color:
                color_params = []
                if abs(brightness) > 0.001:
                    color_params.append(f"brightness={brightness:.2f}")
                if abs(contrast - 1.0) > 0.001:
                    color_params.append(f"contrast={contrast:.2f}")
                if abs(saturation - 1.0) > 0.001:
                    color_params.append(f"saturation={saturation:.2f}")
                if color_params:
                    pass1_filters.append(f"eq={':'.join(color_params)}")

            if pass1_filters:
                pass1_cmd.extend(["-vf", ",".join(pass1_filters)])

            pass1_cmd.extend(["-r", _fps])
            pass1_params = encoding_preset.to_ffmpeg_params(use_gpu=False, pass_number=1, passlogfile=_passlog_prefix)
            pass1_cmd.extend(pass1_params)
            pass1_cmd.extend(["-an", "-f", "null", os.devnull])

            logger.info(f"Pass 1 command: {' '.join(pass1_cmd)}")
            # Pass 1 (analysis) maps to the first 45% of the encode progress band.
            _p1_cb = (lambda f: on_encode_progress(f * 0.45)) if on_encode_progress else None
            result1 = await asyncio.to_thread(safe_ffmpeg_run_with_progress, pass1_cmd, _audio_dur, _p1_cb, 1200, "VBR 2-pass: pass 1")
            if result1.returncode != 0:
                raise RuntimeError(f"FFmpeg 2-pass (pass 1) failed: {result1.stderr}")

            # ── PASS 2: Final encode (full filters + audio) ──
            logger.info(f"VBR 2-pass: Starting pass 2 (encoding)")
            pass2_cmd = ["ffmpeg", "-y", "-i", str(video_path)]

            # Add audio input
            if audio_path and audio_path.exists():
                pass2_cmd.extend(["-i", str(audio_path)])
                has_audio_pass2 = True
            else:
                pass2_cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
                has_audio_pass2 = False

            # Full video filters (including subtitles) for pass 2
            if filters:
                vf_str = ",".join(filters)
                pass2_cmd.extend(["-vf", vf_str])

            # Audio filters (loudnorm) for pass 2
            if audio_filters:
                pass2_cmd.extend(["-af", ",".join(audio_filters)])

            pass2_cmd.extend(["-r", _fps])
            pass2_params = encoding_preset.to_ffmpeg_params(use_gpu=False, pass_number=2, passlogfile=_passlog_prefix)
            pass2_cmd.extend(pass2_params)

            # Audio mapping
            if audio_path and audio_path.exists():
                pass2_cmd.extend(["-map", "0:v:0", "-map", "1:a:0"])
                if _audio_dur > 0:
                    pass2_cmd.extend(["-t", str(_audio_dur)])
                else:
                    pass2_cmd.extend(["-shortest"])
            else:
                pass2_cmd.extend(["-map", "0:v:0", "-map", "1:a:0", "-shortest"])

            # Extra flags
            extra_flags = preset.get("extra_flags", "-movflags +faststart")
            if extra_flags:
                pass2_cmd.extend(_validate_extra_flags(extra_flags))

            pass2_cmd.append(str(output_path))

            logger.info(f"Pass 2 command: {' '.join(pass2_cmd)}")
            # Pass 2 (final encode) maps to the remaining 45%-100% of the band.
            _p2_cb = (lambda f: on_encode_progress(0.45 + f * 0.55)) if on_encode_progress else None
            result2 = await asyncio.to_thread(safe_ffmpeg_run_with_progress, pass2_cmd, _audio_dur, _p2_cb, 1800, "VBR 2-pass: pass 2")
            if result2.returncode != 0:
                raise RuntimeError(f"FFmpeg 2-pass (pass 2) failed: {result2.stderr}")

        finally:
            # Cleanup passlog files (ffmpeg creates .log and .log.mbtree)
            import glob as _glob_mod
            for passlog_file in _glob_mod.glob(f"{_passlog_prefix}*"):
                try:
                    os.remove(passlog_file)
                except OSError:
                    pass

    else:
        # ── Single-pass rendering (CRF, VBR 1-pass, or preview) ──
        # BUG-1.1: Ensure encoding_params is always initialized (may not be set
        # when _preview_mode is False and encoding_preset is None/falsy)
        if not _preview_mode and encoding_preset:
            encoding_params = encoding_preset.to_ffmpeg_params(use_gpu=_use_gpu)
            logger.info(f"Encoding with {'GPU (NVENC)' if _use_gpu else 'CPU (libx264)'} (single-pass {encoding_preset.encoding_mode})")
        elif not _preview_mode:
            encoding_params = ["-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "192k"]
            logger.warning("No encoding preset available for single-pass render, using default libx264 CRF 23")

        # Add FPS setting (from database preset)
        cmd.extend(["-r", str(preset.get("fps", 30))])

        # Add encoding parameters from EncodingPreset
        cmd.extend(encoding_params)

        # Audio mapping — use audio duration as master clock (video was pre-synced to match)
        if audio_path and audio_path.exists():
            cmd.extend(["-map", "0:v:0", "-map", "1:a:0"])
            if _audio_dur > 0:
                cmd.extend(["-t", str(_audio_dur)])
            else:
                cmd.extend(["-shortest"])
        else:
            cmd.extend(["-map", "0:v:0", "-map", "1:a:0", "-shortest"])

        # Extra flags for social media compatibility (validated against allowlist)
        extra_flags = preset.get("extra_flags", "-movflags +faststart")
        if extra_flags:
            cmd.extend(_validate_extra_flags(extra_flags))

        # Output
        cmd.append(str(output_path))

        logger.info(f"Rendering with command: {' '.join(cmd)}")

        # Stream real progress when a callback + known duration are available;
        # the helper falls back to plain safe_ffmpeg_run otherwise.
        result = await asyncio.to_thread(safe_ffmpeg_run_with_progress, cmd, _audio_dur, on_encode_progress, 1200, "final render")
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg render failed: {result.stderr}")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError(f"FFmpeg render produced no output file or empty file: {output_path}")

    logger.info(f"Rendered: {output_path} (mode: {encoding_preset.encoding_mode if encoding_preset else 'preview'})")
