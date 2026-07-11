"""
Blipost render fleet routes (desktop side).

Lets a desktop pair with a Blipost web account as a *render runner*: the user
generates a pairing code on blipost.com → Settings, types it here, and this
exchanges it for a runner token (stored Fernet-encrypted in the vault under
service `blipost_render`). Once paired and switched on, the background runner
(app/services/blipost_runner.py) leases the account's clip render jobs and
renders them locally for free.

The runner token is shown to the user exactly ONCE (in the pair response) and
never again — it lives only in the encrypted vault after that.
"""
import logging
import platform
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/render", tags=["Blipost Render"])

_VAULT_SERVICE = "blipost_render"
_TOKEN_LABEL = "Blipost Render Token"
_PAIR_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


# ============== MODELS ==============

class PairRequest(BaseModel):
    code: str
    deviceName: Optional[str] = None


class PairResponse(BaseModel):
    token: str          # shown ONCE — the client should not persist/display it again
    runnerId: str
    deviceName: str


class RenderStatusResponse(BaseModel):
    connected: bool
    running: bool
    state: str
    currentJob: Optional[str] = None
    lastError: Optional[str] = None
    processed: list = []
    nvenc: bool = False


# ============== VAULT HELPERS ==============

def _store_render_token(profile_id: str, token: str) -> None:
    """Persist the runner token, replacing any existing one for this profile."""
    from app.services.credentials.vault import get_vault_manager
    vault = get_vault_manager()
    for key in vault.list_keys(profile_id, _VAULT_SERVICE):
        if not key.get("is_env_default"):
            try:
                vault.delete_key(profile_id, key["id"])
            except ValueError:
                pass
    vault.add_key(profile_id, _VAULT_SERVICE, _TOKEN_LABEL, token)


def _get_render_token(profile_id: str) -> str:
    """The stored runner token for this profile, or '' if not paired."""
    from app.services.credentials.vault import get_vault_manager
    return get_vault_manager().get_api_key_or_default(profile_id, _VAULT_SERVICE)


# ============== PAIRING ==============

@router.post("/pair", response_model=PairResponse)
async def pair(body: PairRequest, profile: ProfileContext = Depends(get_profile_context)):
    """Exchange a pairing code (from blipost.com → Settings) for a runner token.

    The code is single-use and short-lived on the web side; the token it returns
    is shown here once and then only kept encrypted in the vault.
    """
    code = (body.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Enter the pairing code from Blipost → Settings.")

    device_name = (body.deviceName or "").strip() or (platform.node() or "Desktop")
    base_url = get_settings().blipost_platform_base_url.rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=_PAIR_TIMEOUT) as client:
            resp = await client.post(
                f"{base_url}/api/render/v1/pair",
                json={"code": code, "deviceName": device_name},
            )
    except Exception as e:
        logger.error("[Profile %s] Blipost pair request failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not reach the Blipost server.")

    if resp.status_code != 200:
        detail = "Pairing failed."
        try:
            detail = resp.json().get("error") or detail
        except Exception:
            pass
        # 400 from the web = invalid/used/expired code — surface it as 400 here too.
        raise HTTPException(status_code=400 if resp.status_code == 400 else 502, detail=detail)

    data = resp.json()
    token = data.get("token")
    runner_id = data.get("runnerId")
    if not token or not runner_id:
        raise HTTPException(status_code=502, detail="Blipost did not return a token.")

    try:
        _store_render_token(profile.profile_id, token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    logger.info("[Profile %s] Blipost render device paired (%s)", profile.profile_id, device_name)
    return PairResponse(token=token, runnerId=runner_id, deviceName=device_name)


@router.delete("/pair")
async def unpair(profile: ProfileContext = Depends(get_profile_context)):
    """Forget the runner token and stop the runner — this device leaves the fleet.
    (The web side still lists the device until the user revokes it there.)"""
    from app.services.credentials.vault import get_vault_manager
    from app.services.blipost_runner import get_render_runner

    await get_render_runner().stop()
    vault = get_vault_manager()
    for key in vault.list_keys(profile.profile_id, _VAULT_SERVICE):
        if not key.get("is_env_default"):
            try:
                vault.delete_key(profile.profile_id, key["id"])
            except ValueError:
                pass
    logger.info("[Profile %s] Blipost render device unpaired", profile.profile_id)
    return {"status": "unpaired"}


# ============== RUNNER CONTROL ==============

@router.get("/status", response_model=RenderStatusResponse)
async def status(profile: ProfileContext = Depends(get_profile_context)):
    """Connection + runner state for the Settings card."""
    from app.services.blipost_runner import get_render_runner
    connected = bool(_get_render_token(profile.profile_id))
    snap = get_render_runner().status()
    return RenderStatusResponse(connected=connected, **snap)


@router.post("/start", response_model=RenderStatusResponse)
async def start(profile: ProfileContext = Depends(get_profile_context)):
    """Turn on "Accept render jobs" — the runner starts leasing this account's jobs."""
    from app.services.blipost_runner import get_render_runner
    token = _get_render_token(profile.profile_id)
    if not token:
        raise HTTPException(status_code=400, detail="Pair this device with Blipost first.")

    base_url = get_settings().blipost_platform_base_url
    try:
        await get_render_runner().start(profile.profile_id, base_url, token)
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    snap = get_render_runner().status()
    return RenderStatusResponse(connected=True, **snap)


@router.post("/stop", response_model=RenderStatusResponse)
async def stop(profile: ProfileContext = Depends(get_profile_context)):
    """Turn off "Accept render jobs" — finishes cleanly, leases nothing new."""
    from app.services.blipost_runner import get_render_runner
    await get_render_runner().stop()
    connected = bool(_get_render_token(profile.profile_id))
    snap = get_render_runner().status()
    return RenderStatusResponse(connected=connected, **snap)
