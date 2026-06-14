"""
EditAI Segments Routes
Manual video segment selection system - Source videos, segments, and matching.
"""
import uuid
import subprocess
import asyncio
import json
import struct
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Depends, Request, Body
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import validate_file_mime_type, ALLOWED_VIDEO_MIMES
from app.utils import sanitize_filename as _sanitize_filename, normalize_path
from app.core.rate_limit import limiter
from app.services.ffmpeg_semaphore import get_prep_codec_params, safe_ffmpeg_run, acquire_preview_slot

import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segments", tags=["segments"])

from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters


def _refresh_segments_count(repo, video_id: str, profile_id: str) -> None:
    """Recount segments for a source video and update the cached column."""
    try:
        count_result = repo.table_query("editai_segments", "select",
            filters=QueryFilters(
                select="id", count="exact",
                eq={"source_video_id": video_id, "profile_id": profile_id},
            ))
        new_count = count_result.count or 0
        repo.table_query("editai_source_videos", "update",
            data={"segments_count": new_count},
            filters=QueryFilters(eq={"id": video_id}))
    except Exception as e:
        logger.warning(f"Failed to refresh segments_count for video {video_id}: {e}")


# ============== PYDANTIC MODELS ==============

class SourceVideoCreate(BaseModel):
    name: str
    description: Optional[str] = None

class SourceVideoUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class SourceVideoResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    file_path: str
    thumbnail_path: Optional[str]
    duration: Optional[float]
    width: Optional[int]
    height: Optional[int]
    fps: Optional[float]
    file_size_bytes: Optional[int]
    segments_count: int
    status: str = "ready"
    preview_proxy_path: Optional[str] = None
    preview_proxy_status: Optional[str] = None
    preview_proxy_error: Optional[str] = None
    preview_proxy_created_at: Optional[str] = None
    created_at: str

class SegmentCreate(BaseModel):
    start_time: float = Field(ge=0)
    end_time: float = Field(gt=0)
    keywords: List[str] = []
    notes: Optional[str] = None
    product_group: Optional[str] = None
    single_use: bool = False

class SegmentTransformInput(BaseModel):
    rotation: float = 0.0
    scale: float = 1.0
    pan_x: float = 0.0
    pan_y: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    opacity: float = 1.0

class BulkTransformRequest(BaseModel):
    segment_ids: List[str]
    transforms: SegmentTransformInput
    mode: str = "set"  # "set" = overwrite, "add" = offset on top of existing

class SegmentResponse(BaseModel):
    id: str
    source_video_id: str
    start_time: float
    end_time: float
    duration: float
    keywords: List[str]
    extracted_video_path: Optional[str]
    thumbnail_path: Optional[str]
    usage_count: int
    is_favorite: bool
    notes: Optional[str]
    transforms: Optional[dict] = None
    product_group: Optional[str] = None
    single_use: bool = False
    created_at: str
    # Joined data
    source_video_name: Optional[str] = None

class SegmentUpdate(BaseModel):
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    keywords: Optional[List[str]] = None
    notes: Optional[str] = None
    transforms: Optional[SegmentTransformInput] = None
    product_group: Optional[str] = None
    single_use: Optional[bool] = None

class ProductGroupCreate(BaseModel):
    label: str
    start_time: float = Field(ge=0)
    end_time: float = Field(gt=0)
    color: Optional[str] = None

class ProductGroupUpdate(BaseModel):
    label: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    color: Optional[str] = None

class ProductGroupResponse(BaseModel):
    id: str
    source_video_id: str
    label: str
    start_time: float
    end_time: float
    color: Optional[str]
    segments_count: int = 0
    created_at: str

class SRTMatchRequest(BaseModel):
    srt_content: str
    min_confidence: float = 0.5

class SegmentMatch(BaseModel):
    segment_id: str
    keyword: str
    srt_timestamp: float
    confidence: float


# ============== HELPER FUNCTIONS ==============

def _get_video_info(video_path: Path) -> dict:
    """Get video metadata using ffprobe."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,duration,r_frame_rate",
            "-show_entries", "format=duration,size",
            "-of", "json",
            str(video_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=300, operation="ffprobe-video-info")
        if result.returncode != 0:
            return {}

        data = json.loads(result.stdout)
        stream = data.get("streams", [{}])[0]
        format_info = data.get("format", {})

        # Parse frame rate
        fps_str = stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) > 0 else 30
        else:
            fps = float(fps_str)

        return {
            "width": stream.get("width"),
            "height": stream.get("height"),
            "duration": float(format_info.get("duration", stream.get("duration", 0))),
            "fps": round(fps, 2),
            "file_size_bytes": int(format_info.get("size", 0))
        }
    except Exception as e:
        logger.error(f"Failed to get video info: {e}")
        return {}

def _generate_thumbnail(video_path: Path, output_path: Path, timestamp: float = 0) -> bool:
    """Generate thumbnail at specific timestamp."""
    try:
        cmd = [
            "ffmpeg", "-y",
            "-ss", str(timestamp),
            "-i", str(video_path),
            "-vframes", "1",
            "-vf", "scale=320:-1",
            str(output_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=300, operation="ffmpeg-thumbnail")
        return result.returncode == 0
    except RuntimeError:
        logger.error(f"Thumbnail generation timed out for {video_path}")
        return False
    except Exception as e:
        logger.error(f"Failed to generate thumbnail: {e}")
        return False


def _preview_proxy_output_path(video_id: str) -> Path:
    settings = get_settings()
    proxy_dir = settings.base_dir / "source_videos" / "proxies"
    proxy_dir.mkdir(parents=True, exist_ok=True)
    return proxy_dir / f"{video_id}_preview.mp4"


def _generate_preview_proxy(video_id: str, source_path: Path) -> dict:
    """Generate a browser-friendly proxy for Step 3 live preview."""
    output_path = _preview_proxy_output_path(video_id)
    try:
        if not source_path.exists():
            return {
                "preview_proxy_path": None,
                "preview_proxy_status": "failed",
                "preview_proxy_error": "Source video file not found",
                "preview_proxy_created_at": None,
            }

        # Max 720x1280, preserve aspect ratio, force even dimensions for H.264.
        vf = (
            "scale=w='min(720,iw)':h='min(1280,ih)':"
            "force_original_aspect_ratio=decrease:force_divisible_by=2,"
            "fps=30"
        )
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-i", str(source_path),
            "-an",
            "-vf", vf,
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-g", "15",
            "-keyint_min", "15",
            "-sc_threshold", "0",
            "-movflags", "+faststart",
            str(output_path),
        ]
        result = safe_ffmpeg_run(cmd, timeout=900, operation="ffmpeg-preview-proxy")
        if result.returncode == 0 and output_path.exists():
            return {
                "preview_proxy_path": str(output_path),
                "preview_proxy_status": "ready",
                "preview_proxy_error": None,
                "preview_proxy_created_at": datetime.now(timezone.utc).isoformat(),
            }

        output_path.unlink(missing_ok=True)
        error = (result.stderr or "FFmpeg proxy generation failed")[-1000:]
        return {
            "preview_proxy_path": None,
            "preview_proxy_status": "failed",
            "preview_proxy_error": error,
            "preview_proxy_created_at": None,
        }
    except RuntimeError as e:
        output_path.unlink(missing_ok=True)
        return {
            "preview_proxy_path": None,
            "preview_proxy_status": "failed",
            "preview_proxy_error": str(e)[-1000:],
            "preview_proxy_created_at": None,
        }
    except Exception as e:
        output_path.unlink(missing_ok=True)
        logger.error(f"Failed to generate preview proxy for {video_id}: {e}")
        return {
            "preview_proxy_path": None,
            "preview_proxy_status": "failed",
            "preview_proxy_error": str(e)[-1000:],
            "preview_proxy_created_at": None,
        }


def _generate_preview_proxy_background(video_id: str, source_path: Path, profile_id: str) -> None:
    repo = get_repository()
    if not repo:
        logger.error(f"[BG-Proxy] No DB for source video {video_id}")
        return

    try:
        repo.update_source_video(video_id, {
            "preview_proxy_status": "pending",
            "preview_proxy_error": None,
        })
    except Exception as e:
        logger.warning(f"[BG-Proxy] Failed to mark proxy pending for {video_id}: {e}")

    proxy_update = _generate_preview_proxy(video_id, source_path)
    try:
        repo.update_source_video(video_id, proxy_update)
    except Exception as e:
        logger.error(f"[BG-Proxy] Failed to save proxy status for {video_id}: {e}")


def _source_video_response(v: dict) -> SourceVideoResponse:
    return SourceVideoResponse(
        id=v["id"],
        # Legacy SQLite rows used filename/file_size/segment_count (schema
        # drift, deferred-items.md Section 1) — fall back so they still render
        name=v.get("name") or v.get("filename") or "",
        description=v.get("description"),
        file_path=v["file_path"],
        thumbnail_path=v.get("thumbnail_path"),
        duration=v.get("duration"),
        width=v.get("width"),
        height=v.get("height"),
        fps=v.get("fps"),
        file_size_bytes=v.get("file_size_bytes") or v.get("file_size"),
        segments_count=v.get("segments_count") or v.get("segment_count") or 0,
        status=v.get("status", "ready"),
        preview_proxy_path=v.get("preview_proxy_path"),
        preview_proxy_status=v.get("preview_proxy_status"),
        preview_proxy_error=v.get("preview_proxy_error"),
        preview_proxy_created_at=v.get("preview_proxy_created_at"),
        created_at=v["created_at"],
    )


def _video_file_response(video_path: Path) -> FileResponse:
    suffix = video_path.suffix.lower()
    media_type = {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
    }.get(suffix, "video/mp4")

    return FileResponse(
        path=str(video_path),
        media_type=media_type,
        content_disposition_type="inline",
        headers={"Cache-Control": "public, max-age=3600"}
    )


def _is_app_source_video_path(path: Path) -> bool:
    try:
        source_dir = (get_settings().base_dir / "source_videos").resolve()
        return path.resolve().is_relative_to(source_dir)
    except Exception:
        return False

def _extract_segment_video(
    source_path: Path,
    output_path: Path,
    start_time: float,
    end_time: float
) -> bool:
    """Extract a segment from source video."""
    try:
        duration = end_time - start_time
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-ss", str(start_time),
            "-i", str(source_path),
            "-t", str(duration),
            *get_prep_codec_params(),
            str(output_path)
        ]
        result = safe_ffmpeg_run(cmd, timeout=300, operation="ffmpeg-segment-extract")
        return result.returncode == 0
    except RuntimeError:
        logger.error(f"Segment extraction timed out for {source_path}")
        return False
    except Exception as e:
        logger.error(f"Failed to extract segment: {e}")
        return False

# Product group color palette
_PRODUCT_GROUP_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F"
]


def _assign_product_group(
    video_id: str, profile_id: str,
    seg_start: float, seg_end: float
) -> Optional[str]:
    """Auto-assign segment to product group if >50% overlap.

    Returns the group label if assigned, None otherwise.

    Phase 82-02: signature refactored to drop the `supabase` first arg.
    Body uses get_repository() internally and runs through repo.list_product_groups.
    Defensive try/except returns None on any backend error (SQLite schema drift
    on editai_product_groups is documented as a deferred item for Plan 82-03).
    """
    try:
        repo = get_repository()
        if not repo:
            return None
        groups_result = repo.list_product_groups(
            profile_id,
            QueryFilters(
                eq={"source_video_id": video_id},
                select="label, start_time, end_time",
            ),
        )
    except Exception as e:
        logger.warning(f"_assign_product_group: list_product_groups failed for video {video_id}: {e}")
        return None

    if not groups_result.data:
        return None

    seg_duration = seg_end - seg_start
    if seg_duration <= 0:
        return None

    best_label = None
    best_overlap = 0.0

    for g in groups_result.data:
        overlap_start = max(seg_start, g["start_time"])
        overlap_end = min(seg_end, g["end_time"])
        overlap = max(0, overlap_end - overlap_start)
        ratio = overlap / seg_duration

        if ratio > 0.5 and overlap > best_overlap:
            best_overlap = overlap
            best_label = g["label"]

    return best_label


def _reassign_all_segments(video_id: str, profile_id: str):
    """Reassign all segments for a video to their matching product groups.

    Phase 82-02: signature refactored to drop the `supabase` first arg.
    Body uses get_repository() internally and routes all DB access through
    repo.list_segments + repo.update_segment.
    """
    try:
        repo = get_repository()
        if not repo:
            return
        segments_result = repo.list_segments(
            profile_id,
            QueryFilters(
                eq={"source_video_id": video_id},
                select="id, start_time, end_time, keywords, product_group",
            ),
        )
    except Exception as e:
        logger.warning(f"_reassign_all_segments: list_segments failed for video {video_id}: {e}")
        return

    for seg in segments_result.data:
        new_label = _assign_product_group(
            video_id, profile_id,
            seg["start_time"], seg["end_time"]
        )
        old_group = seg.get("product_group")
        update_fields = {"product_group": new_label}

        # Manage keywords: remove old group label, add new one
        kw = list(seg.get("keywords") or [])
        if old_group and old_group in kw:
            kw.remove(old_group)
        if new_label and new_label not in kw:
            kw.append(new_label)
        update_fields["keywords"] = kw

        try:
            repo.update_segment(seg["id"], update_fields)
        except Exception as e:
            logger.warning(f"_reassign_all_segments: update_segment failed for seg {seg['id']}: {e}")


# ============== SOURCE VIDEOS ENDPOINTS ==============

def _process_source_video_background(
    video_id: str,
    video_path: Path,
    profile_id: str,
):
    """Background task: transcode (if needed), extract metadata, generate thumbnail."""
    repo = get_repository()
    if not repo:
        logger.error(f"[BG] No DB for source video {video_id}")
        return

    source_dir = video_path.parent
    current_path = video_path

    try:
        # Auto-transcode non-mp4 formats to .mp4 for browser compatibility
        non_mp4_formats = {'.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'}
        if current_path.suffix.lower() in non_mp4_formats:
            mp4_path = current_path.with_suffix('.mp4')
            logger.info(f"[BG] Transcoding {current_path.suffix} to .mp4: {current_path.name}")
            try:
                cmd = [
                    "ffmpeg", "-y", "-threads", "4", "-i", str(current_path),
                    *get_prep_codec_params(),
                    str(mp4_path)
                ]
                result = safe_ffmpeg_run(cmd, timeout=600, operation="ffmpeg-transcode")
                if result.returncode == 0:
                    current_path.unlink()
                    current_path = mp4_path
                    logger.info(f"[BG] Transcode successful: {mp4_path.name}")
                else:
                    logger.error(f"[BG] Transcode failed: {result.stderr}")
            except RuntimeError:
                logger.error(f"[BG] Transcode timed out for {current_path.name}")
                if mp4_path.exists():
                    mp4_path.unlink(missing_ok=True)
            except Exception as e:
                logger.error(f"[BG] Transcode error: {e}")

        # Get video metadata
        video_info = _get_video_info(current_path)

        # Generate thumbnail
        thumbnail_path = source_dir / f"{video_id}_thumb.jpg"
        _generate_thumbnail(current_path, thumbnail_path, timestamp=1)

        proxy_update = _generate_preview_proxy(video_id, current_path)

        # Update DB with metadata and set status=ready
        repo.update_source_video(video_id, {
            "file_path": str(current_path),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "duration": video_info.get("duration"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "fps": video_info.get("fps"),
            "file_size_bytes": video_info.get("file_size_bytes"),
            "status": "ready",
            **proxy_update,
        })

        logger.info(f"[BG] Source video {video_id} ready")

    except Exception as e:
        logger.error(f"[BG] Failed to process source video {video_id}: {e}")
        try:
            repo.update_source_video(video_id, {"status": "error"})
        except Exception:
            pass


class FindLocalRequest(BaseModel):
    """Request body to find a local file by name and size."""
    filename: str = Field(..., description="Original filename from drag & drop")
    size: int = Field(..., description="File size in bytes")


class LocalVideoRequest(BaseModel):
    """Request body for adding a local video by file path (no upload/copy)."""
    file_path: str = Field(..., description="Absolute path to the video file on disk")
    name: Optional[str] = Field(default=None, description="Display name (defaults to filename)")
    description: Optional[str] = None


@router.post("/find-local")
async def find_local_file(
    request: Request,
    body: FindLocalRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Find a file on the local filesystem by filename and size.

    Used when the browser drag & drop provides filename + size but not the full path.
    Searches common user directories first, then all drives.
    """
    import os as _os

    filename = body.filename
    target_size = body.size
    matches: List[str] = []

    # Search common user directories first (fast)
    home = Path(_os.path.expanduser("~"))
    priority_dirs = [
        home / "Videos",
        home / "Downloads",
        home / "Desktop",
        home / "Documents",
        home / "OneDrive" / "Videos",
        home / "OneDrive" / "Desktop",
        home / "OneDrive" / "Documents",
    ]

    for search_dir in priority_dirs:
        if not search_dir.exists():
            continue
        try:
            for root, _dirs, files in _os.walk(str(search_dir)):
                if filename in files:
                    candidate = Path(root) / filename
                    try:
                        if candidate.stat().st_size == target_size:
                            matches.append(str(candidate))
                            if len(matches) >= 5:
                                break
                    except OSError:
                        continue
                # Limit depth to 5 levels
                depth = str(root).count(_os.sep) - str(search_dir).count(_os.sep)
                if depth >= 5:
                    _dirs.clear()
        except PermissionError:
            continue
        if matches:
            break

    # If not found in common dirs, search all drives (Windows)
    if not matches:
        import string
        drives = [f"{d}:\\" for d in string.ascii_uppercase
                  if Path(f"{d}:\\").exists() and d not in ("A", "B")]
        for drive in drives:
            try:
                for root, _dirs, files in _os.walk(drive):
                    if filename in files:
                        candidate = Path(root) / filename
                        try:
                            if candidate.stat().st_size == target_size:
                                matches.append(str(candidate))
                                if len(matches) >= 3:
                                    break
                        except OSError:
                            continue
                    # Skip system directories and limit depth
                    depth = str(root).count(_os.sep) - drive.count(_os.sep)
                    if depth >= 6:
                        _dirs.clear()
                    _dirs[:] = [d for d in _dirs if d not in (
                        "Windows", "$Recycle.Bin", "System Volume Information",
                        "ProgramData", "Program Files", "Program Files (x86)",
                        "node_modules", ".git", "__pycache__", "venv",
                    )]
            except PermissionError:
                continue
            if matches:
                break

    if not matches:
        raise HTTPException(status_code=404, detail=f"File '{filename}' ({target_size} bytes) not found on disk")

    # Security: filter out matches from sensitive directories
    settings = get_settings()
    _sensitive_prefixes = ("Windows", "Program Files", "ProgramData", "AppData", ".ssh", ".gnupg")
    safe_matches = [
        m for m in matches
        if not any(sp in m for sp in _sensitive_prefixes)
    ]
    if not safe_matches:
        raise HTTPException(status_code=404, detail=f"File '{filename}' ({target_size} bytes) not found in allowed directories")

    return {"matches": safe_matches, "file_path": safe_matches[0]}


_PICKER_SCRIPT = r"""
import json, sys
try:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk(); root.withdraw(); root.attributes("-topmost", True)
    paths = filedialog.askopenfilenames(
        title="Select Video Files",
        filetypes=[("Video files", "*.mp4 *.mov *.avi *.mkv *.wmv *.flv *.webm *.mpeg *.mpg *.3gp *.ogg"),
                   ("All files", "*.*")])
    root.destroy()
    sys.stdout.write(json.dumps(list(paths)))
except Exception:
    sys.stdout.write("[]")
"""


@router.get("/browse-local")
async def browse_local_file(
    request: Request,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Open a native file picker dialog and return the selected file path.

    Web/dev only — the desktop shell provides its own native dialog via
    Electron IPC. tkinter runs in a throwaway subprocess: on Windows a Tk
    abort (0xC0000409) would otherwise kill the whole uvicorn process.
    """
    import asyncio
    import json as _json
    import os as _os
    import sys as _sys

    if _os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes"):
        raise HTTPException(
            status_code=501,
            detail="Native file dialog is provided by the desktop shell — update Edit Factory.",
        )

    proc = await asyncio.create_subprocess_exec(
        _sys.executable, "-c", _PICKER_SCRIPT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
    except asyncio.TimeoutError:
        proc.kill()
        return {"file_path": None, "file_paths": []}

    try:
        paths = _json.loads((out or b"[]").decode("utf-8", "replace").strip() or "[]")
    except Exception:
        paths = []
    if not paths:
        return {"file_path": None, "file_paths": []}

    return {"file_path": paths[0], "file_paths": paths}


@router.post("/source-videos/local", response_model=SourceVideoResponse)
@limiter.limit("10/minute")
async def add_local_source_video(
    request: Request,
    background_tasks: BackgroundTasks,
    body: LocalVideoRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Add a source video by local file path — no upload, no copy.

    For local desktop usage: the file stays in its original location,
    avoiding slow HTTP uploads and disk duplication.
    """
    repo = get_repository()

    local_path = Path(body.file_path)

    # Validate file exists
    if not local_path.is_file():
        raise HTTPException(status_code=400, detail=f"File not found: {body.file_path}")

    # Validate video extension
    allowed_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.mpeg', '.mpg', '.3gp', '.ogg'}
    if local_path.suffix.lower() not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported video format: {local_path.suffix}. Allowed: {', '.join(sorted(allowed_extensions))}"
        )

    video_id = str(uuid.uuid4())
    name = body.name or local_path.stem

    logger.info(f"[Profile {profile.profile_id}] Adding local video: {name} -> {local_path}")

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        repo.create_source_video({
            "id": video_id,
            "profile_id": profile.profile_id,
            "name": name,
            "description": body.description,
            "file_path": str(local_path),
            "thumbnail_path": None,
            "duration": None,
            "width": None,
            "height": None,
            "fps": None,
            "file_size_bytes": None,
            "segments_count": 0,
            "status": "processing",
            "preview_proxy_status": "pending",
            "preview_proxy_error": None,
        })
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save video record")

    # Metadata extraction + thumbnail in background (no transcode needed for local files)
    background_tasks.add_task(
        _process_local_video_background, video_id, local_path, profile.profile_id
    )

    return SourceVideoResponse(
        id=video_id,
        name=name,
        description=body.description,
        file_path=str(local_path),
        thumbnail_path=None,
        duration=None,
        width=None,
        height=None,
        fps=None,
        file_size_bytes=None,
        segments_count=0,
        status="processing",
        preview_proxy_status="pending",
        created_at=now_iso,
    )


def _process_local_video_background(
    video_id: str,
    video_path: Path,
    profile_id: str,
):
    """Background task for local videos: extract metadata + generate thumbnail.

    Unlike _process_source_video_background, this does NOT transcode —
    the file stays in its original location and format.
    """
    repo = get_repository()
    if not repo:
        logger.error(f"[BG-Local] No DB for source video {video_id}")
        return

    try:
        # Get video metadata
        video_info = _get_video_info(video_path)

        # Generate thumbnail in the app's source_videos dir
        settings = get_settings()
        source_dir = settings.base_dir / "source_videos"
        source_dir.mkdir(parents=True, exist_ok=True)
        thumbnail_path = source_dir / f"{video_id}_thumb.jpg"
        _generate_thumbnail(video_path, thumbnail_path, timestamp=1)

        proxy_update = _generate_preview_proxy(video_id, video_path)

        repo.update_source_video(video_id, {
            "file_path": str(video_path),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "duration": video_info.get("duration"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "fps": video_info.get("fps"),
            "file_size_bytes": video_info.get("file_size_bytes"),
            "status": "ready",
            **proxy_update,
        })

        logger.info(f"[BG-Local] Source video {video_id} ready")

    except Exception as e:
        logger.error(f"[BG-Local] Failed to process source video {video_id}: {e}")
        try:
            repo.update_source_video(video_id, {"status": "error"})
        except Exception:
            pass


@router.post("/source-videos", response_model=SourceVideoResponse)
@limiter.limit("10/minute")
async def upload_source_video(
    request: Request,
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(default=None),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Upload a source video for segment extraction.

    Saves the file to disk and returns immediately with status='processing'.
    Transcoding, metadata extraction, and thumbnail generation run in background.
    Poll GET /source-videos/{id} until status='ready'.
    """
    repo = get_repository()

    logger.info(f"[Profile {profile.profile_id}] Uploading source video: {name}")

    settings = get_settings()
    settings.ensure_dirs()

    video_id = str(uuid.uuid4())
    safe_filename = _sanitize_filename(video.filename)

    source_dir = settings.base_dir / "source_videos"
    source_dir.mkdir(parents=True, exist_ok=True)

    video_path = source_dir / f"{video_id}_{safe_filename}"

    # Reject oversized uploads before saving (STAB-05)
    from app.api.validators import validate_upload_size
    await validate_upload_size(video)
    # Validate actual MIME type via magic-number inspection (blocks disguised malicious files)
    await validate_file_mime_type(video, ALLOWED_VIDEO_MIMES, "video")

    # Save uploaded file with 1MB buffer (much faster on WSL2/NTFS)
    import shutil as _shutil
    try:
        with open(video_path, "wb") as f:
            _shutil.copyfileobj(video.file, f, length=1024 * 1024)
    except Exception:
        # Clean up partial file on write failure
        Path(video_path).unlink(missing_ok=True)
        raise

    # Insert DB record immediately with status=processing
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        repo.create_source_video({
            "id": video_id,
            "profile_id": profile.profile_id,
            "name": name,
            "description": description,
            "file_path": str(video_path),
            "thumbnail_path": None,
            "duration": None,
            "width": None,
            "height": None,
            "fps": None,
            "file_size_bytes": None,
            "segments_count": 0,
            "status": "processing",
            "preview_proxy_status": "pending",
            "preview_proxy_error": None,
        })
    except Exception as e:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to save video")

    # Transcode + metadata + thumbnail run in background
    background_tasks.add_task(
        _process_source_video_background, video_id, video_path, profile.profile_id
    )

    return SourceVideoResponse(
        id=video_id,
        name=name,
        description=description,
        file_path=str(video_path),
        thumbnail_path=None,
        duration=None,
        width=None,
        height=None,
        fps=None,
        file_size_bytes=None,
        segments_count=0,
        status="processing",
        preview_proxy_status="pending",
        created_at=now_iso,
    )


@router.get("/source-videos", response_model=List[SourceVideoResponse])
async def list_source_videos(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all source videos for the current profile."""
    repo = get_repository()

    logger.info(f"[Profile {profile.profile_id}] Listing source videos")

    result = repo.list_source_videos(
        profile.profile_id,
        QueryFilters(order_by="created_at", order_desc=True, limit=limit, offset=offset),
    )

    return [_source_video_response(v) for v in result.data]


@router.get("/source-videos/{video_id}", response_model=SourceVideoResponse)
async def get_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get source video details."""
    repo = get_repository()

    video = repo.get_source_video(video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    return _source_video_response(video)


@router.patch("/source-videos/{video_id}", response_model=SourceVideoResponse)
async def update_source_video(
    video_id: str,
    body: SourceVideoUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update source video name or description."""
    repo = get_repository()

    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    if "name" in update_data and not update_data["name"].strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")

    # Ownership check (T-82-01-01 IDOR pattern)
    existing = repo.get_source_video(video_id)
    if not existing or existing.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    updated = repo.update_source_video(video_id, update_data)
    if not updated:
        raise HTTPException(status_code=404, detail="Source video not found")

    return _source_video_response(updated)


@router.delete("/source-videos/{video_id}")
async def delete_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete source video and all its segments."""
    logger.info(f"[Profile {profile.profile_id}] Deleting source video: {video_id}")
    repo = get_repository()

    # Get video info first + ownership check (T-82-01-01 IDOR pattern)
    video_data = repo.get_source_video(video_id)
    if not video_data or video_data.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    # Get all segments to delete their files (scoped to source_video_id + profile)
    segments_result = repo.list_segments(
        profile.profile_id,
        QueryFilters(eq={"source_video_id": video_id}, select="extracted_video_path, thumbnail_path"),
    )

    # Delete from database first (cascade will handle segments)
    repo.delete_source_video(video_id)

    # Delete segment files only after DB delete succeeds
    for seg in segments_result.data:
        if seg.get("extracted_video_path"):
            Path(seg["extracted_video_path"]).unlink(missing_ok=True)
        if seg.get("thumbnail_path"):
            Path(seg["thumbnail_path"]).unlink(missing_ok=True)

    # Delete source video files
    if video_data.get("file_path"):
        source_path = Path(normalize_path(video_data["file_path"]))
        if _is_app_source_video_path(source_path):
            source_path.unlink(missing_ok=True)
    if video_data.get("thumbnail_path"):
        Path(video_data["thumbnail_path"]).unlink(missing_ok=True)
    if video_data.get("preview_proxy_path"):
        Path(video_data["preview_proxy_path"]).unlink(missing_ok=True)

    return {"status": "deleted", "id": video_id}


@router.get("/source-videos/{video_id}/stream")
async def stream_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Stream source video for playback."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    video = await asyncio.to_thread(repo.get_source_video, video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(video["file_path"]))
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    return _video_file_response(video_path)


@router.get("/source-videos/{video_id}/preview-stream")
async def preview_stream_source_video(
    video_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Stream the optimized preview proxy when available, falling back to the original."""
    effective_profile_id = profile.profile_id

    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    video_data = await asyncio.to_thread(repo.get_source_video, video_id)
    if not video_data or video_data.get("profile_id") != effective_profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    original_path = Path(normalize_path(video_data["file_path"]))
    if not original_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    proxy_path_value = video_data.get("preview_proxy_path")
    proxy_path = Path(normalize_path(proxy_path_value)) if proxy_path_value else None
    if video_data.get("preview_proxy_status") == "ready" and proxy_path and proxy_path.exists():
        return _video_file_response(proxy_path)

    # Existing records may not have proxy metadata yet. Start lazy generation,
    # but return the original immediately so playback is never blocked.
    proxy_status = video_data.get("preview_proxy_status")
    source_status = video_data.get("status")
    should_start_lazy_proxy = (
        source_status != "processing"
        and proxy_status != "failed"
        and (proxy_status != "pending" or not proxy_path_value)
    )
    if should_start_lazy_proxy:
        try:
            repo.update_source_video(video_id, {
                "preview_proxy_status": "pending",
                "preview_proxy_error": None,
            })
        except Exception as e:
            logger.warning(f"Failed to mark lazy preview proxy pending for {video_id}: {e}")
        background_tasks.add_task(
            _generate_preview_proxy_background,
            video_id,
            original_path,
            effective_profile_id,
        )

    return _video_file_response(original_path)


# ============== WAVEFORM & VOICE DETECTION ==============

def _extract_waveform(video_path: str, num_samples: int = 800, duration: float = 0) -> List[float]:
    """Extract audio waveform as RMS amplitude values normalized 0-1.

    Uses FFmpeg to decode audio to raw PCM (mono, 8kHz, s16le) via pipe,
    then computes RMS per temporal bin with sqrt scaling.
    """
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-vn",
        "-t", "600",  # Limit to first 10 minutes to prevent OOM on long videos
        "-ac", "1",          # mono
        "-ar", "8000",       # 8kHz — enough for waveform viz
        "-f", "s16le",       # raw signed 16-bit little-endian
        "-acodec", "pcm_s16le",
        "pipe:1"
    ]

    try:
        # Note: uses raw Popen (not safe_ffmpeg_run) because we need binary stdout for PCM data
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            stdout_data, stderr_data = proc.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate(timeout=10)
            logger.error(f"FFmpeg waveform extraction timed out for {video_path}")
            return []
        if proc.returncode != 0:
            logger.error(f"FFmpeg waveform extraction failed: {stderr_data[:500] if stderr_data else b''}")
            return []
        raw = stdout_data
        if not raw:
            return []

        # Parse raw PCM — each sample is 2 bytes (s16le)
        total_samples = len(raw) // 2
        if total_samples == 0:
            return []

        samples_per_bin = max(1, total_samples // num_samples)
        actual_bins = min(num_samples, total_samples)
        waveform = []

        for i in range(actual_bins):
            start_byte = i * samples_per_bin * 2
            end_byte = min(start_byte + samples_per_bin * 2, len(raw))
            chunk = raw[start_byte:end_byte]

            # Compute RMS for this bin
            n = len(chunk) // 2
            if n == 0:
                waveform.append(0.0)
                continue

            sum_sq = 0.0
            for j in range(n):
                sample = struct.unpack_from('<h', chunk, j * 2)[0]
                sum_sq += sample * sample
            rms = math.sqrt(sum_sq / n) / 32768.0  # normalize to 0-1

            # sqrt scaling for better visual dynamic range
            waveform.append(round(math.sqrt(rms), 4))

        return waveform

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg waveform extraction timed out")
        return []
    except Exception as e:
        logger.error(f"Waveform extraction error: {e}")
        return []


@router.get("/source-videos/{video_id}/waveform")
async def get_source_video_waveform(
    video_id: str,
    samples: int = Query(default=800, ge=100, le=4000),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get audio waveform data for visualization."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    video = repo.get_source_video(video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(video["file_path"]))
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    duration = video.get("duration") or 0

    import asyncio
    waveform = await asyncio.to_thread(_extract_waveform, str(video_path), samples, duration)

    return {
        "video_id": video_id,
        "samples": len(waveform),
        "duration": duration,
        "waveform": waveform
    }


@router.get("/source-videos/{video_id}/voice-detection")
async def get_source_video_voice_detection(
    video_id: str,
    threshold: float = Query(default=0.5, ge=0.1, le=0.9),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get voice activity detection regions for a source video.

    Uses Silero VAD to detect speech segments.
    """
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    video = repo.get_source_video(video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(video["file_path"]))
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    try:
        from app.services.voice_detector import VoiceDetector
        detector = VoiceDetector(threshold=threshold)
        voice_segments = detector.detect_voice(video_path)

        return {
            "video_id": video_id,
            "voice_segments": [seg.to_dict() for seg in voice_segments],
            "segments_count": len(voice_segments)
        }
    except Exception as e:
        logger.error(f"Voice detection failed: {e}")
        raise HTTPException(status_code=500, detail="Voice detection failed")


def _validate_time_range(start_time: float, end_time: float, video_duration: Optional[float]):
    """Validate that a time range falls within the video duration."""
    if end_time <= start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    if video_duration is not None:
        if start_time > video_duration:
            raise HTTPException(status_code=400, detail=f"Start time ({start_time}s) exceeds video duration ({video_duration}s)")
        if end_time > video_duration:
            raise HTTPException(status_code=400, detail=f"End time ({end_time}s) exceeds video duration ({video_duration}s)")


# ============== SEGMENTS ENDPOINTS ==============

@router.post("/source-videos/{video_id}/segments", response_model=SegmentResponse)
async def create_segment(
    video_id: str,
    segment: SegmentCreate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Create a new segment for a source video."""
    logger.info(f"[Profile {profile.profile_id}] Creating segment for source video: {video_id}")
    repo = get_repository()

    # Verify source video exists and belongs to profile (T-82-01-01 IDOR pattern)
    source_video = repo.get_source_video(video_id)
    if not source_video or source_video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    # Validate times against video duration
    _validate_time_range(segment.start_time, segment.end_time, source_video.get("duration"))

    # Create segment
    segment_id = str(uuid.uuid4())
    duration = segment.end_time - segment.start_time

    # Generate thumbnail for segment (at midpoint)
    settings = get_settings()
    segments_dir = settings.base_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)

    thumbnail_path = segments_dir / f"{segment_id}_thumb.jpg"
    midpoint = segment.start_time + (duration / 2)
    _generate_thumbnail(Path(normalize_path(source_video["file_path"])), thumbnail_path, midpoint)

    try:
        repo.create_segment({
            "id": segment_id,
            "source_video_id": video_id,
            "profile_id": profile.profile_id,
            "start_time": segment.start_time,
            "end_time": segment.end_time,
            "keywords": segment.keywords,
            "notes": segment.notes,
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "usage_count": 0,
            "is_favorite": False,
            "single_use": segment.single_use
        })

        # Auto-assign product group if groups exist (helper now takes no supabase arg)
        assigned_group = await asyncio.to_thread(_assign_product_group, video_id, profile.profile_id, segment.start_time, segment.end_time)
        product_group_label = assigned_group or segment.product_group

        # If assigned, store in DB and add label as keyword
        if product_group_label:
            update_fields = {"product_group": product_group_label}
            kw = list(segment.keywords)
            if product_group_label not in kw:
                kw.append(product_group_label)
                update_fields["keywords"] = kw
            repo.update_segment(segment_id, update_fields)

        _refresh_segments_count(repo, video_id, profile.profile_id)

        return SegmentResponse(
            id=segment_id,
            source_video_id=video_id,
            start_time=segment.start_time,
            end_time=segment.end_time,
            duration=duration,
            keywords=segment.keywords if not product_group_label else (segment.keywords + [product_group_label] if product_group_label not in segment.keywords else segment.keywords),
            extracted_video_path=None,
            thumbnail_path=str(thumbnail_path) if thumbnail_path.exists() else None,
            usage_count=0,
            is_favorite=False,
            notes=segment.notes,
            transforms=None,
            product_group=product_group_label,
            single_use=segment.single_use,
            created_at=datetime.now(timezone.utc).isoformat(),
            source_video_name=source_video.get("name")
        )
    except Exception as e:
        thumbnail_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to create segment")


@router.get("/source-videos/{video_id}/segments", response_model=List[SegmentResponse])
async def list_video_segments(
    video_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all segments for a source video."""
    repo = get_repository()

    result = repo.list_segments(
        profile.profile_id,
        QueryFilters(
            eq={"source_video_id": video_id},
            order_by="start_time",
            limit=limit,
            offset=offset,
        ),
    )

    # Compose source_video_name via per-video lookup (replaces PostgREST nested join).
    # Guard: skip the lookup when the segment list is empty — avoids loading
    # cross-profile source-video metadata into memory for non-owned video_ids
    # (response shape is identical either way; this is a defensive cleanup).
    source_video_name = None
    if result.data:
        source_video = repo.get_source_video(video_id)
        if source_video and source_video.get("profile_id") == profile.profile_id:
            source_video_name = source_video.get("name")

    return [
        SegmentResponse(
            id=s["id"],
            source_video_id=s["source_video_id"],
            start_time=s["start_time"],
            end_time=s["end_time"],
            duration=s["end_time"] - s["start_time"],
            keywords=s.get("keywords") or [],
            extracted_video_path=s.get("extracted_video_path"),
            thumbnail_path=s.get("thumbnail_path"),
            usage_count=s.get("usage_count", 0),
            is_favorite=s.get("is_favorite", False),
            notes=s.get("notes"),
            transforms=s.get("transforms"),
            product_group=s.get("product_group"),
            created_at=s["created_at"],
            source_video_name=source_video_name,
        )
        for s in result.data
    ]


@router.get("/", response_model=List[SegmentResponse])
async def list_all_segments(
    keyword: Optional[str] = Query(default=None, description="Filter by keyword"),
    source_video_id: Optional[str] = Query(default=None, description="Filter by source video"),
    favorites_only: bool = Query(default=False, description="Only show favorites"),
    min_duration: Optional[float] = Query(default=None, description="Minimum duration in seconds"),
    max_duration: Optional[float] = Query(default=None, description="Maximum duration in seconds"),
    limit: int = Query(default=100, ge=1, le=500, description="Max segments to return"),
    offset: int = Query(default=0, ge=0, description="Number of segments to skip"),
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all segments (library view) with optional filters, scoped to current profile."""
    repo = get_repository()

    # Compose QueryFilters from optional query params
    eq_filters: dict = {}
    if source_video_id:
        eq_filters["source_video_id"] = source_video_id
    if favorites_only:
        eq_filters["is_favorite"] = True

    contains_filters: dict = {}
    if keyword:
        contains_filters["keywords"] = [keyword]

    # Fetch extra rows to compensate for post-query duration filtering
    fetch_limit = limit * 3 if (min_duration or max_duration) else limit
    result = repo.list_segments(
        profile.profile_id,
        QueryFilters(
            eq=eq_filters,
            contains=contains_filters,
            order_by="created_at",
            order_desc=True,
            limit=fetch_limit,
            offset=offset,
        ),
    )

    # Compose source video names via per-id lookup (replaces PostgREST nested join)
    source_video_names: dict = {}
    unique_video_ids = {s["source_video_id"] for s in result.data if s.get("source_video_id")}
    for vid in unique_video_ids:
        sv = repo.get_source_video(vid)
        if sv:
            source_video_names[vid] = sv.get("name")

    segments = []
    for s in result.data:
        duration = s["end_time"] - s["start_time"]

        # Filter by duration (post-query since the underlying store doesn't support computed columns)
        if min_duration and duration < min_duration:
            continue
        if max_duration and duration > max_duration:
            continue

        if len(segments) >= limit:
            break

        segments.append(SegmentResponse(
            id=s["id"],
            source_video_id=s["source_video_id"],
            start_time=s["start_time"],
            end_time=s["end_time"],
            duration=duration,
            keywords=s.get("keywords") or [],
            extracted_video_path=s.get("extracted_video_path"),
            thumbnail_path=s.get("thumbnail_path"),
            usage_count=s.get("usage_count", 0),
            is_favorite=s.get("is_favorite", False),
            notes=s.get("notes"),
            transforms=s.get("transforms"),
            product_group=s.get("product_group"),
            created_at=s["created_at"],
            source_video_name=source_video_names.get(s["source_video_id"]),
        ))

    return segments


@router.post("/reset-usage")
async def reset_segment_usage(
    source_video_id: Optional[str] = Body(None, embed=True),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Reset usage_count to 0 for all segments belonging to this profile.

    Optionally filter by source_video_id to reset only segments from a specific video.
    """
    repo = get_repository()

    # Bulk-update via escape hatch: WHERE profile_id = X AND usage_count > 0 [AND source_video_id = Y]
    eq_filters: dict = {"profile_id": profile.profile_id}
    if source_video_id:
        eq_filters["source_video_id"] = source_video_id

    update_result = repo.table_query(
        "editai_segments",
        "update",
        data={"usage_count": 0},
        filters=QueryFilters(eq=eq_filters, gt={"usage_count": 0}),
    )
    reset_count = len(update_result.data) if update_result.data else 0

    logger.info(
        f"[Profile {profile.profile_id}] Reset usage_count for {reset_count} segments"
        + (f" (source_video_id={source_video_id})" if source_video_id else "")
    )

    return {"reset_count": reset_count, "source_video_id": source_video_id}


@router.get("/product-groups-bulk", response_model=List[ProductGroupResponse])
async def list_product_groups_bulk(
    source_video_ids: str = Query(..., description="Comma-separated source video IDs"),
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all product groups for multiple source videos in one query.

    Avoids N+1 queries when the pipeline page needs groups for all selected source videos.
    Must be placed before /{segment_id} to avoid the catch-all parameterized route matching
    the literal string "product-groups-bulk".

    NOTE (Phase 82 schema drift): the SQLite editai_product_groups table differs from
    Supabase — it lacks source_video_id / label / start_time / end_time / color columns.
    This route returns 500 in SQLite mode, accepted per the Phase 80 / 81 dual-gate
    precedent (status != 503 AND the dead 503 message string not present in response).
    82-03 documents this as a deferred item.
    """
    repo = get_repository()

    ids = [vid.strip() for vid in source_video_ids.split(",") if vid.strip()]
    if not ids:
        return []
    if len(ids) > 50:
        raise HTTPException(status_code=400, detail="Too many IDs (max 50)")

    try:
        result = repo.list_product_groups(
            profile.profile_id,
            QueryFilters(in_={"source_video_id": ids}, order_by="start_time"),
        )

        group_labels = [g["label"] for g in result.data]
        seg_counts: dict = {}
        if group_labels:
            count_result = repo.list_segments(
                profile.profile_id,
                QueryFilters(
                    in_={"source_video_id": ids, "product_group": group_labels},
                    select="product_group",
                ),
            )
            for row in (count_result.data or []):
                key = row.get("product_group")
                seg_counts[key] = seg_counts.get(key, 0) + 1

        groups = []
        for g in result.data:
            groups.append(ProductGroupResponse(
                id=g["id"],
                source_video_id=g["source_video_id"],
                label=g["label"],
                start_time=g["start_time"],
                end_time=g["end_time"],
                color=g.get("color"),
                segments_count=seg_counts.get(g["label"], 0),
                created_at=g["created_at"]
            ))

        return groups
    except Exception as e:
        logger.error(f"Failed to fetch product groups bulk: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch product groups")


@router.get("/{segment_id}", response_model=SegmentResponse)
async def get_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get segment details."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    s = repo.get_segment(segment_id)
    if not s or s.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Compose source_video_name via per-video lookup (replaces PostgREST nested join)
    source_video_name = None
    if s.get("source_video_id"):
        sv = repo.get_source_video(s["source_video_id"])
        if sv:
            source_video_name = sv.get("name")

    return SegmentResponse(
        id=s["id"],
        source_video_id=s["source_video_id"],
        start_time=s["start_time"],
        end_time=s["end_time"],
        duration=s["end_time"] - s["start_time"],
        keywords=s.get("keywords") or [],
        extracted_video_path=s.get("extracted_video_path"),
        thumbnail_path=s.get("thumbnail_path"),
        usage_count=s.get("usage_count", 0),
        is_favorite=s.get("is_favorite", False),
        notes=s.get("notes"),
        transforms=s.get("transforms"),
        product_group=s.get("product_group"),
        created_at=s["created_at"],
        source_video_name=source_video_name,
    )


@router.patch("/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    segment_id: str,
    update: SegmentUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update segment (keywords, times, notes)."""
    repo = get_repository()

    # Build update dict with only provided fields
    update_data = {}

    if update.start_time is not None:
        update_data["start_time"] = update.start_time
    if update.end_time is not None:
        update_data["end_time"] = update.end_time
    if update.keywords is not None:
        update_data["keywords"] = update.keywords
    if update.notes is not None:
        update_data["notes"] = update.notes
    if update.transforms is not None:
        update_data["transforms"] = update.transforms.model_dump()
    if update.product_group is not None:
        update_data["product_group"] = update.product_group

    # Validate times: fetch existing segment + video duration for cross-check
    if update.start_time is not None or update.end_time is not None:
        # Ownership check (T-82-01-01 IDOR pattern)
        existing = repo.get_segment(segment_id)
        if not existing or existing.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Segment not found")

        effective_start = update.start_time if update.start_time is not None else existing["start_time"]
        effective_end = update.end_time if update.end_time is not None else existing["end_time"]

        if effective_start < 0:
            raise HTTPException(status_code=400, detail="Start time must be >= 0")

        video = repo.get_source_video(existing["source_video_id"])
        video_duration = video.get("duration") if video else None

        _validate_time_range(effective_start, effective_end, video_duration)
    else:
        # Even when times aren't changed, ownership must be checked before update
        existing = repo.get_segment(segment_id)
        if not existing or existing.get("profile_id") != profile.profile_id:
            raise HTTPException(status_code=404, detail="Segment not found")

    updated = repo.update_segment(segment_id, update_data)

    if not updated:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Re-check product group assignment if times changed
    if update.start_time is not None or update.end_time is not None:
        new_label = await asyncio.to_thread(
            _assign_product_group,
            updated["source_video_id"], profile.profile_id,
            updated["start_time"], updated["end_time"]
        )
        if new_label != updated.get("product_group"):
            pg_update = {"product_group": new_label}
            kw = list(updated.get("keywords") or [])
            old_pg = updated.get("product_group")
            if old_pg and old_pg in kw:
                kw.remove(old_pg)
            if new_label and new_label not in kw:
                kw.append(new_label)
            pg_update["keywords"] = kw
            repo.update_segment(segment_id, pg_update)

    # Fetch updated segment
    return await get_segment(segment_id, profile)


@router.delete("/{segment_id}")
async def delete_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete a segment."""
    logger.info(f"[Profile {profile.profile_id}] Deleting segment: {segment_id}")
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    source_video_id = seg["source_video_id"]

    # Delete from database
    repo.delete_segment(segment_id)

    _refresh_segments_count(repo, source_video_id, profile.profile_id)

    # Delete files
    if seg.get("extracted_video_path"):
        Path(seg["extracted_video_path"]).unlink(missing_ok=True)
    if seg.get("thumbnail_path"):
        Path(seg["thumbnail_path"]).unlink(missing_ok=True)

    return {"status": "deleted", "id": segment_id}


@router.post("/{segment_id}/favorite")
async def toggle_favorite(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Toggle favorite status for a segment."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    new_status = not seg.get("is_favorite", False)
    repo.update_segment(segment_id, {"is_favorite": new_status})

    return {"id": segment_id, "is_favorite": new_status}


@router.post("/{segment_id}/single-use")
async def toggle_single_use(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Toggle single_use status for a segment."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    new_status = not seg.get("single_use", False)
    repo.update_segment(segment_id, {"single_use": new_status})

    return {"id": segment_id, "single_use": new_status}


@router.put("/{segment_id}/transforms")
async def update_segment_transforms(
    segment_id: str,
    transforms: SegmentTransformInput,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update transforms for a segment (quick dedicated endpoint)."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    repo.update_segment(segment_id, {"transforms": transforms.model_dump()})

    return {"id": segment_id, "transforms": transforms.model_dump()}


@router.put("/bulk-transforms")
async def bulk_update_transforms(
    request: BulkTransformRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Apply transforms to multiple segments at once (set or add mode).

    NOTE (T-82-01-02 — accepted): per-id loop with silent skip of non-owned
    segment IDs preserves observable behavior of the pre-migration
    `in_(ids).eq(profile_id)` chain (rows for other profiles are never
    returned or updated). No 403 for partial unauthorized list.
    """
    repo = get_repository()

    if not request.segment_ids:
        return {"updated": 0, "segments": []}

    new_transforms = request.transforms.model_dump()

    if request.mode == "add":
        # Fetch owned segments via in_ + profile-scoped list_segments
        existing_result = repo.list_segments(
            profile.profile_id,
            QueryFilters(in_={"id": request.segment_ids}, select="id, transforms"),
        )

        if not existing_result.data:
            raise HTTPException(status_code=404, detail="No segments found")

        results = []
        for seg in existing_result.data:
            current = seg.get("transforms") or {}
            merged = {
                "rotation": (current.get("rotation", 0) + new_transforms["rotation"]) % 360,
                "scale": max(0.1, min(5.0, current.get("scale", 1.0) + (new_transforms["scale"] - 1.0))),
                "pan_x": current.get("pan_x", 0) + new_transforms["pan_x"],
                "pan_y": current.get("pan_y", 0) + new_transforms["pan_y"],
                "flip_h": current.get("flip_h", False) ^ new_transforms["flip_h"],
                "flip_v": current.get("flip_v", False) ^ new_transforms["flip_v"],
                "opacity": max(0.0, min(1.0, current.get("opacity", 1.0) + (new_transforms["opacity"] - 1.0))),
            }
            repo.update_segment(seg["id"], {"transforms": merged})
            results.append({"id": seg["id"], "transforms": merged})

        return {"updated": len(results), "segments": results}
    else:
        # "set" mode — per-id loop with ownership check (T-82-01-02 silent skip)
        updated_segments = []
        for sid in request.segment_ids:
            seg = repo.get_segment(sid)
            if not seg or seg.get("profile_id") != profile.profile_id:
                # Silent skip — preserves pre-migration in_+eq(profile_id) semantics
                continue
            repo.update_segment(sid, {"transforms": new_transforms})
            updated_segments.append({"id": sid, "transforms": new_transforms})

        return {"updated": len(updated_segments), "segments": updated_segments}


@router.put("/projects/{project_id}/segments/{segment_id}/transforms")
async def update_project_segment_transforms(
    project_id: str,
    segment_id: str,
    transforms: SegmentTransformInput,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update per-project transform overrides for a segment."""
    repo = get_repository()

    # Verify project belongs to profile (T-82-01-01 IDOR pattern)
    project = repo.get_project(project_id)
    if not project or project.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Find the matching project-segment assignment via list + filter
    assignments = repo.list_project_segments(
        project_id,
        QueryFilters(eq={"segment_id": segment_id}, select="id"),
    )
    if not assignments.data:
        raise HTTPException(status_code=404, detail="Project-segment assignment not found")

    ps_id = assignments.data[0]["id"]
    repo.update_project_segment(ps_id, {"transforms": transforms.model_dump()})

    return {"project_id": project_id, "segment_id": segment_id, "transforms": transforms.model_dump()}


@router.post("/{segment_id}/extract")
async def extract_segment(
    segment_id: str,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Extract segment to a separate video file."""
    logger.info(f"[Profile {profile.profile_id}] Extracting segment: {segment_id}")
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Fetch source video — segment ownership implies source-video ownership per schema
    source_video = repo.get_source_video(seg["source_video_id"])
    if not source_video:
        raise HTTPException(status_code=404, detail="Source video not found")

    source_path = Path(normalize_path(source_video["file_path"]))

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source video file not found")

    # Output path
    settings = get_settings()
    segments_dir = settings.base_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    output_path = segments_dir / f"{segment_id}_extracted.mp4"

    # Extract in background
    def do_extract():
        try:
            logger.info(f"[Profile {profile.profile_id}] Background extraction started for segment: {segment_id}")
            success = _extract_segment_video(
                source_path,
                output_path,
                seg["start_time"],
                seg["end_time"]
            )
            if success:
                repo.update_segment(segment_id, {
                    "extracted_video_path": str(output_path)
                })
                logger.info(f"[Profile {profile.profile_id}] Segment {segment_id} extraction completed successfully")
            else:
                logger.error(f"[Profile {profile.profile_id}] Segment {segment_id} extraction failed (FFmpeg returned non-zero)")
        except Exception as e:
            logger.error(f"[Profile {profile.profile_id}] Segment {segment_id} extraction error: {e}", exc_info=True)

    background_tasks.add_task(do_extract)

    return {"status": "extracting", "segment_id": segment_id}


@router.get("/{segment_id}/stream")
async def stream_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Stream a segment (extracted or from source)."""
    repo = get_repository()

    # Ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    # If extracted file exists, serve it
    if seg.get("extracted_video_path"):
        path = Path(normalize_path(seg["extracted_video_path"]))
        if path.exists():
            return FileResponse(path=str(path), media_type="video/mp4", headers={"Cache-Control": "public, max-age=3600"})

    # Otherwise, stream from source with time range
    # Note: For now, return 404 if not extracted
    # A more complex implementation would use ffmpeg to stream the segment on-the-fly
    raise HTTPException(
        status_code=404,
        detail="Segment not extracted. Call /extract first."
    )


# ============== PRODUCT GROUPS ENDPOINTS ==============

@router.post("/source-videos/{video_id}/product-groups", response_model=ProductGroupResponse)
async def create_product_group(
    video_id: str,
    group: ProductGroupCreate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Create a product group for a source video."""
    repo = get_repository()

    # Verify source video (T-82-01-01 IDOR pattern)
    video = repo.get_source_video(video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    # Validate times against video duration
    _validate_time_range(group.start_time, group.end_time, video.get("duration"))

    # Auto-assign color from palette if not provided
    if not group.color:
        existing_result = repo.list_product_groups(
            profile.profile_id,
            QueryFilters(eq={"source_video_id": video_id}, select="color"),
        )
        existing_rows = existing_result.data
        used_colors = {g["color"] for g in existing_rows if g.get("color")}
        group.color = next(
            (c for c in _PRODUCT_GROUP_COLORS if c not in used_colors),
            _PRODUCT_GROUP_COLORS[len(existing_rows) % len(_PRODUCT_GROUP_COLORS)]
        )

    group_id = str(uuid.uuid4())
    repo.create_product_group({
        "id": group_id,
        "source_video_id": video_id,
        "profile_id": profile.profile_id,
        "label": group.label,
        "start_time": group.start_time,
        "end_time": group.end_time,
        "color": group.color,
    })

    # Reassign all segments for this video (helper now takes no supabase arg)
    await asyncio.to_thread(_reassign_all_segments, video_id, profile.profile_id)

    # Count segments in this group
    seg_count_result = repo.table_query(
        "editai_segments",
        "select",
        filters=QueryFilters(
            select="id",
            count="exact",
            eq={
                "source_video_id": video_id,
                "profile_id": profile.profile_id,
                "product_group": group.label,
            },
        ),
    )

    return ProductGroupResponse(
        id=group_id,
        source_video_id=video_id,
        label=group.label,
        start_time=group.start_time,
        end_time=group.end_time,
        color=group.color,
        segments_count=seg_count_result.count or 0,
        created_at=datetime.now(timezone.utc).isoformat()
    )


@router.get("/source-videos/{video_id}/product-groups", response_model=List[ProductGroupResponse])
async def list_product_groups(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all product groups for a source video.

    NOTE (Phase 82 schema drift): the SQLite editai_product_groups table differs
    from Supabase — it lacks source_video_id / label / start_time / end_time / color
    columns. This route returns 500 in SQLite mode, accepted per Phase 80 / 81
    dual-gate precedent. 82-03 documents this as a deferred item.
    """
    repo = get_repository()

    result = repo.list_product_groups(
        profile.profile_id,
        QueryFilters(eq={"source_video_id": video_id}, order_by="start_time"),
    )

    groups = []
    for g in result.data:
        seg_count_result = repo.table_query(
            "editai_segments",
            "select",
            filters=QueryFilters(
                select="id",
                count="exact",
                eq={
                    "source_video_id": video_id,
                    "profile_id": profile.profile_id,
                    "product_group": g["label"],
                },
            ),
        )

        groups.append(ProductGroupResponse(
            id=g["id"],
            source_video_id=g["source_video_id"],
            label=g["label"],
            start_time=g["start_time"],
            end_time=g["end_time"],
            color=g.get("color"),
            segments_count=seg_count_result.count or 0,
            created_at=g["created_at"]
        ))

    return groups


@router.patch("/product-groups/{group_id}", response_model=ProductGroupResponse)
async def update_product_group(
    group_id: str,
    update: ProductGroupUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update a product group."""
    repo = get_repository()

    update_data = {}
    if update.label is not None:
        update_data["label"] = update.label
    if update.start_time is not None:
        update_data["start_time"] = update.start_time
    if update.end_time is not None:
        update_data["end_time"] = update.end_time
    if update.color is not None:
        update_data["color"] = update.color

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Get current group to know old label and video_id (T-82-01-01 IDOR pattern)
    old = repo.get_product_group(group_id)
    if not old or old.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Product group not found")

    old_label = old["label"]

    # Validate times if being updated
    if update.start_time is not None or update.end_time is not None:
        effective_start = update.start_time if update.start_time is not None else old["start_time"]
        effective_end = update.end_time if update.end_time is not None else old["end_time"]

        if effective_start < 0:
            raise HTTPException(status_code=400, detail="Start time must be >= 0")

        video = repo.get_source_video(old["source_video_id"])
        video_duration = video.get("duration") if video else None

        _validate_time_range(effective_start, effective_end, video_duration)

    g = repo.update_product_group(group_id, update_data)

    if not g:
        raise HTTPException(status_code=404, detail="Product group not found")

    # If label changed, update segments that had the old label
    if update.label and update.label != old_label:
        segments_result = repo.list_segments(
            profile.profile_id,
            QueryFilters(
                eq={
                    "source_video_id": old["source_video_id"],
                    "product_group": old_label,
                },
                select="id, keywords",
            ),
        )
        for seg in segments_result.data:
            kw = list(seg.get("keywords") or [])
            if old_label in kw:
                kw[kw.index(old_label)] = update.label
            repo.update_segment(seg["id"], {"product_group": update.label, "keywords": kw})

    # If time range changed, reassign (helper now takes no supabase arg)
    if update.start_time is not None or update.end_time is not None:
        await asyncio.to_thread(_reassign_all_segments, old["source_video_id"], profile.profile_id)

    seg_count_result = repo.table_query(
        "editai_segments",
        "select",
        filters=QueryFilters(
            select="id",
            count="exact",
            eq={
                "source_video_id": g["source_video_id"],
                "profile_id": profile.profile_id,
                "product_group": g["label"],
            },
        ),
    )

    return ProductGroupResponse(
        id=g["id"],
        source_video_id=g["source_video_id"],
        label=g["label"],
        start_time=g["start_time"],
        end_time=g["end_time"],
        color=g.get("color"),
        segments_count=seg_count_result.count or 0,
        created_at=g["created_at"]
    )


@router.delete("/product-groups/{group_id}")
async def delete_product_group(
    group_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete a product group and unassign its segments."""
    repo = get_repository()

    # Get group info (T-82-01-01 IDOR pattern)
    g = repo.get_product_group(group_id)
    if not g or g.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Product group not found")

    # Clear product_group from affected segments
    segments_result = repo.list_segments(
        profile.profile_id,
        QueryFilters(
            eq={
                "source_video_id": g["source_video_id"],
                "product_group": g["label"],
            },
            select="id, keywords",
        ),
    )

    for seg in segments_result.data:
        kw = [k for k in (seg.get("keywords") or []) if k != g["label"]]
        repo.update_segment(seg["id"], {"product_group": None, "keywords": kw})

    # Delete group
    repo.delete_product_group(group_id)

    # Reassign remaining segments (might match other groups; helper now takes no supabase arg)
    await asyncio.to_thread(_reassign_all_segments, g["source_video_id"], profile.profile_id)

    return {"status": "deleted", "id": group_id}


@router.post("/source-videos/{video_id}/product-groups/reassign")
async def reassign_product_groups(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Batch reassign all segments to product groups based on overlap."""
    repo = get_repository()

    # Verify video (T-82-01-01 IDOR pattern)
    video = repo.get_source_video(video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    # Helper now takes no supabase arg
    await asyncio.to_thread(_reassign_all_segments, video_id, profile.profile_id)

    return {"status": "reassigned", "video_id": video_id}


# ============== SRT MATCHING ==============

@router.post("/match-srt", response_model=List[SegmentMatch])
async def match_segments_to_srt(
    request: SRTMatchRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Match segments to SRT content based on keywords, scoped to current profile."""
    repo = get_repository()

    # Parse SRT content
    srt_entries = _parse_srt(request.srt_content)

    # Get all segments with keywords (scoped to profile)
    result = repo.list_segments(
        profile.profile_id,
        QueryFilters(select="id, keywords"),
    )

    matches = []

    for seg in result.data:
        keywords = seg.get("keywords") or []
        if not keywords:
            continue

        for keyword in keywords:
            keyword_lower = keyword.lower()

            # Search in SRT entries
            for entry in srt_entries:
                text_lower = entry["text"].lower()
                if keyword_lower in text_lower:
                    # Calculate confidence based on word match
                    words = text_lower.split()
                    exact_match = keyword_lower in words
                    confidence = 1.0 if exact_match else 0.7

                    if confidence >= request.min_confidence:
                        matches.append(SegmentMatch(
                            segment_id=seg["id"],
                            keyword=keyword,
                            srt_timestamp=entry["start_time"],
                            confidence=confidence
                        ))

    # Sort by SRT timestamp
    matches.sort(key=lambda m: m.srt_timestamp)

    return matches


def _parse_srt(content: str) -> List[dict]:
    """Parse SRT content into list of entries with timestamps."""
    entries = []
    blocks = content.strip().split("\n\n")

    for block in blocks:
        lines = block.strip().split("\n")
        if len(lines) >= 3:
            # Parse timestamp line (format: 00:00:01,000 --> 00:00:03,000)
            time_line = lines[1]
            if " --> " in time_line:
                start_str, end_str = time_line.split(" --> ")
                start_time = _srt_time_to_seconds(start_str.strip())
                end_time = _srt_time_to_seconds(end_str.strip())
                text = " ".join(lines[2:])

                entries.append({
                    "start_time": start_time,
                    "end_time": end_time,
                    "text": text
                })

    return entries


def _srt_time_to_seconds(time_str: str) -> float:
    """Convert SRT time format to seconds."""
    try:
        time_str = time_str.replace(",", ".")
        parts = time_str.split(":")
        if len(parts) < 3:
            return 0.0
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return max(0.0, hours * 3600 + minutes * 60 + seconds)
    except Exception:
        return 0.0


# ============== PROJECT INTEGRATION ==============

@router.post("/projects/{project_id}/assign")
async def assign_segments_to_project(
    project_id: str,
    segment_ids: List[str] = Form(...),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Assign segments to a project."""
    logger.info(f"[Profile {profile.profile_id}] Assigning {len(segment_ids)} segments to project: {project_id}")
    repo = get_repository()

    # Verify project exists and belongs to profile (T-82-01-01 IDOR pattern)
    project = repo.get_project(project_id)
    if not project or project.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify all segments belong to the same profile via batch ownership check
    if segment_ids:
        owned_result = repo.list_segments(
            profile.profile_id,
            QueryFilters(in_={"id": segment_ids}, select="id"),
        )
        owned_ids = {s["id"] for s in (owned_result.data or [])}
        unauthorized = [sid for sid in segment_ids if sid not in owned_ids]
        if unauthorized:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: {len(unauthorized)} segment(s) do not belong to your profile"
            )

    # Clear existing assignments
    repo.delete_project_segments(project_id)

    # Insert new assignments
    for i, seg_id in enumerate(segment_ids):
        repo.create_project_segment({
            "project_id": project_id,
            "segment_id": seg_id,
            "sequence_order": i,
            "is_manual_selection": True
        })

    return {
        "status": "assigned",
        "project_id": project_id,
        "segments_count": len(segment_ids)
    }


@router.get("/projects/{project_id}/segments", response_model=List[SegmentResponse])
async def get_project_segments(
    project_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get segments assigned to a project."""
    repo = get_repository()

    # Verify project belongs to profile (T-82-01-01 IDOR pattern)
    project = repo.get_project(project_id)
    if not project or project.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Project not found")

    # Composed fetch (Phase 80 80-02 nested-join composition pattern)
    # Replaces PostgREST nested join "*, editai_segments(*, editai_source_videos(name))"
    # with per-row repo.get_segment + repo.get_source_video lookups (cached per id).
    ps_rows = repo.list_project_segments(
        project_id,
        QueryFilters(order_by="sequence_order"),
    ).data

    segments_cache: dict = {}
    sources_cache: dict = {}
    for ps in ps_rows:
        seg_id = ps.get("segment_id")
        if seg_id and seg_id not in segments_cache:
            segments_cache[seg_id] = repo.get_segment(seg_id) or {}
        src_id = (segments_cache.get(seg_id) or {}).get("source_video_id")
        if src_id and src_id not in sources_cache:
            sources_cache[src_id] = repo.get_source_video(src_id) or {}

    segments = []
    for ps in ps_rows:
        seg_id = ps.get("segment_id")
        s = segments_cache.get(seg_id) or {}
        if s:
            src = sources_cache.get(s.get("source_video_id")) or {}
            # Use project-level transform override if present, else segment default
            effective_transforms = ps.get("transforms") or s.get("transforms")
            segments.append(SegmentResponse(
                id=s["id"],
                source_video_id=s["source_video_id"],
                start_time=s["start_time"],
                end_time=s["end_time"],
                duration=s["end_time"] - s["start_time"],
                keywords=s.get("keywords") or [],
                extracted_video_path=s.get("extracted_video_path"),
                thumbnail_path=s.get("thumbnail_path"),
                usage_count=s.get("usage_count", 0),
                is_favorite=s.get("is_favorite", False),
                notes=s.get("notes"),
                transforms=effective_transforms,
                product_group=s.get("product_group"),
                created_at=s["created_at"],
                source_video_name=src.get("name")
            ))

    return segments


# ============== FRAME EXTRACTION ENDPOINT ==============

@router.get("/{segment_id}/frames")
async def extract_segment_frames(
    segment_id: str,
    count: int = Query(default=6, ge=1, le=12),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Extract candidate thumbnail frames from a segment's source video."""
    repo = get_repository()

    # Lookup segment + ownership check (T-82-01-01 IDOR pattern)
    seg = repo.get_segment(segment_id)
    if not seg or seg.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Lookup source video file path
    # (no ownership re-check on source — segment ownership is sufficient because
    # segments only exist for owned source videos per the schema)
    sv = repo.get_source_video(seg["source_video_id"])
    if not sv:
        raise HTTPException(status_code=404, detail="Source video not found")
    video_path = normalize_path(sv["file_path"])
    if not Path(video_path).exists():
        raise HTTPException(status_code=404, detail="Source video file not found on disk")

    settings = get_settings()
    output_dir = settings.base_dir / "segments"
    output_dir.mkdir(parents=True, exist_ok=True)

    start_t = float(seg["start_time"])
    end_t = float(seg["end_time"])
    duration = end_t - start_t
    if duration <= 0:
        raise HTTPException(status_code=400, detail="Segment has zero duration")

    frames = []
    for i in range(count):
        # Distribute timestamps evenly within the segment
        ts = start_t + (duration * (i + 0.5) / count)
        frame_filename = f"{segment_id}_frame_{i}.jpg"
        frame_path = output_dir / frame_filename

        # Cache: skip if already extracted
        if not frame_path.exists():
            cmd = [
                "ffmpeg", "-y",
                "-ss", f"{ts:.3f}",
                "-i", video_path,
                "-vframes", "1",
                "-vf", "scale=540:-1",
                "-q:v", "3",
                str(frame_path)
            ]
            result = safe_ffmpeg_run(cmd, timeout=15, operation=f"frame extract {segment_id}#{i}")
            if not result or result.returncode != 0:
                logger.warning(f"Frame extraction failed for segment {segment_id} frame {i}")
                continue

        frames.append({
            "index": i,
            "timestamp": round(ts, 3),
            "frame_url": frame_filename,
        })

    return frames


# ============== FILES ENDPOINT ==============

@router.get("/files/{file_path:path}")
async def serve_segment_file(
    file_path: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Serve segment files (thumbnails, extracted videos)."""
    settings = get_settings()

    from urllib.parse import unquote
    import os

    decoded_path = unquote(file_path)

    # Block path traversal attempts
    if '..' in decoded_path:
        raise HTTPException(status_code=403, detail="Invalid path")

    # Convert WSL paths to Windows paths if needed
    decoded_path = normalize_path(decoded_path)
    decoded_path = decoded_path.replace("\\", "/")
    full_path = Path(decoded_path)

    if not full_path.is_absolute():
        # Try segments directory
        full_path = settings.base_dir / "segments" / decoded_path
        if not full_path.exists():
            # Try source_videos directory
            full_path = settings.base_dir / "source_videos" / decoded_path

    # Security check
    try:
        full_path = full_path.resolve()
        allowed_dirs = [
            (settings.base_dir / "segments").resolve(),
            (settings.base_dir / "source_videos").resolve()
        ]

        is_allowed = any(
            full_path.is_relative_to(d)
            for d in allowed_dirs
        )

        if not is_allowed:
            raise HTTPException(status_code=403, detail="Access denied")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid path")

    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type
    suffix = full_path.suffix.lower()
    media_types = {
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png"
    }
    media_type = media_types.get(suffix, "application/octet-stream")

    return FileResponse(path=str(full_path), media_type=media_type)


@router.get("/source-videos/{video_id}/thumbnail")
async def serve_source_video_thumbnail(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Serve a source video's thumbnail, resolving against the CURRENT base_dir.

    Self-healing + path-portable. The stored ``thumbnail_path`` may be an absolute
    path from a previous environment (e.g. the project root in dev mode) that does
    not exist under the current ``base_dir`` (e.g. %APPDATA%\\EditFactory in desktop
    mode). Instead of trusting that path, we always recompute the expected location
    from ``base_dir`` + ``video_id``; if the file is missing we regenerate it from the
    original source video and persist the corrected path back to the DB so subsequent
    loads are instant.
    """
    repo = get_repository()

    video = await asyncio.to_thread(repo.get_source_video, video_id)
    if not video or video.get("profile_id") != profile.profile_id:
        raise HTTPException(status_code=404, detail="Source video not found")

    settings = get_settings()
    source_dir = settings.base_dir / "source_videos"
    thumb_path = source_dir / f"{video_id}_thumb.jpg"

    # Regenerate if the thumbnail is missing under the current base_dir.
    if not thumb_path.exists():
        src_raw = video.get("file_path")
        src = Path(normalize_path(src_raw)) if src_raw else None
        if not src or not src.exists():
            # Original video unavailable on this machine — let the UI fall back to its icon.
            raise HTTPException(status_code=404, detail="Thumbnail unavailable")

        source_dir.mkdir(parents=True, exist_ok=True)
        # Bound concurrency (preview semaphore) and run the sync FFmpeg call off the loop.
        async with await acquire_preview_slot():
            ok = await asyncio.to_thread(_generate_thumbnail, src, thumb_path, 1)
        if not ok or not thumb_path.exists():
            raise HTTPException(status_code=404, detail="Thumbnail unavailable")

        # Heal the DB so the corrected path is used next time (one-time cost).
        try:
            await asyncio.to_thread(
                repo.update_source_video, video_id, {"thumbnail_path": str(thumb_path)}
            )
        except Exception as e:
            logger.warning(f"Could not persist healed thumbnail_path for {video_id}: {e}")

    return FileResponse(
        path=str(thumb_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=300"},
    )
