import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services import assembly_service as assembly_module
from app.services.assembly_service import AssemblyService
from app.services.subtitle_rotation import (
    NO_SUBTITLES_PRESET_ID,
    assigned_preset_id,
    regroup_srt_for_variant,
    words_per_subtitle_for_key,
)


def _timestamps(text: str) -> dict:
    characters = list(text)
    return {
        "characters": characters,
        "character_start_times_seconds": [index * 0.05 for index in range(len(characters))],
        "character_end_times_seconds": [(index + 1) * 0.05 for index in range(len(characters))],
    }


def _cue_texts(srt: str) -> list[str]:
    return [
        block.splitlines()[2]
        for block in srt.strip().split("\n\n")
        if len(block.splitlines()) >= 3
    ]


def test_rotation_assignment_is_ordered_round_robin_and_ignores_leftovers():
    preset_ids = ["one", "two", "three", "four"]
    assert [assigned_preset_id(index, preset_ids) for index in range(10)] == [
        "one", "two", "three", "four", "one", "two", "three", "four", "one", "two",
    ]
    assert [assigned_preset_id(index, preset_ids) for index in range(2)] == ["one", "two"]
    assert assigned_preset_id(0, []) is None


def test_rotation_assignment_preserves_none_slot_as_a_portable_sentinel():
    preset_ids = ["one", "two", NO_SUBTITLES_PRESET_ID]
    assert [assigned_preset_id(index, preset_ids) for index in range(3)] == preset_ids


def test_per_variant_words_regroup_uses_preview_key_then_base_variant():
    timings = _timestamps("one two three four five six")
    mapping = {"0_A": 2, "1": 3}

    first = regroup_srt_for_variant(
        timings,
        preview_key="0_A",
        words_by_key=mapping,
        fallback=4,
    )
    second = regroup_srt_for_variant(
        timings,
        preview_key="1_B",
        words_by_key=mapping,
        fallback=4,
    )

    assert _cue_texts(first) == ["one two", "three four", "five six"]
    assert _cue_texts(second) == ["one two three", "four five six"]
    assert words_per_subtitle_for_key("2_A", mapping, 4) == 4


def test_preview_regroups_persisted_timings_without_calling_tts(tmp_path, monkeypatch):
    audio_path = tmp_path / "voice.mp3"
    audio_path.write_bytes(b"persisted voice")
    source_path = tmp_path / "source.mp4"
    source_path.write_bytes(b"source placeholder")

    class Repo:
        def list_segments(self, _profile_id, filters):
            assert filters.in_["source_video_id"] == ["source-1"]
            return SimpleNamespace(data=[{
                "id": "segment-1",
                "source_video_id": "source-1",
                "start_time": 0.0,
                "end_time": 8.0,
                "keywords": ["one", "two", "three", "four", "five", "six"],
                "transforms": None,
                "thumbnail_path": None,
                "product_group": None,
                "editai_source_videos": {"file_path": str(source_path)},
            }])

    monkeypatch.setattr(assembly_module, "get_repository", lambda: Repo())
    monkeypatch.setattr("app.services.tts_cache.srt_cache_lookup", lambda _key: None)
    monkeypatch.setattr("app.services.tts_cache.srt_cache_store", lambda *_args, **_kwargs: None)

    service = AssemblyService()
    service.generate_tts_with_timestamps = AsyncMock(
        side_effect=AssertionError("persisted timings must avoid a provider call"),
    )
    result = asyncio.run(
        service.preview_matches(
            script_text="one two three four five six",
            profile_id="profile-1",
            source_video_ids=["source-1"],
            reuse_audio_path=str(audio_path),
            reuse_audio_duration=3.0,
            reuse_timestamps=_timestamps("one two three four five six"),
            max_words_per_phrase=2,
            min_segment_duration=1.0,
            ultra_rapid_intro=False,
        )
    )

    service.generate_tts_with_timestamps.assert_not_awaited()
    assert _cue_texts(result["srt_content"]) == ["one two", "three four", "five six"]
