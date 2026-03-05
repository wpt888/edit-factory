"""Logo overlay service using PIL/Pillow."""

import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)


def apply_logo_overlay(
    base_path: str,
    logo_path: str,
    output_path: str,
    x: int = 0,
    y: int = 0,
    scale: float = 1.0,
) -> str:
    """Paste logo onto base image at given position with scale.

    Args:
        base_path: Path to the base image (AI-generated).
        logo_path: Path to the logo image (PNG with alpha recommended).
        output_path: Where to save the composited result.
        x: Horizontal pixel offset for logo placement.
        y: Vertical pixel offset for logo placement.
        scale: Scale factor for logo (1.0 = original size).

    Returns:
        output_path on success.
    """
    base = Image.open(base_path).convert("RGBA")
    logo = Image.open(logo_path).convert("RGBA")

    # Guard: reject logos larger than the base image (after scaling)
    scaled_w = max(1, int(logo.width * scale))
    scaled_h = max(1, int(logo.height * scale))
    if scaled_w > base.width or scaled_h > base.height:
        raise ValueError(
            f"Logo ({scaled_w}x{scaled_h}) exceeds base image ({base.width}x{base.height})"
        )

    # Resize logo by scale factor
    if scale != 1.0:
        new_w = max(1, int(logo.width * scale))
        new_h = max(1, int(logo.height * scale))
        logo = logo.resize((new_w, new_h), Image.LANCZOS)

    # Clamp position so logo stays within bounds
    x = max(0, min(x, base.width - logo.width))
    y = max(0, min(y, base.height - logo.height))

    # Composite using alpha channel
    base.paste(logo, (x, y), logo)

    # Save as PNG to preserve quality
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(str(out), "PNG")

    logger.info(f"Logo overlay applied: {output_path} (pos={x},{y} scale={scale})")
    return str(out)
