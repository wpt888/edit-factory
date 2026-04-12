from datetime import date, time
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
    """All platforms get the SAME variant; Instagram gets B, Facebook/TikTok get A."""
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
        start_date=date(2026, 4, 8),
        post_time=time(9, 0),
        user_timezone="UTC",
        integration_ids=["ig", "fb", "tt"],
        integrations_info=integrations_info,
        platform_times={"ig": "12:00", "fb": "18:00", "tt": "09:00"},
        jitter_minutes=0,
    )

    # 2 variants × 1 day each = 2 days, 3 platforms per day = 6 assignments
    assert plan.days_used == 2
    assert len(plan.assignments) == 6

    # Day 1 assignments (variant 0)
    day1 = [a for a in plan.assignments if a.scheduled_date == date(2026, 4, 8)]
    day1_by_platform = {a.platform_type: a for a in day1}

    # Instagram → version B, Facebook → version A, TikTok → version A
    assert day1_by_platform["instagram"].clip_id == "meta-b-0"
    assert day1_by_platform["facebook"].clip_id == "meta-a-0"
    assert day1_by_platform["tiktok"].clip_id == "meta-a-0"

    # All share the same variant_index
    assert all(a.variant_index == 0 for a in day1)

    # Day 2 assignments (variant 1)
    day2 = [a for a in plan.assignments if a.scheduled_date == date(2026, 4, 9)]
    day2_by_platform = {a.platform_type: a for a in day2}

    assert day2_by_platform["instagram"].clip_id == "meta-b-1"
    assert day2_by_platform["facebook"].clip_id == "meta-a-1"
    assert day2_by_platform["tiktok"].clip_id == "meta-a-1"
    assert all(a.variant_index == 1 for a in day2)


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
            start_date=date(2026, 4, 8),
            post_time=time(9, 0),
            user_timezone="UTC",
            integration_ids=["ig", "fb"],
            integrations_info={"ig": "instagram", "fb": "facebook"},
            platform_times={"ig": "12:00", "fb": "18:00"},
            jitter_minutes=0,
        )
    except ValueError as exc:
        assert "missing required Meta render versions" in str(exc)
        assert "missing: B" in str(exc)
    else:
        raise AssertionError("Expected build_schedule_plan to reject collections missing visual version B")


def test_build_schedule_plan_rejects_incomplete_variant_even_if_others_complete():
    """Variant 0 has both A and B, but variant 1 only has A — must reject."""
    collection_clips = {
        "project-1": [
            _clip("base-0", 0, None),
            _clip("meta-a-0", 0, "A"),
            _clip("meta-b-0", 0, "B"),
            # variant 1 is incomplete: only A, no B
            _clip("base-1", 1, None),
            _clip("meta-a-1", 1, "A"),
        ]
    }
    collection_names = {"project-1": "Project 1"}

    try:
        build_schedule_plan(
            collection_clips=collection_clips,
            collection_names=collection_names,
            start_date=date(2026, 4, 8),
            post_time=time(9, 0),
            user_timezone="UTC",
            integration_ids=["ig", "fb"],
            integrations_info={"ig": "instagram", "fb": "facebook"},
            platform_times={},
            jitter_minutes=0,
        )
    except ValueError as exc:
        assert "variant 2" in str(exc)  # variant_index 1 → display as "variant 2"
        assert "missing: B" in str(exc)
    else:
        raise AssertionError("Expected rejection for incomplete variant 1")


def test_build_schedule_plan_multi_variant_spreads_across_days():
    """5 variants in 1 collection = 5 days, all platforms same variant per day."""
    clips = []
    for vi in range(5):
        clips.append(_clip(f"base-{vi}", vi, None))
        clips.append(_clip(f"meta-a-{vi}", vi, "A"))
        clips.append(_clip(f"meta-b-{vi}", vi, "B"))

    collection_clips = {"project-1": clips}
    collection_names = {"project-1": "Project 1"}

    plan = build_schedule_plan(
        collection_clips=collection_clips,
        collection_names=collection_names,
        start_date=date(2026, 4, 8),
        post_time=time(9, 0),
        user_timezone="UTC",
        integration_ids=["ig", "fb", "tt"],
        integrations_info={"ig": "instagram", "fb": "facebook", "tt": "tiktok"},
        platform_times={},
        jitter_minutes=0,
    )

    assert plan.days_used == 5
    # 5 days × 3 platforms = 15 assignments
    assert len(plan.assignments) == 15

    # Check each day uses one variant and Instagram always gets B
    for day_idx in range(5):
        target_date = date(2026, 4, 8 + day_idx)
        day_assignments = [a for a in plan.assignments if a.scheduled_date == target_date]
        assert len(day_assignments) == 3

        # All same variant_index
        variant_indices = {a.variant_index for a in day_assignments}
        assert len(variant_indices) == 1
        assert day_idx in variant_indices

        by_platform = {a.platform_type: a for a in day_assignments}
        assert by_platform["instagram"].clip_id == f"meta-b-{day_idx}"
        assert by_platform["facebook"].clip_id == f"meta-a-{day_idx}"
        assert by_platform["tiktok"].clip_id == f"meta-a-{day_idx}"


def test_build_schedule_plan_includes_final_video_path():
    """Assignments include final_video_path from clip data."""
    collection_clips = {
        "project-1": [
            _clip("meta-a-0", 0, "A"),
            _clip("meta-b-0", 0, "B"),
        ]
    }
    collection_names = {"project-1": "Project 1"}

    plan = build_schedule_plan(
        collection_clips=collection_clips,
        collection_names=collection_names,
        start_date=date(2026, 4, 8),
        post_time=time(9, 0),
        user_timezone="UTC",
        integration_ids=["ig", "fb"],
        integrations_info={"ig": "instagram", "fb": "facebook"},
        platform_times={},
        jitter_minutes=0,
    )

    for a in plan.assignments:
        assert a.final_video_path is not None
        assert a.final_video_path.startswith("output/")


def test_build_schedule_plan_v1_includes_final_video_path():
    """V1 (no integration_ids) must also populate final_video_path."""
    collection_clips = {
        "project-1": [
            _clip("clip-0", 0, None),
            _clip("clip-1", 1, None),
        ]
    }
    collection_names = {"project-1": "Project 1"}

    plan = build_schedule_plan(
        collection_clips=collection_clips,
        collection_names=collection_names,
        start_date=date(2026, 4, 8),
        post_time=time(9, 0),
        user_timezone="UTC",
        # No integration_ids → V1 path
    )

    assert len(plan.assignments) == 2
    for a in plan.assignments:
        assert a.final_video_path is not None
        assert a.final_video_path.startswith("output/")


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
