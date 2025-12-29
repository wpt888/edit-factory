"""
Edit Factory - Pydantic Models
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
from datetime import datetime


class JobStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoSegment(BaseModel):
    start: float
    end: float
    duration: float
    motion_score: float
    variance_score: Optional[float] = None
    combined_score: float


class VideoInfo(BaseModel):
    filename: str
    duration: float
    fps: float
    width: int
    height: int
    frame_count: int


class JobCreate(BaseModel):
    """Request pentru creare job."""
    output_name: Optional[str] = Field(default=None, description="Nume pentru fisierul output")
    target_duration: float = Field(default=20.0, description="Durata tinta in secunde")
    script_text: Optional[str] = Field(default=None, description="Text pentru TTS (optional)")


class JobResponse(BaseModel):
    """Raspuns cu detalii job."""
    job_id: str
    status: JobStatus
    created_at: datetime
    updated_at: Optional[datetime] = None
    progress: Optional[str] = None
    video_info: Optional[VideoInfo] = None
    segments: Optional[List[VideoSegment]] = None
    result: Optional[dict] = None
    error: Optional[str] = None


class AnalyzeRequest(BaseModel):
    """Request pentru analiza video."""
    target_duration: float = Field(default=20.0, description="Durata tinta in secunde")


class AnalyzeResponse(BaseModel):
    """Raspuns analiza video."""
    status: str
    video_info: VideoInfo
    segments: List[VideoSegment]
    total_selected_duration: float


class HealthResponse(BaseModel):
    """Raspuns health check."""
    status: str
    version: str
    ffmpeg_available: bool
    redis_available: bool
