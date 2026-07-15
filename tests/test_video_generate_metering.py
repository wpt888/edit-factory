"""Seedance credit metering and fixed-duration contract coverage."""

import asyncio
import itertools
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from app.api import video_generate_routes
from app.api.auth import AuthUser, ProfileContext
from app.repositories.models import QueryResult
from app.services.studio_metering import StudioMeteringBlocked


_REQUEST_IDS = itertools.count(11)


class _WebMeteringClient:
    desktop_mode = False

    def __init__(self, *args, **kwargs):
        pass


class _DesktopMeteringClient:
    desktop_mode = True

    def __init__(self, *args, **kwargs):
        pass


class _Repo:
    def __init__(self):
        self.generated = {}
        self.source_videos = []
        self.projects = []
        self.clips = []

    def table_query(self, table, operation, *, data=None, filters=None):
        assert table == "generated_videos"
        if operation == "insert":
            self.generated[data["id"]] = deepcopy(data)
            return QueryResult([deepcopy(data)])
        if operation == "update":
            video_id = filters.eq["id"]
            self.generated[video_id].update(deepcopy(data))
            return QueryResult([deepcopy(self.generated[video_id])])
        if operation == "select":
            rows = [
                deepcopy(row)
                for row in self.generated.values()
                if all(row.get(key) == value for key, value in filters.eq.items())
            ]
            return QueryResult(rows)
        raise AssertionError(f"Unexpected generated_videos operation: {operation}")

    def create_source_video(self, payload):
        self.source_videos.append(deepcopy(payload))
        return deepcopy(payload)

    def create_project(self, payload):
        self.projects.append(deepcopy(payload))
        return deepcopy(payload)

    def create_clip(self, payload):
        self.clips.append(deepcopy(payload))
        return deepcopy(payload)


class _Generator:
    def __init__(self, events, *, failure=None):
        self.events = events
        self.failure = failure
        self.arguments = None

    def generate(self, **kwargs):
        self.events.append("provider")
        self.arguments = kwargs
        if self.failure:
            raise self.failure
        return {"video": {"url": "https://media.test/generated.mp4"}}

    def download_video(self, _url, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"v" * 128)

    def close(self):
        pass


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/video-gen/generate",
            "headers": [],
            "client": (f"127.0.0.{next(_REQUEST_IDS)}", 1234),
        }
    )


def _install_common_fakes(monkeypatch, tmp_path, memory_job_storage):
    repo = _Repo()
    settings = SimpleNamespace(base_dir=tmp_path, fal_api_key="fal-test-key")
    monkeypatch.setattr(video_generate_routes, "get_repository", lambda: repo)
    monkeypatch.setattr(video_generate_routes, "get_settings", lambda: settings)
    monkeypatch.setattr(video_generate_routes, "get_job_storage", lambda: memory_job_storage)
    monkeypatch.setattr(
        "app.services.credentials.vault.get_vault_manager",
        lambda: SimpleNamespace(get_api_key_or_default=lambda *_args: "fal-test-key"),
    )
    return repo


def _context() -> ProfileContext:
    return ProfileContext(profile_id="profile-1", user_id="user-1")


def test_web_seedance_rejects_non_five_second_duration(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )

        with pytest.raises(HTTPException) as error:
            await video_generate_routes.generate_video(
                _request(),
                video_generate_routes.GenerateVideoRequest(
                    prompt="Create a product clip", duration="8"
                ),
                BackgroundTasks(),
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert error.value.status_code == 400
        assert "fixed 5-second" in error.value.detail
        assert repo.generated == {}

    asyncio.run(scenario())


def test_seedance_credit_denial_returns_402_without_background_start(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )

        async def deny(_identity, _record):
            raise StudioMeteringBlocked(
                "insufficient_credits",
                "Not enough credits",
                available_credits=0,
            )

        monkeypatch.setattr(video_generate_routes, "reserve_metering_record", deny)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as error:
            await video_generate_routes.generate_video(
                _request(),
                video_generate_routes.GenerateVideoRequest(
                    prompt="Create a product clip", duration="5"
                ),
                background,
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert error.value.status_code == 402
        assert error.value.detail["billing_url"] == "https://blipost.com/billing"
        assert background.tasks == []
        video_id = next(iter(repo.generated))
        assert repo.generated[video_id]["status"] == "failed"
        job = memory_job_storage.get_job(video_id)
        assert job["metering"]["state"] == "denied"
        assert job["metering"]["operation"] == "studio.seedance_clip"

    asyncio.run(scenario())


def test_seedance_captures_after_library_output_is_persisted(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )
        events = []
        generator = _Generator(events)

        async def reserve(_identity, record):
            events.append("reserve")
            return {**record, "state": "reserved", "reservation_id": "seedance-1"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is True
            assert repo.generated[result_metadata["studio_job_id"]]["status"] == "completed"
            assert repo.clips
            events.append("capture")
            return {
                **record,
                "state": "captured",
                "result_metadata": result_metadata,
            }

        monkeypatch.setattr(video_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(video_generate_routes, "settle_metering_record", settle)
        monkeypatch.setattr(
            "app.services.fal_video_service.get_fal_video_generator",
            lambda _profile_id: generator,
        )
        monkeypatch.setattr(
            "app.api.segments_routes._process_local_video_background",
            lambda *_args: None,
        )
        monkeypatch.setattr(
            "app.api.segments_routes._get_video_info",
            lambda _path: {"duration": 5.0},
        )
        background = BackgroundTasks()

        response = await video_generate_routes.generate_video(
            _request(),
            video_generate_routes.GenerateVideoRequest(
                prompt="Create a product clip", duration="5"
            ),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )
        await background()

        video_id = response["video_id"]
        job = memory_job_storage.get_job(video_id)
        assert events == ["reserve", "provider", "capture"]
        assert generator.arguments["duration"] == "5"
        assert repo.generated[video_id]["status"] == "completed"
        assert job["metering"]["output_persisted"] is True
        assert job["metering"]["state"] == "captured"

    asyncio.run(scenario())


def test_seedance_provider_failure_refunds_reservation(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )
        events = []
        generator = _Generator(events, failure=RuntimeError("provider failed"))

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "seedance-fail"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            events.append("refund")
            return {**record, "state": "released"}

        monkeypatch.setattr(video_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(video_generate_routes, "settle_metering_record", settle)
        monkeypatch.setattr(
            "app.services.fal_video_service.get_fal_video_generator",
            lambda _profile_id: generator,
        )
        background = BackgroundTasks()

        response = await video_generate_routes.generate_video(
            _request(),
            video_generate_routes.GenerateVideoRequest(
                prompt="Create a product clip", duration="5"
            ),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )
        await background()

        video_id = response["video_id"]
        assert events == ["provider", "refund"]
        assert repo.generated[video_id]["status"] == "failed"
        assert memory_job_storage.get_job(video_id)["metering"]["state"] == "released"

    asyncio.run(scenario())


def test_seedance_cancel_before_provider_start_refunds_reservation(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )
        events = []

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "seedance-cancel"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is False
            events.append("refund")
            return {**record, "state": "released"}

        monkeypatch.setattr(video_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(video_generate_routes, "settle_metering_record", settle)
        monkeypatch.setattr(
            "app.services.fal_video_service.get_fal_video_generator",
            lambda _profile_id: (_ for _ in ()).throw(
                AssertionError("cancelled Seedance provider started")
            ),
        )
        background = BackgroundTasks()
        response = await video_generate_routes.generate_video(
            _request(),
            video_generate_routes.GenerateVideoRequest(
                prompt="Create a product clip", duration="5"
            ),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )
        video_id = response["video_id"]
        assert memory_job_storage.cancel_job(video_id) is True

        await background()

        assert events == ["refund"]
        assert repo.generated[video_id]["status"] == "cancelled"
        assert memory_job_storage.get_job(video_id)["metering"]["state"] == "released"

    asyncio.run(scenario())


def test_seedance_status_retries_pending_capture(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        repo = _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _WebMeteringClient
        )

        async def reserve(_identity, record):
            return {**record, "state": "reserved", "reservation_id": "seedance-retry"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert delivered is True
            assert result_metadata["output_id"] == "clip-retry"
            return {**record, "state": "captured", "last_error": None}

        monkeypatch.setattr(video_generate_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(video_generate_routes, "settle_metering_record", settle)
        response = await video_generate_routes.generate_video(
            _request(),
            video_generate_routes.GenerateVideoRequest(
                prompt="Create a product clip", duration="5"
            ),
            BackgroundTasks(),
            _context(),
            AuthUser("user-1", "person@example.com"),
        )
        video_id = response["video_id"]
        repo.generated[video_id].update(
            {"status": "completed", "library_clip_id": "clip-retry"}
        )
        job = memory_job_storage.get_job(video_id)
        pending = {
            **job["metering"],
            "state": "capture_pending",
            "provider_started": True,
            "output_persisted": True,
        }
        memory_job_storage.update_job(
            video_id,
            {"status": "completed", "metering": pending},
            profile_id="profile-1",
        )

        status = await video_generate_routes.video_status(video_id, _context())

        assert status["status"] == "completed"
        assert memory_job_storage.get_job(video_id)["metering"]["state"] == "captured"

    asyncio.run(scenario())


def test_desktop_seedance_keeps_flexible_duration_and_logs_locally(
    monkeypatch, tmp_path, memory_job_storage
):
    async def scenario():
        _install_common_fakes(monkeypatch, tmp_path, memory_job_storage)
        monkeypatch.setattr(
            video_generate_routes, "StudioMeteringClient", _DesktopMeteringClient
        )
        background = BackgroundTasks()

        response = await video_generate_routes.generate_video(
            _request(),
            video_generate_routes.GenerateVideoRequest(
                prompt="Create a product clip", duration="8"
            ),
            background,
            _context(),
            AuthUser("user-1", "person@example.com"),
        )

        job = memory_job_storage.get_job(response["video_id"])
        assert job["status"] == "queued"
        assert job["metering"]["mode"] == "desktop"
        assert job["metering"]["units"] == 1
        assert len(background.tasks) == 1

    asyncio.run(scenario())
