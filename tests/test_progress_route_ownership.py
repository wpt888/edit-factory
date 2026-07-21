import asyncio

import pytest
from fastapi import HTTPException

from app.api import assembly_routes, blipost_platform_routes, blipost_render_routes
from app.api import buffer_routes, postiz_routes
from app.api.auth import ProfileContext


PROFILE_A = ProfileContext(profile_id="profile-a", user_id="user-a")
PROFILE_B = ProfileContext(profile_id="profile-b", user_id="user-b")


def test_buffer_and_postiz_progress_are_profile_scoped(monkeypatch):
    monkeypatch.setattr(buffer_routes, "_publish_progress", {})
    monkeypatch.setattr(postiz_routes, "_publish_progress", {})

    buffer_routes.update_progress("buffer-job", "private", 50, profile_id=PROFILE_A.profile_id)
    postiz_routes.update_publish_progress("postiz-job", "private", 50, profile_id=PROFILE_A.profile_id)

    assert buffer_routes.get_progress("buffer-job", PROFILE_B.profile_id) is None
    assert postiz_routes.get_publish_progress("postiz-job", PROFILE_B.profile_id) is None
    assert asyncio.run(buffer_routes.get_publish_job_progress("buffer-job", PROFILE_B))["status"] == "not_found"
    assert asyncio.run(postiz_routes.get_publish_job_progress("postiz-job", PROFILE_B))["status"] == "not_found"
    assert asyncio.run(blipost_platform_routes.publish_progress("postiz-job", PROFILE_B))["status"] == "not_found"


def test_assembly_status_hides_final_video_path_from_other_profile(monkeypatch):
    class _JobStorage:
        def get_job(self, _job_id):
            return {
                "job_type": "assembly",
                "profile_id": PROFILE_A.profile_id,
                "status": "completed",
                "final_video_path": "C:/private/profile-a.mp4",
            }

    monkeypatch.setattr(assembly_routes, "get_job_storage", lambda: _JobStorage())

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(assembly_routes.get_assembly_status("assembly-job", PROFILE_B))

    assert exc_info.value.status_code == 404


def test_runner_owner_guard_blocks_cross_profile_control(monkeypatch):
    class _Runner:
        profile_id = PROFILE_A.profile_id

    from app.services import blipost_runner

    monkeypatch.setattr(blipost_runner, "get_render_runner", lambda: _Runner())

    with pytest.raises(HTTPException) as exc_info:
        blipost_render_routes._require_runner_owner(PROFILE_B.profile_id)

    assert exc_info.value.status_code == 403
