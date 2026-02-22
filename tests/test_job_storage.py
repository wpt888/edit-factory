"""
Unit tests for JobStorage in-memory fallback path.

All tests force _supabase=None so they never attempt a real Supabase connection.
"""
import pytest
from unittest.mock import patch


def make_storage(mock_settings):
    """Helper: create a JobStorage instance in forced in-memory mode."""
    from app.services.job_storage import JobStorage
    storage = JobStorage()
    storage._supabase = None
    storage._memory_store = {}
    return storage


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def sample_job(job_id: str = "job-001", status: str = "pending", profile_id: str = None) -> dict:
    job = {
        "job_id": job_id,
        "job_type": "video_processing",
        "status": status,
        "progress": "Queued",
    }
    if profile_id:
        job["profile_id"] = profile_id
    return job


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_create_job(mock_settings):
    """create_job returns the job and stores it in _memory_store."""
    storage = make_storage(mock_settings)
    job = storage.create_job({"job_id": "j1", "status": "pending"})

    assert job["job_id"] == "j1"
    assert "created_at" in job
    assert "updated_at" in job
    assert "j1" in storage._memory_store


def test_create_job_missing_id(mock_settings):
    """create_job raises ValueError when job_id is missing."""
    storage = make_storage(mock_settings)
    with pytest.raises(ValueError, match="job_id is required"):
        storage.create_job({"status": "pending"})


def test_get_job_exists(mock_settings):
    """get_job returns previously created job."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j2", "status": "running"})

    result = storage.get_job("j2")
    assert result is not None
    assert result["job_id"] == "j2"
    assert result["status"] == "running"


def test_get_job_not_found(mock_settings):
    """get_job returns None for nonexistent ID."""
    storage = make_storage(mock_settings)
    result = storage.get_job("nonexistent-id")
    assert result is None


def test_update_job(mock_settings):
    """update_job merges fields and refreshes updated_at."""
    import time
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j3", "status": "pending"})

    original_updated_at = storage.get_job("j3")["updated_at"]
    time.sleep(0.01)  # Ensure timestamp changes

    updated = storage.update_job("j3", {"status": "running", "progress": "Processing"})

    assert updated is not None
    assert updated["status"] == "running"
    assert updated["progress"] == "Processing"
    assert updated["updated_at"] != original_updated_at


def test_update_job_not_found(mock_settings):
    """update_job returns None for nonexistent job ID."""
    storage = make_storage(mock_settings)
    result = storage.update_job("no-such-job", {"status": "done"})
    assert result is None


def test_list_jobs_all(mock_settings):
    """list_jobs returns all created jobs."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j4", "status": "pending"})
    storage.create_job({"job_id": "j5", "status": "running"})
    storage.create_job({"job_id": "j6", "status": "done"})

    jobs = storage.list_jobs()
    assert len(jobs) == 3


def test_list_jobs_filter_status(mock_settings):
    """list_jobs with status filter returns only matching jobs."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j7", "status": "pending"})
    storage.create_job({"job_id": "j8", "status": "running"})
    storage.create_job({"job_id": "j9", "status": "pending"})

    pending = storage.list_jobs(status="pending")
    assert len(pending) == 2
    assert all(j["status"] == "pending" for j in pending)

    running = storage.list_jobs(status="running")
    assert len(running) == 1
    assert running[0]["job_id"] == "j8"


def test_list_jobs_filter_profile(mock_settings):
    """list_jobs with profile_id filter returns only matching jobs."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j10", "status": "pending"}, profile_id="profile-A")
    storage.create_job({"job_id": "j11", "status": "pending"}, profile_id="profile-A")
    storage.create_job({"job_id": "j12", "status": "pending"}, profile_id="profile-B")

    profile_a_jobs = storage.list_jobs(profile_id="profile-A")
    assert len(profile_a_jobs) == 2
    assert all(j["profile_id"] == "profile-A" for j in profile_a_jobs)

    profile_b_jobs = storage.list_jobs(profile_id="profile-B")
    assert len(profile_b_jobs) == 1
    assert profile_b_jobs[0]["job_id"] == "j12"


def test_delete_job(mock_settings):
    """delete_job removes job from store and returns True."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "j13", "status": "done"})

    result = storage.delete_job("j13")
    assert result is True
    assert storage.get_job("j13") is None
    assert "j13" not in storage._memory_store


def test_delete_job_not_found(mock_settings):
    """delete_job returns False when job does not exist."""
    storage = make_storage(mock_settings)
    result = storage.delete_job("nonexistent")
    assert result is False
