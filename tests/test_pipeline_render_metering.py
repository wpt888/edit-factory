"""Credit lifecycle coverage for final pipeline renders."""

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from app.api import pipeline_routes
from app.api.auth import AuthUser, ProfileContext
from app.services.studio_metering import StudioMeteringBlocked, new_metering_record


class _WebMeteringClient:
    desktop_mode = False

    def __init__(self, *args, **kwargs):
        pass


class _QueueTicket:
    pass


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/pipeline/render",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        }
    )


def _pipeline(pipeline_id: str, audio_path: str, *, duration: float = 61.0) -> dict:
    return {
        "pipeline_id": pipeline_id,
        "profile_id": "profile-1",
        "provider": "gemini",
        "scripts": ["Test script"],
        "render_jobs": {},
        "previews": {},
        "tts_previews": {
            0: {
                "audio_path": audio_path,
                "audio_duration": duration,
                "script_hash": pipeline_routes._stable_hash("Test script"),
            }
        },
        "meta_multiplication": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _install_render_route_fakes(monkeypatch, pipeline_id: str, pipeline: dict) -> None:
    pipeline_routes._pipelines[pipeline_id] = pipeline
    monkeypatch.setattr(pipeline_routes, "StudioMeteringClient", _WebMeteringClient)
    monkeypatch.setattr(
        pipeline_routes,
        "_fetch_preset_and_settings",
        lambda _request: ({}, {}),
    )
    monkeypatch.setattr(pipeline_routes, "_db_update_render_jobs", lambda *_args: None)


def test_render_reserves_exact_minutes_before_queue_entry(monkeypatch, tmp_path):
    async def scenario():
        audio = tmp_path / "voice.mp3"
        audio.write_bytes(b"a" * 101)
        pipeline_id = "render-metering-order"
        pipeline = _pipeline(pipeline_id, str(audio), duration=61.0)
        _install_render_route_fakes(monkeypatch, pipeline_id, pipeline)
        events = []

        async def reserve(identity, record):
            events.append(("reserve", identity.supabase_user_id, record["units"]))
            return {**record, "state": "reserved", "reservation_id": "reservation-1"}

        class _Queue:
            async def enqueue(self, **kwargs):
                events.append(("enqueue", kwargs["user_id"], kwargs["job_id"]))
                return _QueueTicket()

        monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve)
        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: _Queue())

        response = await pipeline_routes.render_variants(
            _request(),
            pipeline_id,
            pipeline_routes.PipelineRenderRequest(variant_indices=[0]),
            BackgroundTasks(),
            ProfileContext(profile_id="profile-1", user_id="user-1"),
            AuthUser("user-1", "person@example.com"),
        )

        assert response.rendering_variants == [0]
        assert [event[0] for event in events] == ["reserve", "enqueue"]
        assert events[0] == ("reserve", "user-1", 2)
        record = pipeline["render_jobs"][0]["metering"]
        assert record["operation"] == "studio.render_output_minute"
        assert record["units"] == 2
        assert record["supabase_user_id"] == "user-1"
        assert record["state"] == "reserved"
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())


def test_render_credit_denial_never_enters_queue(monkeypatch, tmp_path):
    async def scenario():
        audio = tmp_path / "voice.mp3"
        audio.write_bytes(b"a" * 101)
        pipeline_id = "render-metering-denied"
        pipeline = _pipeline(pipeline_id, str(audio))
        _install_render_route_fakes(monkeypatch, pipeline_id, pipeline)
        queue_calls = 0

        async def deny(_identity, _record):
            raise StudioMeteringBlocked(
                "insufficient_credits",
                "Not enough credits",
                available_credits=0,
            )

        class _Queue:
            async def enqueue(self, **_kwargs):
                nonlocal queue_calls
                queue_calls += 1
                return _QueueTicket()

        monkeypatch.setattr(pipeline_routes, "reserve_metering_record", deny)
        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: _Queue())

        with pytest.raises(HTTPException) as error:
            await pipeline_routes.render_variants(
                _request(),
                pipeline_id,
                pipeline_routes.PipelineRenderRequest(variant_indices=[0]),
                BackgroundTasks(),
                ProfileContext(profile_id="profile-1", user_id="user-1"),
                AuthUser("user-1", "person@example.com"),
            )

        assert error.value.status_code == 402
        assert error.value.detail["billing_url"] == "https://blipost.com/billing"
        assert queue_calls == 0
        assert pipeline["render_jobs"][0]["status"] == "failed"
        assert pipeline["render_jobs"][0]["metering"]["state"] == "denied"
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())


def test_cancelled_queued_render_refunds_reservation(monkeypatch):
    async def scenario():
        pipeline_id = "render-metering-cancel"
        record = {
            **new_metering_record(
                "studio.render_output_minute",
                1,
                "pipeline:render-metering-cancel:render:0:attempt",
            ),
            "state": "reserved",
            "reservation_id": "reservation-cancel",
            "supabase_user_id": "user-1",
        }
        pipeline = {
            "pipeline_id": pipeline_id,
            "profile_id": "profile-1",
            "provider": "gemini",
            "scripts": ["Test script"],
            "render_jobs": {
                0: {
                    "status": "queued",
                    "progress": 0,
                    "current_step": "Queued",
                    "metering": record,
                }
            },
        }
        pipeline_routes._pipelines[pipeline_id] = pipeline

        class _Queue:
            async def cancel(self, _job_id):
                return True

        async def settle(identity, current, *, delivered, result_metadata=None):
            assert identity.supabase_user_id == "user-1"
            assert delivered is False
            return {**current, "state": "released"}

        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: _Queue())
        monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)
        monkeypatch.setattr(pipeline_routes, "_db_update_render_jobs", lambda *_args: None)
        monkeypatch.setattr("app.services.ffmpeg_registry.kill_job", lambda *_args: None)

        await pipeline_routes.cancel_variant_render(
            pipeline_id,
            "0",
            ProfileContext(profile_id="profile-1", user_id="user-1"),
        )

        job = pipeline["render_jobs"][0]
        assert job["status"] == "cancelled"
        assert job["metering"]["state"] == "released"
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())


def test_status_reconciles_capture_after_output_persistence(monkeypatch):
    async def scenario():
        pipeline_id = "render-metering-reconcile"
        record = {
            **new_metering_record(
                "studio.render_output_minute",
                1,
                "pipeline:render-metering-reconcile:render:0:attempt",
            ),
            "state": "capture_pending",
            "reservation_id": "reservation-capture",
            "provider_started": True,
            "output_persisted": True,
            "supabase_user_id": "user-1",
        }
        pipeline = {
            "pipeline_id": pipeline_id,
            "profile_id": "profile-1",
            "provider": "gemini",
            "scripts": ["Test script"],
            "render_jobs": {
                0: {
                    "status": "completed",
                    "progress": 100,
                    "current_step": "Render complete",
                    "final_video_path": None,
                    "clip_id": "clip-1",
                    "metering": record,
                }
            },
            "previews": {},
            "tts_previews": {},
            "meta_multiplication": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        pipeline_routes._pipelines[pipeline_id] = pipeline

        class _Queue:
            async def snapshots(self, _job_ids):
                return {}

        async def settle(identity, current, *, delivered, result_metadata=None):
            assert identity.supabase_user_id == "user-1"
            assert delivered is True
            assert result_metadata["output_id"] == "0"
            return {**current, "state": "captured", "last_error": None}

        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: _Queue())
        monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)
        monkeypatch.setattr(pipeline_routes, "_db_update_render_jobs", lambda *_args: None)

        response = await pipeline_routes.get_pipeline_status(pipeline_id)

        assert response.variants[0].status == "completed"
        assert pipeline["render_jobs"][0]["metering"]["state"] == "captured"
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())
