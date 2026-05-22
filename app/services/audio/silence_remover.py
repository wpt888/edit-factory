"""
Silence Remover Service
Removes long pauses from audio (TTS) while keeping words intact.
Uses Silero VAD for precise speech detection.
"""
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import dataclass

from app.services.ffmpeg_semaphore import safe_ffmpeg_run

logger = logging.getLogger(__name__)

# Try to import voice detector
try:
    from .voice_detector import VoiceDetector, VoiceSegment
    VAD_AVAILABLE = True
except ImportError:
    VAD_AVAILABLE = False
    logger.warning("VoiceDetector not available. Silence removal will use FFmpeg fallback.")


@dataclass
class SilenceRemovalResult:
    """Result of silence removal operation."""
    output_path: Path
    original_duration: float
    new_duration: float
    removed_duration: float
    segments_kept: int
    segments_map: Optional[List[Tuple[float, float]]] = None  # Kept regions (start, end) for timestamp remapping

    @property
    def compression_ratio(self) -> float:
        """How much the audio was compressed (0-1)."""
        if self.original_duration == 0:
            return 0
        return 1 - (self.new_duration / self.original_duration)

    def to_dict(self) -> dict:
        return {
            "output_path": str(self.output_path),
            "original_duration": round(self.original_duration, 2),
            "new_duration": round(self.new_duration, 2),
            "removed_duration": round(self.removed_duration, 2),
            "compression_ratio": round(self.compression_ratio * 100, 1),
            "segments_kept": self.segments_kept,
            "segments_map": [(round(s, 4), round(e, 4)) for s, e in self.segments_map] if self.segments_map else None
        }


class SilenceRemover:
    """
    Removes pauses from audio using VAD (Voice Activity Detection).

    Works in 3 steps:
    1. Detect voice segments (using Silero VAD)
    2. Add small padding (50-100ms) around each segment for natural transitions
    3. Concatenate only voice segments

    Key parameters:
    - min_silence_duration: Pauses shorter than this are NOT removed (preserves natural rhythm)
    - padding: How many seconds to keep before and after each word
    """

    def __init__(
        self,
        min_silence_duration: float = 0.3,  # Pauses < 300ms stay (natural rhythm)
        padding: float = 0.08,  # 80ms padding for smooth transitions
        speech_threshold: float = 0.5,  # Threshold for VAD
        min_speech_duration: float = 0.1,  # Segments shorter than 100ms are ignored
        target_pause_duration: Optional[float] = None  # If set, shorten long pauses to this instead of removing
    ):
        self.min_silence_duration = min_silence_duration
        self.padding = padding
        self.speech_threshold = speech_threshold
        self.min_speech_duration = min_speech_duration
        self.target_pause_duration = target_pause_duration

        # Voice detector (lazy loading)
        self._detector = None

    def _get_detector(self) -> Optional[VoiceDetector]:
        """Lazy load voice detector."""
        if not VAD_AVAILABLE:
            return None
        if self._detector is None:
            try:
                self._detector = VoiceDetector(
                    threshold=self.speech_threshold,
                    min_speech_duration=self.min_speech_duration
                )
            except Exception as e:
                logger.warning(f"Could not initialize VoiceDetector: {e}")
                return None
        return self._detector

    def _get_audio_duration(self, audio_path: Path) -> float:
        """Get audio duration in seconds."""
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path)
            ]
            result = safe_ffmpeg_run(cmd, 30, "audio duration")
            if result.returncode == 0:
                try:
                    return float(result.stdout.strip())
                except (ValueError, TypeError):
                    logger.warning(f"Could not parse audio duration: {result.stdout.strip()!r}")
                    return 0.0
        except Exception as e:
            logger.warning(f"Could not get audio duration: {e}")
        return 0.0

    def _merge_close_segments(
        self,
        segments: List[VoiceSegment]
    ) -> List[Tuple[float, float]]:
        """
        Merge nearby segments and add padding.
        Only removes pauses longer than min_silence_duration.
        """
        if not segments:
            return []

        # Sort by start time
        sorted_segs = sorted(segments, key=lambda s: s.start_time)

        merged = []
        current_start = max(0, sorted_segs[0].start_time - self.padding)
        current_end = sorted_segs[0].end_time + self.padding

        for seg in sorted_segs[1:]:
            seg_start = max(0.0, seg.start_time - self.padding)
            seg_end = seg.end_time + self.padding

            # Calculate gap between segments
            gap = seg_start - current_end

            if gap <= self.min_silence_duration:
                # Gap too small - extend current segment (keep natural pause)
                current_end = seg_end
            else:
                # Gap large enough - save current segment and start a new one
                merged.append((current_start, current_end))
                current_start = seg_start
                current_end = seg_end

        # Add the last segment
        merged.append((current_start, current_end))

        return merged

    def _build_output_regions(
        self,
        speech_segments: List[Tuple[float, float]],
        total_duration: float
    ) -> List[Tuple[float, float]]:
        """
        Build final extraction regions: speech + shortened pauses.

        When target_pause_duration is set, long pauses are shortened to that
        duration by taking a slice from the CENTER of each gap (avoids breathing
        sounds at edges). When None, gaps are skipped entirely (original behavior).
        """
        if not speech_segments:
            return []

        if self.target_pause_duration is None:
            return speech_segments

        regions = []
        for i, (start, end) in enumerate(speech_segments):
            # Add speech region
            regions.append((start, end))

            # Add shortened pause from the gap AFTER this segment
            if i < len(speech_segments) - 1:
                gap_start = end
                gap_end = speech_segments[i + 1][0]
                gap_duration = gap_end - gap_start

                if gap_duration > 0:
                    # Take a slice from the center of the gap
                    slice_duration = min(self.target_pause_duration, gap_duration)
                    center = (gap_start + gap_end) / 2
                    slice_start = center - slice_duration / 2
                    slice_end = center + slice_duration / 2
                    # Clamp to gap boundaries
                    slice_start = max(slice_start, gap_start)
                    slice_end = min(slice_end, gap_end)
                    regions.append((slice_start, slice_end))

        return regions

    def remove_silence_vad(
        self,
        audio_path: Path,
        output_path: Path
    ) -> SilenceRemovalResult:
        """
        Remove silence using VAD (precise method).
        """
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        original_duration = self._get_audio_duration(audio_path)

        # Detect voice
        detector = self._get_detector()
        if detector is None:
            raise RuntimeError("VoiceDetector not available")

        # For audio, we need to temporarily convert to video format
        # or use audio detection directly
        # Silero VAD works directly on audio, no video needed

        logger.info(f"Detecting speech in: {audio_path.name}")

        # Detect voice directly from audio
        voice_segments = self._detect_voice_in_audio(audio_path, detector)

        if not voice_segments:
            logger.warning("No speech detected, keeping original audio")
            import shutil
            shutil.copy(audio_path, output_path)
            return SilenceRemovalResult(
                output_path=output_path,
                original_duration=original_duration,
                new_duration=original_duration,
                removed_duration=0,
                segments_kept=0
            )

        # Merge nearby segments
        merged_segments = self._merge_close_segments(voice_segments)

        logger.info(f"Found {len(voice_segments)} speech segments, merged to {len(merged_segments)}")

        # Build output regions (speech + shortened pauses if target_pause_duration is set)
        output_regions = self._build_output_regions(merged_segments, original_duration)

        if self.target_pause_duration is not None:
            logger.info(f"Pause shortening: {len(merged_segments)} speech regions → {len(output_regions)} output regions (target pause: {self.target_pause_duration}s)")

        # Extract and concatenate segments
        with tempfile.TemporaryDirectory() as temp_dir:
            tmp_path = Path(temp_dir)
            segment_files = []

            for i, (start, end) in enumerate(output_regions):
                # Ensure we don't exceed original duration
                start = max(0, start)
                end = min(end, original_duration)

                if end <= start:
                    continue

                segment_file = tmp_path / f"segment_{i:03d}.wav"

                cmd = [
                    "ffmpeg", "-y", "-threads", "4",
                    "-ss", str(start),
                    "-i", str(audio_path),
                    "-t", str(end - start),
                    "-c:a", "pcm_s16le",  # WAV for precise concatenation
                    str(segment_file)
                ]

                result = safe_ffmpeg_run(cmd, 120, "silence segment extract")
                if result.returncode == 0 and segment_file.exists():
                    segment_files.append(segment_file)
                    logger.debug(f"Extracted segment {i}: {start:.2f}s - {end:.2f}s")

            if not segment_files:
                logger.warning("No segments extracted, keeping original")
                import shutil
                shutil.copy(audio_path, output_path)
                return SilenceRemovalResult(
                    output_path=output_path,
                    original_duration=original_duration,
                    new_duration=original_duration,
                    removed_duration=0,
                    segments_kept=0
                )

            # Create concat file
            concat_file = tmp_path / "concat.txt"
            with open(concat_file, 'w', encoding='utf-8') as f:
                for seg_file in segment_files:
                    # Escape path
                    escaped = str(seg_file).replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")

            # Concatenate and convert to final format
            output_ext = output_path.suffix.lower()
            if output_ext == '.mp3':
                audio_codec = ["-c:a", "libmp3lame", "-b:a", "192k"]
            elif output_ext == '.aac':
                audio_codec = ["-c:a", "aac", "-b:a", "192k"]
            elif output_ext == '.wav':
                audio_codec = ["-c:a", "pcm_s16le"]
            else:
                audio_codec = ["-c:a", "copy"]

            cmd = [
                "ffmpeg", "-y", "-threads", "4",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_file),
                *audio_codec,
                str(output_path)
            ]

            result = safe_ffmpeg_run(cmd, 120, "silence concat")
            if result.returncode != 0:
                raise RuntimeError(f"FFmpeg concat failed: {result.stderr}")

        new_duration = self._get_audio_duration(output_path)
        removed_duration = original_duration - new_duration

        logger.info(f"Silence removal complete: {original_duration:.1f}s -> {new_duration:.1f}s (removed {removed_duration:.1f}s)")

        return SilenceRemovalResult(
            output_path=output_path,
            original_duration=original_duration,
            new_duration=new_duration,
            removed_duration=removed_duration,
            segments_kept=len(output_regions),
            segments_map=output_regions
        )

    def _detect_voice_in_audio(
        self,
        audio_path: Path,
        detector: VoiceDetector
    ) -> List[VoiceSegment]:
        """
        Detect voice directly in audio file (not video).
        Silero VAD works on any audio, not just from video.
        """
        import torch

        if detector.model is None:
            return []

        try:
            # Citim audio
            audio = detector._read_audio(audio_path)
            if audio is None:
                return []

            logger.info(f"Audio loaded: {len(audio) / detector._sample_rate:.2f}s")

            # Detect voice
            (get_speech_timestamps, _, read_audio, *_) = detector.utils

            speech_timestamps = get_speech_timestamps(
                audio,
                detector.model,
                threshold=detector.threshold,
                sampling_rate=detector._sample_rate,
                min_speech_duration_ms=int(detector.min_speech_duration * 1000),
                min_silence_duration_ms=100,
                return_seconds=True
            )

            # Convert to VoiceSegment
            voice_segments = []
            for ts in speech_timestamps:
                seg = VoiceSegment(
                    start_time=ts['start'],
                    end_time=ts['end'],
                    confidence=detector.threshold
                )
                voice_segments.append(seg)

            logger.info(f"Detected {len(voice_segments)} voice segments")
            return voice_segments

        except Exception as e:
            logger.error(f"Voice detection failed: {e}")
            return []

    def remove_silence_ffmpeg(
        self,
        audio_path: Path,
        output_path: Path,
        silence_threshold_db: float = -40,
        min_silence_duration: float = 0.3
    ) -> SilenceRemovalResult:
        """
        Remove silence using FFmpeg silenceremove (simple method).
        Fallback if VAD is not available.

        This method is less precise but works without PyTorch.
        """
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        original_duration = self._get_audio_duration(audio_path)

        # FFmpeg silenceremove filter
        # Remove silence from start and end, and compress internal pauses
        filter_complex = (
            f"silenceremove="
            f"start_periods=1:"
            f"start_duration=0.05:"
            f"start_threshold={silence_threshold_db}dB:"
            f"detection=peak,"
            f"silenceremove="
            f"stop_periods=-1:"
            f"stop_duration={min_silence_duration}:"
            f"stop_threshold={silence_threshold_db}dB:"
            f"detection=peak"
        )

        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-i", str(audio_path),
            "-af", filter_complex,
            "-c:a", "libmp3lame",
            "-b:a", "192k",
            str(output_path)
        ]

        logger.info(f"Removing silence with FFmpeg: {audio_path.name}")

        result = safe_ffmpeg_run(cmd, 120, "silence remove ffmpeg")
        if result.returncode != 0:
            logger.error(f"FFmpeg silenceremove failed: {result.stderr}")
            # Fallback: copiem originalul
            import shutil
            shutil.copy(audio_path, output_path)
            return SilenceRemovalResult(
                output_path=output_path,
                original_duration=original_duration,
                new_duration=original_duration,
                removed_duration=0,
                segments_kept=1,
                segments_map=None
            )

        new_duration = self._get_audio_duration(output_path)
        removed_duration = original_duration - new_duration

        logger.info(f"FFmpeg silence removal: {original_duration:.1f}s -> {new_duration:.1f}s")

        return SilenceRemovalResult(
            output_path=output_path,
            original_duration=original_duration,
            new_duration=new_duration,
            removed_duration=removed_duration,
            segments_kept=1,  # FFmpeg doesn't give us the segment count
            segments_map=[(0.0, new_duration)]
        )

    def remove_silence(
        self,
        audio_path: Path,
        output_path: Path,
        use_vad: bool = True
    ) -> SilenceRemovalResult:
        """
        Main method: remove silence using the best available method.

        Args:
            audio_path: Path to original audio
            output_path: Path for output
            use_vad: If True, use VAD (more precise). If False, FFmpeg.

        Returns:
            SilenceRemovalResult with operation statistics
        """
        if use_vad and VAD_AVAILABLE:
            detector = self._get_detector()
            if detector is not None and detector.model is not None:
                try:
                    return self.remove_silence_vad(audio_path, output_path)
                except Exception as e:
                    logger.warning(f"VAD method failed, falling back to FFmpeg: {e}")

        # Fallback to FFmpeg
        try:
            return self.remove_silence_ffmpeg(
                audio_path,
                output_path,
                min_silence_duration=self.min_silence_duration
            )
        except (RuntimeError, Exception) as e:
            logger.error(f"FFmpeg silence removal failed: {e}")
            import shutil
            shutil.copy(audio_path, output_path)
            original_duration = self._get_audio_duration(audio_path)
            return SilenceRemovalResult(
                output_path=output_path,
                original_duration=original_duration,
                new_duration=original_duration,
                removed_duration=0,
                segments_kept=1,
                segments_map=None
            )


def remove_silence_from_tts(
    audio_path: Path,
    output_path: Optional[Path] = None,
    min_silence_duration: float = 0.3,
    padding: float = 0.08,
    target_pause_duration: Optional[float] = None
) -> SilenceRemovalResult:
    """
    Helper function: remove silence from a TTS file.

    Args:
        audio_path: Path to TTS audio
        output_path: Path for output (default: audio_path with _trimmed suffix)
        min_silence_duration: Shorter pauses are not removed (preserves rhythm)
        padding: How many seconds to keep around words
        target_pause_duration: If set, shorten long pauses to this duration instead of removing

    Returns:
        SilenceRemovalResult
    """
    audio_path = Path(audio_path)

    if output_path is None:
        output_path = audio_path.parent / f"{audio_path.stem}_trimmed{audio_path.suffix}"

    remover = SilenceRemover(
        min_silence_duration=min_silence_duration,
        padding=padding,
        target_pause_duration=target_pause_duration
    )

    return remover.remove_silence(audio_path, output_path)
