from unittest.mock import patch

from app.api.schedule_routes import _fetch_collection_clips
from app.services.schedule_service import build_schedule_plan


def _clip(
    clip_id: str,
    variant_index: int,
    visual_version: str | None = None,
    project_id: str = "project-1",
    variant_name: str | None = None,
):
    return {
        "id": clip_id,
        "project_id": project_id,
        "variant_index": variant_index,
        "variant_name": variant_name or f"Variant {variant_index + 1}{f' {visual_version}' if visual_version else ''}",
        "visual_version": visual_version,
        "thumbnail_path": None,
        "duration": 12.5,
        "final_video_path": f"output/{clip_id}.mp4",
        "final_status": "completed",
        "postiz_status": None,
        "is_deleted": False,
    }


def test_build_schedule_plan_routes_meta_platforms_to_visual_versions():
    collection_clips = {
        "project-1": [
            _clip("base-0", 0, None),
            _clip("meta-a-0", 0, "A"),
            _clip("meta-b-0", 0, "B"),
            _clip("base-1", 1, None),
            _clip("meta-a-1", 1, "A"),
            _clip("meta-b-1", 1, "B"),
        ]
    }
    collection_names = {"project-1": "Project 1"}
    integrations_info = {
        "ig": "instagram",
        "fb": "facebook",
        "tt": "tiktok",
    }

    plan = build_schedule_plan(
        collection_clips=collection_clips,
        collection_names=collection_names,
        start_date=__import__("datetime").date(2026, 4, 8),
        post_time=__import__("datetime").time(9, 0),
        user_timezone="UTC",
        integration_ids=["ig", "fb", "tt"],
        integrations_info=integrations_info,
        platform_times={"ig": "12:00", "fb": "18:00", "tt": "09:00"},
        jitter_minutes=0,
    )

    assignments_by_platform = {assignment.platform_type: assignment for assignment in plan.assignments}

    assert assignments_by_platform["instagram"].clip_id.startswith("meta-a-")
    assert assignments_by_platform["facebook"].clip_id.startswith("meta-b-")
    assert assignments_by_platform["tiktok"].clip_id.startswith("base-")
    assert assignments_by_platform["instagram"].clip_id != assignments_by_platform["facebook"].clip_id


def test_build_schedule_plan_rejects_missing_required_meta_visual_versions():
    collection_clips = {
        "project-1": [
            _clip("base-0", 0, None),
            _clip("meta-a-0", 0, "A"),
        ]
    }
    collection_names = {"project-1": "Project 1"}

    try:
        build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=__import__("datetime").date(2026, 4, 8),
            post_time=__import__("datetime").time(9, 0),
            user_timezone="UTC",
            integration_ids=["ig", "fb"],
            integrations_info={"ig": "instagram", "fb": "facebook"},
            platform_times={"ig": "12:00", "fb": "18:00"},
            jitter_minutes=0,
        )
    except ValueError as exc:
        assert "missing required Meta render versions" in str(exc)
        assert "missing visual versions: B" in str(exc)
    else:
        raise AssertionError("Expected build_schedule_plan to reject collections missing visual version B")


class _RepoStub:
    def __init__(self, projects, clips):
        self.projects = projects
        self.clips = clips

    def table_query(self, table, action, filters=None, data=None):
        if table == "editai_projects":
            return type("Result", (), {"data": self.projects})()
        if table == "editai_clips":
            return type("Result", (), {"data": self.clips})()
        raise AssertionError(f"Unexpected table query: {table} {action}")


def test_fetch_collection_clips_expands_selected_variant_to_meta_renders():
    projects = [{"id": "project-1", "name": "Project 1"}]
    clips = [
        _clip("base-0", 0, None),
        _clip("meta-a-0", 0, "A"),
        _clip("meta-b-0", 0, "B"),
        _clip("base-1", 1, None),
    ]

    with patch("app.api.schedule_routes.get_repository", return_value=_RepoStub(projects, clips)):
        collection_clips, collection_names = _fetch_collection_clips(
            ["project-1"],
            "profile-1",
            clip_ids=["base-0"],
        )

    returned_ids = {clip["id"] for clip in collection_clips["project-1"]}

    assert collection_names == {"project-1": "Project 1"}
    assert returned_ids == {"base-0", "meta-a-0", "meta-b-0"}
