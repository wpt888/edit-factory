"""
Kokoro TTS Service Implementation.

Lightweight, fast, free local TTS engine.
Requires espeak-ng system dependency.
"""
import asyncio
import logging
import subprocess
from pathlib import Path
from typing import List, Optional

from app.services.tts.base import TTSService, TTSVoice, TTSResult

logger = logging.getLogger(__name__)

# Preset voices for Kokoro TTS
KOKORO_VOICES = [
    {"id": "af", "name": "American English Female", "language": "en", "gender": "female"},
    {"id": "am", "name": "American English Male", "language": "en", "gender": "male"},
    {"id": "bf", "name": "British English Female", "language": "en", "gender": "female"},
    {"id": "bm", "name": "British English Male", "language": "en", "gender": "male"},
    {"id": "default", "name": "Default Voice", "language": "en", "gender": "neutral"},
]


class KokoroTTSService(TTSService):
    """
    Kokoro TTS Service.

    Provides fast, lightweight, free local TTS generation.
    Requires espeak-ng system dependency to be installed.
    """

    def __init__(self, output_dir: Path, default_voice: str = "af"):
        """
        Initialize Kokoro TTS service.

        Args:
            output_dir: Directory for generated audio files
            default_voice: Default voice ID to use (default: "af")

        Raises:
            RuntimeError: If espeak-ng is not available
        """
        super().__init__(output_dir)
        self.default_voice = default_voice

        # Check espeak-ng availability at instantiation
        if not self._check_espeak_available():
            raise RuntimeError(
                "espeak-ng is not installed or not found in PATH.\n"
                "Installation instructions:\n"
                "  Linux: apt-get install espeak-ng\n"
                "  macOS: brew install espeak-ng\n"
                "  Windows: https://github.com/espeak-ng/espeak-ng/releases"
            )

        logger.info(f"KokoroTTSService initialized with output_dir={output_dir}")

    def _check_espeak_available(self) -> bool:
        """
        Check if espeak-ng is available in the system.

        Returns:
            True if espeak-ng is available, False otherwise
        """
        try:
            result = subprocess.run(
                ["espeak-ng", "--version"],
                capture_output=True,
                timeout=5,
                text=True
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                logger.info(f"espeak-ng found: {version}")
                return True
            return False
        except FileNotFoundError:
            logger.warning("espeak-ng not found in PATH")
            return False
        except subprocess.TimeoutExpired:
            logger.warning("espeak-ng version check timed out")
            return False
        except Exception as e:
            logger.error(f"Error checking espeak-ng availability: {e}")
            return False

    @property
    def provider_name(self) -> str:
        """Return provider identifier."""
        return "kokoro"

    @property
    def cost_per_1k_chars(self) -> float:
        """Return cost per 1000 characters (free)."""
        return 0.0

    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available Kokoro voices.

        Args:
            language: Optional language filter (ISO 639-1 code)

        Returns:
            List of preset Kokoro voices
        """
        voices = []
        for voice_data in KOKORO_VOICES:
            # Filter by language if specified
            if language and voice_data["language"] != language:
                continue

            voices.append(TTSVoice(
                id=voice_data["id"],
                name=voice_data["name"],
                language=voice_data["language"],
                gender=voice_data["gender"],
                provider=self.provider_name,
                requires_cloning=False,
                cost_per_1k_chars=0.0
            ))

        logger.info(f"Listed {len(voices)} Kokoro voices (language filter: {language})")
        return voices

    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        **kwargs
    ) -> TTSResult:
        """
        Generate audio from text using Kokoro TTS.

        Args:
            text: Text to convert to speech
            voice_id: Voice identifier (af, am, bf, bm, default)
            output_path: Where to save the audio file
            **kwargs: Additional parameters (speed, lang, etc.)

        Returns:
            TTSResult with audio path, duration, and cost (0.0)
        """
        # Lazy import to avoid import-time dependency issues
        try:
            import kokoro
            import soundfile as sf
        except ImportError as e:
            raise RuntimeError(
                f"Failed to import kokoro or soundfile: {e}\n"
                "Install with: pip install kokoro soundfile"
            )

        logger.info(f"Generating audio with Kokoro (voice={voice_id}, text length={len(text)})")

        # Generate audio using kokoro library
        # Run in thread pool to avoid blocking event loop
        def _generate():
            # kokoro library generates audio
            # Using voice_id parameter for voice selection
            audio_data, sample_rate = kokoro.generate(
                text=text,
                voice=voice_id,
                **kwargs
            )
            return audio_data, sample_rate

        # Execute in thread pool
        audio_data, sample_rate = await asyncio.to_thread(_generate)

        # Save audio to output path
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), audio_data, sample_rate)

        # Calculate duration
        duration = len(audio_data) / sample_rate

        logger.info(f"Audio generated successfully: {output_path} (duration={duration:.2f}s)")

        return TTSResult(
            audio_path=output_path,
            duration_seconds=duration,
            provider=self.provider_name,
            voice_id=voice_id,
            cost=0.0
        )

    async def supports_voice_cloning(self) -> bool:
        """
        Check if Kokoro supports voice cloning.

        Returns:
            False (Kokoro uses preset voices only)
        """
        return False
