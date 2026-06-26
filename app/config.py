"""
Edit Factory - Configuration
"""
import os
import sys
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache

from app.core.version import get_version
APP_VERSION = get_version()


def _get_app_base_dir() -> Path:
    """Returns the OS-appropriate user-data directory in desktop mode, project root in dev.

    Resolves per platform when DESKTOP_MODE is truthy:
    - Windows (sys.platform == 'win32'): %APPDATA%\\EditFactory
    - macOS   (sys.platform == 'darwin'): ~/Library/Application Support/EditFactory
    - Linux   (sys.platform.startswith('linux')): $XDG_CONFIG_HOME/EditFactory if XDG_CONFIG_HOME is non-empty, else ~/.config/EditFactory

    When DESKTOP_MODE is not truthy (dev/WSL/CI), returns project root.
    """
    import logging as _logging
    _logger = _logging.getLogger(__name__)

    desktop = os.getenv("DESKTOP_MODE", "").lower() in ("true", "1", "yes")
    if not desktop:
        return Path(__file__).parent.parent

    base: Path | None = None
    if sys.platform == "win32":
        appdata = os.getenv("APPDATA")
        if appdata:
            base = Path(appdata) / "EditFactory"
        else:
            _logger.warning("DESKTOP_MODE is set but APPDATA env var is missing — falling back to project root")
    elif sys.platform == "darwin":
        home = Path.home()
        base = home / "Library" / "Application Support" / "EditFactory"
    elif sys.platform.startswith("linux"):
        xdg = os.getenv("XDG_CONFIG_HOME")
        if xdg:  # non-empty string only — empty treated as unset per XDG spec
            base = Path(xdg) / "EditFactory"
        else:
            base = Path.home() / ".config" / "EditFactory"
    else:
        _logger.warning(f"DESKTOP_MODE is set but platform {sys.platform!r} is unknown — falling back to project root")

    if base is None:
        # Desktop, but the platform's data dir couldn't be resolved (e.g. APPDATA
        # unset). Fall back to a user-WRITABLE home dir, NOT the packaged install
        # dir (process.resourcesPath via __file__), which can be read-only and make
        # ensure_dirs() fail at startup (audit #33).
        fallback = Path.home() / "EditFactory"
        _logger.warning(f"DESKTOP_MODE base dir unresolved — falling back to {fallback}")
        try:
            fallback.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            _logger.warning(f"Could not create fallback dir {fallback}: {e}")
        return fallback

    try:
        base.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _logger.warning(f"Could not create base dir {base}: {e}")
    return base


def get_base_dir() -> Path:
    """Public accessor for the resolved base dir. Re-evaluates each call (does NOT cache).

    NOTE: The module-level `_BASE_DIR` constant captures the value at import time
    and is what `Settings.base_dir` uses. `get_base_dir()` is provided for callers
    that need a fresh resolution (e.g. after env var changes mid-process).
    """
    return _get_app_base_dir()


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
    media_dir: Path = _BASE_DIR / "media"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # fal.ai
    fal_api_key: str = ""
    fal_base_url: str = "https://fal.run"

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

    # MinIO video storage (Buffer publishing)
    # Kong proxies /s3/* to MinIO. Bucket has public anonymous access.
    minio_public_url: str = ""  # e.g. https://supabase.nortia.ro/s3/buffer-videos

    # Security
    allowed_origins: str = "http://localhost:3000,http://localhost:3001,https://editai.obsid.ro"
    auth_disabled: bool = False  # Set to True to disable authentication (local development only!)
    trusted_proxy_ips: str = "127.0.0.1,::1"  # Only trusted proxies may supply X-Forwarded-For

    # Desktop mode
    desktop_mode: bool = False  # Set to True when running as Electron desktop app

    # Desktop test login (temporary UI gate until website-based user accounts exist).
    # Overridable via DESKTOP_TEST_USER / DESKTOP_TEST_PASSWORD in .env.
    desktop_test_user: str = "1234"
    desktop_test_password: str = "1234"

    # Gemini Vision frame analysis at upload. None = auto: enabled on web,
    # disabled in desktop mode (product vision: AI only for scripts + voiceover;
    # deterministic motion/variance/blur scoring covers segment selection).
    # Set GEMINI_VISION_ENABLED=true/false to override either way.
    gemini_vision_enabled: Optional[bool] = None

    @property
    def gemini_vision_active(self) -> bool:
        """Effective Gemini Vision policy (key availability is checked separately)."""
        if self.gemini_vision_enabled is not None:
            return self.gemini_vision_enabled
        return not self.desktop_mode

    # Per-segment extraction cache (F2): reuses extracted segment files across
    # renders so an iterative edit only re-extracts what changed.
    segment_cache_enabled: bool = True
    segment_cache_max_gb: float = 5.0

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
        self.media_dir.mkdir(parents=True, exist_ok=True)
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
