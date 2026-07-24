import asyncio

import pytest
from fastapi import HTTPException

from app.api.auth import AuthUser, ProfileContext
from app.services.studio_metering import StudioMeteringBlocked


def _pipeline(audio: dict | None = None) -> dict:
    script_id = "script_11111111"
    if audio is not None:
        audio = {
            **audio,
            "script_id": script_id,
            "output_id": f"{script_id}:default",
        }
    return {
        "pipeline_id": "pipeline-preview-metering",
        "profile_id": "profile-1",
        "scripts": ["A short metered preview script"],
        "script_ids": [script_id],
        "previews": {},
        "segment_usage": {},
        "tts_previews": ({0: audio} if audio is not None else {}),
        "tts_jobs": {},
    }


def _preview_payload(audio_path: str | None = None) -> dict:
    return {
        "audio_path": audio_path,
        "audio_duration": 3.5,
        "srt_content": "1\n00:00:00,000 --> 00:00:03,500\nhello\n",
        "matches": [],
        "total_phrases": 1,
        "matched_count": 0,
        "unmatched_count": 1,
        "available_segments": [],
    }


async def _call_preview(pipeline_routes, *, force: bool = False):
    return await pipeline_routes.preview_variant(
        pipeline_id="pipeline-preview-metering",
        variant_index=0,
        profile=ProfileContext(profile_id="profile-1", user_id="user-1"),
        elevenlabs_model="eleven_flash_v2_5",
        voice_id="voice-1",
        source_video_ids=None,
        voice_settings={},
        words_per_subtitle=2,
        min_segment_duration=3.0,
        ultra_rapid_intro=True,
        preset="balanced",
        segment_proximity="separate",
        visual_version=None,
        script_id="script_11111111",
        output_id="script_11111111:default",
        force_regenerate_tts=force,
        editor_matches=None,
        editor_composition=None,
        editor_default_transition=None,
        editor_music=None,
        editor_default_transition_set=False,
        editor_music_set=False,
        current_user=AuthUser("user-1", "person@example.com"),
    )


def _wire_preview(monkeypatch, pipeline_routes, pipeline, assembly):
    class Repo:
        def get_pipeline(self, pipeline_id):
            return pipeline if pipeline_id == pipeline["pipeline_id"] else None

        def get_profile(self, _profile_id):
            return {
                "tts_settings": {
                    "elevenlabs": {
                        "voice_id": "voice-1",
                    },
                },
            }

    monkeypatch.setattr(
        pipeline_routes,
        "_get_pipeline_or_load",
        lambda pipeline_id: pipeline if pipeline_id == pipeline["pipeline_id"] else None,
    )
    monkeypatch.setattr(pipeline_routes, "_db_update_async_jobs", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pipeline_routes, "_db_save_pipeline", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(pipeline_routes, "_get_data_repository", lambda: None)
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: Repo())
    monkeypatch.setattr(pipeline_routes, "get_assembly_service", lambda: assembly)


def test_preview_rejects_an_authoritative_active_voice_regeneration(
    monkeypatch,
) -> None:
    from app.api import pipeline_routes

    pipeline = _pipeline()
    pipeline["tts_jobs"] = {
        0: {
            "status": "processing",
            "attempt_id": "active-voice-attempt",
            "script_id": "script_11111111",
            "output_id": "script_11111111:default",
        }
    }

    class AssemblyMustNotRun:
        async def preview_matches(self, **_kwargs):
            raise AssertionError("preview started during voice regeneration")

    _wire_preview(monkeypatch, pipeline_routes, pipeline, AssemblyMustNotRun())

    with pytest.raises(HTTPException) as caught:
        asyncio.run(_call_preview(pipeline_routes))

    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "voice_regeneration_active"


def test_preview_tts_denial_is_402_before_provider_or_forced_cache_mutation(
    monkeypatch, tmp_path
):
    from app.api import pipeline_routes

    old_audio = tmp_path / "old.mp3"
    old_audio.write_bytes(b"o" * 256)
    previous = {
        "audio_path": str(old_audio),
        "audio_duration": 2.0,
        "script_hash": pipeline_routes._stable_hash("A short metered preview script"),
    }
    pipeline = _pipeline(previous.copy())

    class AssemblyMustNotRun:
        async def preview_matches(self, **_kwargs):
            raise AssertionError("provider-backed preview started after credit denial")

    _wire_preview(monkeypatch, pipeline_routes, pipeline, AssemblyMustNotRun())

    async def deny(_identity, _record):
        raise StudioMeteringBlocked("insufficient_credits", "denied", available_credits=0)

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", deny)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(_call_preview(pipeline_routes, force=True))

    assert caught.value.status_code == 402
    assert pipeline["tts_previews"][0]["audio_path"] == previous["audio_path"]
    assert pipeline["tts_previews"][0]["script_hash"] == previous["script_hash"]
    job = pipeline["tts_jobs"][0]
    assert job["status"] == "failed"
    assert job["metering"]["state"] == "denied"
    assert job["metering"]["provider_started"] is False


def test_preview_fresh_tts_reserves_then_captures_after_pipeline_persistence(
    monkeypatch, tmp_path
):
    from app.api import pipeline_routes

    fresh_audio = tmp_path / "fresh.mp3"
    fresh_audio.write_bytes(b"f" * 256)
    pipeline = _pipeline()
    events: list[str] = []

    class Assembly:
        async def preview_matches(self, **kwargs):
            job = pipeline["tts_jobs"][0]
            assert job["metering"]["provider_started"] is True
            assert kwargs["reuse_audio_path"] is None
            events.append("provider")
            return _preview_payload(str(fresh_audio))

    _wire_preview(monkeypatch, pipeline_routes, pipeline, Assembly())

    async def reserve(_identity, record):
        events.append("reserve")
        return {
            **record,
            "reservation_id": "reservation-preview-1",
            "state": "reserved",
            "mode": "web",
        }

    async def settle(_identity, record, *, delivered, result_metadata=None, client=None):
        assert events[-1] == "persist"
        events.append(f"settle:{delivered}")
        return {
            **record,
            "state": "captured" if delivered else "released",
            "result_metadata": dict(result_metadata or {}),
        }

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve)
    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)
    monkeypatch.setattr(
        pipeline_routes,
        "_persist_tts_audio",
        lambda **_kwargs: (str(fresh_audio), "asset-preview-1"),
    )

    def persist_pipeline(*_args, **_kwargs):
        record = pipeline["tts_jobs"][0]["metering"]
        assert record["output_persisted"] is True
        assert record["state"] == "output_persisted"
        events.append("persist")

    monkeypatch.setattr(
        pipeline_routes,
        "_db_save_pipeline",
        persist_pipeline,
    )

    response = asyncio.run(_call_preview(pipeline_routes))

    assert response.audio_duration == 3.5
    assert events == ["reserve", "provider", "persist", "settle:True"]
    job = pipeline["tts_jobs"][0]
    assert job["status"] == "completed"
    assert job["metering"]["state"] == "captured"
    assert job["metering"]["output_persisted"] is True
    assert job["metering"]["supabase_user_id"] == "user-1"
    assert job["metering"]["email"] == "person@example.com"
    assert pipeline["tts_previews"][0]["audio_path"] == str(fresh_audio)
    assert pipeline["tts_previews"][0]["script_hash"] == pipeline_routes._stable_hash(
        pipeline["scripts"][0]
    )


def test_preview_tts_provider_failure_refunds_and_restores_forced_audio(
    monkeypatch, tmp_path
):
    from app.api import pipeline_routes

    old_audio = tmp_path / "old.mp3"
    old_audio.write_bytes(b"o" * 256)
    previous = {
        "audio_path": str(old_audio),
        "audio_duration": 2.0,
        "script_hash": pipeline_routes._stable_hash("A short metered preview script"),
    }
    pipeline = _pipeline(previous.copy())
    settlements: list[bool] = []

    class FailingAssembly:
        async def preview_matches(self, **_kwargs):
            raise RuntimeError("provider failed")

    _wire_preview(monkeypatch, pipeline_routes, pipeline, FailingAssembly())

    async def reserve(_identity, record):
        return {
            **record,
            "reservation_id": "reservation-preview-2",
            "state": "reserved",
            "mode": "web",
        }

    async def settle(_identity, record, *, delivered, result_metadata=None, client=None):
        settlements.append(delivered)
        return {**record, "state": "captured" if delivered else "released"}

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve)
    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)
    monkeypatch.setattr(
        "app.services.tts_cache.cache_delete",
        lambda *_args, **_kwargs: False,
    )

    with pytest.raises(HTTPException) as caught:
        asyncio.run(_call_preview(pipeline_routes, force=True))

    assert caught.value.status_code == 503
    assert settlements == [False]
    assert pipeline["tts_jobs"][0]["status"] == "failed"
    assert pipeline["tts_jobs"][0]["metering"]["state"] == "released"
    assert pipeline["tts_previews"][0]["audio_path"] == previous["audio_path"]
    assert pipeline["tts_previews"][0]["script_hash"] == previous["script_hash"]


def test_preview_reuses_persisted_tts_without_new_reservation(monkeypatch, tmp_path):
    from app.api import pipeline_routes

    audio = tmp_path / "existing.mp3"
    audio.write_bytes(b"e" * 256)
    pipeline = _pipeline(
        {
            "audio_path": str(audio),
            "audio_duration": 2.0,
            "script_hash": pipeline_routes._stable_hash("A short metered preview script"),
            "srt_content": "existing srt",
            "words_per_subtitle": 2,
            "elevenlabs_model": "eleven_flash_v2_5",
            "voice_id": "voice-1",
            "voice_settings": {
                "stability": 0.57,
                "similarity_boost": 0.75,
                "style": 0.22,
                "use_speaker_boost": True,
                "speed": 1.0,
            },
            "asset_provenance": "generated",
            "audio_sha256": pipeline_routes._file_sha256(audio),
        }
    )

    class ReusingAssembly:
        async def preview_matches(self, **kwargs):
            assert kwargs["reuse_audio_path"] == str(audio)
            return _preview_payload()

    _wire_preview(monkeypatch, pipeline_routes, pipeline, ReusingAssembly())

    async def reserve_must_not_run(*_args, **_kwargs):
        raise AssertionError("reused TTS was billed again")

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve_must_not_run)

    response = asyncio.run(_call_preview(pipeline_routes))

    assert response.audio_duration == 3.5
    assert pipeline["tts_jobs"] == {}
    assert pipeline["tts_previews"][0]["audio_path"] == str(audio)
