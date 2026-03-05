"""
TTS Cache Service - File-based caching for TTS audio and SRT subtitles.

Prevents redundant API calls by caching generated MP3 files, metadata,
and SRT content keyed by (text, voice_id, model_id, provider) hash.
"""
import hashlib
import json
import logging
import os
import shutil
import threading as _threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

MAX_CACHE_ENTRIES = 5000

# Lock to serialize eviction
_eviction_lock = _threading.Lock()

# In-memory hit/miss counters (reset on server restart)
_stats_lock = _threading.Lock()
_hit_count = 0
_miss_count = 0

# Pending set: keys currently being generated (prevents duplicate in-flight requests)
_pending_lock = _threading.Lock()
_pending_keys: set = set()

def _get_cache_root() -> Path:
    from app.config import get_settings
    return get_settings().base_dir / "cache" / "tts"


def _cache_key(key_data: dict) -> str:
    """Generate SHA-256 hash from key data dict."""
    raw = json.dumps(key_data, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


def is_generation_pending(key_data: dict) -> bool:
    """Check if a TTS generation is already in-flight for this key."""
    h = _cache_key(key_data)
    with _pending_lock:
        return h in _pending_keys


def mark_generation_pending(key_data: dict) -> bool:
    """Mark a key as in-flight. Returns False if already pending (caller should skip)."""
    h = _cache_key(key_data)
    with _pending_lock:
        if h in _pending_keys:
            return False
        _pending_keys.add(h)
        return True


def unmark_generation_pending(key_data: dict) -> None:
    """Remove a key from the pending set after generation completes or fails."""
    h = _cache_key(key_data)
    with _pending_lock:
        _pending_keys.discard(h)


def cache_lookup(key_data: dict, provider_dir: str, output_path: Path) -> Optional[dict]:
    """
    Look up cached TTS audio.

    Args:
        key_data: Dict with text, voice_id, model_id, provider
        provider_dir: Subdirectory name (elevenlabs, edge, legacy)
        output_path: Where to copy the cached MP3

    Returns:
        Metadata dict on cache hit, None on miss
    """
    h = _cache_key(key_data)
    cache_dir = _get_cache_root() / provider_dir
    mp3_path = cache_dir / f"{h}.mp3"
    meta_path = cache_dir / f"{h}.meta.json"

    global _hit_count, _miss_count

    if not mp3_path.exists() or not meta_path.exists():
        with _stats_lock:
            _miss_count += 1
        return None

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(mp3_path, output_path)

        # Update access time for LRU eviction tracking
        os.utime(mp3_path, None)

        with _stats_lock:
            _hit_count += 1

        logger.info(f"TTS cache HIT [{provider_dir}]: {h[:12]}... → {output_path.name}")
        return metadata
    except Exception as e:
        logger.warning(f"TTS cache read error: {e}")
        return None


def _evict_if_needed(cache_dir: Path) -> None:
    """Remove least-recently-accessed cache entries if cache exceeds max size."""
    with _eviction_lock:
        try:
            cache_files = sorted(cache_dir.glob("*.mp3"), key=lambda f: f.stat().st_atime)
            if len(cache_files) > MAX_CACHE_ENTRIES:
                for f in cache_files[:len(cache_files) - MAX_CACHE_ENTRIES]:
                    f.unlink(missing_ok=True)
                    meta = f.with_suffix('.meta.json')
                    meta.unlink(missing_ok=True)
                    srt = f.with_suffix('.srt')
                    srt.unlink(missing_ok=True)
        except Exception as e:
            logger.warning(f"Cache eviction error: {e}")


def cache_store(key_data: dict, provider_dir: str, audio_path: Path, metadata: dict) -> None:
    """
    Store TTS audio and metadata in cache.

    Args:
        key_data: Dict with text, voice_id, model_id, provider
        provider_dir: Subdirectory name
        audio_path: Path to the generated MP3
        metadata: Dict with duration, cost, timestamps, etc.
    """
    h = _cache_key(key_data)
    cache_dir = _get_cache_root() / provider_dir
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        shutil.copy2(audio_path, cache_dir / f"{h}.mp3")
        with open(cache_dir / f"{h}.meta.json", "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False)
        logger.info(f"TTS cache STORE [{provider_dir}]: {h[:12]}...")
        _evict_if_needed(cache_dir)
    except Exception as e:
        logger.warning(f"TTS cache write error: {e}")


def srt_cache_lookup(key_data: dict, provider_dir: str = "elevenlabs") -> Optional[str]:
    """
    Look up cached SRT content.

    Args:
        key_data: Dict with text, voice_id, model_id, provider
        provider_dir: Subdirectory name

    Returns:
        SRT string on hit, None on miss
    """
    h = _cache_key(key_data)
    srt_path = _get_cache_root() / provider_dir / f"{h}.srt"

    if not srt_path.exists():
        return None

    try:
        content = srt_path.read_text(encoding="utf-8")
        logger.info(f"SRT cache HIT [{provider_dir}]: {h[:12]}...")
        return content
    except Exception as e:
        logger.warning(f"SRT cache read error: {e}")
        return None


def cache_stats() -> dict:
    """Return TTS cache statistics including hit/miss counters and current size."""
    root = _get_cache_root()
    current_size = 0
    try:
        for provider_dir in root.iterdir():
            if provider_dir.is_dir():
                current_size += len(list(provider_dir.glob("*.mp3")))
    except Exception:
        pass

    with _stats_lock:
        return {
            "hit_count": _hit_count,
            "miss_count": _miss_count,
            "current_size": current_size,
            "max_size": MAX_CACHE_ENTRIES,
        }


def srt_cache_store(key_data: dict, srt_content: str, provider_dir: str = "elevenlabs") -> None:
    """
    Store SRT content in cache.

    Args:
        key_data: Dict with text, voice_id, model_id, provider
        srt_content: SRT-formatted string
        provider_dir: Subdirectory name
    """
    h = _cache_key(key_data)
    cache_dir = _get_cache_root() / provider_dir
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        (cache_dir / f"{h}.srt").write_text(srt_content, encoding="utf-8")
        logger.info(f"SRT cache STORE [{provider_dir}]: {h[:12]}...")
    except Exception as e:
        logger.warning(f"SRT cache write error: {e}")
