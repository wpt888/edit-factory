"""
TTS Service Factory.

Returns appropriate TTS service based on provider string.
Supports: elevenlabs, edge, coqui, kokoro.
"""
from pathlib import Path
from typing import Optional
from .base import TTSService
from app.config import get_settings


def get_tts_service(
    provider: str,
    profile_id: str,
    voice_id: Optional[str] = None
) -> TTSService:
    """
    Factory function to get TTS service instance.

    Args:
        provider: Provider identifier (elevenlabs, edge, coqui, kokoro)
        profile_id: Profile ID for scoped output directory
        voice_id: Optional voice ID (provider-specific)

    Returns:
        Configured TTSService instance

    Raises:
        ValueError: If provider is unknown
        NotImplementedError: If provider not yet implemented
    """
    settings = get_settings()

    # Profile-scoped output directory
    output_dir = settings.output_dir / "tts" / profile_id / provider

    provider = provider.lower()

    if provider == "elevenlabs":
        from .elevenlabs import ElevenLabsTTSService
        return ElevenLabsTTSService(output_dir=output_dir, voice_id=voice_id, profile_id=profile_id)

    elif provider == "edge":
        from .edge import EdgeTTSService
        return EdgeTTSService(output_dir=output_dir)

    elif provider == "coqui":
        try:
            from .coqui import CoquiTTSService
            return CoquiTTSService(output_dir=output_dir)
        except ImportError:
            raise NotImplementedError(
                "Coqui TTS implementation not yet available (will be added in 04-03)"
            )

    elif provider == "kokoro":
        try:
            from .kokoro import KokoroTTSService
            return KokoroTTSService(output_dir=output_dir)
        except ImportError:
            raise NotImplementedError(
                "Kokoro TTS implementation not yet available (will be added in 04-04)"
            )

    else:
        raise ValueError(
            f"Unknown TTS provider: {provider}. "
            f"Supported providers: elevenlabs, edge, coqui, kokoro"
        )
