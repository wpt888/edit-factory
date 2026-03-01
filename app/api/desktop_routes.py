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
from app.services.license_service import LicenseService

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
        env_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        logger.info("API keys written to AppData .env")


@router.get("/settings")
async def get_desktop_settings():
    """Read config.json and return redacted view (API keys show last-4-char hints only)."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    config = _read_config(config_file)
    return {
        "gemini_api_key": _hint(config.get("gemini_api_key", "")),
        "elevenlabs_api_key": _hint(config.get("elevenlabs_api_key", "")),
        "supabase_url": config.get("supabase_url", ""),
        "supabase_key": _hint(config.get("supabase_key", "")),
        "first_run_complete": config.get("first_run_complete", False),
        "crash_reporting_enabled": config.get("crash_reporting_enabled", False),
    }


@router.post("/first-run/complete")
async def mark_first_run_complete():
    """Mark setup wizard as complete. Writes first_run_complete to config.json."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    existing["first_run_complete"] = True
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    get_settings.cache_clear()
    get_settings()
    logger.info("Setup wizard completed — first_run_complete written to config.json")
    return {"completed": True}


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
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={body.key}",
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


@router.post("/settings")
async def save_desktop_settings(body: dict):
    """Write settings to config.json and AppData .env. Merges with existing values."""
    settings = get_settings()
    config_file = settings.base_dir / "config.json"
    existing = _read_config(config_file)
    # Only update non-None values from the request
    existing.update({k: v for k, v in body.items() if v is not None})
    config_file.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    # Write API keys to AppData .env so pydantic-settings picks them up
    _write_env_keys(settings.base_dir, body)

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
