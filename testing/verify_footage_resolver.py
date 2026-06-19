"""Standalone verification for _resolve_product_footage (Wave 4.1 / G6).

Uses a stub repo (no real DB / no media sync needed) to prove the resolver:
  - joins associations -> segments,
  - enforces profile scoping,
  - resolves source_video_id -> file_path via normalize_path,
  - skips segments whose source file is missing,
  - returns None (Ken Burns fallback) when nothing resolves.

Run: python testing/verify_footage_resolver.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.api.product_generate_routes import _resolve_product_footage  # noqa: E402
from app.repositories.models import QueryResult  # noqa: E402

PROFILE = "profile-A"
OTHER_PROFILE = "profile-B"
REAL_VIDEO = ROOT / "test_media" / "demo_source.mp4"
# Store the path WSL-style to also exercise normalize_path on Windows
WSL_VIDEO = "/mnt/c/" + str(REAL_VIDEO).replace("\\", "/").replace("C:/", "")


class StubRepo:
    """Minimal repo stand-in returning canned association/segment/source rows."""

    def __init__(self, associations, segments, source_videos):
        self._assoc = associations
        self._segs = segments
        self._srcvids = source_videos

    def table_query(self, table, op, filters=None, data=None):
        if table == "segment_product_associations":
            pid = filters.eq.get("catalog_product_id")
            rows = [a for a in self._assoc if a["catalog_product_id"] == pid]
            return QueryResult(data=rows, count=len(rows))
        if table == "editai_segments":
            ids = set(filters.in_.get("id", []))
            rows = [s for s in self._segs if s["id"] in ids]
            return QueryResult(data=rows, count=len(rows))
        raise AssertionError(f"unexpected table_query: {table}")

    def get_source_video(self, vid):
        return self._srcvids.get(vid)


def _check(name, cond):
    print(("PASS" if cond else "FAIL") + ": " + name)
    return cond


def main() -> int:
    if not REAL_VIDEO.exists():
        print(f"SKIP: demo video missing: {REAL_VIDEO}")
        return 1

    associations = [
        {"segment_id": "seg-1", "catalog_product_id": "prod-X",
         "pip_config": {"enabled": True, "position": "top-right",
                        "size": "large", "animation": "fade"}},
        {"segment_id": "seg-2", "catalog_product_id": "prod-X", "pip_config": None},
        {"segment_id": "seg-other", "catalog_product_id": "prod-X", "pip_config": None},
    ]
    segments = [
        # resolves via source video (real file)
        {"id": "seg-1", "source_video_id": "vid-1", "start_time": 2.0, "end_time": 7.0,
         "extracted_video_path": None, "profile_id": PROFILE},
        # source file missing -> skipped
        {"id": "seg-2", "source_video_id": "vid-missing", "start_time": 1.0, "end_time": 3.0,
         "extracted_video_path": None, "profile_id": PROFILE},
        # wrong profile -> skipped
        {"id": "seg-other", "source_video_id": "vid-1", "start_time": 4.0, "end_time": 6.0,
         "extracted_video_path": None, "profile_id": OTHER_PROFILE},
    ]
    source_videos = {
        "vid-1": {"id": "vid-1", "file_path": WSL_VIDEO, "profile_id": PROFILE},
        "vid-missing": {"id": "vid-missing", "file_path": "/mnt/c/nope/missing.mp4"},
    }

    repo = StubRepo(associations, segments, source_videos)

    ok = True

    # Positive case: product with a resolvable association
    plan = _resolve_product_footage(repo, "prod-X", PROFILE)
    ok &= _check("returns a plan for product with footage", plan is not None)
    if plan:
        clips = plan["clips"]
        ok &= _check("exactly 1 clip resolves (missing + wrong-profile skipped)", len(clips) == 1)
        ok &= _check("clip points at the real demo video", Path(clips[0]["path"]) == REAL_VIDEO)
        ok &= _check("clip carries trim range [2,7]",
                     clips[0]["start"] == 2.0 and clips[0]["end"] == 7.0 and clips[0]["trim"] is True)
        ok &= _check("pip_config taken from the enabled association",
                     plan["pip_config"].get("position") == "top-right")

    # Negative case: product with no associations -> None (Ken Burns fallback)
    none_plan = _resolve_product_footage(repo, "prod-NONE", PROFILE)
    ok &= _check("returns None when product has no associations", none_plan is None)

    print("\nRESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
