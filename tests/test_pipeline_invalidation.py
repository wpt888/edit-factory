"""Regression coverage for stale pipeline outputs and Step 1 failures."""

from datetime import datetime, timedelta, timezone

from app.api import assembly_routes, buffer_routes, pipeline_routes
from app.repositories.models import QueryResult


HEADERS = {"X-Profile-Id": "test-profile-001"}


def test_script_edit_invalidates_render_and_rejects_publish(sqlite_backend, monkeypatch):
    client, repo, profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"idea": "Rendered script", "scripts": ["Original script."]},
    )
    assert imported.status_code == 200
    pipeline_id = imported.json()["pipeline_id"]

    project = repo.create_project({
        "profile_id": profile_id,
        "name": "Stale render project",
        "description": "Regression fixture",
        "status": "completed",
        "target_duration": 20,
    })
    clip = repo.create_clip({
        "project_id": project["id"],
        "profile_id": profile_id,
        "variant_index": 0,
        "variant_name": "variant_1",
        "raw_video_path": "output/original-raw.mp4",
        "final_video_path": "output/original.mp4",
        "duration": 10.0,
        "is_selected": 0,
        "is_deleted": 0,
        "final_status": "completed",
    })

    pipeline = pipeline_routes._get_pipeline_or_load(pipeline_id)
    pipeline["library_project_id"] = project["id"]
    pipeline["render_jobs"] = {
        0: {
            "status": "completed",
            "progress": 100,
            "current_step": "Render complete",
            "final_video_path": "output/original.mp4",
            "clip_id": clip["id"],
            "render_fingerprint": "a" * 32,
        }
    }
    pipeline_routes._db_save_pipeline(pipeline_id, pipeline)

    edited = client.put(
        f"/api/v1/pipeline/{pipeline_id}/scripts",
        headers=HEADERS,
        json={"scripts": ["Edited after rendering."]},
    )
    assert edited.status_code == 200

    status = client.get(f"/api/v1/pipeline/status/{pipeline_id}", headers=HEADERS)
    assert status.status_code == 200
    assert status.json()["variants"][0]["status"] == "stale"
    assert status.json()["variants"][0]["current_step"] == "Needs re-render"
    assert repo.get_clip(clip["id"])["final_status"] == "stale"

    class PublishRepository:
        def table_query(self, *_args, **_kwargs):
            return QueryResult(data=[{
                **repo.get_clip(clip["id"]),
                "editai_projects": {"profile_id": profile_id},
            }])

    monkeypatch.setattr(buffer_routes, "get_repository", lambda: PublishRepository())

    publish = client.post(
        "/api/v1/buffer/publish",
        headers=HEADERS,
        json={
            "clip_id": clip["id"],
            "caption": "Do not publish stale media",
            "channel_id": "buffer-channel",
        },
    )
    assert publish.status_code == 409
    assert "needs re-render" in publish.json()["detail"].lower()


def test_generic_step1_provider_failure_refunds_and_marks_job_failed(
    sqlite_backend,
    monkeypatch,
):
    client, repo, _profile_id = sqlite_backend

    class FailingGenerator:
        def generate_scripts(self, **_kwargs):
            raise RuntimeError("generic provider outage")

    monkeypatch.setattr(
        pipeline_routes,
        "get_script_generator_for_profile",
        lambda _profile_id: FailingGenerator(),
    )

    response = client.post(
        "/api/v1/pipeline/generate",
        headers=HEADERS,
        json={"idea": "Provider failure must terminate", "variant_count": 1},
    )
    assert response.status_code == 202
    pipeline_id = response.json()["pipeline_id"]

    status = client.get(
        f"/api/v1/pipeline/generation-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert status.status_code == 200
    job = status.json()["job"]
    assert job["status"] == "failed"
    assert job["current_step"] == "Generation failed"
    assert job["error"] == "Pipeline generation service unavailable. Please try again later."
    assert job["metering"]["state"] == "released"
    assert repo.get_pipeline(pipeline_id)["generation_job"]["status"] == "failed"


def test_pipeline_edit_extends_history_expiration(sqlite_backend):
    client, repo, _profile_id = sqlite_backend
    imported = client.post(
        "/api/v1/pipeline/import",
        headers=HEADERS,
        json={"name": "Expiring", "idea": "Retention", "scripts": ["Keep me."]},
    )
    pipeline_id = imported.json()["pipeline_id"]
    old_expiry = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    repo.update_pipeline(pipeline_id, {"expires_at": old_expiry})
    pipeline_routes._pipelines[pipeline_id]["expires_at"] = old_expiry

    renamed = client.patch(
        f"/api/v1/pipeline/{pipeline_id}/name",
        headers=HEADERS,
        json={"name": "Retention extended"},
    )

    assert renamed.status_code == 200
    refreshed = datetime.fromisoformat(repo.get_pipeline(pipeline_id)["expires_at"])
    assert refreshed > datetime.now(timezone.utc) + timedelta(days=29)


def test_assembly_job_update_extends_seven_day_expiration(monkeypatch):
    updates = {}

    class AssemblyRepository:
        def update_assembly_job(self, _job_id, data):
            updates.update(data)

    monkeypatch.setattr(assembly_routes, "get_repository", lambda: AssemblyRepository())
    assembly_routes._db_update_assembly_job(
        "assembly-job",
        {"status": "processing", "progress": 50, "current_step": "Rendering"},
    )

    refreshed = datetime.fromisoformat(updates["expires_at"])
    assert refreshed > datetime.now(timezone.utc) + timedelta(days=6, hours=23)
