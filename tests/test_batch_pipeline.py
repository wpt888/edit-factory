"""Tests for POST /pipeline/batch (F6 — mass editing queue).

Script generation and the preview step are mocked (network/TTS); the test
exercises the worker loop, JobStorage persistence, status transitions,
failure isolation, and resume.
"""
import pytest

HEADERS = {"X-Profile-Id": "test-profile-001"}


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
    assert client.get(f"/api/v1/pipeline/batch/{batch_id}", headers=HEADERS).json()["items"][1]["status"] == "failed"
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
    # Item 0 was already done — only 1 new preview ran
    assert len(batch_mocks["previews"]) == previews_before + 1


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
