"""Filter-chain invariants for SegmentTransform.to_ffmpeg_filters.

Regression for the pipeline adjust-suite bug: zoom-out (scale < 1) generated
`scale=<smaller>,crop=1080:1920` — a fatal FFmpeg error ("Invalid too big or
non positive size"), which failed segment extraction and the whole render.
"""
import re

import pytest

from app.services.segment_transforms import SegmentTransform


def _dims_after(filters: list[str], w: int, h: int) -> tuple[int, int]:
    """Simulate frame dimensions through the (numeric-arg) filter chain."""
    for f in filters:
        name, _, args = f.partition("=")
        parts = args.split(":")
        if name == "scale" and "force_original_aspect_ratio" in args:
            tw, th = int(parts[0]), int(parts[1])
            factor = max(tw / w, th / h)
            w, h = round(w * factor), round(h * factor)
        elif name == "scale":
            w, h = int(parts[0]), int(parts[1])
        elif name == "crop":
            cw, ch = int(parts[0]), int(parts[1])
            assert cw <= w and ch <= h, f"crop {cw}x{ch} larger than frame {w}x{h}: {filters}"
            w, h = cw, ch
        elif name == "pad":
            pw, ph = int(parts[0]), int(parts[1])
            assert pw >= w and ph >= h, f"pad {pw}x{ph} smaller than frame {w}x{h}: {filters}"
            w, h = pw, ph
        elif name == "transpose":
            w, h = h, w
        # hflip/vflip/rotate/colorchannelmixer keep dimensions
    return w, h


SOURCE_DIMS = [(1920, 1080), (1080, 1920), (3840, 2160), (720, 1280)]
TRANSFORMS = [
    {"scale": 0.93},                       # the render-breaking case
    {"scale": 0.5},
    {"scale": 1.22},
    {"scale": 0.93, "rotation": 90},
    {"scale": 1.1, "pan_x": 50, "pan_y": -30},
    {"rotation": 180, "flip_h": True, "opacity": 0.7},
]


@pytest.mark.parametrize("src_w,src_h", SOURCE_DIMS)
@pytest.mark.parametrize("transform", TRANSFORMS)
@pytest.mark.parametrize("target_w,target_h", [(1080, 1920), (540, 960)])
def test_chain_valid_and_ends_at_target(transform, src_w, src_h, target_w, target_h):
    filters = SegmentTransform.from_dict(transform).to_ffmpeg_filters(target_w, target_h)
    out_w, out_h = _dims_after(filters, src_w, src_h)
    assert (out_w, out_h) == (target_w, target_h)


def test_identity_returns_empty():
    assert SegmentTransform.from_dict({"scale": 1.0}).to_ffmpeg_filters(1080, 1920) == []
    assert SegmentTransform.from_dict(None).to_ffmpeg_filters(1080, 1920) == []


def test_zoom_dimensions_are_even():
    # yuv420p requires even dims for intermediate frames
    filters = SegmentTransform.from_dict({"scale": 0.93}).to_ffmpeg_filters(1080, 1920)
    zoom_scales = [f for f in filters if re.fullmatch(r"scale=\d+:\d+", f)]
    for f in zoom_scales:
        w, h = map(int, f.split("=")[1].split(":"))
        assert w % 2 == 0 and h % 2 == 0
