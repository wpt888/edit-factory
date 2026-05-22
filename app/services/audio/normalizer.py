"""
Audio Normalization Service.
Implements two-pass EBU R128 loudness normalization using FFmpeg's loudnorm filter.
"""
import asyncio
import json
import logging
import math
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from app.services.ffmpeg_semaphore import safe_ffmpeg_run

logger = logging.getLogger(__name__)


@dataclass
class LoudnormMeasurement:
    """
    EBU R128 loudness measurement results from first pass.

    Attributes:
        input_i: Integrated loudness in LUFS (Loudness Units Full Scale)
        input_tp: True peak in dBTP (decibels True Peak)
        input_lra: Loudness range in LU (Loudness Units)
        input_thresh: Gating threshold used for measurement
        target_offset: Linear offset for second pass normalization
    """
    input_i: float
    input_tp: float
    input_lra: float
    input_thresh: float
    target_offset: float

    def __str__(self) -> str:
        return (
            f"LoudnormMeasurement(input_i={self.input_i:.2f} LUFS, "
            f"input_tp={self.input_tp:.2f} dBTP, input_lra={self.input_lra:.2f} LU, "
            f"thresh={self.input_thresh:.2f}, offset={self.target_offset:.2f})"
        )


async def measure_loudness(
    audio_path: Path,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0,
    timeout_seconds: int = 300
) -> Optional[LoudnormMeasurement]:
    """
    Measure audio loudness using FFmpeg's loudnorm filter (first pass).

    This performs the first pass of two-pass normalization, analyzing the audio
    to determine current loudness levels and calculate adjustment parameters.

    Args:
        audio_path: Path to audio or video file to measure
        target_lufs: Target integrated loudness in LUFS (default: -14.0 for social media)
        target_tp: Target true peak in dBTP (default: -1.5)
        target_lra: Target loudness range in LU (default: 7.0)
        timeout_seconds: Maximum execution time in seconds (default: 300)

    Returns:
        LoudnormMeasurement with analysis results, or None if measurement failed
    """
    if not audio_path.exists():
        logger.error(f"Audio file not found: {audio_path}")
        return None

    # Build FFmpeg command for loudness measurement
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-threads", "4",
        "-i", str(audio_path),
        "-af", f"loudnorm=I={target_lufs}:TP={target_tp}:LRA={target_lra}:print_format=json",
        "-f", "null",
        "-"
    ]

    logger.info(f"Measuring loudness: {audio_path.name}")
    logger.debug(f"FFmpeg command: {' '.join(cmd)}")

    try:
        # Execute FFmpeg and capture stderr (where loudnorm outputs JSON)
        result = await asyncio.to_thread(safe_ffmpeg_run, cmd, timeout_seconds, "loudness measurement")

        if result.returncode != 0:
            logger.error(f"FFmpeg loudness measurement failed (exit code {result.returncode})")
            logger.debug(f"FFmpeg stderr: {result.stderr[-500:] if result.stderr else ''}")
            return None

        # Extract JSON from stderr — search for the loudnorm-specific JSON
        # by looking for the "input_i" key which is unique to loudnorm output
        stderr = result.stderr
        match = re.search(r'\{[^{}]*"input_i"[^{}]*\}', stderr, re.DOTALL)
        if not match:
            logger.error("No loudnorm JSON found in FFmpeg output")
            logger.debug(f"FFmpeg stderr: {stderr[-500:]}")
            return None

        try:
            data = json.loads(match.group())
        except (ValueError, json.JSONDecodeError):
            logger.error("Failed to parse loudnorm JSON from FFmpeg output")
            logger.debug(f"FFmpeg stderr: {stderr[-500:]}")
            return None

        # Extract required fields
        input_i = float(data["input_i"])
        input_tp = float(data["input_tp"])
        input_lra = float(data["input_lra"])
        input_thresh = float(data["input_thresh"])
        target_offset = float(data["target_offset"])

        # Check for inf/nan values (silent or corrupt audio)
        for name, val in [("input_i", input_i), ("input_tp", input_tp), ("input_lra", input_lra)]:
            if math.isinf(val) or math.isnan(val):
                logger.warning(f"Loudness measurement returned {name}={val} (silent or corrupt audio), skipping normalization")
                return None

        measurement = LoudnormMeasurement(
            input_i=input_i,
            input_tp=input_tp,
            input_lra=input_lra,
            input_thresh=input_thresh,
            target_offset=target_offset
        )

        logger.info(f"Loudness measured: {measurement}")
        return measurement

    except RuntimeError as timeout_err:
        logger.error(f"FFmpeg timeout measuring {audio_path.name}: {timeout_err}")
        return None
    except (KeyError, ValueError) as e:
        logger.error(f"Invalid loudnorm data format: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error measuring loudness: {e}")
        return None


def measure_loudness_sync(
    audio_path: Path,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0,
    timeout_seconds: int = 300
) -> Optional[LoudnormMeasurement]:
    """Synchronous wrapper around measure_loudness for use from sync/threaded contexts."""
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Already inside an event loop — run in a new thread with its own loop
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(
                asyncio.run,
                measure_loudness(audio_path, target_lufs, target_tp, target_lra, timeout_seconds)
            ).result(timeout=timeout_seconds + 10)
    else:
        return asyncio.run(
            measure_loudness(audio_path, target_lufs, target_tp, target_lra, timeout_seconds)
        )


def build_loudnorm_filter(
    measurement: LoudnormMeasurement,
    target_lufs: float = -14.0,
    target_tp: float = -1.5,
    target_lra: float = 7.0
) -> str:
    """
    Build FFmpeg loudnorm filter string for second pass normalization.

    Uses measurements from first pass to create a linear-mode loudnorm filter
    that applies precise gain adjustment to reach target levels.

    Args:
        measurement: LoudnormMeasurement from first pass analysis
        target_lufs: Target integrated loudness in LUFS
        target_tp: Target true peak in dBTP
        target_lra: Target loudness range in LU

    Returns:
        FFmpeg audio filter string ready for -af parameter
    """
    # Calculate the gain adjustment that will be applied
    gain_adjustment = target_lufs - measurement.input_i

    logger.info(
        f"Building loudnorm filter: "
        f"{measurement.input_i:.2f} LUFS → {target_lufs:.2f} LUFS "
        f"(gain: {gain_adjustment:+.2f} dB)"
    )

    # Build the linear-mode loudnorm filter with measured values
    filter_str = (
        f"loudnorm=I={target_lufs}:TP={target_tp}:LRA={target_lra}:"
        f"measured_I={measurement.input_i}:measured_TP={measurement.input_tp}:"
        f"measured_LRA={measurement.input_lra}:measured_thresh={measurement.input_thresh}:"
        f"offset={measurement.target_offset}:linear=true"
    )

    logger.debug(f"Loudnorm filter: {filter_str}")
    return filter_str
