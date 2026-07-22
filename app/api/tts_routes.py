"""
TTS API Routes - Provider listing, voice listing, generation, and voice cloning.
"""
import logging
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends, Request

from app.api.auth import AuthUser, ProfileContext, get_current_user, get_profile_context
from app.api.ml_gating import require_ml_installed, require_tier
from app.api.validators import validate_tts_text_length, validate_file_mime_type, ALLOWED_AUDIO_MIMES
from app.core.rate_limit import limiter
from app.config import get_settings
from app.repositories.factory import get_repository
from app.services.tts import get_tts_service
from app.services.job_storage import get_job_storage
from app.services.studio_metering import (
    MeteringIdentity,
    StudioMeteringBlocked,
    new_metering_record,
    reserve_metering_record,
    settle_metering_record,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts", tags=["tts"])

# Cache for kokoro availability check (5-minute TTL)
_kokoro_cache: dict = {"available": None, "checked_at": 0.0}
_kokoro_cache_lock = threading.Lock()
_KOKORO_CACHE_TTL = 300  # 5 minutes
_PROCESS_INSTANCE_ID = uuid.uuid4().hex
_TTS_GENERATION_JOB_TYPE = "tts_generation"
_TERMINAL_METERING_STATES = frozenset({"captured", "released", "refunded", "denied"})


class _TTSGenerationCancelled(Exception):
    pass


def _replace_tts_generation_metering(job_id: str, record: dict) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    return storage.update_job(
        job_id,
        {"metering": dict(record)},
        profile_id=job.get("profile_id"),
    ) or {**job, "metering": dict(record)}


async def _recover_tts_generation_reservation_for_settlement(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Replay a reserve whose response may have been lost, then settle it."""
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
    return _replace_tts_generation_metering(job_id, recovered)


async def _settle_tts_generation_metering(
    job_id: str,
    user_id: str,
    *,
    delivered: bool,
) -> dict:
    storage = get_job_storage()
    if not delivered:
        job = await _recover_tts_generation_reservation_for_settlement(job_id, user_id)
    else:
        job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict) or not record.get("reservation_id"):
        return job
    terminal = {"captured"} if delivered else {"released", "refunded"}
    if record.get("state") in terminal:
        return job
    settled = await settle_metering_record(
        MeteringIdentity(user_id, record.get("email")),
        record,
        delivered=delivered,
        result_metadata={
            "studio_job_id": job_id,
            "output_path": Path(job.get("planned_output_path") or "").name,
        } if delivered else None,
    )
    return _replace_tts_generation_metering(job_id, settled)


async def _reserve_tts_generation_metering(
    job_id: str,
    identity: MeteringIdentity,
) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict):
        raise RuntimeError("TTS generation job has no durable metering record")

    reserve_pending = {**record, "state": "reserve_pending"}
    _replace_tts_generation_metering(job_id, reserve_pending)
    try:
        reserved = await reserve_metering_record(identity, reserve_pending)
    except StudioMeteringBlocked as error:
        failed_record = {
            **reserve_pending,
            "state": "denied" if error.code == "insufficient_credits" else "reserve_pending",
            "last_error": error.as_http_detail(),
        }
        _replace_tts_generation_metering(job_id, failed_record)
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
        await _settle_tts_generation_metering(
            job_id,
            identity.supabase_user_id,
            delivered=False,
        )
        raise
    return _replace_tts_generation_metering(job_id, reserved)


def _mark_tts_generation_provider_started(job_id: str) -> dict:
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = dict(job.get("metering") or {})
    if record:
        record.update({"provider_started": True, "state": "provider_started"})
        _replace_tts_generation_metering(job_id, record)
    return storage.update_job(
        job_id,
        {"status": "processing", "progress": "Generating audio"},
        profile_id=job.get("profile_id"),
    ) or job


def _tts_generation_output_evidence(job: dict) -> Optional[Path]:
    if job.get("status") == "cancelled" and not job.get("output_persisted"):
        return None
    candidates = [
        (job.get("result") or {}).get("audio_path"),
        job.get("planned_output_path"),
    ]
    for value in candidates:
        if not isinstance(value, str) or not value:
            continue
        path = Path(value)
        try:
            if path.is_file() and path.stat().st_size > 100:
                return path
        except OSError:
            continue
    return None


async def _reconcile_tts_generation_job(
    job_id: str,
    fallback_user_id: Optional[str] = None,
) -> dict:
    """Capture a saved output or refund an interrupted standalone TTS job."""
    storage = get_job_storage()
    job = storage.get_job(job_id) or {}
    record = job.get("metering")
    if not isinstance(record, dict):
        return job

    if record.get("state") in _TERMINAL_METERING_STATES:
        if job.get("status") in {"pending", "processing"}:
            evidence = _tts_generation_output_evidence(job)
            delivered = record.get("state") == "captured" and bool(
                job.get("output_persisted") or evidence
            )
            updates = {
                "status": "completed" if delivered else "failed",
                "progress": "Completed" if delivered else "Generation did not complete",
                "error": None if delivered else job.get("error") or "TTS generation was interrupted",
            }
            if delivered and evidence and not job.get("output_persisted"):
                result = dict(job.get("result") or {})
                result.setdefault("audio_path", str(evidence))
                result.setdefault("duration", 0.0)
                result.setdefault("cost", 0.0)
                updates.update({"output_persisted": True, "result": result})
            storage.update_job(
                job_id,
                updates,
                profile_id=job.get("profile_id"),
            )
        return storage.get_job(job_id) or job

    active_here = (
        job.get("status") in {"pending", "processing"}
        and job.get("process_instance_id") == _PROCESS_INSTANCE_ID
    )
    if active_here:
        return job

    user_id = record.get("supabase_user_id") or job.get("user_id") or fallback_user_id
    if not isinstance(user_id, str) or not user_id:
        return job

    evidence = _tts_generation_output_evidence(job)
    delivered = bool(job.get("output_persisted") or evidence)
    if evidence and not job.get("output_persisted"):
        prior_result = dict(job.get("result") or {})
        prior_result.setdefault("audio_path", str(evidence))
        prior_result.setdefault("duration", 0.0)
        prior_result.setdefault("cost", 0.0)
        storage.update_job(
            job_id,
            {"output_persisted": True, "result": prior_result},
            profile_id=job.get("profile_id"),
        )

    reconciled = await _settle_tts_generation_metering(
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
                "progress": "Completed" if delivered else "Interrupted before output was saved",
                "error": None if delivered else "TTS generation was interrupted by a backend restart",
            },
            profile_id=latest.get("profile_id"),
        )
    return storage.get_job(job_id) or latest


def _check_kokoro_available() -> bool:
    """
    Check if Kokoro TTS dependencies (espeak-ng) are available.
    Results are cached for 5 minutes to avoid repeated subprocess calls.

    Returns:
        True if espeak-ng is installed, False otherwise
    """
    import time
    now = time.monotonic()
    with _kokoro_cache_lock:
        if _kokoro_cache["available"] is not None and (now - _kokoro_cache["checked_at"]) < _KOKORO_CACHE_TTL:
            return _kokoro_cache["available"]

    try:
        result = subprocess.run(
            ["espeak-ng", "--version"],
            capture_output=True,
            timeout=5
        )
        available = result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError, OSError):
        available = False

    with _kokoro_cache_lock:
        _kokoro_cache["available"] = available
        _kokoro_cache["checked_at"] = now
    return available


def _get_providers():
    """
    Get list of TTS providers with availability status.

    Returns:
        List of provider metadata dicts
    """
    settings = get_settings()
    return [
        {
            "id": "edge",
            "name": "Edge TTS",
            "description": "Microsoft Edge voices, free",
            "cost_per_1k_chars": 0.0,
            "available": True,
            "supports_voice_cloning": False
        },
        {
            "id": "elevenlabs",
            "name": "ElevenLabs",
            "description": "Premium quality voices",
            "cost_per_1k_chars": 0.24,
            "available": bool(settings.elevenlabs_api_key),
            "supports_voice_cloning": False
        },
        {
            "id": "coqui",
            "name": "Coqui XTTS",
            "description": "Voice cloning, 17 languages",
            "cost_per_1k_chars": 0.0,
            "available": True,
            "supports_voice_cloning": True
        },
        {
            "id": "kokoro",
            "name": "Kokoro TTS",
            "description": "Fast lightweight TTS",
            "cost_per_1k_chars": 0.0,
            "available": _check_kokoro_available(),
            "supports_voice_cloning": False
        },
    ]


@router.get("/providers")
async def list_providers():
    """
    List available TTS providers with cost information.

    Public endpoint - no authentication required.

    Returns:
        {"providers": [list of provider metadata]}
    """
    providers = _get_providers()
    logger.info(f"Listed {len(providers)} TTS providers")
    return {"providers": providers}


@router.get("/voices")
async def list_voices(
    provider: str,
    language: Optional[str] = None,
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    List voices for a specific TTS provider.

    Args:
        provider: Provider ID (elevenlabs, edge, coqui, kokoro)
        language: Optional language filter (e.g., "en", "es")
        profile: Profile context (auto-injected)

    Returns:
        {"provider": str, "voices": [list of voice objects]}
    """
    logger.info(f"[Profile {profile.profile_id}] Listing voices for provider: {provider}")

    try:
        tts_service = get_tts_service(
            provider=provider,
            profile_id=profile.profile_id
        )

        voices = await tts_service.list_voices(language=language)

        logger.info(f"[Profile {profile.profile_id}] Found {len(voices)} voices for {provider}")
        return {
            "provider": provider,
            "voices": [
                {
                    "voice_id": voice.id,
                    "name": voice.name,
                    "language": voice.language,
                    "gender": voice.gender,
                    "category": voice.category,
                    "preview_url": voice.preview_url,
                }
                for voice in voices
            ]
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Error listing voices: {e}")
        raise HTTPException(status_code=500, detail="Failed to list voices")


async def _generate_tts_background(
    job_id: str,
    profile_id: str,
    text: str,
    provider: str,
    voice_id: str,
    language: str
):
    """
    Background task for TTS generation.

    Args:
        job_id: Job identifier
        profile_id: Profile ID
        text: Text to synthesize
        provider: TTS provider
        voice_id: Voice identifier
        language: Language code
    """
    job_storage = get_job_storage()
    output_path: Optional[Path] = None

    try:
        if job_storage.is_job_cancelled(job_id):
            raise _TTSGenerationCancelled("TTS generation cancelled before provider start")

        _mark_tts_generation_provider_started(job_id)
        tts_service = get_tts_service(
            provider=provider,
            profile_id=profile_id,
            voice_id=voice_id,
        )
        job = job_storage.get_job(job_id) or {}
        output_path = Path(
            job.get("planned_output_path")
            or (Path(tts_service.output_dir) / f"tts_{job_id}.mp3")
        )

        result = await tts_service.generate_audio(
            text=text,
            voice_id=voice_id,
            output_path=output_path,
            language=language,
        )

        if job_storage.is_job_cancelled(job_id):
            raise _TTSGenerationCancelled("TTS generation cancelled before output checkpoint")

        persisted_path = Path(result.audio_path)
        if not persisted_path.is_file() or persisted_path.stat().st_size <= 0:
            raise RuntimeError("TTS provider returned without a persisted audio file")

        job_storage.update_job(
            job_id,
            {
                "output_persisted": True,
                "progress": "Capturing credits",
                "result": {
                    "audio_path": str(persisted_path),
                    "duration": result.duration_seconds,
                    "cost": result.cost,
                },
            },
            profile_id=profile_id,
        )

        if result.cost > 0:
            try:
                from app.services.cost_tracker import get_cost_tracker

                get_cost_tracker().log_cost(
                    service=f"TTS-{provider}",
                    operation="generate",
                    cost=result.cost,
                    metadata={
                        "text_length": len(text),
                        "voice_id": voice_id,
                        "duration": result.duration_seconds,
                        "audio_path": str(persisted_path),
                    },
                    profile_id=profile_id,
                )
                logger.info(
                    "[Profile %s] TTS generation cost: $%.4f",
                    profile_id,
                    result.cost,
                )
            except Exception as cost_error:
                logger.warning(
                    "[Profile %s] Could not log TTS provider cost: %s",
                    profile_id,
                    cost_error,
                )

        job = job_storage.get_job(job_id) or {}
        user_id = job.get("user_id") or (job.get("metering") or {}).get("supabase_user_id")
        await _settle_tts_generation_metering(job_id, user_id, delivered=True)
        latest = job_storage.get_job(job_id) or {}
        if latest.get("status") != "cancelled":
            job_storage.update_job(
                job_id,
                {"status": "completed", "progress": "Completed", "error": None},
                profile_id=profile_id,
            )
        logger.info("[Profile %s] TTS job %s completed: %s", profile_id, job_id, persisted_path)

    except Exception as error:
        cancelled = isinstance(error, _TTSGenerationCancelled)
        logger.error("[Profile %s] TTS job %s failed: %s", profile_id, job_id, error)
        latest = job_storage.get_job(job_id) or {}
        delivered = bool(latest.get("output_persisted"))
        if cancelled and not delivered and output_path:
            try:
                output_path.unlink(missing_ok=True)
            except OSError as cleanup_error:
                logger.warning("Could not clean cancelled TTS output %s: %s", output_path, cleanup_error)
        user_id = latest.get("user_id") or (latest.get("metering") or {}).get("supabase_user_id")
        if isinstance(user_id, str) and user_id:
            await _settle_tts_generation_metering(job_id, user_id, delivered=delivered)
        latest = job_storage.get_job(job_id) or latest
        if latest.get("status") != "cancelled":
            job_storage.update_job(
                job_id,
                {
                    "status": "cancelled" if cancelled else "failed",
                    "progress": "Cancelled" if cancelled else "Failed",
                    "error": str(error),
                },
                profile_id=profile_id,
            )


@router.post("/generate")
@limiter.limit("20/minute")
async def generate_tts(
    request: Request,
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    provider: str = Form(...),
    voice_id: str = Form(...),
    language: str = Form(default="en"),
    profile: ProfileContext = Depends(get_profile_context),
    current_user: AuthUser = Depends(get_current_user),
):
    """
    Generate TTS audio (background job).

    Args:
        text: Text to synthesize
        provider: TTS provider (elevenlabs, edge, coqui, kokoro)
        voice_id: Voice identifier
        language: Language code (default: "en")
        profile: Profile context (auto-injected)

    Returns:
        {"job_id": str, "status": "processing", "estimated_time_seconds": float}
    """
    logger.info(f"[Profile {profile.profile_id}] TTS generation request: provider={provider}, voice={voice_id}, text_len={len(text)}")

    # Check quota if profile has one set
    repo = get_repository()
    if repo:
        try:
            profile_row = repo.get_profile(profile.profile_id)

            if not profile_row:
                monthly_quota = 0.0
            else:
                monthly_quota = float(profile_row.get("monthly_quota_usd", 0) or 0)

            if monthly_quota > 0:
                from app.services.cost_tracker import get_cost_tracker
                tracker = get_cost_tracker()
                exceeded, current, quota = tracker.check_quota(profile.profile_id, monthly_quota)

                if exceeded:
                    logger.warning(f"[Profile {profile.profile_id}] Quota exceeded: ${current:.2f} / ${quota:.2f}")
                    raise HTTPException(
                        status_code=402,  # Payment Required
                        detail={
                            "error": "quota_exceeded",
                            "message": f"Monthly quota exceeded. Current: ${current:.2f}, Quota: ${quota:.2f}",
                            "current_costs": current,
                            "monthly_quota": quota
                        }
                    )
        except HTTPException:
            raise  # Re-raise quota exception
        except Exception as e:
            logger.warning(f"[Profile {profile.profile_id}] Failed to check quota: {e}")
            # Continue without quota check on error (graceful degradation)

    # Validate input before creating the durable reservation intent.
    text = validate_tts_text_length(text)
    provider = provider.strip().lower()
    if provider not in {"elevenlabs", "edge", "coqui", "kokoro"}:
        raise HTTPException(status_code=400, detail="Unsupported TTS provider")

    # Create job
    job_id = str(uuid.uuid4())
    job_storage = get_job_storage()

    # Estimate processing time (rough estimate based on text length)
    char_per_second = 10  # Conservative estimate
    estimated_time = max(5.0, len(text) / char_per_second)

    planned_output_path = (
        get_settings().output_dir
        / "tts"
        / profile.profile_id
        / provider
        / f"tts_{job_id}.mp3"
    )
    metering = new_metering_record(
        "studio.tts_variant",
        1,
        f"tts-generate:{job_id}",
    )
    metering.update({
        "supabase_user_id": profile.user_id,
        "email": current_user.email,
    })
    job_data = {
        "job_id": job_id,
        "job_type": _TTS_GENERATION_JOB_TYPE,
        "status": "pending",
        "progress": "Awaiting credit reservation",
        "profile_id": profile.profile_id,
        "user_id": profile.user_id,
        "process_instance_id": _PROCESS_INSTANCE_ID,
        "planned_output_path": str(planned_output_path),
        "output_persisted": False,
        "text_length": len(text),
        "provider": provider,
        "voice_id": voice_id,
        "language": language,
        "metering": metering,
    }

    job_storage.create_job(job_data, profile_id=profile.profile_id)

    try:
        await _reserve_tts_generation_metering(
            job_id,
            MeteringIdentity(profile.user_id, current_user.email),
        )
    except StudioMeteringBlocked as error:
        raise HTTPException(
            status_code=402,
            detail={**error.as_http_detail(), "studio_job_id": job_id},
        )

    background_tasks.add_task(
        _generate_tts_background,
        job_id=job_id,
        profile_id=profile.profile_id,
        text=text,
        provider=provider,
        voice_id=voice_id,
        language=language
    )

    logger.info(f"[Profile {profile.profile_id}] TTS job {job_id} created")

    return {
        "job_id": job_id,
        "status": "processing",
        "estimated_time_seconds": estimated_time
    }


@router.post("/clone-voice")
@limiter.limit("10/minute")
async def clone_voice_endpoint(
    request: Request,
    voice_name: str = Form(...),
    audio_file: UploadFile = File(...),
    profile: ProfileContext = Depends(get_profile_context),
    _ml: None = Depends(require_ml_installed("voice_clone")),
    _tier: None = Depends(require_tier("pro")),
):
    """
    Clone a voice from an audio sample.

    Only supported by providers with voice cloning capability (currently: Coqui XTTS).

    Args:
        voice_name: Name for the cloned voice
        audio_file: Audio file (WAV, MP3, OGG, M4A) - minimum 6 seconds
        profile: Profile context (auto-injected)

    Returns:
        {"voice_id": str, "voice_name": str, "duration": float, "warnings": []}
    """
    logger.info(f"[Profile {profile.profile_id}] Voice cloning request: {voice_name}")

    # Validate MIME type via magic-number inspection (replaces Content-Type header check
    # which can be spoofed by clients)
    await validate_file_mime_type(audio_file, ALLOWED_AUDIO_MIMES, "audio")

    # Early Content-Length check before reading into memory
    if audio_file.size and audio_file.size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large (max 10MB)")

    # Validate file size (max 10MB)
    settings = get_settings()
    temp_dir = settings.base_dir / "temp" / profile.profile_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Save to temp file (safe extension extraction with whitelist)
    ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac", ".webm"}
    ext = Path(audio_file.filename or "sample.wav").suffix.lower() or ".wav"
    if ext not in ALLOWED_AUDIO_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported audio format: {ext}")
    temp_path = temp_dir / f"voice_sample_{uuid.uuid4()}{ext}"

    try:
        # Read and validate size
        content = await audio_file.read()
        if len(content) > 10 * 1024 * 1024:  # 10MB
            raise HTTPException(status_code=400, detail="Audio file too large (max 10MB)")

        # Save to disk
        temp_path.write_bytes(content)

        # Validate duration using librosa
        try:
            import librosa
            duration = librosa.get_duration(path=str(temp_path))

            if duration < 6.0:
                temp_path.unlink()  # Clean up
                raise HTTPException(
                    status_code=400,
                    detail=f"Audio too short: {duration:.1f}s. Minimum 6 seconds required for quality voice cloning."
                )
        except ImportError:
            logger.warning("librosa not available, skipping duration validation")
            duration = 0.0

        # Clone voice using Coqui service
        try:
            coqui_service = get_tts_service(
                provider="coqui",
                profile_id=profile.profile_id
            )

            cloned_voice = await coqui_service.clone_voice(
                sample_audio_path=temp_path,
                voice_name=voice_name
            )

            # Store metadata in profile's cloned_voices JSONB via Supabase
            # This will be implemented when we add the profiles table integration
            # For now, just log it
            logger.info(f"[Profile {profile.profile_id}] Cloned voice '{cloned_voice.name}' with ID: {cloned_voice.id}")

            warnings = []
            if duration < 10.0:
                warnings.append(f"Short sample ({duration:.1f}s). Longer samples (10-30s) produce better results.")

            return {
                "voice_id": cloned_voice.id,
                "voice_name": cloned_voice.name,
                "duration": duration,
                "warnings": warnings
            }

        except NotImplementedError:
            raise HTTPException(
                status_code=501,
                detail="Voice cloning not supported by Coqui provider (check installation)"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Profile {profile.profile_id}] Voice cloning failed: {e}")
        raise HTTPException(status_code=500, detail="Voice cloning failed")
    finally:
        # Clean up temp file
        if temp_path.exists():
            temp_path.unlink()
