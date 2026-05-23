"""Phase 83 SQLite-backend tests for background services.

Exercises the migrated code paths in:
- app/services/assembly_service.py (TTS dedup lookup via repo.list_tts_assets)
- app/core/cleanup.py (dry-run preview via repo.list_jobs)

These tests use the `sqlite_backend` fixture from tests/conftest.py:161 (Phase 80).
Unlike Phase 80/81/82 SQLite tests, there is NO FastAPI HTTP surface — tests
exercise functions directly and assert function-level postconditions.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.models import QueryFilters


# ──────────────────────────────────────────────
# Module-level autouse fixture: reset the JobStorage singleton.
#
# Rationale: app/services/job_storage.py:58 eagerly captures self._repo =
# get_repository() in JobStorage.__init__ and never re-checks. The
# sqlite_backend fixture (tests/conftest.py:161-219) calls close_repository()
# but does NOT reset the module-level _job_storage singleton at
# app/services/job_storage.py:598. If any prior test in the session already
# instantiated JobStorage against a non-SQLite repo (Supabase mock or None),
# storage.supabase inside the migrated cleanup_old_jobs returns the stale
# reference and the seeded SQLite job is invisible — count >= 1 fails.
#
# This fixture forces a fresh JobStorage on every test in this module so the
# sqlite_backend repo binding takes effect even after a stale singleton.
# ──────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_job_storage_singleton():
    """Reset JobStorage singleton before/after each test so the sqlite_backend
    repo binding takes effect even if a prior test already instantiated JobStorage."""
    import app.services.job_storage as _js_mod
    _js_mod._job_storage = None
    yield
    _js_mod._job_storage = None


# ──────────────────────────────────────────────
# Test 1: Phase 83 sqlite_backend fixture sanity check
# ──────────────────────────────────────────────

def test_sqlite_backend_fixture_loads_for_phase83(sqlite_backend):
    """Fail-loud: the fixture must yield a SQLiteRepository + a default profile."""
    _client, repo, profile_id = sqlite_backend
    assert type(repo).__name__ == "SQLiteRepository"
    assert repo.get_profile(profile_id) is not None


# ──────────────────────────────────────────────
# Tests 2-3: cleanup.py:cleanup_old_jobs(days, dry_run=True) under SQLite
# ──────────────────────────────────────────────

def test_cleanup_old_jobs_dry_run_returns_count_sqlite(sqlite_backend):
    """The dry-run preview must return an int count (>= 0) under DATA_BACKEND=sqlite,
    without raising. Verifies the typed repo.list_jobs call path works on SQLite."""
    _client, _repo, _profile_id = sqlite_backend
    from app.core.cleanup import cleanup_old_jobs

    # With no jobs seeded, dry-run should return 0
    count = cleanup_old_jobs(days=7, dry_run=True)
    assert isinstance(count, int), f"Expected int, got {type(count).__name__}"
    assert count >= 0, f"Expected count >= 0, got {count}"


def test_cleanup_old_jobs_dry_run_counts_old_terminal_jobs_sqlite(sqlite_backend):
    """Seed an old completed job, confirm the dry-run finds and counts it."""
    _client, repo, profile_id = sqlite_backend
    from app.core.cleanup import cleanup_old_jobs

    # Seed a job older than the 7-day cutoff with terminal status.
    # Schema (sqlite_schema.sql:588): id, job_type, status, progress, data, error,
    # profile_id, created_at, updated_at. Use the SAME ISO format the route uses.
    old_iso = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
    job_id = f"job-old-{uuid.uuid4().hex[:8]}"
    repo.create_job({
        "id": job_id,
        "job_type": "test",
        "status": "completed",
        "progress": 100,
        "profile_id": profile_id,
        "created_at": old_iso,
        "updated_at": old_iso,
    })

    # Also seed a "fresh" job that should NOT be counted (created_at >= cutoff)
    fresh_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    repo.create_job({
        "id": f"job-fresh-{uuid.uuid4().hex[:8]}",
        "job_type": "test",
        "status": "completed",
        "progress": 100,
        "profile_id": profile_id,
        "created_at": fresh_iso,
        "updated_at": fresh_iso,
    })

    count = cleanup_old_jobs(days=7, dry_run=True)
    assert isinstance(count, int)
    assert count >= 1, f"Expected dry-run to count the old seeded job; got {count}"


# ──────────────────────────────────────────────
# Test 4-5: assembly_service.py dedup lookup code path under SQLite
# ──────────────────────────────────────────────

def test_assembly_tts_dedup_lookup_returns_existing_mp3_path_sqlite(sqlite_backend):
    """Mirror the migrated dedup code path: repo.list_tts_assets with
    eq={'status': 'ready', 'tts_text': X} + limit=1 must return the seeded
    asset's mp3_path. This is the exact filter shape used at
    app/services/assembly_service.py:L2607-L2615 after migration."""
    _client, repo, profile_id = sqlite_backend

    # Schema (sqlite_schema.sql:487-507): id, profile_id, tts_text, mp3_path,
    # srt_path, srt_content, tts_provider, tts_model, tts_voice_id,
    # audio_duration, char_count, tts_timestamps, status, error_message.
    asset_id = f"tts-{uuid.uuid4().hex[:8]}"
    cleaned_text = "Hello world dedup test"
    mp3_rel = f"media/tts/{profile_id}/{asset_id}.mp3"
    repo.create_tts_asset({
        "id": asset_id,
        "profile_id": profile_id,
        "tts_text": cleaned_text,
        "mp3_path": mp3_rel,
        "tts_provider": "elevenlabs",
        "tts_model": "eleven_flash_v2_5",
        "tts_voice_id": "test-voice",
        "audio_duration": 1.5,
        "char_count": len(cleaned_text),
        "status": "ready",
    })

    # Exercise the exact filter shape used in assembly_service.py after Phase 83:
    result = repo.list_tts_assets(
        profile_id,
        QueryFilters(
            eq={"status": "ready", "tts_text": cleaned_text.strip()},
            limit=1,
        ),
    )

    assert result.data, "Expected at least one matching tts_asset"
    assert result.data[0].get("mp3_path") == mp3_rel, \
        f"Expected mp3_path={mp3_rel}, got {result.data[0].get('mp3_path')}"


def test_assembly_tts_dedup_lookup_returns_empty_for_missing_text_sqlite(sqlite_backend):
    """When tts_text does not match, list_tts_assets must return empty data
    (NOT raise). Verifies the empty-result handling in the migrated code path."""
    _client, repo, profile_id = sqlite_backend

    result = repo.list_tts_assets(
        profile_id,
        QueryFilters(
            eq={"status": "ready", "tts_text": "this-text-does-not-exist-in-db"},
            limit=1,
        ),
    )

    # data is List[Dict], empty when no match
    assert result.data == [] or result.data is None or len(result.data) == 0, \
        f"Expected empty data, got {result.data}"
