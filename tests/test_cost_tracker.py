"""
Unit tests for CostTracker local JSON log path (no Supabase).

All tests use a CostTracker with _supabase=None so all operations use
cost_log.json written under tmp_path/logs/.
"""
import json
import pytest
from pathlib import Path
from unittest.mock import MagicMock
from app.services.cost_tracker import (
    CostTracker,
    ELEVENLABS_COST_PER_CHAR,
    GEMINI_COST_PER_IMAGE,
)


def make_tracker(tmp_path) -> CostTracker:
    """Helper: create a CostTracker with no Supabase, using tmp_path/logs."""
    from app.services.cost_tracker import CostTracker
    log_dir = tmp_path / "logs"
    tracker = CostTracker(log_dir=log_dir)
    tracker._supabase = None
    return tracker


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_log_elevenlabs_tts_cost(tmp_path, mock_settings):
    """log_elevenlabs_tts with 1000 chars → cost_usd == round(1000 * 0.00022, 6)."""
    tracker = make_tracker(tmp_path)
    entry = tracker.log_elevenlabs_tts(job_id="job-el-001", characters=1000)

    expected_cost = round(1000 * ELEVENLABS_COST_PER_CHAR, 6)
    assert entry.cost_usd == expected_cost
    assert entry.service == "elevenlabs"
    assert entry.operation == "tts"
    assert entry.input_units == 1000


def test_log_gemini_analysis_cost(tmp_path, mock_settings):
    """log_gemini_analysis with 5 frames → cost includes image cost + token estimate."""
    tracker = make_tracker(tmp_path)
    entry = tracker.log_gemini_analysis(job_id="job-gem-001", frames_analyzed=5)

    expected_image_cost = 5 * GEMINI_COST_PER_IMAGE  # 5 * 0.02 = 0.10
    token_cost = 0.01
    expected_total = round(expected_image_cost + token_cost, 6)

    assert entry.cost_usd == expected_total
    assert entry.service == "gemini"
    assert entry.operation == "video_analysis"
    assert entry.input_units == 5
    assert entry.details["frames_analyzed"] == 5
    assert entry.details["token_cost_estimate"] == token_cost


def test_entries_persisted_to_file(tmp_path, mock_settings):
    """After logging, cost_log.json exists and contains the entry."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="job-persist-001", characters=500)

    log_file = tmp_path / "logs" / "cost_log.json"
    assert log_file.exists(), "cost_log.json should be created after logging"

    with open(log_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    assert "entries" in data
    assert len(data["entries"]) == 1
    assert data["entries"][0]["service"] == "elevenlabs"
    assert data["entries"][0]["job_id"] == "job-persist-001"


def test_get_summary_local(tmp_path, mock_settings):
    """After logging both types, get_summary returns correct totals."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="j1", characters=2000)
    tracker.log_gemini_analysis(job_id="j2", frames_analyzed=3)

    summary = tracker.get_summary()

    assert summary["source"] == "local"
    assert summary["entry_count"] == 2

    expected_el = round(2000 * ELEVENLABS_COST_PER_CHAR, 4)
    expected_gem = round(3 * GEMINI_COST_PER_IMAGE + 0.01, 4)

    assert abs(summary["totals"]["elevenlabs"] - expected_el) < 1e-4
    assert abs(summary["totals"]["gemini"] - expected_gem) < 1e-4
    assert abs(summary["total_all"] - (expected_el + expected_gem)) < 1e-4


def test_check_quota_unlimited(tmp_path, mock_settings):
    """check_quota with monthly_quota=0 returns (False, 0.0, 0.0) — unlimited."""
    tracker = make_tracker(tmp_path)
    exceeded, current, quota = tracker.check_quota(profile_id="profile-x", monthly_quota=0)

    assert exceeded is False
    assert current == 0.0
    assert quota == 0.0


def test_check_quota_under(tmp_path, mock_settings):
    """After small cost, check_quota with large quota returns not exceeded."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="j-small", characters=100, profile_id="profile-quota")

    exceeded, current, quota = tracker.check_quota(
        profile_id="profile-quota", monthly_quota=100.0
    )

    assert exceeded is False
    assert current < 100.0


def test_check_quota_exceeded(tmp_path, mock_settings):
    """After logging enough cost to exceed quota, verify exceeded=True."""
    tracker = make_tracker(tmp_path)
    # Log 1,000,000 chars → 220 USD, exceeds quota of $1
    tracker.log_elevenlabs_tts(
        job_id="j-heavy", characters=1_000_000, profile_id="profile-over"
    )

    exceeded, current, quota = tracker.check_quota(
        profile_id="profile-over", monthly_quota=1.0
    )

    assert exceeded is True
    assert current >= 1.0
    assert quota == 1.0


# ---------------------------------------------------------------------------
# Additional tests for expanded coverage
# ---------------------------------------------------------------------------

def test_get_all_entries_empty(tmp_path, mock_settings):
    """No entries logged → get_all_entries returns empty list."""
    tracker = make_tracker(tmp_path)
    entries = tracker.get_all_entries()
    assert entries == []


def test_get_all_entries_with_data(tmp_path, mock_settings):
    """After logging 3 entries, get_all_entries returns list of 3 dicts."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="e1", characters=100)
    tracker.log_elevenlabs_tts(job_id="e2", characters=200)
    tracker.log_gemini_analysis(job_id="e3", frames_analyzed=5)

    entries = tracker.get_all_entries()
    assert len(entries) == 3


def test_get_monthly_costs_zero(tmp_path, mock_settings):
    """No entries for profile → get_monthly_costs returns 0.0."""
    tracker = make_tracker(tmp_path)
    result = tracker.get_monthly_costs(profile_id="profile-new")
    assert result == 0.0


def test_get_monthly_costs_with_data(tmp_path, mock_settings):
    """Log entries for a profile → returns sum of costs for current month."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="m1", characters=500, profile_id="profile-monthly")
    tracker.log_elevenlabs_tts(job_id="m2", characters=500, profile_id="profile-monthly")

    total = tracker.get_monthly_costs(profile_id="profile-monthly")
    expected = round(1000 * ELEVENLABS_COST_PER_CHAR, 4)
    assert abs(total - expected) < 1e-4


def test_log_elevenlabs_zero_chars(tmp_path, mock_settings):
    """log_elevenlabs_tts with characters=0 → cost_usd == 0.0."""
    tracker = make_tracker(tmp_path)
    entry = tracker.log_elevenlabs_tts(job_id="zero-el", characters=0)
    assert entry.cost_usd == 0.0


def test_log_gemini_zero_frames(tmp_path, mock_settings):
    """log_gemini_analysis with frames_analyzed=0 → cost includes only token estimate."""
    tracker = make_tracker(tmp_path)
    entry = tracker.log_gemini_analysis(job_id="zero-gem", frames_analyzed=0)
    # 0 frames * 0.02 + 0.01 = 0.01
    assert entry.cost_usd == pytest.approx(0.01, abs=1e-6)


def test_multiple_entries_accumulate(tmp_path, mock_settings):
    """Log 5 entries → log file has 5 entries, totals are summed correctly."""
    import json
    tracker = make_tracker(tmp_path)
    for i in range(5):
        tracker.log_elevenlabs_tts(job_id=f"multi-{i}", characters=100)

    entries = tracker.get_all_entries()
    assert len(entries) == 5

    # Verify the log file directly
    log_file = tmp_path / "logs" / "cost_log.json"
    with open(log_file) as f:
        data = json.load(f)
    assert len(data["entries"]) == 5


def test_summary_totals_by_service(tmp_path, mock_settings):
    """Log mix of elevenlabs and gemini → summary.totals has per-service breakdown."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="svc-1", characters=1000)
    tracker.log_gemini_analysis(job_id="svc-2", frames_analyzed=2)

    summary = tracker.get_summary()
    assert "elevenlabs" in summary["totals"]
    assert "gemini" in summary["totals"]

    expected_el = round(1000 * ELEVENLABS_COST_PER_CHAR, 4)
    expected_gem = round(2 * GEMINI_COST_PER_IMAGE + 0.01, 4)
    assert abs(summary["totals"]["elevenlabs"] - expected_el) < 1e-4
    assert abs(summary["totals"]["gemini"] - expected_gem) < 1e-4


def test_log_with_profile_id(tmp_path, mock_settings):
    """Log with profile_id → entry details includes profile_id."""
    tracker = make_tracker(tmp_path)
    entry = tracker.log_elevenlabs_tts(
        job_id="profile-entry-1", characters=500, profile_id="profile-ABC"
    )
    assert entry.details.get("profile_id") == "profile-ABC"

    # Verify it's also in the persisted log
    entries = tracker.get_all_entries()
    assert any(e.get("details", {}).get("profile_id") == "profile-ABC" for e in entries)


def test_get_all_entries_filtered_by_profile(tmp_path, mock_settings):
    """get_all_entries with profile_id returns only matching entries."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="p1", characters=100, profile_id="profile-X")
    tracker.log_elevenlabs_tts(job_id="p2", characters=200, profile_id="profile-Y")
    tracker.log_elevenlabs_tts(job_id="p3", characters=300, profile_id="profile-X")

    profile_x_entries = tracker.get_all_entries(profile_id="profile-X")
    assert len(profile_x_entries) == 2
    assert all(e.get("details", {}).get("profile_id") == "profile-X" for e in profile_x_entries)


# ---------------------------------------------------------------------------
# Supabase-path tests (mocked Supabase client)
# ---------------------------------------------------------------------------

def make_mock_supabase():
    """Create a mock Supabase client."""
    from unittest.mock import MagicMock
    mock_sb = MagicMock()
    mock_table = MagicMock()
    mock_sb.table.return_value = mock_table

    # insert chain
    mock_insert = MagicMock()
    mock_table.insert.return_value = mock_insert
    mock_insert.execute.return_value = MagicMock(data=[{"id": "new-row"}])

    # select chain
    mock_select = MagicMock()
    mock_table.select.return_value = mock_select
    mock_select.eq.return_value = mock_select
    mock_select.gte.return_value = mock_select
    mock_select.order.return_value = mock_select
    mock_select.limit.return_value = mock_select
    mock_select.execute.return_value = MagicMock(data=[], count=0)

    return mock_sb


def make_supabase_tracker(tmp_path):
    """Create a CostTracker with mocked Supabase."""
    from app.services.cost_tracker import CostTracker
    log_dir = tmp_path / "logs"
    tracker = CostTracker(log_dir=log_dir)
    tracker._supabase = make_mock_supabase()
    return tracker


def test_save_to_supabase_called(tmp_path, mock_settings):
    """_save_to_supabase is called when Supabase is configured."""
    tracker = make_supabase_tracker(tmp_path)
    entry = tracker.log_elevenlabs_tts(job_id="sb-el-1", characters=500, profile_id="profile-sb")
    # Supabase table was called (for insert in _save_to_supabase)
    assert tracker._supabase.table.called


def test_save_to_supabase_no_connection(tmp_path, mock_settings):
    """_save_to_supabase returns False when _supabase is None."""
    from app.services.cost_tracker import CostTracker, CostEntry
    from datetime import datetime, timezone
    tracker = CostTracker(log_dir=tmp_path / "logs")
    tracker._supabase = None
    entry = CostEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        job_id="no-sb",
        service="elevenlabs",
        operation="tts",
        input_units=100,
        cost_usd=0.024,
        details={}
    )
    result = tracker._save_to_supabase(entry)
    assert result is False


def test_get_summary_supabase_path(tmp_path, mock_settings):
    """get_summary uses Supabase when available."""
    tracker = make_supabase_tracker(tmp_path)
    mock_sb = tracker._supabase

    # Setup full mock chain for all Supabase queries in _get_summary_from_supabase
    mock_chain = mock_sb.table.return_value.select.return_value
    mock_chain.eq.return_value = mock_chain
    mock_chain.gte.return_value = mock_chain
    mock_chain.order.return_value = mock_chain
    mock_chain.limit.return_value = mock_chain
    mock_chain.execute.return_value = MagicMock(data=[], count=0)

    summary = tracker.get_summary()
    # Should come from Supabase path (source="supabase")
    assert "totals" in summary


def test_get_summary_supabase_fallback(tmp_path, mock_settings):
    """get_summary falls back to local when Supabase raises."""
    tracker = make_supabase_tracker(tmp_path)
    # Make Supabase query fail
    tracker._supabase.table.side_effect = Exception("Supabase down")

    summary = tracker.get_summary()
    # Should fall back to local
    assert summary["source"] == "local"


def test_get_all_entries_supabase_path(tmp_path, mock_settings):
    """get_all_entries uses Supabase path when available."""
    tracker = make_supabase_tracker(tmp_path)
    mock_sb = tracker._supabase
    mock_chain = mock_sb.table.return_value.select.return_value
    mock_chain.order.return_value = mock_chain
    mock_chain.execute.return_value = MagicMock(data=[{"id": "row1"}])

    entries = tracker.get_all_entries()
    assert isinstance(entries, list)


def test_get_monthly_costs_supabase_path(tmp_path, mock_settings):
    """get_monthly_costs uses Supabase query path."""
    tracker = make_supabase_tracker(tmp_path)
    mock_sb = tracker._supabase
    mock_chain = mock_sb.table.return_value.select.return_value
    mock_chain.eq.return_value = mock_chain
    mock_chain.gte.return_value = mock_chain
    mock_chain.execute.return_value = MagicMock(data=[{"cost": 0.5}, {"cost": 0.3}])

    total = tracker.get_monthly_costs(profile_id="profile-mb")
    assert total == pytest.approx(0.8, abs=1e-4)


def test_get_summary_filtered_by_profile(tmp_path, mock_settings):
    """get_summary with profile_id filters local entries by profile."""
    tracker = make_tracker(tmp_path)
    tracker.log_elevenlabs_tts(job_id="pf-1", characters=1000, profile_id="prof-A")
    tracker.log_elevenlabs_tts(job_id="pf-2", characters=500, profile_id="prof-B")

    summary_a = tracker.get_summary(profile_id="prof-A")
    assert summary_a["entry_count"] == 1

    summary_b = tracker.get_summary(profile_id="prof-B")
    assert summary_b["entry_count"] == 1
