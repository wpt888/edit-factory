"""
Edit Factory - Configuration
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

from app.version import get_version
APP_VERSION = get_version()


def _get_app_base_dir() -> Path:
    """Returns %APPDATA%\\EditFactory in desktop mode, project root in dev."""
    import logging as _logging
    _logger = _logging.getLogger(__name__)
    if os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes"):
        appdata = os.getenv("APPDATA")
        if appdata:
            base = Path(appdata) / "EditFactory"
            try:
                base.mkdir(parents=True, exist_ok=True)
            except OSError as e:
                _logger.warning(f"Could not create base dir {base}: {e}")
            return base
        else:
            _logger.warning("DESKTOP_MODE is set but APPDATA env var is missing — falling back to project root")
    # Dev / WSL / CI: use project root (existing behaviour)
    return Path(__file__).parent.parent


_BASE_DIR = _get_app_base_dir()


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False

    # Paths
    base_dir: Path = _BASE_DIR
    input_dir: Path = _BASE_DIR / "input"
    output_dir: Path = _BASE_DIR / "output"
    logs_dir: Path = _BASE_DIR / "logs"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # fal.ai
    fal_api_key: str = ""

    # Google Drive
    google_drive_folder_id: str = ""
    google_credentials_path: str = ""

    # Postiz
    postiz_api_url: str = ""
    postiz_api_key: str = ""

    # Gemini API
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # ElevenLabs TTS
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    elevenlabs_model: str = "eleven_flash_v2_5"
    elevenlabs_encryption_key: str = ""  # Fernet key for encrypting API keys; if empty, derived from SUPABASE_KEY

    # Anthropic Claude AI
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_jwt_secret: str = ""  # JWT secret for token verification
    supabase_service_role_key: str = ""  # Service role key for admin operations

    # Security
    allowed_origins: str = "http://localhost:3000,http://localhost:3001,https://editai.obsid.ro"
    auth_disabled: bool = False  # Set to True to disable authentication (local development only!)

    # Desktop mode
    desktop_mode: bool = False  # Set to True when running as Electron desktop app

    # File storage backend: "local" (default) or "supabase"
    file_storage_backend: str = "local"

    # Data storage backend: "supabase" or "sqlite"
    data_backend: str = "supabase"

    # Sentry error reporting (all modes — set SENTRY_DSN env var to enable)
    sentry_dsn: str = ""  # Sentry DSN for error reporting

    # Output file TTL: hours before output/finals/ and output/tts/ files are eligible for cleanup (0 = disabled)
    output_ttl_hours: int = 72

    model_config = SettingsConfigDict(
        env_file=None,  # Disable default; controlled in settings_customise_sources
        env_file_encoding="utf-8",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        """Load env vars, then AppData .env (desktop), then project .env (dev fallback)."""
        sources = [init_settings, env_settings]
        # Desktop mode: AppData .env has priority
        appdata_env = _BASE_DIR / ".env"
        desktop = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
        if desktop and appdata_env.exists():
            try:
                from pydantic_settings import DotEnvSettingsSource
            except ImportError:
                try:
                    from pydantic_settings.env_settings import DotEnvSettingsSource
                except ImportError:
                    try:
                        from pydantic_settings.main import DotEnvSettingsSource
                    except ImportError:
                        import logging as _log
                        _log.getLogger(__name__).warning("DotEnvSettingsSource not found — .env files will not be loaded")
                        DotEnvSettingsSource = None
            if DotEnvSettingsSource is not None:
                sources.append(DotEnvSettingsSource(settings_cls, env_file=appdata_env))
        # Always include project .env as lowest-priority fallback
        project_env = Path(__file__).parent.parent / ".env"
        if project_env.exists():
            try:
                from pydantic_settings import DotEnvSettingsSource
            except ImportError:
                try:
                    from pydantic_settings.env_settings import DotEnvSettingsSource
                except ImportError:
                    try:
                        from pydantic_settings.main import DotEnvSettingsSource
                    except ImportError:
                        DotEnvSettingsSource = None
            if DotEnvSettingsSource is not None:
                sources.append(DotEnvSettingsSource(settings_cls, env_file=project_env))
        return tuple(sources)

    def ensure_dirs(self):
        """Create necessary directories if they don't exist."""
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        if self.desktop_mode:
            # Ensure AppData subdirectories for desktop mode
            (self.base_dir / "cache" / "tts").mkdir(parents=True, exist_ok=True)


# NOTE: Phase 50 (Setup Wizard) must call get_settings.cache_clear()
# after writing a new .env to AppData, then call get_settings() again
# to pick up new values.
#
# DB-23: The @lru_cache decorator means the Settings instance is created once and
# reused for the lifetime of the process. Any fields that depend on runtime state
# (e.g. dynamically configured paths, feature flags toggled via admin API) will
# NOT update unless get_settings.cache_clear() is called first. This is intentional
# for performance; only the Setup Wizard flow needs to clear and rebuild.
@lru_cache
def get_settings() -> Settings:
    return Settings()
