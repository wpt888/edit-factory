"""Tests for PUT /pipeline/{id}/matches/{variant} (F3 — persist timeline edits).

Verifies the full resume loop: save edited matches → drop the in-memory cache
(simulating a backend restart) → /restore-previews returns the EDITED timeline,
not the original auto-match.
"""
import uuid

import pytest

HEADERS = {"X-Profile-Id": "test-profile-001"}


def _match(srt_index: int, segment_id: str | None) -> dict:
    return {
        "srt_index": srt_index,
        "srt_text": f"phrase {srt_index}",
        "srt_start": srt_index * 2.0,
        "srt_end": srt_index * 2.0 + 2.0,
        "segment_id": segment_id,
        "segment_keywords": ["kw"],
        "matched_keyword": "kw" if segment_id else None,
        "confidence": 0.9 if segment_id else 0.0,
        "source_video_id": "vid-1" if segment_id else None,
        "segment_start_time": 0.0,
        "segment_end_time": 2.0,
        "merge_group": None,
        "merge_group_duration": None,
        "transforms": None,
    }


def _seed_pipeline_with_preview(repo, profile_id: str) -> str:
    pipeline_id = f"test-pipeline-{uuid.uuid4().hex[:8]}"
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "Save matches test",
        "idea": "idea",
        "scripts": ["script zero"],
        "variant_count": 1,
        "provider": "gemini",
        "context": "",
        "source_video_ids": [],
        "tts_previews": {},
        "render_jobs": {},
        "previews": {
            "0": {
                "timestamp": "2026-06-11T00:00:00+00:00",
                "preview_data": {
                    "audio_duration": 6.0,
                    "srt_content": "1\n00:00:00,000 --> 00:00:02,000\nphrase 0\n",
                    "matches": [_match(0, "seg-original")],
                    "matched_count": 1,
                    "unmatched_count": 0,
                    "available_segments": [],
                },
            }
        },
    })
    return pipeline_id


def _drop_memory_cache(pipeline_id: str):
    """Simulate a backend restart for one pipeline."""
    from app.api.pipeline_routes import _pipelines, _pipelines_lock
    with _pipelines_lock:
        _pipelines.pop(pipeline_id, None)


def test_save_matches_persists_across_restart(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = _seed_pipeline_with_preview(repo, profile_id)

    edited = [_match(0, "seg-EDITED"), _match(1, None)]
    r = client.put(
        f"/api/v1/pipeline/{pipeline_id}/matches/0",
        json={"matches": edited},
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "saved"
    assert body["match_count"] == 2

    # Simulate restart, then resume via the endpoint the frontend uses
    _drop_memory_cache(pipeline_id)
    r2 = client.get(f"/api/v1/pipeline/{pipeline_id}/restore-previews", headers=HEADERS)
    assert r2.status_code == 200, r2.text
    previews = r2.json()["previews"]
    assert "0" in previews
    restored = previews["0"]["matches"]
    assert [m["segment_id"] for m in restored] == ["seg-EDITED", None]
    assert previews["0"]["matched_count"] == 1
    assert previews["0"]["unmatched_count"] == 1


def test_restore_previews_uses_proxy_ids_for_legacy_intro_paths(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    source_video_id = str(uuid.uuid4())
    repo.create_source_video({
        "id": source_video_id,
        "filename": "legacy-intro.mov",
        "file_path": r"C:\Media\Legacy Intro.mov",
        "duration": 30.0,
        "width": 1080,
        "height": 1920,
        "file_size": 1024,
        "status": "ready",
        "profile_id": profile_id,
    })
    pipeline_id = _seed_pipeline_with_preview(repo, profile_id)
    pipeline = repo.get_pipeline(pipeline_id)
    pipeline["source_video_ids"] = [source_video_id]
    preview_data = pipeline["previews"]["0"]["preview_data"]
    preview_data["intro_offset_sec"] = 2.0
    preview_data["intro_segments"] = [{
        "source_video_path": r"c:\media\legacy intro.mov",
        "start_time": 1.0,
        "end_time": 1.5,
        "timeline_start": 0.0,
        "timeline_duration": 0.5,
    }]
    pipeline["previews"]["1"] = {
        "preview_data": {
            **preview_data,
            "intro_segments": [{
                "source_video_path": r"D:\Missing\intro.mov",
                "start_time": 0.0,
                "end_time": 0.5,
                "timeline_start": 0.0,
                "timeline_duration": 0.5,
            }],
        }
    }
    repo.upsert_pipeline(pipeline)
    _drop_memory_cache(pipeline_id)

    response = client.get(
        f"/api/v1/pipeline/{pipeline_id}/restore-previews",
        headers=HEADERS,
    )

    assert response.status_code == 200, response.text
    previews = response.json()["previews"]
    assert previews["0"]["intro_offset_sec"] == 2.0
    assert previews["0"]["intro_segments"][0]["source_video_id"] == source_video_id
    assert previews["1"]["intro_offset_sec"] == 0.0
    assert previews["1"]["intro_segments"] == []


def test_save_matches_unknown_pipeline_404(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    r = client.put(
        "/api/v1/pipeline/nonexistent-id/matches/0",
        json={"matches": [_match(0, "seg-x")]},
        headers=HEADERS,
    )
    assert r.status_code == 404


def test_save_matches_no_preview_404(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = f"test-pipeline-{uuid.uuid4().hex[:8]}"
    repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "name": "No preview",
        "idea": "idea",
        "scripts": ["s"],
        "variant_count": 1,
        "provider": "gemini",
        "context": "",
        "source_video_ids": [],
        "tts_previews": {},
        "previews": {},
        "render_jobs": {},
    })
    r = client.put(
        f"/api/v1/pipeline/{pipeline_id}/matches/0",
        json={"matches": [_match(0, "seg-x")]},
        headers=HEADERS,
    )
    assert r.status_code == 404
    assert "generate a preview first" in r.text


def test_save_matches_wrong_profile_403(sqlite_backend):
    client, repo, profile_id = sqlite_backend
    pipeline_id = _seed_pipeline_with_preview(repo, profile_id)
    r = client.put(
        f"/api/v1/pipeline/{pipeline_id}/matches/0",
        json={"matches": [_match(0, "seg-x")]},
        headers={"X-Profile-Id": "other-profile-999"},
    )
    assert r.status_code in (403, 404)
