"""
SQLite-mode integration tests for /api/v1/pipeline routes.

Phase 81 success criterion 3: each migrated route family from Plans 81-01/81-02
gains a pytest case asserting status code is not 503 AND no "Database not
available" error string under DATA_BACKEND=sqlite.

These tests complement the older Supabase-mocked pipeline tests (xfailed in
Plan 81-03 Task 3) by exercising the actual SQLiteRepository code path with
real (temp) DB files.

Pattern reuses tests/conftest.py:sqlite_backend (Phase 80) + the 4 seed
helpers without modification.

Route path note: pipeline_routes.py uses resource-first path conventions
(e.g. POST /render/{pipeline_id}, POST /tts/{pipeline_id}/{variant_index})
which differ from the per-resource pattern used in library_routes.py.
Paths were verified by reading the @router decorators in pipeline_routes.py
on 2026-05-23.
"""
import uuid


from tests.conftest import (
    _seed_clip,
    _seed_export_preset,
    _seed_project,
)

HEADERS = {"X-Profile-Id": "test-profile-001"}


def _assert_not_db_unavailable(r):
    """Dual gate: not 503 AND no 'Database not available' bubble through."""
    assert r.status_code != 503, f"got 503: {r.text}"
    assert "Database not available" not in r.text, (
        f"503 message bubbled through status {r.status_code}: {r.text[:200]}"
    )


def _seed_pipeline(repo, profile_id: str, **overrides) -> dict:
    """Insert a minimal editai_pipelines row via repo.upsert_pipeline (Plan 81-01 method)."""
    pipeline_id = overrides.pop("id", None) or f"test-pipeline-{uuid.uuid4().hex[:8]}"
    data = {
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": overrides.pop("name", "Test Pipeline"),
        "idea": overrides.pop("idea", "test idea"),
        "scripts": overrides.pop("scripts", ["test script"]),
        "tts_previews": overrides.pop("tts_previews", {}),
        "previews": overrides.pop("previews", {}),
        "render_jobs": overrides.pop("render_jobs", {}),
        "variant_count": overrides.pop("variant_count", 1),
        "provider": overrides.pop("provider", "gemini"),
        "context": overrides.pop("context", ""),
        "source_video_ids": overrides.pop("source_video_ids", []),
        **overrides,
    }
    return repo.upsert_pipeline(data)


# ──────────────────────────────────────────────────────────────────────────────
# Smoke
# ──────────────────────────────────────────────────────────────────────────────


def test_sqlite_backend_smoke(sqlite_backend):
    """Confirm the fixture wires SQLiteRepository and has upsert_pipeline."""
    client, repo, profile_id = sqlite_backend
    assert type(repo).__name__ == "SQLiteRepository"
    assert hasattr(repo, "upsert_pipeline"), (
        "Plan 81-01 added upsert_pipeline; sqlite_repo missing the method"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Lifecycle: list / status / delete / scripts update
# ──────────────────────────────────────────────────────────────────────────────


def test_pipeline_list_returns_non_503(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    _seed_pipeline(repo, profile_id)
    r = client.get("/api/v1/pipeline/list", headers=HEADERS)
    _assert_not_db_unavailable(r)
    assert r.status_code == 200


def test_pipeline_status_returns_non_503(sqlite_backend):
    """GET /status/{pipeline_id} — Plan 81-02 Task 4 site (recovery block)."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id)
    r = client.get(f"/api/v1/pipeline/status/{p['id']}", headers=HEADERS)
    _assert_not_db_unavailable(r)
    # 200 if loaded, 404 acceptable if seed shape doesn't fully reconstitute
    assert r.status_code in (200, 404)


def test_pipeline_delete_returns_non_503(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id)
    r = client.delete(f"/api/v1/pipeline/{p['id']}", headers=HEADERS)
    _assert_not_db_unavailable(r)
    assert r.status_code == 200


def test_pipeline_update_scripts_returns_non_503(sqlite_backend):
    """PUT /{pipeline_id}/scripts — Plan 81-01 site #12."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id)
    r = client.put(
        f"/api/v1/pipeline/{p['id']}/scripts",
        json={"scripts": ["new script 1", "new script 2"]},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    assert r.status_code in (200, 404)


def test_pipeline_script_names_are_saved_and_restored(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id, scripts=["first script", "second script"])

    update = client.patch(
        f"/api/v1/pipeline/{p['id']}/script-names",
        json={"script_names": ["Rain hook", "Product details"]},
        headers=HEADERS,
    )
    assert update.status_code == 200

    restored = client.get(
        f"/api/v1/pipeline/scripts/{p['id']}",
        headers=HEADERS,
    )
    assert restored.status_code == 200
    assert restored.json()["script_names"] == ["Rain hook", "Product details"]


# ──────────────────────────────────────────────────────────────────────────────
# TTS lifecycle: approve / adopt-library
# ──────────────────────────────────────────────────────────────────────────────


def test_pipeline_approve_tts_returns_non_503(sqlite_backend):
    """PATCH /{pipeline_id}/tts-approve/{variant_index} — Plan 81-01 site #15."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(
        repo,
        profile_id,
        tts_previews={"0": {"approved": False, "audio_duration": 1.0}},
    )
    r = client.patch(
        f"/api/v1/pipeline/{p['id']}/tts-approve/0",
        json={"approved": True},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    assert r.status_code in (200, 404, 400)


def test_pipeline_adopt_library_tts_returns_non_503(sqlite_backend):
    """POST /tts-from-library/{pipeline_id}/{variant_index} — Plan 81-01 site #17."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id)
    # Seed an editai_tts_assets row directly via repo
    asset = repo.create_tts_asset({
        "profile_id": profile_id,
        "tts_text": "hello",
        "mp3_path": "/nonexistent/audio.mp3",
        "audio_duration": 1.0,
        "status": "ready",
    })
    r = client.post(
        f"/api/v1/pipeline/tts-from-library/{p['id']}/0",
        json={"asset_id": asset["id"]},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    # 404 expected: audio file doesn't exist on disk → "TTS audio file no longer exists"
    assert r.status_code in (200, 404, 400, 403)


# ──────────────────────────────────────────────────────────────────────────────
# Render lifecycle: check-render / render / sync-to-library
# ──────────────────────────────────────────────────────────────────────────────


def test_pipeline_check_render_skip_returns_non_503(sqlite_backend):
    """POST /check-render/{pipeline_id} — Plan 81-02 Task 1 site (Pattern C)."""
    client, repo, profile_id = sqlite_backend
    project = _seed_project(repo, profile_id)
    clip = _seed_clip(repo, profile_id, project_id=project["id"])
    p = _seed_pipeline(
        repo,
        profile_id,
        render_jobs={"0": {"clip_id": clip["id"], "status": "completed"}},
    )
    r = client.post(
        f"/api/v1/pipeline/check-render/{p['id']}",
        json={"variant_indices": [0], "preset_name": "TikTok"},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    assert r.status_code in (200, 404, 400)


def test_pipeline_tts_returns_non_503(sqlite_backend, monkeypatch, tmp_path):
    """POST /tts/{pipeline_id}/{variant_index} — Plan 81-01 site #18 (list_tts_assets dedup)
    reaches repo without 503. Mocks TTS provider so no real ElevenLabs call is made."""
    client, repo, profile_id = sqlite_backend
    # Seed pipeline with scripts so the route doesn't 400 on empty scripts
    p = _seed_pipeline(repo, profile_id, scripts=["hello world test"])

    # Mock TTS provider — try multiple import paths since the wiring varies
    def _mocked_synth(self, text, *args, **kwargs):
        return (str(tmp_path / "tts.mp3"), 1.0, "1\n00:00:00,000 --> 00:00:01,000\n" + text + "\n")

    for target in [
        "app.services.tts_provider.TTSProvider.synthesize",
        "app.services.elevenlabs_tts.ElevenLabsTTS.synthesize",
        "app.services.edge_tts.EdgeTTSProvider.synthesize",
    ]:
        try:
            monkeypatch.setattr(target, _mocked_synth, raising=True)
        except (AttributeError, ImportError, ModuleNotFoundError):
            continue

    r = client.post(
        f"/api/v1/pipeline/tts/{p['id']}/0",
        json={
            "elevenlabs_model": "eleven_flash_v2_5",
            "voice_id": "test-voice",
            "words_per_subtitle": 2,
        },
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    # 200/202 happy path; 400 if TTS provider gate fails; 500 if disk/key issue.
    # The load-bearing assertion is the dual gate (not 503), which is asserted above.
    assert r.status_code in (200, 202, 400, 404, 500)


def test_pipeline_render_preview_returns_non_503(sqlite_backend, monkeypatch, tmp_path):
    """POST /render-preview/{pipeline_id}/{variant_index} — Plan 81-01/02 site
    reaches repo + segment matcher without 503. Mocks FFmpeg."""
    client, repo, profile_id = sqlite_backend
    # Provide an existing TTS audio file on disk so the route doesn't 400 on missing audio
    tts_audio = tmp_path / "fixture_tts.mp3"
    tts_audio.write_bytes(b"fake mp3 audio")
    p = _seed_pipeline(
        repo,
        profile_id,
        scripts=["hello world test"],
        tts_previews={"0": {"audio_path": str(tts_audio), "audio_duration": 1.0}},
    )

    from subprocess import CompletedProcess
    monkeypatch.setattr(
        "app.services.ffmpeg_semaphore.safe_ffmpeg_run",
        lambda cmd, timeout, label: CompletedProcess(args=cmd, returncode=0, stdout="", stderr=""),
    )

    r = client.post(
        f"/api/v1/pipeline/render-preview/{p['id']}/0",
        json={
            "match_overrides": [],
            "min_segment_duration": 3.0,
            "words_per_subtitle": 2,
        },
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    # 200/202 happy dispatch path; 400 acceptable for missing segments / business rule;
    # 500 acceptable for downstream errors. The load-bearing assertion is the dual gate.
    assert r.status_code in (200, 202, 400, 404, 500)


def test_pipeline_render_returns_non_503(sqlite_backend, monkeypatch):
    """POST /render/{pipeline_id} — reaches _save_clip_to_library (Plan 81-02 Task 2)
    without 503 or NameError on supabase_lib."""
    client, repo, profile_id = sqlite_backend
    _seed_project(repo, profile_id)
    _seed_export_preset(repo, "TikTok")
    p = _seed_pipeline(
        repo,
        profile_id,
        tts_previews={"0": {"audio_path": "/nonexistent/tts.mp3", "audio_duration": 1.0}},
    )
    # Mock FFmpeg so we don't actually try to render
    from subprocess import CompletedProcess
    monkeypatch.setattr(
        "app.services.ffmpeg_semaphore.safe_ffmpeg_run",
        lambda cmd, timeout, label: CompletedProcess(args=cmd, returncode=0, stdout="", stderr=""),
    )
    r = client.post(
        f"/api/v1/pipeline/render/{p['id']}",
        json={"variant_indices": [0], "preset_name": "TikTok"},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    # 200 if dispatch happens, 400 if missing TTS audio, 500 if disk fails, 404 if pipeline not loaded
    assert r.status_code in (200, 202, 404, 400, 500)


def test_pipeline_sync_to_library_returns_non_503(sqlite_backend):
    """POST /sync-to-library/{pipeline_id} — Plan 81-02 Task 3 site (fat function,
    11 supabase ride-alongs migrated as a unit)."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(
        repo,
        profile_id,
        render_jobs={
            "0": {
                "clip_id": None,
                "status": "completed",
                "final_video_path": "/nonexistent/v0.mp4",
                "library_saved": False,
            }
        },
    )
    r = client.post(f"/api/v1/pipeline/sync-to-library/{p['id']}", headers=HEADERS)
    _assert_not_db_unavailable(r)
    # 200 if sync proceeded; 404 if pipeline not in cache; 400 if no completed jobs
    # 500 acceptable for downstream errors (file missing) — not 503
    assert r.status_code in (200, 404, 400, 500)


# ──────────────────────────────────────────────────────────────────────────────
# Caption surfaces (saved selection + templates)
# ──────────────────────────────────────────────────────────────────────────────


def test_pipeline_save_selected_captions_returns_non_503(sqlite_backend):
    """POST /selected-captions — Plan 81-01 site #24 (table_query upsert)."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(repo, profile_id)
    r = client.post(
        "/api/v1/pipeline/selected-captions",
        json={"pipeline_id": p["id"], "selected_captions": {"0": "chosen caption"}},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    assert r.status_code in (200, 404, 400)


def test_pipeline_video_caption_templates_list_returns_non_503(sqlite_backend):
    """GET /video-caption-templates — uses table_query (Plan 81-01 site)."""
    client, _, _ = sqlite_backend
    r = client.get("/api/v1/pipeline/video-caption-templates", headers=HEADERS)
    _assert_not_db_unavailable(r)
    assert r.status_code == 200


def test_pipeline_video_caption_templates_create_returns_non_503(sqlite_backend):
    """POST /video-caption-templates — uses table_query insert (Plan 81-01 site).
    Plan 81-02 cleanup left the dead `if not repo: 503` guard removed."""
    client, _, _ = sqlite_backend
    r = client.post(
        "/api/v1/pipeline/video-caption-templates",
        json={"name": "test template", "prompt_template": "test content"},
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    assert r.status_code in (200, 201)


# ──────────────────────────────────────────────────────────────────────────────
# Frame preview (subtitle-frame-preview — Plan 81-01 site)
# ──────────────────────────────────────────────────────────────────────────────


def test_pipeline_subtitle_frame_preview_returns_non_503(sqlite_backend):
    """POST /subtitle-frame-preview/{pipeline_id}/{variant_index} —
    uses repo.table_query for editai_source_videos lookup (Plan 81-01 site)."""
    client, repo, profile_id = sqlite_backend
    p = _seed_pipeline(
        repo,
        profile_id,
        source_video_ids=["nonexistent-source-id"],
    )
    r = client.post(
        f"/api/v1/pipeline/subtitle-frame-preview/{p['id']}/0",
        json={
            "subtitle_settings": {"fontFamily": "Anton", "fontSize": 54},
            "timestamp": 2.0,
            "sample_text": "test text",
            "include_subtitles": True,
        },
        headers=HEADERS,
    )
    _assert_not_db_unavailable(r)
    # 400 expected — source video not on disk (the database lookup succeeded,
    # which is what the dual gate cares about). Not 503.
    assert r.status_code in (200, 400, 404, 500)
