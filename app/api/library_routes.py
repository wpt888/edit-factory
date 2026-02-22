"""
EditAI Library & Workflow Routes
Gestionează proiecte, clipuri, asocieri și exporturi pentru noul workflow.
"""
import uuid
import shutil
import subprocess
import json
import mimetypes
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Depends, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import validate_upload_size
from app.services.encoding_presets import get_preset, EncodingPreset
from app.services.audio_normalizer import measure_loudness, build_loudnorm_filter
from app.services.video_filters import VideoFilters, DenoiseConfig, SharpenConfig, ColorConfig
from app.services.subtitle_styler import build_subtitle_filter
from app.services.tts_subtitle_generator import generate_srt_from_timestamps
from app.services.srt_validator import sanitize_srt_text

import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/library", tags=["library"])

# ============== PROJECT LOCKS (prevent race conditions) ==============
_project_locks: Dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()  # Meta-lock for managing project locks


def _cleanup_stale_locks():
    """Remove lock entries for projects that are not currently being processed.

    A lock is considered stale if it can be acquired non-blocking (meaning no
    task holds it). Called automatically when the dict grows beyond 50 entries
    to prevent unbounded accumulation.
    """
    stale_keys = []
    for pid, lock in list(_project_locks.items()):
        if lock.acquire(blocking=False):
            # Nobody holds it — it's stale
            lock.release()
            stale_keys.append(pid)
    for pid in stale_keys:
        _project_locks.pop(pid, None)
    if stale_keys:
        logger.debug(f"[locks] Cleaned up {len(stale_keys)} stale project lock(s)")


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
    """Remove project lock when no longer needed."""
    with _locks_lock:
        if project_id in _project_locks:
            del _project_locks[project_id]

# ============== PROGRESS TRACKING ==============
_generation_progress: Dict[str, dict] = {}

from app.db import get_supabase

def update_generation_progress(project_id: str, percentage: int, current_step: str, estimated_remaining: Optional[int] = None):
    """Update generation progress for a project.

    Writes to both the in-memory dict (fast polling) and Supabase
    (durability — survives server restarts).
    """
    _generation_progress[project_id] = {
        "percentage": percentage,
        "current_step": current_step,
        "estimated_remaining": estimated_remaining
    }
    # Persist to Supabase for durability across server restarts
    try:
        supabase = get_supabase()
        if supabase:
            supabase.table("editai_generation_progress").upsert({
                "project_id": project_id,
                "percentage": percentage,
                "current_step": current_step,
                "estimated_remaining": estimated_remaining,
                "updated_at": datetime.now().isoformat()
            }).execute()
    except Exception as e:
        logger.warning(f"[progress] Failed to persist progress to DB for {project_id}: {e}")


def get_generation_progress(project_id: str) -> Optional[dict]:
    """Get generation progress for a project.

    Fast path: in-memory dict.
    Fallback: Supabase query (used after server restart when memory is cold).
    """
    result = _generation_progress.get(project_id)
    if result is not None:
        return result

    # Memory miss — try DB (e.g. after server restart)
    try:
        supabase = get_supabase()
        if supabase:
            db_result = supabase.table("editai_generation_progress")\
                .select("*")\
                .eq("project_id", project_id)\
                .maybe_single()\
                .execute()
            if db_result and db_result.data:
                row = db_result.data
                progress = {
                    "percentage": row.get("percentage", 0),
                    "current_step": row.get("current_step", ""),
                    "estimated_remaining": row.get("estimated_remaining")
                }
                # Warm the in-memory cache
                _generation_progress[project_id] = progress
                return progress
    except Exception as e:
        logger.warning(f"[progress] Failed to query progress from DB for {project_id}: {e}")

    return None


def clear_generation_progress(project_id: str):
    """Clear generation progress for a project (memory + DB)."""
    if project_id in _generation_progress:
        del _generation_progress[project_id]
    try:
        supabase = get_supabase()
        if supabase:
            supabase.table("editai_generation_progress")\
                .delete()\
                .eq("project_id", project_id)\
                .execute()
    except Exception as e:
        logger.warning(f"[progress] Failed to delete progress from DB for {project_id}: {e}")


# ============== PYDANTIC MODELS ==============

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
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

def verify_project_ownership(supabase, project_id: str, profile_id: str) -> dict:
    """Verify project exists and belongs to profile. Returns project or raises 404."""
    try:
        result = supabase.table("editai_projects")\
            .select("*")\
            .eq("id", project_id)\
            .eq("profile_id", profile_id)\
            .single()\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Project not found")

        return result.data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying project ownership: {e}")
        raise HTTPException(status_code=503, detail="Database unavailable")


# ============== FILE SERVING ==============

@router.get("/files/{file_path:path}")
async def serve_file(file_path: str, download: bool = Query(default=False)):
    """
    Servește fișiere (thumbnails, videos) din directoarele output.
    Security: Permite doar fișiere din directoarele permise.
    """
    settings = get_settings()
    full_path = Path(file_path)
    if not full_path.is_absolute():
        # Handle paths that start with "output/" - strip the prefix since output_dir already ends with /output
        if file_path.startswith("output/"):
            relative_path = file_path[7:]  # Remove "output/"
            full_path = settings.output_dir / relative_path
        else:
            full_path = settings.output_dir / file_path

    allowed_dirs = [settings.output_dir, settings.input_dir, settings.base_dir / "temp"]

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
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not resolved_path.is_file():
        raise HTTPException(status_code=400, detail="Not a file")

    media_type, _ = mimetypes.guess_type(str(resolved_path))
    return FileResponse(
        path=str(resolved_path),
        media_type=media_type or "application/octet-stream",
        filename=resolved_path.name if download else None,
        headers={"Cache-Control": "public, max-age=3600"}
    )


# ============== CLIP ASSET DOWNLOADS (SRT, Audio) ==============

@router.get("/clips/{clip_id}/srt")
async def download_clip_srt(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Download SRT subtitle file for a clip."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify ownership
    clip = supabase.table("editai_clips").select("id").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
    if not clip.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Get SRT content from clip_content
    content = supabase.table("editai_clip_content").select("srt_content").eq("clip_id", clip_id).single().execute()
    if not content.data or not content.data.get("srt_content"):
        raise HTTPException(status_code=404, detail="No subtitles available for this clip")

    return Response(
        content=content.data["srt_content"],
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="clip_{clip_id[:8]}.srt"'}
    )


@router.get("/clips/{clip_id}/audio")
async def download_clip_audio(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Download TTS audio (MP3) file for a clip."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify ownership
    clip = supabase.table("editai_clips").select("id").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
    if not clip.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Get audio path from clip_content
    content = supabase.table("editai_clip_content").select("tts_audio_path").eq("clip_id", clip_id).single().execute()
    if not content.data or not content.data.get("tts_audio_path"):
        raise HTTPException(status_code=404, detail="No audio available for this clip")

    settings = get_settings()
    file_path = Path(content.data["tts_audio_path"])
    if not file_path.is_absolute():
        file_path = settings.base_dir / file_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        filename=f"clip_{clip_id[:8]}.mp3",
        headers={"Cache-Control": "public, max-age=3600"}
    )


# ============== PROJECTS ==============

@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    project: ProjectCreate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Creează un proiect nou."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_projects").insert({
            "name": project.name,
            "description": project.description,
            "target_duration": project.target_duration,
            "context_text": project.context_text,
            "status": "draft",
            "profile_id": profile.profile_id
        }).execute()

        if result.data:
            proj = result.data[0]
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
        raise HTTPException(status_code=500, detail="Failed to create project")
    except Exception as e:
        logger.error(f"Error creating project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
async def list_projects(
    status: Optional[str] = None,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Listează toate proiectele."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        query = supabase.table("editai_projects").select("*").eq("profile_id", profile.profile_id).order("created_at", desc=True)
        if status:
            query = query.eq("status", status)
        result = query.execute()
        return {"projects": result.data}
    except Exception as e:
        logger.error(f"Error listing projects: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține detaliile unui proiect."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_projects").select("*").eq("id", project_id).eq("profile_id", profile.profile_id).single().execute()
        if result.data:
            proj = result.data
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
        raise HTTPException(status_code=404, detail="Project not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/progress")
async def get_project_progress(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține progresul generării pentru un proiect."""
    progress = get_generation_progress(project_id)
    if progress:
        return progress

    # If no progress tracked, check project status
    supabase = get_supabase()
    if supabase:
        try:
            result = supabase.table("editai_projects").select("status").eq("id", project_id).eq("profile_id", profile.profile_id).single().execute()
        except Exception:
            return {"percentage": 0, "current_step": "Proiect negăsit", "estimated_remaining": None}
        if result.data:
            status = result.data.get("status")
            if status == "generating":
                return {"percentage": 0, "current_step": "Se inițializează...", "estimated_remaining": None}
            elif status == "ready_for_triage":
                return {"percentage": 100, "current_step": "Complet", "estimated_remaining": 0}
            elif status == "failed":
                return {"percentage": 100, "current_step": "Eșuat", "estimated_remaining": 0}

    raise HTTPException(status_code=404, detail="Progress not found")


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str,
    updates: dict,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează un proiect."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    allowed_fields = ["name", "description", "target_duration", "context_text"]
    filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
    filtered_updates["updated_at"] = datetime.now().isoformat()

    try:
        result = supabase.table("editai_projects").update(filtered_updates).eq("id", project_id).eq("profile_id", profile.profile_id).execute()
        if result.data:
            return {"status": "updated", "project": result.data[0]}
        raise HTTPException(status_code=404, detail="Project not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/cancel")
async def cancel_generation(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Cancel an in-progress generation for a project."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    verify_project_ownership(supabase, project_id, profile.profile_id)
    clear_generation_progress(project_id)
    # Clean up any stale lock entry so get_project_lock() starts fresh on next run
    cleanup_project_lock(project_id)

    supabase.table("editai_projects").update({
        "status": "failed",
        "updated_at": datetime.now().isoformat()
    }).eq("id", project_id).eq("profile_id", profile.profile_id).execute()

    return {"status": "cancelled"}


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Șterge un proiect și toate clipurile asociate."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Ștergem mai întâi clipurile (CASCADE ar trebui să facă asta automat)
        # Dar ștergem și fișierele fizice
        clips = supabase.table("editai_clips").select("*").eq("project_id", project_id).eq("profile_id", profile.profile_id).execute()
        for clip in clips.data or []:
            _delete_clip_files(clip)

        # Ștergem proiectul
        result = supabase.table("editai_projects").delete().eq("id", project_id).eq("profile_id", profile.profile_id).execute()
        return {"status": "deleted", "project_id": project_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============== GENERATE RAW CLIPS ==============

@router.post("/projects/{project_id}/generate")
async def generate_raw_clips(
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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    settings = get_settings()
    settings.ensure_dirs()

    # Verificăm că proiectul există și aparține profilului
    project_data = verify_project_ownership(supabase, project_id, profile.profile_id)

    # Reject immediately if a task is already running for this project (STAB-03)
    if is_project_locked(project_id):
        raise HTTPException(
            status_code=409,
            detail="Project is currently being processed. Wait for the current job to finish before starting a new one."
        )

    # Determine video source: uploaded file or local path
    if video and video.filename:
        # Reject oversized uploads before reading the file into memory (STAB-05)
        await validate_upload_size(video)

        # User uploaded a file
        job_id = uuid.uuid4().hex[:12]
        video_filename = f"{job_id}_{_sanitize_filename(video.filename)}"
        final_video_path = settings.input_dir / video_filename

        with open(final_video_path, "wb") as f:
            shutil.copyfileobj(video.file, f)
    elif video_path:
        # User provided local path (for testing)
        local_path = Path(video_path)
        if not local_path.exists():
            raise HTTPException(status_code=400, detail=f"Video file not found: {video_path}")
        final_video_path = local_path
    else:
        raise HTTPException(status_code=400, detail="Must provide either video file or video_path")

    # Obținem info despre video
    video_info = _get_video_info(final_video_path)

    # Actualizăm proiectul cu info despre video sursă
    supabase.table("editai_projects").update({
        "source_video_path": str(final_video_path),
        "source_video_duration": video_info.get("duration", 0),
        "source_video_width": video_info.get("width", 1080),
        "source_video_height": video_info.get("height", 1920),
        "status": "generating",
        "updated_at": datetime.now().isoformat()
    }).eq("id", project_id).eq("profile_id", profile.profile_id).execute()

    # Limitări
    variant_count = max(1, min(10, variant_count))

    # Lansăm generarea în background
    background_tasks.add_task(
        _generate_raw_clips_task,
        project_id=project_id,
        profile_id=profile.profile_id,
        video_path=str(final_video_path),
        variant_count=variant_count,
        target_duration=project_data["target_duration"],
        context_text=project_data.get("context_text")
    )

    return {
        "status": "generating",
        "project_id": project_id,
        "variant_count": variant_count,
        "message": f"Generating {variant_count} raw clip variants..."
    }


async def _generate_raw_clips_task(
    project_id: str,
    video_path: str,
    variant_count: int,
    target_duration: int,
    context_text: Optional[str],
    profile_id: Optional[str] = "default"
):
    """Task pentru generarea clipurilor raw în background."""
    from app.services.video_processor import VideoProcessorService

    logger.info(f"[Profile {profile_id}] Starting raw clip generation for project {project_id}")

    supabase = get_supabase()
    if not supabase:
        logger.error(f"[Profile {profile_id}] Supabase not available for raw clips generation")
        return

    settings = get_settings()

    # Acquire project lock to prevent concurrent operations
    lock = get_project_lock(project_id)
    if not lock.acquire(blocking=False):
        logger.warning(f"Project {project_id} is already being processed, skipping")
        return

    try:
        # Profile-scoped temp directory to prevent cross-profile file collisions
        temp_dir = settings.base_dir / "temp" / profile_id
        temp_dir.mkdir(parents=True, exist_ok=True)

        processor = VideoProcessorService(
            input_dir=settings.input_dir,
            output_dir=settings.output_dir,
            temp_dir=temp_dir
        )

        # Generăm clipuri RAW (fără audio, fără subtitrări)
        result = processor.process_video(
            video_path=Path(video_path),
            output_name=f"project_{project_id[:8]}",
            target_duration=target_duration,
            audio_path=None,  # Fără audio
            srt_path=None,    # Fără subtitrări
            subtitle_settings=None,
            variant_count=variant_count,
            progress_callback=lambda step, status: logger.info(f"[{project_id}] {step}: {status}"),
            context_text=context_text,
            generate_audio=False,  # IMPORTANT: Nu generăm audio
            mute_source_voice=False
        )

        if result["status"] == "success":
            # Salvăm clipurile în DB
            variants = result.get("variants", [])
            if not variants and result.get("final_video"):
                # Single variant case
                variants = [{
                    "variant_index": 1,
                    "variant_name": "variant_1",
                    "final_video": result["final_video"]
                }]

            for variant in variants:
                video_file = Path(variant["final_video"])
                duration = _get_video_duration(video_file)

                # Generăm thumbnail
                thumbnail_path = _generate_thumbnail(video_file)

                # Inserăm în DB
                supabase.table("editai_clips").insert({
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
                }).execute()

            # Actualizăm proiectul
            supabase.table("editai_projects").update({
                "status": "ready_for_triage",
                "variants_count": len(variants),
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).eq("profile_id", profile_id).execute()

            logger.info(f"Generated {len(variants)} raw clips for project {project_id}")
        else:
            # Eroare
            supabase.table("editai_projects").update({
                "status": "failed",
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).eq("profile_id", profile_id).execute()
            logger.error(f"Failed to generate clips for project {project_id}: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error generating raw clips for {project_id}: {e}")
        supabase.table("editai_projects").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", project_id).execute()
    finally:
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
    # Log the received request for debugging
    logger.info(f"[MUTE DEBUG] /generate-from-segments called for project {project_id}")
    logger.info(f"[MUTE DEBUG] Request parameters: variant_count={request.variant_count}, mute_source_voice={request.mute_source_voice}")

    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    settings = get_settings()
    settings.ensure_dirs()

    # Verificăm că proiectul există și aparține profilului
    project_data = verify_project_ownership(supabase, project_id, profile.profile_id)

    # Reject immediately if a task is already running for this project (STAB-03)
    if is_project_locked(project_id):
        raise HTTPException(
            status_code=409,
            detail="Project is currently being processed. Wait for the current job to finish before starting a new one."
        )

    # Obținem segmentele asignate proiectului
    segments_result = supabase.table("editai_project_segments")\
        .select("*, editai_segments(*, editai_source_videos(file_path, name))")\
        .eq("project_id", project_id)\
        .order("sequence_order")\
        .execute()

    if not segments_result.data:
        raise HTTPException(status_code=400, detail="No segments assigned to this project")

    # Găsim cel mai mare variant_index existent pentru a continua de acolo
    existing_clips = supabase.table("editai_clips").select("variant_index").eq("project_id", project_id).eq("profile_id", profile.profile_id).eq("is_deleted", False).execute()
    start_variant_index = 1
    if existing_clips.data:
        max_index = max(clip.get("variant_index", 0) for clip in existing_clips.data)
        start_variant_index = max_index + 1
        logger.info(f"Found {len(existing_clips.data)} existing clips, starting from variant {start_variant_index}")

    # Actualizăm statusul proiectului
    supabase.table("editai_projects").update({
        "status": "generating",
        "target_duration": request.target_duration,
        "updated_at": datetime.now().isoformat()
    }).eq("id", project_id).eq("profile_id", profile.profile_id).execute()

    # Limitări
    variant_count = max(1, min(10, request.variant_count))

    # Lansăm generarea în background
    background_tasks.add_task(
        _generate_from_segments_task,
        project_id=project_id,
        profile_id=profile.profile_id,
        segments=segments_result.data,
        variant_count=variant_count,
        selection_mode=request.selection_mode,
        target_duration=request.target_duration,
        tts_text=request.tts_text if request.generate_tts else None,
        mute_source_voice=request.mute_source_voice,
        start_variant_index=start_variant_index
    )

    return {
        "status": "generating",
        "project_id": project_id,
        "variant_count": variant_count,
        "segments_count": len(segments_result.data),
        "message": f"Generating {variant_count} clip variants from {len(segments_result.data)} segments..."
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
        # Verificăm suprapunerea
        voice_start = vs.start_time if hasattr(vs, 'start_time') else vs.get('start', 0)
        voice_end = vs.end_time if hasattr(vs, 'end_time') else vs.get('end', 0)

        # Calculăm intersecția
        overlap_start = max(segment_start, voice_start)
        overlap_end = min(segment_end, voice_end)

        if overlap_start < overlap_end:
            # Există suprapunere - convertim la timp relativ
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
        # Dacă intervalul curent începe înainte ca cel precedent să se termine + gap
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

    # Combinăm intervalele apropiate pentru a evita sacadare
    merged_intervals = _merge_close_intervals(mute_intervals, gap_threshold=0.4)

    if not merged_intervals:
        return None

    # Pentru un singur interval mare, folosim filtrul afade simplu (cel mai curat)
    if len(merged_intervals) == 1:
        start, end = merged_intervals[0]
        fade_out_start = max(0, start - fade_duration)
        # Folosim afade care are implementare nativă de fade exponențial
        # curve=exp pentru curbă exponențială
        return (
            f"afade=t=out:st={fade_out_start:.3f}:d={fade_duration:.3f}:curve=exp,"
            f"afade=t=in:st={end:.3f}:d={fade_duration:.3f}:curve=exp"
        )

    # Pentru multiple intervale, construim o expresie volume complexă
    # Formula pentru fade exponențial:
    # - Fade out (t aproape de voice_start): pow(distance/fade_duration, 2)
    # - Fade in (t după voice_end): 1 - pow(1 - distance/fade_duration, 2)

    fd = fade_duration
    mv = min_volume

    # Construim expresia pentru fiecare interval
    # Volumul pentru fiecare interval: 1 când departe, fade când aproape, min_volume în interior
    interval_expressions = []

    for start, end in merged_intervals:
        # Expresie pentru acest interval:
        # - t < start - fd: volum = 1 (departe, niciun efect)
        # - start - fd <= t < start: fade out exponențial
        # - start <= t <= end: volum = min_volume
        # - end < t <= end + fd: fade in exponențial
        # - t > end + fd: volum = 1 (departe, niciun efect)

        fade_start = start - fd
        fade_end = end + fd

        # Curba exponențială: pow(x, 2) pentru slow-start/fast-end
        # x = (start - t) / fd pentru fade out, normalizat la [0, 1]
        # rezultat: 1 când t = start - fd, 0 când t = start

        expr = (
            f"if(lt(t,{fade_start:.3f}),1,"  # înainte de fade: volum 1
            f"if(lt(t,{start:.3f}),"  # în zona de fade out
            f"{mv}+(1-{mv})*pow((({start:.3f}-t)/{fd:.3f}),2),"  # fade exponențial spre min_volume
            f"if(lt(t,{end:.3f}),{mv},"  # în zona de voce: min_volume
            f"if(lt(t,{fade_end:.3f}),"  # în zona de fade in
            f"{mv}+(1-{mv})*(1-pow((1-(t-{end:.3f})/{fd:.3f}),2)),"  # fade exponențial de la min_volume
            f"1))))"  # după fade: volum 1
        )
        interval_expressions.append(expr)

    # Combinăm toate expresiile - luăm minimul pentru cazul când intervalele se suprapun
    if len(interval_expressions) == 1:
        volume_expr = interval_expressions[0]
    else:
        # Înmulțim expresiile - dacă oricare interval vrea volum redus, se aplică
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
    profile_id: Optional[str] = "default"
):
    """Task pentru generarea clipurilor din segmente în background."""
    import subprocess
    import random

    logger.info(f"[Profile {profile_id}] Starting clip generation from segments for project {project_id}")

    supabase = get_supabase()
    if not supabase:
        logger.error(f"[Profile {profile_id}] Supabase not available for segment generation")
        return

    settings = get_settings()

    # Acquire project lock
    lock = get_project_lock(project_id)
    if not lock.acquire(blocking=False):
        logger.warning(f"Project {project_id} is already being processed, skipping")
        return

    try:
        # Initial progress
        update_generation_progress(project_id, 5, "Se pregătesc segmentele...")

        # Pregătim lista de segmente cu fișierele lor
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
                    "duration": seg.get("end_time", 0) - seg.get("start_time", 0),
                    "source_name": source_video.get("name", "unknown")
                })

        if not available_segments:
            raise Exception("No valid segments with existing video files")

        logger.info(f"Processing {len(available_segments)} segments for project {project_id}")

        # ============== VOICE DETECTION (dacă mute_source_voice este activat) ==============
        voice_segments_by_file = {}
        logger.info(f"[MUTE DEBUG] Project {project_id}: mute_source_voice={mute_source_voice}")
        if mute_source_voice:
            logger.info(f"[MUTE DEBUG] Starting voice detection for project {project_id}")
            update_generation_progress(project_id, 8, "Se detectează vocile din video-uri sursă...")
            try:
                from app.services.voice_detector import VoiceDetector
                detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)  # Balanced threshold

                # Detectăm vocile pentru fiecare fișier sursă unic
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
                # Continuăm fără mute dacă detectarea eșuează
                voice_segments_by_file = {}

        # Generăm variante
        variants_created = []
        end_variant_index = start_variant_index + variant_count

        for variant_idx in range(start_variant_index, end_variant_index):
            try:
                # Update progress for this variant (relative to this batch)
                relative_idx = variant_idx - start_variant_index + 1
                base_pct = 10 + int(((relative_idx - 1) / variant_count) * 80)
                update_generation_progress(
                    project_id,
                    base_pct,
                    f"Se generează varianta {variant_idx} ({relative_idx} din {variant_count} noi)..."
                )

                # Selectăm segmente pentru această variantă
                if selection_mode == "sequential":
                    selected = available_segments.copy()
                elif selection_mode == "weighted":
                    # Pentru weighted, prioritizăm segmentele mai lungi
                    selected = sorted(available_segments, key=lambda x: x["duration"], reverse=True)
                else:  # random
                    selected = available_segments.copy()
                    random.shuffle(selected)

                # Colectăm segmente până atingem durata țintă
                segments_for_variant = []
                current_duration = 0

                logger.info(f"Variant {variant_idx}: target_duration={target_duration}s, available segments={len(selected)}")

                for seg in selected:
                    if current_duration >= target_duration:
                        logger.info(f"  Stopping: current_duration ({current_duration:.1f}s) >= target ({target_duration}s)")
                        break

                    remaining_duration = target_duration - current_duration

                    # Dacă segmentul depășește durata rămasă, îl trunchiez
                    if seg["duration"] > remaining_duration:
                        # Adaugă segment trunchiat
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

                # Creăm video-ul pentru această variantă
                output_filename = f"project_{project_id[:8]}_variant_{variant_idx}.mp4"
                output_path = settings.output_dir / output_filename

                # Construim lista de fișiere pentru concat
                # Profile-scoped temp directory to prevent cross-profile file collisions
                concat_list_path = settings.base_dir / "temp" / profile_id / f"concat_{project_id}_{variant_idx}.txt"
                concat_list_path.parent.mkdir(parents=True, exist_ok=True)

                with open(concat_list_path, "w") as f:
                    for seg in segments_for_variant:
                        # Extragem segmentul din video sursă
                        segment_output = settings.base_dir / "temp" / profile_id / f"seg_{project_id}_{variant_idx}_{seg['id'][:8]}.mp4"

                        # ============== VOICE MUTING: Construim filtrul audio dacă e necesar ==============
                        audio_filter_args = []
                        logger.info(f"[MUTE DEBUG] Segment {seg['id'][:8]}: mute_source_voice={mute_source_voice}, file in voice_map={seg['file_path'] in voice_segments_by_file}")
                        if mute_source_voice and seg["file_path"] in voice_segments_by_file:
                            voice_segs = voice_segments_by_file[seg["file_path"]]
                            overlapping_mutes = _get_overlapping_voice_mutes(
                                seg["start_time"],
                                seg["end_time"],
                                voice_segs
                            )
                            logger.info(f"[MUTE DEBUG] Found {len(overlapping_mutes)} overlapping voice intervals for segment")
                            if overlapping_mutes:
                                audio_filter = _build_mute_filter(overlapping_mutes)
                                if audio_filter:
                                    # Adăugăm noise cancelling după mute pentru a reduce vocile reziduale
                                    # afftdn: FFT-based denoiser (mai agresiv)
                                    # - nr=25: noise reduction puternică (25dB)
                                    # - nf=-20: noise floor mai ridicat
                                    # - tn=1: track noise (adaptiv)
                                    noise_filter = "afftdn=nr=25:nf=-20:tn=1"
                                    combined_filter = f"{audio_filter},{noise_filter}"
                                    audio_filter_args = ["-af", combined_filter]
                                    logger.info(f"[MUTE DEBUG] Applying audio filter with noise cancelling: {combined_filter}")
                                    logger.info(f"    Applying voice mute filter: {len(overlapping_mutes)} intervals + noise reduction")

                        # Dacă nu avem mute filter dar avem mute_source_voice activat,
                        # aplicăm doar noise cancelling pentru a reduce vocile nedetectate
                        if mute_source_voice and not audio_filter_args:
                            noise_filter = "afftdn=nr=25:nf=-20:tn=1"
                            audio_filter_args = ["-af", noise_filter]
                            logger.info(f"[MUTE DEBUG] Applying noise cancelling only: {noise_filter}")

                        extract_cmd = [
                            "ffmpeg", "-y",
                            "-ss", str(seg["start_time"]),
                            "-i", seg["file_path"],
                            "-t", str(seg["duration"]),
                            "-c:v", "libx264", "-preset", "fast",
                            *audio_filter_args,  # Filtrul audio pentru mute (dacă există)
                            "-c:a", "aac",
                            "-avoid_negative_ts", "make_zero",
                            str(segment_output)
                        ]

                        # Log the FULL FFmpeg command for debugging
                        logger.info(f"[MUTE DEBUG] FFmpeg command: {' '.join(extract_cmd)}")

                        result = subprocess.run(extract_cmd, capture_output=True, text=True)
                        if result.returncode != 0:
                            logger.error(f"FFmpeg extract error: {result.stderr}")
                            continue

                        f.write(f"file '{segment_output}'\n")

                # Concatenăm segmentele
                concat_cmd = [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0",
                    "-i", str(concat_list_path),
                    "-c:v", "libx264", "-preset", "fast",
                    "-c:a", "aac",
                    str(output_path)
                ]

                result = subprocess.run(concat_cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    logger.error(f"FFmpeg concat error: {result.stderr}")
                    continue

                # Verificăm că fișierul a fost creat
                if not output_path.exists():
                    logger.error(f"Output file not created: {output_path}")
                    continue

                # Obținem durata efectivă
                actual_duration = _get_video_duration(output_path)

                # Generăm thumbnail
                thumbnail_path = _generate_thumbnail(output_path)

                # Salvăm în DB
                supabase.table("editai_clips").insert({
                    "project_id": project_id,
                    "profile_id": profile_id,
                    "variant_index": variant_idx,
                    "variant_name": f"variant_{variant_idx}",
                    "raw_video_path": str(output_path),
                    "thumbnail_path": str(thumbnail_path) if thumbnail_path else None,
                    "duration": actual_duration,
                    "is_selected": False,
                    "is_deleted": False,
                    "final_status": "pending"
                }).execute()

                variants_created.append({
                    "variant_index": variant_idx,
                    "path": str(output_path),
                    "duration": actual_duration
                })

                logger.info(f"Created variant {variant_idx} for project {project_id}: {actual_duration:.1f}s")

                # Update progress after variant created
                done_pct = min(10 + int(((variant_idx - start_variant_index + 1) / variant_count) * 80), 95)
                update_generation_progress(
                    project_id,
                    done_pct,
                    f"Varianta {variant_idx} completă ({actual_duration:.1f}s)"
                )

            except Exception as e:
                logger.error(f"Error creating variant {variant_idx}: {e}")
                continue

        # Final progress update
        update_generation_progress(project_id, 95, "Se finalizează...")

        # Actualizăm proiectul
        if variants_created:
            # Numărăm TOATE clipurile din proiect (existente + noi)
            total_clips = supabase.table("editai_clips").select("id", count="exact").eq("project_id", project_id).eq("is_deleted", False).execute()
            total_count = total_clips.count if total_clips.count else len(variants_created)

            supabase.table("editai_projects").update({
                "status": "ready_for_triage",
                "variants_count": total_count,
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            logger.info(f"Added {len(variants_created)} new clips (total: {total_count}) for project {project_id}")
        else:
            supabase.table("editai_projects").update({
                "status": "failed",
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).eq("profile_id", profile_id).execute()
            logger.error(f"Failed to generate any clips for project {project_id}")

    except Exception as e:
        logger.error(f"Error generating from segments for {project_id}: {e}")
        supabase.table("editai_projects").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", project_id).eq("profile_id", profile_id).execute()
    finally:
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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify project ownership
    verify_project_ownership(supabase, project_id, profile.profile_id)

    try:
        query = supabase.table("editai_clips").select("*").eq("project_id", project_id).eq("profile_id", profile.profile_id)
        if not include_deleted:
            query = query.eq("is_deleted", False)
        result = query.order("variant_index").execute()
        return {"clips": result.data}
    except Exception as e:
        logger.error(f"Error listing clips: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all-clips")
async def list_all_clips(profile: ProfileContext = Depends(get_profile_context)):
    """Listează toate clipurile pentru librărie."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Get all clips with project info
        clips_result = supabase.table("editai_clips")\
            .select("*, editai_projects!inner(name)")\
            .eq("is_deleted", False)\
            .eq("profile_id", profile.profile_id)\
            .order("created_at", desc=True)\
            .execute()

        if not clips_result.data:
            return {"clips": []}

        # Get content info for all clips to check subtitles/voiceover
        clip_ids = [c["id"] for c in clips_result.data]
        content_result = supabase.table("editai_clip_content")\
            .select("clip_id, srt_content, tts_audio_path")\
            .in_("clip_id", clip_ids)\
            .execute()

        # Create a map of clip_id -> content
        content_map = {}
        for content in (content_result.data or []):
            content_map[content["clip_id"]] = content

        # Build response with has_subtitles and has_voiceover flags
        clips_with_info = []
        for clip in clips_result.data:
            content = content_map.get(clip["id"], {})
            project_data = clip.get("editai_projects", {})

            # Check if audio was removed (filename contains _noaudio)
            video_path = clip.get("final_video_path") or clip["raw_video_path"]
            has_audio = "_noaudio" not in video_path

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
                "postiz_status": clip.get("postiz_status", "not_sent"),
                "postiz_post_id": clip.get("postiz_post_id"),
                "postiz_scheduled_at": clip.get("postiz_scheduled_at"),
                "has_subtitles": bool(content.get("srt_content")),
                "has_voiceover": bool(content.get("tts_audio_path")),
                "has_audio": has_audio,
            })

        return {"clips": clips_with_info}
    except Exception as e:
        logger.error(f"Error listing all clips: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clips/{clip_id}")
async def get_clip(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Obține detaliile unui clip, inclusiv conținutul asociat."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Clip with profile ownership check
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
        if not clip.data:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Content
        content = supabase.table("editai_clip_content").select("*").eq("clip_id", clip_id).execute()

        return {
            "clip": clip.data,
            "content": content.data[0] if content.data else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting clip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class ClipUpdateRequest(BaseModel):
    variant_name: Optional[str] = None
    is_selected: Optional[bool] = None
    postiz_status: Optional[str] = None
    postiz_post_id: Optional[str] = None
    postiz_scheduled_at: Optional[str] = None


@router.patch("/clips/{clip_id}")
async def update_clip(
    clip_id: str,
    request: ClipUpdateRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează un clip (nume, selecție, status Postiz)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        update_data = {"updated_at": datetime.now().isoformat()}

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

        result = supabase.table("editai_clips").update(update_data).eq("id", clip_id).eq("profile_id", profile.profile_id).execute()

        if result.data:
            clip = result.data[0]
            if request.is_selected is not None:
                _update_project_counts(clip["project_id"])
            return {"status": "updated", "clip": clip}
        raise HTTPException(status_code=404, detail="Clip not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/clips/{clip_id}/select")
async def toggle_clip_selection(
    clip_id: str,
    selected: bool,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Selectează/deselectează un clip pentru procesare ulterioară."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_clips").update({
            "is_selected": selected,
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).eq("profile_id", profile.profile_id).execute()

        if result.data:
            clip = result.data[0]
            # Actualizăm contorul în proiect
            _update_project_counts(clip["project_id"])
            return {"status": "updated", "clip_id": clip_id, "is_selected": selected}
        raise HTTPException(status_code=404, detail="Clip not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip selection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clips/bulk-select")
async def bulk_select_clips(
    clip_ids: List[str],
    selected: bool,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Selectează/deselectează mai multe clipuri odată."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        project_ids = set()
        for clip_id in clip_ids:
            result = supabase.table("editai_clips").update({
                "is_selected": selected,
                "updated_at": datetime.now().isoformat()
            }).eq("id", clip_id).eq("profile_id", profile.profile_id).execute()
            if result.data:
                project_ids.add(result.data[0]["project_id"])

        # Actualizăm contoarele
        for project_id in project_ids:
            _update_project_counts(project_id)

        return {"status": "updated", "count": len(clip_ids), "is_selected": selected}
    except Exception as e:
        logger.error(f"Error bulk selecting clips: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Get clip info
        clip_result = supabase.table("editai_clips").select("*").eq("id", clip_id).eq("profile_id", profile.profile_id).execute()
        if not clip_result.data:
            raise HTTPException(status_code=404, detail="Clip not found")

        clip = clip_result.data[0]
        video_path = Path(clip.get("final_video_path") or clip.get("raw_video_path"))

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
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            logger.error(f"FFmpeg error: {result.stderr}")
            raise HTTPException(status_code=500, detail=f"Failed to remove audio: {result.stderr}")

        # Update database with new video path
        update_data = {
            "raw_video_path": str(output_path),
            "updated_at": datetime.now().isoformat()
        }

        # If there was a final_video_path, clear it since we've modified the source
        if clip.get("final_video_path"):
            update_data["final_video_path"] = str(output_path)

        supabase.table("editai_clips").update(update_data).eq("id", clip_id).execute()

        # Optionally delete old file (keeping it for now as backup)
        # if video_path != output_path and video_path.exists():
        #     video_path.unlink()

        logger.info(f"Audio removed successfully for clip {clip_id}")
        return {
            "status": "success",
            "clip_id": clip_id,
            "video_path": str(output_path),
            "message": "Audio removed successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing audio from clip {clip_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clips/{clip_id}")
async def delete_clip(
    clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Șterge un clip complet (fișiere + DB)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Get clip data first
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
        if clip.data:
            # Delete physical files
            _delete_clip_files(clip.data)
            # Delete from database
            supabase.table("editai_clips").delete().eq("id", clip_id).execute()
            # Also delete associated clip content
            supabase.table("editai_clip_content").delete().eq("clip_id", clip_id).execute()
            logger.info(f"Deleted clip {clip_id} and associated files")

        return {"status": "deleted", "clip_id": clip_id}
    except Exception as e:
        logger.error(f"Error deleting clip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class BulkDeleteRequest(BaseModel):
    clip_ids: List[str]


@router.post("/clips/bulk-delete")
async def bulk_delete_clips(
    request: BulkDeleteRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Șterge mai multe clipuri simultan (fișiere + DB)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    deleted = []
    failed = []

    for clip_id in request.clip_ids:
        try:
            # Get clip data first
            clip = supabase.table("editai_clips").select("*").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
            if clip.data:
                # Delete physical files
                _delete_clip_files(clip.data)
                # Delete from database
                supabase.table("editai_clips").delete().eq("id", clip_id).execute()
                # Also delete associated clip content
                supabase.table("editai_clip_content").delete().eq("clip_id", clip_id).execute()
                deleted.append(clip_id)
                logger.info(f"Bulk delete: deleted clip {clip_id}")
            else:
                failed.append({"id": clip_id, "error": "Not found"})
        except Exception as e:
            logger.error(f"Error deleting clip {clip_id}: {e}")
            failed.append({"id": clip_id, "error": str(e)})

    return {
        "status": "completed",
        "deleted_count": len(deleted),
        "deleted": deleted,
        "failed_count": len(failed),
        "failed": failed
    }


# ============== CLIP CONTENT (TTS + SUBTITLES) ==============

@router.put("/clips/{clip_id}/content")
async def update_clip_content(
    clip_id: str,
    content: ClipContentUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Actualizează conținutul asociat unui clip (TTS text, SRT, stil)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Verificăm că clipul există și aparține profilului
        clip = supabase.table("editai_clips").select("id").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
        if not clip.data:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Pregătim datele pentru upsert
        content_data = {
            "clip_id": clip_id,
            "updated_at": datetime.now().isoformat()
        }
        if content.tts_text is not None:
            content_data["tts_text"] = content.tts_text
        if content.srt_content is not None:
            content_data["srt_content"] = sanitize_srt_text(content.srt_content)
        if content.subtitle_settings is not None:
            content_data["subtitle_settings"] = content.subtitle_settings

        # Upsert (insert sau update)
        result = supabase.table("editai_clip_content").upsert(
            content_data,
            on_conflict="clip_id"
        ).execute()

        return {"status": "updated", "content": result.data[0] if result.data else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating clip content: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clips/{clip_id}/content/copy-from/{source_clip_id}")
async def copy_content_from_clip(
    clip_id: str,
    source_clip_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Copiază conținutul (TTS, SRT, stil) de la un alt clip."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Verify ownership of both clips
        dest_clip = supabase.table("editai_clips").select("id").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
        if not dest_clip.data:
            raise HTTPException(status_code=404, detail="Destination clip not found")

        src_clip = supabase.table("editai_clips").select("id").eq("id", source_clip_id).eq("profile_id", profile.profile_id).single().execute()
        if not src_clip.data:
            raise HTTPException(status_code=404, detail="Source clip not found")

        # Obținem conținutul sursă
        source = supabase.table("editai_clip_content").select("*").eq("clip_id", source_clip_id).single().execute()
        if not source.data:
            raise HTTPException(status_code=404, detail="Source content not found")

        # Copiem la destinație
        content_data = {
            "clip_id": clip_id,
            "tts_text": source.data.get("tts_text"),
            "tts_voice_id": source.data.get("tts_voice_id"),
            "srt_content": source.data.get("srt_content"),
            "subtitle_settings": source.data.get("subtitle_settings"),
            "updated_at": datetime.now().isoformat()
        }

        result = supabase.table("editai_clip_content").upsert(
            content_data,
            on_conflict="clip_id"
        ).execute()

        return {"status": "copied", "content": result.data[0] if result.data else None}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error copying content: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============== EXPORT PRESETS ==============

@router.get("/export-presets")
async def list_export_presets():
    """Listează toate preset-urile de export disponibile."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_export_presets").select("*").order("is_default", desc=True).execute()
        return {"presets": result.data}
    except Exception as e:
        logger.error(f"Error listing presets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============== MAINTENANCE ==============

@router.post("/maintenance/cleanup-temp")
async def cleanup_temp_files(max_age_hours: int = 24):
    """
    Cleanup orphaned temp files older than specified hours.
    Useful for manual maintenance or scheduled cleanup.
    """
    deleted = cleanup_orphaned_temp_files(max_age_hours)
    return {"status": "completed", "deleted_files": deleted}


# ============== FINAL RENDER ==============

@router.post("/clips/{clip_id}/render")
async def render_final_clip(
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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Parse boolean strings (HTML forms send strings)
    enable_denoise_bool = enable_denoise.lower() in ("true", "1", "yes", "on")
    enable_sharpen_bool = enable_sharpen.lower() in ("true", "1", "yes", "on")
    enable_color_bool = enable_color.lower() in ("true", "1", "yes", "on")
    enable_glow_bool = enable_glow.lower() in ("true", "1", "yes", "on")
    adaptive_sizing_bool = adaptive_sizing.lower() in ("true", "1", "yes", "on")

    try:
        # Obținem clipul și conținutul
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).eq("profile_id", profile.profile_id).single().execute()
        if not clip.data:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Reject immediately if a task is already running for this project (STAB-03)
        render_project_id = clip.data.get("project_id")
        if render_project_id and is_project_locked(render_project_id):
            raise HTTPException(
                status_code=409,
                detail="Project is currently being processed. Wait for the current job to finish before rendering."
            )

        content = supabase.table("editai_clip_content").select("*").eq("clip_id", clip_id).execute()

        # Obținem preset-ul
        preset = supabase.table("editai_export_presets").select("*").eq("name", preset_name).single().execute()
        if not preset.data:
            raise HTTPException(status_code=404, detail=f"Preset '{preset_name}' not found")

        # Actualizăm statusul
        supabase.table("editai_clips").update({
            "final_status": "processing",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).execute()

        # Lansăm renderul în background
        background_tasks.add_task(
            _render_final_clip_task,
            clip_id=clip_id,
            project_id=clip.data["project_id"],
            profile_id=profile.profile_id,
            clip_data=clip.data,
            content_data=content.data[0] if content.data else None,
            preset_data=preset.data,
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
    except Exception as e:
        logger.error(f"Error starting render: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

    supabase = get_supabase()
    if not supabase:
        logger.error(f"[Profile {profile_id}] Supabase not available for render")
        return

    settings = get_settings()

    # Acquire project lock to prevent concurrent operations on same project
    lock = get_project_lock(project_id) if project_id else None
    if lock and not lock.acquire(timeout=300):  # Wait up to 5 min for renders
        logger.warning(f"Could not acquire lock for project {project_id} within timeout")
        supabase.table("editai_clips").update({
            "final_status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).eq("profile_id", profile_id).execute()
        return

    # Initialize temp file paths for cleanup in finally block
    audio_path = None
    srt_path = None
    adjusted_video_path = None
    tts_timestamps = None

    # Profile-scoped temp directory to prevent cross-profile file collisions
    temp_dir = settings.base_dir / "temp" / profile_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        raw_video_path = Path(clip_data["raw_video_path"])
        if not raw_video_path.exists():
            raise FileNotFoundError(f"Raw video not found: {raw_video_path}")

        # Directorul pentru output
        output_dir = settings.output_dir / "finals"
        output_dir.mkdir(parents=True, exist_ok=True)

        video_duration = _get_video_duration(raw_video_path)
        audio_duration = None
        final_video_path = raw_video_path  # Default: use raw video

        # 1. Generăm TTS dacă avem text (cu silence removal pentru dinamism)
        if content_data and content_data.get("tts_text"):
            # Use new TTS service with timestamps support
            from app.services.tts.elevenlabs import ElevenLabsTTSService
            from app.config import get_settings

            audio_path = temp_dir / f"tts_{clip_id}.mp3"
            tts_timestamps = None
            silence_stats = None

            try:
                # Initialize TTS service with user-selected model (profile_id enables multi-account failover)
                tts_service = ElevenLabsTTSService(
                    output_dir=temp_dir,
                    model_id=elevenlabs_model,
                    profile_id=profile_id
                )

                # Generate with timestamps for downstream subtitle sync
                tts_result, tts_timestamps = await tts_service.generate_audio_with_timestamps(
                    text=content_data["tts_text"],
                    voice_id=tts_service._voice_id,
                    output_path=audio_path,
                    model_id=elevenlabs_model
                )
                audio_path = tts_result.audio_path
                logger.info(f"TTS with timestamps generated for clip {clip_id}: {tts_result.duration_seconds:.1f}s, model={elevenlabs_model}")

                # Apply silence removal to timestamped audio
                try:
                    from app.services.silence_remover import SilenceRemover
                    remover = SilenceRemover(min_silence_duration=0.25, padding=0.06)
                    trimmed_path = temp_dir / f"tts_trimmed_{clip_id}.mp3"
                    silence_result = remover.remove_silence(audio_path, trimmed_path)
                    audio_path = trimmed_path
                    silence_stats = {
                        'original_duration': silence_result.original_duration,
                        'removed_duration': silence_result.removed_duration
                    }
                    logger.info(f"Silence removal: {silence_result.original_duration:.1f}s -> {silence_result.new_duration:.1f}s")
                except Exception as e:
                    logger.warning(f"Silence removal failed, using raw audio: {e}")

            except Exception as e:
                # Fallback to legacy TTS without timestamps
                logger.warning(f"Timestamps generation failed, falling back to standard TTS: {e}")
                from app.services.elevenlabs_tts import get_elevenlabs_tts
                tts = get_elevenlabs_tts()
                audio_path, silence_stats = await tts.generate_audio_trimmed(
                    text=content_data["tts_text"],
                    output_path=audio_path,
                    remove_silence=True,
                    min_silence_duration=0.25,
                    padding=0.06
                )

            audio_duration = _get_audio_duration(audio_path)

            # Persist timestamps and model to Supabase for Phase 13 subtitle generation
            if tts_timestamps:
                try:
                    supabase.table("editai_clip_content").update({
                        "tts_timestamps": tts_timestamps,
                        "tts_model": elevenlabs_model
                    }).eq("clip_id", clip_id).execute()
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
                _srt_for_lib = _gen_srt(tts_timestamps) if tts_timestamps else None
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
                tts_persist_dir = settings.output_dir / "tts" / profile_id
                tts_persist_dir.mkdir(parents=True, exist_ok=True)
                tts_persist_path = tts_persist_dir / f"clip_{clip_id}.mp3"
                shutil.copy2(str(audio_path), str(tts_persist_path))
                supabase.table("editai_clip_content").update({
                    "tts_audio_path": str(tts_persist_path)
                }).eq("clip_id", clip_id).execute()
                logger.info(f"TTS audio persisted for clip {clip_id}: {tts_persist_path}")
            except Exception as e:
                tts_persist_failed = True
                logger.warning(f"TTS PERSIST FAILED for clip {clip_id}: audio was generated but could not be saved for download: {e}")

        # 2. SYNC: Ajustăm video-ul la durata audio-ului
        if audio_duration and audio_duration > 0:
            duration_diff = video_duration - audio_duration

            if abs(duration_diff) < 0.5:
                # Diferență neglijabilă, folosim video-ul original
                logger.info(f"Video sync OK: video={video_duration:.1f}s, audio={audio_duration:.1f}s")
                final_video_path = raw_video_path

            elif duration_diff > 0:
                # VIDEO MAI LUNG: Trimează video la durata audio
                logger.info(f"Video > Audio ({video_duration:.1f}s > {audio_duration:.1f}s): trimming video")
                adjusted_video_path = temp_dir / f"trimmed_{clip_id}.mp4"
                _trim_video_to_duration(raw_video_path, adjusted_video_path, audio_duration)
                final_video_path = adjusted_video_path

            else:
                # VIDEO MAI SCURT: Extinde cu segmente adiționale
                needed_duration = audio_duration - video_duration
                logger.info(f"Video < Audio ({video_duration:.1f}s < {audio_duration:.1f}s): extending by {needed_duration:.1f}s")

                # Încercăm să extindem cu segmente din proiect
                adjusted_video_path = temp_dir / f"extended_{clip_id}.mp4"
                extended = _extend_video_with_segments(
                    base_video=raw_video_path,
                    target_duration=audio_duration,
                    project_id=project_id,
                    output_path=adjusted_video_path,
                    supabase=supabase,
                    profile_id=profile_id
                )

                if extended and adjusted_video_path.exists():
                    final_video_path = adjusted_video_path
                else:
                    # Fallback: loop video pentru a umple gap-ul
                    logger.warning(f"Could not extend with segments, using loop fallback")
                    _loop_video_to_duration(raw_video_path, adjusted_video_path, audio_duration)
                    if adjusted_video_path.exists():
                        final_video_path = adjusted_video_path

        # 3. Generate SRT - user-provided takes priority, then auto-generate from TTS timestamps
        if content_data and content_data.get("srt_content"):
            srt_path = temp_dir / f"srt_{clip_id}.srt"
            with open(srt_path, "w", encoding="utf-8") as f:
                srt_text = sanitize_srt_text(content_data["srt_content"])
                f.write(srt_text)
            logger.info(f"Using user-provided SRT for clip {clip_id}")
        elif tts_timestamps:
            # Auto-generate SRT from TTS character-level timestamps (Phase 13)
            try:
                # Check SRT cache first
                from app.services.tts_cache import srt_cache_lookup, srt_cache_store
                _tts_voice = content_data.get("tts_voice_id", "")
                _srt_cache_key = {"text": content_data["tts_text"], "voice_id": _tts_voice, "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
                cached_srt = srt_cache_lookup(_srt_cache_key)
                if cached_srt:
                    auto_srt = cached_srt
                else:
                    auto_srt = generate_srt_from_timestamps(tts_timestamps)
                    if auto_srt:
                        srt_cache_store(_srt_cache_key, auto_srt)

                if auto_srt:
                    srt_path = temp_dir / f"srt_{clip_id}.srt"
                    with open(srt_path, "w", encoding="utf-8") as f:
                        f.write(auto_srt)
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

        # 4. Randăm cu FFmpeg folosind preset-ul
        output_path = output_dir / f"final_{clip_id}_{preset_data['name']}.mp4"

        _render_with_preset(
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

        # Actualizăm clipul
        supabase.table("editai_clips").update({
            "final_video_path": str(output_path),
            "final_status": "completed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).eq("profile_id", profile_id).execute()

        # Salvăm exportul
        supabase.table("editai_exports").insert({
            "clip_id": clip_id,
            "preset_name": preset_data["name"],
            "output_path": str(output_path),
            "file_size": output_path.stat().st_size,
            "status": "completed"
        }).execute()

        # Actualizăm contorul din proiect
        _update_project_counts(clip_data["project_id"])

        logger.info(f"Rendered final clip {clip_id} -> {output_path}")

    except Exception as e:
        logger.error(f"Error rendering clip {clip_id}: {e}")
        supabase.table("editai_clips").update({
            "final_status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).eq("profile_id", profile_id).execute()
    finally:
        # Always cleanup temp files (even on error)
        try:
            if audio_path and Path(audio_path).exists():
                Path(audio_path).unlink()
                logger.debug(f"Cleaned up temp audio: {audio_path}")
            if srt_path and Path(srt_path).exists():
                Path(srt_path).unlink()
                logger.debug(f"Cleaned up temp srt: {srt_path}")
            if adjusted_video_path and Path(adjusted_video_path).exists():
                Path(adjusted_video_path).unlink()
                logger.debug(f"Cleaned up adjusted video: {adjusted_video_path}")
        except Exception as cleanup_err:
            logger.warning(f"Failed to cleanup temp files: {cleanup_err}")

        # Always release and cleanup the lock
        if lock:
            lock.release()
            if project_id:
                cleanup_project_lock(project_id)
            logger.debug(f"Released and cleaned up render lock for project {project_id}")


class BulkRenderRequest(BaseModel):
    clip_ids: List[str]
    preset_name: str = "instagram_reels"


@router.post("/clips/bulk-render")
async def bulk_render_clips(
    background_tasks: BackgroundTasks,
    request: BulkRenderRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Randează mai multe clipuri selectate cu același preset."""
    for clip_id in request.clip_ids:
        background_tasks.add_task(
            _start_render_for_clip,
            clip_id=clip_id,
            preset_name=request.preset_name
        )

    return {
        "status": "processing",
        "count": len(request.clip_ids),
        "preset": request.preset_name,
        "message": f"Rendering {len(request.clip_ids)} clips..."
    }


async def _start_render_for_clip(clip_id: str, preset_name: str):
    """Helper pentru bulk render."""
    supabase = get_supabase()
    if not supabase:
        return

    try:
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).single().execute()
        content = supabase.table("editai_clip_content").select("*").eq("clip_id", clip_id).execute()
        preset = supabase.table("editai_export_presets").select("*").eq("name", preset_name).single().execute()

        if clip.data and preset.data:
            await _render_final_clip_task(
                clip_id=clip_id,
                project_id=clip.data["project_id"],
                profile_id=clip.data["profile_id"],
                clip_data=clip.data,
                content_data=content.data[0] if content.data else None,
                preset_data=preset.data
            )
    except Exception as e:
        logger.error(f"Error in bulk render for {clip_id}: {e}")


# ============== HELPER FUNCTIONS ==============

def _sanitize_filename(filename: str) -> str:
    """Sanitizează numele fișierului."""
    import re
    if not filename:
        return "unnamed"
    safe_name = Path(filename).name
    safe_name = re.sub(r'[^\w\-_\.]', '_', safe_name)
    if len(safe_name) > 100:
        safe_name = safe_name[:100]
    return safe_name or "unnamed"


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
        result = subprocess.run(cmd, capture_output=True, text=True)
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
        logger.warning(f"Failed to get video info: {e}")
    return {"width": 1080, "height": 1920, "duration": 0}


def _get_video_duration(video_path: Path) -> float:
    """Obține durata video-ului."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return float(result.stdout.strip())
    except Exception:
        pass
    return 0.0


def _generate_thumbnail(video_path: Path) -> Optional[Path]:
    """Generează thumbnail pentru un video."""
    try:
        settings = get_settings()
        thumb_dir = settings.output_dir / "thumbnails"
        thumb_dir.mkdir(parents=True, exist_ok=True)

        thumb_path = thumb_dir / f"{video_path.stem}_thumb.jpg"

        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-ss", "1",  # Frame la secunda 1
            "-vframes", "1",
            "-vf", "scale=320:-1",  # Width 320px, height auto
            "-q:v", "3",
            str(thumb_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
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


def _update_project_counts(project_id: str):
    """Actualizează contoarele de clipuri în proiect."""
    supabase = get_supabase()
    if not supabase:
        return

    try:
        # Count total clips (not deleted)
        clips = supabase.table("editai_clips").select("id, is_selected, final_status").eq("project_id", project_id).eq("is_deleted", False).execute()

        total = len(clips.data) if clips.data else 0
        selected = len([c for c in (clips.data or []) if c.get("is_selected")])
        exported = len([c for c in (clips.data or []) if c.get("final_status") == "completed"])

        supabase.table("editai_projects").update({
            "variants_count": total,
            "selected_count": selected,
            "exported_count": exported,
            "updated_at": datetime.now().isoformat()
        }).eq("id", project_id).execute()
    except Exception as e:
        logger.warning(f"Failed to update project counts: {e}")


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
        result = subprocess.run(cmd, capture_output=True, text=True)
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
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-t", str(target_duration),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
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
        # Folosim stream_loop pentru looping și -t pentru a tăia la durată
        cmd = [
            "ffmpeg", "-y",
            "-stream_loop", "-1",  # Loop infinit
            "-i", str(input_path),
            "-t", str(target_duration),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(output_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
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
    supabase,
    profile_id: Optional[str] = "default"
) -> bool:
    """
    Extinde video-ul cu segmente adiționale din proiect pentru a atinge durata țintă.

    Algoritm:
    1. Obține segmentele disponibile din proiect
    2. Calculează cât mai avem nevoie
    3. Extrage și concatenează segmente până atingem target_duration
    """
    try:
        current_duration = _get_video_duration(base_video)
        needed_duration = target_duration - current_duration

        if needed_duration <= 0:
            return False

        # Obținem segmentele proiectului
        project_segments = supabase.table("editai_project_segments")\
            .select("*, editai_segments(*, editai_source_videos(file_path))")\
            .eq("project_id", project_id)\
            .order("sequence_order")\
            .execute()

        if not project_segments.data:
            logger.warning(f"No segments found for project {project_id}")
            return False

        # Pregătim lista de segmente
        available_segments = []
        for ps in project_segments.data:
            seg = ps.get("editai_segments", {})
            if not seg:
                continue

            source_video = seg.get("editai_source_videos", {})
            source_path = source_video.get("file_path") if source_video else None

            if source_path and Path(source_path).exists():
                available_segments.append({
                    "source_path": source_path,
                    "start_time": seg["start_time"],
                    "end_time": seg["end_time"],
                    "duration": seg["end_time"] - seg["start_time"]
                })

        if not available_segments:
            logger.warning("No valid segments available for extension")
            return False

        # Selectăm segmente pentru a umple gap-ul
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
        temp_dir = settings.base_dir / "temp" / profile_id / f"extend_{project_id[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Extragem segmentele adiționale
            segment_files = [base_video]  # Start with base video

            for idx, seg in enumerate(selected_segments):
                seg_output = temp_dir / f"ext_seg_{idx:03d}.mp4"

                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg["start_time"]),
                    "-i", seg["source_path"],
                    "-t", str(seg["duration"]),
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-an",  # No audio - will be replaced with TTS
                    "-pix_fmt", "yuv420p",
                    str(seg_output)
                ]

                result = subprocess.run(cmd, capture_output=True, text=True)
                if result.returncode == 0 and seg_output.exists():
                    segment_files.append(seg_output)

            if len(segment_files) <= 1:
                logger.warning("No additional segments extracted")
                return False

            # Creăm concat list
            concat_list = temp_dir / "concat.txt"
            with open(concat_list, "w") as f:
                for sf in segment_files:
                    safe_path = str(sf).replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")

            # Concatenăm și trimăm la durata exactă
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list),
                "-t", str(target_duration),  # Trim to exact duration
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-an",  # No audio
                "-movflags", "+faststart",
                str(output_path)
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

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


def _hex_to_ass_color(hex_color: str) -> str:
    """Convertește HEX (#RRGGBB) în format ASS (&HBBGGRR&). ASS folosește BGR!"""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        r, g, b = hex_color[0:2], hex_color[2:4], hex_color[4:6]
        return f"&H{b}{g}{r}&".upper()
    return "&HFFFFFF&"

def _render_with_preset(
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
    saturation: float = 1.0
):
    """
    Randează video-ul final cu preset optimizat pentru social media.

    Video enhancement filters (Phase 9) are applied AFTER scale/crop, BEFORE subtitles.
    Filter order is locked: denoise -> sharpen -> color (don't sharpen noise).
    """
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
            video_width=preset.get('width', 1080),
            video_height=preset.get('height', 1920)
        )
        filters.append(subtitles_filter)
        logger.info(f"Added subtitle filter with enhancement settings")

    # Apply filters
    if filters:
        cmd.extend(["-vf", ",".join(filters)])

    # Audio normalization (two-pass loudnorm)
    audio_filters = []

    if has_audio and audio_path:  # Only normalize real audio, not silent
        # Get encoding preset to check if normalization is enabled
        preset_name = preset.get("name", "Generic")
        platform_map = {
            "TikTok": "tiktok",
            "Instagram Reels": "reels",
            "YouTube Shorts": "youtube_shorts",
            "Generic": "generic"
        }
        platform_key = platform_map.get(preset_name, "generic")
        encoding_preset = get_preset(platform_key)

        if encoding_preset.normalize_audio:
            logger.info(f"Performing two-pass audio normalization (target: {encoding_preset.target_lufs} LUFS)")

            # First pass: Measure loudness
            measurement = measure_loudness(
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

    # Get encoding preset parameters
    # Map database preset name to platform key
    preset_name = preset.get("name", "Generic")
    platform_map = {
        "TikTok": "tiktok",
        "Instagram Reels": "reels",
        "YouTube Shorts": "youtube_shorts",
        "Generic": "generic"
    }
    platform_key = platform_map.get(preset_name, "generic")

    # Get EncodingPreset object and generate FFmpeg params
    encoding_preset = get_preset(platform_key)
    logger.info(f"Using encoding preset: {encoding_preset.name} (platform: {encoding_preset.platform})")

    # Get encoding parameters (use_gpu=False for CPU encoding)
    encoding_params = encoding_preset.to_ffmpeg_params(use_gpu=False)

    # Extract audio bitrate from encoding params for comparison
    preset_audio_bitrate = encoding_preset.audio_bitrate

    # Override audio bitrate if database preset has higher value
    db_audio_bitrate = preset.get("audio_bitrate", "192k")
    if db_audio_bitrate and db_audio_bitrate != preset_audio_bitrate:
        # Parse bitrates for comparison (e.g., "320k" -> 320)
        db_bitrate_val = int(db_audio_bitrate.replace("k", ""))
        preset_bitrate_val = int(preset_audio_bitrate.replace("k", ""))
        if db_bitrate_val > preset_bitrate_val:
            logger.info(f"Database audio bitrate {db_audio_bitrate} higher than preset {preset_audio_bitrate}, using database value")
            # Update audio bitrate in encoding params
            for i, param in enumerate(encoding_params):
                if param == "-b:a":
                    encoding_params[i+1] = db_audio_bitrate
                    break

    # Add FPS setting (from database preset)
    cmd.extend(["-r", str(preset.get("fps", 30))])

    # Add encoding parameters from EncodingPreset
    cmd.extend(encoding_params)

    # Audio mapping
    if audio_path and audio_path.exists():
        cmd.extend([
            "-map", "0:v:0",
            "-map", "1:a:0"
        ])
    else:
        # Silent audio - map video from 0, audio from lavfi 1
        cmd.extend([
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest"
        ])

    # Extra flags for social media compatibility
    extra_flags = preset.get("extra_flags", "-movflags +faststart")
    if extra_flags:
        cmd.extend(extra_flags.split())

    # Output
    cmd.append(str(output_path))

    logger.info(f"Rendering with command: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg render failed: {result.stderr}")

    logger.info(f"Rendered: {output_path}")
