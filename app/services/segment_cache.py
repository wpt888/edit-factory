"""
Per-segment extraction cache (MVP desktop F2).

assemble_video() re-extracts every timeline segment with FFmpeg on every
render, even when only one segment changed. This cache stores the extracted
``segment_NNN.mp4`` files content-addressed by everything that influences the
output bytes, so an iterative edit only re-extracts the segments it touched.

Key properties:
- Content-addressed: SHA256 over source identity (path + mtime + size),
  cut interval, needed duration / looping, transform filter chain, codec
  params and fps. Any change produces a different key.
- Shared across profiles/pipelines: the same segment extracted with the same
  parameters is the same file regardless of who asked.
- LRU eviction by file mtime, capped at ``settings.segment_cache_max_gb``
  (default 5 GB). Lookups touch the file's mtime to keep hot entries alive.
- Crash-safe writes: copy to a ``.tmp`` sibling then ``os.replace``.

The cache is best-effort: every failure degrades to a normal extraction.
"""
import hashlib
import json
import logging
import os
import shutil
import threading
from pathlib import Path
from typing import Optional

from app.config import get_settings

logger = logging.getLogger(__name__)

# Bump when the extraction command shape changes in a way the key ingredients
# don't capture (e.g. pix_fmt, -video_track_timescale, keyframe flags).
_CACHE_VERSION = "v1"

# Eviction runs at most once per store burst; guarded by a lock because
# stores happen from multiple asyncio.to_thread workers.
_evict_lock = threading.Lock()


def _cache_dir() -> Path:
    d = get_settings().base_dir / "cache" / "segments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _max_bytes() -> int:
    settings = get_settings()
    max_gb = getattr(settings, "segment_cache_max_gb", 5.0)
    return int(max_gb * 1024 ** 3)


def is_enabled() -> bool:
    return bool(getattr(get_settings(), "segment_cache_enabled", True))


def make_key(
    source_video_path: str,
    start_time: float,
    end_time: float,
    needed_duration: float,
    use_loop: bool,
    transform_filters: list,
    codec_params: list,
    fps: float,
    fade: Optional[dict] = None,
) -> Optional[str]:
    """Build the cache key, or None if the source can't be stat'ed.

    ``fade`` carries the resolved transition ingredients for this slot (P0). It is
    added to the payload ONLY when present, so segments with no adjacent
    transition keep byte-identical keys to legacy renders — cache invalidation is
    then limited to the segments bordering an edited transition boundary.
    """
    try:
        st = os.stat(source_video_path)
    except OSError:
        return None
    payload = {
        "v": _CACHE_VERSION,
        "src": str(source_video_path),
        "src_mtime": st.st_mtime,
        "src_size": st.st_size,
        "start": round(start_time, 4),
        "end": round(end_time, 4),
        "needed": round(needed_duration, 4),
        "loop": use_loop,
        "vf": list(transform_filters),
        "codec": list(codec_params),
        "fps": fps,
    }
    if fade:
        payload["fade"] = fade
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()
    ).hexdigest()


def lookup(key: str, dest: Path) -> bool:
    """Copy a cached segment to *dest* if present. Returns True on hit."""
    if not key or not is_enabled():
        return False
    cached = _cache_dir() / f"{key}.mp4"
    try:
        if not cached.exists() or cached.stat().st_size == 0:
            return False
        shutil.copy2(cached, dest)
        # Touch mtime so LRU eviction sees this entry as recently used.
        os.utime(cached, None)
        return True
    except OSError as e:
        logger.warning(f"Segment cache lookup failed for {key[:12]}: {e}")
        return False


def store(key: str, segment_file: Path) -> None:
    """Copy an extracted segment into the cache (atomic), then evict LRU."""
    if not key or not is_enabled():
        return
    try:
        if not segment_file.exists() or segment_file.stat().st_size == 0:
            return
        cached = _cache_dir() / f"{key}.mp4"
        if cached.exists():
            return  # Another extraction already stored it
        tmp = cached.with_suffix(".tmp")
        shutil.copy2(segment_file, tmp)
        os.replace(tmp, cached)
    except OSError as e:
        logger.warning(f"Segment cache store failed for {key[:12]}: {e}")
        return
    _evict_if_needed()


def _evict_if_needed() -> None:
    """Delete least-recently-used entries until total size fits the cap."""
    if not _evict_lock.acquire(blocking=False):
        return  # Another thread is already evicting
    try:
        cache_dir = _cache_dir()
        entries = []
        total = 0
        for f in cache_dir.glob("*.mp4"):
            try:
                st = f.stat()
            except OSError:
                continue
            entries.append((st.st_mtime, st.st_size, f))
            total += st.st_size
        limit = _max_bytes()
        if total <= limit:
            return
        entries.sort()  # Oldest mtime first
        freed = 0
        for _mtime, size, f in entries:
            if total - freed <= limit:
                break
            try:
                f.unlink()
                freed += size
            except OSError:
                pass
        if freed:
            logger.info(
                f"Segment cache evicted {freed / 1024 ** 2:.0f} MB "
                f"(was {total / 1024 ** 2:.0f} MB, cap {limit / 1024 ** 2:.0f} MB)"
            )
    finally:
        _evict_lock.release()
