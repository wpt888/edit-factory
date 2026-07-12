"""AI Video generation via Seedance 2.0, persisted as local library media."""

import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.core.rate_limit import limiter
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/video-gen", tags=["AI Video Generation"])

_progress: dict[str, dict] = {}
_lock = threading.Lock()


class GenerateVideoRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=10_000)
    name: str | None = Field(default=None, max_length=160)
    duration: Literal["auto", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"] = "8"
    aspect_ratio: Literal["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] = "9:16"
    resolution: Literal["480p", "720p", "1080p", "4k"] = "720p"
    generate_audio: bool = True
    bitrate_mode: Literal["standard", "high"] = "standard"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update(video_id: str, profile_id: str, **values: object) -> None:
    values["updated_at"] = _now()
    get_repository().table_query("generated_videos", "update", data=values,
        filters=QueryFilters(eq={"id": video_id, "profile_id": profile_id}))


def _generate_video_task(video_id: str, profile_id: str, request: GenerateVideoRequest) -> None:
    """Generate, download, and promote the MP4 into both core media systems."""
    local_path: Path | None = None
    key = f"{profile_id}:{video_id}"
    try:
        with _lock:
            _progress[key] = {"status": "generating", "progress": 10}
        _update(video_id, profile_id, status="generating")

        from app.services.fal_video_service import get_fal_video_generator
        generator = get_fal_video_generator(profile_id)
        try:
            result = generator.generate(
                prompt=request.prompt, duration=request.duration, aspect_ratio=request.aspect_ratio,
                resolution=request.resolution, generate_audio=request.generate_audio,
                bitrate_mode=request.bitrate_mode, end_user_id=profile_id,
            )
            video_url = (result.get("video") or {}).get("url")
            if not video_url:
                raise RuntimeError("Seedance returned no video URL")
            with _lock:
                _progress[key] = {"status": "downloading", "progress": 70}
            settings = get_settings()
            local_path = settings.base_dir / "source_videos" / "generated" / profile_id / f"{video_id}.mp4"
            generator.download_video(video_url, local_path)
        finally:
            generator.close()

        # A source-video record is what makes the generated MP4 immediately
        # selectable by the editor. Reuse its normal metadata/thumbnail flow.
        repo = get_repository()
        source_video_id = str(uuid.uuid4())
        display_name = request.name or f"AI Video {video_id[:8]}"
        repo.create_source_video({
            "id": source_video_id, "profile_id": profile_id, "name": display_name,
            "description": "Generated with Seedance 2.0", "file_path": str(local_path),
            "thumbnail_path": None, "duration": None, "width": None, "height": None,
            "fps": None, "file_size_bytes": None, "segments_count": 0, "status": "processing",
            "preview_proxy_status": "pending", "preview_proxy_error": None,
        })
        from app.api.segments_routes import _process_local_video_background, _get_video_info
        _process_local_video_background(source_video_id, local_path, profile_id)
        info = _get_video_info(local_path)

        # A standalone completed Library clip makes the asset publishable and
        # eligible for the existing voiceover/caption workflows without a render.
        project = repo.create_project({
            "id": str(uuid.uuid4()), "profile_id": profile_id, "name": display_name,
            "description": "AI video generated with Seedance 2.0", "status": "completed",
            "target_duration": info.get("duration"), "variants_count": 1,
        })
        project_id = project.get("id")
        if not project_id:
            raise RuntimeError("Could not create Library project for AI video")
        clip = repo.create_clip({
            "id": str(uuid.uuid4()), "project_id": project_id, "profile_id": profile_id,
            "variant_index": 0, "variant_name": display_name, "raw_video_path": str(local_path),
            "final_video_path": str(local_path), "duration": info.get("duration"),
            "is_selected": True, "is_deleted": False, "final_status": "completed",
        }) or {}
        _update(video_id, profile_id, status="completed", video_url=video_url,
                local_video_path=str(local_path), source_video_id=source_video_id,
                library_project_id=project_id, library_clip_id=clip.get("id"))
        with _lock:
            _progress[key] = {"status": "completed", "progress": 100, "source_video_id": source_video_id,
                              "library_clip_id": clip.get("id")}
    except Exception as exc:
        logger.exception("AI video generation failed for %s", video_id)
        if local_path:
            local_path.unlink(missing_ok=True)
        with _lock:
            _progress[key] = {"status": "failed", "progress": 0, "error": str(exc)}
        try:
            _update(video_id, profile_id, status="failed", error_message=str(exc)[:500])
        except Exception:
            logger.exception("Could not persist AI video failure")


@router.post("/generate")
@limiter.limit("5/minute")
async def generate_video(request: Request, body: GenerateVideoRequest, background_tasks: BackgroundTasks,
                         ctx: ProfileContext = Depends(get_profile_context)):
    from app.services.credentials.vault import get_vault_manager
    if not get_vault_manager().get_api_key_or_default(ctx.profile_id, "fal") and not get_settings().fal_api_key:
        raise HTTPException(status_code=503, detail="FAL API key not configured")
    video_id = str(uuid.uuid4())
    get_repository().table_query("generated_videos", "insert", data={
        "id": video_id, "profile_id": ctx.profile_id, "prompt": body.prompt,
        "name": body.name, "model": "seedance-2.0", "duration": body.duration,
        "aspect_ratio": body.aspect_ratio, "resolution": body.resolution,
        "generate_audio": body.generate_audio, "status": "pending",
    })
    background_tasks.add_task(_generate_video_task, video_id, ctx.profile_id, body)
    return {"video_id": video_id, "status": "pending", "model": "seedance-2.0"}


@router.get("/{video_id}/status")
async def video_status(video_id: str, ctx: ProfileContext = Depends(get_profile_context)):
    key = f"{ctx.profile_id}:{video_id}"
    with _lock:
        progress = dict(_progress[key]) if key in _progress else None
    row = get_repository().table_query("generated_videos", "select",
        filters=QueryFilters(eq={"id": video_id, "profile_id": ctx.profile_id}, limit=1)).data
    if not row:
        raise HTTPException(status_code=404, detail="AI video not found")
    return {**row[0], **(progress or {})}


@router.get("/history")
async def video_history(ctx: ProfileContext = Depends(get_profile_context)):
    result = get_repository().table_query("generated_videos", "select",
        filters=QueryFilters(eq={"profile_id": ctx.profile_id}, order_by="created_at", order_desc=True, limit=100))
    return {"videos": result.data or []}
