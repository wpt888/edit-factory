"""
EditAI Segments Routes
Manual video segment selection system - Source videos, segments, and matching.
"""
import uuid
import subprocess
import json
import struct
import math
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Query, Depends
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.config import get_settings
from app.api.auth import ProfileContext, get_profile_context

import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/segments", tags=["segments"])

from app.db import get_supabase


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
    created_at: str

class SegmentCreate(BaseModel):
    start_time: float
    end_time: float
    keywords: List[str] = []
    notes: Optional[str] = None

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
    created_at: str
    # Joined data
    source_video_name: Optional[str] = None

class SegmentUpdate(BaseModel):
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    keywords: Optional[List[str]] = None
    notes: Optional[str] = None
    transforms: Optional[SegmentTransformInput] = None

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
        result = subprocess.run(cmd, capture_output=True, text=True)
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
        result = subprocess.run(cmd, capture_output=True)
        return result.returncode == 0
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
            "ffmpeg", "-y",
            "-ss", str(start_time),
            "-i", str(source_path),
            "-t", str(duration),
            "-c:v", "libx264",
            "-c:a", "aac",
            "-preset", "fast",
            str(output_path)
        ]
        result = subprocess.run(cmd, capture_output=True)
        return result.returncode == 0
    except Exception as e:
        logger.error(f"Failed to extract segment: {e}")
        return False

def _sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe storage."""
    import re
    if not filename:
        return "unnamed"
    safe_name = Path(filename).name
    safe_name = re.sub(r'[^\w\-_\.]', '_', safe_name)
    if len(safe_name) > 100:
        safe_name = safe_name[:100]
    return safe_name or "unnamed"


# ============== SOURCE VIDEOS ENDPOINTS ==============

@router.post("/source-videos", response_model=SourceVideoResponse)
async def upload_source_video(
    video: UploadFile = File(...),
    name: str = Form(...),
    description: Optional[str] = Form(default=None),
    profile: ProfileContext = Depends(get_profile_context)
):
    """Upload a source video for segment extraction."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    logger.info(f"[Profile {profile.profile_id}] Uploading source video: {name}")

    settings = get_settings()
    settings.ensure_dirs()

    # Generate unique ID and save video
    video_id = str(uuid.uuid4())
    safe_filename = _sanitize_filename(video.filename)

    # Create source_videos directory
    source_dir = settings.base_dir / "source_videos"
    source_dir.mkdir(parents=True, exist_ok=True)

    video_path = source_dir / f"{video_id}_{safe_filename}"

    # Save uploaded file
    with open(video_path, "wb") as f:
        content = await video.read()
        f.write(content)

    # Auto-transcode non-mp4 formats to .mp4 for browser compatibility
    non_mp4_formats = {'.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'}
    if video_path.suffix.lower() in non_mp4_formats:
        mp4_path = video_path.with_suffix('.mp4')
        logger.info(f"Transcoding {video_path.suffix} to .mp4: {video_path.name}")
        try:
            cmd = [
                "ffmpeg", "-y", "-i", str(video_path),
                "-c:v", "libx264", "-c:a", "aac", "-preset", "fast",
                str(mp4_path)
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if result.returncode == 0:
                video_path.unlink()  # remove original
                video_path = mp4_path
                logger.info(f"Transcode successful: {mp4_path.name}")
            else:
                logger.error(f"Transcode failed: {result.stderr}")
                # Keep original file, continue with it
        except subprocess.TimeoutExpired:
            logger.error(f"Transcode timed out for {video_path.name}")
            if mp4_path.exists():
                mp4_path.unlink(missing_ok=True)
        except Exception as e:
            logger.error(f"Transcode error: {e}")

    # Get video metadata
    video_info = _get_video_info(video_path)

    # Generate thumbnail
    thumbnail_path = source_dir / f"{video_id}_thumb.jpg"
    _generate_thumbnail(video_path, thumbnail_path, timestamp=1)

    # Save to database
    try:
        result = supabase.table("editai_source_videos").insert({
            "id": video_id,
            "profile_id": profile.profile_id,
            "name": name,
            "description": description,
            "file_path": str(video_path),
            "thumbnail_path": str(thumbnail_path) if thumbnail_path.exists() else None,
            "duration": video_info.get("duration"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "fps": video_info.get("fps"),
            "file_size_bytes": video_info.get("file_size_bytes"),
            "segments_count": 0
        }).execute()

        return SourceVideoResponse(
            id=video_id,
            name=name,
            description=description,
            file_path=str(video_path),
            thumbnail_path=str(thumbnail_path) if thumbnail_path.exists() else None,
            duration=video_info.get("duration"),
            width=video_info.get("width"),
            height=video_info.get("height"),
            fps=video_info.get("fps"),
            file_size_bytes=video_info.get("file_size_bytes"),
            segments_count=0,
            created_at=datetime.now().isoformat()
        )
    except Exception as e:
        # Cleanup on failure
        video_path.unlink(missing_ok=True)
        thumbnail_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save video: {e}")


@router.get("/source-videos", response_model=List[SourceVideoResponse])
async def list_source_videos(
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all source videos for the current profile."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    logger.info(f"[Profile {profile.profile_id}] Listing source videos")

    result = supabase.table("editai_source_videos")\
        .select("*")\
        .eq("profile_id", profile.profile_id)\
        .order("created_at", desc=True)\
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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("*")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
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
        created_at=v["created_at"]
    )


@router.delete("/source-videos/{video_id}")
async def delete_source_video(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete source video and all its segments."""
    logger.info(f"[Profile {profile.profile_id}] Deleting source video: {video_id}")
    supabase = get_supabase()
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
        Path(video_data["file_path"]).unlink(missing_ok=True)
    if video_data.get("thumbnail_path"):
        Path(video_data["thumbnail_path"]).unlink(missing_ok=True)

    return {"status": "deleted", "id": video_id}


@router.get("/source-videos/{video_id}/stream")
async def stream_source_video(
    video_id: str,
):
    """Stream source video for playback.

    NOTE: No profile auth required - the <video> element makes direct browser
    requests without custom headers. Video IDs are UUIDs so they're unguessable.
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("file_path")\
        .eq("id", video_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(result.data[0]["file_path"])
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
        filename=video_path.name,
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
        "-ac", "1",          # mono
        "-ar", "8000",       # 8kHz — enough for waveform viz
        "-f", "s16le",       # raw signed 16-bit little-endian
        "-acodec", "pcm_s16le",
        "pipe:1"
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"FFmpeg waveform extraction failed: {result.stderr[:500]}")
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
):
    """Get audio waveform data for visualization.

    No auth required — same pattern as /stream (UUID is unguessable).
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("file_path, duration")\
        .eq("id", video_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(result.data[0]["file_path"])
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    duration = result.data[0].get("duration") or 0

    waveform = _extract_waveform(str(video_path), num_samples=samples, duration=duration)

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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_source_videos")\
        .select("file_path")\
        .eq("id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Source video not found")

    video_path = Path(result.data[0]["file_path"])
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
        raise HTTPException(status_code=500, detail=f"Voice detection failed: {e}")


# ============== SEGMENTS ENDPOINTS ==============

@router.post("/source-videos/{video_id}/segments", response_model=SegmentResponse)
async def create_segment(
    video_id: str,
    segment: SegmentCreate,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Create a new segment for a source video."""
    logger.info(f"[Profile {profile.profile_id}] Creating segment for source video: {video_id}")
    supabase = get_supabase()
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
    _generate_thumbnail(Path(source_video["file_path"]), thumbnail_path, midpoint)

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

        return SegmentResponse(
            id=segment_id,
            source_video_id=video_id,
            start_time=segment.start_time,
            end_time=segment.end_time,
            duration=duration,
            keywords=segment.keywords,
            extracted_video_path=None,
            thumbnail_path=str(thumbnail_path) if thumbnail_path.exists() else None,
            usage_count=0,
            is_favorite=False,
            notes=segment.notes,
            transforms=None,
            created_at=datetime.now().isoformat(),
            source_video_name=source_video.get("name")
        )
    except Exception as e:
        thumbnail_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to create segment: {e}")


@router.get("/source-videos/{video_id}/segments", response_model=List[SegmentResponse])
async def list_video_segments(
    video_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all segments for a source video."""
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    result = supabase.table("editai_segments")\
        .select("*, editai_source_videos(name)")\
        .eq("source_video_id", video_id)\
        .eq("profile_id", profile.profile_id)\
        .order("start_time")\
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
    profile: ProfileContext = Depends(get_profile_context)
):
    """List all segments (library view) with optional filters, scoped to current profile."""
    supabase = get_supabase()
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

    result = query.order("created_at", desc=True).execute()

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
            created_at=s["created_at"],
            source_video_name=s.get("editai_source_videos", {}).get("name")
        ))

    return segments


@router.get("/{segment_id}", response_model=SegmentResponse)
async def get_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Get segment details."""
    supabase = get_supabase()
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
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Build update dict with only provided fields
    update_data = {"updated_at": datetime.now().isoformat()}

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

    # Validate times if both provided
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

    # Fetch updated segment
    return await get_segment(segment_id, profile)


@router.delete("/{segment_id}")
async def delete_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Delete a segment."""
    logger.info(f"[Profile {profile.profile_id}] Deleting segment: {segment_id}")
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")

    # Get segment files first (scoped to profile)
    result = supabase.table("editai_segments")\
        .select("extracted_video_path, thumbnail_path")\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Segment not found")

    seg = result.data[0]

    # Delete from database
    supabase.table("editai_segments").delete()\
        .eq("id", segment_id)\
        .eq("profile_id", profile.profile_id)\
        .execute()

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
    supabase = get_supabase()
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
        .update({"is_favorite": new_status, "updated_at": datetime.now().isoformat()})\
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
    supabase = get_supabase()
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
    supabase = get_supabase()
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
    supabase = get_supabase()
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
    source_path = Path(seg["editai_source_videos"]["file_path"])

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Source video file not found")

    # Output path
    settings = get_settings()
    segments_dir = settings.base_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    output_path = segments_dir / f"{segment_id}_extracted.mp4"

    # Extract in background
    def do_extract():
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
                    "updated_at": datetime.now().isoformat()
                })\
                .eq("id", segment_id)\
                .eq("profile_id", profile.profile_id)\
                .execute()

    background_tasks.add_task(do_extract)

    return {"status": "extracting", "segment_id": segment_id}


@router.get("/{segment_id}/stream")
async def stream_segment(
    segment_id: str,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Stream a segment (extracted or from source)."""
    supabase = get_supabase()
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
        path = Path(seg["extracted_video_path"])
        if path.exists():
            return FileResponse(path=str(path), media_type="video/mp4", headers={"Cache-Control": "public, max-age=3600"})

    # Otherwise, stream from source with time range
    # Note: For now, return 404 if not extracted
    # A more complex implementation would use ffmpeg to stream the segment on-the-fly
    raise HTTPException(
        status_code=404,
        detail="Segment not extracted. Call /extract first."
    )


# ============== SRT MATCHING ==============

@router.post("/match-srt", response_model=List[SegmentMatch])
async def match_segments_to_srt(
    request: SRTMatchRequest,
    profile: ProfileContext = Depends(get_profile_context)
):
    """Match segments to SRT content based on keywords, scoped to current profile."""
    supabase = get_supabase()
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
        # Format: 00:00:01,000 or 00:00:01.000
        time_str = time_str.replace(",", ".")
        parts = time_str.split(":")
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return hours * 3600 + minutes * 60 + seconds
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
    supabase = get_supabase()
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
    supabase = get_supabase()
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
            settings.base_dir / "segments",
            settings.base_dir / "source_videos"
        ]

        is_allowed = any(
            os.path.normcase(str(full_path)).startswith(os.path.normcase(str(d.resolve())))
            for d in allowed_dirs
        )

        if not is_allowed:
            raise HTTPException(status_code=403, detail="Access denied")
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
