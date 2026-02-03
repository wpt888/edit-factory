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
        try:
            from .elevenlabs import ElevenLabsTTSService
            return ElevenLabsTTSService(output_dir=output_dir, voice_id=voice_id)
        except ImportError:
            raise NotImplementedError(
                "ElevenLabs TTS implementation not yet available (will be added in 04-02)"
            )

    elif provider == "edge":
        try:
            from .edge import EdgeTTSService as EdgeService
            return EdgeService(output_dir=output_dir)
        except ImportError:
            raise NotImplementedError(
                "Edge TTS implementation not yet available (will be added in 04-02)"
            )

    elif provider == "coqui":
        # Lazy import to avoid loading PyTorch at module import time
        from .coqui import CoquiTTSService
        return CoquiTTSService(
            output_dir=output_dir,
            model_name="tts_models/multilingual/multi-dataset/xtts_v2",
            use_gpu=True
        )

    elif provider == "kokoro":
        from .kokoro import KokoroTTSService
        return KokoroTTSService(
            output_dir=output_dir,
            default_voice=voice_id or "af"
        )

    else:
        raise ValueError(
            f"Unknown TTS provider: {provider}. "
            f"Supported providers: elevenlabs, edge, coqui, kokoro"
        )
