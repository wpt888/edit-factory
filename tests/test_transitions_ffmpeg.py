"""Transitions V1 acceptance tests against real FFmpeg.

1. Duration invariant: the same composition rendered with ~10 transitions vs
   none produces equal ffprobe durations (+/- one 30fps frame).
2. Fast path intact: the concat command still uses -c copy, and a
   zero-transition render contains no fade= filter anywhere.

Follows tests/test_segment_cache_integration.py conventions (skip without
ffmpeg, tiny lavfi source, preview mode for speed).
"""
import asyncio
import shutil
import subprocess

import pytest

from app.services import segment_cache
from app.services.assembly_service import AssemblyService, TimelineEntry

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe not on PATH",
)

TRANSITION = {"kind": "dip_black", "durationMs": 300}


@pytest.fixture
def cache_env(tmp_path, monkeypatch):
    class FakeSettings:
        base_dir = tmp_path
        segment_cache_enabled = False  # isolate: no cross-test cache reuse
        segment_cache_max_gb = 1.0

    monkeypatch.setattr(segment_cache, "get_settings", lambda: FakeSettings())
    return tmp_path


@pytest.fixture
def source_video(tmp_path):
    """Generate a 6s 320x568 test video."""
    path = tmp_path / "source.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=6:size=320x568:rate=30",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True, capture_output=True, timeout=60,
    )
    return path


def _timeline(source, n_clips, with_transitions):
    """n_clips 1s slots; every boundary carries a transition when requested."""
    entries = []
    for i in range(n_clips):
        start = (i * 0.5) % 5.0  # overlapping source windows, all within 6s
        entries.append(TimelineEntry(
            source_video_path=str(source),
            start_time=start, end_time=start + 1.0,
            timeline_start=float(i), timeline_duration=1.0,
            transition_in=dict(TRANSITION) if (with_transitions and i > 0) else None,
        ))
    return entries


def _ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True, timeout=30,
    )
    return float(out.stdout.strip())


def _render(service, tmp_path, run_name, timeline, spy_cmds):
    from unittest.mock import patch
    from app.services import assembly_service as asm
    from app.services import ffmpeg_semaphore

    # Each render runs in its own asyncio.run loop; the module-global semaphores
    # bind to the first loop under contention, so reset them per render.
    ffmpeg_semaphore._ffmpeg_preview_prep_semaphore = None
    ffmpeg_semaphore._ffmpeg_prep_semaphore = None

    real_run = asm.safe_ffmpeg_run

    def spy(cmd, timeout=None, operation=None):
        spy_cmds.append(list(cmd))
        return real_run(cmd, timeout, operation)

    temp_dir = tmp_path / run_name
    temp_dir.mkdir()
    with patch.object(asm, "safe_ffmpeg_run", side_effect=spy):
        return asyncio.run(service.assemble_video(
            timeline=timeline, temp_dir=temp_dir, _preview_mode=True,
        ))


def test_duration_invariant_and_fast_path(cache_env, source_video, tmp_path):
    service = AssemblyService.__new__(AssemblyService)  # Skip __init__ (needs full settings)
    n = 11  # 10 transition boundaries

    plain_cmds, faded_cmds = [], []
    out_plain = _render(service, tmp_path, "plain",
                        _timeline(source_video, n, with_transitions=False), plain_cmds)
    out_faded = _render(service, tmp_path, "faded",
                        _timeline(source_video, n, with_transitions=True), faded_cmds)
    assert out_plain.exists() and out_faded.exists()

    # 1. Duration invariant: no-overlap fades change no timing (+/- 1 frame @30fps).
    d_plain = _ffprobe_duration(out_plain)
    d_faded = _ffprobe_duration(out_faded)
    assert abs(d_plain - d_faded) <= 0.034, f"{d_plain} vs {d_faded}"
    assert abs(d_plain - n) <= 0.1  # sanity: ~11s output

    # 2. Fast path: concat uses -c copy in BOTH renders.
    def concat_cmds(cmds):
        return [c for c in cmds if "-f" in c and "concat" in c]

    for cmds in (plain_cmds, faded_cmds):
        (concat,) = concat_cmds(cmds)
        assert concat[concat.index("-c") + 1] == "copy"

    # 3. Zero-transition render: no fade filter anywhere in any command.
    assert not any("fade=" in arg for cmd in plain_cmds for arg in cmd)

    # 4. Transition render: every non-edge segment gets both fades, built only
    #    from the enum color + clamped-int-derived seconds.
    vf_args = [cmd[cmd.index("-vf") + 1] for cmd in faded_cmds if "-vf" in cmd]
    assert len(vf_args) == n
    faded_vfs = [vf for vf in vf_args if "fade=" in vf]
    assert len(faded_vfs) == n  # first has fade-out, last has fade-in, middle both
    assert sum("fade=t=in:st=0:d=0.150:color=black" in vf for vf in vf_args) == n - 1
    assert sum("fade=t=out:st=0.850:d=0.150:color=black" in vf for vf in vf_args) == n - 1
