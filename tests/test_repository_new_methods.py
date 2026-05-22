"""Tests for the 5 new DataRepository methods added in Phase 80-01.

Covers count_clips, get_export_preset_by_name, delete_exports_older_than,
get_project_by_name, increment_segment_usage on the SQLite backend.

These tests verify the contract from PLAN 80-01 must_haves.truths:
- "All NEW ABC methods are implemented (no NotImplementedError, no `pass`-only bodies)"
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def sqlite_repo(tmp_path):
    """Construct a fresh SQLiteRepository pointed at a tmp_path data.db.

    Uses the MockSettings pattern from conftest.py:44 — set base_dir on the
    settings object so SQLiteRepository.__init__ creates {base_dir}/data.db.
    Foreign keys are enforced; tests that create projects/clips must use
    the `seed_profile` helper to ensure the referenced profile exists.
    """
    from tests.conftest import MockSettings

    settings = MockSettings(logs_dir=tmp_path / "logs", base_dir=tmp_path)
    settings.ensure_dirs()

    # Clear any cached settings / repository singleton
    from app.config import get_settings as _get_settings
    _get_settings.cache_clear()

    with patch("app.config.get_settings", return_value=settings):
        # Import fresh so the factory respects DATA_BACKEND=sqlite
        from app.repositories.sqlite_repo import SQLiteRepository
        repo = SQLiteRepository()
        yield repo
        try:
            repo._conn.close()
        except Exception:
            pass


def _seed_profile(repo, profile_id: str) -> None:
    """Insert a minimal profile row so FK constraints from clips/projects pass."""
    repo._conn.execute(
        'INSERT OR IGNORE INTO profiles (id, user_id, name) VALUES (?, ?, ?)',
        (profile_id, str(uuid.uuid4()), f"profile-{profile_id[:8]}"),
    )
    repo._conn.commit()


# ─────────────────────────────────────────────────────────────
# 1. Contract: all 5 methods exist on the ABC and are callable
# ─────────────────────────────────────────────────────────────


def test_new_abc_methods_declared_on_base():
    """The 5 new methods MUST be declared on DataRepository ABC."""
    from app.repositories.base import DataRepository

    assert hasattr(DataRepository, "count_clips"), \
        "DataRepository ABC missing count_clips"
    assert hasattr(DataRepository, "get_export_preset_by_name"), \
        "DataRepository ABC missing get_export_preset_by_name"
    assert hasattr(DataRepository, "delete_exports_older_than"), \
        "DataRepository ABC missing delete_exports_older_than"
    assert hasattr(DataRepository, "get_project_by_name"), \
        "DataRepository ABC missing get_project_by_name"
    assert hasattr(DataRepository, "increment_segment_usage"), \
        "DataRepository ABC missing increment_segment_usage"


def test_sqlite_repo_instantiates_without_abstract_error(sqlite_repo):
    """SQLiteRepository must implement all 5 new abstract methods."""
    # If any abstract is missing, the fixture would have raised TypeError
    assert sqlite_repo is not None
    for method_name in (
        "count_clips",
        "get_export_preset_by_name",
        "delete_exports_older_than",
        "get_project_by_name",
        "increment_segment_usage",
    ):
        method = getattr(sqlite_repo, method_name)
        assert callable(method), f"{method_name} is not callable"


# ─────────────────────────────────────────────────────────────
# 2. count_clips
# ─────────────────────────────────────────────────────────────


def test_count_clips_returns_zero_when_no_clips(sqlite_repo):
    profile_id = str(uuid.uuid4())
    n = sqlite_repo.count_clips(profile_id)
    assert n == 0


def test_count_clips_counts_only_matching_profile(sqlite_repo):
    from app.repositories.models import QueryFilters

    profile_a = str(uuid.uuid4())
    profile_b = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_a)
    _seed_profile(sqlite_repo, profile_b)

    # Insert a project so the FK is satisfied (not strictly needed here)
    sqlite_repo.create_project({
        "id": project_id, "profile_id": profile_a, "name": "p1",
    })

    # 3 clips for profile A (1 deleted), 2 for profile B
    for i in range(3):
        sqlite_repo.create_clip({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "profile_id": profile_a,
            "variant_index": i,
            "is_deleted": True if i == 2 else False,
        })
    for i in range(2):
        sqlite_repo.create_clip({
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "profile_id": profile_b,
            "variant_index": i,
            "is_deleted": False,
        })

    assert sqlite_repo.count_clips(profile_a) == 3
    assert sqlite_repo.count_clips(profile_b) == 2

    # With filter is_deleted=False, profile A should have 2 active clips
    active = sqlite_repo.count_clips(
        profile_a, QueryFilters(eq={"is_deleted": False})
    )
    assert active == 2


# ─────────────────────────────────────────────────────────────
# 3. get_export_preset_by_name
# ─────────────────────────────────────────────────────────────


def test_get_export_preset_by_name_returns_none_when_missing(sqlite_repo):
    result = sqlite_repo.get_export_preset_by_name("nonexistent_preset")
    assert result is None


def test_get_export_preset_by_name_returns_matching_preset(sqlite_repo):
    profile_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)
    sqlite_repo.create_export_preset({
        "id": str(uuid.uuid4()),
        "profile_id": profile_id,
        "name": "instagram_reels",
        "width": 1080,
        "height": 1920,
    })
    sqlite_repo.create_export_preset({
        "id": str(uuid.uuid4()),
        "profile_id": profile_id,
        "name": "youtube_shorts",
        "width": 1080,
        "height": 1920,
    })

    found = sqlite_repo.get_export_preset_by_name("instagram_reels")
    assert found is not None
    assert found["name"] == "instagram_reels"
    assert found["width"] == 1080


# ─────────────────────────────────────────────────────────────
# 4. delete_exports_older_than
# ─────────────────────────────────────────────────────────────


def test_delete_exports_older_than_returns_zero_when_no_matches(sqlite_repo):
    profile_id = str(uuid.uuid4())
    cutoff = datetime.now(timezone.utc).isoformat()
    n = sqlite_repo.delete_exports_older_than(profile_id, cutoff)
    assert n == 0


def test_delete_exports_older_than_deletes_only_profile_scoped_old_rows(sqlite_repo):
    """Exports lack a profile_id column natively — implementation must scope via
    clip ownership (editai_clips.profile_id) per Rule 1 bug-fix on route 2799."""
    profile_a = str(uuid.uuid4())
    profile_b = str(uuid.uuid4())
    project_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_a)
    _seed_profile(sqlite_repo, profile_b)

    sqlite_repo.create_project({
        "id": project_id, "profile_id": profile_a, "name": "p",
    })

    # Two clips: one belongs to profile_a, one to profile_b
    clip_a = str(uuid.uuid4())
    clip_b = str(uuid.uuid4())
    sqlite_repo.create_clip({
        "id": clip_a, "project_id": project_id, "profile_id": profile_a,
    })
    project_b_id = str(uuid.uuid4())
    sqlite_repo.create_project({
        "id": project_b_id, "profile_id": profile_b, "name": "p_b",
    })
    sqlite_repo.create_clip({
        "id": clip_b, "project_id": project_b_id, "profile_id": profile_b,
    })

    # Old export for profile_a (should be deleted)
    old_iso = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    recent_iso = datetime.now(timezone.utc).isoformat()
    sqlite_repo.create_export({
        "id": str(uuid.uuid4()), "clip_id": clip_a, "created_at": old_iso,
    })
    # Recent export for profile_a (kept)
    sqlite_repo.create_export({
        "id": str(uuid.uuid4()), "clip_id": clip_a, "created_at": recent_iso,
    })
    # Old export for profile_b (kept — different profile)
    sqlite_repo.create_export({
        "id": str(uuid.uuid4()), "clip_id": clip_b, "created_at": old_iso,
    })

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    n = sqlite_repo.delete_exports_older_than(profile_a, cutoff)
    assert n == 1, (
        f"Expected 1 deletion (profile A old export), got {n}. "
        "Implementation must scope by clip ownership AND respect cutoff."
    )

    # profile_b's old export must remain
    remaining = sqlite_repo._conn.execute(
        "SELECT id FROM editai_exports WHERE clip_id = ?", (clip_b,)
    ).fetchall()
    assert len(remaining) == 1


# ─────────────────────────────────────────────────────────────
# 5. get_project_by_name
# ─────────────────────────────────────────────────────────────


def test_get_project_by_name_returns_none_when_missing(sqlite_repo):
    profile_id = str(uuid.uuid4())
    assert sqlite_repo.get_project_by_name(profile_id, "Nothing") is None


def test_get_project_by_name_returns_matching_project(sqlite_repo):
    profile_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)
    sqlite_repo.create_project({
        "id": str(uuid.uuid4()),
        "profile_id": profile_id,
        "name": "Imported from disk",
    })
    sqlite_repo.create_project({
        "id": str(uuid.uuid4()),
        "profile_id": profile_id,
        "name": "Other Project",
    })

    found = sqlite_repo.get_project_by_name(profile_id, "Imported from disk")
    assert found is not None
    assert found["name"] == "Imported from disk"


def test_get_project_by_name_scopes_by_profile(sqlite_repo):
    profile_a = str(uuid.uuid4())
    profile_b = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_a)
    _seed_profile(sqlite_repo, profile_b)
    sqlite_repo.create_project({
        "id": str(uuid.uuid4()),
        "profile_id": profile_a,
        "name": "shared_name",
    })

    # profile_b looking up the same name MUST NOT find it
    assert sqlite_repo.get_project_by_name(profile_b, "shared_name") is None


# ─────────────────────────────────────────────────────────────
# 6. increment_segment_usage
# ─────────────────────────────────────────────────────────────


def test_increment_segment_usage_noop_when_empty(sqlite_repo):
    # Must not raise on empty list
    sqlite_repo.increment_segment_usage([])


def test_increment_segment_usage_increments_count_by_one(sqlite_repo):
    profile_id = str(uuid.uuid4())
    seg_id_1 = str(uuid.uuid4())
    seg_id_2 = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    # create_segment uses _insert which honors known columns; usage_count
    # may need to be ALTER-added by the impl on init.
    sqlite_repo.create_segment({
        "id": seg_id_1, "profile_id": profile_id, "label": "seg1",
    })
    sqlite_repo.create_segment({
        "id": seg_id_2, "profile_id": profile_id, "label": "seg2",
    })

    sqlite_repo.increment_segment_usage([seg_id_1, seg_id_2])
    sqlite_repo.increment_segment_usage([seg_id_1])  # seg_id_1 now used 2x

    row1 = sqlite_repo._conn.execute(
        "SELECT usage_count FROM editai_segments WHERE id = ?", (seg_id_1,)
    ).fetchone()
    row2 = sqlite_repo._conn.execute(
        "SELECT usage_count FROM editai_segments WHERE id = ?", (seg_id_2,)
    ).fetchone()
    assert row1["usage_count"] == 2
    assert row2["usage_count"] == 1


# ─────────────────────────────────────────────────────────────
# 6. get_source_video (added in Plan 80-02)
# ─────────────────────────────────────────────────────────────


def test_get_source_video_declared_on_base():
    """The new get_source_video method MUST be declared on DataRepository ABC."""
    from app.repositories.base import DataRepository

    assert hasattr(DataRepository, "get_source_video"), \
        "DataRepository ABC missing get_source_video"


def test_get_source_video_returns_none_for_missing_id(sqlite_repo):
    """get_source_video returns None when no row matches the given id."""
    missing_id = str(uuid.uuid4())
    result = sqlite_repo.get_source_video(missing_id)
    assert result is None


def test_get_source_video_returns_row_when_found(sqlite_repo):
    """get_source_video returns the full row for an existing source video."""
    profile_id = str(uuid.uuid4())
    video_id = str(uuid.uuid4())
    _seed_profile(sqlite_repo, profile_id)

    sqlite_repo.create_source_video({
        "id": video_id,
        "profile_id": profile_id,
        "filename": "test.mp4",
        "file_path": "/tmp/test.mp4",
    })

    result = sqlite_repo.get_source_video(video_id)
    assert result is not None
    assert result["id"] == video_id
    assert result["profile_id"] == profile_id
    assert result["filename"] == "test.mp4"
    assert result["file_path"] == "/tmp/test.mp4"
