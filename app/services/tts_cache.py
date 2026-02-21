"""
TTS Cache Service - File-based caching for TTS audio and SRT subtitles.

Prevents redundant API calls by caching generated MP3 files, metadata,
and SRT content keyed by (text, voice_id, model_id, provider) hash.
"""
import hashlib
import json
import logging
import shutil
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

def _get_cache_root() -> Path:
    return Path(__file__).parent.parent.parent / "cache" / "tts"


def _cache_key(key_data: dict) -> str:
    """Generate SHA-256 hash from key data dict."""
    raw = json.dumps(key_data, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


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

    if not mp3_path.exists() or not meta_path.exists():
        return None

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(mp3_path, output_path)

        logger.info(f"TTS cache HIT [{provider_dir}]: {h[:12]}... → {output_path.name}")
        return metadata
    except Exception as e:
        logger.warning(f"TTS cache read error: {e}")
        return None


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
