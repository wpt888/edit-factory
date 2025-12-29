# -*- coding: utf-8 -*-
"""
Voice Cloning Service - Edge TTS + OpenVoice.

Pipeline:
1. Edge TTS generates Romanian/multilingual audio (free, proper pronunciation)
2. OpenVoice converts voice timbre to match reference sample (free, MIT license)

Features:
- 100% FREE - no API costs
- Proper Romanian pronunciation with diacritics
- Voice cloning from any reference audio (min 10 seconds recommended)
- GPU accelerated on CUDA
"""
import sys
import asyncio
import logging
from pathlib import Path
from typing import Optional, Dict, Tuple
from dataclasses import dataclass
import hashlib

# Add OpenVoice to path
OPENVOICE_PATH = Path(__file__).parent.parent.parent / "openvoice_repo"
if str(OPENVOICE_PATH) not in sys.path:
    sys.path.insert(0, str(OPENVOICE_PATH))

import torch
import edge_tts

# OpenVoice imports (lazy loaded)
_openvoice_loaded = False
_se_extractor = None
_ToneColorConverter = None

logger = logging.getLogger(__name__)


def _load_openvoice():
    """Lazy load OpenVoice to avoid import overhead."""
    global _openvoice_loaded, _se_extractor, _ToneColorConverter
    if not _openvoice_loaded:
        from openvoice import se_extractor
        from openvoice.api import ToneColorConverter
        _se_extractor = se_extractor
        _ToneColorConverter = ToneColorConverter
        _openvoice_loaded = True
    return _se_extractor, _ToneColorConverter


@dataclass
class VoiceProfile:
    """Cached voice profile for a reference speaker."""
    name: str
    embedding: torch.Tensor
    source_path: Path
    hash: str


class VoiceCloningService:
    """
    Service for voice cloning using Edge TTS + OpenVoice.

    Usage:
        service = VoiceCloningService()
        await service.initialize()

        # Load reference voice
        profile = service.load_voice_profile(Path("reference.mp3"), "ana_maria")

        # Generate cloned audio
        result = await service.synthesize(
            text="Buna ziua!",
            voice_profile=profile,
            output_path=Path("output.wav")
        )
    """

    def __init__(
        self,
        openvoice_dir: Optional[Path] = None,
        cache_dir: Optional[Path] = None,
        device: Optional[str] = None
    ):
        """
        Initialize VoiceCloningService.

        Args:
            openvoice_dir: Path to OpenVoice repo with checkpoints
            cache_dir: Directory to cache voice profiles
            device: PyTorch device ("cuda:0", "cpu", or None for auto)
        """
        self.openvoice_dir = openvoice_dir or OPENVOICE_PATH
        self.cache_dir = cache_dir or Path(__file__).parent.parent.parent / "voice_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Device selection
        if device is None:
            self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        else:
            self.device = device

        self.converter: Optional[object] = None
        self.voice_profiles: Dict[str, VoiceProfile] = {}
        self._initialized = False

        logger.info(f"VoiceCloningService created (device: {self.device})")

    def initialize(self):
        """Initialize the OpenVoice converter. Must be called before use."""
        if self._initialized:
            return

        se_extractor, ToneColorConverter = _load_openvoice()

        ckpt_path = self.openvoice_dir / "checkpoints_v2" / "converter"
        config_path = ckpt_path / "config.json"
        checkpoint_path = ckpt_path / "checkpoint.pth"

        if not config_path.exists():
            raise FileNotFoundError(
                f"OpenVoice checkpoints not found at {ckpt_path}. "
                "Please download from: https://myshell-public-repo-host.s3.amazonaws.com/openvoice/checkpoints_v2_0417.zip"
            )

        self.converter = ToneColorConverter(str(config_path), device=self.device)
        self.converter.load_ckpt(str(checkpoint_path))

        self._initialized = True
        logger.info(f"OpenVoice initialized on {self.device}")

        if torch.cuda.is_available():
            logger.info(f"GPU: {torch.cuda.get_device_name(0)}")

    def _ensure_initialized(self):
        """Ensure the service is initialized."""
        if not self._initialized:
            self.initialize()

    def _get_file_hash(self, file_path: Path) -> str:
        """Get a short hash of a file for caching."""
        with open(file_path, "rb") as f:
            return hashlib.md5(f.read()).hexdigest()[:12]

    def load_voice_profile(
        self,
        reference_audio: Path,
        name: Optional[str] = None
    ) -> VoiceProfile:
        """
        Load or create a voice profile from reference audio.

        Args:
            reference_audio: Path to reference audio (MP3/WAV, min 10 seconds)
            name: Optional name for the profile (default: filename)

        Returns:
            VoiceProfile object with cached embedding
        """
        self._ensure_initialized()
        se_extractor, _ = _load_openvoice()

        reference_audio = Path(reference_audio)
        if not reference_audio.exists():
            raise FileNotFoundError(f"Reference audio not found: {reference_audio}")

        name = name or reference_audio.stem
        file_hash = self._get_file_hash(reference_audio)

        # Check cache
        cache_key = f"{name}_{file_hash}"
        if cache_key in self.voice_profiles:
            logger.info(f"Using cached voice profile: {name}")
            return self.voice_profiles[cache_key]

        # Check if embedding is saved
        embedding_path = self.cache_dir / f"{cache_key}_se.pth"
        if embedding_path.exists():
            logger.info(f"Loading cached embedding: {embedding_path}")
            embedding = torch.load(embedding_path, map_location=self.device)
        else:
            # Extract new embedding
            logger.info(f"Extracting voice embedding from: {reference_audio}")
            embedding, _ = se_extractor.get_se(
                str(reference_audio),
                self.converter,
                target_dir=str(self.cache_dir / "processed"),
                vad=True
            )
            # Save for future use
            torch.save(embedding, embedding_path)
            logger.info(f"Saved voice embedding: {embedding_path}")

        profile = VoiceProfile(
            name=name,
            embedding=embedding,
            source_path=reference_audio,
            hash=file_hash
        )

        self.voice_profiles[cache_key] = profile
        return profile

    async def generate_base_tts(
        self,
        text: str,
        output_path: Path,
        voice: str = "ro-RO-AlinaNeural",
        rate: str = "+10%",
        volume: str = "+0%",
        pitch: str = "+0Hz"
    ) -> Path:
        """
        Generate base audio using Edge TTS.

        Args:
            text: Text to synthesize
            output_path: Output file path
            voice: Edge TTS voice name
            rate: Speech rate adjustment
            volume: Volume adjustment
            pitch: Pitch adjustment

        Returns:
            Path to generated audio
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            volume=volume,
            pitch=pitch
        )

        await communicate.save(str(output_path))
        logger.info(f"Edge TTS generated: {output_path}")
        return output_path

    def convert_voice(
        self,
        source_audio: Path,
        voice_profile: VoiceProfile,
        output_path: Path
    ) -> Path:
        """
        Convert voice timbre from source to target profile.

        Args:
            source_audio: Input audio path
            voice_profile: Target voice profile
            output_path: Output file path

        Returns:
            Path to converted audio
        """
        self._ensure_initialized()
        se_extractor, _ = _load_openvoice()

        source_audio = Path(source_audio)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Extract source speaker embedding
        source_se, _ = se_extractor.get_se(
            str(source_audio),
            self.converter,
            target_dir=str(self.cache_dir / "processed"),
            vad=True
        )

        # Convert
        self.converter.convert(
            audio_src_path=str(source_audio),
            src_se=source_se,
            tgt_se=voice_profile.embedding,
            output_path=str(output_path),
            message="@EditFactory"
        )

        logger.info(f"Voice converted: {output_path}")
        return output_path

    async def synthesize(
        self,
        text: str,
        voice_profile: VoiceProfile,
        output_path: Path,
        base_voice: str = "ro-RO-AlinaNeural",
        rate: str = "+10%",
        keep_base: bool = False
    ) -> Dict[str, Path]:
        """
        Full pipeline: text -> Edge TTS -> voice conversion -> output.

        Args:
            text: Text to synthesize
            voice_profile: Target voice profile
            output_path: Final output path
            base_voice: Edge TTS voice for base generation
            rate: Speech rate
            keep_base: Keep the intermediate Edge TTS file

        Returns:
            Dict with paths: {"final": Path, "base": Optional[Path]}
        """
        self._ensure_initialized()

        output_path = Path(output_path)
        base_path = output_path.parent / f"{output_path.stem}_base.mp3"

        # Step 1: Generate base TTS
        await self.generate_base_tts(
            text=text,
            output_path=base_path,
            voice=base_voice,
            rate=rate
        )

        # Step 2: Convert voice
        self.convert_voice(
            source_audio=base_path,
            voice_profile=voice_profile,
            output_path=output_path
        )

        result = {"final": output_path}

        if keep_base:
            result["base"] = base_path
        else:
            base_path.unlink(missing_ok=True)

        return result

    def synthesize_sync(
        self,
        text: str,
        voice_profile: VoiceProfile,
        output_path: Path,
        base_voice: str = "ro-RO-AlinaNeural",
        rate: str = "+10%",
        keep_base: bool = False
    ) -> Dict[str, Path]:
        """Synchronous version of synthesize."""
        return asyncio.run(self.synthesize(
            text=text,
            voice_profile=voice_profile,
            output_path=output_path,
            base_voice=base_voice,
            rate=rate,
            keep_base=keep_base
        ))


# Available Edge TTS voices for Romanian
ROMANIAN_VOICES = {
    "female": "ro-RO-AlinaNeural",
    "male": "ro-RO-EmilNeural"
}


# Quick test
if __name__ == "__main__":
    import sys
    import io

    # Fix Windows encoding
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

    logging.basicConfig(level=logging.INFO)

    async def test():
        print("=" * 60)
        print("VoiceCloningService Test")
        print("=" * 60)

        # Initialize service
        service = VoiceCloningService()
        service.initialize()

        # Load voice profile
        ref_audio = Path(r"C:\OBSID SRL\n8n\edit_factory\input\ElevenLabs_2025-12-08T17_11_29_Ana Maria _pvc_sp117_s57_sb75_se22_b_m2.mp3")
        profile = service.load_voice_profile(ref_audio, "ana_maria")
        print(f"Loaded profile: {profile.name}")

        # Synthesize
        text = "Buna ziua! Aceasta este o demonstratie a sistemului de clonare vocala."
        output = Path(r"C:\OBSID SRL\n8n\edit_factory\output\service_test_cloned.wav")

        result = await service.synthesize(
            text=text,
            voice_profile=profile,
            output_path=output,
            keep_base=True
        )

        print(f"Final audio: {result['final']}")
        if 'base' in result:
            print(f"Base audio: {result['base']}")

        print("=" * 60)
        print("TEST COMPLETE!")
        print("=" * 60)

    asyncio.run(test())
