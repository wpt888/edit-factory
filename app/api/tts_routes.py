"""
TTS API Routes - Provider listing, voice listing, generation, and voice cloning.
"""
import asyncio
import logging
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends

from app.api.auth import ProfileContext, get_profile_context
from app.services.tts import get_tts_service
from app.services.job_storage import get_job_storage
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tts", tags=["tts"])


def _check_kokoro_available() -> bool:
    """
    Check if Kokoro TTS dependencies (espeak-ng) are available.

    Returns:
        True if espeak-ng is installed, False otherwise
    """
    try:
        result = subprocess.run(
            ["espeak-ng", "--version"],
            capture_output=True,
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


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
            "cost_per_1k_chars": 0.22,
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
                    "id": voice.id,
                    "name": voice.name,
                    "language": voice.language,
                    "gender": voice.gender
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
        raise HTTPException(status_code=500, detail=f"Failed to list voices: {str(e)}")


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

    try:
        # Update job to processing
        job_storage.update_job(
            job_id=job_id,
            status="processing",
            progress="Generating audio..."
        )

        # Get TTS service
        tts_service = get_tts_service(
            provider=provider,
            profile_id=profile_id,
            voice_id=voice_id
        )

        # Generate audio
        result = await tts_service.generate(
            text=text,
            voice_id=voice_id,
            language=language
        )

        # Log cost if applicable
        if result.cost > 0:
            from app.services.cost_tracker import get_cost_tracker
            cost_tracker = get_cost_tracker()
            cost_tracker.log_cost(
                service=f"TTS-{provider}",
                operation="generate",
                cost=result.cost,
                metadata={
                    "text_length": len(text),
                    "voice_id": voice_id,
                    "duration": result.duration,
                    "audio_path": str(result.audio_path)
                },
                profile_id=profile_id
            )
            logger.info(f"[Profile {profile_id}] TTS generation cost: ${result.cost:.4f}")

        # Update job to completed
        job_storage.update_job(
            job_id=job_id,
            status="completed",
            progress="Completed",
            result={
                "audio_path": str(result.audio_path),
                "duration": result.duration,
                "cost": result.cost
            }
        )

        logger.info(f"[Profile {profile_id}] TTS job {job_id} completed: {result.audio_path}")

    except Exception as e:
        logger.error(f"[Profile {profile_id}] TTS job {job_id} failed: {e}")
        job_storage.update_job(
            job_id=job_id,
            status="failed",
            progress=f"Failed: {str(e)}"
        )


@router.post("/generate")
async def generate_tts(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    provider: str = Form(...),
    voice_id: str = Form(...),
    language: str = Form(default="en"),
    profile: ProfileContext = Depends(get_profile_context)
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

    # Create job
    job_id = str(uuid.uuid4())
    job_storage = get_job_storage()

    # Estimate processing time (rough estimate based on text length)
    char_per_second = 10  # Conservative estimate
    estimated_time = max(5.0, len(text) / char_per_second)

    job_data = {
        "job_id": job_id,
        "job_type": "tts_generation",
        "status": "pending",
        "progress": "Queued",
        "text_length": len(text),
        "provider": provider,
        "voice_id": voice_id,
        "language": language
    }

    job_storage.create_job(job_data, profile_id=profile.profile_id)

    # Add background task
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
async def clone_voice(
    voice_name: str = Form(...),
    audio_sample: UploadFile = File(...),
    profile: ProfileContext = Depends(get_profile_context)
):
    """
    Clone a voice from an audio sample.

    Only supported by providers with voice cloning capability (currently: Coqui XTTS).

    Args:
        voice_name: Name for the cloned voice
        audio_sample: Audio file (WAV, MP3, OGG, M4A) - minimum 6 seconds
        profile: Profile context (auto-injected)

    Returns:
        {"voice_id": str, "duration": float, "warnings": []}
    """
    logger.info(f"[Profile {profile.profile_id}] Voice cloning request: {voice_name}")

    # Validate MIME type
    allowed_types = [
        "audio/mpeg",  # MP3
        "audio/wav",
        "audio/x-wav",
        "audio/ogg",
        "audio/mp4"  # M4A
    ]

    if audio_sample.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid audio format: {audio_sample.content_type}. Allowed: WAV, MP3, OGG, M4A"
        )

    # Validate file size (max 10MB)
    settings = get_settings()
    temp_dir = settings.base_dir / "temp" / profile.profile_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Save to temp file
    temp_path = temp_dir / f"voice_sample_{uuid.uuid4()}.{audio_sample.filename.split('.')[-1]}"

    try:
        # Read and validate size
        content = await audio_sample.read()
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

            voice_id = await coqui_service.clone_voice(
                audio_path=temp_path,
                voice_name=voice_name
            )

            # Store metadata in profile's cloned_voices JSONB via Supabase
            # This will be implemented when we add the profiles table integration
            # For now, just log it
            logger.info(f"[Profile {profile.profile_id}] Cloned voice '{voice_name}' with ID: {voice_id}")

            warnings = []
            if duration < 10.0:
                warnings.append(f"Short sample ({duration:.1f}s). Longer samples (10-30s) produce better results.")

            return {
                "voice_id": voice_id,
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
        raise HTTPException(status_code=500, detail=f"Voice cloning failed: {str(e)}")
    finally:
        # Clean up temp file
        if temp_path.exists():
            temp_path.unlink()
