"""
Edge TTS Service - TTSService interface implementation.

Wraps existing EdgeTTSService functionality with unified interface.
Free Microsoft Edge Text-to-Speech with excellent quality.
"""
import logging
from pathlib import Path
from typing import List, Optional
import edge_tts
import librosa

from .base import TTSService, TTSVoice, TTSResult

logger = logging.getLogger(__name__)


class EdgeTTSService(TTSService):
    """
    Microsoft Edge Text-to-Speech service implementing TTSService interface.

    100% FREE with excellent quality and many voices.
    """

    def __init__(self, output_dir: Path, default_voice: str = "en-US-GuyNeural"):
        """
        Initialize Edge TTS service.

        Args:
            output_dir: Directory for generated audio files
            default_voice: Default voice ID (e.g., "en-US-GuyNeural", "ro-RO-EmilNeural")
        """
        super().__init__(output_dir)
        self.default_voice = default_voice
        self._voices_cache: Optional[List[TTSVoice]] = None
        logger.info(f"EdgeTTSService initialized with default voice: {default_voice}")

    @property
    def provider_name(self) -> str:
        """Return provider identifier."""
        return "edge"

    @property
    def cost_per_1k_chars(self) -> float:
        """Return cost per 1000 characters (free)."""
        return 0.0

    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available voices from Edge TTS.

        Args:
            language: Optional language filter (ISO 639-1 code: en, ro, es, etc.)

        Returns:
            List of available voices
        """
        # Cache voices to avoid repeated API calls
        if self._voices_cache is None:
            voices_list = await edge_tts.list_voices()
            self._voices_cache = []

            for v in voices_list:
                voice_language = v["Locale"].split("-")[0]

                self._voices_cache.append(TTSVoice(
                    id=v["ShortName"],
                    name=v["FriendlyName"],
                    language=voice_language,
                    gender=v.get("Gender"),
                    provider="edge",
                    requires_cloning=False,
                    cost_per_1k_chars=0.0
                ))

            logger.info(f"Cached {len(self._voices_cache)} Edge TTS voices")

        # Filter by language if specified
        if language:
            return [v for v in self._voices_cache if v.language.lower() == language.lower()]

        return self._voices_cache

    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        **kwargs
    ) -> TTSResult:
        """
        Generate audio from text using Edge TTS.

        Args:
            text: Text to convert to speech
            voice_id: Voice identifier (e.g., "en-US-GuyNeural")
            output_path: Where to save the audio file
            **kwargs: Optional parameters (rate, volume, pitch)
                - rate: Speech rate (e.g., "+0%", "+10%", "-20%")
                - volume: Volume level (e.g., "+0%", "+50%")
                - pitch: Pitch adjustment (e.g., "+0Hz", "+5Hz", "-10Hz")

        Returns:
            TTSResult with audio path, duration, and cost (0.0)
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # --- Cache check ---
        from app.services.tts_cache import cache_lookup, cache_store
        cache_key = {"text": text, "voice_id": voice_id, "model_id": "edge", "provider": "edge"}
        cached = cache_lookup(cache_key, "edge", output_path)
        if cached:
            return TTSResult(
                audio_path=output_path,
                duration_seconds=cached.get("duration_seconds", 0.0),
                provider="edge",
                voice_id=voice_id,
                cost=0.0
            )

        # Extract optional parameters
        rate = kwargs.get("rate", "+0%")
        volume = kwargs.get("volume", "+0%")
        pitch = kwargs.get("pitch", "+0Hz")

        logger.info(f"Generating TTS for {len(text)} characters with voice {voice_id}")

        # Create Edge TTS communicate object
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice_id,
            rate=rate,
            volume=volume,
            pitch=pitch
        )

        # Save audio
        await communicate.save(str(output_path))

        # Calculate duration using librosa
        try:
            duration_seconds = librosa.get_duration(path=str(output_path))
        except Exception as e:
            logger.warning(f"Failed to get audio duration: {e}")
            duration_seconds = 0.0

        logger.info(f"Audio saved to: {output_path} (duration: {duration_seconds:.2f}s)")

        # --- Cache store ---
        cache_store(cache_key, "edge", output_path, {
            "duration_seconds": duration_seconds,
            "characters": len(text)
        })

        return TTSResult(
            audio_path=output_path,
            duration_seconds=duration_seconds,
            provider="edge",
            voice_id=voice_id,
            cost=0.0  # Free service
        )

    async def supports_voice_cloning(self) -> bool:
        """
        Check if provider supports voice cloning.

        Returns:
            False (Edge TTS does not support voice cloning)
        """
        return False
