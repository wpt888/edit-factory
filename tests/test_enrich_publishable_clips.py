"""Unit check for _enrich_publishable_clips grouping (Smart Schedule collection counts)."""
from types import SimpleNamespace

from app.api.library_routes import _enrich_publishable_clips


class _StubRepo:
    """Returns a fixed clip set regardless of filters; enough to test grouping."""
    def __init__(self, clips):
        self._clips = clips

    def table_query(self, table, op, filters=None):
        return SimpleNamespace(data=self._clips)


def test_counts_and_first_thumbnail():
    repo = _StubRepo([
        {"project_id": "a", "thumbnail_path": None},
        {"project_id": "a", "thumbnail_path": "a1.jpg"},   # first non-null wins
        {"project_id": "a", "thumbnail_path": "a2.jpg"},
        {"project_id": "b", "thumbnail_path": "b1.jpg"},
    ])
    projects = [{"id": "a"}, {"id": "b"}, {"id": "c"}]  # c has no clips
    _enrich_publishable_clips(repo, projects)

    by_id = {p["id"]: p for p in projects}
    assert by_id["a"]["publishable_clip_count"] == 3
    assert by_id["a"]["thumbnail_path"] == "a1.jpg"
    assert by_id["b"]["publishable_clip_count"] == 1
    assert by_id["c"]["publishable_clip_count"] == 0
    assert by_id["c"]["thumbnail_path"] is None


if __name__ == "__main__":
    test_counts_and_first_thumbnail()
    print("OK")
