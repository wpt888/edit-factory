"""
product_video_compositor.py - Core FFmpeg composition service for product videos.

Generates a portrait MP4 (1080x1920) from a product image using:
- Ken Burns zoompan animation (4x pre-scale for smooth motion)
- Configurable duration: 15, 30, 45, or 60 seconds
- Full text overlays: product name, brand, price (sale + regular), CTA
- Sale badge PNG overlay via filter_complex when product is on sale
- textfile= pattern (never text= for product content — handles Romanian diacritics)

Usage:
    from app.services.product_video_compositor import compose_product_video, CompositorConfig

    cfg = CompositorConfig(duration_s=30, cta_text="Comanda acum!", use_zoompan=True)
    compose_product_video(
        image_path=Path("/path/to/product.jpg"),
        output_path=Path("/path/to/output.mp4"),
        product={"title": "Produs exemplu", "brand": "Brand", "price": 99.99},
        config=cfg,
    )
"""
import logging
import os
import subprocess
import tempfile
import time
from dataclasses import dataclass, field
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
    output_dir: Path = field(default_factory=lambda: Path("output/product_videos"))
    # output_dir is used for badge PNG storage location


def ensure_sale_badge(badge_dir: Path) -> Path:
    """Generate (or reuse) a red 'REDUCERE' sale badge PNG using FFmpeg lavfi.

    Creates a solid red 220x80 PNG with white 'REDUCERE' text centered.
    Uses solid red (no alpha) to avoid transparency issues with overlay.
    If the file already exists, skips generation (cached).

    Args:
        badge_dir: Directory where badge PNG will be stored.

    Returns:
        Path to the badge PNG file.

    Raises:
        RuntimeError: If FFmpeg fails to generate the badge.
    """
    badge_dir.mkdir(parents=True, exist_ok=True)
    badge_path = badge_dir / "_sale_badge.png"

    if badge_path.exists():
        logger.debug("Sale badge already exists (cached): %s", badge_path)
        return badge_path

    logger.info("Generating sale badge PNG: %s", badge_path)

    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", "color=c=red:s=220x80",
        "-vf", (
            "drawtext=text='REDUCERE'"
            ":fontsize=30"
            ":fontcolor=white"
            ":x=(w-text_w)/2"
            ":y=(h-text_h)/2"
        ),
        "-vframes", "1",
        str(badge_path),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        logger.error("FFmpeg badge generation failed:\n%s", result.stderr[-2000:])
        raise RuntimeError(
            f"Failed to generate sale badge: {result.stderr[-500:]}"
        )

    logger.info("Sale badge created: %s", badge_path)
    return badge_path


def _build_text_overlays(
    product: dict,
    cta_text: str,
) -> tuple[bool, str, list[str]]:
    """Build full text overlay specs for the compositor.

    Layout for portrait 1080x1920 (safe zones: avoid top 150px, bottom 200px):
      - Product name: y=160, fontsize=48, white text, black@0.6 box
      - Brand:        y=230, fontsize=32, white@0.85 text, black@0.5 box (if present)
      - Price display (sale):
          Sale price: y=1650, fontsize=56, yellow text, black@0.7 box
          Orig price: y=1720, fontsize=32, gray text, black@0.5 box (muted style)
      - Price display (regular):
          Price:      y=1650, fontsize=56, white text, black@0.7 box
      - CTA:          y=1820, fontsize=44, white text on red@0.85 box, centered

    Determines `is_on_sale` from product: sale_price exists AND < price.

    Args:
        product: Product dict with keys: title, brand, price, sale_price,
                 raw_price_str, raw_sale_price_str.
        cta_text: Call-to-action text (e.g. "Comanda acum!").

    Returns:
        Tuple of (is_on_sale, combined_vf_string, list_of_tmp_paths).
    """
    # Determine sale status
    try:
        sale_price_val = float(product.get("sale_price") or 0)
        price_val = float(product.get("price") or 0)
        is_on_sale = bool(product.get("sale_price")) and sale_price_val < price_val and sale_price_val > 0
    except (ValueError, TypeError):
        is_on_sale = False

    # Format price strings — prefer raw string fields, fall back to numeric
    def _fmt_price(product: dict, key_raw: str, key_num: str) -> str:
        raw = product.get(key_raw)
        if raw:
            return str(raw)
        num = product.get(key_num)
        if num is not None:
            try:
                return f"{float(num):.2f} RON"
            except (ValueError, TypeError):
                pass
        return ""

    price_str = _fmt_price(product, "raw_price_str", "price")
    sale_price_str = _fmt_price(product, "raw_sale_price_str", "sale_price")

    # Build overlay specs
    overlays = []

    # Product name (truncate to 60 chars)
    title = str(product.get("title", "Product"))[:60]
    overlays.append({
        "text": title,
        "fontsize": 48,
        "fontcolor": "white",
        "x": "40",
        "y": "160",
        "box": True,
        "boxcolor": "black@0.6",
        "boxborderw": 8,
    })

    # Brand (skip if absent)
    brand = product.get("brand")
    if brand:
        overlays.append({
            "text": str(brand),
            "fontsize": 32,
            "fontcolor": "white@0.85",
            "x": "40",
            "y": "230",
            "box": True,
            "boxcolor": "black@0.5",
            "boxborderw": 6,
        })

    # Price overlays
    if is_on_sale and sale_price_str:
        # Sale price in yellow (prominent)
        overlays.append({
            "text": sale_price_str,
            "fontsize": 56,
            "fontcolor": "yellow",
            "x": "40",
            "y": "1650",
            "box": True,
            "boxcolor": "black@0.7",
            "boxborderw": 10,
        })
        # Original price in muted gray (no strikethrough — use muted style per research)
        if price_str:
            overlays.append({
                "text": f"Pret initial: {price_str}",
                "fontsize": 32,
                "fontcolor": "gray",
                "x": "40",
                "y": "1720",
                "box": True,
                "boxcolor": "black@0.5",
                "boxborderw": 6,
            })
    elif price_str:
        # Regular price in white
        overlays.append({
            "text": price_str,
            "fontsize": 56,
            "fontcolor": "white",
            "x": "40",
            "y": "1650",
            "box": True,
            "boxcolor": "black@0.7",
            "boxborderw": 10,
        })

    # CTA — centered horizontally
    overlays.append({
        "text": cta_text,
        "fontsize": 44,
        "fontcolor": "white",
        "x": "(w-text_w)/2",
        "y": "1820",
        "box": True,
        "boxcolor": "red@0.85",
        "boxborderw": 12,
    })

    combined_vf, tmp_paths = build_multi_drawtext(overlays)
    return (is_on_sale, combined_vf, tmp_paths)


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


def compose_product_video(
    image_path: Path,
    output_path: Path,
    product: dict,
    config: CompositorConfig,
) -> None:
    """Compose a portrait product video from a single image using FFmpeg.

    Generates a 1080x1920 MP4 with Ken Burns animation, full text overlays,
    and optional sale badge PNG overlay.

    Two code paths:
    - **No badge (not on sale):** Uses -vf (scale+pad + optional zoompan + text).
    - **With badge (on sale):** Uses -filter_complex (badge PNG is a second input,
      overlaid at top-right after video processing chain).

    Args:
        image_path: Path to the product image (JPEG, PNG, etc.).
        output_path: Destination path for the output MP4.
        product: Product dict. Expected keys: title, brand, price, sale_price,
                 raw_price_str, raw_sale_price_str.
        config: CompositorConfig with duration, CTA text, fps, use_zoompan,
                output_dir.

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

    # Build full text overlays (name, brand, price/sale, CTA)
    is_on_sale, text_vf, tmp_paths = _build_text_overlays(product, config.cta_text)

    try:
        scale_pad = _build_scale_pad_filter(config.use_zoompan)

        if config.use_zoompan:
            zoompan = _build_zoompan_filter(config.duration_s, config.fps)
            video_chain = f"{scale_pad},{zoompan},{text_vf}"
        else:
            video_chain = f"{scale_pad},{text_vf}"

        if is_on_sale:
            # ---- filter_complex path: badge PNG is second input ----
            badge_path = ensure_sale_badge(config.output_dir)

            # Build filter_complex: video chain outputs [vid], then overlay badge at top-right
            filter_complex = (
                f"[0:v]{video_chain}[vid];"
                f"[vid][1:v]overlay=x=W-w-20:y=20[out]"
            )

            cmd = [
                "ffmpeg", "-y",
                "-loop", "1",
                "-framerate", str(config.fps),
                "-i", str(image_path),
                "-i", str(badge_path),
                "-filter_complex", filter_complex,
                "-map", "[out]",
                "-t", str(config.duration_s),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ]

            logger.info(
                "Composing sale product video (filter_complex): image=%s output=%s duration=%ds zoompan=%s",
                image_path.name,
                output_path.name,
                config.duration_s,
                config.use_zoompan,
            )

        else:
            # ---- -vf path: single input, no badge ----
            cmd = [
                "ffmpeg", "-y",
                "-loop", "1",
                "-framerate", str(config.fps),
                "-i", str(image_path),
                "-vf", video_chain,
                "-t", str(config.duration_s),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "20",
                "-pix_fmt", "yuv420p",
                str(output_path),
            ]

            logger.info(
                "Composing product video (-vf): image=%s output=%s duration=%ds zoompan=%s",
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
