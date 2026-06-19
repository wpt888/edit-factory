"""
Desktop-specific API routes — license management, version, settings.
Only mounted when DESKTOP_MODE=true (see app/main.py).
"""
import json
import logging
from pathlib import Path

import httpx

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import get_settings, APP_VERSION
from app.services.key_vault import get_key_vault
from app.services.credentials.license import LicenseService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/desktop")


# --- Request/Response models ---

class ActivateRequest(BaseModel):
    license_key: str


class TestConnectionRequest(BaseModel):
    service: str  # "supabase" | "gemini" | "elevenlabs"
    url: str = ""
    key: str = ""


# --- Version ---

@router.get("/version")
async def get_version():
    """Return current app version."""
    return {"version": APP_VERSION}


# --- License ---

@router.post("/license/activate")
async def activate_license(body: ActivateRequest):
    """Activate a new license key. Stores instance_id to license.json."""
    settings = get_settings()
    svc = LicenseService(settings.base_dir)
    result = await svc.activate(body.license_key)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Activation failed"))
    return result


@router.get("/license/status")
async def get_license_status():
    """Lightweight license status check -- reads local state only, no API call."""
    settings = get_settings()
    svc = LicenseService(settings.base_dir)
    status = svc.get_status()
    if not status["activated"]:
        raise HTTPException(status_code=404, detail="No license activated")
    if not status["valid"]:
        raise HTTPException(status_code=403, detail="License expired -- grace period exceeded")
    return status


@router.post("/license/validate")
async def validate_license():
    """Validate license on startup. Returns 403 if invalid and grace period expired."""
    settings = get_settings()
    svc = LicenseService(settings.base_dir)
    result = await svc.validate()
    if not result["valid"]:
        # Distinguish "not activated" from "invalid/expired"
        if result.get("error") == "Not activated":
            raise HTTPException(status_code=404, detail="No license activated. Please activate a license key.")
        raise HTTPException(
            status_code=403,
            detail=result.get("error") or "License invalid or expired. Please re-activate your license key."
        )
    return result


# --- Settings ---

def _read_config(config_file: Path) -> dict:
    if not config_file.exists():
        return {}
    try:
        return json.loads(config_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _hint(key: str) -> str:
    """Redact API key to last 4 chars hint."""
    if key and len(key) > 4:
        return f"***{key[-4:]}"
    return "set" if key else ""


def _write_env_keys(base_dir: Path, payload: dict) -> None:
    """Write API key values from settings payload to AppData .env for pydantic-settings reload."""
    env_key_map = {
        "gemini_api_key": "GEMINI_API_KEY",
        "elevenlabs_api_key": "ELEVENLABS_API_KEY",
        "supabase_url": "SUPABASE_URL",
        "supabase_key": "SUPABASE_KEY",
    }
    env_file = base_dir / ".env"
    # Read existing lines (preserve non-API-key entries like DESKTOP_MODE)
    existing_env = {}
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                existing_env[k.strip()] = v.strip()

    # Update with new values from payload (skip empty strings to avoid overwriting)
    changed = False
    for payload_key, env_var in env_key_map.items():
        value = payload.get(payload_key)
        if value:  # Skip None and empty strings
            existing_env[env_var] = value
            changed = True

    if changed:
        new_lines = [f"{k}={v}" for k, v in existing_env.items()]
        try:
            env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
            logger.info("API keys written to AppData .env")
        except OSError as e:
            logger.error(f"Failed to write .env file: {e}")


@router.get("/settings")
async def get_desktop_settings():
    """Read settings: API key hints from encrypted vault, other settings from config.json."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    config = _read_config(config_file)
    vault = get_key_vault()

    # For supabase_url, show full value (not a secret) — try vault first, then config fallback
    supabase_url = vault.get_key("supabase_url") or config.get("supabase_url", "")

    # Wave 1.1: whether the backend ALREADY has working Supabase creds. Packaged
    # desktop seeds credentials.env -> %APPDATA%\.env (read into settings), so the
    # app is connected to the cloud before the wizard even runs. When true the
    # onboarding wizard skips the (redundant, confusing) Supabase step entirely.
    supabase_configured = bool(
        (supabase_url or getattr(settings, "supabase_url", ""))
        and (vault.get_key("supabase_key") or config.get("supabase_key") or getattr(settings, "supabase_key", ""))
    )

    return {
        "gemini_api_key": vault.get_key_hint("gemini_api_key") or _hint(config.get("gemini_api_key", "")),
        "elevenlabs_api_key": vault.get_key_hint("elevenlabs_api_key") or _hint(config.get("elevenlabs_api_key", "")),
        "supabase_url": supabase_url,
        "supabase_key": vault.get_key_hint("supabase_key") or _hint(config.get("supabase_key", "")),
        "supabase_configured": supabase_configured,
        "first_run_complete": config.get("first_run_complete", False),
        "crash_reporting_enabled": config.get("crash_reporting_enabled", False),
        "tts_provider": config.get("tts_provider", None),
    }


@router.post("/first-run/complete")
async def mark_first_run_complete():
    """Mark setup wizard as complete. Writes first_run_complete to config.json."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["first_run_complete"] = True
    try:
        config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    except OSError as e:
        logger.error(f"Failed to write config.json: {e}")
        raise HTTPException(status_code=500, detail="Failed to save configuration")
    get_settings.cache_clear()
    get_settings()
    logger.info("Setup wizard completed — first_run_complete written to config.json")
    return {"completed": True}


# --- Desktop test auth (temporary UI gate) ---
#
# Simple username/password gate so the app can be tested before the real
# website-based user system exists. Credentials default to 1234/1234 and are
# configurable via DESKTOP_TEST_USER / DESKTOP_TEST_PASSWORD. This is NOT API
# security — backend API auth is already bypassed in desktop_mode (see
# app/api/auth.py). The login state is persisted to config.json so Electron's
# startup logic and the frontend guard can read it.

class DesktopLoginRequest(BaseModel):
    username: str
    password: str


def _set_logged_in(config_file: Path, value: bool) -> None:
    existing = _read_config(config_file)
    existing["desktop_logged_in"] = value
    try:
        config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    except OSError as e:
        logger.error(f"Failed to write config.json: {e}")
        raise HTTPException(status_code=500, detail="Failed to save login state")


@router.post("/auth/login")
async def desktop_login(body: DesktopLoginRequest):
    """Validate test credentials and persist the logged-in flag to config.json."""
    settings = get_settings()
    if body.username != settings.desktop_test_user or body.password != settings.desktop_test_password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _set_logged_in(settings.base_dir / "config.json", True)
    logger.info("Desktop test login succeeded")
    return {"ok": True}


@router.get("/auth/status")
async def desktop_auth_status():
    """Return whether the desktop test user is currently logged in (local read only)."""
    settings = get_settings()
    config = _read_config(settings.base_dir / "config.json")
    return {"logged_in": bool(config.get("desktop_logged_in", False))}


@router.post("/auth/logout")
async def desktop_logout():
    """Clear the logged-in flag so the login screen is shown again."""
    settings = get_settings()
    _set_logged_in(settings.base_dir / "config.json", False)
    logger.info("Desktop test logout")
    return {"ok": True}


@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest):
    """Test API connectivity for a service. Used by Setup Wizard Step 2."""
    if body.service == "supabase":
        if not body.url or not body.key:
            raise HTTPException(status_code=400, detail="Supabase URL and key are required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    f"{body.url.rstrip('/')}/rest/v1/",
                    headers={"apikey": body.key, "Authorization": f"Bearer {body.key}"},
                )
                if resp.status_code in (200, 400):
                    return {"connected": True, "service": "supabase"}
                raise HTTPException(
                    status_code=400,
                    detail=f"Supabase returned HTTP {resp.status_code}",
                )
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(
                    status_code=400, detail=f"Cannot reach Supabase: {e}"
                )

    elif body.service == "gemini":
        if not body.key:
            raise HTTPException(status_code=400, detail="Gemini API key is required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    headers={"x-goog-api-key": body.key},
                )
                if resp.status_code == 200:
                    return {"connected": True, "service": "gemini"}
                raise HTTPException(
                    status_code=400,
                    detail="Gemini API key invalid or quota exceeded",
                )
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(
                    status_code=400, detail=f"Cannot reach Gemini API: {e}"
                )

    elif body.service == "elevenlabs":
        if not body.key:
            raise HTTPException(status_code=400, detail="ElevenLabs API key is required")
        async with httpx.AsyncClient(timeout=8.0) as client:
            try:
                resp = await client.get(
                    "https://api.elevenlabs.io/v1/user",
                    headers={"xi-api-key": body.key},
                )
                if resp.status_code == 200:
                    return {"connected": True, "service": "elevenlabs"}
                raise HTTPException(
                    status_code=400,
                    detail="ElevenLabs API key invalid",
                )
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                raise HTTPException(
                    status_code=400, detail=f"Cannot reach ElevenLabs API: {e}"
                )

    raise HTTPException(status_code=400, detail=f"Unknown service: {body.service}")


class DesktopSettingsUpdate(BaseModel):
    gemini_api_key: str | None = None
    elevenlabs_api_key: str | None = None
    supabase_url: str | None = None
    supabase_key: str | None = None
    first_run_complete: bool | None = None
    crash_reporting_enabled: bool | None = None
    tts_provider: str | None = None  # "edge" | "elevenlabs"


@router.post("/settings")
async def save_desktop_settings(body: DesktopSettingsUpdate):
    """Save settings: API keys go to encrypted vault, other settings to config.json."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    payload = body.model_dump(exclude_none=True)

    # API key fields go to the encrypted vault, NOT to config.json
    vault = get_key_vault()
    api_key_fields = {"gemini_api_key", "elevenlabs_api_key", "supabase_url", "supabase_key"}
    for key_name in api_key_fields:
        value = payload.pop(key_name, None)
        if value:
            vault.store_key(key_name, value)

    # Non-key settings (first_run_complete, crash_reporting_enabled) go to config.json
    if payload:
        existing.update(payload)
        try:
            config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        except OSError as e:
            logger.error(f"Failed to write config file: {e}")
            raise HTTPException(status_code=500, detail="Failed to save settings")

    # Refresh service singletons so new keys take effect without restart
    if any(body.model_dump(exclude_none=True).get(k) for k in api_key_fields):
        try:
            from app.services.elevenlabs_tts import _reset_elevenlabs_tts
            _reset_elevenlabs_tts()
            logger.info("ElevenLabs TTS singleton reset after key save")
        except Exception as e:
            logger.warning("Failed to reset ElevenLabs singleton: %s", e)
        try:
            from app.services.script_generator import reset_script_generator
            reset_script_generator()
            logger.info("ScriptGenerator singleton reset after key save")
        except Exception as e:
            logger.warning("Failed to reset ScriptGenerator singleton: %s", e)

    # Still write API keys to AppData .env so pydantic-settings picks them up
    # (bridge until Plan 02 switches services to read from vault directly)
    _write_env_keys(settings.base_dir, body.model_dump(exclude_none=True))

    # Clear settings cache so next request sees fresh values
    get_settings.cache_clear()
    get_settings()

    return {"saved": True}


@router.post("/crash-reporting")
async def set_crash_reporting_toggle(body: dict):
    """Toggle crash reporting at runtime. Takes immediate effect without restart."""
    enabled = bool(body.get("enabled", False))
    # Update in-memory flag (immediate effect via before_send)
    from app.services.crash_reporter import set_crash_reporting
    set_crash_reporting(enabled)
    # Persist to config.json
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["crash_reporting_enabled"] = enabled
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    logger.info("Crash reporting toggled: %s", "enabled" if enabled else "disabled")
    return {"crash_reporting_enabled": enabled}
