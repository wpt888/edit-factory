"""Tests for the per-segment extraction cache (F2)."""
import os
import time
from pathlib import Path

import pytest

from app.services import segment_cache


@pytest.fixture
def cache_env(tmp_path, monkeypatch):
    """Point the cache at a temp dir with a tiny eviction cap."""
    class FakeSettings:
        base_dir = tmp_path
        segment_cache_enabled = True
        segment_cache_max_gb = 0.000001  # ~1 KB cap to exercise eviction

    monkeypatch.setattr(segment_cache, "get_settings", lambda: FakeSettings())
    return tmp_path


def _make_source(tmp_path: Path, name: str = "source.mp4", content: bytes = b"x" * 100) -> Path:
    src = tmp_path / name
    src.write_bytes(content)
    return src


def test_make_key_stable_and_sensitive(cache_env, tmp_path):
    src = _make_source(tmp_path)
    base = dict(
        source_video_path=str(src), start_time=1.0, end_time=3.0,
        needed_duration=2.0, use_loop=False,
        transform_filters=["scale=540:960"], codec_params=["-c:v", "libx264"],
        fps=30,
    )
    k1 = segment_cache.make_key(**base)
    k2 = segment_cache.make_key(**base)
    assert k1 == k2

    # Any parameter change yields a different key
    assert segment_cache.make_key(**{**base, "start_time": 1.5}) != k1
    assert segment_cache.make_key(**{**base, "codec_params": ["-c:v", "h264_nvenc"]}) != k1

    # Re-writing the source (new mtime/size) invalidates the key
    time.sleep(0.01)
    src.write_bytes(b"y" * 200)
    assert segment_cache.make_key(**base) != k1


def test_make_key_missing_source_returns_none(cache_env, tmp_path):
    assert segment_cache.make_key(
        source_video_path=str(tmp_path / "missing.mp4"), start_time=0, end_time=1,
        needed_duration=1, use_loop=False, transform_filters=[], codec_params=[], fps=30,
    ) is None


def test_store_then_lookup_roundtrip(cache_env, tmp_path):
    src = _make_source(tmp_path)
    key = segment_cache.make_key(
        source_video_path=str(src), start_time=0, end_time=1,
        needed_duration=1, use_loop=False, transform_filters=[], codec_params=[], fps=30,
    )
    extracted = tmp_path / "segment_000.mp4"
    extracted.write_bytes(b"FAKE_MP4_DATA")

    dest = tmp_path / "segment_dest.mp4"
    assert segment_cache.lookup(key, dest) is False  # Cold cache

    segment_cache.store(key, extracted)
    assert segment_cache.lookup(key, dest) is True
    assert dest.read_bytes() == b"FAKE_MP4_DATA"


def test_lookup_ignores_empty_cached_file(cache_env, tmp_path):
    src = _make_source(tmp_path)
    key = segment_cache.make_key(
        source_video_path=str(src), start_time=0, end_time=1,
        needed_duration=1, use_loop=False, transform_filters=[], codec_params=[], fps=30,
    )
    cached = tmp_path / "cache" / "segments" / f"{key}.mp4"
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(b"")
    assert segment_cache.lookup(key, tmp_path / "out.mp4") is False


def test_eviction_removes_oldest_first(cache_env, tmp_path):
    cache_dir = tmp_path / "cache" / "segments"
    cache_dir.mkdir(parents=True, exist_ok=True)

    old = cache_dir / ("a" * 64 + ".mp4")
    new = cache_dir / ("b" * 64 + ".mp4")
    old.write_bytes(b"o" * 600)
    new.write_bytes(b"n" * 600)
    past = time.time() - 3600
    os.utime(old, (past, past))

    # Cap is ~1 KB; storing another 600B entry forces eviction of `old`
    extracted = tmp_path / "segment_001.mp4"
    extracted.write_bytes(b"z" * 600)
    src = _make_source(tmp_path, "src2.mp4")
    key = segment_cache.make_key(
        source_video_path=str(src), start_time=0, end_time=1,
        needed_duration=1, use_loop=False, transform_filters=[], codec_params=[], fps=30,
    )
    segment_cache.store(key, extracted)

    assert not old.exists(), "Oldest entry should be evicted"


def test_disabled_cache_is_noop(cache_env, tmp_path, monkeypatch):
    class DisabledSettings:
        base_dir = tmp_path
        segment_cache_enabled = False
        segment_cache_max_gb = 5.0

    monkeypatch.setattr(segment_cache, "get_settings", lambda: DisabledSettings())
    src = _make_source(tmp_path, "src3.mp4")
    key = segment_cache.make_key(
        source_video_path=str(src), start_time=0, end_time=1,
        needed_duration=1, use_loop=False, transform_filters=[], codec_params=[], fps=30,
    )
    extracted = tmp_path / "segment_002.mp4"
    extracted.write_bytes(b"DATA")
    segment_cache.store(key, extracted)
    assert segment_cache.lookup(key, tmp_path / "out2.mp4") is False
