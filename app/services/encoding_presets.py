"""
Encoding Presets Service.
Provides platform-specific video encoding configurations with Pydantic validation.
"""
import logging
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.services.video_filters import VideoFilters

logger = logging.getLogger(__name__)


class EncodingPreset(BaseModel):
    """
    Video encoding preset with platform-specific settings.

    Provides validated encoding parameters for social media platforms
    (TikTok, Instagram Reels, YouTube Shorts) with professional quality settings.
    """
    name: str
    platform: Literal["tiktok", "reels", "youtube_shorts", "generic"]
    description: str
    codec: str = "libx264"
    crf: int = Field(ge=0, le=51, default=20)  # Lower = better quality
    preset: Literal["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] = "medium"
    gop_size: int = Field(ge=1, default=60)  # Keyframe interval (2 seconds at 30fps)
    keyint_min: int = Field(ge=1, default=60)  # Min keyframe interval
    audio_bitrate: str = Field(pattern=r"^\d+k$", default="192k")
    audio_codec: str = "aac"
    audio_sample_rate: int = 48000

    # Audio normalization (Phase 8)
    normalize_audio: bool = True
    target_lufs: float = Field(ge=-70.0, le=-5.0, default=-14.0, description="Target integrated loudness (LUFS)")
    target_tp: float = Field(ge=-9.0, le=0.0, default=-1.5, description="Target true peak (dBTP)")
    target_lra: float = Field(ge=1.0, le=50.0, default=7.0, description="Target loudness range (LU)")

    # Video enhancement filters (Phase 9)
    video_filters: VideoFilters = Field(default_factory=VideoFilters)

    target_bitrate_mbps: float = Field(gt=0, default=5.0)  # Informational
    max_file_size_mb: Optional[int] = None  # Platform limit (informational)

    def to_ffmpeg_params(self, use_gpu: bool = False) -> list:
        """
        Generate FFmpeg command parameters for this preset.

        Args:
            use_gpu: Use hardware acceleration (NVENC) if True

        Returns:
            List of FFmpeg parameters ready for subprocess
        """
        params = []

        if use_gpu:
            # GPU encoding with NVENC
            params.extend([
                "-c:v", "h264_nvenc",
                "-preset", "p4",  # NVENC preset (p1-p7, p4 is balanced)
                "-cq", str(self.crf),  # Constant quality mode for NVENC
            ])
        else:
            # CPU encoding with libx264
            params.extend([
                "-c:v", self.codec,
                "-preset", self.preset,
                "-crf", str(self.crf),
            ])

        # Keyframe controls (both GPU and CPU)
        params.extend([
            "-g", str(self.gop_size),  # GOP size (keyframe interval)
            "-keyint_min", str(self.keyint_min),  # Minimum keyframe interval
            "-sc_threshold", "0",  # Disable scene change detection
            "-bf", "2",  # Use 2 B-frames for better compression
        ])

        # Audio settings
        params.extend([
            "-c:a", self.audio_codec,
            "-b:a", self.audio_bitrate,
            "-ar", str(self.audio_sample_rate),
        ])

        # Pixel format for compatibility
        params.extend([
            "-pix_fmt", "yuv420p",  # Most compatible format
        ])

        logger.debug(f"Generated FFmpeg params for {self.name} (GPU: {use_gpu})")
        return params


# Platform-specific presets
PRESET_TIKTOK = EncodingPreset(
    name="TikTok",
    platform="tiktok",
    description="Optimized for TikTok (9:16, CRF 20, -14 LUFS audio)",
    crf=20,
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=5.0,
    max_file_size_mb=500,
)

PRESET_REELS = EncodingPreset(
    name="Instagram Reels",
    platform="reels",
    description="Optimized for Instagram Reels (9:16, CRF 18, -14 LUFS audio)",
    crf=18,  # Higher quality for Instagram
    preset="slow",  # Better quality encoding
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=6.0,
    max_file_size_mb=4000,
)

PRESET_YOUTUBE_SHORTS = EncodingPreset(
    name="YouTube Shorts",
    platform="youtube_shorts",
    description="Optimized for YouTube Shorts (9:16, CRF 18, -14 LUFS audio)",
    crf=18,  # High quality for YouTube
    preset="slow",  # Better quality encoding
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=8.0,
    max_file_size_mb=None,  # No explicit limit
)

PRESET_GENERIC = EncodingPreset(
    name="Generic",
    platform="generic",
    description="Balanced settings for any platform (CRF 20, -14 LUFS audio)",
    crf=20,
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=5.0,
    max_file_size_mb=None,
)

# Preset registry
PRESETS = {
    "tiktok": PRESET_TIKTOK,
    "reels": PRESET_REELS,
    "youtube_shorts": PRESET_YOUTUBE_SHORTS,
    "generic": PRESET_GENERIC,
}


def get_preset(platform: str) -> EncodingPreset:
    """
    Get encoding preset by platform name.

    Args:
        platform: Platform identifier (tiktok, reels, youtube_shorts, generic)

    Returns:
        EncodingPreset for the platform, falls back to generic if unknown
    """
    platform_lower = platform.lower()

    if platform_lower in PRESETS:
        logger.info(f"Using preset for platform: {platform}")
        return PRESETS[platform_lower]
    else:
        logger.warning(f"Unknown platform '{platform}', falling back to generic preset")
        return PRESETS["generic"]


def list_presets() -> list[dict]:
    """
    List all available presets with summary information.

    Returns:
        List of dicts with preset metadata (id, name, platform, description)
    """
    presets_list = []

    for preset_id, preset in PRESETS.items():
        presets_list.append({
            "id": preset_id,
            "name": preset.name,
            "platform": preset.platform,
            "description": preset.description,
            "crf": preset.crf,
            "audio_bitrate": preset.audio_bitrate,
            "normalize_audio": preset.normalize_audio,
            "target_lufs": preset.target_lufs,
            "max_file_size_mb": preset.max_file_size_mb,
            "video_filters_enabled": preset.video_filters.has_any_enabled(),
        })

    return presets_list
