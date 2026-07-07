"""
Self-check for the AI video-job ownership guard (phase D2, review fix).

A video job may only be polled by the profile that submitted (and paid for) it.
The active profile can change between submit and poll (X-Profile-Id is read live
on the client), so without this guard a generated clip could be filed under the
wrong profile — or another profile could read the result. Mirrors the existing
_resolve_clip_video ownership check: 404 on mismatch.

Run: pytest tests/test_video_job_ownership.py   (or: python tests/test_video_job_ownership.py)
"""
import os
import sys

import pytest
from fastapi import HTTPException

# Allow direct `python tests/test_video_job_ownership.py` (not just pytest) by
# putting the repo root on the path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.api import blipost_platform_routes as routes


def test_owner_can_poll_own_job():
    routes._video_owners.clear()
    routes._video_owners["job-a"] = "profile-1"
    routes._assert_video_owner("job-a", "profile-1")  # no raise


def test_foreign_profile_is_404():
    routes._video_owners.clear()
    routes._video_owners["job-a"] = "profile-1"
    with pytest.raises(HTTPException) as exc:
        routes._assert_video_owner("job-a", "profile-2")
    assert exc.value.status_code == 404


def test_unknown_job_passes_through():
    # No surviving owner record (e.g. after a restart): allowed — the credit was
    # already charged and we can't do better. Documented in the guard's docstring.
    routes._video_owners.clear()
    routes._assert_video_owner("job-gone-after-restart", "profile-1")  # no raise


if __name__ == "__main__":
    test_owner_can_poll_own_job()
    test_foreign_profile_is_404()
    test_unknown_job_passes_through()
    print("OK — video-job ownership guard: owner passes, foreign profile 404, unknown job allowed")
