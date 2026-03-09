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

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context
from app.api.validators import validate_file_mime_type, ALLOWED_VIDEO_MIMES
from app.utils import sanitize_filename as _sanitize_filename, normalize_path
from app.rate_limit import limiter
from app.services.ffmpeg_semaphore import get_prep_codec_params, safe_ffmpeg_run

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
    created_at: str

class SegmentCreate(BaseModel):
    start_time: float
    end_time: float
    keywords: List[str] = []
    notes: Optional[str] = None
    product_group: Optional[str] = None

class SegmentTransformInput(BaseModel):
    rotation: float = 0.0
    scale: float = 1.0
    pan_x: int = 0
    pan_y: int = 0
    flip_h: bool = False
    flip_v: bool = False
    opacity: float = 1.0

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

class ProductGroupCreate(BaseModel):
    label: str
    start_time: float
    end_time: float
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
    supabase, video_id: str, profile_id: str,
    seg_start: float, seg_end: float
) -> Optional[str]:
    """Auto-assign segment to product group if >50% overlap.

    Returns the group label if assigned, None otherwise.
    """
    groups = supabase.table("editai_product_groups")\
        .select("label, start_time, end_time")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile_id)\
        .execute()

    if not groups.data:
        return None

    seg_duration = seg_end - seg_start
    if seg_duration <= 0:
        return None

    best_label = None
    best_overlap = 0.0

    for g in groups.data:
        overlap_start = max(seg_start, g["start_time"])
        overlap_end = min(seg_end, g["end_time"])
        overlap = max(0, overlap_end - overlap_start)
        ratio = overlap / seg_duration

        if ratio > 0.5 and overlap > best_overlap:
            best_overlap = overlap
            best_label = g["label"]

    return best_label


def _reassign_all_segments(supabase, video_id: str, profile_id: str):
    """Reassign all segments for a video to their matching product groups."""
    segments = supabase.table("editai_segments")\
        .select("id, start_time, end_time, keywords, product_group")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile_id)\
        .execute()

    for seg in segments.data:
        new_label = _assign_product_group(
            supabase, video_id, profile_id,
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

        supabase.table("editai_segments")\
            .update(update_fields)\
            .eq("id", seg["id"])\
            .execute()


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
    supabase = repo.get_client()

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

        # Update DB with metadata and set status=ready
        supabase.table("editai_source_videos").update({
            "file_path": str(current_path),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "duration": video_info.get("duration"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "fps": video_info.get("fps"),
            "file_size_bytes": video_info.get("file_size_bytes"),
            "status": "ready",
        }).eq("id", video_id).execute()

        logger.info(f"[BG] Source video {video_id} ready")

    except Exception as e:
        logger.error(f"[BG] Failed to process source video {video_id}: {e}")
        try:
            supabase.table("editai_source_videos").update({
                "status": "error",
            }).eq("id", video_id).execute()
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

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
        supabase.table("editai_source_videos").insert({
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
        }).execute()
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    logger.info(f"[Profile {profile.profile_id}] Listing source videos")

    result = supabase.table("editai_source_videos")\
        .select("*")\
        .eq("profile_id", profile.profile_id)\
        .order("created_at", desc=True)\
        .limit(limit)\
        .offset(offset)\
        .execute()

    return [
        SourceVideoResponse(
            id=v["id"],
            name=v["name"],
            description=v.get("description"),
            file_path=v["file_path"],
            thumbnail_path=v.get("thumbnail_path"),
            duration=v.get("duration"),
            width=v.get("width"),
            height=v.get("height"),
            fps=v.get("fps"),
            file_size_bytes=v.get("file_size_bytes"),
            segments_count=v.get("segments_count", 0),
            status=v.get("status", "ready"),
            created_at=v["created_at"]
        )
        for v in result.data
    ]


@router.get("/source-videos/{video_id}", response_model=SourceVideoResponse)
async def get_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get source video details."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("*")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .limit(1)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    v = result.data[0]
    return SourceVideoResponse(
        id=v["id"],
        name=v["name"],
        description=v.get("description"),
        file_path=v["file_path"],
        thumbnail_path=v.get("thumbnail_path"),
        duration=v.get("duration"),
        width=v.get("width"),
        height=v.get("height"),
        fps=v.get("fps"),
        file_size_bytes=v.get("file_size_bytes"),
        segments_count=v.get("segments_count", 0),
        status=v.get("status", "ready"),
        created_at=v["created_at"]
    )


@router.delete("/source-videos/{video_id}")
async def delete_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete source video and all its segments."""
    logger.info(f"[Profile {profile.profile_id}] Deleting source video: {video_id}")
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get video info first (scoped to profile)
    result = supabase.table("editai_source_videos")\
        .select("file_path, thumbnail_path")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_data = result.data[0]

    # Get all segments to delete their files
    segments = supabase.table("editai_segments")\
        .select("extracted_video_path, thumbnail_path")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    # Delete segment files
    for seg in segments.data:
        if seg.get("extracted_video_path"):
            Path(seg["extracted_video_path"]).unlink(missing_ok=True)
        if seg.get("thumbnail_path"):
            Path(seg["thumbnail_path"]).unlink(missing_ok=True)

    # Delete from database (cascade will handle segments)
    supabase.table("editai_source_videos").delete()\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    # Delete source video files
    if video_data.get("file_path"):
        Path(normalize_path(video_data["file_path"])).unlink(missing_ok=True)
    if video_data.get("thumbnail_path"):
        Path(video_data["thumbnail_path"]).unlink(missing_ok=True)

    return {"status": "deleted", "id": video_id}


@router.get("/source-videos/{video_id}/stream")
async def stream_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Stream source video for playback."""
    effective_profile_id = profile.profile_id

    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = await asyncio.to_thread(
        lambda: supabase.table("editai_source_videos")
            .select("file_path")
            .eq("id", video_id)
            .eq("profile_id", effective_profile_id)
            .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(result.data[0]["file_path"]))
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

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
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"FFmpeg waveform extraction failed: {result.stderr[:500] if result.stderr else b''}")
            return []
        raw = result.stdout
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
    effective_profile_id = profile.profile_id

    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("file_path, duration")\
        .eq("id", video_id)\
        .eq("profile_id", effective_profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(result.data[0]["file_path"]))
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    duration = result.data[0].get("duration") or 0

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("file_path")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(normalize_path(result.data[0]["file_path"]))
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify source video exists and belongs to profile
    video_result = supabase.table("editai_source_videos")\
        .select("file_path, name")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not video_result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    source_video = video_result.data[0]

    # Validate times
    if segment.end_time <= segment.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")

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
        result = supabase.table("editai_segments").insert({
            "id": segment_id,
            "source_video_id": video_id,
            "profile_id": profile.profile_id,
            "start_time": segment.start_time,
            "end_time": segment.end_time,
            "keywords": segment.keywords,
            "notes": segment.notes,
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "usage_count": 0,
            "is_favorite": False
        }).execute()

        # Auto-assign product group if groups exist
        assigned_group = await asyncio.to_thread(_assign_product_group, supabase, video_id, profile.profile_id, segment.start_time, segment.end_time)
        product_group_label = assigned_group or segment.product_group

        # If assigned, store in DB and add label as keyword
        if product_group_label:
            update_fields = {"product_group": product_group_label}
            kw = list(segment.keywords)
            if product_group_label not in kw:
                kw.append(product_group_label)
                update_fields["keywords"] = kw
            supabase.table("editai_segments").update(update_fields).eq("id", segment_id).execute()

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_segments")\
        .select("*, editai_source_videos(name)")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .order("start_time")\
        .limit(limit)\
        .offset(offset)\
        .execute()

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
            source_video_name=s.get("editai_source_videos", {}).get("name")
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    query = supabase.table("editai_segments")\
        .select("*, editai_source_videos(name)")\
        .eq("profile_id", profile.profile_id)

    if source_video_id:
        query = query.eq("source_video_id", source_video_id)

    if favorites_only:
        query = query.eq("is_favorite", True)

    if keyword:
        # PostgreSQL array contains
        query = query.contains("keywords", [keyword])

    result = query.order("created_at", desc=True).limit(limit).offset(offset).execute()

    segments = []
    for s in result.data:
        duration = s["end_time"] - s["start_time"]

        # Filter by duration (post-query since Supabase doesn't support computed columns)
        if min_duration and duration < min_duration:
            continue
        if max_duration and duration > max_duration:
            continue

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
            source_video_name=s.get("editai_source_videos", {}).get("name")
        ))

    return segments


@router.get("/product-groups-bulk", response_model=List[ProductGroupResponse])
async def list_product_groups_bulk(
    source_video_ids: str = Query(..., description="Comma-separated source video IDs"),
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all product groups for multiple source videos in one query.

    Avoids N+1 queries when the pipeline page needs groups for all selected source videos.
    Must be placed before /{segment_id} to avoid the catch-all parameterized route matching
    the literal string "product-groups-bulk".
    """
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    ids = [vid.strip() for vid in source_video_ids.split(",") if vid.strip()]
    if not ids:
        return []
    if len(ids) > 50:
        raise HTTPException(status_code=400, detail="Too many IDs (max 50)")

    try:
        result = supabase.table("editai_product_groups")\
            .select("*")\
            .in_("source_video_id", ids)\
            .eq("profile_id", profile.profile_id)\
            .order("start_time")\
            .execute()

        group_labels = [g["label"] for g in result.data]
        seg_counts = {}
        if group_labels:
            count_result = supabase.table("editai_segments")\
                .select("product_group", count="exact")\
                .in_("source_video_id", ids)\
                .eq("profile_id", profile.profile_id)\
                .in_("product_group", group_labels)\
                .execute()
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_segments")\
        .select("*, editai_source_videos(name)")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    s = result.data[0]
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
        source_video_name=s.get("editai_source_videos", {}).get("name")
    )


@router.patch("/{segment_id}", response_model=SegmentResponse)
async def update_segment(
    segment_id: str,
    update: SegmentUpdate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update segment (keywords, times, notes)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Build update dict with only provided fields
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}

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

    # Validate times
    if update.start_time is not None and update.start_time < 0:
        raise HTTPException(status_code=400, detail="Start time must be >= 0")
    if update.end_time is not None and update.end_time < 0:
        raise HTTPException(status_code=400, detail="End time must be >= 0")
    if update.start_time is not None and update.end_time is not None:
        if update.end_time <= update.start_time:
            raise HTTPException(status_code=400, detail="End time must be after start time")

    result = supabase.table("editai_segments")\
        .update(update_data)\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Re-check product group assignment if times changed
    if update.start_time is not None or update.end_time is not None:
        updated = result.data[0]
        new_label = await asyncio.to_thread(
            _assign_product_group,
            supabase, updated["source_video_id"], profile.profile_id,
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
            supabase.table("editai_segments").update(pg_update).eq("id", segment_id).execute()

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get segment data first (scoped to profile)
    result = supabase.table("editai_segments")\
        .select("source_video_id, extracted_video_path, thumbnail_path")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = result.data[0]
    source_video_id = seg["source_video_id"]

    # Delete from database
    supabase.table("editai_segments").delete()\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get current status (scoped to profile)
    result = supabase.table("editai_segments")\
        .select("is_favorite")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    current = result.data[0]["is_favorite"]
    new_status = not current

    supabase.table("editai_segments")\
        .update({"is_favorite": new_status, "updated_at": datetime.now(timezone.utc).isoformat()})\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    return {"id": segment_id, "is_favorite": new_status}


@router.put("/{segment_id}/transforms")
async def update_segment_transforms(
    segment_id: str,
    transforms: SegmentTransformInput,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update transforms for a segment (quick dedicated endpoint)."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_segments")\
        .update({
            "transforms": transforms.model_dump(),
        })\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    return {"id": segment_id, "transforms": transforms.model_dump()}


@router.put("/projects/{project_id}/segments/{segment_id}/transforms")
async def update_project_segment_transforms(
    project_id: str,
    segment_id: str,
    transforms: SegmentTransformInput,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Update per-project transform overrides for a segment."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify project belongs to profile
    project = supabase.table("editai_projects")\
        .select("id")\
        .eq("id", project_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")

    result = supabase.table("editai_project_segments")\
        .update({"transforms": transforms.model_dump()})\
        .eq("project_id", project_id)\
        .eq("segment_id", segment_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Project-segment assignment not found")

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get segment and source video info (scoped to profile)
    result = supabase.table("editai_segments")\
        .select("*, editai_source_videos(file_path)")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = result.data[0]
    source_path = Path(normalize_path(seg["editai_source_videos"]["file_path"]))

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
                supabase.table("editai_segments")\
                    .update({
                        "extracted_video_path": str(output_path),
                        "updated_at": datetime.now(timezone.utc).isoformat()
                    })\
                    .eq("id", segment_id)\
                    .eq("profile_id", profile.profile_id)\
                    .execute()
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_segments")\
        .select("extracted_video_path, start_time, end_time, editai_source_videos(file_path)")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = result.data[0]

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify source video
    video = supabase.table("editai_source_videos")\
        .select("id")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()
    if not video.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    if group.end_time <= group.start_time:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    # Auto-assign color from palette if not provided
    if not group.color:
        existing = supabase.table("editai_product_groups")\
            .select("color")\
            .eq("source_video_id", video_id)\
            .eq("profile_id", profile.profile_id)\
            .execute()
        used_colors = {g["color"] for g in existing.data if g.get("color")}
        group.color = next(
            (c for c in _PRODUCT_GROUP_COLORS if c not in used_colors),
            _PRODUCT_GROUP_COLORS[len(existing.data) % len(_PRODUCT_GROUP_COLORS)]
        )

    group_id = str(uuid.uuid4())
    result = supabase.table("editai_product_groups").insert({
        "id": group_id,
        "source_video_id": video_id,
        "profile_id": profile.profile_id,
        "label": group.label,
        "start_time": group.start_time,
        "end_time": group.end_time,
        "color": group.color,
    }).execute()

    # Reassign all segments for this video
    await asyncio.to_thread(_reassign_all_segments, supabase, video_id, profile.profile_id)

    # Count segments in this group
    seg_count = supabase.table("editai_segments")\
        .select("id", count="exact")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .eq("product_group", group.label)\
        .execute()

    return ProductGroupResponse(
        id=group_id,
        source_video_id=video_id,
        label=group.label,
        start_time=group.start_time,
        end_time=group.end_time,
        color=group.color,
        segments_count=seg_count.count or 0,
        created_at=datetime.now(timezone.utc).isoformat()
    )


@router.get("/source-videos/{video_id}/product-groups", response_model=List[ProductGroupResponse])
async def list_product_groups(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all product groups for a source video."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_product_groups")\
        .select("*")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .order("start_time")\
        .execute()

    groups = []
    for g in result.data:
        seg_count = supabase.table("editai_segments")\
            .select("id", count="exact")\
            .eq("source_video_id", video_id)\
            .eq("profile_id", profile.profile_id)\
            .eq("product_group", g["label"])\
            .execute()

        groups.append(ProductGroupResponse(
            id=g["id"],
            source_video_id=g["source_video_id"],
            label=g["label"],
            start_time=g["start_time"],
            end_time=g["end_time"],
            color=g.get("color"),
            segments_count=seg_count.count or 0,
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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

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

    # Get current group to know old label and video_id
    current = supabase.table("editai_product_groups")\
        .select("*")\
        .eq("id", group_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not current.data:
        raise HTTPException(status_code=404, detail="Product group not found")

    old = current.data[0]
    old_label = old["label"]

    result = supabase.table("editai_product_groups")\
        .update(update_data)\
        .eq("id", group_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Product group not found")

    # If label changed, update segments that had the old label
    if update.label and update.label != old_label:
        segments = supabase.table("editai_segments")\
            .select("id, keywords")\
            .eq("source_video_id", old["source_video_id"])\
            .eq("profile_id", profile.profile_id)\
            .eq("product_group", old_label)\
            .execute()
        for seg in segments.data:
            kw = list(seg.get("keywords") or [])
            if old_label in kw:
                kw[kw.index(old_label)] = update.label
            supabase.table("editai_segments")\
                .update({"product_group": update.label, "keywords": kw})\
                .eq("id", seg["id"]).execute()

    # If time range changed, reassign
    if update.start_time is not None or update.end_time is not None:
        await asyncio.to_thread(_reassign_all_segments, supabase, old["source_video_id"], profile.profile_id)

    g = result.data[0]
    seg_count = supabase.table("editai_segments")\
        .select("id", count="exact")\
        .eq("source_video_id", g["source_video_id"])\
        .eq("profile_id", profile.profile_id)\
        .eq("product_group", g["label"])\
        .execute()

    return ProductGroupResponse(
        id=g["id"],
        source_video_id=g["source_video_id"],
        label=g["label"],
        start_time=g["start_time"],
        end_time=g["end_time"],
        color=g.get("color"),
        segments_count=seg_count.count or 0,
        created_at=g["created_at"]
    )


@router.delete("/product-groups/{group_id}")
async def delete_product_group(
    group_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete a product group and unassign its segments."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get group info
    group = supabase.table("editai_product_groups")\
        .select("*")\
        .eq("id", group_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not group.data:
        raise HTTPException(status_code=404, detail="Product group not found")

    g = group.data[0]

    # Clear product_group from affected segments
    segments = supabase.table("editai_segments")\
        .select("id, keywords")\
        .eq("source_video_id", g["source_video_id"])\
        .eq("profile_id", profile.profile_id)\
        .eq("product_group", g["label"])\
        .execute()

    for seg in segments.data:
        kw = [k for k in (seg.get("keywords") or []) if k != g["label"]]
        supabase.table("editai_segments")\
            .update({"product_group": None, "keywords": kw})\
            .eq("id", seg["id"]).execute()

    # Delete group
    supabase.table("editai_product_groups")\
        .delete()\
        .eq("id", group_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    # Reassign remaining segments (might match other groups)
    await asyncio.to_thread(_reassign_all_segments, supabase, g["source_video_id"], profile.profile_id)

    return {"status": "deleted", "id": group_id}


@router.post("/source-videos/{video_id}/product-groups/reassign")
async def reassign_product_groups(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Batch reassign all segments to product groups based on overlap."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify video
    video = supabase.table("editai_source_videos")\
        .select("id")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()
    if not video.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    await asyncio.to_thread(_reassign_all_segments, supabase, video_id, profile.profile_id)

    return {"status": "reassigned", "video_id": video_id}


# ============== SRT MATCHING ==============

@router.post("/match-srt", response_model=List[SegmentMatch])
async def match_segments_to_srt(
    request: SRTMatchRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Match segments to SRT content based on keywords, scoped to current profile."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Parse SRT content
    srt_entries = _parse_srt(request.srt_content)

    # Get all segments with keywords (scoped to profile)
    result = supabase.table("editai_segments")\
        .select("id, keywords")\
        .eq("profile_id", profile.profile_id)\
        .execute()

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify project exists and belongs to profile
    project = supabase.table("editai_projects")\
        .select("id")\
        .eq("id", project_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")

    # Clear existing assignments
    supabase.table("editai_project_segments")\
        .delete()\
        .eq("project_id", project_id)\
        .execute()

    # Insert new assignments
    for i, seg_id in enumerate(segment_ids):
        supabase.table("editai_project_segments").insert({
            "project_id": project_id,
            "segment_id": seg_id,
            "sequence_order": i,
            "is_manual_selection": True
        }).execute()

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
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")
    supabase = repo.get_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify project belongs to profile
    project = supabase.table("editai_projects")\
        .select("id")\
        .eq("id", project_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not project.data:
        raise HTTPException(status_code=404, detail="Project not found")

    result = supabase.table("editai_project_segments")\
        .select("*, editai_segments(*, editai_source_videos(name))")\
        .eq("project_id", project_id)\
        .order("sequence_order")\
        .execute()

    segments = []
    for ps in result.data:
        s = ps.get("editai_segments", {})
        if s:
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
                source_video_name=s.get("editai_source_videos", {}).get("name")
            ))

    return segments


# ============== FILES ENDPOINT ==============

@router.get("/files/{file_path:path}")
async def serve_segment_file(file_path: str):
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
