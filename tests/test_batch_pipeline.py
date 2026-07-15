"""Tests for POST /pipeline/batch (F6 — mass editing queue).

Script generation and the preview step are mocked (network/TTS); the test
exercises the worker loop, JobStorage persistence, status transitions,
failure isolation, and resume.
"""
import pytest
from fastapi import HTTPException

from app.services.studio_metering import MeteringIdentity, StudioMeteringBlocked

HEADERS = {"X-Profile-Id": "test-profile-001"}


@pytest.fixture(autouse=True)
def reset_batch_rate_limit():
    from app.core.rate_limit import limiter

    limiter._storage.reset()
    yield
    limiter._storage.reset()


@pytest.fixture
def batch_mocks(monkeypatch):
    """Mock the two expensive steps; record calls."""
    calls = {"scripts": [], "previews": []}

    async def fake_generate(profile_id, idea, settings):
        calls["scripts"].append(idea)
        if "FAIL_SCRIPT" in idea:
            raise RuntimeError("boom: script generation failed")
        return [f"Generated script for: {idea}"]

    async def fake_preview(pipeline_id, variant_index, profile, **kwargs):
        calls["previews"].append(pipeline_id)
        if not getattr(fake_preview, "_ok", True):
            raise RuntimeError("boom: preview failed")
        return {"ok": True}

    import app.api.batch_routes as br
    import app.api.pipeline_routes as pr
    monkeypatch.setattr(br, "_generate_scripts_for_idea", fake_generate)
    monkeypatch.setattr(pr, "preview_variant", fake_preview)
    return calls


def test_batch_processes_ideas_to_ready_for_review(sqlite_backend, batch_mocks):
    client, repo, profile_id = sqlite_backend

    r = client.post(
        "/api/v1/pipeline/batch",
        json={"ideas": ["Idea one about phones", "Idea two about coffee"]},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    batch_id = r.json()["batch_id"]
    assert r.json()["item_count"] == 2

    # TestClient runs BackgroundTasks before returning — batch already done
    s = client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS)
    assert s.status_code == 200, s.text
    body = s.json()
    assert body["status"] == "completed"
    statuses = [it["status"] for it in body["items"]]
    assert statuses == ["ready_for_review", "ready_for_review"]
    assert all(it["pipeline_id"] for it in body["items"])
    assert all(
        it["script_metering"]["operation"] == "studio.script_pipeline"
        and it["script_metering"]["state"] == "captured"
        for it in body["items"]
    )
    assert len(batch_mocks["previews"]) == 2

    # Each item produced a persisted pipeline
    for it in body["items"]:
        row = repo.get_pipeline(it["pipeline_id"])
        assert row is not None
        assert row["profile_id"] == profile_id


def test_batch_failure_is_isolated_per_item(sqlite_backend, batch_mocks):
    client, repo, profile_id = sqlite_backend

    r = client.post(
        "/api/v1/pipeline/batch",
        json={"ideas": ["Good idea", "FAIL_SCRIPT bad idea", "Another good one"]},
        headers=HEADERS,
    )
    batch_id = r.json()["batch_id"]
    body = client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS).json()
    assert body["status"] == "completed_with_errors"
    statuses = [it["status"] for it in body["items"]]
    assert statuses == ["ready_for_review", "failed", "ready_for_review"]
    assert "boom" in body["items"][1]["error"]


def test_batch_resume_reprocesses_only_unfinished(sqlite_backend, batch_mocks):
    client, repo, profile_id = sqlite_backend

    r = client.post(
        "/api/v1/pipeline/batch",
        json={"ideas": ["Good idea", "FAIL_SCRIPT flaky"]},
        headers=HEADERS,
    )
    batch_id = r.json()["batch_id"]
    failed_item = client.get(
        f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS
    ).json()["items"][1]
    assert failed_item["status"] == "failed"
    assert failed_item["script_metering"]["state"] == "released"
    failed_attempt_key = failed_item["script_metering"]["idempotency_key"]
    previews_before = len(batch_mocks["previews"])

    # The flaky idea works on retry (drop the FAIL marker effect by renaming)
    import app.api.batch_routes as br
    storage_job = br.get_job_storage().get_job(batch_id)
    items = storage_job["items"]
    items[1]["idea"] = "now fine"
    br.get_job_storage().update_job(batch_id, {"items": items})

    rr = client.post(f"/api/v1/pipeline/batch/{batch_id}/resume", headers=HEADERS)
    assert rr.status_code == 200
    assert rr.json()["resumed"] == 1

    body = client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS).json()
    assert [it["status"] for it in body["items"]] == ["ready_for_review", "ready_for_review"]
    retried_item = body["items"][1]
    assert retried_item["script_metering"]["state"] == "captured"
    assert retried_item["script_metering"]["idempotency_key"] != failed_attempt_key
    assert retried_item["script_metering_history"][-1]["state"] == "released"
    # Item 0 was already done — only 1 new preview ran
    assert len(batch_mocks["previews"]) == previews_before + 1


def test_batch_reserves_every_script_before_any_provider_starts(
    sqlite_backend,
    batch_mocks,
    monkeypatch,
):
    client, _repo, profile_id = sqlite_backend
    import app.api.batch_routes as br

    reserve_calls = 0
    refunded: list[str] = []

    async def reserve(_identity, record, *, client=None):
        nonlocal reserve_calls
        reserve_calls += 1
        if reserve_calls == 2:
            raise StudioMeteringBlocked(
                "insufficient_credits",
                "Insufficient credits",
                available_credits=0,
            )
        return {
            **record,
            "state": "reserved",
            "reservation_id": "reservation-first-item",
            "mode": "web",
        }

    async def settle(_identity, record, *, delivered, result_metadata=None, client=None):
        assert delivered is False
        refunded.append(record["idempotency_key"])
        return {**record, "state": "released"}

    monkeypatch.setattr(br, "reserve_metering_record", reserve)
    monkeypatch.setattr(br, "settle_metering_record", settle)

    response = client.post(
        "/api/v1/pipeline/batch",
        json={"ideas": ["First idea", "Second idea", "Third idea"]},
        headers=HEADERS,
    )

    assert response.status_code == 402
    assert response.json()["detail"]["code"] == "insufficient_credits"
    assert batch_mocks["scripts"] == []
    assert batch_mocks["previews"] == []
    assert len(refunded) == 1
    jobs = [
        job
        for job in br.get_job_storage().list_jobs(profile_id=profile_id, limit=20)
        if job.get("job_type") == "pipeline_batch"
    ]
    assert jobs[0]["status"] == "failed"
    states = [item["script_metering"]["state"] for item in jobs[0]["items"]]
    assert states == ["released", "denied", "denied"]


def test_batch_preserves_friendly_preview_402_on_failed_item(
    sqlite_backend,
    batch_mocks,
    monkeypatch,
):
    client, _repo, _profile_id = sqlite_backend
    import app.api.pipeline_routes as pr

    async def denied_preview(*_args, **_kwargs):
        raise HTTPException(
            status_code=402,
            detail={
                "code": "insufficient_credits",
                "message": "You do not have enough Blipost credits for this operation.",
                "billing_url": "https://blipost.com/billing",
            },
        )

    monkeypatch.setattr(pr, "preview_variant", denied_preview)

    response = client.post(
        "/api/v1/pipeline/batch",
        json={"ideas": ["Script succeeds but TTS is denied"]},
        headers=HEADERS,
    )
    assert response.status_code == 200
    batch_id = response.json()["batch_id"]

    item = client.get(
        f"/api/v1/pipeline/batch/{batch_id}",
        headers=HEADERS,
    ).json()["items"][0]
    assert item["status"] == "failed"
    assert item["status_code"] == 402
    assert "Blipost credits" in item["error"]
    assert item["error_detail"]["billing_url"] == "https://blipost.com/billing"
    assert item["script_metering"]["state"] == "captured"


@pytest.mark.parametrize(
    ("pipeline_persisted", "expected_state"),
    [(False, "released"), (True, "captured")],
)
def test_batch_status_reconciles_interrupted_script_from_durable_pipeline_id(
    sqlite_backend,
    batch_mocks,
    monkeypatch,
    pipeline_persisted,
    expected_state,
):
    client, repo, profile_id = sqlite_backend
    import app.api.batch_routes as br

    batch_id = f"batch-reconcile-{expected_state}"
    identity = MeteringIdentity("user-batch-reconcile", "person@example.com")
    item = br._new_item(batch_id, 0, "Interrupted batch idea", identity)
    item["status"] = "generating_script"
    item["script_metering"].update(
        {
            "state": "provider_started",
            "provider_started": True,
            "reservation_id": f"reservation-{expected_state}",
        }
    )
    if pipeline_persisted:
        repo.upsert_pipeline(
            {
                "id": item["pipeline_id"],
                "profile_id": profile_id,
                "name": "Persisted batch output",
                "idea": item["idea"],
                "provider": "gemini",
                "variant_count": 1,
                "keyword_count": 0,
                "scripts": ["Persisted generated script."],
            }
        )
    br.get_job_storage().create_job(
        {
            "job_id": batch_id,
            "job_type": "pipeline_batch",
            "status": "failed",
            "progress": "Server restarted",
            "items": [item],
            "settings": {},
        },
        profile_id=profile_id,
    )
    deliveries: list[bool] = []

    async def settle(_identity, record, *, delivered, result_metadata=None, client=None):
        deliveries.append(delivered)
        return {**record, "state": "captured" if delivered else "released"}

    monkeypatch.setattr(br, "settle_metering_record", settle)

    response = client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS)

    assert response.status_code == 200
    reconciled = response.json()["items"][0]
    assert deliveries == [pipeline_persisted]
    assert reconciled["script_metering"]["state"] == expected_state
    assert reconciled["status"] == "failed"


def test_batch_status_replays_lost_reserve_response_with_same_key(
    sqlite_backend,
    batch_mocks,
    monkeypatch,
):
    client, _repo, profile_id = sqlite_backend
    import app.api.batch_routes as br

    batch_id = "batch-lost-reserve-response"
    identity = MeteringIdentity("user-batch-reconcile", "person@example.com")
    item = br._new_item(batch_id, 0, "Lost reserve response", identity)
    item["status"] = "generating_script"
    idempotency_key = item["script_metering"]["idempotency_key"]
    br.get_job_storage().create_job(
        {
            "job_id": batch_id,
            "job_type": "pipeline_batch",
            "status": "failed",
            "progress": "Server restarted",
            "items": [item],
            "settings": {},
        },
        profile_id=profile_id,
    )
    events: list[tuple[str, str]] = []

    async def reserve(_identity, record, *, client=None):
        events.append(("reserve", record["idempotency_key"]))
        return {
            **record,
            "state": "reserved",
            "reservation_id": "reservation-replayed-batch",
            "replayed": True,
        }

    async def settle(_identity, record, *, delivered, result_metadata=None, client=None):
        assert delivered is False
        events.append(("refund", record["idempotency_key"]))
        return {**record, "state": "released"}

    monkeypatch.setattr(br, "reserve_metering_record", reserve)
    monkeypatch.setattr(br, "settle_metering_record", settle)

    response = client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS)

    assert response.status_code == 200
    reconciled = response.json()["items"][0]
    assert events == [("reserve", idempotency_key), ("refund", idempotency_key)]
    assert reconciled["script_metering"]["state"] == "released"
    assert reconciled["script_metering"]["reservation_id"] == "reservation-replayed-batch"


def test_batch_rejects_empty_ideas(sqlite_backend, batch_mocks):
    client, repo, profile_id = sqlite_backend
    r = client.post("/api/v1/pipeline/batch", json={"ideas": ["  ", ""]}, headers=HEADERS)
    assert r.status_code == 400


def test_batch_list_returns_recent(sqlite_backend, batch_mocks):
    client, repo, profile_id = sqlite_backend
    client.post("/api/v1/pipeline/batch", json={"ideas": ["One idea"]}, headers=HEADERS)
    r = client.get("/api/v1/pipeline/batch", headers=HEADERS)
    assert r.status_code == 200
    assert len(r.json()["batches"]) >= 1
