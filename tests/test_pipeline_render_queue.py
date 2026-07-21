"""Pipeline route integration coverage for fair render queue state."""
import asyncio
from copy import deepcopy
from datetime import datetime, timezone

import pytest

from app.api import pipeline_routes
from app.api.auth import ProfileContext
from app.services.render_queue import FairRenderQueue, RenderQueueCancelled


class _NoopSlot:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return False


async def _noop_slot_factory():
    return _NoopSlot()


def _queued_pipeline(pipeline_id: str) -> dict:
    return {
        "pipeline_id": pipeline_id,
        "profile_id": "profile-1",
        "provider": "gemini",
        "scripts": ["Test script"],
        "render_jobs": {
            0: {
                "status": "queued",
                "progress": 0,
                "current_step": "Queued for render",
            }
        },
        "previews": {},
        "tts_previews": {},
        "meta_multiplication": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def test_status_exposes_queue_position_and_recent_duration_eta(monkeypatch):
    async def scenario():
        queue = FairRenderQueue(
            capacity=1,
            slot_factory=_noop_slot_factory,
            default_duration_seconds=75,
        )
        blocker = await queue.enqueue(user_id="alice", job_id="other-pipeline:0")
        blocker_started = asyncio.Event()
        blocker_release = asyncio.Event()

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        blocker_task = asyncio.create_task(run_blocker())
        await blocker_started.wait()

        pipeline_id = "queue-status-pipeline"
        queued_ticket = await queue.enqueue(
            user_id="bob",
            job_id=pipeline_routes._render_queue_job_id(pipeline_id, 0),
        )
        pipeline_routes._pipelines[pipeline_id] = _queued_pipeline(pipeline_id)
        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: queue)

        response = await pipeline_routes.get_pipeline_status(
            pipeline_id,
            ProfileContext(profile_id="profile-1", user_id="user-1"),
        )
        queued_status = response.variants[0]
        assert queued_status.status == "queued"
        assert queued_status.queue_position == 1
        assert queued_status.eta_seconds == 75

        await queue.cancel(pipeline_routes._render_queue_job_id(pipeline_id, 0))
        try:
            async with queued_ticket:
                raise AssertionError("cancelled queued render started")
        except RenderQueueCancelled:
            pass
        blocker_release.set()
        await blocker_task
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())


def test_cancel_variant_removes_waiting_queue_item_immediately(monkeypatch):
    async def scenario():
        queue = FairRenderQueue(capacity=1, slot_factory=_noop_slot_factory)
        blocker = await queue.enqueue(user_id="alice", job_id="other-pipeline:0")
        blocker_started = asyncio.Event()
        blocker_release = asyncio.Event()

        async def run_blocker():
            async with blocker:
                blocker_started.set()
                await blocker_release.wait()

        blocker_task = asyncio.create_task(run_blocker())
        await blocker_started.wait()

        pipeline_id = "queue-cancel-pipeline"
        queued_ticket = await queue.enqueue(
            user_id="bob",
            job_id=pipeline_routes._render_queue_job_id(pipeline_id, 0),
        )
        pipeline = _queued_pipeline(pipeline_id)
        pipeline_routes._pipelines[pipeline_id] = pipeline
        monkeypatch.setattr(pipeline_routes, "get_render_queue", lambda: queue)
        monkeypatch.setattr(pipeline_routes, "_db_update_render_jobs", lambda *_args: None)

        await pipeline_routes.cancel_variant_render(
            pipeline_id,
            "0",
            ProfileContext(profile_id="profile-1", user_id="bob"),
        )

        assert await queue.snapshot(pipeline_routes._render_queue_job_id(pipeline_id, 0)) is None
        assert pipeline["render_jobs"][0]["status"] == "cancelled"
        try:
            async with queued_ticket:
                raise AssertionError("cancelled queued render started")
        except RenderQueueCancelled:
            pass

        blocker_release.set()
        await blocker_task
        pipeline_routes._pipelines.pop(pipeline_id, None)

    asyncio.run(scenario())


@pytest.mark.parametrize("persisted_status", ["queued", "processing"])
def test_load_marks_process_local_render_jobs_interrupted(monkeypatch, persisted_status):
    pipeline_id = f"restart-{persisted_status}"
    row = {
        "id": pipeline_id,
        "profile_id": "profile-1",
        "provider": "gemini",
        "scripts": ["Test script"],
        "render_jobs": {
            "0": {
                "status": persisted_status,
                "progress": 42 if persisted_status == "processing" else 0,
                "current_step": "Encoding" if persisted_status == "processing" else "Queued for render",
            }
        },
        "previews": {},
        "tts_previews": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    class _Repo:
        def __init__(self):
            self.updates = []

        def get_pipeline(self, requested_id):
            assert requested_id == pipeline_id
            return deepcopy(row)

        def update_pipeline(self, requested_id, updates):
            self.updates.append((requested_id, deepcopy(updates)))

    repo = _Repo()
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repo)
    pipeline_routes._pipelines.pop(pipeline_id, None)

    restored = pipeline_routes._db_load_pipeline(pipeline_id)
    assert restored is not None
    job = restored["render_jobs"][0]
    assert job["status"] == "failed"
    assert job["progress"] == 0
    assert job["interrupted"] is True
    assert job["current_step"] == "Render întrerupt — apasă Render din nou"
    assert repo.updates[-1][1]["render_jobs"]["0"]["status"] == "failed"

    pipeline_routes._pipelines.pop(pipeline_id, None)
