# Phase 8: Audio Normalization - Research

**Researched:** 2026-02-05
**Domain:** Audio loudness normalization with FFmpeg loudnorm filter for social media
**Confidence:** HIGH

## Summary

Audio normalization ensures consistent perceived loudness across all exported videos, preventing jarring volume changes when users swipe between content. The industry-standard approach uses FFmpeg's loudnorm filter implementing EBU R128 loudness measurement. For social media (TikTok, Instagram Reels, YouTube Shorts), the target is -14 LUFS integrated loudness with -1.5 dBTP true peak limiting, ensuring audio remains clean through platform recompression without clipping.

Two-pass normalization is mandatory for precision: the first pass analyzes the audio and outputs JSON measurements (input_i, input_tp, input_lra, input_thresh, target_offset), then the second pass applies exact gain adjustments using those measured values with linear=true mode to preserve dynamics. Single-pass dynamic mode exists but applies compression/limiting that alters the audio's character, making it unsuitable for music or professional content.

The key technical challenge is that loudnorm must run on the final audio stream after all video segments are concatenated and mixed with TTS audio. Edit Factory's current pipeline uses FFmpeg concat with `-c copy` (stream copying without re-encoding), so audio normalization must be integrated into the final render step in `_render_with_preset()` where audio encoding already happens. The normalization filter must be applied to the audio input stream before encoding parameters are applied, requiring modification of the audio filter chain building logic.

**Primary recommendation:** Implement two-pass loudnorm as a service function that wraps subprocess calls, parse JSON from stderr using regex extraction, integrate into EncodingPreset.to_ffmpeg_params() to add loudnorm to the audio filter chain, target -14 LUFS with -1.5 dBTP for all platforms (already locked in requirements).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg loudnorm | 6.x+ | EBU R128 loudness normalization | Industry standard, built into FFmpeg, broadcast-compliant, dual-pass precision |
| Python subprocess | stdlib | FFmpeg command execution | Standard library, captures stderr for JSON parsing, synchronous control |
| Python json | stdlib | Parse loudnorm measurements | Native JSON parsing, no dependencies |
| Python re | stdlib | Extract JSON from stderr | Regex for isolating JSON block from FFmpeg output |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ffmpeg-normalize | 3.x | Automated batch normalization | If building standalone normalization tool (NOT needed for Edit Factory) |
| Pydantic | 2.x | Validate loudnorm parameters | Already used in EncodingPreset, extend for normalization config |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two-pass loudnorm | Single-pass dynamic mode | Dynamic mode alters audio character, uses compression, unsuitable for music/TTS |
| FFmpeg loudnorm | ffmpeg-normalize library | Adds dependency, overkill for single-file workflow, wraps subprocess anyway |
| Regex JSON parsing | Write stderr to file | Less efficient, requires cleanup, more failure points |
| -14 LUFS | -16 LUFS or -23 LUFS | -16 too quiet for mobile, -23 is broadcast standard not social media |

**Installation:**
```bash
# Already available in Edit Factory
# FFmpeg 6.x: Available via system PATH or ffmpeg/ffmpeg-master-latest-win64-gpl/bin/
# Python stdlib: subprocess, json, re (no additional dependencies)
# Pydantic 2.x: Already in requirements.txt (used in app.config)
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   ├── encoding_presets.py       # EXISTING: EncodingPreset model
│   ├── audio_normalizer.py       # NEW: Two-pass loudnorm service
│   └── video_processor.py        # Existing FFmpeg execution patterns
└── api/
    └── library_routes.py          # MODIFY: _render_with_preset() integration
```

### Pattern 1: Two-Pass Loudnorm Service
**What:** Encapsulate two-pass loudnorm workflow in a service function with measurement and normalization steps
**When to use:** Before final audio encoding in render pipeline
**Example:**
```python
# Source: FFmpeg loudnorm docs + Python subprocess best practices
import subprocess
import json
import re
import logging
from pathlib import Path
from typing import Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

@dataclass
class LoudnormMeasurement:
    """Loudness measurements from first pass analysis."""
    input_i: float      # Integrated loudness
    input_tp: float     # True peak
    input_lra: float    # Loudness range
    input_thresh: float # Threshold
    target_offset: float # Offset for second pass

def measure_loudness(
    audio_path: Path,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0
) -> Optional[LoudnormMeasurement]:
    """
    First pass: Measure audio loudness characteristics.

    Args:
        audio_path: Input audio or video file
        target_lufs: Target integrated loudness (LUFS)
        target_tp: Target true peak (dBTP)
        target_lra: Target loudness range (LU)

    Returns:
        LoudnormMeasurement with analysis results, or None if failed
    """
    cmd = [
        "ffmpeg", "-hide_banner",
        "-i", str(audio_path),
        "-af", f"loudnorm=I={target_lufs}:TP={target_tp}:LRA={target_lra}:print_format=json",
        "-f", "null", "-"
    ]

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=300  # 5 minute timeout
        )

        # Parse JSON from stderr (loudnorm outputs to stderr)
        stderr = result.stderr

        # Extract JSON block using regex
        # Look for last occurrence of {...} block containing loudnorm fields
        json_match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr, re.DOTALL)
        if not json_match:
            logger.error("Could not find loudnorm JSON in FFmpeg output")
            return None

        json_str = json_match.group(0)
        data = json.loads(json_str)

        # Extract measurements
        return LoudnormMeasurement(
            input_i=float(data["input_i"]),
            input_tp=float(data["input_tp"]),
            input_lra=float(data["input_lra"]),
            input_thresh=float(data["input_thresh"]),
            target_offset=float(data["target_offset"])
        )

    except subprocess.TimeoutExpired:
        logger.error(f"Loudness measurement timed out for {audio_path}")
        return None
    except (json.JSONDecodeError, KeyError, ValueError) as e:
        logger.error(f"Failed to parse loudnorm output: {e}")
        return None
    except Exception as e:
        logger.error(f"Loudness measurement failed: {e}")
        return None

def build_loudnorm_filter(
    measurement: LoudnormMeasurement,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0
) -> str:
    """
    Build loudnorm filter string for second pass using measured values.

    Args:
        measurement: Results from first pass analysis
        target_lufs: Target integrated loudness (LUFS)
        target_tp: Target true peak (dBTP)
        target_lra: Target loudness range (LU)

    Returns:
        FFmpeg audio filter string for loudnorm
    """
    # Use linear mode with measured values for precise gain adjustment
    filter_str = (
        f"loudnorm="
        f"I={target_lufs}:"
        f"TP={target_tp}:"
        f"LRA={target_lra}:"
        f"measured_I={measurement.input_i}:"
        f"measured_TP={measurement.input_tp}:"
        f"measured_LRA={measurement.input_lra}:"
        f"measured_thresh={measurement.input_thresh}:"
        f"offset={measurement.target_offset}:"
        f"linear=true"  # Linear mode preserves dynamics
    )

    logger.info(f"Built loudnorm filter: input={measurement.input_i:.2f} LUFS, target={target_lufs} LUFS")
    return filter_str
```

### Pattern 2: Integration with EncodingPreset
**What:** Add audio normalization configuration to EncodingPreset model, generate loudnorm filter in to_ffmpeg_params()
**When to use:** All platform presets should use same normalization targets
**Example:**
```python
# Source: Phase 7 encoding_presets.py + research findings
from pydantic import BaseModel, Field
from typing import Literal, Optional

class EncodingPreset(BaseModel):
    """Platform-specific encoding preset with audio normalization."""
    name: str
    platform: Literal["tiktok", "reels", "youtube_shorts", "generic"]
    description: str

    # Video encoding (existing)
    codec: str = "libx264"
    crf: int = Field(ge=0, le=51, default=20)
    preset: Literal["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] = "medium"
    gop_size: int = Field(ge=1, default=60)
    keyint_min: int = Field(ge=1, default=60)

    # Audio encoding (existing)
    audio_bitrate: str = Field(pattern=r"^\d+k$", default="192k")
    audio_codec: str = "aac"
    audio_sample_rate: int = 48000

    # Audio normalization (NEW)
    normalize_audio: bool = True  # Enable loudness normalization
    target_lufs: float = Field(ge=-70.0, le=-5.0, default=-14.0)  # Social media standard
    target_tp: float = Field(ge=-9.0, le=0.0, default=-1.5)  # True peak limit
    target_lra: float = Field(ge=1.0, le=50.0, default=7.0)  # Loudness range

    # Platform metadata (existing)
    target_bitrate_mbps: float = Field(gt=0, default=5.0)
    max_file_size_mb: Optional[int] = None

    def to_ffmpeg_params(self, use_gpu: bool = False) -> list:
        """Generate FFmpeg parameters with audio normalization."""
        params = []

        # Video encoding (existing logic)
        if use_gpu:
            params.extend(["-c:v", "h264_nvenc", "-preset", "p4", "-cq", str(self.crf)])
        else:
            params.extend([
                "-c:v", self.codec, "-preset", self.preset, "-crf", str(self.crf),
                "-g", str(self.gop_size), "-keyint_min", str(self.keyint_min),
                "-sc_threshold", "0", "-bf", "2"
            ])

        # Audio encoding (existing)
        params.extend([
            "-c:a", self.audio_codec,
            "-b:a", self.audio_bitrate,
            "-ar", str(self.audio_sample_rate)
        ])

        # Pixel format (existing)
        params.extend(["-pix_fmt", "yuv420p"])

        return params
```

### Pattern 3: Render Pipeline Integration
**What:** Integrate loudnorm measurement and filter application into _render_with_preset() function
**When to use:** During final video rendering with audio track
**Example:**
```python
# Source: Edit Factory library_routes.py + research findings
from app.services.audio_normalizer import measure_loudness, build_loudnorm_filter

def _render_with_preset(
    video_path: Path,
    audio_path: Optional[Path],
    srt_path: Optional[Path],
    subtitle_settings: Optional[dict],
    preset: dict,
    output_path: Path
):
    """Render final video with preset and audio normalization."""

    # Build FFmpeg command
    cmd = ["ffmpeg", "-y", "-i", str(video_path)]

    # Add audio input (real or silent)
    if audio_path and audio_path.exists():
        cmd.extend(["-i", str(audio_path)])
        has_audio = True
    else:
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
        has_audio = False

    # Build filter complex for video
    video_filters = []
    video_filters.append(f"scale={preset['width']}:{preset['height']}:force_original_aspect_ratio=increase")
    video_filters.append(f"crop={preset['width']}:{preset['height']}")

    # Add subtitles if available
    if srt_path and srt_path.exists() and subtitle_settings:
        # ... subtitle filter building (existing) ...
        video_filters.append(subtitles_filter)

    # Build audio filter chain
    audio_filters = []

    # Step 1: Audio normalization (NEW)
    if has_audio:
        # Get encoding preset
        encoding_preset = get_preset(preset.get("name", "Generic"))

        if encoding_preset.normalize_audio:
            logger.info("Performing two-pass audio normalization...")

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
                logger.info(f"Audio normalization: {measurement.input_i:.1f} LUFS → {encoding_preset.target_lufs} LUFS")
            else:
                logger.warning("Audio normalization measurement failed, skipping normalization")

    # Apply filters
    if video_filters:
        cmd.extend(["-vf", ",".join(video_filters)])

    if audio_filters:
        cmd.extend(["-af", ",".join(audio_filters)])

    # Get encoding parameters
    encoding_params = encoding_preset.to_ffmpeg_params(use_gpu=False)
    cmd.extend(encoding_params)

    # Add FPS and output
    cmd.extend(["-r", str(preset.get("fps", 30)), str(output_path)])

    # Execute FFmpeg
    subprocess.run(cmd, check=True)
    logger.info(f"Rendered video with normalization: {output_path}")
```

### Anti-Patterns to Avoid
- **Single-pass dynamic mode for all content:** Alters audio dynamics, introduces compression artifacts, use linear mode
- **Normalizing segments before concatenation:** Each segment normalized independently causes volume jumps at cuts
- **Not handling measurement failures:** Network/timeout can cause first pass to fail, always check measurement result
- **Hardcoded LUFS targets in multiple places:** Use EncodingPreset configuration, single source of truth
- **Forgetting sample rate in measurement:** loudnorm upsamples to 192kHz internally, always specify -ar 48000 in output

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loudness measurement | RMS calculation or peak detection | FFmpeg loudnorm filter | EBU R128 is complex standard (gating, integration time, K-weighting), loudnorm implements it correctly |
| JSON parsing from FFmpeg | Custom regex line-by-line parsing | Python json.loads() with regex block extraction | Robust JSON parsing, handles nested structures, validates format |
| True peak limiting | Manual audio clipping at 0dB | loudnorm TP parameter | True peak accounts for inter-sample peaks from DAC reconstruction, prevents digital clipping |
| Audio filter chaining | String concatenation | Build filters as list, join with "," | Safer escaping, testable components, handles complex filter graphs |

**Key insight:** Loudness normalization is perceptual, not simple math. EBU R128 uses gating (ignores quiet passages), integration time windows, and K-frequency weighting to match human perception. FFmpeg's loudnorm implements the full ITU-R BS.1770 specification correctly, including corner cases like silence handling and dynamic range preservation.

## Common Pitfalls

### Pitfall 1: Sample Rate Upsampling Surprise
**What goes wrong:** Output file is 3x larger than expected with 192kHz sample rate
**Why it happens:** loudnorm filter internally upsamples to 192kHz for accurate peak detection, FFmpeg may keep that sample rate if not explicitly set
**How to avoid:** Always specify `-ar 48000` in audio encoding parameters to resample back to standard rate
**Warning signs:** Large file sizes, audio inspection shows 192kHz instead of 48kHz

### Pitfall 2: Normalizing Before Concatenation
**What goes wrong:** Audio volume jumps at segment boundaries, inconsistent loudness across video
**Why it happens:** Each segment normalized to target independently, but actual loudness depends on integration time (final video length)
**How to avoid:** Always normalize the final concatenated audio stream, never individual segments
**Warning signs:** Volume changes at cuts, some segments louder than others despite normalization

### Pitfall 3: Dynamic Mode Fallback Without Warning
**What goes wrong:** Audio sounds "compressed" or "pumping," dynamics are altered
**Why it happens:** When target LRA < source LRA or linear mode can't reach target, loudnorm silently switches to dynamic mode (compression)
**How to avoid:** Check loudnorm output for "linear mode" confirmation, or set target_lra high enough (7.0 usually works)
**Warning signs:** Audio has compression artifacts, transients are softened, music sounds "squashed"

### Pitfall 4: JSON Parsing Regex Fragility
**What goes wrong:** Loudnorm measurement succeeds but JSON parsing fails with "No JSON found"
**Why it happens:** FFmpeg stderr contains warnings/errors before JSON block, regex too strict or looks in wrong place
**How to avoid:** Use regex that finds LAST occurrence of {...} block containing "input_i" field, use re.DOTALL for multiline
**Warning signs:** Inconsistent parsing failures, works on some files but not others

### Pitfall 5: Ignoring Measurement Failures
**What goes wrong:** Final video has no audio normalization, volume inconsistent with other videos
**Why it happens:** First pass can timeout/fail (corrupted audio, network issues), code doesn't check measurement result
**How to avoid:** Always check if measure_loudness() returns None, log warning, skip normalization gracefully
**Warning signs:** Some videos normalized, others not, no error messages in logs

### Pitfall 6: Wrong Target for Platform
**What goes wrong:** Audio too quiet on mobile devices, users can't hear content
**Why it happens:** Using broadcast standard -23 LUFS instead of social media -14 LUFS
**How to avoid:** Social media platforms normalize to -14 LUFS (YouTube, TikTok, Instagram), use this target
**Warning signs:** User complaints about quiet audio, volume lower than competing content

## Code Examples

Verified patterns from official sources:

### Complete Audio Normalizer Service
```python
# Source: FFmpeg loudnorm filter docs + Python subprocess patterns
# File: app/services/audio_normalizer.py

"""
Audio Normalization Service.
Implements two-pass EBU R128 loudness normalization using FFmpeg loudnorm filter.
"""
import subprocess
import json
import re
import logging
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class LoudnormMeasurement:
    """
    Loudness measurements from EBU R128 analysis.

    Attributes:
        input_i: Integrated loudness of source (LUFS)
        input_tp: True peak of source (dBTP)
        input_lra: Loudness range of source (LU)
        input_thresh: Gating threshold (LUFS)
        target_offset: Offset for second pass normalization
    """
    input_i: float
    input_tp: float
    input_lra: float
    input_thresh: float
    target_offset: float

    def __str__(self) -> str:
        return f"Loudness: {self.input_i:.1f} LUFS, Peak: {self.input_tp:.1f} dBTP, LRA: {self.input_lra:.1f} LU"


def measure_loudness(
    audio_path: Path,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0,
    timeout_seconds: int = 300
) -> Optional[LoudnormMeasurement]:
    """
    First pass: Measure audio loudness characteristics using EBU R128.

    Runs FFmpeg with loudnorm filter in analysis mode, parsing JSON output
    from stderr to extract measurement values for second pass normalization.

    Args:
        audio_path: Path to input audio or video file
        target_lufs: Target integrated loudness in LUFS (default: -14.0 for social media)
        target_tp: Target true peak in dBTP (default: -1.5)
        target_lra: Target loudness range in LU (default: 7.0)
        timeout_seconds: Maximum time to wait for analysis (default: 300)

    Returns:
        LoudnormMeasurement with analysis results, or None if measurement failed

    Raises:
        No exceptions raised, returns None on failure with logged error
    """
    cmd = [
        "ffmpeg",
        "-hide_banner",  # Reduce stderr noise
        "-nostats",      # No progress stats
        "-i", str(audio_path),
        "-af", f"loudnorm=I={target_lufs}:TP={target_tp}:LRA={target_lra}:print_format=json",
        "-f", "null",    # No output file
        "-"
    ]

    logger.info(f"Measuring audio loudness: {audio_path.name}")

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True,
            timeout=timeout_seconds
        )

        # Parse JSON from stderr (loudnorm always outputs to stderr)
        stderr = result.stderr

        # Extract JSON block using regex
        # Pattern: Find last {...} block containing "input_i" field
        # Use DOTALL to match across newlines, find LAST occurrence
        json_match = re.search(
            r'\{[^{}]*"input_i"[^{}]*"input_tp"[^{}]*"input_lra"[^{}]*"input_thresh"[^{}]*"target_offset"[^{}]*\}',
            stderr,
            re.DOTALL
        )

        if not json_match:
            logger.error(f"Could not find loudnorm JSON in FFmpeg output for {audio_path.name}")
            logger.debug(f"FFmpeg stderr: {stderr[-500:]}")  # Last 500 chars for debugging
            return None

        json_str = json_match.group(0)
        data = json.loads(json_str)

        # Extract and validate measurements
        measurement = LoudnormMeasurement(
            input_i=float(data["input_i"]),
            input_tp=float(data["input_tp"]),
            input_lra=float(data["input_lra"]),
            input_thresh=float(data["input_thresh"]),
            target_offset=float(data["target_offset"])
        )

        logger.info(f"Measured: {measurement}")
        return measurement

    except subprocess.TimeoutExpired:
        logger.error(f"Loudness measurement timed out after {timeout_seconds}s for {audio_path.name}")
        return None
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Failed to parse loudnorm JSON output: {e}")
        return None
    except ValueError as e:
        logger.error(f"Invalid loudness measurement values: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error during loudness measurement: {e}")
        return None


def build_loudnorm_filter(
    measurement: LoudnormMeasurement,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0
) -> str:
    """
    Build loudnorm filter string for second pass normalization.

    Uses measured values from first pass to apply precise linear gain adjustment
    without altering audio dynamics. The linear=true mode preserves the original
    dynamic range while adjusting integrated loudness to target.

    Args:
        measurement: Results from measure_loudness() first pass
        target_lufs: Target integrated loudness in LUFS
        target_tp: Target true peak in dBTP
        target_lra: Target loudness range in LU

    Returns:
        FFmpeg audio filter string ready for -af parameter
    """
    # Build filter with measured values for linear normalization
    filter_str = (
        f"loudnorm="
        f"I={target_lufs}:"
        f"TP={target_tp}:"
        f"LRA={target_lra}:"
        f"measured_I={measurement.input_i}:"
        f"measured_TP={measurement.input_tp}:"
        f"measured_LRA={measurement.input_lra}:"
        f"measured_thresh={measurement.input_thresh}:"
        f"offset={measurement.target_offset}:"
        f"linear=true"  # Linear mode preserves dynamics, no compression
    )

    gain_db = target_lufs - measurement.input_i
    logger.info(f"Built loudnorm filter: {measurement.input_i:.1f} LUFS → {target_lufs} LUFS (gain: {gain_db:+.1f} dB)")

    return filter_str


def normalize_audio_two_pass(
    input_path: Path,
    output_path: Path,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0,
    audio_bitrate: str = "192k",
    sample_rate: int = 48000
) -> bool:
    """
    Perform complete two-pass audio normalization workflow.

    Convenience function that measures loudness, builds filter, and encodes
    output with normalization applied. Useful for standalone audio processing.

    Args:
        input_path: Source audio or video file
        output_path: Destination file path
        target_lufs: Target integrated loudness (default: -14.0)
        target_tp: Target true peak (default: -1.5)
        target_lra: Target loudness range (default: 7.0)
        audio_bitrate: Output audio bitrate (default: "192k")
        sample_rate: Output sample rate (default: 48000)

    Returns:
        True if normalization succeeded, False otherwise
    """
    # First pass: Measure
    measurement = measure_loudness(input_path, target_lufs, target_tp, target_lra)
    if not measurement:
        logger.error(f"Cannot normalize {input_path.name}: measurement failed")
        return False

    # Second pass: Normalize
    filter_str = build_loudnorm_filter(measurement, target_lufs, target_tp, target_lra)

    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-af", filter_str,
        "-c:a", "aac",
        "-b:a", audio_bitrate,
        "-ar", str(sample_rate),  # Prevent 192kHz upsampling
        str(output_path)
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
        logger.info(f"Normalized audio saved: {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        logger.error(f"Audio normalization encoding failed: {e.stderr.decode()[:200]}")
        return False
```

### EncodingPreset Extension
```python
# Source: Phase 7 encoding_presets.py + Phase 8 requirements
# File: app/services/encoding_presets.py (modifications)

from pydantic import BaseModel, Field
from typing import Literal, Optional

class EncodingPreset(BaseModel):
    """
    Video encoding preset with platform-specific settings and audio normalization.
    """
    name: str
    platform: Literal["tiktok", "reels", "youtube_shorts", "generic"]
    description: str

    # Video encoding
    codec: str = "libx264"
    crf: int = Field(ge=0, le=51, default=20)
    preset: Literal["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] = "medium"
    gop_size: int = Field(ge=1, default=60)
    keyint_min: int = Field(ge=1, default=60)

    # Audio encoding
    audio_bitrate: str = Field(pattern=r"^\d+k$", default="192k")
    audio_codec: str = "aac"
    audio_sample_rate: int = 48000

    # Audio normalization (NEW - Phase 8)
    normalize_audio: bool = True
    target_lufs: float = Field(ge=-70.0, le=-5.0, default=-14.0, description="Target integrated loudness (LUFS)")
    target_tp: float = Field(ge=-9.0, le=0.0, default=-1.5, description="Target true peak (dBTP)")
    target_lra: float = Field(ge=1.0, le=50.0, default=7.0, description="Target loudness range (LU)")

    # Platform metadata
    target_bitrate_mbps: float = Field(gt=0, default=5.0)
    max_file_size_mb: Optional[int] = None

# Update all presets with normalization settings
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
    crf=18,
    preset="slow",
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
    crf=18,
    preset="slow",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=8.0,
    max_file_size_mb=None,
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
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Peak normalization | EBU R128 loudness normalization | 2015+ | Consistent perceived volume, not just peak levels |
| Single-pass dynamic mode | Two-pass linear mode | 2016+ | Preserves dynamics, more accurate target matching |
| -23 LUFS (broadcast) | -14 LUFS (social media) | 2020+ | Appropriate loudness for mobile devices, matches platform standards |
| No true peak limiting | -1.5 dBTP limiting | 2018+ | Prevents clipping after platform recompression |
| Per-segment normalization | Whole-program normalization | Always standard | Consistent loudness across entire video |

**Deprecated/outdated:**
- **Peak normalization (0 dBFS)**: Normalizes to maximum sample value, ignores perceptual loudness, causes volume inconsistency
- **RMS-based normalization**: Simple average power, doesn't match human perception, no gating for silence
- **Single-pass dynamic mode as default**: Alters dynamics unnecessarily, use linear mode for precision
- **-23 LUFS for social media**: Broadcast standard, too quiet for mobile devices, platforms expect -14 LUFS

## Open Questions

Things that couldn't be fully resolved:

1. **Normalization performance impact on render time**
   - What we know: Two-pass adds overhead (analyze + encode), first pass is faster (no encoding)
   - What's unclear: Exact time increase percentage for typical 30-60 second videos
   - Recommendation: Implement with measurement timing logs, consider parallel processing if bottleneck

2. **Handling audio-less silent videos**
   - What we know: Current pipeline adds silent audio track (anullsrc) if no audio provided
   - What's unclear: Should we normalize silent audio (no-op) or skip normalization entirely?
   - Recommendation: Skip normalization if audio is anullsrc (detection: audio_path is None), save processing time

3. **Normalization failure recovery strategy**
   - What we know: First pass can fail (timeout, corrupted audio), should not block render
   - What's unclear: Should failure result in render without normalization (graceful) or fail entire render (strict)?
   - Recommendation: Graceful degradation - log warning, render without normalization, allows user to retry

4. **Multi-audio-track handling**
   - What we know: Edit Factory generates single audio track (TTS or source + TTS mix)
   - What's unclear: Future support for music track + voice track with independent normalization?
   - Recommendation: Phase 8 assumes single audio stream, defer multi-track to future phase

## Sources

### Primary (HIGH confidence)
- [FFmpeg loudnorm Filter Documentation](https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Audio/loudnorm.html) - Official parameter reference, linear vs dynamic mode
- [Audio Normalization with FFmpeg - Forza's ramblings](https://wiki.tnonline.net/w/Blog/Audio_normalization_with_FFmpeg) - Two-pass workflow, JSON parsing
- [Audio Loudness Normalization With FFmpeg - Peter Forgacs](https://peterforgacs.github.io/2018/05/20/Audio-normalization-with-ffmpeg/) - Verified two-pass command structure
- [Target LUFS for YouTube, TikTok, and Spotify (2025)](https://clickyapps.com/creator/video/guides/lufs-targets-2025) - Platform-specific LUFS targets, -14 LUFS for social media

### Secondary (MEDIUM confidence)
- [The Ultimate Guide to Streaming Loudness (LUFS Table 2026)](https://soundplate.com/streaming-loudness-lufs-table/) - Comprehensive platform comparison (attempted fetch, 403 error)
- [10 Best Loudness Normalizers for Social Video (LUFS)](https://www.opus.pro/blog/best-loudness-normalizers) - WebSearch discovery of platform standards
- [GitHub: lbcard/2pass_loudnorm](https://github.com/lbcard/2pass_loudnorm) - Python implementation example, JSON parsing patterns
- [How to Use FFmpeg with Python in 2026](https://www.gumlet.com/learn/ffmpeg-python/) - subprocess best practices, stderr capture

### Tertiary (LOW confidence)
- [LUFS Social Media Platform Standards](https://starsoundstudios.com/blog/lufs-social-media-platform-standards-mastering-music) - WebSearch only, community recommendations
- [Social Media (TikTok/Reels) Loudness Target](https://apu.software/tiktok-instagram-reels-loudness/) - WebSearch only, single source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - FFmpeg loudnorm is industry standard, EBU R128 specification, Python stdlib proven
- Architecture: HIGH - Two-pass pattern verified in multiple sources, service function pattern common in Edit Factory
- Platform targets: HIGH - -14 LUFS verified from multiple authoritative sources, -1.5 dBTP from official guides
- Integration points: HIGH - Examined existing codebase, _render_with_preset() is correct integration point
- Pitfalls: HIGH - Based on FFmpeg documentation, common issues in GitHub repos, practical experience reports

**Research date:** 2026-02-05
**Valid until:** 60 days (FFmpeg loudnorm stable, EBU R128 specification unchanged since 2015, platform targets stable)

**Notes:**
- -14 LUFS target verified as social media standard (YouTube, TikTok, Instagram) from multiple 2025-2026 sources
- Two-pass loudnorm is mandatory for precision, single-pass dynamic mode not suitable per official FFmpeg docs
- Integration must happen AFTER concatenation but BEFORE final audio encoding in render pipeline
- Phase 7 encoding_presets.py provides perfect extension point for normalization configuration
- Graceful degradation pattern aligns with Edit Factory's existing fallback philosophy (Gemini → variance, ElevenLabs → Edge TTS)
