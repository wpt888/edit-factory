"""
Shared pytest fixtures for Edit Factory backend tests.
"""
import os
import sys
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock


class MockSettings:
    """Minimal settings-like object for tests — no real Supabase credentials."""
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_role_key: str = ""
    gemini_api_key: str = ""
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_encryption_key: str = ""
    anthropic_api_key: str = ""
    auth_disabled: bool = True
    debug: bool = True
    desktop_mode: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    redis_url: str = "redis://localhost:6379/0"
    allowed_origins: str = "http://localhost:3000"

    def __init__(self, logs_dir: Path, base_dir: Path = None):
        self.logs_dir = logs_dir
        if base_dir is None:
            base_dir = logs_dir.parent
        self.base_dir = base_dir
        self.input_dir = base_dir / "input"
        self.output_dir = base_dir / "output"

    def ensure_dirs(self):
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)


@pytest.fixture
def mock_settings(tmp_path):
    """Patch app.config.get_settings to return a test-safe settings object.

    Prevents any real Supabase connections or .env file reads.
    Yields a MockSettings instance with logs_dir pointing to tmp_path/logs.
    """
    settings = MockSettings(logs_dir=tmp_path / "logs", base_dir=tmp_path)
    with patch("app.config.get_settings", return_value=settings):
        yield settings


@pytest.fixture
def client(tmp_path):
    """FastAPI TestClient with mocked Supabase (None = in-memory fallback) and auth disabled.

    Strategy:
    - Set AUTH_DISABLED=true env var before importing app.main so the module-level
      get_settings() call picks it up via the real Settings class (which reads env vars).
    - Patch app.db.get_supabase to return None, preventing any real DB connection.
    - Patch app.db._supabase_client directly to prevent singleton reuse.
    - Clear the lru_cache on get_settings so each test gets a fresh settings instance.
    - Reset get_job_storage singleton so tests get a fresh in-memory store.

    The TestClient is yielded inside all patches so the app operates with mocked services.
    """
    # Set environment variables before importing to influence Settings
    os.environ["AUTH_DISABLED"] = "true"
    os.environ["SUPABASE_URL"] = ""
    os.environ["SUPABASE_KEY"] = ""

    # Clear lru_cache so get_settings() re-reads environment
    from app.config import get_settings as _get_settings
    _get_settings.cache_clear()

    # Reset Supabase singleton
    import app.db as _db_module
    _db_module._supabase_client = None

    # Reset job storage singleton so each test gets a fresh in-memory store
    import app.services.job_storage as _job_storage_module
    _job_storage_module._job_storage = None

    from app.main import app
    from fastapi.testclient import TestClient

    with patch("app.db.get_supabase", return_value=None), \
         patch("app.db._supabase_client", None):
        test_client = TestClient(app, raise_server_exceptions=False)
        yield test_client

    # Cleanup: clear settings cache after test
    from app.config import get_settings as _get_settings_cleanup
    _get_settings_cleanup.cache_clear()


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
