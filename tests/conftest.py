"""
Shared pytest fixtures for Edit Factory backend tests.
"""
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


class MockSettings:
    """Minimal settings-like object for tests — no real Supabase credentials."""
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""
    gemini_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    auth_disabled: bool = True

    def __init__(self, logs_dir: Path):
        self.logs_dir = logs_dir


@pytest.fixture
def mock_settings(tmp_path):
    """Patch app.config.get_settings to return a test-safe settings object.

    Prevents any real Supabase connections or .env file reads.
    Yields a MockSettings instance with logs_dir pointing to tmp_path/logs.
    """
    settings = MockSettings(logs_dir=tmp_path / "logs")
    with patch("app.config.get_settings", return_value=settings):
        yield settings


@pytest.fixture
def memory_job_storage(mock_settings):
    """Return a JobStorage instance forced into in-memory mode (_supabase=None).

    The JobStorage.__init__ calls _init_supabase() which will gracefully fail
    when supabase_url is empty, leaving _supabase as None. This fixture
    explicitly ensures _supabase is None after construction.
    """
    from app.services.job_storage import JobStorage

    storage = JobStorage()
    # Ensure in-memory mode regardless of any env vars present
    storage._supabase = None
    storage._memory_store = {}
    return storage


@pytest.fixture
def cost_tracker(tmp_path, mock_settings):
    """Return a CostTracker instance using tmp_path for log_dir, no Supabase.

    The tracker will write cost_log.json to tmp_path/logs/cost_log.json.
    _supabase is forced to None so all operations use local JSON only.
    """
    from app.services.cost_tracker import CostTracker

    log_dir = tmp_path / "logs"
    tracker = CostTracker(log_dir=log_dir)
    # Ensure no Supabase connection
    tracker._supabase = None
    return tracker
