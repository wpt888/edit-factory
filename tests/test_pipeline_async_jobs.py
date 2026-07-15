"""Focused coverage for persisted Step 1 and Step 2 background jobs."""

import asyncio
import copy
import threading

from fastapi import HTTPException

from app.api import pipeline_routes
from app.api.auth import ProfileContext
from app.repositories.models import QueryResult
from app.services.studio_metering import StudioMeteringBlocked, new_metering_record


HEADERS = {"X-Profile-Id": "test-profile-001"}


class _FakeScriptGenerator:
    def generate_scripts(self, **_kwargs):
        return [
            "First generated script.",
            "Second generated script.",
        ]


def test_pipeline_history_falls_back_before_async_job_migration(monkeypatch):
    class LegacyPipelineRepository:
        def __init__(self):
            self.selects = []

        def list_pipelines(self, _profile_id, filters):
            self.selects.append(filters.select)
            if "generation_job" in filters.select:
                raise RuntimeError(
                    "column editai_pipelines.generation_job does not exist"
                )
            return QueryResult(data=[{
                "id": "legacy-pipeline",
                "name": "Legacy history",
                "idea": "Still visible before migration 054",
                "provider": "gemini",
                "variant_count": 1,
                "keyword_count": 0,
                "created_at": "2026-07-15T08:00:00Z",
                "target_script_duration": 30,
            }])

    repo = LegacyPipelineRepository()
    monkeypatch.setattr(pipeline_routes, "get_repository", lambda: repo)

    response = asyncio.run(pipeline_routes.list_pipelines(
        ProfileContext(profile_id="profile-1", user_id="user-1"),
        limit=20,
    ))

    assert [item.pipeline_id for item in response.pipelines] == ["legacy-pipeline"]
    assert response.pipelines[0].generation_job == {}
    assert len(repo.selects) == 2
    assert "generation_job" in repo.selects[0]
    assert "generation_job" not in repo.selects[1]


def test_async_job_update_tolerates_pending_schema_migration(monkeypatch, caplog):
    class LegacyPipelineRepository:
        def update_pipeline(self, _pipeline_id, _updates):
            raise RuntimeError(
                "column editai_pipelines.generation_job does not exist"
            )

    monkeypatch.setattr(
        pipeline_routes,
        "get_repository",
        lambda: LegacyPipelineRepository(),
    )

    pipeline_routes._db_update_async_jobs(
        "legacy-pipeline",
        generation_job={"status": "processing"},
    )

    assert not [record for record in caplog.records if record.levelname == "WARNING"]


def _evict_pipeline_memory(pipeline_id: str) -> None:
    """Simulate a fresh request that must restore state from SQLite."""
    with pipeline_routes._pipelines_lock:
        pipeline_routes._pipelines.pop(pipeline_id, None)


def test_script_generation_is_acknowledged_and_persisted(sqlite_backend, monkeypatch):
    client, repo, _profile_id = sqlite_backend
    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: _FakeScriptGenerator(),
    )

    response = client.post(
        "/api/v1/pipeline/generate",
        headers=HEADERS,
        json={
            "name": "Async scripts",
            "idea": "Show that generation continues in the background",
            "variant_count": 2,
            "provider": "gemini",
        },
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["job"]["progress"] == 0
    pipeline_id = payload["pipeline_id"]

    status = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert status.status_code == 200
    assert status.json()["job"]["status"] == "completed"
    assert status.json()["job"]["progress"] == 100
    assert status.json()["job"]["metering"]["mode"] == "desktop"
    assert status.json()["job"]["metering"]["state"] == "captured"
    assert status.json()["job"]["metering"]["supabase_user_id"]
    assert status.json()["scripts"] == [
        "First generated script.",
        "Second generated script.",
    ]
    assert repo.get_pipeline(pipeline_id)["generation_job"]["status"] == "completed"

    _evict_pipeline_memory(pipeline_id)
    restored = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert restored.status_code == 200
    assert restored.json()["job"]["status"] == "completed"
    assert len(restored.json()["scripts"]) == 2


def test_script_generation_fails_closed_before_provider_when_credits_are_insufficient(
    sqlite_backend,
    monkeypatch,
):
    client, _repo, _profile_id = sqlite_backend
    provider_calls = []

    class ForbiddenGenerator:
        def generate_scripts(self, **_kwargs):
            provider_calls.append(True)
            raise AssertionError("provider must not run after a denied reserve")

    async def deny_reserve(*_args, **_kwargs):
        raise StudioMeteringBlocked(
            "insufficient_credits",
            "Insufficient Blipost credits",
            available_credits=0,
            upstream_status=402,
        )

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", deny_reserve)
    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: ForbiddenGenerator(),
    )

    response = client.post(
        "/api/v1/pipeline/generate",
        headers=HEADERS,
        json={"idea": "This must not reach Gemini", "variant_count": 1},
    )

    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "insufficient_credits"
    assert response.json()["detail"]["billing_url"] == "https://blipost.com/billing"
    assert provider_calls == []


def test_script_generation_fails_closed_before_provider_when_bridge_is_down(
    sqlite_backend,
    monkeypatch,
):
    client, _repo, _profile_id = sqlite_backend
    provider_calls = []

    async def unavailable(*_args, **_kwargs):
        raise StudioMeteringBlocked("metering_unavailable", "Bridge offline")

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", unavailable)
    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: provider_calls.append(True),
    )

    response = client.post(
        "/api/v1/pipeline/generate",
        headers=HEADERS,
        json={"idea": "Fail closed while Blipost is offline", "variant_count": 1},
    )

    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "metering_unavailable"
    assert "not started" in response.json()["detail"]["message"]
    assert provider_calls == []


def test_script_regeneration_has_its_own_metered_attempt(sqlite_backend, monkeypatch):
    client, repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "idea": "Regenerate one script",
            "scripts": ["Original script."],
            "provider": "gemini",
        },
    )
    pipeline_id = imported.json()["pipeline_id"]
    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: _FakeScriptGenerator(),
    )

    response = client.post(
        f"/api/v1/pipeline/regenerate-script/{pipeline_id}/0",
        headers=HEADERS,
        json={"provider": "gemini"},
    )

    assert response.status_code == 200
    assert response.json()["script"] == "First generated script."
    attempts = repo.get_pipeline(pipeline_id)["generation_job"]["regenerations"]
    assert len(attempts) == 1
    attempt = next(iter(attempts.values()))
    assert attempt["status"] == "completed"
    assert attempt["metering"]["operation"] == "studio.script_pipeline"
    assert attempt["metering"]["state"] == "captured"


def test_active_generation_state_is_interrupted_after_memory_eviction(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = "persisted-active-generation"
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Still generating",
        "idea": "Refresh while this job is active",
        "provider": "gemini",
        "variant_count": 3,
        "keyword_count": 0,
        "scripts": [],
        "generation_job": {
            "status": "processing",
            "progress": 35,
            "current_step": "Generating 3 script variants",
        },
        "tts_jobs": {},
    })

    _evict_pipeline_memory(pipeline_id)
    restored = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert restored.status_code == 200
    job = restored.json()["job"]
    assert job["status"] == "failed"
    assert job["progress"] == 0
    assert job["current_step"] == "Generation interrupted — try again"
    assert "did not survive" in job["error"]


def test_captured_generation_state_completes_after_memory_eviction(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = "captured-generation-recovery"
    metering = new_metering_record(
        "studio.script_pipeline",
        1,
        f"pipeline:{pipeline_id}:script",
    )
    metering.update({
        "state": "captured",
        "reservation_id": "reservation-generation-captured",
        "provider_started": True,
        "output_persisted": True,
        "supabase_user_id": "user-generation-captured",
    })
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Captured generation",
        "idea": "Capture won before process exit",
        "provider": "gemini",
        "variant_count": 1,
        "keyword_count": 0,
        "scripts": ["The durable generated script."],
        "generation_job": {
            "status": "processing",
            "progress": 99,
            "current_step": "Finalizing Blipost credits",
            "result": {"variant_count": 1},
            "metering": metering,
        },
        "tts_jobs": {},
    })
    _evict_pipeline_memory(pipeline_id)

    response = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    job = response.json()["job"]
    assert job["status"] == "completed"
    assert job["progress"] == 100
    assert job["metering"]["state"] == "captured"


def test_generation_status_replays_lost_reserve_response_then_refunds(
    sqlite_backend,
    monkeypatch,
):
    client, repo, profile_id = sqlite_backend
    pipeline_id = "generation-lost-reserve-response"
    record = {
        **new_metering_record(
            "studio.script_pipeline",
            1,
            f"pipeline:{pipeline_id}:script",
        ),
        "supabase_user_id": "user-generation-recovery",
    }
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Recover generation reserve",
        "idea": "Server restarted after reserve",
        "provider": "gemini",
        "variant_count": 1,
        "keyword_count": 0,
        "scripts": [],
        "generation_job": {
            "status": "queued",
            "progress": 0,
            "current_step": "Queued",
            "metering": record,
        },
        "tts_jobs": {},
    })
    _evict_pipeline_memory(pipeline_id)
    events: list[tuple[str, str]] = []

    async def reserve(identity, current, *, client=None):
        assert identity.supabase_user_id == "user-generation-recovery"
        events.append(("reserve", current["idempotency_key"]))
        return {
            **current,
            "state": "reserved",
            "reservation_id": "reservation-generation-replayed",
            "replayed": True,
        }

    async def settle(_identity, current, *, delivered, result_metadata=None, client=None):
        assert delivered is False
        events.append(("refund", current["idempotency_key"]))
        return {**current, "state": "released"}

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve)
    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)

    response = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    job = response.json()["job"]
    assert events == [
        ("reserve", record["idempotency_key"]),
        ("refund", record["idempotency_key"]),
    ]
    assert job["status"] == "failed"
    assert job["metering"]["reservation_id"] == "reservation-generation-replayed"
    assert job["metering"]["state"] == "released"


def test_tts_job_is_per_variant_and_restores_from_sqlite(sqlite_backend, monkeypatch):
    client, repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "name": "Async TTS",
            "idea": "One persisted voice-over job",
            "scripts": ["A short script for voice-over."],
        },
    )
    assert imported.status_code == 200
    pipeline_id = imported.json()["pipeline_id"]

    async def _fake_tts_work(*_args, **_kwargs):
        pipeline_routes._update_tts_job(
            pipeline_id,
            0,
            progress=65,
            current_step="Creating subtitles",
        )
        return pipeline_routes.PipelineTtsResponse(
            status="ok",
            audio_duration=1.25,
            srt_content="1\n00:00:00,000 --> 00:00:01,250\nA short script",
            script_word_count=5,
            srt_word_count=3,
        )

    monkeypatch.setattr(pipeline_routes, "_generate_variant_tts_work", _fake_tts_work)
    response = client.post(
        f"/api/v1/pipeline/tts/{pipeline_id}/0",
        headers=HEADERS,
        json={"words_per_subtitle": 2},
    )
    assert response.status_code == 202
    assert response.json()["variant_index"] == 0
    assert response.json()["status"] == "queued"

    status = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )
    job = status.json()["jobs"]["0"]
    assert job["status"] == "completed"
    assert job["progress"] == 100
    assert job["result"]["audio_duration"] == 1.25
    assert job["metering"]["supabase_user_id"]
    assert repo.get_pipeline(pipeline_id)["tts_jobs"]["0"]["status"] == "completed"

    _evict_pipeline_memory(pipeline_id)
    restored = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert restored.status_code == 200
    assert restored.json()["jobs"]["0"]["status"] == "completed"


def test_captured_tts_state_completes_after_memory_eviction(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = "captured-tts-recovery"
    metering = new_metering_record(
        "studio.tts_variant",
        1,
        f"pipeline:{pipeline_id}:tts:0:durable-attempt",
    )
    metering.update({
        "state": "captured",
        "reservation_id": "reservation-tts-captured",
        "provider_started": True,
        "output_persisted": True,
        "supabase_user_id": "user-tts-captured",
    })
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Captured TTS",
        "idea": "Capture won before process exit",
        "provider": "gemini",
        "variant_count": 1,
        "keyword_count": 0,
        "scripts": ["A durable voice-over script."],
        "generation_job": {},
        "tts_jobs": {
            "0": {
                "status": "processing",
                "progress": 94,
                "current_step": "Finalizing voice-over",
                "result": {"audio_duration": 1.25},
                "metering": metering,
            }
        },
    })
    _evict_pipeline_memory(pipeline_id)

    response = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    job = response.json()["jobs"]["0"]
    assert job["status"] == "completed"
    assert job["progress"] == 100
    assert job["metering"]["state"] == "captured"


def test_tts_status_replays_lost_reserve_response_then_refunds(
    sqlite_backend,
    monkeypatch,
):
    client, repo, profile_id = sqlite_backend
    pipeline_id = "tts-lost-reserve-response"
    record = {
        **new_metering_record(
            "studio.tts_variant",
            1,
            f"pipeline:{pipeline_id}:tts:0:durable-attempt",
        ),
        "supabase_user_id": "user-tts-recovery",
    }
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Recover TTS reserve",
        "idea": "Server restarted after TTS reserve",
        "provider": "gemini",
        "variant_count": 1,
        "keyword_count": 0,
        "scripts": ["A voice-over that never started."],
        "generation_job": {},
        "tts_jobs": {
            "0": {
                "status": "queued",
                "progress": 0,
                "current_step": "Queued",
                "metering": record,
            }
        },
    })
    _evict_pipeline_memory(pipeline_id)
    events: list[tuple[str, str]] = []

    async def reserve(identity, current, *, client=None):
        assert identity.supabase_user_id == "user-tts-recovery"
        events.append(("reserve", current["idempotency_key"]))
        return {
            **current,
            "state": "reserved",
            "reservation_id": "reservation-tts-replayed",
            "replayed": True,
        }

    async def settle(_identity, current, *, delivered, result_metadata=None, client=None):
        assert delivered is False
        events.append(("refund", current["idempotency_key"]))
        return {**current, "state": "released"}

    monkeypatch.setattr(pipeline_routes, "reserve_metering_record", reserve)
    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)

    response = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    job = response.json()["jobs"]["0"]
    assert events == [
        ("reserve", record["idempotency_key"]),
        ("refund", record["idempotency_key"]),
    ]
    assert job["status"] == "failed"
    assert job["metering"]["reservation_id"] == "reservation-tts-replayed"
    assert job["metering"]["state"] == "released"


def test_tts_failure_refunds_reserved_credits(sqlite_backend, monkeypatch):
    client, _repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"idea": "Refund failed TTS", "scripts": ["Provider failure."]},
    )
    pipeline_id = imported.json()["pipeline_id"]

    async def fail_tts(*_args, **_kwargs):
        raise HTTPException(status_code=500, detail="Provider failed")

    monkeypatch.setattr(pipeline_routes, "_generate_variant_tts_work", fail_tts)
    response = client.post(
        f"/api/v1/pipeline/tts/{pipeline_id}/0",
        headers=HEADERS,
        json={},
    )
    assert response.status_code == 202

    status = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )
    job = status.json()["jobs"]["0"]
    assert job["status"] == "failed"
    assert job["metering"]["state"] == "released"


def test_tts_cancel_refunds_queued_reservation(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"idea": "Cancel queued TTS", "scripts": ["Cancel this."]},
    )
    pipeline_id = imported.json()["pipeline_id"]
    record = {
        **new_metering_record(
            "studio.tts_variant",
            1,
            f"pipeline:{pipeline_id}:tts:0:cancel-test",
        ),
        "reservation_id": "desktop:test-reservation",
        "state": "reserved",
        "mode": "desktop",
    }
    pipeline_routes._update_tts_job(
        pipeline_id,
        0,
        status="queued",
        metering=record,
    )

    response = client.post(
        f"/api/v1/pipeline/tts-cancel/{pipeline_id}",
        headers=HEADERS,
        json={"variant_indices": [0]},
    )
    assert response.status_code == 200
    assert response.json()["cancelled"] == [0]
    assert response.json()["jobs"]["0"]["metering"]["state"] == "released"


def test_duplicate_active_tts_job_is_rejected(sqlite_backend):
    client, _repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"idea": "Duplicate guard", "scripts": ["Do not enqueue twice."]},
    )
    pipeline_id = imported.json()["pipeline_id"]
    pipeline_routes._update_tts_job(
        pipeline_id,
        0,
        status="processing",
        progress=20,
        current_step="Preparing voice settings",
    )

    duplicate = client.post(
        f"/api/v1/pipeline/tts/{pipeline_id}/0",
        headers=HEADERS,
        json={},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["message"] == "Voice-over generation is already running"


def test_parallel_tts_job_writes_cannot_regress_persisted_job_map(
    sqlite_backend,
    monkeypatch,
):
    client, _repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "idea": "Persist parallel progress",
            "scripts": ["First voice-over.", "Second voice-over."],
        },
    )
    pipeline_id = imported.json()["pipeline_id"]

    first_write_entered = threading.Event()
    second_write_entered = threading.Event()
    release_first_write = threading.Event()
    call_lock = threading.Lock()
    persisted_jobs = {}
    errors = []
    call_count = 0

    def delayed_persist(
        _pipeline_id,
        *,
        generation_job=None,
        tts_jobs=None,
    ):
        nonlocal call_count
        assert generation_job is None
        with call_lock:
            call_count += 1
            call_number = call_count
        if call_number == 1:
            first_write_entered.set()
            if not release_first_write.wait(5):
                raise AssertionError("timed out waiting to release the first write")
        else:
            second_write_entered.set()
        persisted_jobs.clear()
        persisted_jobs.update(copy.deepcopy(tts_jobs or {}))

    monkeypatch.setattr(pipeline_routes, "_db_update_async_jobs", delayed_persist)

    def update_variant(index, progress):
        try:
            pipeline_routes._update_tts_job(
                pipeline_id,
                index,
                status="processing",
                progress=progress,
            )
        except Exception as exc:  # pragma: no cover - surfaced by assertion below
            errors.append(exc)

    first = threading.Thread(target=update_variant, args=(0, 20))
    second = threading.Thread(target=update_variant, args=(1, 65))
    first.start()
    assert first_write_entered.wait(5)
    second.start()

    # The second mutation must remain behind the first pipeline-state write.
    # Before the fix it overtook this write and the delayed stale snapshot then
    # replaced {0, 1} in the DB with {0}.
    assert not second_write_entered.wait(0.5)
    release_first_write.set()
    first.join(5)
    second.join(5)

    assert not first.is_alive()
    assert not second.is_alive()
    assert errors == []
    assert sorted(persisted_jobs) == [0, 1]
    assert persisted_jobs[0]["progress"] == 20
    assert persisted_jobs[1]["progress"] == 65


def test_generation_cancel_wins_after_last_worker_progress_update(
    sqlite_backend,
    monkeypatch,
):
    _client, repo, profile_id = sqlite_backend
    pipeline_id = "generation-cancel-race"
    pipeline = {
        "pipeline_id": pipeline_id,
        "profile_id": profile_id,
        "name": "Cancel race",
        "idea": "Do not let a late worker resurrect this job",
        "provider": "gemini",
        "variant_count": 1,
        "keyword_count": 0,
        "scripts": [],
        "script_names": [],
        "previews": {},
        "render_jobs": {},
        "tts_previews": {},
        "generation_job": pipeline_routes._new_async_job(),
        "tts_jobs": {},
        "created_at": pipeline_routes._job_timestamp(),
    }
    with pipeline_routes._pipelines_lock:
        pipeline_routes._pipelines[pipeline_id] = pipeline
    pipeline_routes._db_save_pipeline(pipeline_id, dict(pipeline))

    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: _FakeScriptGenerator(),
    )
    reached_final_progress = threading.Event()
    release_worker = threading.Event()
    original_update = pipeline_routes._update_generation_job

    def pause_after_final_progress(target_pipeline_id, **changes):
        result = original_update(target_pipeline_id, **changes)
        if changes.get("progress") == 90:
            reached_final_progress.set()
            if not release_worker.wait(5):
                raise AssertionError("timed out waiting to release generation worker")
        return result

    monkeypatch.setattr(
        pipeline_routes,
        "_update_generation_job",
        pause_after_final_progress,
    )
    errors = []

    def run_worker():
        try:
            asyncio.run(pipeline_routes._run_pipeline_generation_job(
                pipeline_id,
                {
                    "name": "Cancel race",
                    "idea": "Do not let a late worker resurrect this job",
                    "provider": "gemini",
                    "variant_count": 1,
                },
                profile_id,
            ))
        except Exception as exc:  # pragma: no cover - surfaced by assertion below
            errors.append(exc)

    worker = threading.Thread(target=run_worker)
    worker.start()
    assert reached_final_progress.wait(5)
    cancelled = original_update(
        pipeline_id,
        status="cancelled",
        current_step="Generation cancelled",
        completed_at=pipeline_routes._job_timestamp(),
    )
    assert cancelled["status"] == "cancelled"
    release_worker.set()
    worker.join(5)

    assert not worker.is_alive()
    assert errors == []
    assert pipeline["generation_job"]["status"] == "cancelled"
    assert pipeline["scripts"] == []
    restored = repo.get_pipeline(pipeline_id)
    assert restored["generation_job"]["status"] == "cancelled"
    assert restored["scripts"] == []


def test_cancelled_tts_job_ignores_late_completion(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"idea": "Cancel TTS race", "scripts": ["One voice-over."]},
    )
    pipeline_id = imported.json()["pipeline_id"]

    pipeline_routes._update_tts_job(
        pipeline_id,
        0,
        status="processing",
        progress=65,
    )
    cancelled = pipeline_routes._update_tts_job(
        pipeline_id,
        0,
        status="cancelled",
        current_step="Voice-over cancelled",
        completed_at=pipeline_routes._job_timestamp(),
    )
    assert cancelled["status"] == "cancelled"

    late_completion = pipeline_routes._update_tts_job(
        pipeline_id,
        0,
        status="completed",
        progress=100,
        current_step="Voice-over ready",
    )
    assert late_completion["status"] == "cancelled"
    assert repo.get_pipeline(pipeline_id)["tts_jobs"]["0"]["status"] == "cancelled"
