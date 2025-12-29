"""
Voice Activity Detection (VAD) Service
Detectează segmentele cu voce umană în audio pentru a le putea muta/elimina.
Folosește Silero VAD - model gratuit, rapid și precis.
"""
import logging
import subprocess
import json
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Try to import torch and silero
SILERO_AVAILABLE = False
try:
    import torch
    SILERO_AVAILABLE = True
except ImportError:
    logger.warning("PyTorch not installed. Voice detection will not be available.")
    torch = None


@dataclass
class VoiceSegment:
    """Segment de audio care conține voce."""
    start_time: float  # secunde
    end_time: float    # secunde
    confidence: float  # 0-1

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    def to_dict(self) -> dict:
        return {
            "start": round(self.start_time, 3),
            "end": round(self.end_time, 3),
            "duration": round(self.duration, 3),
            "confidence": round(self.confidence, 3)
        }


class VoiceDetector:
    """
    Detectează segmente cu voce umană folosind Silero VAD.

    Utilizare:
        detector = VoiceDetector()
        voice_segments = detector.detect_voice(video_path)
        # voice_segments = [(0.5, 2.3), (5.1, 8.4), ...]
    """

    def __init__(self, threshold: float = 0.5, min_speech_duration: float = 0.25):
        """
        Args:
            threshold: Pragul de detecție (0-1). Mai mare = mai strict.
            min_speech_duration: Durata minimă pentru a considera un segment ca voce (secunde)
        """
        self.threshold = threshold
        self.min_speech_duration = min_speech_duration
        self.model = None
        self.utils = None
        self._sample_rate = 16000  # Silero VAD necesită 16kHz

        if SILERO_AVAILABLE:
            self._load_model()

    def _load_model(self):
        """Încarcă modelul Silero VAD."""
        try:
            self.model, self.utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                trust_repo=True
            )
            logger.info("Silero VAD model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load Silero VAD model: {e}")
            self.model = None

    def _extract_audio(self, video_path: Path, output_path: Path) -> bool:
        """
        Extrage audio din video în format WAV 16kHz mono.
        """
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # WAV format
            "-ar", str(self._sample_rate),  # 16kHz sample rate
            "-ac", "1",  # Mono
            str(output_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"FFmpeg audio extraction failed: {result.stderr}")
            return False
        return True

    def _read_audio(self, audio_path: Path) -> Optional[torch.Tensor]:
        """Citește fișierul audio ca tensor."""
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(str(audio_path))

            # Resample dacă e necesar
            if sample_rate != self._sample_rate:
                resampler = torchaudio.transforms.Resample(sample_rate, self._sample_rate)
                waveform = resampler(waveform)

            # Convert to mono
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            return waveform.squeeze()
        except ImportError:
            # Fallback: use scipy
            try:
                from scipy.io import wavfile
                import numpy as np

                sample_rate, audio = wavfile.read(str(audio_path))

                # Convert to float
                if audio.dtype == np.int16:
                    audio = audio.astype(np.float32) / 32768.0
                elif audio.dtype == np.int32:
                    audio = audio.astype(np.float32) / 2147483648.0

                # Convert to mono
                if len(audio.shape) > 1:
                    audio = audio.mean(axis=1)

                return torch.from_numpy(audio)
            except Exception as e:
                logger.error(f"Failed to read audio: {e}")
                return None

    def detect_voice(self, video_path: Path) -> List[VoiceSegment]:
        """
        Detectează segmentele cu voce în video.

        Args:
            video_path: Calea către fișierul video

        Returns:
            Lista de VoiceSegment cu timestamp-urile unde există voce
        """
        if not SILERO_AVAILABLE or self.model is None:
            logger.warning("Silero VAD not available, returning empty list")
            return []

        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        # Extragem audio într-un fișier temporar
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_audio = Path(tmp.name)

        try:
            logger.info(f"Extracting audio from: {video_path.name}")
            if not self._extract_audio(video_path, tmp_audio):
                return []

            # Citim audio
            audio = self._read_audio(tmp_audio)
            if audio is None:
                return []

            logger.info(f"Audio loaded: {len(audio) / self._sample_rate:.2f}s")

            # Detectăm voce folosind Silero VAD
            (get_speech_timestamps, _, read_audio, *_) = self.utils

            speech_timestamps = get_speech_timestamps(
                audio,
                self.model,
                threshold=self.threshold,
                sampling_rate=self._sample_rate,
                min_speech_duration_ms=int(self.min_speech_duration * 1000),
                min_silence_duration_ms=100,  # Pauze minime între segmente
                return_seconds=True
            )

            # Convertim la VoiceSegment
            voice_segments = []
            for ts in speech_timestamps:
                seg = VoiceSegment(
                    start_time=ts['start'],
                    end_time=ts['end'],
                    confidence=self.threshold  # Silero nu returnează confidence per segment
                )
                voice_segments.append(seg)

            logger.info(f"Detected {len(voice_segments)} voice segments")
            for seg in voice_segments[:5]:  # Log first 5
                logger.debug(f"  Voice: {seg.start_time:.2f}s - {seg.end_time:.2f}s ({seg.duration:.2f}s)")

            return voice_segments

        finally:
            # Cleanup
            tmp_audio.unlink(missing_ok=True)

    def get_mute_intervals(
        self,
        voice_segments: List[VoiceSegment],
        padding: float = 0.1
    ) -> List[Tuple[float, float]]:
        """
        Convertește segmentele de voce în intervale de mute.
        Adaugă padding pentru tranziții mai line.

        Args:
            voice_segments: Lista de segmente cu voce
            padding: Secunde de padding înainte și după fiecare segment

        Returns:
            Lista de tuple (start, end) pentru intervalele de mute
        """
        mute_intervals = []

        for seg in voice_segments:
            start = max(0, seg.start_time - padding)
            end = seg.end_time + padding

            # Merge overlapping intervals
            if mute_intervals and mute_intervals[-1][1] >= start:
                mute_intervals[-1] = (mute_intervals[-1][0], max(mute_intervals[-1][1], end))
            else:
                mute_intervals.append((start, end))

        return mute_intervals


def mute_voice_segments(
    video_path: Path,
    output_path: Path,
    voice_segments: List[VoiceSegment],
    fade_duration: float = 0.05,
    keep_percentage: float = 0.0
) -> bool:
    """
    Aplică mute pe segmentele cu voce din video folosind FFmpeg.

    Args:
        video_path: Calea către video original
        output_path: Calea pentru video output
        voice_segments: Lista de segmente cu voce de mutat
        fade_duration: Durata fade in/out pentru tranziții line (secunde)
        keep_percentage: Cât din volumul original să păstreze (0-1). 0 = mute complet.

    Returns:
        True dacă operația a reușit
    """
    if not voice_segments:
        # No voice segments, just copy
        import shutil
        shutil.copy(video_path, output_path)
        return True

    # Construim filtrul audio pentru FFmpeg
    # Sintaxa corectă: volume=LEVEL:enable='CONDITION'
    # Folosim + pentru a combina multiple condiții (OR în FFmpeg)
    vol = keep_percentage if keep_percentage > 0 else 0

    # Construim condițiile combinate
    conditions = []
    for seg in voice_segments:
        conditions.append(f"between(t,{seg.start_time:.3f},{seg.end_time:.3f})")

    # Un singur filtru volume cu toate condițiile
    combined_condition = "+".join(conditions)
    audio_filter = f"volume={vol}:enable='{combined_condition}'"

    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-af", audio_filter,
        "-c:v", "copy",  # Nu re-encodăm video
        "-c:a", "aac",
        "-b:a", "128k",
        str(output_path)
    ]

    logger.info(f"Muting {len(voice_segments)} voice segments in video")
    logger.debug(f"FFmpeg command: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"FFmpeg mute failed: {result.stderr}")
        return False

    logger.info(f"Voice muting completed: {output_path}")
    return True


def remove_voice_keep_effects(
    video_path: Path,
    output_path: Path,
    detector: Optional[VoiceDetector] = None
) -> Tuple[bool, List[VoiceSegment]]:
    """
    Funcție helper: detectează și mută automat vocile din video.

    Args:
        video_path: Calea către video
        output_path: Calea pentru output
        detector: VoiceDetector opțional (se creează unul nou dacă nu e furnizat)

    Returns:
        Tuple (success, voice_segments)
    """
    if detector is None:
        detector = VoiceDetector()

    # Detectăm voce
    voice_segments = detector.detect_voice(video_path)

    if not voice_segments:
        logger.info("No voice detected, keeping original audio")
        import shutil
        shutil.copy(video_path, output_path)
        return True, []

    # Aplicăm mute
    success = mute_voice_segments(video_path, output_path, voice_segments)

    return success, voice_segments
