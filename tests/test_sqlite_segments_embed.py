"""SQLite list_segments must emulate the Supabase embedded source-video join.

assembly_service and library available-segments read
seg["editai_source_videos"]["file_path"]; without the emulated join every
segment looked path-less under SQLite ("No usable segments found").
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.repositories.supabase_repo import SupabaseRepository


def test_list_segments_attaches_source_video_embed(sqlite_backend):
    client, repo, profile_id = sqlite_backend

    video_id = str(uuid.uuid4())
    repo.create_source_video({
        "id": video_id,
        "profile_id": profile_id,
        "name": "Embed Test Video",
        "file_path": "C:/videos/embed-test.mp4",
        "duration": 30.0,
        "status": "ready",
    })
    seg_id = str(uuid.uuid4())
    repo.create_segment({
        "id": seg_id,
        "source_video_id": video_id,
        "profile_id": profile_id,
        "start_time": 0.0,
        "end_time": 5.0,
        "keywords": ["alpha", "beta"],
    })

    result = repo.list_segments(profile_id)
    seg = next(s for s in result.data if s["id"] == seg_id)

    embed = seg.get("editai_source_videos")
    assert embed is not None, "embedded source video dict missing"
    assert embed["file_path"] == "C:/videos/embed-test.mp4"
    assert embed["name"] == "Embed Test Video"
    assert embed["duration"] == 30.0
    # JSON columns round-trip as Python lists
    assert seg["keywords"] == ["alpha", "beta"]


def test_list_segments_defaults_to_created_at_order(sqlite_backend):
    _client, repo, profile_id = sqlite_backend

    video_id = str(uuid.uuid4())
    repo.create_source_video({
        "id": video_id,
        "profile_id": profile_id,
        "name": "Ordering Test Video",
        "file_path": "C:/videos/ordering-test.mp4",
        "status": "ready",
    })

    now = datetime.now(timezone.utc)
    newer_id = str(uuid.uuid4())
    older_id = str(uuid.uuid4())
    # Insert in the opposite order so insertion order cannot satisfy the test.
    for segment_id, created_at in (
        (newer_id, now.isoformat()),
        (older_id, (now - timedelta(days=1)).isoformat()),
    ):
        repo.create_segment({
            "id": segment_id,
            "source_video_id": video_id,
            "profile_id": profile_id,
            "start_time": 0.0,
            "end_time": 1.0,
            "created_at": created_at,
        })

    ids = [row["id"] for row in repo.list_segments(profile_id).data]
    assert ids.index(older_id) < ids.index(newer_id)


def test_supabase_list_segments_uses_real_default_order_column(monkeypatch):
    class Query:
        def __init__(self):
            self.order_columns = []

        def select(self, _columns):
            return self

        def eq(self, _column, _value):
            return self

        def order(self, column, **_kwargs):
            self.order_columns.append(column)
            return self

        def execute(self):
            return type("Response", (), {"data": []})()

    query = Query()

    class Supabase:
        def table(self, table_name):
            assert table_name == "editai_segments"
            return query

    monkeypatch.setattr(
        "app.repositories.supabase_repo.get_supabase",
        lambda: Supabase(),
    )

    SupabaseRepository().list_segments("profile-1")

    assert query.order_columns == ["created_at"]
