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
    # Additional Settings attributes needed by app.main and routes
    sentry_dsn: str = ""
    # NOTE: `data_backend` deliberately NOT defaulted here.
    # The pre-Phase-80 test suite relies on `MockSettings.data_backend`
    # raising AttributeError so JobStorage._init_supabase falls into its
    # except branch and sets `_repo = None`, leaving the legacy
    # `_legacy_supabase` mock chain as the only active backend. Tests in
    # tests/test_job_storage.py set `storage._supabase = mock_sb`
    # (legacy path) and assert mock_sb.table was called — this only works
    # when `_has_repository_backend()` returns False. The `sqlite_backend`
    # fixture sets `data_backend = "sqlite"` on its own instance.
    file_storage_backend: str = "local"
    output_ttl_hours: int = 0
    minio_public_url: str = ""
    trusted_proxy_ips: str = "127.0.0.1,::1"
    fal_api_key: str = ""
    fal_base_url: str = "https://fal.run"
    gemini_model: str = "gemini-2.5-flash"
    elevenlabs_model: str = "eleven_flash_v2_5"
    anthropic_model: str = "claude-sonnet-4-6"

    def __init__(self, logs_dir: Path, base_dir: Path = None):
        self.logs_dir = logs_dir
        if base_dir is None:
            base_dir = logs_dir.parent
        self.base_dir = base_dir
        self.input_dir = base_dir / "input"
        self.output_dir = base_dir / "output"
        self.media_dir = base_dir / "media"

    def ensure_dirs(self):
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)


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


# ──────────────────────────────────────────────
# SQLite integration fixture (Phase 80)
# ──────────────────────────────────────────────

@pytest.fixture
def sqlite_backend(tmp_path, monkeypatch):
    """Provide a TestClient + SQLiteRepository + seeded profile for integration tests.

    Pattern: reuse the established ``MockSettings`` (tests/conftest.py:11-53) but
    add ``data_backend = "sqlite"``, reset the repository singleton via
    ``close_repository()``, and seed a default profile with a fail-loud assertion.

    Yields (client, repo, profile_id).
    """
    # 1. Build settings with data_backend=sqlite (extends the existing MockSettings)
    mock_settings_obj = MockSettings(logs_dir=tmp_path / "logs", base_dir=tmp_path)
    mock_settings_obj.data_backend = "sqlite"
    mock_settings_obj.ensure_dirs()

    # 2. Patch get_settings BEFORE any app/repository import or singleton lookup.
    #    Patch BOTH the module attribute and the auth module's bound reference
    #    so the dev-mode profile bypass also sees auth_disabled=True.
    monkeypatch.setattr("app.config.get_settings", lambda: mock_settings_obj)

    # 3. Reset the repository singleton so the next get_repository() call
    #    consults the patched settings.
    from app.repositories.factory import close_repository, get_repository
    close_repository()

    # 4. Belt-and-suspenders: also set the env var (some code paths read it directly)
    monkeypatch.setenv("DATA_BACKEND", "sqlite")
    monkeypatch.setenv("AUTH_DISABLED", "true")

    # 5. Now build the TestClient (this triggers app.main import which may
    #    cache settings via get_settings() — the patch above ensures it
    #    picks up the mock).
    from app.main import app as fastapi_app
    from fastapi.testclient import TestClient
    client = TestClient(fastapi_app, raise_server_exceptions=False)

    # 6. Acquire the repo and seed a default profile (fail-LOUD)
    repo = get_repository()
    assert type(repo).__name__ == "SQLiteRepository", \
        f"Expected SQLiteRepository, got {type(repo).__name__}"

    profile_id = "test-profile-001"
    existing = repo.get_profile(profile_id)
    if not existing:
        repo.create_profile({
            "id": profile_id,
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Dev",
            "is_default": 1,
        })
    # FAIL LOUD if seeding didn't take — the rest of the test would be
    # nonsense in that case.
    assert repo.get_profile(profile_id) is not None, \
        f"profile seed failed for {profile_id}; check SQLite schema bootstrap"

    yield client, repo, profile_id

    # 7. Teardown: reset the singleton so subsequent Supabase-mocked tests
    #    in the same session get a fresh lookup.
    close_repository()


def _seed_project(repo, profile_id: str, name: str = "Test Project") -> dict:
    """Create a minimal project and return its dict."""
    return repo.create_project({
        "profile_id": profile_id,
        "name": name,
        "description": "test",
        "status": "draft",
        "target_duration": 20,
    })


def _seed_clip(repo, profile_id: str, project_id: str = None, **overrides) -> dict:
    """Create a minimal clip and return its dict.

    If ``project_id`` is omitted, a new project is created automatically.
    """
    if not project_id:
        project_id = _seed_project(repo, profile_id)["id"]
    clip_data = {
        "project_id": project_id,
        "profile_id": profile_id,
        "variant_index": 1,
        "variant_name": "variant_1",
        "raw_video_path": "/tmp/test_raw.mp4",
        "duration": 10.0,
        "is_selected": 0,
        "is_deleted": 0,
        "final_status": "pending",
        **overrides,
    }
    return repo.create_clip(clip_data)


def _seed_clip_content(repo, clip_id: str, **overrides) -> dict:
    """Create minimal clip_content row.

    NOTE: the SQLite ``editai_clip_content`` schema uses ``script_text`` for
    the text column (see supabase/sqlite_schema.sql:172). Production
    library_routes consume ``tts_text``; the route layer expects that key in
    the returned dict but Phase 80 is a route-side migration only —
    column-name consistency is out of scope. Tests that need a non-empty
    tts text pass ``script_text`` via overrides so the INSERT succeeds.
    """
    content_data = {
        "clip_id": clip_id,
        "script_text": "hello world",
        "srt_content": "1\n00:00:00,000 --> 00:00:02,000\nhello\n",
        **overrides,
    }
    return repo.create_clip_content(content_data)


def _seed_export_preset(repo, name: str = "instagram_reels", **overrides) -> dict:
    """Create a minimal export preset row (profile-agnostic by default)."""
    preset_data = {
        "name": name,
        "is_default": 0,
        "width": 1080,
        "height": 1920,
        "fps": 30,
        **overrides,
    }
    return repo.create_export_preset(preset_data)
