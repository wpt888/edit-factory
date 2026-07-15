"""Durable credit lifecycle for the standalone TTS generation route."""

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api import tts_routes
from app.api.auth import AuthUser, ProfileContext
from app.services.studio_metering import StudioMeteringBlocked, new_metering_record
from app.services.tts.base import TTSResult


def _context() -> ProfileContext:
    return ProfileContext(profile_id="profile-1", user_id="user-1")


def _install(monkeypatch, memory_job_storage, tmp_path, service=None):
    settings = SimpleNamespace(output_dir=tmp_path / "output")
    monkeypatch.setattr(tts_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(tts_routes, "get_repository", lambda: None)
    monkeypatch.setattr(tts_routes, "get_job_storage", lambda: memory_job_storage)
    if service is not None:
        monkeypatch.setattr(tts_routes, "get_tts_service", lambda **_kwargs: service)


async def _submit(background: BackgroundTasks):
    endpoint = getattr(tts_routes.generate_tts, "__wrapped__", tts_routes.generate_tts)
    return await endpoint(
        request=SimpleNamespace(),
        background_tasks=background,
        text="Hello from the standalone route",
        provider="edge",
        voice_id="en-US-AriaNeural",
        language="en",
        profile=_context(),
        current_user=AuthUser("user-1", "person@example.com"),
    )


async def _run_background(background: BackgroundTasks) -> None:
    assert len(background.tasks) == 1
    task = background.tasks[0]
    await task.func(*task.args, **task.kwargs)


class _TTSService:
    def __init__(self, events, *, failure=None):
        self.output_dir = Path("unused")
        self.events = events
        self.failure = failure

    async def generate_audio(self, *, text, voice_id, output_path, language):
        self.events.append(("provider", text, voice_id, language))
        if self.failure:
            raise self.failure
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"ID3" + (b"a" * 256))
        return TTSResult(
            audio_path=output_path,
            duration_seconds=2.5,
            provider="edge",
            voice_id=voice_id,
            cost=0.0,
        )


def test_route_is_fail_closed_before_provider_dispatch(
    monkeypatch,
    memory_job_storage,
    tmp_path,
):
    async def scenario():
        events = []
        _install(monkeypatch, memory_job_storage, tmp_path, _TTSService(events))

        async def deny(_identity, record):
            assert memory_job_storage.get_job(record["idempotency_key"].split(":")[1])
            raise StudioMeteringBlocked(
                "insufficient_credits",
                "Not enough credits",
                available_credits=0,
            )

        monkeypatch.setattr(tts_routes, "reserve_metering_record", deny)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as caught:
            await _submit(background)

        assert caught.value.status_code == 402
        assert caught.value.detail["billing_url"] == "https://blipost.com/billing"
        assert background.tasks == []
        assert events == []
        job = next(iter(memory_job_storage.memory_store.values()))
        assert job["status"] == "failed"
        assert job["metering"]["state"] == "denied"

    asyncio.run(scenario())


def test_route_captures_only_after_audio_checkpoint(
    monkeypatch,
    memory_job_storage,
    tmp_path,
):
    async def scenario():
        events = []
        _install(monkeypatch, memory_job_storage, tmp_path, _TTSService(events))

        async def reserve(_identity, record):
            events.append(("reserve", record["state"]))
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            job = next(iter(memory_job_storage.memory_store.values()))
            assert delivered is True
            assert job["output_persisted"] is True
            assert Path(job["result"]["audio_path"]).is_file()
            assert record["provider_started"] is True
            events.append(("capture", result_metadata["studio_job_id"]))
            return {**record, "state": "captured"}

        monkeypatch.setattr(tts_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        response = await _submit(background)
        assert events == [("reserve", "reserve_pending")]
        await _run_background(background)

        job = memory_job_storage.get_job(response["job_id"])
        assert job["status"] == "completed"
        assert job["metering"]["state"] == "captured"
        assert [event[0] for event in events] == ["reserve", "provider", "capture"]

    asyncio.run(scenario())


def test_provider_failure_refunds_reservation(
    monkeypatch,
    memory_job_storage,
    tmp_path,
):
    async def scenario():
        _install(
            monkeypatch,
            memory_job_storage,
            tmp_path,
            _TTSService([], failure=RuntimeError("provider failed")),
        )

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(tts_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        response = await _submit(background)
        await _run_background(background)

        job = memory_job_storage.get_job(response["job_id"])
        assert job["status"] == "failed"
        assert job["metering"]["state"] == "released"
        assert job["output_persisted"] is False

    asyncio.run(scenario())


def test_cancel_before_provider_refunds_without_dispatch(
    monkeypatch,
    memory_job_storage,
    tmp_path,
):
    async def scenario():
        events = []
        _install(monkeypatch, memory_job_storage, tmp_path, _TTSService(events))

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            events.append(("refund", record["reservation_id"]))
            return {**record, "state": "released"}

        monkeypatch.setattr(tts_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        response = await _submit(background)
        memory_job_storage.cancel_job(response["job_id"])
        await _run_background(background)

        job = memory_job_storage.get_job(response["job_id"])
        assert job["status"] == "cancelled"
        assert job["metering"]["state"] == "released"
        assert events == [("refund", "reservation-1")]

    asyncio.run(scenario())


def test_restart_captures_completed_file_without_rerunning_provider(
    monkeypatch,
    memory_job_storage,
    tmp_path,
):
    async def scenario():
        _install(monkeypatch, memory_job_storage, tmp_path)
        output_path = tmp_path / "output" / "tts" / "profile-1" / "edge" / "tts_job-1.mp3"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"ID3" + (b"a" * 256))
        record = new_metering_record("studio.tts_variant", 1, "tts-generate:job-1")
        record.update({
            "state": "provider_started",
            "reservation_id": "reservation-1",
            "provider_started": True,
            "supabase_user_id": "user-1",
            "email": "person@example.com",
        })
        memory_job_storage.create_job({
            "job_id": "job-1",
            "job_type": "tts_generation",
            "status": "processing",
            "progress": "Generating",
            "profile_id": "profile-1",
            "user_id": "user-1",
            "process_instance_id": "old-process",
            "planned_output_path": str(output_path),
            "output_persisted": False,
            "metering": record,
        }, profile_id="profile-1")

        async def settle(_identity, current, *, delivered, result_metadata=None):
            assert delivered is True
            return {**current, "state": "captured"}

        monkeypatch.setattr(tts_routes, "settle_metering_record", settle)

        job = await tts_routes._reconcile_tts_generation_job("job-1", "user-1")

        assert job["status"] == "completed"
        assert job["output_persisted"] is True
        assert job["metering"]["state"] == "captured"
        assert job["result"]["audio_path"] == str(output_path)

    asyncio.run(scenario())
