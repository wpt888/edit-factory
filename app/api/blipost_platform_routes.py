"""
Blipost Platform bridge routes (phase U1).

Connects the desktop app to a Blipost web account via a pasted platform token
(format `blp_*`, stored Fernet-encrypted in the vault under service
`blipost_platform`). Exposes credit balance, connected social accounts, and a
publish path that runs alongside the existing Postiz/Buffer flow.

The token never appears in responses or logs — only masked hints and balances.
"""
import asyncio
import logging
import mimetypes
import shutil
import uuid
import httpx
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.blipost_platform_client import (
    BlipostAuthError,
    BlipostCreditsError,
    BlipostNotFoundError,
    BlipostPlatformClient,
    BlipostPlatformError,
    BlipostRateLimitError,
    get_client_for_profile,
)
# Reuse the Postiz publish-progress store — same job_id→dict contract the
# frontend already polls, with eviction handled there. No need to duplicate it.
from app.api.postiz_routes import get_publish_progress, update_publish_progress

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/platform", tags=["Blipost Platform"])

_VAULT_SERVICE = "blipost_platform"
_TOKEN_LABEL = "Blipost Platform"

# ---- AI video jobs (D2) — in-memory, per job_id ----------------------------
# ponytail: lost on server restart (same ceiling as _generation_progress). A job
# in flight when the backend restarts loses its keywords/duration fallback; the
# poll still works and registers the clip with derived keywords.
_video_jobs: Dict[str, dict] = {}            # job_id -> {keywords, prompt, duration_sec, profile_id}
_video_registrations: Dict[str, dict] = {}   # job_id -> VideoStatusResponse payload (dedup)
_video_locks: Dict[str, asyncio.Lock] = {}   # job_id -> lock guarding download+register
_video_owners: Dict[str, str] = {}           # job_id -> submitting profile_id (ownership; persists past registration)


# ============== MODELS ==============

class ConnectRequest(BaseModel):
    token: str


class BlipostSessionRequest(BaseModel):
    email: str
    password: str


class BlipostSessionResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: Optional[int] = None
    expires_at: Optional[int] = None
    token_type: Optional[str] = None


class MeResponse(BaseModel):
    connected: bool
    email: Optional[str] = None
    plan: Optional[str] = None
    balance: Optional[float] = None
    error: Optional[str] = None


class PlatformAccount(BaseModel):
    id: str
    platform: str
    handle: Optional[str] = None
    displayName: Optional[str] = None
    status: Optional[str] = None


class AutomationMirror(BaseModel):
    id: str
    name: str
    enabled: bool
    triggerType: str
    triggerConfig: Dict = Field(default_factory=dict)
    definition: Dict
    lastRunAt: Optional[str] = None
    createdAt: str
    updatedAt: str


class AutomationsResponse(BaseModel):
    connected: bool
    automations: List[AutomationMirror] = Field(default_factory=list)
    webUrl: Optional[str] = None
    error: Optional[str] = None
    errorCode: Optional[str] = None


def _automation_client(profile_id: str, authorization: Optional[str]) -> Optional[BlipostPlatformClient]:
    """Signed-in desktop identity first; legacy vault token as fallback."""
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return BlipostPlatformClient(
                base_url=get_settings().blipost_platform_base_url,
                token=value.strip(),
            )
    try:
        return get_client_for_profile(profile_id)
    except ValueError:
        return None


class PublishRequest(BaseModel):
    clip_id: str
    caption: str
    account_ids: List[str]
    schedule_date: Optional[str] = None  # ISO-8601; omitted = publish ASAP
    save_as_draft: bool = False


class PublishResponse(BaseModel):
    status: str
    job_id: Optional[str] = None
    message: str


class ClippingCreateRequest(BaseModel):
    source_media_id: str
    max_clips: int = Field(default=5, ge=1, le=20)
    duration_mode: str = "ai"
    target_duration_sec: Optional[int] = None
    captions: bool = True
    hook_overlay: bool = True
    keep_source: bool = True
    render_target: str = "desktop"
    language: Optional[str] = None
    whisper_quality: str = "fast"


class ClippingReviewRequest(BaseModel):
    highlights: List[Dict]


# ---- AI video generation (D2) ----

class VideoSubmitRequest(BaseModel):
    prompt: str
    model: str                       # "wan-2.5" | "kling-2.5-turbo" (validated server-side by web)
    duration_sec: int                # 5 | 10 (per contract)
    aspect_ratio: Optional[str] = None  # "16:9" | "9:16" | "1:1"
    keywords: List[str] = []         # phrase words so the clip matches the script slot


class VideoSubmitResponse(BaseModel):
    job_id: str
    credit_cost: Optional[float] = None
    remaining: Optional[float] = None


class VideoStatusResponse(BaseModel):
    status: str                      # pending | generating | processing | done | failed
    segment_id: Optional[str] = None
    source_video_id: Optional[str] = None
    keywords: List[str] = []
    duration: Optional[float] = None
    thumbnail_path: Optional[str] = None   # basename, served via /segments/files/{name}
    error: Optional[str] = None


# ============== CONNECTION MANAGEMENT ==============

@router.post("/session", response_model=BlipostSessionResponse)
async def create_blipost_session(body: BlipostSessionRequest):
    """Exchange real blipost.com credentials for the desktop Supabase session.

    The local backend only proxies the TLS request. The password is never
    logged or persisted, and the returned refresh token is stored by the
    Electron renderer's persistent Supabase client.
    """
    email = (body.email or "").strip().lower()
    if not email or not body.password:
        raise HTTPException(status_code=400, detail="Enter your Blipost email and password.")

    url = f"{get_settings().blipost_platform_base_url.rstrip('/')}/api/desktop/v1/session"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(url, json={"email": email, "password": body.password})
    except httpx.HTTPError as exc:
        logger.warning("Blipost identity bridge unavailable: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Could not reach blipost.com.") from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Invalid response from blipost.com.") from exc

    if response.status_code in {400, 401}:
        raise HTTPException(status_code=401, detail="Incorrect Blipost email or password.")
    if response.status_code == 403:
        raise HTTPException(status_code=403, detail=payload.get("error", "Blipost login is unavailable."))
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again later.")
    if response.status_code >= 500:
        raise HTTPException(status_code=502, detail=payload.get("error", "Blipost login is unavailable."))
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Unexpected response from blipost.com.")

    return BlipostSessionResponse(**payload)

def _store_token(profile_id: str, token: str) -> None:
    """Persist the token in the vault, replacing any existing one for this profile."""
    from app.services.credentials.vault import get_vault_manager
    vault = get_vault_manager()
    # Drop existing tokens first so re-connecting always swaps cleanly (max-3 limit safe).
    for key in vault.list_keys(profile_id, _VAULT_SERVICE):
        if not key.get("is_env_default"):
            try:
                vault.delete_key(profile_id, key["id"])
            except ValueError:
                pass
    vault.add_key(profile_id, _VAULT_SERVICE, _TOKEN_LABEL, token)


@router.post("/connect", response_model=MeResponse)
async def connect(body: ConnectRequest, profile: ProfileContext = Depends(get_profile_context)):
    """Validate a pasted platform token against the web server, then store it.

    Mirrors the Postiz 'Test Connection' behavior: a successful check auto-saves,
    so the user needs a single action. On success returns real email/plan/balance.
    """
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Paste your Blipost platform token.")

    base_url = get_settings().blipost_platform_base_url
    client = BlipostPlatformClient(base_url=base_url, token=token)

    try:
        me = await client.get_me()
    except BlipostAuthError:
        raise HTTPException(status_code=401, detail="Invalid or revoked token.")
    except BlipostRateLimitError:
        raise HTTPException(status_code=429, detail="Rate limited — try again in a moment.")
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("[Profile %s] Blipost connect failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not reach the Blipost server.")

    # Token is valid — persist it (encrypted) for this profile.
    try:
        _store_token(profile.profile_id, token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    logger.info("[Profile %s] Blipost account connected", profile.profile_id)
    return MeResponse(
        connected=True,
        email=me.get("email"),
        plan=me.get("plan"),
        balance=(me.get("credits") or {}).get("balance"),
    )


@router.get("/me", response_model=MeResponse)
async def me(profile: ProfileContext = Depends(get_profile_context)):
    """Return connection state + live credit balance for the active profile.

    Used by both the Settings card and the navbar balance indicator. Never errors
    hard — returns { connected: false } when no token, so callers stay simple.
    """
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError:
        return MeResponse(connected=False)

    try:
        data = await client.get_me()
    except BlipostAuthError:
        # Token was revoked on the web side — surface a clear, non-crashing state.
        return MeResponse(connected=True, error="Token invalid or revoked. Reconnect in Settings.")
    except BlipostPlatformError as e:
        return MeResponse(connected=True, error=str(e))
    except Exception as e:
        logger.warning("[Profile %s] Blipost /me failed: %s", profile.profile_id, e)
        return MeResponse(connected=True, error="Could not reach the Blipost server.")

    return MeResponse(
        connected=True,
        email=data.get("email"),
        plan=data.get("plan"),
        balance=(data.get("credits") or {}).get("balance"),
    )


@router.delete("/disconnect")
async def disconnect(profile: ProfileContext = Depends(get_profile_context)):
    """Remove the stored token — desktop reverts to the Postiz path."""
    from app.services.credentials.vault import get_vault_manager
    vault = get_vault_manager()
    for key in vault.list_keys(profile.profile_id, _VAULT_SERVICE):
        if not key.get("is_env_default"):
            try:
                vault.delete_key(profile.profile_id, key["id"])
            except ValueError:
                pass
    logger.info("[Profile %s] Blipost account disconnected", profile.profile_id)
    return {"status": "disconnected"}


@router.get("/accounts", response_model=List[PlatformAccount])
async def accounts(profile: ProfileContext = Depends(get_profile_context)):
    """List the web account's connected social accounts. Empty list if not connected."""
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError:
        return []

    try:
        raw = await client.get_accounts()
    except BlipostAuthError:
        raise HTTPException(status_code=401, detail="Token invalid or revoked.")
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("[Profile %s] Blipost /accounts failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not load accounts.")

    return [
        PlatformAccount(
            id=a.get("id"),
            platform=a.get("platform", ""),
            handle=a.get("handle"),
            displayName=a.get("displayName"),
            status=a.get("status"),
        )
        for a in raw
        if a.get("id")
    ]


@router.get("/automations", response_model=AutomationsResponse)
async def automations(
    profile: ProfileContext = Depends(get_profile_context),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Load canonical web workflows for the signed-in desktop identity.

    Legacy profile tokens remain supported, but a normal authenticated desktop
    session no longer needs a second token pasted in Settings. The web Platform
    API validates the forwarded Supabase session against its configured trusted
    project and maps its verified email to the web account.
    """
    base_url = get_settings().blipost_platform_base_url
    client = _automation_client(profile.profile_id, authorization)
    if client is None:
        return AutomationsResponse(
            connected=False,
            webUrl=base_url,
            error="Your desktop session could not be forwarded to Blipost web.",
            errorCode="desktop_session_missing",
        )

    try:
        # Validate the token first. A production server that does not have the
        # mirror endpoint yet returns 404 before auth, which would otherwise
        # hide a revoked token behind the misleading message "Not found".
        await client.get_me()
        rows = await client.get_automations()
    except BlipostAuthError:
        return AutomationsResponse(
            connected=False,
            webUrl=base_url,
            error="Your Blipost web workspace could not be matched to this signed-in desktop account.",
            errorCode="identity_not_linked",
        )
    except BlipostNotFoundError:
        return AutomationsResponse(
            connected=True,
            webUrl=base_url,
            error="Cloud Automations is not available on the connected Blipost server yet.",
            errorCode="endpoint_unavailable",
        )
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("[Profile %s] Blipost /automations failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not load cloud automations.")

    mirrors = []
    for row in rows:
        if not row.get("id") or not isinstance(row.get("definition"), dict):
            continue
        try:
            mirrors.append(AutomationMirror(**row))
        except Exception:
            logger.warning("Skipped malformed automation mirror row %s", row.get("id"))

    return AutomationsResponse(connected=True, automations=mirrors, webUrl=base_url)


@router.post("/automations", response_model=AutomationMirror)
async def create_automation(
    body: Dict,
    profile: ProfileContext = Depends(get_profile_context),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    client = _automation_client(profile.profile_id, authorization)
    if client is None:
        raise HTTPException(status_code=401, detail="Desktop cloud session is unavailable.")
    try:
        return AutomationMirror(**(await client.create_automation(body)))
    except Exception as error:
        _raise_platform_bridge_error(error)


@router.patch("/automations/{automation_id}", response_model=AutomationMirror)
async def update_automation(
    automation_id: str,
    body: Dict,
    profile: ProfileContext = Depends(get_profile_context),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    client = _automation_client(profile.profile_id, authorization)
    if client is None:
        raise HTTPException(status_code=401, detail="Desktop cloud session is unavailable.")
    try:
        return AutomationMirror(**(await client.update_automation(automation_id, body)))
    except Exception as error:
        _raise_platform_bridge_error(error)


@router.delete("/automations/{automation_id}")
async def delete_automation(
    automation_id: str,
    profile: ProfileContext = Depends(get_profile_context),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    client = _automation_client(profile.profile_id, authorization)
    if client is None:
        raise HTTPException(status_code=401, detail="Desktop cloud session is unavailable.")
    try:
        await client.delete_automation(automation_id)
        return {"ok": True}
    except Exception as error:
        _raise_platform_bridge_error(error)


# ============== SHARED CLOUD MEDIA + CLIPPING ==============

def _raise_platform_bridge_error(error: Exception) -> None:
    if isinstance(error, BlipostAuthError):
        raise HTTPException(status_code=401, detail="Token invalid or revoked.")
    if isinstance(error, BlipostCreditsError):
        detail = str(error)
        if error.balance is not None:
            detail = f"{detail} Balance: {error.balance:g} credits."
        raise HTTPException(status_code=402, detail=detail)
    if isinstance(error, BlipostRateLimitError):
        raise HTTPException(status_code=429, detail=str(error))
    if isinstance(error, BlipostNotFoundError):
        raise HTTPException(status_code=404, detail=str(error))
    if isinstance(error, BlipostPlatformError):
        raise HTTPException(status_code=502, detail=str(error))
    raise error


@router.get("/media")
async def cloud_media(
    origin: Optional[str] = Query(default=None),
    kind: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=100),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Read the same canonical media library shown by the web app."""
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError:
        return {"connected": False, "media": []}
    try:
        rows = await client.get_media(limit=limit, origin=origin, kind=kind)
    except Exception as error:
        _raise_platform_bridge_error(error)
    return {"connected": True, "media": rows}


@router.post("/media/upload")
async def upload_cloud_media(
    file: UploadFile = File(...),
    profile: ProfileContext = Depends(get_profile_context),
):
    """Stage an Electron upload on disk, then stream it to the web account's R2
    library. The staging file is always removed, including failed uploads."""
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    raw_filename = Path(file.filename or "source-video").name
    filename = (
        "".join(char if char.isalnum() or char in "._-" else "_" for char in raw_filename)
        or "source-video"
    )
    content_type = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    if not any(content_type.startswith(prefix) for prefix in ("video/", "image/", "audio/")):
        raise HTTPException(status_code=400, detail="Upload an image, video, or audio file.")
    temp_dir = get_settings().base_dir / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = temp_dir / f"platform-{uuid.uuid4().hex}-{filename}"
    try:
        with temp_path.open("wb") as destination:
            await asyncio.to_thread(shutil.copyfileobj, file.file, destination, 8 * 1024 * 1024)
        media_id = await client.upload_media_file(temp_path, content_type, origin="upload")
        return {"mediaId": media_id}
    except Exception as error:
        _raise_platform_bridge_error(error)
    finally:
        await file.close()
        temp_path.unlink(missing_ok=True)


@router.get("/clipping")
async def clipping_jobs(
    limit: int = Query(default=20, ge=1, le=50),
    profile: ProfileContext = Depends(get_profile_context),
):
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError:
        return {"connected": False, "jobs": []}
    try:
        jobs = await client.list_clipping_jobs(limit)
    except Exception as error:
        _raise_platform_bridge_error(error)
    return {"connected": True, "jobs": jobs}


@router.post("/clipping")
async def create_clipping(
    request: ClippingCreateRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    if request.duration_mode not in {"ai", "exact"}:
        raise HTTPException(status_code=400, detail="duration_mode must be ai or exact")
    if request.duration_mode == "exact" and request.target_duration_sec not in {10, 15, 20, 30}:
        raise HTTPException(status_code=400, detail="Exact duration must be 10, 15, 20, or 30 seconds")
    if request.render_target not in {"cloud", "desktop"}:
        raise HTTPException(status_code=400, detail="render_target must be cloud or desktop")
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    params = {
        "maxClips": request.max_clips,
        "durationMode": request.duration_mode,
        "targetDurationSec": request.target_duration_sec,
        "captions": request.captions,
        "captionStyles": ["karaoke" if request.captions else "none"],
        "hookOverlay": request.hook_overlay,
        "keepSource": request.keep_source,
        "renderTarget": request.render_target,
        "language": request.language,
        "whisperQuality": "accurate" if request.whisper_quality == "accurate" else None,
        "autoDispatch": False,
    }
    try:
        return await client.create_clipping_job(request.source_media_id, params)
    except Exception as error:
        _raise_platform_bridge_error(error)


@router.get("/clipping/{job_id}")
async def clipping_job(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    try:
        client = get_client_for_profile(profile.profile_id)
        return await client.get_clipping_job(job_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        _raise_platform_bridge_error(error)


@router.patch("/clipping/{job_id}/highlights")
async def review_clipping_job(
    job_id: str,
    request: ClippingReviewRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    try:
        client = get_client_for_profile(profile.profile_id)
        return await client.confirm_clipping_highlights(job_id, request.highlights)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        _raise_platform_bridge_error(error)


# ============== PUBLISHING (runs beside the Postiz path) ==============

def _resolve_clip_video(clip_id: str, profile_id: str) -> Path:
    """Verify the clip is rendered + owned by this profile; return its video path."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    try:
        result = repo.table_query(
            "editai_clips", "select",
            filters=QueryFilters(
                select="*, editai_projects!inner(profile_id)",
                eq={"id": clip_id}, limit=1,
            ),
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Clip not found")
    if not result.data:
        raise HTTPException(status_code=404, detail="Clip not found")

    clip = result.data[0]
    if clip["editai_projects"]["profile_id"] != profile_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    if not clip.get("final_video_path"):
        raise HTTPException(status_code=400, detail="Clip must be rendered before publishing.")

    video_path = Path(clip["final_video_path"])
    if not video_path.exists():
        video_path = get_settings().output_dir / clip["final_video_path"]
        if not video_path.exists():
            raise HTTPException(status_code=404, detail="Video file not found on disk")
    return video_path


@router.post("/publish", response_model=PublishResponse)
async def publish(
    background_tasks: BackgroundTasks,
    request: PublishRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Publish a rendered clip to the web account's social accounts via the Platform API."""
    if not request.account_ids:
        raise HTTPException(status_code=400, detail="Select at least one account")

    # Fail fast if not connected.
    try:
        get_client_for_profile(profile.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    video_path = _resolve_clip_video(request.clip_id, profile.profile_id)

    schedule_dt = None
    if request.schedule_date:
        try:
            schedule_dt = datetime.fromisoformat(request.schedule_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid schedule_date format. Use ISO format.")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _publish_task,
        job_id=job_id,
        profile_id=profile.profile_id,
        clip_id=request.clip_id,
        video_path=str(video_path),
        caption=request.caption,
        account_ids=request.account_ids,
        schedule_dt=schedule_dt,
        save_as_draft=request.save_as_draft,
    )
    return PublishResponse(
        status="processing",
        job_id=job_id,
        message=f"Publishing to {len(request.account_ids)} account(s) via Blipost...",
    )


@router.get("/publish/{job_id}/progress")
async def publish_progress(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Poll a publish job's progress (same shape as the Postiz progress endpoint)."""
    progress = get_publish_progress(job_id, profile.profile_id)
    if not progress:
        return {"status": "not_found", "percentage": 0}
    result = dict(progress)
    if result.get("status") == "failed":
        raw_step = result.get("step", "")
        error_detail = raw_step
        for prefix in ("Error: ", "Failed: "):
            if raw_step.startswith(prefix):
                error_detail = raw_step[len(prefix):]
                break
        result["error_detail"] = error_detail
    return result


@router.get("/posts/{post_id}")
async def get_post(post_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Fetch a published post's status + per-target results from the web account."""
    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await client.get_post(post_id)
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("[Profile %s] Blipost get_post failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not fetch post status.")


async def _publish_task(
    job_id: str,
    profile_id: str,
    clip_id: str,
    video_path: str,
    caption: str,
    account_ids: List[str],
    schedule_dt: Optional[datetime],
    save_as_draft: bool,
):
    """Background: upload media to R2 → create post via Platform API → track progress."""
    logger.info("[Profile %s] Blipost publish clip %s (job %s)", profile_id, clip_id, job_id)
    update_publish_progress(job_id, "Initializing...", 0, profile_id=profile_id)

    try:
        client = get_client_for_profile(profile_id)

        path = Path(video_path)
        data = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "video/mp4"

        # 1. Request a presigned slot, then PUT the bytes.
        update_publish_progress(job_id, "Requesting upload slot...", 15, profile_id=profile_id)
        slot = await client.request_media_upload(path.name, content_type, len(data))
        media_id = slot.get("mediaId")
        upload_url = slot.get("uploadUrl")
        if not media_id or not upload_url:
            raise BlipostPlatformError("Server did not return an upload slot.")

        update_publish_progress(job_id, "Uploading video...", 40, profile_id=profile_id)
        await client.upload_media_bytes(upload_url, data, content_type)

        # 2. Create the post. The Platform API requires scheduledAt ≥30s in the
        #    future OR draft:true — there is no immediate-publish. For "publish now"
        #    we schedule ~1 min out so the web worker picks it up ASAP.
        # ponytail: +60s ASAP window; expose a real "publish now" only if the web API adds one.
        scheduled_at = None
        if not save_as_draft:
            when = schedule_dt or (datetime.now(timezone.utc) + timedelta(seconds=60))
            scheduled_at = when.isoformat()

        update_publish_progress(job_id, "Creating post...", 75, profile_id=profile_id)
        result = await client.create_post(
            text=caption,
            account_ids=account_ids,
            media_ids=[media_id],
            scheduled_at=scheduled_at,
            draft=save_as_draft,
        )

        post_id = result.get("id")
        status_label = result.get("status", "scheduled")
        # Best-effort tracking row, mirroring the Postiz publications table.
        repo = get_repository()
        if repo and post_id:
            try:
                repo.table_query("editai_postiz_publications", "insert", data={
                    "clip_id": clip_id,
                    "profile_id": profile_id,
                    "postiz_post_id": f"blipost:{post_id}",
                    "platform": "blipost",
                    "caption": (caption or "")[:500],
                    "scheduled_at": scheduled_at,
                    "published_at": None,
                    "status": "draft" if save_as_draft else "scheduled",
                })
            except Exception as e:
                logger.warning("Failed to track Blipost publication: %s", e)

        msg = "Saved as draft!" if save_as_draft else f"Post {status_label} via Blipost!"
        update_publish_progress(job_id, msg, 100, "completed", profile_id=profile_id)

    except BlipostCreditsError as e:
        bal = f" (balance: {e.balance})" if e.balance is not None else ""
        update_publish_progress(
            job_id,
            f"Failed: Insufficient credits{bal}",
            100,
            "failed",
            profile_id=profile_id,
        )
    except BlipostAuthError:
        update_publish_progress(
            job_id, "Failed: Token invalid or revoked", 100, "failed", profile_id=profile_id
        )
    except Exception as e:
        logger.error("Blipost publish job %s failed: %s", job_id, e)
        update_publish_progress(
            job_id, f"Error: {str(e)}", 100, "failed", profile_id=profile_id
        )


# ============== AI VIDEO GENERATION (D2 — on platform credits) ==============

def _credits_detail(e: BlipostCreditsError) -> str:
    bal = f" (balance: {e.balance})" if e.balance is not None else ""
    return f"Insufficient credits{bal}. Top up on blipost.com."


def _keywords_from_prompt(prompt: str) -> List[str]:
    """Fallback keywords when the caller sent none: the prompt's longer words."""
    words = [w.strip(".,!?\"'").lower() for w in (prompt or "").split()]
    kw = [w for w in words if len(w) > 3][:6]
    return kw or ["ai"]


@router.post("/videos", response_model=VideoSubmitResponse)
async def submit_video(body: VideoSubmitRequest, profile: ProfileContext = Depends(get_profile_context)):
    """Submit an AI video job to the platform (metered on credits)."""
    prompt = (body.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required.")

    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await client.submit_video(prompt, body.model, body.duration_sec, body.aspect_ratio)
    except BlipostCreditsError as e:
        raise HTTPException(status_code=402, detail=_credits_detail(e))
    except BlipostAuthError:
        raise HTTPException(status_code=401, detail="Token invalid or revoked.")
    except BlipostRateLimitError:
        raise HTTPException(status_code=429, detail="Rate limited — try again in a moment.")
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error("[Profile %s] Blipost submit_video failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not reach the Blipost server.")

    job_id = result.get("jobId")
    if not job_id:
        raise HTTPException(status_code=502, detail="Platform did not return a job id.")

    _video_jobs[job_id] = {
        "keywords": [k for k in (body.keywords or []) if k and k.strip()],
        "prompt": prompt,
        "duration_sec": body.duration_sec,
        "profile_id": profile.profile_id,
    }
    _video_owners[job_id] = profile.profile_id
    logger.info("[Profile %s] AI video job %s submitted (cost=%s)", profile.profile_id, job_id, result.get("creditCost"))
    return VideoSubmitResponse(
        job_id=job_id,
        credit_cost=result.get("creditCost"),
        remaining=result.get("remaining"),
    )


def _assert_video_owner(job_id: str, profile_id: str) -> None:
    """A video job may only be polled by the profile that submitted (and paid
    for) it — the active profile can change between submit and poll (X-Profile-Id
    is read live from the client), which would otherwise file the clip under the
    wrong profile or leak another profile's result. Mirror _resolve_clip_video:
    404 on mismatch (don't reveal another profile's job).
    ponytail: ownership is in-memory, so a job whose owner record didn't survive
    a restart is allowed through — the credit was already charged and we can't do
    better; the accidental-misfile window that motivates this check is same-process."""
    owner = _video_owners.get(job_id)
    if owner is not None and owner != profile_id:
        raise HTTPException(status_code=404, detail="Video job not found.")


@router.get("/videos/{job_id}", response_model=VideoStatusResponse)
async def video_status(job_id: str, profile: ProfileContext = Depends(get_profile_context)):
    """Poll an AI video job. On 'done', download the clip once and register it as
    a normal segment; return the segment id so the pipeline can use it."""
    _assert_video_owner(job_id, profile.profile_id)
    # Already imported? Return the cached segment result (idempotent poll).
    cached = _video_registrations.get(job_id)
    if cached:
        return VideoStatusResponse(**cached)

    try:
        client = get_client_for_profile(profile.profile_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        data = await client.get_video(job_id)
    except BlipostAuthError:
        raise HTTPException(status_code=401, detail="Token invalid or revoked.")
    except BlipostPlatformError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.warning("[Profile %s] Blipost get_video failed: %s", profile.profile_id, e)
        raise HTTPException(status_code=502, detail="Could not reach the Blipost server.")

    status = (data.get("status") or "").lower()
    if status == "failed":
        return VideoStatusResponse(status="failed", error="Generation failed — credits were refunded automatically on the platform.")
    if status != "done":
        # pending / generating / processing — keep the UI polling.
        return VideoStatusResponse(status=status or "generating")

    # done — download + register exactly once (guard against concurrent polls).
    lock = _video_locks.setdefault(job_id, asyncio.Lock())
    async with lock:
        cached = _video_registrations.get(job_id)
        if cached:
            return VideoStatusResponse(**cached)

        download_url = data.get("downloadUrl")
        if not download_url:
            raise HTTPException(status_code=502, detail="Job done but no download URL was returned.")

        meta = _video_jobs.get(job_id, {})
        keywords = meta.get("keywords") or _keywords_from_prompt(meta.get("prompt", ""))
        try:
            result = await _register_ai_clip_as_segment(
                client=client,
                download_url=download_url,
                profile_id=profile.profile_id,
                keywords=keywords,
                prompt=meta.get("prompt", "AI clip"),
                fallback_duration=float(meta.get("duration_sec") or 0) or None,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("AI clip registration failed for job %s: %s", job_id, e)
            raise HTTPException(status_code=502, detail="Clip was generated but could not be imported as a segment.")

        _video_registrations[job_id] = result
        _video_jobs.pop(job_id, None)  # metadata no longer needed
        return VideoStatusResponse(**result)


async def _register_ai_clip_as_segment(
    client: BlipostPlatformClient,
    download_url: str,
    profile_id: str,
    keywords: List[str],
    prompt: str,
    fallback_duration: Optional[float],
) -> dict:
    """Download the generated mp4 and register it as a source video + one segment
    spanning the whole clip — the same ingest path a cut-from-footage segment uses."""
    # Reuse the segment-ingest helpers (ffprobe metadata + ffmpeg thumbnail).
    from app.api.segments_routes import _get_video_info, _generate_thumbnail

    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    settings = get_settings()
    data = await client.download_bytes(download_url)

    video_id = str(uuid.uuid4())
    source_dir = settings.base_dir / "source_videos"
    source_dir.mkdir(parents=True, exist_ok=True)
    video_path = source_dir / f"{video_id}_ai.mp4"
    video_path.write_bytes(data)

    # Metadata + thumbnails (ffmpeg/ffprobe are blocking — offload to threads).
    info = await asyncio.to_thread(_get_video_info, video_path)
    duration = float(info.get("duration") or 0) or (fallback_duration or 0.0)
    if duration <= 0:
        video_path.unlink(missing_ok=True)
        raise HTTPException(status_code=502, detail="Generated clip has no readable duration.")

    src_thumb = source_dir / f"{video_id}_thumb.jpg"
    await asyncio.to_thread(_generate_thumbnail, video_path, src_thumb, 1)

    name = prompt if len(prompt) <= 60 else prompt[:59] + "…"
    repo.create_source_video({
        "id": video_id,
        "profile_id": profile_id,
        "name": f"AI: {name}",
        "description": prompt,
        "file_path": str(video_path),
        "thumbnail_path": str(src_thumb) if src_thumb.exists() else None,
        "duration": duration,
        "width": info.get("width"),
        "height": info.get("height"),
        "fps": info.get("fps"),
        "file_size_bytes": info.get("file_size_bytes"),
        "segments_count": 1,
        "status": "ready",
    })

    segment_id = str(uuid.uuid4())
    segments_dir = settings.base_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    seg_thumb = segments_dir / f"{segment_id}_thumb.jpg"
    await asyncio.to_thread(_generate_thumbnail, video_path, seg_thumb, duration / 2)

    repo.create_segment({
        "id": segment_id,
        "source_video_id": video_id,
        "profile_id": profile_id,
        "start_time": 0.0,
        "end_time": duration,
        "keywords": keywords,
        "notes": f"AI-generated: {prompt}"[:500],
        "thumbnail_path": str(seg_thumb) if seg_thumb.exists() else None,
        "usage_count": 0,
        "is_favorite": False,
        "single_use": False,
    })

    logger.info("[Profile %s] AI clip registered as segment %s (%.1fs)", profile_id, segment_id, duration)
    return {
        "status": "done",
        "segment_id": segment_id,
        "source_video_id": video_id,
        "keywords": keywords,
        "duration": duration,
        # basename only — the timeline serves it via /segments/files/{name} and
        # split('/') would not split a Windows path.
        "thumbnail_path": seg_thumb.name if seg_thumb.exists() else None,
    }
