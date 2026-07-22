"""
Encoding Presets Service.
Provides platform-specific video encoding configurations with Pydantic validation.
"""
import logging
import os
from typing import Literal, Optional
from pydantic import BaseModel, Field
from app.services.video_effects.filters import VideoFilters

logger = logging.getLogger(__name__)

# Render quality / speed mode (Wave 2.1). Controls the encode path:
#   "speed"    -> fastest (NVENC p3 no-multipass, or CPU veryfast 1-pass)
#   "balanced" -> NVENC single-pass fullres-multipass when a GPU is present
#                 (3-5x faster than CPU 2-pass, near-identical quality);
#                 falls back to CPU 2-pass with no GPU. DEFAULT.
#   "max"      -> CPU libx264 2-pass (highest quality, slowest)
VALID_QUALITY_MODES = ("speed", "balanced", "max")


def get_default_quality_mode() -> str:
    """Default render quality mode (env RENDER_QUALITY_MODE, else 'balanced')."""
    mode = (os.environ.get("RENDER_QUALITY_MODE") or "balanced").lower()
    return mode if mode in VALID_QUALITY_MODES else "balanced"


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
    audio_bitrate: str = Field(pattern=r"^\d+k$", default="320k")
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

    # VBR encoding settings
    encoding_mode: Literal["crf", "vbr_1pass", "vbr_2pass"] = "vbr_2pass"
    target_bitrate_kbps: int = Field(ge=500, le=50000, default=10000)
    video_profile: Literal["baseline", "main", "high"] = "main"
    video_level: str = "4.1"

    # NVENC (GPU) tuning — only used when use_gpu=True (Wave 2.1).
    # p1 (fastest) .. p7 (best quality); p5 ~ libx264 medium at a fraction of the time.
    nvenc_preset: Literal["p1", "p2", "p3", "p4", "p5", "p6", "p7"] = "p5"
    # fullres multipass approximates 2-pass quality in a single GPU launch.
    nvenc_multipass: Literal["disabled", "qres", "fullres"] = "fullres"

    def needs_two_pass(self) -> bool:
        """Return True if this preset requires 2-pass encoding."""
        return self.encoding_mode == "vbr_2pass"

    def to_ffmpeg_params(self, use_gpu: bool = False, pass_number: int = 0, passlogfile: str = "") -> list:
        """
        Generate FFmpeg command parameters for this preset.

        Args:
            use_gpu: Use hardware acceleration (NVENC) if True
            pass_number: 0 = single-pass (CRF or VBR 1-pass), 1 = first pass, 2 = second pass
            passlogfile: Path prefix for 2-pass log files (required when pass_number > 0)

        Returns:
            List of FFmpeg parameters ready for subprocess
        """
        params = []

        # Force CPU for 2-pass (NVENC doesn't support 2-pass)
        if self.encoding_mode == "vbr_2pass" and use_gpu:
            logger.info("VBR 2-pass forces CPU encoding (NVENC doesn't support 2-pass)")
            use_gpu = False

        is_vbr = self.encoding_mode in ("vbr_1pass", "vbr_2pass")

        if use_gpu:
            # GPU encoding with NVENC (Wave 2.1) — VBR with a quality target and a
            # bitrate ceiling, plus optional fullres multipass for ~2-pass quality.
            params.extend([
                "-c:v", "h264_nvenc",
                "-preset", self.nvenc_preset,
                "-rc", "vbr",
                "-cq", str(self.crf),  # Constant-quality target for NVENC VBR
            ])
            if self.nvenc_multipass and self.nvenc_multipass != "disabled":
                params.extend(["-multipass", self.nvenc_multipass])
            if is_vbr:
                # Cap the bitrate so file sizes stay platform-friendly.
                maxrate_kbps = int(self.target_bitrate_kbps * 1.5)
                bufsize_kbps = self.target_bitrate_kbps * 2
                params.extend([
                    "-b:v", f"{self.target_bitrate_kbps}k",
                    "-maxrate", f"{maxrate_kbps}k",
                    "-bufsize", f"{bufsize_kbps}k",
                ])
            else:
                # CRF-style: let -cq drive quality without a hard bitrate target.
                params.extend(["-b:v", "0"])
        else:
            # CPU encoding with libx264
            params.extend([
                "-c:v", self.codec,
                "-preset", self.preset,
            ])

            if is_vbr:
                # VBR mode: target bitrate with maxrate/bufsize
                maxrate_kbps = int(self.target_bitrate_kbps * 1.5)
                bufsize_kbps = self.target_bitrate_kbps * 2
                params.extend([
                    "-b:v", f"{self.target_bitrate_kbps}k",
                    "-maxrate", f"{maxrate_kbps}k",
                    "-bufsize", f"{bufsize_kbps}k",
                ])
            else:
                # CRF mode
                params.extend(["-crf", str(self.crf)])

        # Profile and level (all modes)
        if not use_gpu:
            params.extend([
                "-profile:v", self.video_profile,
                "-level", self.video_level,
            ])

        # 2-pass flags
        if pass_number in (1, 2) and passlogfile:
            params.extend([
                "-pass", str(pass_number),
                "-passlogfile", passlogfile,
            ])

        # Keyframe controls
        params.extend([
            "-g", str(self.gop_size),  # GOP size (keyframe interval)
        ])

        # VID-17: -keyint_min and -sc_threshold are CPU-only (libx264) flags
        if not use_gpu:
            params.extend([
                "-keyint_min", str(self.keyint_min),  # Minimum keyframe interval
                "-sc_threshold", "0",  # Disable scene change detection
                "-bf", "2",  # B-frames for better compression (CPU only)
            ])

        # Audio settings (skip for pass 1 — no audio needed)
        if pass_number != 1:
            params.extend([
                "-c:a", self.audio_codec,
                "-b:a", self.audio_bitrate,
                "-ar", str(self.audio_sample_rate),
            ])

        # Pixel format for compatibility
        params.extend([
            "-pix_fmt", "yuv420p",  # Most compatible format
        ])

        # Thread limit to prevent CPU saturation (especially on high-core-count systems)
        params.extend(["-threads", "4"])

        # Bitrate ceiling for CRF mode (CPU only; GPU uses its own rate control)
        # VBR mode already has maxrate/bufsize set above
        if not use_gpu and not is_vbr:
            # VID-11: Use kbps for precision — avoids int truncation from Mbps rounding
            max_bitrate_kbps = int(self.target_bitrate_mbps * 1500)  # 1.5x target in kbps
            params.extend([
                "-maxrate", f"{max_bitrate_kbps}k",
                "-bufsize", f"{max_bitrate_kbps * 2}k",
            ])

        logger.debug(f"Generated FFmpeg params for {self.name} (GPU: {use_gpu}, pass: {pass_number})")
        return params


def apply_quality_mode(preset: EncodingPreset, quality_mode: str, gpu_available: bool) -> EncodingPreset:
    """Resolve the effective encode path for a render quality mode (Wave 2.1).

    The presets all default to ``vbr_2pass`` (CPU-only). This returns a copy with
    the encoding tuned for the chosen speed/quality trade-off and the hardware:

      * ``max``                -> CPU libx264 2-pass (highest quality, slowest)
      * ``balanced``/``speed`` + GPU -> NVENC single-pass (3-5x faster); the
        single-pass render path then automatically uses NVENC because
        ``needs_two_pass()`` becomes False.
      * ``speed`` (no GPU)     -> fast CPU single-pass (veryfast, VBR 1-pass)
      * ``balanced`` (no GPU)  -> CPU 2-pass (unchanged quality)

    Keeping CPU 2-pass behind an explicit ``max`` choice is what frees the
    default render to use the GPU the user already owns.
    """
    mode = (quality_mode or "balanced").lower()
    if mode not in VALID_QUALITY_MODES:
        mode = "balanced"

    if mode == "max":
        if preset.encoding_mode != "vbr_2pass":
            return preset.model_copy(update={"encoding_mode": "vbr_2pass"})
        return preset

    if gpu_available:
        # NVENC single-pass. fullres multipass for balanced; none for speed.
        return preset.model_copy(update={
            "encoding_mode": "vbr_1pass",
            "nvenc_preset": "p3" if mode == "speed" else "p5",
            "nvenc_multipass": "disabled" if mode == "speed" else "fullres",
        })

    # No GPU available.
    if mode == "speed":
        return preset.model_copy(update={"encoding_mode": "vbr_1pass", "preset": "veryfast"})
    # balanced on CPU keeps the (slower) 2-pass quality.
    return preset.model_copy(update={"encoding_mode": "vbr_2pass"})


# Platform-specific presets
PRESET_TIKTOK = EncodingPreset(
    name="TikTok",
    platform="tiktok",
    description="Optimized for TikTok (9:16, VBR 2-pass 10 Mbps, -14 LUFS audio)",
    crf=20,
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="320k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=10.0,
    max_file_size_mb=500,
    encoding_mode="vbr_2pass",
    target_bitrate_kbps=10000,
    video_profile="main",
    video_level="4.1",
)

PRESET_REELS = EncodingPreset(
    name="Instagram Reels",
    platform="reels",
    description="Optimized for Instagram Reels (9:16, VBR 2-pass 10 Mbps, -14 LUFS audio)",
    crf=18,  # Higher quality for Instagram
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="320k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=10.0,
    max_file_size_mb=4000,
    encoding_mode="vbr_2pass",
    target_bitrate_kbps=10000,
    video_profile="main",
    video_level="4.1",
)

PRESET_YOUTUBE_SHORTS = EncodingPreset(
    name="YouTube Shorts",
    platform="youtube_shorts",
    description="Optimized for YouTube Shorts (9:16, VBR 2-pass 10 Mbps, -14 LUFS audio)",
    crf=18,  # High quality for YouTube
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="320k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=10.0,
    max_file_size_mb=None,  # No explicit limit
    encoding_mode="vbr_2pass",
    target_bitrate_kbps=10000,
    video_profile="main",
    video_level="4.1",
)

PRESET_GENERIC = EncodingPreset(
    name="Generic",
    platform="generic",
    description="Balanced settings for any platform (VBR 2-pass 10 Mbps, -14 LUFS audio)",
    crf=20,
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="320k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=10.0,
    max_file_size_mb=None,
    encoding_mode="vbr_2pass",
    target_bitrate_kbps=10000,
    video_profile="main",
    video_level="4.1",
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
            "encoding_mode": preset.encoding_mode,
            "target_bitrate_kbps": preset.target_bitrate_kbps,
        })

    return presets_list
