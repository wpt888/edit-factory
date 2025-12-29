"""
Silence Remover Service
Elimină pauzele lungi din audio (TTS) păstrând cuvintele intacte.
Folosește Silero VAD pentru detecție precisă a vorbirii.
"""
import logging
import subprocess
import tempfile
from pathlib import Path
from typing import List, Tuple, Optional
from dataclasses import dataclass

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
    """Rezultatul operației de silence removal."""
    output_path: Path
    original_duration: float
    new_duration: float
    removed_duration: float
    segments_kept: int

    @property
    def compression_ratio(self) -> float:
        """Cât de mult am comprimat audio-ul (0-1)."""
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
            "segments_kept": self.segments_kept
        }


class SilenceRemover:
    """
    Elimină pauzele din audio folosind VAD (Voice Activity Detection).

    Funcționează în 3 pași:
    1. Detectează segmentele cu voce (folosind Silero VAD)
    2. Adaugă padding mic (50-100ms) în jurul fiecărui segment pentru tranziții naturale
    3. Concatenează doar segmentele cu voce

    Parametri importanți:
    - min_silence_duration: Pauze mai scurte de atât NU sunt eliminate (păstrează ritmul natural)
    - padding: Câte secunde să păstreze înainte și după fiecare cuvânt
    """

    def __init__(
        self,
        min_silence_duration: float = 0.3,  # Pauze < 300ms rămân (ritm natural)
        padding: float = 0.08,  # 80ms padding pentru tranziții line
        speech_threshold: float = 0.5,  # Threshold pentru VAD
        min_speech_duration: float = 0.1  # Segmente mai scurte de 100ms sunt ignorate
    ):
        self.min_silence_duration = min_silence_duration
        self.padding = padding
        self.speech_threshold = speech_threshold
        self.min_speech_duration = min_speech_duration

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
        """Obține durata audio-ului în secunde."""
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path)
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return float(result.stdout.strip())
        except Exception as e:
            logger.warning(f"Could not get audio duration: {e}")
        return 0.0

    def _merge_close_segments(
        self,
        segments: List[VoiceSegment]
    ) -> List[Tuple[float, float]]:
        """
        Combină segmente apropiate și adaugă padding.
        Elimină doar pauzele mai lungi de min_silence_duration.
        """
        if not segments:
            return []

        # Sortăm după start time
        sorted_segs = sorted(segments, key=lambda s: s.start_time)

        merged = []
        current_start = max(0, sorted_segs[0].start_time - self.padding)
        current_end = sorted_segs[0].end_time + self.padding

        for seg in sorted_segs[1:]:
            seg_start = seg.start_time - self.padding
            seg_end = seg.end_time + self.padding

            # Calculăm gap-ul între segmente
            gap = seg_start - current_end

            if gap <= self.min_silence_duration:
                # Gap prea mic - extindem segmentul curent (păstrăm pauza naturală)
                current_end = seg_end
            else:
                # Gap suficient de mare - salvăm segmentul curent și începem unul nou
                merged.append((current_start, current_end))
                current_start = seg_start
                current_end = seg_end

        # Adăugăm ultimul segment
        merged.append((current_start, current_end))

        return merged

    def remove_silence_vad(
        self,
        audio_path: Path,
        output_path: Path
    ) -> SilenceRemovalResult:
        """
        Elimină silence folosind VAD (metoda precisă).
        """
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        original_duration = self._get_audio_duration(audio_path)

        # Detectăm voce
        detector = self._get_detector()
        if detector is None:
            raise RuntimeError("VoiceDetector not available")

        # Pentru audio, trebuie să-l convertim temporar la format video
        # sau să folosim direct detectarea pe audio
        # Silero VAD funcționează direct pe audio, nu necesită video

        logger.info(f"Detecting speech in: {audio_path.name}")

        # Detectăm voce direct din audio
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

        # Combinăm segmente apropiate
        merged_segments = self._merge_close_segments(voice_segments)

        logger.info(f"Found {len(voice_segments)} speech segments, merged to {len(merged_segments)}")

        # Extragem și concatenăm segmentele
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir = Path(temp_dir)
            segment_files = []

            for i, (start, end) in enumerate(merged_segments):
                # Asigurăm că nu depășim durata originală
                start = max(0, start)
                end = min(end, original_duration)

                if end <= start:
                    continue

                segment_file = temp_dir / f"segment_{i:03d}.wav"

                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(audio_path),
                    "-ss", str(start),
                    "-t", str(end - start),
                    "-c:a", "pcm_s16le",  # WAV pentru concatenare precisă
                    str(segment_file)
                ]

                result = subprocess.run(cmd, capture_output=True, text=True)
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

            # Creăm fișier de concat
            concat_file = temp_dir / "concat.txt"
            with open(concat_file, 'w', encoding='utf-8') as f:
                for seg_file in segment_files:
                    # Escape path
                    escaped = str(seg_file).replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")

            # Concatenăm și convertim la format final
            output_ext = output_path.suffix.lower()
            if output_ext == '.mp3':
                audio_codec = ["-c:a", "libmp3lame", "-b:a", "192k"]
            elif output_ext == '.aac':
                audio_codec = ["-c:a", "aac", "-b:a", "192k"]
            else:
                audio_codec = ["-c:a", "copy"]

            cmd = [
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0",
                "-i", str(concat_file),
                *audio_codec,
                str(output_path)
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
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
            segments_kept=len(merged_segments)
        )

    def _detect_voice_in_audio(
        self,
        audio_path: Path,
        detector: VoiceDetector
    ) -> List[VoiceSegment]:
        """
        Detectează voce direct în fișier audio (nu video).
        Silero VAD funcționează pe orice audio, nu doar din video.
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

            # Detectăm voce
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

            # Convertim la VoiceSegment
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
        Elimină silence folosind FFmpeg silenceremove (metoda simplă).
        Fallback dacă VAD nu e disponibil.

        Această metodă e mai puțin precisă dar funcționează fără PyTorch.
        """
        audio_path = Path(audio_path)
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        original_duration = self._get_audio_duration(audio_path)

        # FFmpeg silenceremove filter
        # Elimină silence de la început și sfârșit, și comprimă pauzele interioare
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
            "ffmpeg", "-y",
            "-i", str(audio_path),
            "-af", filter_complex,
            "-c:a", "libmp3lame",
            "-b:a", "192k",
            str(output_path)
        ]

        logger.info(f"Removing silence with FFmpeg: {audio_path.name}")

        result = subprocess.run(cmd, capture_output=True, text=True)
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
                segments_kept=1
            )

        new_duration = self._get_audio_duration(output_path)
        removed_duration = original_duration - new_duration

        logger.info(f"FFmpeg silence removal: {original_duration:.1f}s -> {new_duration:.1f}s")

        return SilenceRemovalResult(
            output_path=output_path,
            original_duration=original_duration,
            new_duration=new_duration,
            removed_duration=removed_duration,
            segments_kept=1  # FFmpeg nu ne dă numărul de segmente
        )

    def remove_silence(
        self,
        audio_path: Path,
        output_path: Path,
        use_vad: bool = True
    ) -> SilenceRemovalResult:
        """
        Metodă principală: elimină silence folosind cea mai bună metodă disponibilă.

        Args:
            audio_path: Calea către audio original
            output_path: Calea pentru output
            use_vad: Dacă True, folosește VAD (mai precis). Dacă False, FFmpeg.

        Returns:
            SilenceRemovalResult cu statistici despre operație
        """
        if use_vad and VAD_AVAILABLE:
            detector = self._get_detector()
            if detector is not None and detector.model is not None:
                try:
                    return self.remove_silence_vad(audio_path, output_path)
                except Exception as e:
                    logger.warning(f"VAD method failed, falling back to FFmpeg: {e}")

        # Fallback to FFmpeg
        return self.remove_silence_ffmpeg(
            audio_path,
            output_path,
            min_silence_duration=self.min_silence_duration
        )


def remove_silence_from_tts(
    audio_path: Path,
    output_path: Optional[Path] = None,
    min_silence_duration: float = 0.3,
    padding: float = 0.08
) -> SilenceRemovalResult:
    """
    Funcție helper: elimină silence dintr-un fișier TTS.

    Args:
        audio_path: Calea către audio TTS
        output_path: Calea pentru output (default: audio_path cu suffix _trimmed)
        min_silence_duration: Pauze mai scurte nu sunt eliminate (păstrează ritmul)
        padding: Câte secunde să păstreze în jurul cuvintelor

    Returns:
        SilenceRemovalResult
    """
    audio_path = Path(audio_path)

    if output_path is None:
        output_path = audio_path.parent / f"{audio_path.stem}_trimmed{audio_path.suffix}"

    remover = SilenceRemover(
        min_silence_duration=min_silence_duration,
        padding=padding
    )

    return remover.remove_silence(audio_path, output_path)
