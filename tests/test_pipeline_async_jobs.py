"""Focused coverage for persisted Step 1 and Step 2 background jobs."""

from app.api import pipeline_routes


HEADERS = {"X-Profile-Id": "test-profile-001"}


class _FakeScriptGenerator:
    def generate_scripts(self, **_kwargs):
        return [
            "First generated script.",
            "Second generated script.",
        ]


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


def test_active_generation_state_survives_memory_eviction(sqlite_backend):
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
    assert restored.json()["job"] == {
        "status": "processing",
        "progress": 35,
        "current_step": "Generating 3 script variants",
    }


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
    assert repo.get_pipeline(pipeline_id)["tts_jobs"]["0"]["status"] == "completed"

    _evict_pipeline_memory(pipeline_id)
    restored = client.get(
        f"/api/v1/pipeline/tts-status/{pipeline_id}",
        headers=HEADERS,
    )
    assert restored.status_code == 200
    assert restored.json()["jobs"]["0"]["status"] == "completed"


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
