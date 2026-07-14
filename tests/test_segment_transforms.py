"""Filter-chain invariants for SegmentTransform.to_ffmpeg_filters.

Regression for the pipeline adjust-suite bug: zoom-out (scale < 1) generated
`scale=<smaller>,crop=1080:1920` — a fatal FFmpeg error ("Invalid too big or
non positive size"), which failed segment extraction and the whole render.
"""
import re

import pytest

from app.services.segment_transforms import SegmentTransform
from app.services.assembly_service import (
    _segment_extraction_timing,
    _segment_filter_chain,
)


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
        # hflip/vflip/rotate/eq keep dimensions
    return w, h


SOURCE_DIMS = [(1920, 1080), (1080, 1920), (3840, 2160), (720, 1280)]
TRANSFORMS = [
    {"scale": 0.93},                       # the render-breaking case
    {"scale": 0.5},
    {"scale": 1.22},
    {"scale": 0.93, "rotation": 90},
    {"scale": 1.1, "pan_x": 50, "pan_y": -30},
    {"rotation": 180, "flip_h": True, "brightness": 0.15},
]


@pytest.mark.parametrize("src_w,src_h", SOURCE_DIMS)
@pytest.mark.parametrize("transform", TRANSFORMS)
@pytest.mark.parametrize("target_w,target_h", [(1080, 1920), (540, 960)])
def test_chain_valid_and_ends_at_target(transform, src_w, src_h, target_w, target_h):
    filters = SegmentTransform.from_dict(transform).to_ffmpeg_filters(target_w, target_h)
    out_w, out_h = _dims_after(filters, src_w, src_h)
    assert (out_w, out_h) == (target_w, target_h)


def test_defaults_skip_custom_visual_chain():
    assert SegmentTransform.from_dict({"scale": 1.0}).to_ffmpeg_filters(1080, 1920) == []
    assert SegmentTransform.from_dict(None).to_ffmpeg_filters(1080, 1920) == []
    assert SegmentTransform.from_dict(None).is_identity()
    assert not SegmentTransform.from_dict(None).has_transforms()


def test_defaults_produce_plain_extraction_chain():
    transform = SegmentTransform.from_dict(None)

    assert _segment_filter_chain(transform, 1080, 1920) == [
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920",
    ]


def test_from_dict_ignores_legacy_opacity_and_unknown_keys():
    transform = SegmentTransform.from_dict({"opacity": 0.25, "future_key": "ignored"})

    assert not hasattr(transform, "opacity")
    assert transform.is_identity()
    assert transform.to_ffmpeg_filters(1080, 1920) == []


def test_zoom_dimensions_are_even():
    # yuv420p requires even dims for intermediate frames
    filters = SegmentTransform.from_dict({"scale": 0.93}).to_ffmpeg_filters(1080, 1920)
    zoom_scales = [f for f in filters if re.fullmatch(r"scale=\d+:\d+", f)]
    for f in zoom_scales:
        w, h = map(int, f.split("=")[1].split(":"))
        assert w % 2 == 0 and h % 2 == 0


def test_zoom_out_with_blur_fill_uses_split_overlay_graph():
    filters = SegmentTransform.from_dict(
        {"scale": 0.75, "blur_fill": True}
    ).to_ffmpeg_filters(1080, 1920)
    graph = ",".join(filters)

    assert "split=2[blur_bg][blur_fg]" in graph
    assert "[blur_bg]scale=1080:1920:force_original_aspect_ratio=increase" in graph
    assert "crop=1080:1920,boxblur=20:2[blurred_bg]" in graph
    assert "[blur_fg]scale=810:1440[scaled_fg]" in graph
    assert "[blurred_bg][scaled_fg]overlay=(W-w)/2:(H-h)/2" in graph
    assert "pad=1080:1920" not in graph


def test_zoom_out_without_blur_fill_keeps_black_pad():
    filters = SegmentTransform.from_dict({"scale": 0.75}).to_ffmpeg_filters(1080, 1920)

    assert "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" in filters
    assert "split=2" not in ",".join(filters)


def test_color_emits_single_eq_after_pan_before_final_norm():
    filters = SegmentTransform.from_dict({
        "pan_x": 20,
        "brightness": 0.2,
        "contrast": 1.5,
        "saturation": 0.8,
    }).to_ffmpeg_filters(1080, 1920)

    eq_filter = "eq=brightness=0.20:contrast=1.50:saturation=0.80"
    eq_index = filters.index(eq_filter)
    pan_crop_index = max(i for i, value in enumerate(filters[:eq_index]) if value == "crop=1080:1920")
    assert pan_crop_index < eq_index
    assert filters[eq_index + 1:] == [
        "scale=1080:1920:force_original_aspect_ratio=increase",
        "crop=1080:1920",
    ]


@pytest.mark.parametrize(
    "speed,expected_source_duration",
    [(0.5, 1.5), (1.0, 3.0), (2.0, 6.0), (4.0, 12.0)],
)
def test_speed_adjusts_source_window_and_keeps_direct_output_slot(
    speed, expected_source_duration
):
    timing = _segment_extraction_timing(
        segment_duration=20.0,
        needed_duration=3.0,
        speed=speed,
    )

    assert timing.required_source_duration == expected_source_duration
    assert timing.source_window_duration == expected_source_duration
    assert not timing.use_loop
    assert timing.loop_count == 1


def test_speed_uses_existing_loop_fallback_when_source_is_short():
    timing = _segment_extraction_timing(
        segment_duration=4.0,
        needed_duration=3.0,
        speed=2.0,
    )

    assert timing.required_source_duration == 6.0
    assert timing.source_window_duration == 4.0
    assert timing.use_loop
    assert timing.loop_count == 2


def test_speed_filter_is_applied_at_extraction():
    transform = SegmentTransform.from_dict({"speed": 2.0})

    assert transform.has_transforms()
    assert not transform.is_identity()
    assert _segment_filter_chain(transform, 540, 960) == [
        "setpts=PTS/2",
        "scale=540:960:force_original_aspect_ratio=increase",
        "crop=540:960",
    ]
