"""
textfile_helper.py - FFmpeg textfile= pattern for Romanian diacritics and Unicode text.

FFmpeg's drawtext filter has limited support for non-ASCII characters when using
the text= parameter directly on some platforms. The textfile= pattern — writing the
text to a UTF-8 temp file and referencing it — is the reliable cross-platform approach.

This module establishes the canonical pattern for ALL text overlays in the product
video pipeline. Phase 18 (product_video_compositor.py) MUST use build_drawtext_filter
for every text element; never use text= for product content.

Usage:
    from app.services.textfile_helper import build_drawtext_filter, cleanup_textfiles, build_multi_drawtext

    # Single overlay
    filt, tmp = build_drawtext_filter('Preț special: Șoșete bărbați — 149,99 RON', fontsize=36)
    # ... run FFmpeg with filt ...
    cleanup_textfiles(tmp)

    # Multiple overlays (product name + price + brand)
    combined_vf, tmps = build_multi_drawtext([
        {'text': 'Șoșete bărbați', 'fontsize': 32, 'fontcolor': 'white', 'x': '20', 'y': '20'},
        {'text': '149,99 RON', 'fontsize': 24, 'fontcolor': 'yellow', 'x': '20', 'y': '70'},
    ])
    # ... run FFmpeg with -vf combined_vf ...
    cleanup_textfiles(*tmps)
"""
import logging
import os
import tempfile

logger = logging.getLogger(__name__)


def build_drawtext_filter(
    text: str,
    fontsize: int = 36,
    fontcolor: str = "white",
    x: str = "10",
    y: str = "10",
    fontfile: str = None,
    box: bool = False,
    boxcolor: str = "black@0.5",
    boxborderw: int = 5,
) -> tuple[str, str]:
    """Build an FFmpeg drawtext filter string using the textfile= pattern.

    Writes `text` to a temporary UTF-8 file, then constructs a drawtext filter
    that references it via textfile=. This correctly handles Romanian diacritics
    (ă î ș ț â Ș Ț) and any other Unicode content.

    IMPORTANT: The caller is responsible for deleting the temp file after FFmpeg
    completes. Use cleanup_textfiles(tmp_path) for convenience.

    Args:
        text: The text to display. May contain any Unicode characters.
        fontsize: Font size in pixels.
        fontcolor: FFmpeg color string (e.g. 'white', 'yellow', '0xFFFFFF').
        x: Horizontal position expression (e.g. '10', '(w-text_w)/2').
        y: Vertical position expression (e.g. '10', '(h-text_h)/2').
        fontfile: Optional path to a .ttf/.otf font file. If None, FFmpeg uses
                  its default font.
        box: If True, draw a background box behind the text.
        boxcolor: FFmpeg color string for the box background.
        boxborderw: Box border width in pixels.

    Returns:
        Tuple of (filter_string, textfile_path) where:
        - filter_string: Complete drawtext filter ready for use as -vf argument.
        - textfile_path: Path to the temp file that must be deleted by the caller.
    """
    # Write text to a UTF-8 temp file
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".txt",
        delete=False,
    )
    tmp.write(text)
    tmp.flush()
    tmp.close()
    tmp_path = tmp.name

    # Build filter — escape single quotes in file path for FFmpeg filter syntax
    escaped_path = tmp_path.replace("'", "\\'")
    parts = [
        f"drawtext=textfile='{escaped_path}'",
        f"fontsize={fontsize}",
        f"fontcolor={fontcolor}",
        f"x={x}",
        f"y={y}",
    ]

    if fontfile:
        escaped_font = fontfile.replace("'", "\\'")
        parts.append(f"fontfile='{escaped_font}'")

    if box:
        parts.append("box=1")
        parts.append(f"boxcolor={boxcolor}")
        parts.append(f"boxborderw={boxborderw}")

    filter_string = ":".join(parts)
    logger.debug("Built drawtext filter for text %r -> textfile=%s", text[:40], tmp_path)
    return (filter_string, tmp_path)


def cleanup_textfiles(*paths: str) -> None:
    """Delete temporary textfiles created by build_drawtext_filter.

    Swallows FileNotFoundError — safe to call even if files have already been
    deleted. Other exceptions are logged as warnings and suppressed.

    Args:
        *paths: One or more file paths to delete.
    """
    for path in paths:
        try:
            os.unlink(path)
            logger.debug("Cleaned up textfile: %s", path)
        except FileNotFoundError:
            pass
        except Exception as exc:
            logger.warning("Failed to clean up textfile %s: %s", path, exc)


def build_multi_drawtext(texts: list[dict]) -> tuple[str, list[str]]:
    """Build a combined FFmpeg drawtext filter for multiple text overlays.

    Each dict in `texts` must contain:
        text (str): The text to display.
        fontsize (int): Font size.
        fontcolor (str): FFmpeg color string.
        x (str): Horizontal position.
        y (str): Vertical position.

    Optional keys (passed through to build_drawtext_filter):
        fontfile (str): Path to font file.
        box (bool): Whether to draw a background box.
        boxcolor (str): Box background color.
        boxborderw (int): Box border width.

    This enables product name + price + brand as a single -vf argument:
        combined_vf, tmps = build_multi_drawtext([...])
        subprocess.run(['ffmpeg', ..., '-vf', combined_vf, ...])
        cleanup_textfiles(*tmps)

    Args:
        texts: List of overlay specification dicts (see above).

    Returns:
        Tuple of (combined_filter_string, list_of_textfile_paths) where:
        - combined_filter_string: All drawtext filters joined with ',' for -vf.
        - list_of_textfile_paths: All temp files that must be cleaned up by caller.
    """
    filter_parts = []
    tmp_paths = []

    for spec in texts:
        filt, tmp = build_drawtext_filter(
            text=spec["text"],
            fontsize=spec.get("fontsize", 36),
            fontcolor=spec.get("fontcolor", "white"),
            x=spec.get("x", "10"),
            y=spec.get("y", "10"),
            fontfile=spec.get("fontfile"),
            box=spec.get("box", False),
            boxcolor=spec.get("boxcolor", "black@0.5"),
            boxborderw=spec.get("boxborderw", 5),
        )
        filter_parts.append(filt)
        tmp_paths.append(tmp)

    combined = ",".join(filter_parts)
    return (combined, tmp_paths)
