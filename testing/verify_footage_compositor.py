"""Standalone verification for compose_product_video_from_footage (Wave 4.1 / G6).

Exercises the new footage-mode FFmpeg path end-to-end with real media:
  - base layer built from two trimmed ranges of a real source video (cycled)
  - product image overlaid as a PiP card (fade-in, bottom-right, medium)
  - source audio muted, output forced to 1080x1920

Run: python testing/verify_footage_compositor.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.product_video_compositor import (  # noqa: E402
    compose_product_video_from_footage,
    CompositorConfig,
)

SOURCE = ROOT / "test_media" / "demo_source.mp4"
OUTPUT = ROOT / "output" / "product_videos" / "_verify_footage_g6.mp4"


def _pick_product_image() -> Path:
    candidates = sorted((ROOT / "media").rglob("*.jpg"))
    if not candidates:
        raise FileNotFoundError("No product image (.jpg) found under media/")
    return candidates[0]


def main() -> int:
    if not SOURCE.exists():
        print(f"FAIL: source video missing: {SOURCE}")
        return 1

    pip_image = _pick_product_image()
    print(f"source footage : {SOURCE}")
    print(f"pip image      : {pip_image}")

    # Two trimmed ranges from the same real source video, cycled to fill 15s
    footage_clips = [
        {"path": str(SOURCE), "start": 2.0, "end": 7.0, "trim": True},
        {"path": str(SOURCE), "start": 10.0, "end": 16.0, "trim": True},
    ]

    product = {
        "title": "Bocanci cu bombeu Oregon Rossini S3 — piele nabuc",
        "brand": "Oregon",
        "price": 299.99,
        "sale_price": 249.99,
        "raw_price_str": "299,99 RON",
        "raw_sale_price_str": "249,99 RON",
    }

    config = CompositorConfig(
        duration_s=15,
        cta_text="Comanda acum!",
        fps=25,
        template_name="product_spotlight",
    )
    pip_config = {
        "enabled": True,
        "position": "bottom-right",
        "size": "medium",
        "animation": "fade",
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    compose_product_video_from_footage(
        footage_clips=footage_clips,
        pip_image_path=pip_image,
        output_path=OUTPUT,
        product=product,
        config=config,
        pip_config=pip_config,
    )

    if not OUTPUT.exists() or OUTPUT.stat().st_size == 0:
        print("FAIL: no output produced")
        return 1
    print(f"OK: wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
