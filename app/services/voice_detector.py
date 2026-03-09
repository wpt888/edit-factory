"""
Voice Activity Detection (VAD) Service
Detects human voice segments in audio for muting/removal.
Uses Silero VAD - free, fast, and accurate model.
"""
import logging
import subprocess
import json
import tempfile
import threading
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import dataclass

from app.services.ffmpeg_semaphore import safe_ffmpeg_run

logger = logging.getLogger(__name__)

# Try to import torch and silero
SILERO_AVAILABLE = False
try:
    import torch
    SILERO_AVAILABLE = True
except ImportError:
    logger.warning("PyTorch not installed. Voice detection will not be available.")
    torch = None

# Module-level model cache to avoid reloading on each VoiceDetector instantiation
_cached_model = None
_cached_utils = None
_model_cache_lock = threading.Lock()
_model_load_attempted = False  # M7: Track if load was already attempted (prevents retries on failure)


@dataclass
class VoiceSegment:
    """Audio segment containing voice."""
    start_time: float  # seconds
    end_time: float    # seconds
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
    Detects human voice segments using Silero VAD.

    Usage:
        detector = VoiceDetector()
        voice_segments = detector.detect_voice(video_path)
        # voice_segments = [(0.5, 2.3), (5.1, 8.4), ...]
    """

    def __init__(self, threshold: float = 0.5, min_speech_duration: float = 0.25):
        """
        Args:
            threshold: Detection threshold (0-1). Higher = stricter.
            min_speech_duration: Minimum duration to consider a segment as voice (seconds)
        """
        self.threshold = threshold
        self.min_speech_duration = min_speech_duration
        self.model = None
        self.utils = None
        self._sample_rate = 16000  # Silero VAD requires 16kHz

        if SILERO_AVAILABLE:
            self._load_model()

    def _load_model(self):
        """Load Silero VAD model (uses module-level cache)."""
        global _cached_model, _cached_utils, _model_load_attempted
        with _model_cache_lock:
            if _cached_model is not None:
                self.model = _cached_model
                self.utils = _cached_utils
                logger.info("Silero VAD model reused from cache")
                return
            # M7: Don't retry if a previous load already failed
            if _model_load_attempted:
                logger.debug("Silero VAD model load already attempted and failed, skipping retry")
                return
            _model_load_attempted = True
            try:
                model, utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    trust_repo=True,
                    verbose=False
                )
                _cached_model = model
                _cached_utils = utils
                self.model = model
                self.utils = utils
                logger.info("Silero VAD model loaded successfully")
            except (OSError, ConnectionError, TimeoutError) as e:
                logger.warning(f"Network unavailable for Silero VAD download, trying cached: {e}")
                try:
                    model, utils = torch.hub.load(
                        repo_or_dir='snakers4/silero-vad',
                        model='silero_vad',
                        force_reload=False,
                        trust_repo=True,
                        verbose=False,
                        source='local'
                    )
                    _cached_model = model
                    _cached_utils = utils
                    self.model = model
                    self.utils = utils
                    logger.info("Silero VAD model loaded from cache")
                except TypeError:
                    # PyTorch 2.1+ removed source parameter
                    try:
                        model, utils = torch.hub.load(
                            repo_or_dir='snakers4/silero-vad',
                            model='silero_vad',
                            force_reload=False,
                            trust_repo=True,
                            verbose=False
                        )
                        _cached_model = model
                        _cached_utils = utils
                        self.model = model
                        self.utils = utils
                        logger.info("Silero VAD model loaded (without source param)")
                    except Exception as e3:
                        logger.error(f"Failed to load Silero VAD model: {e3}")
                        self.model = None
                except Exception as e2:
                    logger.error(f"Failed to load Silero VAD model (no cache available): {e2}")
                    self.model = None
            except Exception as e:
                logger.error(f"Failed to load Silero VAD model: {e}")
                self.model = None

    def _extract_audio(self, video_path: Path, output_path: Path) -> bool:
        """
        Extract audio from video in WAV 16kHz mono format.
        """
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-i", str(video_path),
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # WAV format
            "-ar", str(self._sample_rate),  # 16kHz sample rate
            "-ac", "1",  # Mono
            str(output_path)
        ]

        result = safe_ffmpeg_run(cmd, 60, "extract audio")
        if result.returncode != 0:
            logger.error(f"FFmpeg audio extraction failed: {result.stderr}")
            return False
        return True

    def _convert_to_wav(self, audio_path: Path, output_path: Path) -> bool:
        """Convert any audio format to WAV 16kHz mono."""
        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-i", str(audio_path),
            "-vn",  # No video
            "-acodec", "pcm_s16le",  # WAV format
            "-ar", str(self._sample_rate),  # 16kHz sample rate
            "-ac", "1",  # Mono
            str(output_path)
        ]
        result = safe_ffmpeg_run(cmd, 60, "convert to wav")
        if result.returncode != 0:
            logger.error(f"FFmpeg audio conversion failed: {result.stderr}")
            return False
        return True

    def _read_audio(self, audio_path: Path) -> Optional[torch.Tensor]:
        """Read the audio file as tensor."""
        try:
            import torchaudio
            waveform, sample_rate = torchaudio.load(str(audio_path))

            # Resample if needed
            if sample_rate != self._sample_rate:
                resampler = torchaudio.transforms.Resample(sample_rate, self._sample_rate)
                waveform = resampler(waveform)

            # Convert to mono
            if waveform.shape[0] > 1:
                waveform = waveform.mean(dim=0, keepdim=True)

            return waveform.squeeze()
        except ImportError:
            pass  # Fall through to scipy fallback
        except Exception as e:
            logger.warning(f"Failed to load audio file {audio_path}: {e}")
            # Fall through to scipy fallback

        # Fallback: use scipy (requires WAV format)
        try:
            from scipy.io import wavfile
            import numpy as np

            audio_path = Path(audio_path)

            # If not WAV, convert first via FFmpeg
            if audio_path.suffix.lower() not in ['.wav', '.wave']:
                tmp_wav = None
                try:
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                        tmp_wav = Path(tmp.name)
                    if not self._convert_to_wav(audio_path, tmp_wav):
                        return None
                    audio_path = tmp_wav
                    sample_rate, audio = wavfile.read(str(audio_path))
                finally:
                    if tmp_wav is not None:
                        tmp_wav.unlink(missing_ok=True)
            else:
                sample_rate, audio = wavfile.read(str(audio_path))

            # Convert to float
            if audio.dtype == np.int16:
                audio = audio.astype(np.float32) / 32768.0
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float32) / 2147483648.0

            # Resample if needed (rare — _extract_audio already produces 16kHz)
            if sample_rate != self._sample_rate:
                import scipy.signal
                # Use polyphase FIR filter for better phase preservation
                gcd = np.gcd(self._sample_rate, sample_rate)
                up = self._sample_rate // gcd
                down = sample_rate // gcd
                audio = scipy.signal.resample_poly(audio, up, down)

            # Convert to mono
            if len(audio.shape) > 1:
                audio = audio.mean(axis=1)

            if not SILERO_AVAILABLE:
                logger.error("Cannot convert audio: PyTorch not available")
                return None
            return torch.from_numpy(audio.astype(np.float32))
        except Exception as e:
            logger.error(f"Failed to read audio: {e}")
            return None

    def detect_voice(self, video_path: Path) -> List[VoiceSegment]:
        """
        Detect voice segments in video.

        Args:
            video_path: Path to the video file

        Returns:
            List of VoiceSegment with timestamps where voice exists
        """
        if not SILERO_AVAILABLE or self.model is None:
            logger.warning("Silero VAD not available, returning empty list")
            return []

        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        # Extract audio into a temporary file
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

            # Detect voice folosind Silero VAD
            (get_speech_timestamps, _, read_audio, *_) = self.utils

            speech_timestamps = get_speech_timestamps(
                audio,
                self.model,
                threshold=self.threshold,
                sampling_rate=self._sample_rate,
                min_speech_duration_ms=int(self.min_speech_duration * 1000),
                min_silence_duration_ms=100,  # Minimum pauses between segments
                return_seconds=True
            )

            # Convert to VoiceSegment
            # Silero get_speech_timestamps returns only start/end, no per-segment
            # probability. All returned segments passed the threshold, so confidence
            # represents the minimum guaranteed probability (actual is >= threshold).
            voice_segments = []
            for ts in speech_timestamps:
                seg = VoiceSegment(
                    start_time=ts['start'],
                    end_time=ts['end'],
                    confidence=self.threshold
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
        Convert voice segments to mute intervals.
        Adds padding for smoother transitions.

        Args:
            voice_segments: List of voice segments
            padding: Seconds of padding before and after each segment

        Returns:
            List of (start, end) tuples for mute intervals
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
    Apply mute to voice segments in video using FFmpeg.

    Args:
        video_path: Path to original video
        output_path: Path for output video
        voice_segments: List of voice segments to mute
        fade_duration: Fade in/out duration for smooth transitions (seconds)
        keep_percentage: How much of original volume to keep (0-1). 0 = complete mute.

    Returns:
        True if operation succeeded
    """
    if not voice_segments:
        # No voice segments, just copy
        import shutil
        shutil.copy(video_path, output_path)
        return True

    # Build audio filter for FFmpeg
    # Correct syntax: volume=LEVEL:enable='CONDITION'
    # Use + to combine multiple conditions (OR in FFmpeg)
    vol = keep_percentage if keep_percentage > 0 else 0

    # Build combined conditions
    conditions = []
    for seg in voice_segments:
        conditions.append(f"between(t,{seg.start_time:.3f},{seg.end_time:.3f})")

    # Single volume filter with all conditions
    combined_condition = "+".join(conditions)
    audio_filter = f"volume={vol}:enable='{combined_condition}'"

    cmd = [
        "ffmpeg", "-y", "-threads", "4",
        "-i", str(video_path),
        "-af", audio_filter,
        "-c:v", "copy",  # Don't re-encode video
        "-c:a", "aac",
        "-b:a", "128k",
        str(output_path)
    ]

    logger.info(f"Muting {len(voice_segments)} voice segments in video")
    logger.debug(f"FFmpeg command: {' '.join(cmd)}")

    result = safe_ffmpeg_run(cmd, 120, "mute voice segments")
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
    Helper function: automatically detect and mute voices in video.

    Args:
        video_path: Path to video
        output_path: Path for output
        detector: Optional VoiceDetector (creates new one if not provided)

    Returns:
        Tuple (success, voice_segments)
    """
    if detector is None:
        detector = VoiceDetector()

    # Detect voice
    voice_segments = detector.detect_voice(video_path)

    if not voice_segments:
        logger.info("No voice detected, keeping original audio")
        import shutil
        shutil.copy(video_path, output_path)
        return True, []

    # Apply mute
    success = mute_voice_segments(video_path, output_path, voice_segments)

    return success, voice_segments
