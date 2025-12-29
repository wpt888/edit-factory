"""
EditAI Library & Workflow Routes
Gestionează proiecte, clipuri, asocieri și exporturi pentru noul workflow.
"""
import uuid
import shutil
import subprocess
import json
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings

import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/library", tags=["library"])

# Supabase client pentru DB
_supabase_client = None

def get_supabase():
    """Get Supabase client with lazy initialization."""
    global _supabase_client
    if _supabase_client is None:
        try:
            from supabase import create_client
            settings = get_settings()
            if settings.supabase_url and settings.supabase_key:
                _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
                logger.info("Supabase client initialized for library")
            else:
                logger.warning("Supabase credentials not configured")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase: {e}")
    return _supabase_client


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
    return FileResponse(path=str(resolved_path), media_type=media_type or "application/octet-stream", filename=resolved_path.name if download else None)

# ============== PROJECTS ==============

@router.post("/projects", response_model=ProjectResponse)
async def create_project(project: ProjectCreate):
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
            "status": "draft"
        }).execute()

        if result.data:
            proj = result.data[0]
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
async def list_projects(status: Optional[str] = None):
    """Listează toate proiectele."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        query = supabase.table("editai_projects").select("*").order("created_at", desc=True)
        if status:
            query = query.eq("status", status)
        result = query.execute()
        return {"projects": result.data}
    except Exception as e:
        logger.error(f"Error listing projects: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    """Obține detaliile unui proiect."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_projects").select("*").eq("id", project_id).single().execute()
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
    except Exception as e:
        logger.error(f"Error getting project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, updates: dict):
    """Actualizează un proiect."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    allowed_fields = ["name", "description", "status", "target_duration", "context_text"]
    filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}
    filtered_updates["updated_at"] = datetime.now().isoformat()

    try:
        result = supabase.table("editai_projects").update(filtered_updates).eq("id", project_id).execute()
        if result.data:
            return {"status": "updated", "project": result.data[0]}
        raise HTTPException(status_code=404, detail="Project not found")
    except Exception as e:
        logger.error(f"Error updating project: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    """Șterge un proiect și toate clipurile asociate."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Ștergem mai întâi clipurile (CASCADE ar trebui să facă asta automat)
        # Dar ștergem și fișierele fizice
        clips = supabase.table("editai_clips").select("*").eq("project_id", project_id).execute()
        for clip in clips.data or []:
            _delete_clip_files(clip)

        # Ștergem proiectul
        result = supabase.table("editai_projects").delete().eq("id", project_id).execute()
        return {"status": "deleted", "project_id": project_id}
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
    variant_count: int = Form(default=3)
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

    # Verificăm că proiectul există
    project = supabase.table("editai_projects").select("*").eq("id", project_id).single().execute()
    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")

    # Determine video source: uploaded file or local path
    if video and video.filename:
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
    }).eq("id", project_id).execute()

    # Limitări
    variant_count = max(1, min(10, variant_count))

    # Lansăm generarea în background
    background_tasks.add_task(
        _generate_raw_clips_task,
        project_id=project_id,
        video_path=str(final_video_path),
        variant_count=variant_count,
        target_duration=project.data["target_duration"],
        context_text=project.data.get("context_text")
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
    context_text: Optional[str]
):
    """Task pentru generarea clipurilor raw în background."""
    from app.services.video_processor import VideoProcessorService

    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not available for raw clips generation")
        return

    settings = get_settings()

    try:
        processor = VideoProcessorService(
            input_dir=settings.input_dir,
            output_dir=settings.output_dir,
            temp_dir=settings.base_dir / "temp"
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
            }).eq("id", project_id).execute()

            logger.info(f"Generated {len(variants)} raw clips for project {project_id}")
        else:
            # Eroare
            supabase.table("editai_projects").update({
                "status": "failed",
                "updated_at": datetime.now().isoformat()
            }).eq("id", project_id).execute()
            logger.error(f"Failed to generate clips for project {project_id}: {result.get('error')}")

    except Exception as e:
        logger.error(f"Error generating raw clips for {project_id}: {e}")
        supabase.table("editai_projects").update({
            "status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", project_id).execute()


# ============== CLIPS (LIBRARY) ==============

@router.get("/projects/{project_id}/clips")
async def list_project_clips(project_id: str, include_deleted: bool = False):
    """Listează toate clipurile unui proiect (pentru galerie/triaj)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        query = supabase.table("editai_clips").select("*").eq("project_id", project_id)
        if not include_deleted:
            query = query.eq("is_deleted", False)
        result = query.order("variant_index").execute()
        return {"clips": result.data}
    except Exception as e:
        logger.error(f"Error listing clips: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clips/{clip_id}")
async def get_clip(clip_id: str):
    """Obține detaliile unui clip, inclusiv conținutul asociat."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Clip
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).single().execute()
        if not clip.data:
            raise HTTPException(status_code=404, detail="Clip not found")

        # Content
        content = supabase.table("editai_clip_content").select("*").eq("clip_id", clip_id).execute()

        return {
            "clip": clip.data,
            "content": content.data[0] if content.data else None
        }
    except Exception as e:
        logger.error(f"Error getting clip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/clips/{clip_id}/select")
async def toggle_clip_selection(clip_id: str, selected: bool):
    """Selectează/deselectează un clip pentru procesare ulterioară."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = supabase.table("editai_clips").update({
            "is_selected": selected,
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).execute()

        if result.data:
            clip = result.data[0]
            # Actualizăm contorul în proiect
            _update_project_counts(clip["project_id"])
            return {"status": "updated", "clip_id": clip_id, "is_selected": selected}
        raise HTTPException(status_code=404, detail="Clip not found")
    except Exception as e:
        logger.error(f"Error updating clip selection: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clips/bulk-select")
async def bulk_select_clips(clip_ids: List[str], selected: bool):
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
            }).eq("id", clip_id).execute()
            if result.data:
                project_ids.add(result.data[0]["project_id"])

        # Actualizăm contoarele
        for project_id in project_ids:
            _update_project_counts(project_id)

        return {"status": "updated", "count": len(clip_ids), "is_selected": selected}
    except Exception as e:
        logger.error(f"Error bulk selecting clips: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/clips/{clip_id}")
async def delete_clip(clip_id: str, hard_delete: bool = False):
    """Șterge un clip (soft delete sau hard delete)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        if hard_delete:
            # Ștergem fișierele și din DB
            clip = supabase.table("editai_clips").select("*").eq("id", clip_id).single().execute()
            if clip.data:
                _delete_clip_files(clip.data)
                supabase.table("editai_clips").delete().eq("id", clip_id).execute()
        else:
            # Soft delete
            supabase.table("editai_clips").update({
                "is_deleted": True,
                "is_selected": False,
                "updated_at": datetime.now().isoformat()
            }).eq("id", clip_id).execute()

        return {"status": "deleted", "clip_id": clip_id}
    except Exception as e:
        logger.error(f"Error deleting clip: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============== CLIP CONTENT (TTS + SUBTITLES) ==============

@router.put("/clips/{clip_id}/content")
async def update_clip_content(clip_id: str, content: ClipContentUpdate):
    """Actualizează conținutul asociat unui clip (TTS text, SRT, stil)."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Verificăm că clipul există
        clip = supabase.table("editai_clips").select("id").eq("id", clip_id).single().execute()
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
            content_data["srt_content"] = content.srt_content
        if content.subtitle_settings is not None:
            content_data["subtitle_settings"] = content.subtitle_settings

        # Upsert (insert sau update)
        result = supabase.table("editai_clip_content").upsert(
            content_data,
            on_conflict="clip_id"
        ).execute()

        return {"status": "updated", "content": result.data[0] if result.data else None}
    except Exception as e:
        logger.error(f"Error updating clip content: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/clips/{clip_id}/content/copy-from/{source_clip_id}")
async def copy_content_from_clip(clip_id: str, source_clip_id: str):
    """Copiază conținutul (TTS, SRT, stil) de la un alt clip."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
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


# ============== FINAL RENDER ==============

@router.post("/clips/{clip_id}/render")
async def render_final_clip(
    background_tasks: BackgroundTasks,
    clip_id: str,
    preset_name: str = Form(default="instagram_reels")
):
    """
    Randează clipul final cu TTS și subtitrări.
    Folosește preset-ul de export specificat pentru encoding optimizat.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        # Obținem clipul și conținutul
        clip = supabase.table("editai_clips").select("*").eq("id", clip_id).single().execute()
        if not clip.data:
            raise HTTPException(status_code=404, detail="Clip not found")

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
            clip_data=clip.data,
            content_data=content.data[0] if content.data else None,
            preset_data=preset.data
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
    clip_data: dict,
    content_data: Optional[dict],
    preset_data: dict
):
    """Task pentru randarea finală în background."""
    from app.services.elevenlabs_tts import get_elevenlabs_tts

    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase not available for render")
        return

    settings = get_settings()

    try:
        raw_video_path = Path(clip_data["raw_video_path"])
        if not raw_video_path.exists():
            raise FileNotFoundError(f"Raw video not found: {raw_video_path}")

        # Directorul pentru output
        output_dir = settings.output_dir / "finals"
        output_dir.mkdir(parents=True, exist_ok=True)

        temp_dir = settings.base_dir / "temp"
        temp_dir.mkdir(parents=True, exist_ok=True)

        # 1. Generăm TTS dacă avem text
        audio_path = None
        if content_data and content_data.get("tts_text"):
            tts = get_elevenlabs_tts()
            audio_path = temp_dir / f"tts_{clip_id}.mp3"

            # Generăm cu silence removal
            audio_path, _ = tts.generate_audio_trimmed(
                text=content_data["tts_text"],
                output_path=audio_path,
                remove_silence=True
            )
            logger.info(f"Generated TTS for clip {clip_id}")

        # 2. Generăm SRT temporar dacă avem conținut
        srt_path = None
        if content_data and content_data.get("srt_content"):
            srt_path = temp_dir / f"srt_{clip_id}.srt"
            with open(srt_path, "w", encoding="utf-8") as f:
                f.write(content_data["srt_content"])

        # 3. Randăm cu FFmpeg folosind preset-ul
        output_path = output_dir / f"final_{clip_id}_{preset_data['name']}.mp4"

        _render_with_preset(
            video_path=raw_video_path,
            audio_path=audio_path,
            srt_path=srt_path,
            subtitle_settings=content_data.get("subtitle_settings") if content_data else None,
            preset=preset_data,
            output_path=output_path
        )

        # Actualizăm clipul
        supabase.table("editai_clips").update({
            "final_video_path": str(output_path),
            "final_status": "completed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).execute()

        # Salvăm exportul
        supabase.table("editai_exports").insert({
            "clip_id": clip_id,
            "preset_id": preset_data["id"],
            "output_path": str(output_path),
            "file_size_bytes": output_path.stat().st_size,
            "status": "completed",
            "completed_at": datetime.now().isoformat()
        }).execute()

        # Actualizăm contorul din proiect
        _update_project_counts(clip_data["project_id"])

        # Cleanup temp files
        if audio_path and audio_path.exists():
            audio_path.unlink()
        if srt_path and srt_path.exists():
            srt_path.unlink()

        logger.info(f"Rendered final clip {clip_id} -> {output_path}")

    except Exception as e:
        logger.error(f"Error rendering clip {clip_id}: {e}")
        supabase.table("editai_clips").update({
            "final_status": "failed",
            "updated_at": datetime.now().isoformat()
        }).eq("id", clip_id).execute()


@router.post("/clips/bulk-render")
async def bulk_render_clips(
    background_tasks: BackgroundTasks,
    clip_ids: List[str],
    preset_name: str = "instagram_reels"
):
    """Randează mai multe clipuri selectate cu același preset."""
    for clip_id in clip_ids:
        background_tasks.add_task(
            _start_render_for_clip,
            clip_id=clip_id,
            preset_name=preset_name
        )

    return {
        "status": "processing",
        "count": len(clip_ids),
        "preset": preset_name,
        "message": f"Rendering {len(clip_ids)} clips..."
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
    except:
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
            except:
                pass


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
    output_path: Path
):
    """
    Randează video-ul final cu preset optimizat pentru social media.
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

    # Add subtitles if available
    if srt_path and srt_path.exists() and subtitle_settings:
        # Build ASS style from settings
        font_size = subtitle_settings.get("fontSize", 48)
        font_family = subtitle_settings.get("fontFamily", "Montserrat").split(",")[0].strip()
        text_color = _hex_to_ass_color(subtitle_settings.get("textColor", "#FFFFFF"))
        outline_color = _hex_to_ass_color(subtitle_settings.get("outlineColor", "#000000"))
        outline_width = subtitle_settings.get("outlineWidth", 3)
        position_y = subtitle_settings.get("positionY", 85)

        # Convert position Y to margin
        margin_v = int((100 - position_y) / 100 * preset['height'] * 0.5)

        # Escape path for Windows
        srt_escaped = str(srt_path).replace("\\", "/").replace(":", "\\:")

        subtitles_filter = (
            f"subtitles='{srt_escaped}':"
            f"force_style='FontName={font_family},"
            f"FontSize={font_size},"
            f"PrimaryColour={text_color},"
            f"OutlineColour={outline_color},"
            f"Outline={outline_width},"
            f"MarginV={margin_v},"
            f"Alignment=2'"
        )
        filters.append(subtitles_filter)

    # Apply filters
    if filters:
        cmd.extend(["-vf", ",".join(filters)])

    # Video encoding (optimized for social media)
    cmd.extend([
        "-c:v", preset.get("video_codec", "libx264"),
        "-profile:v", preset.get("video_profile", "high"),
        "-level:v", preset.get("video_level", "4.0"),
        
        "-crf", str(preset.get("crf", 18)),
        "-maxrate", preset.get("video_bitrate", "10M"),
        "-bufsize", str(int(preset.get("video_bitrate", "10M").replace("M", "")) * 2) + "M",
        "-preset", "slow",  # Better compression
        "-r", str(preset.get("fps", 30))
    ])

    # Audio encoding
    if audio_path and audio_path.exists():
        cmd.extend([
            "-c:a", preset.get("audio_codec", "aac"),
            "-b:a", preset.get("audio_bitrate", "320k"),
            "-ar", str(preset.get("audio_sample_rate", 48000)),
            "-map", "0:v:0",
            "-map", "1:a:0"
        ])
    else:
        # Silent audio - map video from 0, audio from lavfi 1
        cmd.extend([
            "-c:a", "aac",
            "-b:a", "128k",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest"
        ])

    # Pixel format
    cmd.extend(["-pix_fmt", preset.get("pixel_format", "yuv420p")])

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
