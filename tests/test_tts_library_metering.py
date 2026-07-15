"""Durable credit metering for user-created TTS Library assets."""

import asyncio
from copy import deepcopy

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api import tts_library_routes
from app.api.auth import AuthUser, ProfileContext
from app.repositories.models import QueryResult
from app.services.studio_metering import StudioMeteringBlocked, new_metering_record


class _Repo:
    def __init__(self):
        self.assets: dict[str, dict] = {}

    def table_query(self, table, operation, *, data=None, filters=None):
        assert table == "editai_tts_assets"
        if operation == "insert":
            self.assets[data["id"]] = deepcopy(data)
            return QueryResult([deepcopy(data)])
        if operation == "select":
            rows = list(self.assets.values())
            if filters:
                rows = [
                    row
                    for row in rows
                    if all(row.get(key) == value for key, value in filters.eq.items())
                ]
            return QueryResult([deepcopy(row) for row in rows])
        if operation == "update":
            rows = []
            for asset_id, row in self.assets.items():
                if filters and any(row.get(key) != value for key, value in filters.eq.items()):
                    continue
                row.update(deepcopy(data))
                rows.append(deepcopy(row))
            return QueryResult(rows)
        raise AssertionError(f"Unexpected operation: {operation}")


class _TTSService:
    def __init__(self, events, *, failure=None):
        self.events = events
        self.failure = failure
        self.deleted = []

    async def generate_asset(self, *, text, profile_id, asset_id, model):
        self.events.append(("provider", asset_id, text))
        if self.failure:
            raise self.failure
        return {
            "mp3_path": f"media/tts/{profile_id}/{asset_id}.mp3",
            "srt_path": f"media/tts/{profile_id}/{asset_id}.srt",
            "srt_content": "1\n00:00:00,000 --> 00:00:01,000\nHello",
            "audio_duration": 1.0,
            "char_count": len(text),
            "tts_timestamps": {"characters": list(text)},
            "tts_voice_id": "voice-1",
        }

    def delete_asset_files(self, mp3_path, srt_path):
        self.deleted.append((mp3_path, srt_path))


def _context() -> ProfileContext:
    return ProfileContext(profile_id="profile-1", user_id="user-1")


def _install(monkeypatch, memory_job_storage, repo, service=None):
    monkeypatch.setattr(tts_library_routes, "get_job_storage", lambda: memory_job_storage)
    monkeypatch.setattr(tts_library_routes, "get_repository", lambda: repo)
    if service is not None:
        monkeypatch.setattr(tts_library_routes, "get_tts_library_service", lambda: service)


async def _run_background(background: BackgroundTasks) -> None:
    assert len(background.tasks) == 1
    task = background.tasks[0]
    await task.func(*task.args, **task.kwargs)


def test_create_is_fail_closed_before_asset_or_provider(monkeypatch, memory_job_storage):
    async def scenario():
        repo = _Repo()
        events = []
        service = _TTSService(events)
        _install(monkeypatch, memory_job_storage, repo, service)

        async def deny(_identity, record):
            assert memory_job_storage.get_job(record["idempotency_key"].split(":")[1]) is not None
            raise StudioMeteringBlocked(
                "insufficient_credits",
                "Not enough credits",
                available_credits=0,
            )

        monkeypatch.setattr(tts_library_routes, "reserve_metering_record", deny)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as caught:
            await tts_library_routes.create_tts_asset(
                tts_library_routes.TTSAssetCreate(tts_text="Hello"),
                background,
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert caught.value.status_code == 402
        assert caught.value.detail["billing_url"] == "https://blipost.com/billing"
        assert repo.assets == {}
        assert background.tasks == []
        assert events == []
        job = next(iter(memory_job_storage.memory_store.values()))
        assert job["status"] == "failed"
        assert job["metering"]["state"] == "denied"

    asyncio.run(scenario())


def test_create_captures_only_after_asset_is_ready(monkeypatch, memory_job_storage):
    async def scenario():
        repo = _Repo()
        events = []
        service = _TTSService(events)
        _install(monkeypatch, memory_job_storage, repo, service)

        async def reserve(_identity, record):
            events.append(("reserve", record["state"]))
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            asset = next(iter(repo.assets.values()))
            assert delivered is True
            assert asset["status"] == "ready"
            assert record["provider_started"] is True
            events.append(("capture", result_metadata["output_id"]))
            return {**record, "state": "captured", "result_metadata": result_metadata}

        monkeypatch.setattr(tts_library_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_library_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        response = await tts_library_routes.create_tts_asset(
            tts_library_routes.TTSAssetCreate(tts_text="Hello"),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )

        assert repo.assets[response.id]["status"] == "generating"
        assert events == [("reserve", "reserve_pending")]
        await _run_background(background)

        job = memory_job_storage.get_job(response.job_id)
        assert repo.assets[response.id]["status"] == "ready"
        assert job["status"] == "completed"
        assert job["metering"]["state"] == "captured"
        assert [event[0] for event in events] == ["reserve", "provider", "capture"]

    asyncio.run(scenario())


def test_provider_failure_refunds_and_restores_existing_asset(monkeypatch, memory_job_storage):
    async def scenario():
        repo = _Repo()
        repo.assets["asset-1"] = {
            "id": "asset-1",
            "profile_id": "profile-1",
            "tts_text": "Original",
            "char_count": 8,
            "tts_model": "eleven_flash_v2_5",
            "mp3_path": "media/tts/profile-1/asset-1.mp3",
            "srt_path": "media/tts/profile-1/asset-1.srt",
            "status": "ready",
            "created_at": "2026-07-15T00:00:00+00:00",
            "updated_at": "2026-07-15T00:00:00+00:00",
        }
        service = _TTSService([], failure=RuntimeError("provider failed"))
        _install(monkeypatch, memory_job_storage, repo, service)

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            return {**record, "state": "released"}

        monkeypatch.setattr(tts_library_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_library_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        response = await tts_library_routes.update_tts_asset(
            "asset-1",
            tts_library_routes.TTSAssetUpdate(tts_text="Replacement"),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )
        await _run_background(background)

        job = memory_job_storage.get_job(response.job_id)
        assert job["status"] == "failed"
        assert job["metering"]["state"] == "released"
        assert repo.assets["asset-1"]["tts_text"] == "Original"
        assert repo.assets["asset-1"]["status"] == "ready"
        assert service.deleted == []

    asyncio.run(scenario())


def test_restart_replays_lost_reserve_then_refunds(monkeypatch, memory_job_storage):
    async def scenario():
        repo = _Repo()
        _install(monkeypatch, memory_job_storage, repo)
        record = new_metering_record(
            "studio.tts_variant",
            1,
            "tts-library:job-1:generate",
        )
        record.update({
            "state": "reserve_pending",
            "supabase_user_id": "user-1",
            "email": "person@example.com",
        })
        memory_job_storage.create_job({
            "job_id": "job-1",
            "job_type": "tts_library_asset",
            "status": "processing",
            "progress": "Generating",
            "profile_id": "profile-1",
            "user_id": "user-1",
            "asset_id": "asset-1",
            "process_instance_id": "old-process",
            "output_persisted": False,
            "metering": record,
        }, profile_id="profile-1")
        events = []

        async def reserve(_identity, pending):
            events.append(("reserve", pending["idempotency_key"]))
            return {**pending, "state": "reserved", "reservation_id": "reservation-1"}

        async def settle(_identity, reserved, *, delivered, result_metadata=None):
            events.append(("refund", reserved["reservation_id"], delivered))
            return {**reserved, "state": "released"}

        monkeypatch.setattr(tts_library_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(tts_library_routes, "settle_metering_record", settle)

        reconciled = await tts_library_routes._reconcile_tts_library_job("job-1", "user-1")

        assert reconciled["status"] == "failed"
        assert reconciled["metering"]["state"] == "released"
        assert events == [
            ("reserve", "tts-library:job-1:generate"),
            ("refund", "reservation-1", False),
        ]

    asyncio.run(scenario())


def test_restart_repairs_status_after_capture_completed(monkeypatch, memory_job_storage):
    async def scenario():
        repo = _Repo()
        _install(monkeypatch, memory_job_storage, repo)
        record = new_metering_record(
            "studio.tts_variant",
            1,
            "tts-library:job-captured:generate",
        )
        record.update({
            "state": "captured",
            "reservation_id": "reservation-captured",
            "provider_started": True,
            "supabase_user_id": "user-1",
        })
        memory_job_storage.create_job({
            "job_id": "job-captured",
            "job_type": "tts_library_asset",
            "status": "processing",
            "progress": "Capturing credits",
            "profile_id": "profile-1",
            "user_id": "user-1",
            "asset_id": "asset-1",
            "process_instance_id": "old-process",
            "output_persisted": True,
            "metering": record,
        }, profile_id="profile-1")

        job = await tts_library_routes._reconcile_tts_library_job(
            "job-captured",
            "user-1",
        )

        assert job["status"] == "completed"
        assert job["progress"] == "Ready"
        assert job["metering"]["state"] == "captured"

    asyncio.run(scenario())
