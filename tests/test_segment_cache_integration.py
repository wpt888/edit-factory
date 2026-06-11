"""Integration test: assemble_video() reuses cached segment extractions (F2).

Acceptance (MVP-DESKTOP-PLAN F2): after a first render, an identical re-render
takes every segment from the cache; changing one segment only re-extracts that
segment. Uses a real FFmpeg-generated source video.
"""
import asyncio
import shutil
import subprocess

import pytest

from app.services import segment_cache
from app.services.assembly_service import AssemblyService, TimelineEntry

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg not on PATH"
)


@pytest.fixture
def cache_env(tmp_path, monkeypatch):
    class FakeSettings:
        base_dir = tmp_path
        segment_cache_enabled = True
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


def _timeline(source, specs):
    """specs: list of (start, end) tuples within the source."""
    pos = 0.0
    entries = []
    for start, end in specs:
        dur = end - start
        entries.append(TimelineEntry(
            source_video_path=str(source),
            start_time=start, end_time=end,
            timeline_start=pos, timeline_duration=dur,
        ))
        pos += dur
    return entries


def test_rerender_hits_cache_and_edit_misses_one(cache_env, source_video, tmp_path, caplog):
    service = AssemblyService.__new__(AssemblyService)  # Skip __init__ (needs full settings)

    specs = [(0.0, 1.5), (1.5, 3.0), (3.0, 4.5)]

    async def render(run_name, specs):
        temp_dir = tmp_path / run_name
        temp_dir.mkdir()
        return await service.assemble_video(
            timeline=_timeline(source_video, specs),
            temp_dir=temp_dir,
            _preview_mode=True,
        )

    import logging
    caplog.set_level(logging.INFO, logger="app.services.assembly_service")

    # Run 1: cold cache — all misses
    out1 = asyncio.run(render("run1", specs))
    assert out1.exists() and out1.stat().st_size > 0
    assert "Segment cache: 0 hits, 3 misses" in caplog.text

    # Run 2: identical timeline — all hits, no extraction
    caplog.clear()
    out2 = asyncio.run(render("run2", specs))
    assert out2.exists() and out2.stat().st_size > 0
    assert "Segment cache: 3 hits, 0 misses" in caplog.text

    # Run 3: one segment swapped — exactly one miss
    caplog.clear()
    edited = [(0.0, 1.5), (4.5, 6.0), (3.0, 4.5)]
    out3 = asyncio.run(render("run3", edited))
    assert out3.exists() and out3.stat().st_size > 0
    assert "Segment cache: 2 hits, 1 misses" in caplog.text
