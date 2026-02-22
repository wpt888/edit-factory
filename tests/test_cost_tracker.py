"""
Unit tests for CostTracker local JSON log path (no Supabase).

All tests use a CostTracker with _supabase=None so all operations use
cost_log.json written under tmp_path/logs/.
"""
import json
import pytest
from pathlib import Path
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
