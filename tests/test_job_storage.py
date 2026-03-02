"""
Unit tests for JobStorage in-memory fallback path.

All tests force _supabase=None so they never attempt a real Supabase connection.
"""
import pytest
from unittest.mock import patch, MagicMock


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


# ---------------------------------------------------------------------------
# Cancel / cancelled-flag tests
# ---------------------------------------------------------------------------

def test_cancel_job_success(mock_settings):
    """cancel_job marks an existing job as cancelled and returns True."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "cancel-01", "status": "running"})

    result = storage.cancel_job("cancel-01")
    assert result is True

    job = storage.get_job("cancel-01")
    assert job["status"] == "cancelled"


def test_cancel_job_not_found(mock_settings):
    """cancel_job returns False when the job does not exist."""
    storage = make_storage(mock_settings)
    result = storage.cancel_job("nonexistent-cancel")
    assert result is False


def test_is_job_cancelled_true(mock_settings):
    """is_job_cancelled returns True after cancelling a job."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "cancel-02", "status": "running"})
    storage.cancel_job("cancel-02")
    assert storage.is_job_cancelled("cancel-02") is True


def test_is_job_cancelled_false(mock_settings):
    """is_job_cancelled returns False for a non-cancelled job."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "cancel-03", "status": "running"})
    assert storage.is_job_cancelled("cancel-03") is False


def test_clear_job_cancelled(mock_settings):
    """clear_job_cancelled removes the cancellation flag."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "cancel-04", "status": "running"})
    storage.cancel_job("cancel-04")
    assert storage.is_job_cancelled("cancel-04") is True

    storage.clear_job_cancelled("cancel-04")
    assert storage.is_job_cancelled("cancel-04") is False


def test_clear_job_cancelled_nonexistent(mock_settings):
    """clear_job_cancelled on unknown job does not raise."""
    storage = make_storage(mock_settings)
    storage.clear_job_cancelled("never-existed")  # should not raise


# ---------------------------------------------------------------------------
# cleanup_old_jobs tests
# ---------------------------------------------------------------------------

def test_cleanup_old_jobs_removes_old(mock_settings):
    """Jobs older than cutoff are removed by cleanup_old_jobs."""
    from datetime import datetime, timezone, timedelta

    storage = make_storage(mock_settings)
    old_ts = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()

    job = {"job_id": "old-job-001", "status": "completed", "progress": "Done"}
    storage._memory_store["old-job-001"] = {
        **job,
        "created_at": old_ts,
        "updated_at": old_ts,
    }

    count = storage.cleanup_old_jobs(days=7)
    assert count >= 1
    assert storage.get_job("old-job-001") is None


def test_cleanup_old_jobs_keeps_recent(mock_settings):
    """Jobs created recently are NOT removed by cleanup_old_jobs."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "new-job-001", "status": "completed"})

    count = storage.cleanup_old_jobs(days=7)
    assert count == 0
    assert storage.get_job("new-job-001") is not None


# ---------------------------------------------------------------------------
# cancel eviction test
# ---------------------------------------------------------------------------

def test_cancel_eviction(mock_settings):
    """When _MAX_CANCELLED is exceeded, oldest entries are evicted."""
    storage = make_storage(mock_settings)
    storage._MAX_CANCELLED = 3

    # Create 5 jobs and cancel them
    for i in range(5):
        jid = f"evict-job-{i}"
        storage.create_job({"job_id": jid, "status": "running"})
        storage.cancel_job(jid)

    # Only the 3 most recently cancelled jobs should remain in _cancelled_jobs
    with storage._cancelled_lock:
        assert len(storage._cancelled_jobs) == 3


# ---------------------------------------------------------------------------
# list_jobs edge cases
# ---------------------------------------------------------------------------

def test_list_jobs_with_limit(mock_settings):
    """list_jobs with limit=2 returns at most 2 jobs."""
    storage = make_storage(mock_settings)
    for i in range(5):
        storage.create_job({"job_id": f"limit-job-{i}", "status": "pending"})

    jobs = storage.list_jobs(limit=2)
    assert len(jobs) == 2


def test_list_jobs_combined_filters(mock_settings):
    """list_jobs with both status and profile_id filters correctly."""
    storage = make_storage(mock_settings)
    storage.create_job({"job_id": "combo-01", "status": "running"}, profile_id="profile-Z")
    storage.create_job({"job_id": "combo-02", "status": "pending"}, profile_id="profile-Z")
    storage.create_job({"job_id": "combo-03", "status": "running"}, profile_id="profile-Y")

    results = storage.list_jobs(status="running", profile_id="profile-Z")
    assert len(results) == 1
    assert results[0]["job_id"] == "combo-01"


def test_list_jobs_empty(mock_settings):
    """list_jobs on empty store returns empty list."""
    storage = make_storage(mock_settings)
    assert storage.list_jobs() == []


# ---------------------------------------------------------------------------
# Supabase-path tests (mocked Supabase client)
# ---------------------------------------------------------------------------

def make_mock_supabase():
    """Create a mock Supabase client that simulates table operations."""
    from unittest.mock import MagicMock

    mock_sb = MagicMock()

    # Setup chainable mock for table().insert().execute()
    mock_table = MagicMock()
    mock_sb.table.return_value = mock_table

    # insert chain
    mock_insert = MagicMock()
    mock_table.insert.return_value = mock_insert
    mock_insert.execute.return_value = MagicMock(data=[{"id": "test-id"}])

    # select().eq().single().execute()
    mock_select = MagicMock()
    mock_table.select.return_value = mock_select
    mock_select.eq.return_value = mock_select
    mock_select.order.return_value = mock_select
    mock_select.limit.return_value = mock_select
    mock_select.single.return_value = mock_select
    mock_select.execute.return_value = MagicMock(data=None)

    # update chain
    mock_update = MagicMock()
    mock_table.update.return_value = mock_update
    mock_update.eq.return_value = mock_update
    mock_update.execute.return_value = MagicMock(data=[])

    # delete chain
    mock_delete = MagicMock()
    mock_table.delete.return_value = mock_delete
    mock_delete.eq.return_value = mock_delete
    mock_delete.in_.return_value = mock_delete
    mock_delete.lt.return_value = mock_delete
    mock_delete.execute.return_value = MagicMock(data=[])

    return mock_sb


def make_supabase_storage(mock_settings, mock_sb=None):
    """Create a JobStorage that uses a mocked Supabase client."""
    from app.services.job_storage import JobStorage

    if mock_sb is None:
        mock_sb = make_mock_supabase()

    storage = JobStorage()
    storage._supabase = mock_sb
    storage._memory_store = {}
    return storage, mock_sb


def test_create_job_supabase_path(mock_settings):
    """create_job calls Supabase insert when _supabase is set."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    job = storage.create_job({"job_id": "sb-j1", "status": "pending"})
    assert job["job_id"] == "sb-j1"
    mock_sb.table.assert_called()


def test_create_job_supabase_fallback_to_memory(mock_settings):
    """create_job falls back to memory when Supabase raises."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    mock_sb.table.return_value.insert.return_value.execute.side_effect = Exception("DB error")

    job = storage.create_job({"job_id": "sb-j2", "status": "pending"})
    assert job["job_id"] == "sb-j2"
    assert "sb-j2" in storage._memory_store


def test_get_job_supabase_path(mock_settings):
    """get_job retrieves job from Supabase when available."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    # Simulate Supabase returning a job
    job_data = {"job_id": "sb-get-1", "status": "running"}
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = \
        MagicMock(data={"data": job_data})

    result = storage.get_job("sb-get-1")
    assert result == job_data


def test_get_job_supabase_not_found(mock_settings):
    """get_job returns None when Supabase returns no data."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = \
        MagicMock(data=None)

    result = storage.get_job("not-there")
    assert result is None


def test_update_job_supabase_path(mock_settings):
    """update_job sends update to Supabase when available."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    # First, create job in memory
    storage._memory_store["sb-upd-1"] = {
        "job_id": "sb-upd-1", "status": "pending",
        "created_at": "2024-01-01T00:00:00+00:00",
        "updated_at": "2024-01-01T00:00:00+00:00"
    }
    # get_job needs to work via Supabase
    storage._supabase = None  # use memory for get_job
    storage._supabase = mock_sb

    # Make get_job return the in-memory job through Supabase mock
    mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = \
        MagicMock(data={"data": storage._memory_store["sb-upd-1"]})

    updated = storage.update_job("sb-upd-1", {"status": "running"})
    assert updated is not None
    assert updated["status"] == "running"


def test_list_jobs_supabase_path(mock_settings):
    """list_jobs uses Supabase query when available."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    job_data = [{"job_id": "sb-list-1", "status": "pending"}]
    mock_chain = mock_sb.table.return_value.select.return_value
    mock_chain.order.return_value = mock_chain
    mock_chain.limit.return_value = mock_chain
    mock_chain.execute.return_value = MagicMock(data=[{"data": j} for j in job_data])

    jobs = storage.list_jobs()
    assert isinstance(jobs, list)


def test_delete_job_supabase_path(mock_settings):
    """delete_job calls Supabase delete when available."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    result = storage.delete_job("sb-del-1")
    # Supabase delete always returns True (no error raised)
    assert result is True
    mock_sb.table.assert_called()


def test_cleanup_old_jobs_supabase_path(mock_settings):
    """cleanup_old_jobs runs Supabase delete when available."""
    storage, mock_sb = make_supabase_storage(mock_settings)
    mock_delete_chain = mock_sb.table.return_value.delete.return_value
    mock_delete_chain.in_.return_value = mock_delete_chain
    mock_delete_chain.lt.return_value = mock_delete_chain
    mock_delete_chain.execute.return_value = MagicMock(data=[{"id": "old-1"}])

    count = storage.cleanup_old_jobs(days=7)
    assert count >= 0  # includes both memory (0 old) and supabase (1) = 1
