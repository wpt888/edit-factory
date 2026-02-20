"""
product_video_compositor.py - Core FFmpeg composition service for product videos.

Generates a portrait MP4 (1080x1920) from a product image using:
- Ken Burns zoompan animation (4x pre-scale for smooth motion)
- Configurable duration: 15, 30, 45, or 60 seconds
- Text overlays via textfile= pattern (never text= for product content)
- Simple-scale fallback mode for batch processing

Usage:
    from app.services.product_video_compositor import compose_product_video, CompositorConfig

    cfg = CompositorConfig(duration_s=30, cta_text="Comanda acum!", use_zoompan=True)
    compose_product_video(
        image_path=Path("/path/to/product.jpg"),
        output_path=Path("/path/to/output.mp4"),
        product={"title": "Produs exemplu", "brand": "Brand"},
        config=cfg,
    )
"""
import logging
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from app.services.textfile_helper import build_drawtext_filter, build_multi_drawtext, cleanup_textfiles

logger = logging.getLogger(__name__)

# Output dimensions: portrait 1080x1920 (9:16 for TikTok/Reels/Shorts)
W_OUT = 1080
H_OUT = 1920
FPS = 25

# Pre-scale factor for smooth zoompan: 4x prevents jittery motion
W_LARGE = W_OUT * 4  # = 4320px
H_LARGE = W_LARGE * H_OUT // W_OUT  # = 7680px

VALID_DURATIONS = {15, 30, 45, 60}


@dataclass
class CompositorConfig:
    """Configuration for product video composition."""
    duration_s: int = 30          # Output duration in seconds (15/30/45/60)
    cta_text: str = "Comanda acum!"  # Call-to-action text at the bottom
    fps: int = 25                 # Frames per second
    use_zoompan: bool = True      # False = simple-scale (faster, for batch)


def _calculate_zoompan_params(duration_s: int, fps: int = FPS) -> dict:
    """Calculate zoompan parameters for a given duration.

    Zoom linearly from 1.0 to 1.5 over the full clip duration.

    Args:
        duration_s: Duration in seconds.
        fps: Frames per second.

    Returns:
        Dict with keys: n_frames, z_inc, z_end
    """
    n_frames = fps * duration_s
    z_inc = 0.5 / n_frames  # zoom from 1.0 to 1.5 over all frames
    z_end = 1.5
    return {
        "n_frames": n_frames,
        "z_inc": z_inc,
        "z_end": z_end,
    }


def _build_scale_pad_filter(use_zoompan: bool) -> str:
    """Build scale+pad filter string.

    When use_zoompan=True: scales to 4x (W_LARGE) for smooth zoompan input.
    When use_zoompan=False: scales directly to output dimensions.

    Args:
        use_zoompan: Whether Ken Burns zoompan will follow this filter.

    Returns:
        FFmpeg scale+pad filter string (without input/output pad labels).
    """
    if use_zoompan:
        return (
            f"scale={W_LARGE}:-1:force_original_aspect_ratio=decrease,"
            f"pad={W_LARGE}:{H_LARGE}:(ow-iw)/2:(oh-ih)/2:black"
        )
    else:
        return (
            f"scale={W_OUT}:{H_OUT}:force_original_aspect_ratio=decrease,"
            f"pad={W_OUT}:{H_OUT}:(ow-iw)/2:(oh-ih)/2:black"
        )


def _build_zoompan_filter(duration_s: int, fps: int = FPS) -> str:
    """Build zoompan Ken Burns filter string.

    Generates a centered zoom-in from 1.0 to 1.5 over the full duration.
    Must be applied AFTER pre-scaling to W_LARGE for smooth motion.

    Args:
        duration_s: Duration in seconds.
        fps: Frames per second.

    Returns:
        FFmpeg zoompan filter string (without input/output pad labels).
    """
    params = _calculate_zoompan_params(duration_s, fps)
    z_inc = params["z_inc"]
    z_end = params["z_end"]
    n_frames = params["n_frames"]
    return (
        f"zoompan=z='min(zoom+{z_inc:.6f},{z_end})':"
        f"x='iw/2-(iw/zoom/2)':"
        f"y='ih/2-(ih/zoom/2)':"
        f"d={n_frames}:"
        f"s={W_OUT}x{H_OUT}:"
        f"fps={fps}"
    )


def _build_text_overlays_simple(product: dict, cta_text: str) -> tuple[str, list[str]]:
    """Build basic text overlays for the compositor (Plan 18-01 version).

    This plan adds only the product name overlay at the top.
    Plan 18-02 will add: brand, price, sale price, CTA, badge.

    Args:
        product: Product dict with at least 'title' key.
        cta_text: Call-to-action text (used by Plan 18-02+).

    Returns:
        Tuple of (combined_filter_string, list_of_textfile_paths).
    """
    overlays = [
        {
            "text": product.get("title", "Product")[:60],
            "fontsize": 48,
            "fontcolor": "white",
            "x": "40",
            "y": "160",
            "box": True,
            "boxcolor": "black@0.6",
            "boxborderw": 8,
        }
    ]
    combined_vf, tmp_paths = build_multi_drawtext(overlays)
    return combined_vf, tmp_paths


def compose_product_video(
    image_path: Path,
    output_path: Path,
    product: dict,
    config: CompositorConfig,
) -> None:
    """Compose a portrait product video from a single image using FFmpeg.

    Generates a 1080x1920 MP4 with Ken Burns animation and text overlays.
    Uses -vf (not -filter_complex) since this plan has only one input (no badge).
    Plan 18-02 will switch to -filter_complex when badge overlay is added.

    Args:
        image_path: Path to the product image (JPEG, PNG, etc.).
        output_path: Destination path for the output MP4.
        product: Product dict. Expected keys: title, brand, raw_price_str.
        config: CompositorConfig with duration, CTA text, fps, use_zoompan.

    Raises:
        ValueError: If duration_s is not in VALID_DURATIONS.
        RuntimeError: If FFmpeg subprocess fails.
        FileNotFoundError: If image_path does not exist.
    """
    if config.duration_s not in VALID_DURATIONS:
        raise ValueError(
            f"duration_s must be one of {sorted(VALID_DURATIONS)}, got {config.duration_s}"
        )

    if not image_path.exists():
        raise FileNotFoundError(f"Product image not found: {image_path}")

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Build text overlays
    text_vf, tmp_paths = _build_text_overlays_simple(product, config.cta_text)

    try:
        # Build the -vf filter chain:
        # scale+pad -> [zoompan if enabled] -> drawtext overlays
        scale_pad = _build_scale_pad_filter(config.use_zoompan)

        if config.use_zoompan:
            zoompan = _build_zoompan_filter(config.duration_s, config.fps)
            vf_chain = f"{scale_pad},{zoompan},{text_vf}"
        else:
            vf_chain = f"{scale_pad},{text_vf}"

        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-framerate", str(config.fps),
            "-i", str(image_path),
            "-vf", vf_chain,
            "-t", str(config.duration_s),
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ]

        logger.info(
            "Composing product video: image=%s output=%s duration=%ds zoompan=%s",
            image_path.name,
            output_path.name,
            config.duration_s,
            config.use_zoompan,
        )

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
        )

        if result.returncode != 0:
            logger.error("FFmpeg failed:\n%s", result.stderr[-2000:])
            raise RuntimeError(
                f"FFmpeg failed (exit {result.returncode}): {result.stderr[-1000:]}"
            )

        logger.info("Composition complete: %s", output_path)

    finally:
        cleanup_textfiles(*tmp_paths)


def benchmark_zoompan(image_path: Path, duration_s: int = 30) -> dict:
    """Benchmark zoompan vs simple-scale encode for documentation in STATE.md.

    Runs both methods and times them. Results inform Phase 21 batch default:
    - If zoompan > 120s for 30s video: batch defaults to simple-scale
    - Otherwise: zoompan is viable for batch

    Args:
        image_path: Path to a representative product image (800x800 JPEG typical).
        duration_s: Video duration to benchmark (default 30s).

    Returns:
        Dict with keys:
            simple_scale_s (float): Seconds for simple-scale encode.
            zoompan_s (float): Seconds for zoompan encode.
            slowdown_factor (float): zoompan_s / simple_scale_s.
    """
    fps = FPS
    n_frames = fps * duration_s
    z_inc = 0.5 / n_frames

    bench_simple = Path("/tmp/bench_simple.mp4")
    bench_zoompan = Path("/tmp/bench_zoompan.mp4")

    results = {}

    try:
        # --- Simple scale benchmark ---
        logger.info("Benchmark: running simple-scale encode (%ds)...", duration_s)
        start = time.perf_counter()
        simple_cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-framerate", str(fps), "-i", str(image_path),
            "-vf", (
                f"scale={W_OUT}:{H_OUT}:force_original_aspect_ratio=decrease,"
                f"pad={W_OUT}:{H_OUT}:(ow-iw)/2:(oh-ih)/2:black"
            ),
            "-t", str(duration_s),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(bench_simple),
        ]
        subprocess.run(simple_cmd, capture_output=True, text=True, check=True, timeout=600)
        results["simple_scale_s"] = time.perf_counter() - start
        logger.info("Benchmark: simple_scale=%.1fs", results["simple_scale_s"])

        # --- Zoompan Ken Burns benchmark ---
        logger.info("Benchmark: running zoompan encode (%ds)...", duration_s)
        start = time.perf_counter()
        zoompan_cmd = [
            "ffmpeg", "-y",
            "-loop", "1", "-framerate", str(fps), "-i", str(image_path),
            "-vf", (
                f"scale={W_LARGE}:-1:force_original_aspect_ratio=decrease,"
                f"pad={W_LARGE}:{H_LARGE}:(ow-iw)/2:(oh-ih)/2:black,"
                f"zoompan=z='min(zoom+{z_inc:.6f},1.5)':"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={n_frames}:s={W_OUT}x{H_OUT}:fps={fps}"
            ),
            "-t", str(duration_s),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(bench_zoompan),
        ]
        subprocess.run(zoompan_cmd, capture_output=True, text=True, check=True, timeout=600)
        results["zoompan_s"] = time.perf_counter() - start
        logger.info("Benchmark: zoompan=%.1fs", results["zoompan_s"])

        results["slowdown_factor"] = results["zoompan_s"] / results["simple_scale_s"]

        logger.info(
            "Benchmark: simple_scale=%.1fs, zoompan=%.1fs, slowdown=%.1fx",
            results["simple_scale_s"],
            results["zoompan_s"],
            results["slowdown_factor"],
        )

    finally:
        # Clean up benchmark files
        for f in (bench_simple, bench_zoompan):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass

    return results
