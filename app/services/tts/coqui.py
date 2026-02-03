"""
Coqui XTTS v2 TTS Service Implementation.

Provides voice cloning and multilingual TTS using Coqui XTTS v2 model.
Supports GPU acceleration with CPU fallback for broader compatibility.
"""
import asyncio
import logging
import uuid
from pathlib import Path
from typing import Dict, List, Optional

from .base import TTSService, TTSVoice, TTSResult

logger = logging.getLogger(__name__)


class CoquiTTSService(TTSService):
    """
    Coqui XTTS v2 TTS service with voice cloning support.

    Features:
    - Voice cloning from 6+ second audio samples
    - 17 language support
    - GPU acceleration with CPU fallback
    - Lazy model loading (avoid startup delay)
    """

    # Class-level model cache (singleton pattern)
    _model_cache: Dict[str, 'TTS'] = {}
    _model_lock: Optional[asyncio.Lock] = None

    def __init__(
        self,
        output_dir: Path,
        model_name: str = "tts_models/multilingual/multi-dataset/xtts_v2",
        use_gpu: bool = True
    ):
        """
        Initialize Coqui TTS service.

        Args:
            output_dir: Directory for generated audio files
            model_name: Coqui model identifier
            use_gpu: Whether to use GPU acceleration (if available)
        """
        super().__init__(output_dir)
        self.model_name = model_name
        self._cloned_voices: Dict[str, Path] = {}

        # Initialize lock on first instantiation
        if CoquiTTSService._model_lock is None:
            CoquiTTSService._model_lock = asyncio.Lock()

        # Check GPU availability
        try:
            import torch
            if use_gpu and torch.cuda.is_available():
                self.use_gpu = True
                device_name = torch.cuda.get_device_name(0)
                logger.info(f"Coqui TTS: GPU acceleration enabled ({device_name})")
            else:
                self.use_gpu = False
                if use_gpu:
                    logger.warning("Coqui TTS: GPU requested but CUDA not available, falling back to CPU")
                else:
                    logger.info("Coqui TTS: Using CPU mode")
        except ImportError:
            self.use_gpu = False
            logger.warning("Coqui TTS: torch not available, using CPU mode")

    @property
    def provider_name(self) -> str:
        """Return provider identifier."""
        return "coqui"

    @property
    def cost_per_1k_chars(self) -> float:
        """Return cost per 1000 characters (free)."""
        return 0.0

    async def _get_model(self) -> 'TTS':
        """
        Lazy load and cache TTS model.

        Uses class-level cache to share model across instances.
        Thread-safe with asyncio.Lock.

        Returns:
            Initialized TTS model
        """
        # Check cache first (outside lock for performance)
        if self.model_name in CoquiTTSService._model_cache:
            return CoquiTTSService._model_cache[self.model_name]

        # Load model (synchronized)
        async with CoquiTTSService._model_lock:
            # Double-check after acquiring lock
            if self.model_name in CoquiTTSService._model_cache:
                return CoquiTTSService._model_cache[self.model_name]

            logger.info(f"Loading Coqui TTS model: {self.model_name}")

            # Run synchronous TTS() initialization in executor
            loop = asyncio.get_event_loop()

            def load_model():
                # Lazy import to avoid loading PyTorch on module import
                from TTS.api import TTS

                # Initialize model
                device = "cuda" if self.use_gpu else "cpu"
                model = TTS(self.model_name).to(device)
                return model

            model = await loop.run_in_executor(None, load_model)

            # Cache for future use
            CoquiTTSService._model_cache[self.model_name] = model
            logger.info(f"Coqui TTS model loaded successfully")

            return model

    async def list_voices(self, language: Optional[str] = None) -> List[TTSVoice]:
        """
        List available voices.

        XTTS doesn't have preset voices - only cloned voices.

        Args:
            language: Optional language filter (ignored for XTTS)

        Returns:
            List of cloned voices
        """
        voices = []
        for voice_id, sample_path in self._cloned_voices.items():
            # Extract name from voice_id (format: name_uuid)
            name = voice_id.rsplit('_', 1)[0]
            voices.append(TTSVoice(
                id=voice_id,
                name=name,
                language="multi",  # XTTS supports multiple languages
                gender=None,
                provider="coqui",
                requires_cloning=True,
                cost_per_1k_chars=0.0
            ))
        return voices

    async def generate_audio(
        self,
        text: str,
        voice_id: str,
        output_path: Path,
        language: str = "en",
        **kwargs
    ) -> TTSResult:
        """
        Generate audio from text using cloned voice.

        Args:
            text: Text to convert to speech
            voice_id: Cloned voice identifier
            output_path: Where to save the audio file
            language: Language code (en, ro, es, etc.)
            **kwargs: Additional parameters (ignored)

        Returns:
            TTSResult with audio path, duration, and cost

        Raises:
            ValueError: If voice_id not found in cloned voices
        """
        # Validate voice exists
        if voice_id not in self._cloned_voices:
            raise ValueError(
                f"Voice {voice_id} not found. Available voices: {list(self._cloned_voices.keys())}"
            )

        sample_path = self._cloned_voices[voice_id]

        # Load model
        model = await self._get_model()

        # Generate audio in executor (synchronous operation)
        loop = asyncio.get_event_loop()

        def generate():
            model.tts_to_file(
                text=text,
                speaker_wav=str(sample_path),
                language=language,
                file_path=str(output_path)
            )

        await loop.run_in_executor(None, generate)

        # Calculate duration
        import librosa
        duration = librosa.get_duration(path=str(output_path))

        return TTSResult(
            audio_path=output_path,
            duration_seconds=duration,
            provider="coqui",
            voice_id=voice_id,
            cost=0.0  # Free
        )

    async def supports_voice_cloning(self) -> bool:
        """Check if provider supports voice cloning."""
        return True

    async def clone_voice(
        self,
        sample_audio_path: Path,
        voice_name: str,
        **kwargs
    ) -> TTSVoice:
        """
        Clone a voice from audio sample.

        Args:
            sample_audio_path: Path to sample audio file (6+ seconds recommended)
            voice_name: Name for the cloned voice
            **kwargs: Additional parameters (ignored)

        Returns:
            TTSVoice metadata for the cloned voice

        Raises:
            FileNotFoundError: If sample audio doesn't exist
            ValueError: If sample is too short (< 6 seconds)
        """
        # Validate sample exists
        if not sample_audio_path.exists():
            raise FileNotFoundError(f"Sample audio not found: {sample_audio_path}")

        # Validate duration
        import librosa
        duration = librosa.get_duration(path=str(sample_audio_path))

        if duration < 6.0:
            raise ValueError(
                f"Sample audio too short ({duration:.1f}s). "
                f"Minimum 6 seconds required for quality voice cloning."
            )

        # Generate unique voice ID
        voice_id = f"{voice_name}_{uuid.uuid4().hex[:8]}"

        # Store sample path
        self._cloned_voices[voice_id] = sample_audio_path

        logger.info(f"Cloned voice '{voice_name}' as {voice_id} (sample: {duration:.1f}s)")

        return TTSVoice(
            id=voice_id,
            name=voice_name,
            language="multi",
            gender=None,
            provider="coqui",
            requires_cloning=True,
            cost_per_1k_chars=0.0
        )
