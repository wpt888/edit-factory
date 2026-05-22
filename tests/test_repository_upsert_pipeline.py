"""Tests for the new DataRepository.upsert_pipeline method added in Phase 81-01.

Covers `upsert_pipeline` on the SQLite backend (primary v13 path).
The Supabase backend's `upsert_pipeline` delegates to PostgREST native upsert
and is exercised by integration tests / production calls.

These tests verify the contract from PLAN 81-01 must_haves.truths:
- "New ABC method(s) added to DataRepository required to migrate Pattern B
   aggregate/upsert patterns (at minimum `upsert_pipeline(data)` for the
   `_db_save_pipeline` upsert)"
- "Both backends are callable and don't raise NotImplementedError"
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest


@pytest.fixture
def sqlite_repo(tmp_path):
    """Construct a fresh SQLiteRepository pointed at a tmp_path data.db.

    Mirrors the fixture in test_repository_new_methods.py.
    """
    from tests.conftest import MockSettings

    settings = MockSettings(logs_dir=tmp_path / "logs", base_dir=tmp_path)
    settings.ensure_dirs()

    from app.config import get_settings as _get_settings
    _get_settings.cache_clear()

    with patch("app.config.get_settings", return_value=settings):
        from app.repositories.sqlite_repo import SQLiteRepository
        repo = SQLiteRepository()
        yield repo
        try:
            repo._conn.close()
        except Exception:
            pass


def _seed_profile(repo, profile_id: str) -> None:
    """Insert a minimal profile row so FK constraints from pipelines pass."""
    repo._conn.execute(
        'INSERT OR IGNORE INTO profiles (id, user_id, name) VALUES (?, ?, ?)',
        (profile_id, str(uuid.uuid4()), f"profile-{profile_id[:8]}"),
    )
    repo._conn.commit()


# ─────────────────────────────────────────────────────────────
# 1. Contract: upsert_pipeline exists on the ABC and on both impls
# ─────────────────────────────────────────────────────────────


def test_upsert_pipeline_declared_on_base():
    """DataRepository ABC must declare upsert_pipeline."""
    from app.repositories.base import DataRepository

    assert hasattr(DataRepository, "upsert_pipeline"), \
        "DataRepository ABC missing upsert_pipeline"


def test_sqlite_repo_has_upsert_pipeline(sqlite_repo):
    """SQLiteRepository must implement upsert_pipeline."""
    assert hasattr(sqlite_repo, "upsert_pipeline")
    assert callable(sqlite_repo.upsert_pipeline)


def test_supabase_repo_has_upsert_pipeline():
    """SupabaseRepository must declare upsert_pipeline (impl not invoked here)."""
    from app.repositories.supabase_repo import SupabaseRepository

    assert hasattr(SupabaseRepository, "upsert_pipeline"), \
        "SupabaseRepository missing upsert_pipeline"


# ─────────────────────────────────────────────────────────────
# 2. upsert_pipeline behavior — INSERT path
# ─────────────────────────────────────────────────────────────


def test_upsert_pipeline_inserts_when_id_does_not_exist(sqlite_repo):
    """When data['id'] doesn't exist, upsert_pipeline INSERTs the row."""
    profile_id = str(uuid.uuid4())
    pipeline_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    data = {
        "id": pipeline_id,
        "profile_id": profile_id,
        "status": "draft",
        "scripts": [{"text": "hello"}],
    }
    result = sqlite_repo.upsert_pipeline(data)

    assert result is not None
    assert result.get("id") == pipeline_id
    assert result.get("status") == "draft"

    # Verify it's actually persisted
    fetched = sqlite_repo.get_pipeline(pipeline_id)
    assert fetched is not None
    assert fetched["id"] == pipeline_id
    assert fetched["status"] == "draft"


# ─────────────────────────────────────────────────────────────
# 3. upsert_pipeline behavior — UPDATE path
# ─────────────────────────────────────────────────────────────


def test_upsert_pipeline_updates_when_id_already_exists(sqlite_repo):
    """When data['id'] exists, upsert_pipeline UPDATEs the existing row."""
    profile_id = str(uuid.uuid4())
    pipeline_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    # First insert
    sqlite_repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "status": "draft",
    })

    # Second upsert with same id should update
    sqlite_repo.upsert_pipeline({
        "id": pipeline_id,
        "profile_id": profile_id,
        "status": "completed",
    })

    fetched = sqlite_repo.get_pipeline(pipeline_id)
    assert fetched is not None
    assert fetched["status"] == "completed", \
        "upsert_pipeline must UPDATE existing row when id already present"

    # Confirm we still have only one row (no duplicate insert)
    count_row = sqlite_repo._conn.execute(
        'SELECT COUNT(*) AS cnt FROM editai_pipelines WHERE id = ?',
        (pipeline_id,),
    ).fetchone()
    assert count_row["cnt"] == 1, \
        "upsert_pipeline must not insert a duplicate row on re-upsert"


# ─────────────────────────────────────────────────────────────
# 4. upsert_pipeline returns dict with persisted fields
# ─────────────────────────────────────────────────────────────


def test_upsert_pipeline_returns_dict_with_all_fields(sqlite_repo):
    """Return value is a dict containing the persisted row fields."""
    profile_id = str(uuid.uuid4())
    pipeline_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    data = {
        "id": pipeline_id,
        "profile_id": profile_id,
        "status": "draft",
        "tts_previews": {"v1": "audio.mp3"},
    }
    result = sqlite_repo.upsert_pipeline(data)

    assert isinstance(result, dict)
    assert result["id"] == pipeline_id
    assert result["profile_id"] == profile_id
    # JSON columns should round-trip
    tts_previews = result.get("tts_previews")
    if isinstance(tts_previews, str):
        # SQLite may store JSON as string
        import json
        tts_previews = json.loads(tts_previews)
    assert tts_previews == {"v1": "audio.mp3"}
