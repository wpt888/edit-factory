"""Tenant isolation and fair-use accounting for the shared ElevenLabs pool."""

from __future__ import annotations

import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.elevenlabs_governance import (
    ElevenLabsCreditExceeded,
    assign_voice,
    filter_voices,
    get_credit_balance,
    release_credits,
    reserve_credits,
    set_credit_limit,
    settle_credits,
)
from app.services.tts.base import TTSVoice


def _voice(voice_id: str, category: str) -> TTSVoice:
    return TTSVoice(
        id=voice_id,
        name=voice_id,
        language="ro",
        gender=None,
        provider="elevenlabs",
        category=category,
    )


def test_custom_voices_are_filtered_per_profile(sqlite_backend):
    _client, _repo, profile_id = sqlite_backend
    voices = [
        _voice("public", "premade"),
        _voice("private", "cloned"),
        _voice("unknown", "unknown"),
    ]

    assert [v.id for v in filter_voices(profile_id, voices)] == ["public"]

    assign_voice(
        profile_id,
        "private",
        voice_name="Private voice",
        category="cloned",
        assigned_by="test",
    )
    assert [v.id for v in filter_voices(profile_id, voices)] == ["public", "private"]


def test_credit_reserve_settle_release_and_hard_limit(sqlite_backend):
    _client, _repo, profile_id = sqlite_backend
    set_credit_limit(profile_id, 100)

    first = reserve_credits(profile_id, "x" * 100, "eleven_flash_v2_5", "voice-1")
    assert first is not None
    assert first.estimated_credits == 50
    reserved = get_credit_balance(profile_id)
    assert reserved["credits_reserved"] == 50
    assert reserved["credits_remaining"] == 50

    settled = settle_credits(first, 48, "provider-request-1")
    assert settled["credits_used"] == 48
    assert settled["credits_reserved"] == 0
    assert settled["credits_remaining"] == 52

    second = reserve_credits(profile_id, "abcd", "eleven_multilingual_v2", "voice-1")
    assert second is not None
    assert get_credit_balance(profile_id)["credits_reserved"] == 4
    release_credits(second)
    assert get_credit_balance(profile_id)["credits_reserved"] == 0

    with pytest.raises(ElevenLabsCreditExceeded) as exc_info:
        reserve_credits(profile_id, "x" * 105, "eleven_flash_v2_5", "voice-1")
    assert exc_info.value.status_code == 402
    assert exc_info.value.as_detail()["credits_remaining"] == 52


def test_parallel_reservations_cannot_overspend_profile_limit(sqlite_backend):
    _client, _repo, profile_id = sqlite_backend
    set_credit_limit(profile_id, 100)

    def attempt_reservation():
        try:
            return reserve_credits(
                profile_id,
                "x" * 60,
                "eleven_multilingual_v2",
                "voice-1",
            )
        except ElevenLabsCreditExceeded:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _index: attempt_reservation(), range(2)))

    assert sum(result is not None for result in results) == 1
    balance = get_credit_balance(profile_id)
    assert balance["credits_reserved"] == 60
    assert balance["credits_remaining"] == 40


def test_credits_endpoint_returns_profile_allowance_not_provider_pool(sqlite_backend):
    client, _repo, profile_id = sqlite_backend
    set_credit_limit(profile_id, 1234)

    response = client.get(
        "/api/v1/elevenlabs-accounts/credits",
        headers={"X-Profile-Id": profile_id},
    )

    assert response.status_code == 200
    account = response.json()["account"]
    assert account["id"] == profile_id
    assert account["credit_limit"] == 1234
    assert account["credits_remaining"] == 1234
    assert "api_key_hint" not in account


def test_tts_settles_using_provider_character_cost_header(sqlite_backend, tmp_path):
    _client, _repo, profile_id = sqlite_backend
    set_credit_limit(profile_id, 100)
    assign_voice(profile_id, "private-voice", category="cloned", assigned_by="test")

    response = httpx.Response(
        200,
        json={
            "audio_base64": base64.b64encode(b"fake-mp3").decode("ascii"),
            "alignment": {
                "characters": ["h", "i"],
                "character_start_times_seconds": [0.0, 0.1],
                "character_end_times_seconds": [0.1, 0.2],
            },
        },
        headers={"character-cost": "17", "request-id": "req-17"},
        request=httpx.Request("POST", "https://api.elevenlabs.io/v1/tts"),
    )

    from app.services.tts.elevenlabs import ElevenLabsTTSService

    service = ElevenLabsTTSService(
        output_dir=Path(tmp_path),
        api_key="test-key",
        voice_id="private-voice",
        model_id="eleven_flash_v2_5",
        profile_id=profile_id,
    )

    api_call = AsyncMock(return_value=response)
    with patch(
        "app.services.tts.elevenlabs._call_elevenlabs_api_new",
        new=api_call,
    ), patch.object(
        service,
        "_get_voice_metadata",
        new=AsyncMock(return_value={
            "voice_id": "private-voice",
            "labels": {"language": "ro"},
        }),
    ), patch("app.services.tts.elevenlabs.librosa.get_duration", return_value=0.2):
        asyncio.run(service.generate_audio_with_timestamps(
            text="hello world",
            voice_id="private-voice",
            output_path=tmp_path / "voice.mp3",
        ))

    assert api_call.await_args.args[2]["language_code"] == "ro"
    balance = get_credit_balance(profile_id)
    assert balance["credits_used"] == 17
    assert balance["credits_reserved"] == 0
    assert balance["credits_remaining"] == 83
