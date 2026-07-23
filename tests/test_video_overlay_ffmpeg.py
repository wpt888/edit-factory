"""Phase C — video-on-video overlay compositor tests.

Unit tests (always run): overlay item ordering/z, setpts + enable strings, box
px math at 1080x1920 AND 540x960, fit contain vs cover, the magnetic/free split
at the save_composition ingress, and _build_video_overlay_clips.

Real-ffmpeg smoke (skipped without ffmpeg, like test_transitions_ffmpeg.py):
duration invariant + measurable pixel diff inside the overlay window and none
outside it; xfade-on-V1 + a video overlay coexist without error.
"""
import asyncio
import os
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.video_effects import overlay_renderer
from app.services.assembly_service import (
    TimelineEntry,
    _build_video_overlay_clips,
    _overlay_items_from_specs,
)


# --------------------------------------------------------------------------- #
# apply_overlay_timeline — filtergraph strings (no ffmpeg, spy the subprocess)  #
# --------------------------------------------------------------------------- #

def _run_overlay(items, duration=6.0, width=1080, height=1920):
    captured = {}

    def spy(cmd, timeout=None, operation=None):
        captured["cmd"] = list(cmd)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    with patch.object(overlay_renderer, "safe_ffmpeg_run", side_effect=spy):
        asyncio.run(overlay_renderer.apply_overlay_timeline(
            Path("base.mp4"), items, Path("out.mp4"), width, height, duration,
        ))
    return captured["cmd"]


def _fc(cmd):
    return cmd[cmd.index("-filter_complex") + 1]


def _video_item(z, path, start=2.0, end=3.0, box_px=(0, 0, 100, 100), fit="contain"):
    return {
        "source_path": path, "is_video": True,
        "start": start, "end": end, "box_px": box_px, "fit": fit, "z": z,
    }


def test_items_applied_ascending_by_z():
    # Higher z must be overlaid LAST (= in front). Feed out of order.
    cmd = _run_overlay([_video_item(3000, "hi.mp4"), _video_item(2000, "lo.mp4")])
    inputs = [cmd[i + 1] for i, a in enumerate(cmd) if a == "-i"]
    # base first, then lo (z=2000, bottom), then hi (z=3000, top)
    assert inputs == ["base.mp4", "lo.mp4", "hi.mp4"]
    fc = _fc(cmd)
    # ov1 (lo) overlaid onto the base, ov2 (hi) overlaid on top of that.
    assert "[0:v][ov1]overlay" in fc
    assert "[vov1][ov2]overlay" in fc


def test_video_item_setpts_offset_and_enable_window():
    fc = _fc(_run_overlay([_video_item(2000, "v.mp4", start=2.0, end=3.5)]))
    assert "setpts=PTS-STARTPTS+2.0/TB" in fc
    assert "enable='between(t,2.0,3.5)'" in fc
    assert "eof_action=pass" in fc
    # Video items never fade (that's an image-only affordance).
    assert "fade=" not in fc


def test_video_item_has_no_loop_input():
    # Video overlays are pre-trimmed clips: plain -i, never -loop 1.
    cmd = _run_overlay([_video_item(2000, "v.mp4")])
    assert "-loop" not in cmd


def test_attention_image_static_and_motion_presets_change_filtergraph():
    base = {
        "source_path": "image.png", "is_video": False,
        "start": 2.0, "end": 3.5, "box_px": (100, 200, 400, 500),
        "fit": "contain", "z": 2,
    }

    static_fc = _fc(_run_overlay([{**base, "animation": {
        "preset": "static", "enterMs": 250, "exitMs": 200,
    }}]))
    assert "fade=" not in static_fc
    assert "overlay=100:200" in static_fc

    slide_fc = _fc(_run_overlay([{**base, "animation": {
        "preset": "slide-right", "enterMs": 250, "exitMs": 200,
    }}]))
    assert "fade=t=in" in slide_fc
    assert "overlay='100+" in slide_fc

    zoom_fc = _fc(_run_overlay([{**base, "animation": {
        "preset": "zoom", "enterMs": 250, "exitMs": 200,
    }}]))
    assert "eval=frame" in zoom_fc
    assert "overlay_w" in zoom_fc


def test_fit_contain_vs_cover_sizing_at_both_resolutions():
    # contain -> decrease + pad ; cover -> increase + crop. Box px verbatim.
    full_1080 = _video_item(2000, "v.mp4", box_px=(0, 0, 1080, 1920), fit="contain")
    fc = _fc(_run_overlay([full_1080], width=1080, height=1920))
    assert "scale=1080:1920:force_original_aspect_ratio=decrease" in fc
    assert "pad=1080:1920" in fc

    half = _video_item(2000, "v.mp4", box_px=(54, 192, 270, 240), fit="cover")
    fc = _fc(_run_overlay([half], width=540, height=960))
    assert "scale=270:240:force_original_aspect_ratio=increase,crop=270:240" in fc
    assert "overlay=54:192" in fc


def test_attention_cues_video_layer_pretrimmed_and_flagged(tmp_path):
    # A mediaType="video" layer must download, pre-trim (mocked), and emit an
    # is_video item; an image layer stays is_video False in the same pass.
    timeline = {"cues": [{
        "startMs": 2000, "durationMs": 1500,
        "layers": [
            {"id": "l0", "assetUrl": "http://x/clip.mp4", "mediaType": "video",
             "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.4, "fit": "cover",
             "animation": {"delayMs": 0}},
            {"id": "l1", "assetUrl": "http://x/pic.jpg", "mediaType": "image",
             "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
             "animation": {"delayMs": 0}},
        ],
    }]}

    async def fake_download(src, _tmp):
        return str(tmp_path / os.path.basename(src))

    def fake_trim(src, dst, dur):
        assert 0.1 <= dur <= 2.0  # cue window, short
        return subprocess.CompletedProcess([], 0, "", "")

    with patch.object(overlay_renderer, "_download_image", side_effect=fake_download), \
         patch.object(overlay_renderer, "_pretrim_overlay_video", side_effect=fake_trim):
        items = asyncio.run(
            overlay_renderer._attention_cues_to_items(timeline, 1080, 1920, 6.0, str(tmp_path))
        )

    assert len(items) == 2
    assert items[0]["is_video"] is True and items[0]["source_path"].endswith("overlay_vid_0.mp4")
    assert items[1]["is_video"] is False
    # Video box math still comes from fractional coords.
    assert items[0]["box_px"] == (108, 384, 540, 768)


def test_attention_cues_drop_video_when_pretrim_fails(tmp_path):
    timeline = {"cues": [{"startMs": 0, "durationMs": 1000, "layers": [
        {"id": "l0", "assetUrl": "http://x/clip.mp4", "mediaType": "video",
         "x": 0, "y": 0, "width": 1, "height": 1, "animation": {"delayMs": 0}},
    ]}]}

    async def fake_download(src, _tmp):
        return str(tmp_path / "clip.mp4")

    def fail_trim(src, dst, dur):
        return subprocess.CompletedProcess([], 1, "", "boom")

    with patch.object(overlay_renderer, "_download_image", side_effect=fake_download), \
         patch.object(overlay_renderer, "_pretrim_overlay_video", side_effect=fail_trim):
        items = asyncio.run(
            overlay_renderer._attention_cues_to_items(timeline, 1080, 1920, 6.0, str(tmp_path))
        )
    assert items == []


def test_empty_items_returns_base_untouched():
    out = asyncio.run(overlay_renderer.apply_overlay_timeline(
        Path("base.mp4"), [], Path("out.mp4"), 1080, 1920, 6.0,
    ))
    assert out == Path("base.mp4")


# --------------------------------------------------------------------------- #
# _overlay_items_from_specs — fractional box -> px at each render dim           #
# --------------------------------------------------------------------------- #

def _spec(tmp_file, z=2000, start=2.0, dur=1.0, box=None, fit="contain"):
    entry = TimelineEntry(
        source_video_path="src.mp4", start_time=0.0, end_time=1.0,
        timeline_start=start, timeline_duration=dur,
    )
    return {"entry": entry, "box": box or {"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.25}, "fit": fit, "z": z}


def test_box_px_math_at_1080_and_540(tmp_path):
    f = tmp_path / "ov.mp4"
    f.write_bytes(b"x")
    spec = _spec(f)

    items = _overlay_items_from_specs([spec], [f], 1080, 1920)
    assert items[0]["box_px"] == (108.0, 384.0, 540.0, 480.0)
    assert items[0]["start"] == 2.0 and items[0]["end"] == 3.0
    assert items[0]["is_video"] is True and items[0]["z"] == 2000

    items = _overlay_items_from_specs([spec], [f], 540, 960)
    assert items[0]["box_px"] == (54.0, 192.0, 270.0, 240.0)


def test_overlay_items_drop_failed_extraction(tmp_path):
    f = tmp_path / "ov.mp4"
    f.write_bytes(b"x")
    # One good path, one None (extraction failed), one missing file.
    specs = [_spec(f, z=2000), _spec(f, z=3000), _spec(f, z=4000)]
    items = _overlay_items_from_specs(specs, [f, None, tmp_path / "nope.mp4"], 1080, 1920)
    assert len(items) == 1 and items[0]["z"] == 2000


# --------------------------------------------------------------------------- #
# _build_video_overlay_clips — resolve, clamp, z from track                     #
# --------------------------------------------------------------------------- #

def _segments():
    return [
        {"id": "s1", "source_video_id": "v1", "source_video_path": "/x/v1.mp4",
         "start_time": 0.0, "end_time": 10.0},
        {"id": "s2", "source_video_id": "v2", "source_video_path": "/x/v2.mp4",
         "start_time": 0.0, "end_time": 10.0},
    ]


def test_build_video_overlay_clips_z_from_track():
    overlay_raw = [
        {"segment_id": "s1", "track": 2, "timeline_start": 1.0, "start_time": 2.0,
         "end_time": 4.0, "timeline_duration": 2.0, "overlay_box": {"x": 0, "y": 0, "width": 0.5, "height": 0.5}},
        {"segment_id": "s2", "track": 3, "timeline_start": 0.5, "start_time": 1.0,
         "end_time": 3.0, "timeline_duration": 2.0},
    ]
    specs = _build_video_overlay_clips(overlay_raw, _segments())
    assert [s["z"] for s in specs] == [2000, 3001]  # track*1000 + index; V3 above V2
    assert specs[0]["entry"].timeline_start == 1.0  # absolute, not reflowed
    assert specs[0]["entry"].source_video_path == "/x/v1.mp4"
    assert specs[0]["entry"].transition_in is None
    assert specs[1]["fit"] == "contain"  # default when overlay_box absent


def test_build_video_overlay_clips_empty_is_none():
    assert _build_video_overlay_clips([], _segments()) is None


# --------------------------------------------------------------------------- #
# save_composition — magnetic/free split + Phase C 422 paths                    #
# --------------------------------------------------------------------------- #

def _profile():
    return type("Profile", (), {"profile_id": "profile-1"})()


def _pipeline_with_preview():
    return {
        "profile_id": "profile-1",
        "previews": {"0": {"preview_data": {"matches": [{"segment_id": "s1"}]}}},
    }


def _save(video_timeline):
    from app.api.pipeline_routes import SaveCompositionRequest, save_composition

    pipeline = _pipeline_with_preview()
    body = SaveCompositionRequest(video_timeline=video_timeline)
    with patch("app.api.pipeline_routes._get_pipeline_or_load", return_value=pipeline), \
         patch("app.api.pipeline_routes._db_save_pipeline"):
        asyncio.run(save_composition("pipeline-1", 0, body, _profile()))
    return pipeline["previews"]["0"]["preview_data"]


def _base_clip(**over):
    clip = {
        "id": "b1", "kind": "body", "segment_id": "s2", "source_video_id": "v2",
        "start_time": 2.0, "end_time": 4.0, "timeline_start": 0.0, "timeline_duration": 1.5,
    }
    clip.update(over)
    return clip


def _overlay_clip(**over):
    clip = _base_clip(track=2, timeline_start=3.0)
    clip["id"] = "ov1"
    clip.update(over)
    return clip


def test_free_clip_excluded_from_cursor_reflow_and_intro_offset():
    pd = _save([_base_clip(timeline_duration=2.0), _overlay_clip(timeline_start=5.0)])
    tl = pd["video_timeline"]
    base = [c for c in tl if int(c.get("track") or 1) <= 1]
    free = [c for c in tl if int(c.get("track") or 1) >= 2]
    assert len(base) == 1 and len(free) == 1
    assert base[0]["timeline_start"] == 0.0  # magnetic, reflowed by cursor
    assert free[0]["timeline_start"] == 5.0  # absolute, honored
    assert free[0]["track"] == 2
    assert free[0]["overlay_box"] == {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "fit": "contain"}
    # Free overlay never counts toward the intro offset.
    assert pd["intro_offset_sec"] == 0.0


def test_old_payload_without_track_unchanged():
    pd = _save([_base_clip(timeline_duration=1.0), _base_clip(id="b2", timeline_duration=2.0)])
    tl = pd["video_timeline"]
    assert all("track" not in c and "overlay_box" not in c for c in tl)
    assert [c["timeline_start"] for c in tl] == [0.0, 1.0]  # cursor reflow intact


def test_save_rejects_track_out_of_range():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _save([_base_clip(), _overlay_clip(track=5)])
    assert exc.value.status_code == 422


def test_save_rejects_overlap_same_track():
    from fastapi import HTTPException
    clips = [
        _base_clip(),
        _overlay_clip(id="ov1", track=2, timeline_start=1.0, timeline_duration=2.0),
        _overlay_clip(id="ov2", track=2, timeline_start=2.0, timeline_duration=2.0),  # overlaps
    ]
    with pytest.raises(HTTPException) as exc:
        _save(clips)
    assert exc.value.status_code == 422


def test_save_allows_overlap_on_different_tracks():
    pd = _save([
        _base_clip(),
        _overlay_clip(id="ov1", track=2, timeline_start=1.0, timeline_duration=2.0),
        _overlay_clip(id="ov2", track=3, timeline_start=1.0, timeline_duration=2.0),
    ])
    free = [c for c in pd["video_timeline"] if int(c.get("track") or 1) >= 2]
    assert len(free) == 2


def test_save_strips_transition_on_free_clip():
    pd = _save([_base_clip(), _overlay_clip(transitionIn={"kind": "dip_black", "durationMs": 300})])
    free = [c for c in pd["video_timeline"] if int(c.get("track") or 1) >= 2]
    assert "transitionIn" not in free[0]


def test_save_rejects_overlay_box_out_of_range():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _save([_base_clip(), _overlay_clip(overlay_box={"x": 1.5, "y": 0, "width": 0.5, "height": 0.5})])
    assert exc.value.status_code == 422


def test_save_rejects_more_than_50_free_clips():
    from fastapi import HTTPException
    clips = [_base_clip()]
    for i in range(51):
        clips.append(_overlay_clip(id=f"ov{i}", track=2, timeline_start=float(i * 2), timeline_duration=1.0))
    with pytest.raises(HTTPException) as exc:
        _save(clips)
    assert exc.value.status_code == 422


# --------------------------------------------------------------------------- #
# Real ffmpeg smoke                                                             #
# --------------------------------------------------------------------------- #

_no_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not on PATH",
)


@pytest.fixture
def base_video(tmp_path):
    path = tmp_path / "base.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=320x568:rate=30",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True, capture_output=True, timeout=60,
    )
    return path


@pytest.fixture
def red_clip(tmp_path):
    path = tmp_path / "red.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:size=320x568:duration=1:rate=30",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True, capture_output=True, timeout=60,
    )
    return path


@pytest.fixture
def red_image(tmp_path):
    path = tmp_path / "red.png"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:size=80x80",
         "-frames:v", "1", str(path)],
        check=True, capture_output=True, timeout=30,
    )
    return path


def _ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return float(out.stdout.strip())


def _frame_mean(path, t):
    """Mean grayscale value (0-255) of the frame nearest time t."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(path),
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, timeout=30,
    )
    data = out.stdout
    return sum(data) / len(data) if data else 0.0


@_no_ffmpeg
@pytest.mark.parametrize("preset", [
    "static", "fade", "pop", "zoom", "bounce", "slide", "slide-right",
    "slide-up", "slide-down", "wipe-left", "wipe-right", "spin", "tornado",
])
def test_attention_image_transition_filtergraph_runs_in_ffmpeg(base_video, red_image, preset):
    output = base_video.parent / f"attention_{preset}.mp4"
    rendered = asyncio.run(overlay_renderer.apply_overlay_timeline(
        base_video,
        [{
            "source_path": str(red_image), "is_video": False,
            "start": 1.0, "end": 2.2, "box_px": (80, 150, 160, 160),
            "fit": "contain", "z": 2,
            "animation": {
                "preset": preset, "enterMs": 250, "exitMs": 200, "intensity": 1,
            },
        }],
        output, 320, 568, 6.0,
    ))
    assert rendered == output
    assert output.exists()


@_no_ffmpeg
def test_overlay_duration_invariant_and_pixel_diff(base_video, red_clip):
    item = overlay_renderer  # noqa (alias not needed, keep import used)

    def render(start):
        # start=2 -> box shows in [2,3); start=100 -> never enabled (control).
        it = {
            "source_path": str(red_clip), "is_video": True,
            "start": float(start), "end": float(start) + 1.0,
            "box_px": (0, 0, 320, 568), "fit": "cover", "z": 2000,
        }
        out = base_video.parent / f"ov_{start}.mp4"
        return asyncio.run(overlay_renderer.apply_overlay_timeline(
            base_video, [it], out, 320, 568, 6.0,
        ))

    out_overlay = render(2)
    out_control = render(100)  # same re-encode path, overlay never shown
    assert Path(out_overlay).exists() and Path(out_control).exists()

    # Duration invariant: within one 30fps frame of the 6s base.
    d_base = _ffprobe_duration(base_video)
    d_over = _ffprobe_duration(out_overlay)
    assert abs(d_base - d_over) <= 0.034, f"{d_base} vs {d_over}"

    # Inside the window the full-frame red box changes the frame a lot; outside
    # it the overlay and control renders are identical (only re-encode, no box).
    diff_in = abs(_frame_mean(out_overlay, 2.5) - _frame_mean(out_control, 2.5))
    diff_out = abs(_frame_mean(out_overlay, 5.0) - _frame_mean(out_control, 5.0))
    assert diff_in > 15.0, f"overlay window diff too small: {diff_in}"
    assert diff_out < 2.0, f"outside-window diff too large: {diff_out}"


@_no_ffmpeg
def test_xfade_and_video_overlay_coexist(tmp_path, base_video):
    from app.services import segment_cache, ffmpeg_semaphore
    from app.services.assembly_service import AssemblyService

    class FakeSettings:
        base_dir = tmp_path
        segment_cache_enabled = False
        segment_cache_max_gb = 1.0

    with patch.object(segment_cache, "get_settings", lambda: FakeSettings()):
        ffmpeg_semaphore._ffmpeg_preview_prep_semaphore = None
        ffmpeg_semaphore._ffmpeg_prep_semaphore = None

        service = AssemblyService.__new__(AssemblyService)
        base = [
            TimelineEntry(source_video_path=str(base_video), start_time=0.0, end_time=1.0,
                          timeline_start=0.0, timeline_duration=1.0),
            TimelineEntry(source_video_path=str(base_video), start_time=1.0, end_time=2.0,
                          timeline_start=1.0, timeline_duration=1.0,
                          transition_in={"kind": "fade", "durationMs": 400}),
        ]
        overlay = [{
            "entry": TimelineEntry(source_video_path=str(base_video), start_time=3.0, end_time=4.0,
                                   timeline_start=0.5, timeline_duration=1.0),
            "box": {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
            "fit": "contain", "z": 2000,
        }]
        temp_dir = tmp_path / "asm"
        temp_dir.mkdir()
        out = asyncio.run(service.assemble_video(
            timeline=base, temp_dir=temp_dir, _preview_mode=True,
            video_overlay_clips=overlay,
        ))
    assert Path(out).exists()
    # xfade merged the two base clips AND the overlay pass ran (its output file).
    assert (temp_dir / "assembled_overlay.mp4").exists()
    assert abs(_ffprobe_duration(out) - 2.0) <= 0.1
