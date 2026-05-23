"""Tests for the 2 new DataRepository methods added in Phase 82-01.

Covers get_product_group and update_product_group on the SQLite backend.

These tests verify the contract from PLAN 82-01 must_haves.truths:
- "ABC method `update_product_group(group_id, data)` exists in app/repositories/base.py
   and is implemented on both SupabaseRepository and SQLiteRepository — no
   NotImplementedError paths."
- "ABC method `get_product_group(group_id)` exists in app/repositories/base.py
   and is implemented on both SupabaseRepository and SQLiteRepository — no
   NotImplementedError paths."

Schema note: the SQLite editai_product_groups table differs from Supabase (see
ROUTES-AUDIT.md Section 7 — Schema Drift). SQLite uses `(id, profile_id, name,
description, product_ids)`; the Supabase route uses `(label, start_time,
end_time, color)`. These tests exercise the SQLite-native columns; the
Supabase backend is not tested in this file (deferred to Phase 85 smoke).
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest


@pytest.fixture
def sqlite_repo(tmp_path):
    """Construct a fresh SQLiteRepository pointed at a tmp_path data.db.

    Mirrors the pattern in tests/test_repository_new_methods.py:21 — set
    base_dir on a mocked settings object so SQLiteRepository.__init__ creates
    {base_dir}/data.db. Foreign keys are enforced; seed_profile is required
    before inserting any row referencing a profile_id.
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
    """Insert a minimal profile row so FK constraints from product_groups pass."""
    repo._conn.execute(
        'INSERT OR IGNORE INTO profiles (id, user_id, name) VALUES (?, ?, ?)',
        (profile_id, str(uuid.uuid4()), f"profile-{profile_id[:8]}"),
    )
    repo._conn.commit()


# ─────────────────────────────────────────────────────────────
# Contract: both methods exist on the ABC and are callable
# ─────────────────────────────────────────────────────────────


def test_new_abc_methods_declared_on_base():
    """The 2 new methods MUST be declared on DataRepository ABC."""
    from app.repositories.base import DataRepository

    assert hasattr(DataRepository, "get_product_group"), \
        "DataRepository ABC missing get_product_group"
    assert hasattr(DataRepository, "update_product_group"), \
        "DataRepository ABC missing update_product_group"


def test_sqlite_repo_implements_new_methods(sqlite_repo):
    """SQLiteRepository must implement both new abstract methods."""
    # If any abstract is missing, the fixture would have raised TypeError
    assert sqlite_repo is not None
    for method_name in ("get_product_group", "update_product_group"):
        method = getattr(sqlite_repo, method_name)
        assert callable(method), f"{method_name} is not callable"


# ─────────────────────────────────────────────────────────────
# get_product_group
# ─────────────────────────────────────────────────────────────


def test_get_product_group_returns_none_for_missing_id(sqlite_repo):
    """Returns None when group does not exist (mirrors get_clip / get_segment / get_source_video contract)."""
    result = sqlite_repo.get_product_group(str(uuid.uuid4()))
    assert result is None


def test_get_product_group_returns_row_for_existing_id(sqlite_repo):
    """After create_product_group, get_product_group returns the same row."""
    profile_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    group_id = str(uuid.uuid4())
    sqlite_repo.create_product_group({
        "id": group_id,
        "profile_id": profile_id,
        "name": "My Group",
        "description": "test description",
    })

    found = sqlite_repo.get_product_group(group_id)
    assert found is not None
    assert found["id"] == group_id
    assert found["profile_id"] == profile_id
    assert found["name"] == "My Group"


# ─────────────────────────────────────────────────────────────
# update_product_group
# ─────────────────────────────────────────────────────────────


def test_update_product_group_returns_updated_row(sqlite_repo):
    """After create + update, returned dict reflects new values."""
    profile_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    group_id = str(uuid.uuid4())
    sqlite_repo.create_product_group({
        "id": group_id,
        "profile_id": profile_id,
        "name": "Initial Name",
        "description": "Initial description",
    })

    updated = sqlite_repo.update_product_group(group_id, {
        "name": "Updated Name",
        "description": "Updated description",
    })

    assert updated is not None
    assert updated.get("name") == "Updated Name"
    assert updated.get("description") == "Updated description"

    # Verify persistence via get
    re_fetched = sqlite_repo.get_product_group(group_id)
    assert re_fetched["name"] == "Updated Name"
    assert re_fetched["description"] == "Updated description"


def test_update_product_group_no_op_for_missing_id(sqlite_repo):
    """Update on non-existent id returns empty dict / None / non-error result.

    Contract: consistent with update_segment / update_source_video on
    SQLite — _update returns None when no row matches (see
    sqlite_repo._update which returns _get_one_raw post-update).
    """
    result = sqlite_repo.update_product_group(str(uuid.uuid4()), {"name": "x"})
    # Either None or empty dict is acceptable per the Phase 80 / 81 precedent
    assert result is None or result == {} or (isinstance(result, dict) and not result.get("id"))
