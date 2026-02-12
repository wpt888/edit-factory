"""
TTS Service Abstract Base Class.

Provides unified interface for all TTS providers (ElevenLabs, Edge, Coqui, Kokoro).
Each provider implements this interface for pluggable multi-provider support.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class TTSVoice:
    """Voice metadata for TTS provider."""
    id: str
    name: str
    language: str
    gender: Optional[str]
    provider: str
    requires_cloning: bool = False
    cost_per_1k_chars: float = 0.0


@dataclass
class TTSResult:
    """Result of TTS audio generation."""
    audio_path: Path
    duration_seconds: float
    provider: str
    voice_id: str
    cost: float
    timestamps: Optional[dict] = None  # Character-level timing data from /with-timestamps


class TTSService(ABC):
    """
    Abstract base class for TTS providers.

    All TTS implementations (ElevenLabs, Edge, Coqui, Kokoro) must implement this interface.
    """

    def __init__(self, output_dir: Path):
        """
        Initialize TTS service.

        Args:
            output_dir: Directory for generated audio files
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return provider identifier (elevenlabs, edge, coqui, kokoro)."""
        pass

    @property
    @abstractmethod
    def cost_per_1k_chars(self) -> float:
        """Return cost per 1000 characters for this provider."""
        pass

    @abstractmethod
    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available voices.

        Args:
            language: Optional language filter (ISO 639-1 code: en, ro, es, etc.)

        Returns:
            List of available voices
        """
        pass

    @abstractmethod
    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        **kwargs
    ) -> TTSResult:
        """
        Generate audio from text.

        Args:
            text: Text to convert to speech
            voice_id: Voice identifier
            output_path: Where to save the audio file
            **kwargs: Provider-specific parameters (rate, pitch, stability, etc.)

        Returns:
            TTSResult with audio path, duration, and cost
        """
        pass

    @abstractmethod
    async def supports_voice_cloning(self) -> bool:
        """
        Check if provider supports voice cloning.

        Returns:
            True if voice cloning is available
        """
        pass

    async def clone_voice(
        self,
        sample_audio_path: Path,
        voice_name: str,
        **kwargs
    ) -> TTSVoice:
        """
        Clone a voice from audio sample.

        Default implementation raises NotImplementedError.
        Providers that support cloning should override this method.

        Args:
            sample_audio_path: Path to sample audio file (typically 6+ seconds)
            voice_name: Name for the cloned voice
            **kwargs: Provider-specific cloning parameters

        Returns:
            TTSVoice metadata for the cloned voice

        Raises:
            NotImplementedError: If provider doesn't support voice cloning
        """
        raise NotImplementedError(
            f"{self.provider_name} does not support voice cloning"
        )
