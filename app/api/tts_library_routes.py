"""
TTS Library API Routes

CRUD endpoints for managing persistent TTS assets (MP3 + SRT files).
Supports create, edit (with auto-regeneration), delete, and audio/SRT serving.
"""
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import AuthUser, ProfileContext, get_current_user, get_profile_context
from app.api.validators import validate_tts_text_length
from app.config import get_settings
from app.services.job_storage import get_job_storage
from app.services.studio_metering import (
    MeteringIdentity,
    StudioMeteringBlocked,
    new_metering_record,
    reserve_metering_record,
    settle_metering_record,
)
from app.services.tts_library_service import get_tts_library_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts-library", tags=["TTS Library"])

_PROCESS_INSTANCE_ID = uuid.uuid4().hex
_TTS_LIBRARY_JOB_TYPE = "tts_library_asset"
_TERMINAL_METERING_STATES = frozenset({"captured", "released", "refunded", "denied"})

from app.repositories.factory import get_repository
from app.repositories.models import QueryFilters


class _TTSLibraryCancelled(Exception):
    pass


def _asset_job_project_id(asset_id: str) -> str:
    return f"tts-library:{asset_id}"


def _replace_tts_library_metering(job_id: str, record: dict) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    return storage.update_job(
        job_id,
        {"metering": dict(record)},
        profile_id=job.get("profile_id"),
    ) or {**job, "metering": dict(record)}


async def _recover_tts_library_reservation_for_settlement(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Replay a reserve whose response may have been lost, then settle it safely."""
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict):
        return job
    if (
        record.get("reservation_id")
        or record.get("provider_started")
        or record.get("state") != "reserve_pending"
    ):
        return job
    user_id = record.get("supabase_user_id") or fallback_user_id
    if not isinstance(user_id, str) or not user_id:
        return job
    try:
        recovered = await reserve_metering_record(
            MeteringIdentity(user_id, record.get("email")),
            record,
        )
    except StudioMeteringBlocked as error:
        recovered = {
            **record,
            "state": "denied" if error.code == "insufficient_credits" else "reserve_pending",
            "last_error": error.as_http_detail(),
        }
    return _replace_tts_library_metering(job_id, recovered)


async def _settle_tts_library_metering(
    job_id: str,
    user_id: str,
    *,
    delivered: bool,
) -> dict:
    storage = get_job_storage()
    if not delivered:
        job = await _recover_tts_library_reservation_for_settlement(job_id, user_id)
    else:
        job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict) or not record.get("reservation_id"):
        return job
    terminal = {"captured"} if delivered else {"released", "refunded"}
    if record.get("state") in terminal:
        return job
    settled = await settle_metering_record(
        MeteringIdentity(user_id),
        record,
        delivered=delivered,
        result_metadata={
            "studio_job_id": job_id,
            "output_id": job.get("asset_id"),
        } if delivered else None,
    )
    return _replace_tts_library_metering(job_id, settled)


async def _reserve_tts_library_metering(
    job_id: str,
    identity: MeteringIdentity,
) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict):
        raise RuntimeError("TTS Library job has no durable metering record")

    reserve_pending = {**record, "state": "reserve_pending"}
    _replace_tts_library_metering(job_id, reserve_pending)
    try:
        reserved = await reserve_metering_record(identity, reserve_pending)
    except StudioMeteringBlocked as error:
        failed_record = {
            **reserve_pending,
            "state": (
                "denied"
                if error.code == "insufficient_credits"
                else "reserve_pending"
            ),
            "last_error": error.as_http_detail(),
        }
        _replace_tts_library_metering(job_id, failed_record)
        storage.update_job(
            job_id,
            {
                "status": "failed",
                "progress": "Blipost credits required",
                "status_code": 402,
                "error": error.as_http_detail()["message"],
                "error_detail": error.as_http_detail(),
            },
            profile_id=job.get("profile_id"),
        )
        await _settle_tts_library_metering(
            job_id,
            identity.supabase_user_id,
            delivered=False,
        )
        raise
    return _replace_tts_library_metering(job_id, reserved)


def _mark_tts_library_provider_started(job_id: str) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = dict(job.get("metering") or {})
    if record:
        record["provider_started"] = True
        _replace_tts_library_metering(job_id, record)
    return storage.update_job(
        job_id,
        {"status": "processing", "progress": "Generating voice-over"},
        profile_id=job.get("profile_id"),
    ) or job


async def _reconcile_tts_library_job(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Finish capture/refund after a settlement failure or backend restart."""
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict) or record.get("state") in _TERMINAL_METERING_STATES:
        return job

    active_here = (
        job.get("status") in {"pending", "processing"}
        and job.get("process_instance_id") == _PROCESS_INSTANCE_ID
    )
    if active_here:
        return job

    user_id = record.get("supabase_user_id") or job.get("user_id") or fallback_user_id
    if not isinstance(user_id, str) or not user_id:
        return job

    delivered = bool(job.get("output_persisted"))
    reconciled = await _settle_tts_library_metering(
        job_id,
        user_id,
        delivered=delivered,
    )
    latest = storage.get_job(job_id) or reconciled
    if latest.get("status") in {"pending", "processing"}:
        storage.update_job(
            job_id,
            {
                "status": "completed" if delivered else "failed",
                "progress": "Ready" if delivered else "Interrupted before output was saved",
                "error": None if delivered else "TTS generation was interrupted by a backend restart",
            },
            profile_id=latest.get("profile_id"),
        )
    return storage.get_job(job_id) or latest


async def _reconcile_profile_tts_library_jobs(profile_id: str, user_id: str) -> None:
    for job in get_job_storage().list_jobs(profile_id=profile_id, limit=100):
        if job.get("job_type") != _TTS_LIBRARY_JOB_TYPE:
            continue
        record = job.get("metering")
        if not isinstance(record, dict) or record.get("state") in _TERMINAL_METERING_STATES:
            continue
        await _reconcile_tts_library_job(job.get("job_id"), user_id)


async def _reconcile_tts_asset_jobs(asset_id: str, user_id: str) -> None:
    for job in get_job_storage().get_jobs_by_project(_asset_job_project_id(asset_id)):
        if job.get("job_type") == _TTS_LIBRARY_JOB_TYPE:
            await _reconcile_tts_library_job(job.get("job_id"), user_id)


# ============== PYDANTIC MODELS ==============


class CheckDuplicatesRequest(BaseModel):
    texts: List[str]


class TTSAssetCreate(BaseModel):
    tts_text: str
    tts_model: str = "eleven_flash_v2_5"


class TTSAssetUpdate(BaseModel):
    tts_text: str


class TTSAssetResponse(BaseModel):
    id: str
    job_id: Optional[str] = None
    tts_text: str
    mp3_url: Optional[str] = None
    srt_url: Optional[str] = None
    srt_content: Optional[str] = None
    audio_duration: float = 0.0
    char_count: int = 0
    tts_model: str = "eleven_flash_v2_5"
    status: str = "ready"
    is_used: bool = False
    created_at: str = ""
    updated_at: str = ""


async def _run_tts_library_generation(
    *,
    job_id: str,
    asset_id: str,
    text: str,
    profile_id: str,
    user_id: str,
    model: str,
    previous_asset: Optional[dict] = None,
) -> None:
    """Generate one durable asset after its credit reservation is executable."""
    storage = get_job_storage()
    generated_result: Optional[dict] = None
    generation_asset_id = asset_id if previous_asset is None else f"{asset_id}_{job_id[:8]}"
    try:
        if storage.is_job_cancelled(job_id):
            raise _TTSLibraryCancelled("TTS Library generation cancelled before provider start")

        _mark_tts_library_provider_started(job_id)
        tts_lib = get_tts_library_service()
        generated_result = await tts_lib.generate_asset(
            text=text,
            profile_id=profile_id,
            asset_id=generation_asset_id,
            model=model,
        )

        if storage.is_job_cancelled(job_id):
            raise _TTSLibraryCancelled("TTS Library generation cancelled before persistence")

        bg_repo = get_repository()
        if not bg_repo:
            raise RuntimeError("Database not available while saving TTS asset")
        bg_repo.table_query("editai_tts_assets", "update", data={
            "tts_text": text,
            "mp3_path": generated_result["mp3_path"],
            "srt_path": generated_result["srt_path"],
            "srt_content": generated_result["srt_content"],
            "audio_duration": generated_result["audio_duration"],
            "char_count": generated_result["char_count"],
            "tts_timestamps": generated_result["tts_timestamps"],
            "tts_voice_id": generated_result["tts_voice_id"],
            "status": "ready",
            "error_message": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, filters=QueryFilters(eq={"id": asset_id, "profile_id": profile_id}))

        storage.update_job(
            job_id,
            {
                "output_persisted": True,
                "progress": "Capturing credits",
                "result": {"asset_id": asset_id},
            },
            profile_id=profile_id,
        )
        if previous_asset:
            tts_lib.delete_asset_files(
                previous_asset.get("mp3_path"),
                previous_asset.get("srt_path"),
            )
        await _settle_tts_library_metering(job_id, user_id, delivered=True)
        storage.update_job(
            job_id,
            {"status": "completed", "progress": "Ready", "error": None},
            profile_id=profile_id,
        )
        logger.info("TTS asset %s generated successfully", asset_id)
    except Exception as error:
        cancelled = isinstance(error, _TTSLibraryCancelled)
        logger.error("TTS asset %s generation failed: %s", asset_id, error)
        latest = storage.get_job(job_id) or {}
        delivered = bool(latest.get("output_persisted"))
        if generated_result and not delivered:
            try:
                get_tts_library_service().delete_asset_files(
                    generated_result.get("mp3_path"),
                    generated_result.get("srt_path"),
                )
            except Exception as cleanup_error:
                logger.warning(
                    "Could not clean uncommitted TTS asset output %s: %s",
                    generation_asset_id,
                    cleanup_error,
                )
        try:
            bg_repo = get_repository()
            if bg_repo:
                if previous_asset:
                    restore = {
                        "tts_text": previous_asset.get("tts_text", ""),
                        "char_count": previous_asset.get("char_count", 0),
                        "status": previous_asset.get("status") or "ready",
                        "error_message": previous_asset.get("error_message"),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                else:
                    restore = {
                        "status": "failed",
                        "error_message": str(error),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                bg_repo.table_query(
                    "editai_tts_assets",
                    "update",
                    data=restore,
                    filters=QueryFilters(eq={"id": asset_id, "profile_id": profile_id}),
                )
        except Exception as persistence_error:
            logger.error(
                "Could not persist failed TTS asset state %s: %s",
                asset_id,
                persistence_error,
            )

        await _settle_tts_library_metering(job_id, user_id, delivered=delivered)
        if latest.get("status") != "cancelled":
            storage.update_job(
                job_id,
                {
                    "status": "cancelled" if cancelled else "failed",
                    "progress": "Cancelled" if cancelled else "Generation failed",
                    "error": str(error),
                },
                profile_id=profile_id,
            )


# ============== ENDPOINTS ==============


@router.post("/check-duplicates")
async def check_duplicates(
    request: CheckDuplicatesRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Check if any of the provided texts already exist in the TTS library."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    if not request.texts:
        return {"matches": {}}

    if len(request.texts) > 500:
        raise HTTPException(status_code=400, detail="Too many texts (max 500)")

    # Fetch all ready assets for the profile (include mp3_path for existence check)
    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            select="id, tts_text, audio_duration, mp3_path",
            eq={"profile_id": profile.profile_id, "status": "ready"},
        ))

    assets = result.data or []

    # Build lookup: normalized text -> asset info (only if audio file exists on disk)
    asset_lookup = {}
    for asset in assets:
        normalized = (asset.get("tts_text") or "").strip()
        mp3_path = asset.get("mp3_path")
        if normalized and mp3_path and Path(mp3_path).exists():
            asset_lookup[normalized] = {
                "asset_id": asset["id"],
                "audio_duration": asset.get("audio_duration", 0.0),
            }

    # Match each input text by index
    matches = {}
    for i, text in enumerate(request.texts):
        normalized = text.strip()
        if normalized in asset_lookup:
            matches[str(i)] = asset_lookup[normalized]

    return {"matches": matches}


@router.get("/", response_model=List[TTSAssetResponse])
async def list_tts_assets(
    profile: ProfileContext = Depends(get_profile_context),
):
    """List all TTS assets for the current profile, with is_used badge."""
    await _reconcile_profile_tts_library_jobs(profile.profile_id, profile.user_id)
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Fetch assets
    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            eq={"profile_id": profile.profile_id},
            order_by="created_at",
            order_desc=True,
        ))

    assets = result.data or []

    # Fetch used texts from clip_content for this profile's recent clips
    used_texts = set()
    try:
        clips_result = repo.table_query("editai_clips", "select",
            filters=QueryFilters(
                select="id",
                eq={"profile_id": profile.profile_id},
                order_by="created_at",
                order_desc=True,
                limit=500,
            ))
        clip_ids = [c["id"] for c in (clips_result.data or [])]

        if clip_ids:
            content_result = repo.table_query("editai_clip_content", "select",
                filters=QueryFilters(
                    select="tts_text",
                    in_={"clip_id": clip_ids},
                ))
            for row in content_result.data or []:
                if row.get("tts_text"):
                    used_texts.add(row["tts_text"].strip())
    except Exception as e:
        logger.warning(f"Failed to fetch used texts for is_used badge: {e}")

    # Build response
    responses = []
    for asset in assets:
        asset_id = asset["id"]
        is_used = asset.get("tts_text", "").strip() in used_texts
        responses.append(
            TTSAssetResponse(
                id=asset_id,
                tts_text=asset.get("tts_text", ""),
                mp3_url=f"/api/v1/tts-library/{asset_id}/audio" if asset.get("mp3_path") else None,
                srt_url=f"/api/v1/tts-library/{asset_id}/srt" if asset.get("srt_path") else None,
                srt_content=asset.get("srt_content"),
                audio_duration=asset.get("audio_duration", 0.0),
                char_count=asset.get("char_count", 0),
                tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
                status=asset.get("status", "ready"),
                is_used=is_used,
                created_at=asset.get("created_at", ""),
                updated_at=asset.get("updated_at", ""),
            )
        )

    return responses


@router.get("/{asset_id}", response_model=TTSAssetResponse)
async def get_tts_asset(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Get a single TTS asset by ID."""
    await _reconcile_tts_asset_jobs(asset_id, profile.user_id)
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            eq={"id": asset_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data[0]

    # Check is_used
    is_used = False
    try:
        clips_result = repo.table_query("editai_clips", "select",
            filters=QueryFilters(
                select="id",
                eq={"profile_id": profile.profile_id},
            ))
        clip_ids = [c["id"] for c in (clips_result.data or [])]
        if clip_ids and asset.get("tts_text"):
            content_result = repo.table_query("editai_clip_content", "select",
                filters=QueryFilters(
                    select="tts_text",
                    in_={"clip_id": clip_ids},
                ))
            used_texts = {r["tts_text"].strip() for r in (content_result.data or []) if r.get("tts_text")}
            is_used = asset["tts_text"].strip() in used_texts
    except Exception:
        pass

    return TTSAssetResponse(
        id=asset["id"],
        tts_text=asset.get("tts_text", ""),
        mp3_url=f"/api/v1/tts-library/{asset_id}/audio" if asset.get("mp3_path") else None,
        srt_url=f"/api/v1/tts-library/{asset_id}/srt" if asset.get("srt_path") else None,
        srt_content=asset.get("srt_content"),
        audio_duration=asset.get("audio_duration", 0.0),
        char_count=asset.get("char_count", 0),
        tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
        status=asset.get("status", "ready"),
        is_used=is_used,
        created_at=asset.get("created_at", ""),
        updated_at=asset.get("updated_at", ""),
    )


@router.post("/", response_model=TTSAssetResponse, status_code=201)
async def create_tts_asset(
    request: TTSAssetCreate,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
    current_user: AuthUser = Depends(get_current_user),
):
    """Create a new TTS asset. Generates MP3 + SRT in background."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    validate_tts_text_length(request.tts_text, "tts_text")

    asset_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    text = request.tts_text.strip()
    metering = new_metering_record(
        "studio.tts_variant",
        1,
        f"tts-library:{job_id}:generate",
    )
    metering.update({
        "supabase_user_id": profile.user_id,
        "email": current_user.email,
    })
    storage = get_job_storage()
    storage.create_job(
        {
            "job_id": job_id,
            "job_type": _TTS_LIBRARY_JOB_TYPE,
            "status": "pending",
            "progress": "Awaiting credit reservation",
            "profile_id": profile.profile_id,
            "user_id": profile.user_id,
            "project_id": _asset_job_project_id(asset_id),
            "asset_id": asset_id,
            "process_instance_id": _PROCESS_INSTANCE_ID,
            "output_persisted": False,
            "metering": metering,
        },
        profile_id=profile.profile_id,
    )

    try:
        await _reserve_tts_library_metering(
            job_id,
            MeteringIdentity(profile.user_id, current_user.email),
        )
    except StudioMeteringBlocked as error:
        raise HTTPException(
            status_code=402,
            detail={**error.as_http_detail(), "studio_job_id": job_id},
        )

    # Insert with status=generating
    try:
        repo.table_query("editai_tts_assets", "insert", data={
            "id": asset_id,
            "profile_id": profile.profile_id,
            "tts_text": text,
            "tts_model": request.tts_model,
            "char_count": len(text),
            "status": "generating",
            "tts_provider": "elevenlabs",
        })
    except Exception:
        storage.update_job(
            job_id,
            {"status": "failed", "progress": "Could not create TTS asset"},
            profile_id=profile.profile_id,
        )
        await _settle_tts_library_metering(job_id, profile.user_id, delivered=False)
        raise

    background_tasks.add_task(
        _run_tts_library_generation,
        job_id=job_id,
        asset_id=asset_id,
        text=text,
        profile_id=profile.profile_id,
        user_id=profile.user_id,
        model=request.tts_model,
    )

    return TTSAssetResponse(
        id=asset_id,
        job_id=job_id,
        tts_text=text,
        char_count=len(text),
        tts_model=request.tts_model,
        status="generating",
        created_at=now,
        updated_at=now,
    )


@router.put("/{asset_id}", response_model=TTSAssetResponse)
async def update_tts_asset(
    asset_id: str,
    request: TTSAssetUpdate,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context),
    current_user: AuthUser = Depends(get_current_user),
):
    """Update text of a TTS asset. Triggers auto-regeneration of MP3 + SRT."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    validate_tts_text_length(request.tts_text, "tts_text")

    # Verify asset exists and belongs to profile
    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            eq={"id": asset_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data[0]
    now = datetime.now(timezone.utc).isoformat()
    text = request.tts_text.strip()
    job_id = str(uuid.uuid4())
    metering = new_metering_record(
        "studio.tts_variant",
        1,
        f"tts-library:{job_id}:regenerate",
    )
    metering.update({
        "supabase_user_id": profile.user_id,
        "email": current_user.email,
    })
    storage = get_job_storage()
    storage.create_job(
        {
            "job_id": job_id,
            "job_type": _TTS_LIBRARY_JOB_TYPE,
            "status": "pending",
            "progress": "Awaiting credit reservation",
            "profile_id": profile.profile_id,
            "user_id": profile.user_id,
            "project_id": _asset_job_project_id(asset_id),
            "asset_id": asset_id,
            "process_instance_id": _PROCESS_INSTANCE_ID,
            "output_persisted": False,
            "metering": metering,
        },
        profile_id=profile.profile_id,
    )

    try:
        await _reserve_tts_library_metering(
            job_id,
            MeteringIdentity(profile.user_id, current_user.email),
        )
    except StudioMeteringBlocked as error:
        raise HTTPException(
            status_code=402,
            detail={**error.as_http_detail(), "studio_job_id": job_id},
        )

    # Update text and set generating
    try:
        repo.table_query("editai_tts_assets", "update", data={
            "tts_text": text,
            "char_count": len(text),
            "status": "generating",
            "error_message": None,
            "updated_at": now,
        }, filters=QueryFilters(eq={"id": asset_id, "profile_id": profile.profile_id}))
    except Exception:
        storage.update_job(
            job_id,
            {"status": "failed", "progress": "Could not update TTS asset"},
            profile_id=profile.profile_id,
        )
        await _settle_tts_library_metering(job_id, profile.user_id, delivered=False)
        raise

    background_tasks.add_task(
        _run_tts_library_generation,
        job_id=job_id,
        asset_id=asset_id,
        text=text,
        profile_id=profile.profile_id,
        user_id=profile.user_id,
        model=asset.get("tts_model", "eleven_flash_v2_5"),
        previous_asset=asset,
    )

    return TTSAssetResponse(
        id=asset_id,
        job_id=job_id,
        tts_text=text,
        char_count=len(text),
        tts_model=asset.get("tts_model", "eleven_flash_v2_5"),
        status="generating",
        created_at=asset.get("created_at", ""),
        updated_at=now,
    )


@router.delete("/{asset_id}")
async def delete_tts_asset(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Delete a TTS asset and its files."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    # Verify ownership
    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            eq={"id": asset_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    if not result.data:
        raise HTTPException(status_code=404, detail="TTS asset not found")

    asset = result.data[0]

    # Delete files
    tts_lib = get_tts_library_service()
    tts_lib.delete_asset_files(asset.get("mp3_path"), asset.get("srt_path"))

    # Delete from DB
    repo.table_query("editai_tts_assets", "delete",
        filters=QueryFilters(eq={"id": asset_id}))

    return {"detail": "Asset deleted"}


class BatchDeleteRequest(BaseModel):
    ids: List[str]


@router.post("/batch-delete")
async def batch_delete_tts_assets(
    request: BatchDeleteRequest,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Delete multiple TTS assets at once."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    if not request.ids:
        return {"deleted": 0}

    # Fetch all matching assets owned by this profile
    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            select="id, mp3_path, srt_path",
            eq={"profile_id": profile.profile_id},
            in_={"id": request.ids},
        ))

    assets = result.data or []
    if not assets:
        return {"deleted": 0}

    # Delete files from disk
    tts_lib = get_tts_library_service()
    for asset in assets:
        tts_lib.delete_asset_files(asset.get("mp3_path"), asset.get("srt_path"))

    # Delete from DB
    asset_ids = [a["id"] for a in assets]
    repo.table_query("editai_tts_assets", "delete",
        filters=QueryFilters(in_={"id": asset_ids}))

    logger.info(f"Batch deleted {len(asset_ids)} TTS assets")
    return {"deleted": len(asset_ids)}


@router.get("/{asset_id}/audio")
async def serve_audio(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Serve the MP3 audio file for a TTS asset."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            select="mp3_path, profile_id",
            eq={"id": asset_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    row = result.data[0] if result.data else None
    if not row or not row.get("mp3_path"):
        raise HTTPException(status_code=404, detail="Audio not found")

    settings = get_settings()
    mp3_path = Path(row["mp3_path"])
    file_path = mp3_path if mp3_path.is_absolute() else settings.base_dir / mp3_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        filename=f"{asset_id}.mp3",
    )


@router.get("/{asset_id}/srt")
async def serve_srt(
    asset_id: str,
    profile: ProfileContext = Depends(get_profile_context),
):
    """Serve the SRT subtitle file for a TTS asset."""
    repo = get_repository()
    if not repo:
        raise HTTPException(status_code=503, detail="Database not available")

    result = repo.table_query("editai_tts_assets", "select",
        filters=QueryFilters(
            select="srt_path, profile_id",
            eq={"id": asset_id, "profile_id": profile.profile_id},
            limit=1,
        ))

    row = result.data[0] if result.data else None
    if not row or not row.get("srt_path"):
        raise HTTPException(status_code=404, detail="SRT not found")

    settings = get_settings()
    srt_path = Path(row["srt_path"])
    file_path = srt_path if srt_path.is_absolute() else settings.base_dir / srt_path

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="SRT file missing from disk")

    return FileResponse(
        path=str(file_path),
        media_type="text/plain",
        filename=f"{asset_id}.srt",
        headers={"Content-Disposition": f'attachment; filename="{asset_id}.srt"'},
    )
