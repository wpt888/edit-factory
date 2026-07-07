"""
Blipost Platform bridge routes (phase U1).

Connects the desktop app to a Blipost web account via a pasted platform token
(format `blp_*`, stored Fernet-encrypted in the vault under service
`blipost_platform`). Exposes credit balance, connected social accounts, and a
publish path that runs alongside the existing Postiz/Buffer flow.

The token never appears in responses or logs — only masked hints and balances.
"""
import logging
import mimetypes
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import ProfileContext, get_profile_context
from app.config import get_settings
from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters
from app.services.blipost_platform_client import (
    BlipostAuthError,
    BlipostCreditsError,
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


# ============== MODELS ==============

class ConnectRequest(BaseModel):
    token: str


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


# ============== CONNECTION MANAGEMENT ==============

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
    progress = get_publish_progress(job_id)
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
    update_publish_progress(job_id, "Initializing...", 0)

    try:
        client = get_client_for_profile(profile_id)

        path = Path(video_path)
        data = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "video/mp4"

        # 1. Request a presigned slot, then PUT the bytes.
        update_publish_progress(job_id, "Requesting upload slot...", 15)
        slot = await client.request_media_upload(path.name, content_type, len(data))
        media_id = slot.get("mediaId")
        upload_url = slot.get("uploadUrl")
        if not media_id or not upload_url:
            raise BlipostPlatformError("Server did not return an upload slot.")

        update_publish_progress(job_id, "Uploading video...", 40)
        await client.upload_media_bytes(upload_url, data, content_type)

        # 2. Create the post. The Platform API requires scheduledAt ≥30s in the
        #    future OR draft:true — there is no immediate-publish. For "publish now"
        #    we schedule ~1 min out so the web worker picks it up ASAP.
        # ponytail: +60s ASAP window; expose a real "publish now" only if the web API adds one.
        scheduled_at = None
        if not save_as_draft:
            when = schedule_dt or (datetime.now(timezone.utc) + timedelta(seconds=60))
            scheduled_at = when.isoformat()

        update_publish_progress(job_id, "Creating post...", 75)
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
        update_publish_progress(job_id, msg, 100, "completed")

    except BlipostCreditsError as e:
        bal = f" (balance: {e.balance})" if e.balance is not None else ""
        update_publish_progress(job_id, f"Failed: Insufficient credits{bal}", 100, "failed")
    except BlipostAuthError:
        update_publish_progress(job_id, "Failed: Token invalid or revoked", 100, "failed")
    except Exception as e:
        logger.error("Blipost publish job %s failed: %s", job_id, e)
        update_publish_progress(job_id, f"Error: {str(e)}", 100, "failed")
