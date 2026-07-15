"""Durability and ownership coverage for synchronous script regeneration."""

from app.api import pipeline_routes
from app.services.studio_metering import new_metering_record


HEADERS = {"X-Profile-Id": "test-profile-001"}


def _import_pipeline(client, script: str = "Original script.") -> str:
    response = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={
            "idea": "Meter one regenerated script",
            "scripts": [script],
            "provider": "gemini",
        },
    )
    assert response.status_code == 200
    return response.json()["pipeline_id"]


def _metering_record(
    pipeline_id: str,
    *,
    state: str,
    reservation_id: str | None,
    provider_started: bool,
) -> dict:
    return {
        **new_metering_record(
            "studio.script_pipeline",
            1,
            f"pipeline:{pipeline_id}:script-regenerate:0:durable-attempt",
        ),
        "state": state,
        "reservation_id": reservation_id,
        "provider_started": provider_started,
        "supabase_user_id": "user-regeneration-metering",
    }


def _evict_pipeline(pipeline_id: str) -> None:
    with pipeline_routes._pipelines_lock:
        pipeline_routes._pipelines.pop(pipeline_id, None)


def test_regeneration_rejects_cross_profile_pipeline_before_reserve(
    sqlite_backend,
    monkeypatch,
):
    client, _repo, _profile_id = sqlite_backend
    pipeline_id = _import_pipeline(client)
    pipeline = pipeline_routes._get_pipeline_or_load(pipeline_id)
    pipeline["profile_id"] = "another-profile"
    calls: list[str] = []

    async def reserve_must_not_run(*_args, **_kwargs):
        calls.append("reserve")
        raise AssertionError("cross-profile regeneration reached credit reservation")

    monkeypatch.setattr(
        pipeline_routes,
        "reserve_metering_record",
        reserve_must_not_run,
    )
    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda *_args: calls.append("provider"),
    )

    response = client.post(
        f"/api/v1/pipeline/regenerate-script/{pipeline_id}/0",
        headers=HEADERS,
        json={"provider": "gemini"},
    )

    assert response.status_code == 403
    assert calls == []


def test_restart_captures_regeneration_when_output_fingerprint_is_persisted(
    sqlite_backend,
    monkeypatch,
):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _import_pipeline(client)
    regenerated = "A regenerated script persisted before the backend restarted."
    record = _metering_record(
        pipeline_id,
        state="provider_started",
        reservation_id="reservation-capture-regeneration",
        provider_started=True,
    )
    repo.update_pipeline(
        pipeline_id,
        {
            "scripts": [regenerated],
            "generation_job": {
                "regenerations": {
                    "attempt-capture": {
                        "status": "persisting",
                        "variant_index": 0,
                        "created_at": "2026-07-15T10:00:00+00:00",
                        "output_fingerprint": pipeline_routes._stable_hash(regenerated),
                        "metering": record,
                    }
                }
            },
        },
    )
    _evict_pipeline(pipeline_id)
    deliveries: list[bool] = []

    async def settle(_identity, current, *, delivered, result_metadata=None, client=None):
        deliveries.append(delivered)
        assert result_metadata == {
            "studio_job_id": pipeline_id,
            "output_id": "script-0",
        }
        return {**current, "state": "captured"}

    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)

    response = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    attempt = response.json()["job"]["regenerations"]["attempt-capture"]
    assert deliveries == [True]
    assert attempt["status"] == "completed"
    assert attempt["metering"]["state"] == "captured"
    assert attempt["metering"]["output_persisted"] is True


def test_restart_refunds_regeneration_interrupted_during_provider_call(
    sqlite_backend,
    monkeypatch,
):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _import_pipeline(client)
    record = _metering_record(
        pipeline_id,
        state="provider_started",
        reservation_id="reservation-refund-regeneration",
        provider_started=True,
    )
    repo.update_pipeline(
        pipeline_id,
        {
            "generation_job": {
                "regenerations": {
                    "attempt-refund": {
                        "status": "processing",
                        "variant_index": 0,
                        "created_at": "2026-07-15T10:00:00+00:00",
                        "metering": record,
                    }
                }
            }
        },
    )
    _evict_pipeline(pipeline_id)
    deliveries: list[bool] = []

    async def settle(_identity, current, *, delivered, result_metadata=None, client=None):
        deliveries.append(delivered)
        assert result_metadata is None
        return {**current, "state": "released"}

    monkeypatch.setattr(pipeline_routes, "settle_metering_record", settle)

    response = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )

    assert response.status_code == 200
    attempt = response.json()["job"]["regenerations"]["attempt-refund"]
    assert deliveries == [False]
    assert attempt["status"] == "failed"
    assert attempt["interrupted"] is True
    assert attempt["metering"]["state"] == "released"


def test_restart_replays_lost_reserve_response_then_refunds_same_attempt(
    sqlite_backend,
    monkeypatch,
):
    client, repo, _profile_id = sqlite_backend
    pipeline_id = _import_pipeline(client)
    record = _metering_record(
        pipeline_id,
        state="pending",
        reservation_id=None,
        provider_started=False,
    )
    repo.update_pipeline(
        pipeline_id,
        {
            "generation_job": {
                "regenerations": {
                    "attempt-lost-reserve": {
                        "status": "pending",
                        "variant_index": 0,
                        "created_at": "2026-07-15T10:00:00+00:00",
                        "metering": record,
                    }
                }
            }
        },
    )
    _evict_pipeline(pipeline_id)
    events: list[tuple[str, str]] = []

    async def reserve(identity, current, *, client=None):
        assert identity.supabase_user_id == "user-regeneration-metering"
        assert current["provider_started"] is False
        events.append(("reserve", current["idempotency_key"]))
        return {
            **current,
            "state": "reserved",
            "reservation_id": "reservation-replayed-regeneration",
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
    attempt = response.json()["job"]["regenerations"]["attempt-lost-reserve"]
    assert [name for name, _key in events] == ["reserve", "refund"]
    assert events[0][1] == events[1][1] == record["idempotency_key"]
    assert attempt["metering"]["reservation_id"] == "reservation-replayed-regeneration"
    assert attempt["metering"]["state"] == "released"


def test_regeneration_history_never_evicts_unsettled_attempt(monkeypatch):
    pipeline_id = "pipeline-regeneration-history"
    unsettled = {
        "status": "failed",
        "created_at": "2026-07-01T00:00:00+00:00",
        "metering": _metering_record(
            pipeline_id,
            state="refund_pending",
            reservation_id="reservation-unsettled",
            provider_started=True,
        ),
    }
    settled = {
        f"settled-{index:02d}": {
            "status": "completed",
            "created_at": f"2026-07-{index + 2:02d}T00:00:00+00:00",
            "metering": {
                **_metering_record(
                    pipeline_id,
                    state="captured",
                    reservation_id=f"reservation-settled-{index}",
                    provider_started=True,
                ),
                "idempotency_key": f"pipeline:{pipeline_id}:settled:{index}",
            },
        }
        for index in range(21)
    }
    pipeline = {
        "pipeline_id": pipeline_id,
        "generation_job": {
            "regenerations": {"unsettled": unsettled, **settled},
        },
    }
    monkeypatch.setitem(pipeline_routes._pipelines, pipeline_id, pipeline)
    monkeypatch.setattr(
        pipeline_routes,
        "_db_update_async_jobs",
        lambda *_args, **_kwargs: None,
    )

    pipeline_routes._replace_regeneration_metering(
        pipeline_id,
        "settled-20",
        settled["settled-20"]["metering"],
    )

    attempts = pipeline["generation_job"]["regenerations"]
    assert "unsettled" in attempts
    assert attempts["unsettled"]["metering"]["state"] == "refund_pending"
    assert len(attempts) == 21
