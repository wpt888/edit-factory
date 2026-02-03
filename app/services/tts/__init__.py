"""
TTS Service Module.

Multi-provider TTS abstraction layer supporting:
- ElevenLabs (high-quality, paid)
- Edge TTS (free, Microsoft voices)
- Coqui XTTS (local, open-source)
- Kokoro TTS (local, fast)

Usage:
    from app.services.tts import get_tts_service, TTSService

    service = get_tts_service(provider="edge", profile_id="uuid")
    voices = await service.list_voices(language="en")
    result = await service.generate_audio(text, voice_id, output_path)
"""
from .base import TTSService, TTSVoice, TTSResult
from .factory import get_tts_service

__all__ = [
    "TTSService",
    "TTSVoice",
    "TTSResult",
    "get_tts_service",
]
