"""
overlay_renderer.py - FFmpeg functions for PiP and interstitial slide rendering.

Provides two core overlay functions used by the assembly pipeline:

1. generate_interstitial_clip(...)
   Renders a product image as a portrait video clip (1080x1920) with optional
   Ken Burns animation or static hold. Used for interstitial slides between
   video segments.

2. apply_pip_overlay(...)
   Composites a product image as a Picture-in-Picture overlay on top of a
   video segment at a configurable position, size, and animation. Supports
   static, fade, and kenburns animations.

3. _download_image(...) — internal helper
   Downloads an image from a URL to a temp directory. Falls back gracefully
   on failure (returns None).

All functions are async-compatible: blocking FFmpeg subprocess calls are
dispatched via asyncio.to_thread so the event loop is never blocked.

Graceful degradation: on any FFmpeg failure, functions log the error and
return None (generate_interstitial_clip) or the original video path
(apply_pip_overlay) so the render pipeline continues uninterrupted.
"""
import asyncio
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Literal

logger = logging.getLogger(__name__)

# Output dimensions: portrait 1080x1920 (9:16 for TikTok/Reels/Shorts)
W_OUT = 1080
H_OUT = 1920
FPS = 30

# Pre-scale factor for smooth zoompan: 4x prevents jittery motion
W_LARGE = W_OUT * 4   # 4320px
H_LARGE = W_LARGE * H_OUT // W_OUT  # 7680px

# PiP size map: name -> (width_px, height_px)
PIP_SIZE_MAP = {
    "small":  (150, 150),
    "medium": (200, 200),
    "large":  (280, 280),
}

# PiP position expressions (FFmpeg overlay x:y, W/H refer to main video dims)
# Offsets chosen to avoid TikTok/Reels UI chrome and bottom interaction zone
PIP_POSITION_MAP = {
    "top-left":     "x=40:y=200",
    "top-right":    "x=W-w-40:y=200",
    "bottom-left":  "x=40:y=H-h-250",
    "bottom-right": "x=W-w-40:y=H-h-250",
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _download_image(url_or_path: str, temp_dir: str) -> Optional[str]:
    """Download an image from a URL to temp_dir, or verify a local path exists.

    Args:
        url_or_path: Either a local filesystem path or an http/https URL.
        temp_dir: Directory for downloaded files.

    Returns:
        Local path to the image on success, None on failure.
    """
    if not url_or_path:
        return None

    # Local path — verify it exists
    if not url_or_path.startswith("http"):
        if os.path.exists(url_or_path):
            return url_or_path
        logger.warning("[overlay_renderer] Local image path not found: %s", url_or_path)
        return None

    # URL — download via httpx
    try:
        import httpx  # already in requirements

        dest = os.path.join(temp_dir, "overlay_img_" + _url_basename(url_or_path))
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url_or_path)
            resp.raise_for_status()
            with open(dest, "wb") as f:
                f.write(resp.content)
        logger.debug("[overlay_renderer] Downloaded image: %s -> %s", url_or_path, dest)
        return dest
    except Exception as exc:
        logger.warning("[overlay_renderer] Failed to download image %s: %s", url_or_path, exc)
        return None


def _url_basename(url: str) -> str:
    """Extract a safe filename from a URL, preserving extension."""
    try:
        from urllib.parse import urlparse, unquote
        path = urlparse(url).path
        base = unquote(os.path.basename(path)) or "image.jpg"
        # Keep only safe characters
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in base)
        return safe or "image.jpg"
    except Exception:
        return "image.jpg"


def _build_zoompan_filter_overlay(
    duration_s: float,
    fps: int = FPS,
    direction: Literal["zoom-in", "zoom-out", "pan-left", "pan-right"] = "zoom-in",
) -> str:
    """Build an FFmpeg zoompan Ken Burns filter for overlay_renderer.

    Supports four directions:
    - zoom-in:   zoom from 1.0 to 1.5, centered
    - zoom-out:  zoom from 1.5 to 1.0, centered
    - pan-left:  slow pan from right edge to left edge at constant zoom=1.3
    - pan-right: slow pan from left edge to right edge at constant zoom=1.3

    Input must have been pre-scaled to W_LARGE x H_LARGE for smooth motion.
    Output is W_OUT x H_OUT.
    """
    n_frames = int(fps * duration_s)
    if n_frames < 1:
        n_frames = 1

    if direction == "zoom-in":
        z_inc = 0.5 / n_frames
        z_expr = f"min(zoom+{z_inc:.6f},1.5)"
        x_expr = "iw/2-(iw/zoom/2)"
        y_expr = "ih/2-(ih/zoom/2)"

    elif direction == "zoom-out":
        z_inc = 0.5 / n_frames
        z_expr = f"if(eq(on,1),1.5,max(zoom-{z_inc:.6f},1.0))"
        x_expr = "iw/2-(iw/zoom/2)"
        y_expr = "ih/2-(ih/zoom/2)"

    elif direction == "pan-left":
        # Zoom fixed at 1.3, pan x from right to left
        # x moves from (iw-iw/zoom) toward 0 over n_frames
        # FFmpeg zoompan: x is the TOP-LEFT corner of the output crop
        x_expr = f"(iw-iw/1.3)*max(0,(1-on/{n_frames}))"
        y_expr = "ih/2-(ih/1.3/2)"
        z_expr = "1.3"

    else:  # pan-right
        # Zoom fixed at 1.3, pan x from left to right
        x_expr = f"(iw-iw/1.3)*min(1,on/{n_frames})"
        y_expr = "ih/2-(ih/1.3/2)"
        z_expr = "1.3"

    return (
        f"zoompan=z='{z_expr}':"
        f"x='{x_expr}':"
        f"y='{y_expr}':"
        f"d={n_frames}:"
        f"s={W_OUT}x{H_OUT}:"
        f"fps={fps}"
    )


def _run_ffmpeg(cmd: list) -> subprocess.CompletedProcess:
    """Run an FFmpeg command synchronously, capturing output."""
    logger.debug("[overlay_renderer] FFmpeg cmd: %s", " ".join(str(c) for c in cmd))
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=300,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_interstitial_clip(
    image_url_or_path: str,
    output_path: str,
    duration: float,
    animation: Literal["static", "kenburns"] = "static",
    ken_burns_direction: Literal["zoom-in", "zoom-out", "pan-left", "pan-right"] = "zoom-in",
    width: int = W_OUT,
    height: int = H_OUT,
    fps: int = FPS,
) -> Optional[str]:
    """Render a product image as a portrait video clip for use as an interstitial slide.

    Args:
        image_url_or_path: HTTP URL or local filesystem path to the source image.
        output_path: Destination MP4 file path.
        duration: Clip duration in seconds.
        animation: "static" (hold) or "kenburns" (animated zoom/pan).
        ken_burns_direction: Only used when animation="kenburns".
            "zoom-in" | "zoom-out" | "pan-left" | "pan-right"
        width: Output video width (default 1080).
        height: Output video height (default 1920).
        fps: Output frame rate (default 30).

    Returns:
        output_path on success, None on any failure.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        local_img = await _download_image(image_url_or_path, tmp_dir)
        if not local_img:
            logger.error(
                "[overlay_renderer] generate_interstitial_clip: could not obtain image from %s",
                image_url_or_path,
            )
            return None

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        try:
            result = await asyncio.to_thread(
                _run_interstitial_ffmpeg,
                local_img, output_path, duration, animation,
                ken_burns_direction, width, height, fps,
            )
            if result.returncode != 0:
                logger.error(
                    "[overlay_renderer] generate_interstitial_clip FFmpeg failed (rc=%d): %s",
                    result.returncode, result.stderr[-2000:],
                )
                return None
            logger.info(
                "[overlay_renderer] Generated interstitial clip: %s (%.1fs, %s)",
                output_path, duration, animation,
            )
            return output_path

        except Exception as exc:
            logger.error(
                "[overlay_renderer] generate_interstitial_clip exception: %s", exc
            )
            return None


def _run_interstitial_ffmpeg(
    local_img: str,
    output_path: str,
    duration: float,
    animation: str,
    ken_burns_direction: str,
    width: int,
    height: int,
    fps: int,
) -> subprocess.CompletedProcess:
    """Synchronous FFmpeg call for interstitial clip generation (runs in thread)."""

    if animation == "kenburns":
        # Pre-scale to 4x for smooth zoompan
        w_large = width * 4
        h_large = w_large * height // width
        scale_pad = (
            f"scale={w_large}:-1:force_original_aspect_ratio=decrease,"
            f"pad={w_large}:{h_large}:(ow-iw)/2:(oh-ih)/2:black"
        )
        zoompan = _build_zoompan_filter_overlay(duration, fps, ken_burns_direction)
        vf = f"{scale_pad},{zoompan}"
    else:
        # Static: scale and center-crop to exact output dimensions
        vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}"
        )

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-framerate", str(fps),
        "-i", local_img,
        "-vf", vf,
        "-t", str(duration),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-an",  # no audio
        output_path,
    ]
    return _run_ffmpeg(cmd)


async def apply_pip_overlay(
    video_path: str,
    image_url_or_path: str,
    output_path: str,
    position: Literal["top-left", "top-right", "bottom-left", "bottom-right"] = "bottom-right",
    size: Literal["small", "medium", "large"] = "medium",
    animation: Literal["static", "fade", "kenburns"] = "static",
    duration: Optional[float] = None,
    width: int = W_OUT,
    height: int = H_OUT,
) -> str:
    """Composite a product image as a Picture-in-Picture overlay on a video segment.

    On any failure (image download error, FFmpeg error), logs the issue and
    returns the original video_path so the render pipeline continues unaffected.

    Args:
        video_path: Path to the source video file.
        image_url_or_path: HTTP URL or local path to the PiP image.
        output_path: Destination MP4 file path.
        position: Corner for the PiP overlay.
        size: PiP image size category.
        animation: "static" | "fade" | "kenburns"
        duration: Video duration in seconds (needed for fade timing). If None,
            the overlay is applied for the full segment length.
        width: Video width (default 1080).
        height: Video height (default 1920).

    Returns:
        output_path on success, video_path (original) on failure.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        local_img = await _download_image(image_url_or_path, tmp_dir)
        if not local_img:
            logger.warning(
                "[overlay_renderer] apply_pip_overlay: could not obtain image from %s; "
                "skipping PiP overlay",
                image_url_or_path,
            )
            return video_path

        pip_w, pip_h = PIP_SIZE_MAP.get(size, PIP_SIZE_MAP["medium"])
        overlay_pos = PIP_POSITION_MAP.get(position, "x=W-w-40:y=H-h-250")

        # Ensure output directory exists
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        try:
            result = await asyncio.to_thread(
                _run_pip_ffmpeg,
                video_path, local_img, output_path,
                pip_w, pip_h, overlay_pos, animation, duration,
            )
            if result.returncode != 0:
                logger.error(
                    "[overlay_renderer] apply_pip_overlay FFmpeg failed (rc=%d): %s; "
                    "returning original video",
                    result.returncode, result.stderr[-2000:],
                )
                return video_path

            logger.info(
                "[overlay_renderer] Applied PiP overlay: %s (pos=%s, size=%s, anim=%s)",
                output_path, position, size, animation,
            )
            return output_path

        except Exception as exc:
            logger.error(
                "[overlay_renderer] apply_pip_overlay exception: %s; returning original video",
                exc,
            )
            return video_path


def _run_pip_ffmpeg(
    video_path: str,
    local_img: str,
    output_path: str,
    pip_w: int,
    pip_h: int,
    overlay_pos: str,
    animation: str,
    duration: Optional[float],
) -> subprocess.CompletedProcess:
    """Synchronous FFmpeg call for PiP overlay (runs in thread)."""

    if animation == "kenburns":
        # Pre-scale the PiP image to 2x pip size for smooth zoompan, then zoompan,
        # then scale down to target pip size.
        pip_large_w = pip_w * 2
        pip_large_h = pip_h * 2
        dur = duration or 5.0  # fallback if unknown
        n_frames = int(30 * dur)
        if n_frames < 1:
            n_frames = 1
        z_inc = 0.5 / n_frames
        z_expr = f"min(zoom+{z_inc:.6f},1.5)"
        zoompan = (
            f"zoompan=z='{z_expr}':"
            f"x='iw/2-(iw/zoom/2)':"
            f"y='ih/2-(ih/zoom/2)':"
            f"d={n_frames}:"
            f"s={pip_large_w}x{pip_large_h}:"
            f"fps=30"
        )
        pip_chain = (
            f"[1:v]scale={pip_large_w}:{pip_large_h}:force_original_aspect_ratio=increase,"
            f"crop={pip_large_w}:{pip_large_h},"
            f"{zoompan},"
            f"scale={pip_w}:{pip_h}[pip]"
        )
        filter_complex = f"{pip_chain};[0:v][pip]overlay={overlay_pos}[out]"

    elif animation == "fade" and duration is not None:
        # Fade in during first 0.5s, fade out during last 0.5s
        fade_in_end = 0.5
        fade_out_start = max(duration - 0.5, fade_in_end)
        alpha_expr = (
            f"if(lt(t,{fade_in_end:.3f}),t/{fade_in_end:.3f},"
            f"if(gt(t,{fade_out_start:.3f}),(1-(t-{fade_out_start:.3f})/{0.5:.3f}),1))"
        )
        pip_chain = (
            f"[1:v]scale={pip_w}:{pip_h}:force_original_aspect_ratio=increase,"
            f"crop={pip_w}:{pip_h},"
            f"format=rgba,"
            f"geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha_expr}*255*alpha(X,Y)/255'[pip]"
        )
        filter_complex = f"{pip_chain};[0:v][pip]overlay={overlay_pos}[out]"

    else:
        # Static: simple overlay for entire segment duration
        pip_chain = (
            f"[1:v]scale={pip_w}:{pip_h}:force_original_aspect_ratio=increase,"
            f"crop={pip_w}:{pip_h}[pip]"
        )
        filter_complex = f"{pip_chain};[0:v][pip]overlay={overlay_pos}[out]"

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-loop", "1",
        "-i", local_img,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-map", "0:a?",       # copy audio from main video if present
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "fast",
        "-c:a", "copy",
        "-shortest",          # end when shortest input finishes (main video)
        output_path,
    ]
    return _run_ffmpeg(cmd)
