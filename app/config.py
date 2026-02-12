"""
Edit Factory - Configuration
"""
from pathlib import Path
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Server
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True

    # Paths
    base_dir: Path = Path(__file__).parent.parent
    input_dir: Path = Path("./input")
    output_dir: Path = Path("./output")
    logs_dir: Path = Path("./logs")

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

    # Supabase
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_jwt_secret: str = ""  # JWT secret for token verification
    supabase_service_role_key: str = ""  # Service role key for admin operations

    # Security
    allowed_origins: str = "http://localhost:3000,http://localhost:3001,https://editai.obsid.ro"
    auth_disabled: bool = False  # Set to True to disable authentication (local development only!)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    def ensure_dirs(self):
        """Create necessary directories if they don't exist."""
        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()
