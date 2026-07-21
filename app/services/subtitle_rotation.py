"""Subtitle-template rotation helpers shared by preview and render paths."""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence

from app.services.tts_subtitle_generator import generate_srt_from_timestamps


# Must match frontend/src/app/pipeline/subtitle-template-rotation.ts. This value
# is persisted in portable pipeline templates and is never a profile preset ID.
NO_SUBTITLES_PRESET_ID = "__none__"


def assigned_preset_id(variant_index: int, preset_ids: Sequence[str]) -> Optional[str]:
    """Return the ordered round-robin preset for a zero-based script variant."""
    ordered = [str(value).strip() for value in preset_ids if str(value).strip()]
    if variant_index < 0 or not ordered:
        return None
    return ordered[variant_index % len(ordered)]


def words_per_subtitle_for_key(
    preview_key: str,
    words_by_key: Optional[Mapping[str, Any]],
    fallback: int = 2,
) -> int:
    """Resolve a per-preview word count, with a base-variant and global fallback."""
    safe_fallback = max(1, min(20, int(fallback or 2)))
    if not isinstance(words_by_key, Mapping):
        return safe_fallback

    key = str(preview_key)
    base_key = key.split("_", 1)[0]
    for candidate in (key, base_key):
        try:
            value = int(words_by_key.get(candidate))
        except (TypeError, ValueError):
            continue
        if 1 <= value <= 20:
            return value
    return safe_fallback


def regroup_srt_for_variant(
    timestamps: Optional[dict],
    *,
    preview_key: str,
    words_by_key: Optional[Mapping[str, Any]],
    fallback: int = 2,
    karaoke: bool = False,
) -> str:
    """Build cues for one variant directly from persisted character timings."""
    return generate_srt_from_timestamps(
        timestamps,
        max_words_per_phrase=words_per_subtitle_for_key(
            preview_key,
            words_by_key,
            fallback,
        ),
        karaoke=karaoke,
    )
