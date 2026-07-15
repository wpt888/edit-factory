"""Credit and queue lifecycle for Library voice-over regeneration."""

import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from app.api import library_routes
from app.api.auth import AuthUser, ProfileContext
from app.repositories.models import QueryResult
from app.services.studio_metering import StudioMeteringBlocked


class _Repo:
    def __init__(self, final_path: Path):
        self.clip = {
            "id": "clip-1",
            "project_id": "project-1",
            "profile_id": "profile-1",
            "variant_index": 0,
            "final_video_path": str(final_path),
            "raw_video_path": str(final_path),
            "final_status": "completed",
            "duration": 30.0,
        }
        self.content = {
            "clip_id": "clip-1",
            "tts_text": "A metered voice-over",
            "tts_model": "eleven_flash_v2_5",
            "voice_settings": {"speed": 1.0},
            "segment_composition": [{"source_video_id": "source-1"}],
        }
        self.upserts = []

    def get_clip(self, clip_id):
        return deepcopy(self.clip) if clip_id == self.clip["id"] else None

    def get_clip_content(self, clip_id):
        return deepcopy(self.content) if clip_id == self.clip["id"] else None

    def update_clip(self, clip_id, payload):
        assert clip_id == self.clip["id"]
        self.clip.update(deepcopy(payload))
        return deepcopy(self.clip)

    def update_clip_content(self, clip_id, payload):
        assert clip_id == self.clip["id"]
        self.content.update(deepcopy(payload))

    def get_profile(self, _profile_id):
        return {}

    def table_query(self, table, operation, *, data=None, filters=None):
        assert table == "editai_clip_content"
        assert operation == "upsert"
        self.upserts.append(deepcopy(data))
        self.content.update(deepcopy(data))
        return QueryResult([deepcopy(data)])


class _Ticket:
    def __init__(self, events):
        self.events = events

    async def __aenter__(self):
        self.events.append("queue_enter")
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        self.events.append("queue_exit")
        return False


class _Queue:
    def __init__(self, events):
        self.events = events

    async def enqueue(self, *, user_id, job_id, ready_event=None):
        self.events.append(("enqueue", user_id, job_id))
        return _Ticket(self.events)

    async def cancel(self, _job_id):
        self.events.append("queue_cancel")
        return True


def _request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/library/clips/clip-1/regenerate-voiceover",
        "headers": [],
        "client": ("127.0.0.1", 1234),
    })


def _context() -> ProfileContext:
    return ProfileContext(profile_id="profile-1", user_id="user-1")


def _install(monkeypatch, memory_job_storage, repo):
    monkeypatch.setattr(library_routes, "get_job_storage", lambda: memory_job_storage)
    monkeypatch.setattr(library_routes, "get_repository", lambda: repo)


def _reserved_bundle(job_id="job-1"):
    bundle = library_routes._new_library_voiceover_metering(
        job_id,
        "user-1",
        "person@example.com",
        1,
    )
    return {
        component: {
            **record,
            "state": "reserved",
            "reservation_id": f"reservation-{component}",
        }
        for component, record in bundle.items()
    }


def _create_reserved_job(memory_job_storage, planned_path: Path, bundle=None, **updates):
    job = {
        "job_id": "job-1",
        "job_type": "library_voiceover_regeneration",
        "status": "pending",
        "progress": "Queued",
        "profile_id": "profile-1",
        "user_id": "user-1",
        "project_id": "project-1",
        "clip_id": "clip-1",
        "process_instance_id": library_routes._LIBRARY_PROCESS_INSTANCE_ID,
        "planned_final_path": str(planned_path),
        "billable_components": ["tts", "render"],
        "output_persisted": False,
        "delivered_components": [],
        "metering": bundle or _reserved_bundle(),
        **updates,
    }
    memory_job_storage.create_job(job, profile_id="profile-1")
    return job


def test_route_rolls_back_partial_bundle_and_returns_402(
    monkeypatch, memory_job_storage, tmp_path
):
    async def scenario():
        old_video = tmp_path / "old.mp4"
        old_video.write_bytes(b"old")
        repo = _Repo(old_video)
        _install(monkeypatch, memory_job_storage, repo)
        monkeypatch.setattr(library_routes, "_get_video_duration", lambda _path: 61.0)
        calls = []

        async def reserve(_identity, record):
            calls.append(("reserve", record["operation"], record["units"]))
            if record["operation"] == "studio.render_output_minute":
                raise StudioMeteringBlocked(
                    "insufficient_credits",
                    "Not enough credits",
                    available_credits=0,
                )
            return {**record, "state": "reserved", "reservation_id": "tts-reservation"}

        async def settle(_identity, record, *, delivered, result_metadata=None):
            calls.append(("refund", record["operation"], delivered))
            return {**record, "state": "released"}

        monkeypatch.setattr(library_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(library_routes, "settle_metering_record", settle)
        background = BackgroundTasks()

        with pytest.raises(HTTPException) as caught:
            await library_routes.regenerate_voiceover(
                _request(),
                background,
                "clip-1",
                _context(),
                AuthUser("user-1", "person@example.com"),
            )

        assert caught.value.status_code == 402
        assert caught.value.detail["billing_url"] == "https://blipost.com/billing"
        assert background.tasks == []
        assert repo.clip["final_status"] == "completed"
        job = next(iter(memory_job_storage.memory_store.values()))
        assert job["metering"]["tts"]["state"] == "released"
        assert job["metering"]["render"]["state"] == "denied"
        assert calls == [
            ("reserve", "studio.tts_variant", 1),
            ("reserve", "studio.render_output_minute", 2),
            ("refund", "studio.tts_variant", False),
        ]

    asyncio.run(scenario())


def test_task_queues_render_and_captures_after_versioned_output_persists(
    monkeypatch, memory_job_storage, tmp_path
):
    async def scenario():
        old_video = tmp_path / "old.mp4"
        old_video.write_bytes(b"old")
        planned = tmp_path / "old_regen_job.mp4"
        repo = _Repo(old_video)
        _install(monkeypatch, memory_job_storage, repo)
        _create_reserved_job(memory_job_storage, planned)
        events = []

        class _TTS:
            _voice_id = "voice-1"

            def __init__(self, **_kwargs):
                pass

            async def generate_audio_with_timestamps(self, *, output_path, **_kwargs):
                Path(output_path).write_bytes(b"voice")
                events.append("tts_provider")
                return SimpleNamespace(audio_path=Path(output_path)), None

        class _SilenceRemover:
            def __init__(self, **_kwargs):
                pass

            def remove_silence(self, source, destination):
                Path(destination).write_bytes(Path(source).read_bytes())
                return SimpleNamespace(original_duration=30.0, new_duration=30.0)

        class _Assembly:
            async def assemble_and_render(self, **_kwargs):
                assert events[-1] == "queue_enter"
                assert memory_job_storage.get_job("job-1")["metering"]["render"]["provider_started"]
                events.append("render_provider")
                rendered = tmp_path / "new-final.mp4"
                raw = tmp_path / "new-raw.mp4"
                rendered.write_bytes(b"new-final")
                raw.write_bytes(b"new-raw")
                return rendered, raw, [{"source_video_id": "source-1"}]

        class _Media:
            def tts_path(self, _project_id, _clip_id):
                return tmp_path / "voice-persisted.mp3"

        from app.services import assembly_service
        from app.services.audio import silence_remover
        from app.services.tts import elevenlabs as elevenlabs_module

        monkeypatch.setattr(elevenlabs_module, "ElevenLabsTTSService", _TTS)
        monkeypatch.setattr(silence_remover, "SilenceRemover", _SilenceRemover)
        monkeypatch.setattr(assembly_service, "get_assembly_service", lambda: _Assembly())
        monkeypatch.setattr(library_routes, "get_render_queue", lambda: _Queue(events))
        monkeypatch.setattr(library_routes, "get_media_manager", lambda: _Media())
        monkeypatch.setattr(
            library_routes,
            "get_settings",
            lambda: SimpleNamespace(output_dir=tmp_path),
        )
        monkeypatch.setattr(library_routes, "_get_audio_duration", lambda _path: 30.0)
        monkeypatch.setattr(library_routes, "is_nvenc_available", lambda: False)

        async def settle(_identity, record, *, delivered, result_metadata=None):
            assert repo.clip["final_video_path"] == str(planned)
            assert delivered is True
            events.append(("capture", result_metadata["component"]))
            return {**record, "state": "captured"}

        monkeypatch.setattr(library_routes, "settle_metering_record", settle)

        await library_routes._regenerate_voiceover_task(
            job_id="job-1",
            clip_id="clip-1",
            profile_id="profile-1",
            user_id="user-1",
            clip_data=deepcopy(repo.clip),
            content_data=deepcopy(repo.content),
            planned_final_path=str(planned),
        )

        job = memory_job_storage.get_job("job-1")
        assert old_video.read_bytes() == b"old"
        assert planned.read_bytes() == b"new-final"
        assert repo.clip["final_status"] == "completed"
        assert repo.clip["final_video_path"] == str(planned)
        assert job["status"] == "completed"
        assert job["output_persisted"] is True
        assert all(record["state"] == "captured" for record in job["metering"].values())
        assert events == [
            "tts_provider",
            ("enqueue", "user-1", "library-voiceover:job-1"),
            "queue_enter",
            "render_provider",
            "queue_exit",
            ("capture", "tts"),
            ("capture", "render"),
        ]

    asyncio.run(scenario())


def test_provider_failure_refunds_both_components(monkeypatch, memory_job_storage, tmp_path):
    async def scenario():
        old_video = tmp_path / "old.mp4"
        old_video.write_bytes(b"old")
        planned = tmp_path / "planned.mp4"
        repo = _Repo(old_video)
        _install(monkeypatch, memory_job_storage, repo)
        _create_reserved_job(memory_job_storage, planned)

        class _FailingTTS:
            _voice_id = "voice-1"

            def __init__(self, **_kwargs):
                pass

            async def generate_audio_with_timestamps(self, **_kwargs):
                raise RuntimeError("provider failed")

        from app.services.tts import elevenlabs as elevenlabs_module

        monkeypatch.setattr(elevenlabs_module, "ElevenLabsTTSService", _FailingTTS)
        monkeypatch.setattr(
            library_routes,
            "get_settings",
            lambda: SimpleNamespace(output_dir=tmp_path),
        )
        refunded = []

        async def settle(_identity, record, *, delivered, result_metadata=None):
            refunded.append((record["operation"], delivered))
            return {**record, "state": "released"}

        monkeypatch.setattr(library_routes, "settle_metering_record", settle)

        await library_routes._regenerate_voiceover_task(
            job_id="job-1",
            clip_id="clip-1",
            profile_id="profile-1",
            user_id="user-1",
            clip_data=deepcopy(repo.clip),
            content_data=deepcopy(repo.content),
            planned_final_path=str(planned),
        )

        job = memory_job_storage.get_job("job-1")
        assert job["status"] == "failed"
        assert repo.clip["final_status"] == "failed"
        assert old_video.exists()
        assert not planned.exists()
        assert refunded == [
            ("studio.tts_variant", False),
            ("studio.render_output_minute", False),
        ]

    asyncio.run(scenario())


def test_render_requote_releases_estimate_and_reserves_exact_units(
    monkeypatch, memory_job_storage, tmp_path
):
    async def scenario():
        repo = _Repo(tmp_path / "old.mp4")
        _install(monkeypatch, memory_job_storage, repo)
        bundle = library_routes._new_library_voiceover_metering(
            "job-1", "user-1", "person@example.com", 2
        )
        bundle = {
            component: {
                **record,
                "state": "reserved",
                "reservation_id": f"reservation-{component}",
            }
            for component, record in bundle.items()
        }
        _create_reserved_job(memory_job_storage, tmp_path / "planned.mp4", bundle=bundle)
        events = []

        async def settle(_identity, record, *, delivered, result_metadata=None):
            events.append(("release", record["units"], delivered))
            return {**record, "state": "released"}

        async def reserve(_identity, record):
            events.append(("reserve", record["units"], record["idempotency_key"]))
            return {**record, "state": "reserved", "reservation_id": "actual-reservation"}

        monkeypatch.setattr(library_routes, "settle_metering_record", settle)
        monkeypatch.setattr(library_routes, "reserve_metering_record", reserve)

        job = await library_routes._requote_library_voiceover_render("job-1", 30.0)

        assert job["billable_components"] == ["tts", "render_actual"]
        assert job["metering"]["render"]["state"] == "released"
        assert job["metering"]["render_actual"]["units"] == 1
        assert events == [
            ("release", 2, False),
            ("reserve", 1, "library:job-1:voiceover:render:actual"),
        ]

    asyncio.run(scenario())


def test_restart_captures_output_only_when_clip_points_to_planned_path(
    monkeypatch, memory_job_storage, tmp_path
):
    async def scenario():
        old_video = tmp_path / "old.mp4"
        old_video.write_bytes(b"old")
        planned = tmp_path / "planned.mp4"
        planned.write_bytes(b"new")
        repo = _Repo(old_video)
        repo.clip["final_video_path"] = str(planned)
        _install(monkeypatch, memory_job_storage, repo)
        _create_reserved_job(
            memory_job_storage,
            planned,
            process_instance_id="old-process",
            status="processing",
        )
        captured = []

        async def settle(_identity, record, *, delivered, result_metadata=None):
            captured.append((result_metadata["component"], delivered))
            return {**record, "state": "captured"}

        monkeypatch.setattr(library_routes, "settle_metering_record", settle)

        job = await library_routes._reconcile_library_voiceover_job("job-1", "user-1")

        assert job["status"] == "completed"
        assert job["output_persisted"] is True
        assert captured == [("tts", True), ("render", True)]

    asyncio.run(scenario())
