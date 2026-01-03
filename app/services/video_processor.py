"""
Edit Factory - Video Processor Service v2.2
Procesor video avansat cu AI (Gemini) pentru selecție inteligentă de segmente.
"""
import json
import logging
import subprocess
import shutil
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
import cv2
import numpy as np
from scipy.fftpack import dct

# IMPORTANT: Încărcăm .env ÎNAINTE de a verifica GEMINI_API_KEY
from dotenv import load_dotenv
load_dotenv()

# Import GeminiAnalyzer (optional - funcționează și fără dacă nu ai API key)
try:
    from .gemini_analyzer import GeminiVideoAnalyzer, AnalyzedSegment
    _gemini_key = os.getenv("GEMINI_API_KEY", "")
    GEMINI_AVAILABLE = bool(_gemini_key and len(_gemini_key) > 10)
    if GEMINI_AVAILABLE:
        logging.getLogger(__name__).info("Gemini AI available for intelligent frame selection")
except ImportError:
    GEMINI_AVAILABLE = False
    GeminiVideoAnalyzer = None
    AnalyzedSegment = None

logger = logging.getLogger(__name__)


def compute_phash(frame, hash_size=8):
    """Calculeaza perceptual hash pentru un frame."""
    resized = cv2.resize(frame, (32, 32))
    if len(resized.shape) == 3:
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    else:
        gray = resized
    dct_result = dct(dct(gray.astype(float), axis=0), axis=1)
    dct_low = dct_result[:hash_size, :hash_size]
    median = np.median(dct_low.flatten()[1:])
    return (dct_low > median).flatten()


def hamming_distance(hash1, hash2):
    """Calculeaza distanta Hamming intre doua hash-uri."""
    return np.sum(hash1 != hash2)


@dataclass
class VideoSegment:
    """Segment de video cu metrici de calitate."""
    start_time: float
    end_time: float
    motion_score: float       # Cat de multa miscare e in segment (0-1)
    variance_score: float     # Cat de variate sunt frame-urile (0-1)
    avg_brightness: float     # Luminozitate medie (0-1)
    visual_hashes: List[np.ndarray] = None

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    @property
    def combined_score(self) -> float:
        """Scor combinat - prioritizeaza miscarea si variatia."""
        # Motion e cel mai important (evita zonele moarte)
        # Variance asigura ca nu e acelasi lucru repetat
        return (
            self.motion_score * 0.6 +
            self.variance_score * 0.3 +
            (1 - abs(self.avg_brightness - 0.5)) * 0.1
        )

    def is_visually_similar(self, other: 'VideoSegment', threshold: int = 12) -> bool:
        """Verifica similaritatea vizuala cu alt segment."""
        if not self.visual_hashes or not other.visual_hashes:
            return False

        similar_count = 0
        total_comparisons = 0

        for h1 in self.visual_hashes:
            for h2 in other.visual_hashes:
                if h1 is not None and h2 is not None:
                    if hamming_distance(h1, h2) < threshold:
                        similar_count += 1
                    total_comparisons += 1

        return total_comparisons > 0 and (similar_count / total_comparisons) > 0.5

    def to_dict(self) -> dict:
        return {
            "start": self.start_time,
            "end": self.end_time,
            "duration": self.duration,
            "motion_score": round(self.motion_score, 4),
            "variance_score": round(self.variance_score, 4),
            "combined_score": round(self.combined_score, 4)
        }


class VideoAnalyzer:
    """
    Analizator video avansat - scaneaza INTREG videoclipul.
    Foloseste o abordare grid-based pentru a analiza uniform.
    """

    def __init__(self, video_path: Path):
        self.video_path = Path(video_path)
        if not self.video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        self.cap = cv2.VideoCapture(str(self.video_path))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.frame_count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.duration = self.frame_count / self.fps if self.fps > 0 else 0
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Detectam rotatia video-ului (important pentru telefoane!)
        self.rotation = self._detect_rotation()
        if self.rotation in [90, 270]:
            self.width, self.height = self.height, self.width
            logger.info(f"Video rotated {self.rotation}°, swapped dimensions")

        logger.info(f"Video loaded: {self.video_path.name}")
        logger.info(f"  Duration: {self.duration:.2f}s ({self.duration/60:.1f} min), FPS: {self.fps:.2f}")
        logger.info(f"  Resolution: {self.width}x{self.height}, Frames: {self.frame_count}")

    def _detect_rotation(self) -> int:
        """Detecteaza rotatia video-ului din metadate folosind ffprobe."""
        try:
            probe_cmd = [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream_side_data=rotation:stream_tags=rotate",
                "-of", "json",
                str(self.video_path)
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                return 0

            data = json.loads(result.stdout)
            stream = data.get("streams", [{}])[0]

            # Check side_data_list
            side_data_list = stream.get("side_data_list", [])
            for side_data in side_data_list:
                if "rotation" in side_data:
                    return abs(int(side_data.get("rotation", 0)))

            # Check tags
            tags = stream.get("tags", {})
            return abs(int(tags.get("rotate", 0)))

        except Exception as e:
            logger.warning(f"Could not detect rotation: {e}")
            return 0

    def _read_frame_at(self, frame_idx: int) -> Optional[np.ndarray]:
        """Citeste un frame specific."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = self.cap.read()
        return frame if ret else None

    def _calculate_motion_for_interval(
        self,
        start_frame: int,
        end_frame: int,
        sample_count: int = 15  # Optimized: 15 samples sufficient for motion detection (was 30)
    ) -> Tuple[float, float]:
        """
        Calculeaza scorul de miscare pentru un interval, sampling uniform.
        Returneaza (motion_score, variance_score).
        """
        if end_frame <= start_frame:
            return 0.0, 0.0

        # Sample frames uniform pe interval
        frame_indices = np.linspace(start_frame, end_frame - 1, min(sample_count, end_frame - start_frame), dtype=int)

        motion_scores = []
        frames_gray = []
        prev_gray = None

        for idx in frame_indices:
            frame = self._read_frame_at(idx)
            if frame is None:
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (21, 21), 0)
            frames_gray.append(gray)

            if prev_gray is not None:
                # Calculam diferenta intre frame-uri consecutive
                diff = cv2.absdiff(prev_gray, gray)
                motion = np.mean(diff) / 255.0
                motion_scores.append(motion)

            prev_gray = gray

        # Motion score mediu
        motion_score = np.mean(motion_scores) if motion_scores else 0.0

        # Variance score - cat de diferite sunt frame-urile intre ele
        variance_score = 0.0
        if len(frames_gray) >= 3:
            # Comparam primul frame cu ultimul si cu cel din mijloc
            first = frames_gray[0]
            mid = frames_gray[len(frames_gray) // 2]
            last = frames_gray[-1]

            diff1 = np.mean(cv2.absdiff(first, mid)) / 255.0
            diff2 = np.mean(cv2.absdiff(mid, last)) / 255.0
            diff3 = np.mean(cv2.absdiff(first, last)) / 255.0

            variance_score = (diff1 + diff2 + diff3) / 3.0

        return motion_score, variance_score

    def analyze_full_video(
        self,
        segment_duration: float = 3.0,
        overlap: float = 0.5,
        min_motion_threshold: float = 0.008,  # Threshold pentru "dead zone"
        progress_callback: Optional[callable] = None
    ) -> List[VideoSegment]:
        """
        Analizeaza INTREG videoclipul folosind sliding window.

        Args:
            segment_duration: Durata fiecarui segment analizat (secunde)
            overlap: Cat de mult se suprapun segmentele (0-1)
            min_motion_threshold: Scor minim de miscare pentru a nu fi "dead zone"
            progress_callback: Functie de progres

        Returns:
            Lista de segmente sortate dupa scor
        """
        segments = []
        step = segment_duration * (1 - overlap)

        current_time = 0.0
        total_segments = int((self.duration - segment_duration) / step) + 1
        analyzed_count = 0

        logger.info(f"Analyzing full video: {total_segments} potential segments ({segment_duration}s each, {overlap*100}% overlap)")

        while current_time + segment_duration <= self.duration:
            start_time = current_time
            end_time = current_time + segment_duration

            start_frame = int(start_time * self.fps)
            end_frame = int(end_time * self.fps)

            # Calculam scorurile
            motion_score, variance_score = self._calculate_motion_for_interval(start_frame, end_frame)

            # Calculam hash-uri pentru mid-point (optimized: was 3 positions [0.1, 0.5, 0.9])
            # Single mid-point is sufficient for duplicate detection while reducing CPU usage by 66%
            visual_hashes = []
            brightness_samples = []

            for pos in [0.5]:  # Optimized: only mid-point needed for duplicate detection
                frame_idx = start_frame + int((end_frame - start_frame) * pos)
                frame = self._read_frame_at(frame_idx)
                if frame is not None:
                    visual_hashes.append(compute_phash(frame))
                    brightness_samples.append(np.mean(frame) / 255.0)

            avg_brightness = np.mean(brightness_samples) if brightness_samples else 0.5
            min_brightness = min(brightness_samples) if brightness_samples else 0.5

            # FILTRAM: dead zones (mișcare mică) și black frames (luminozitate mică)
            # Brightness < 0.05 = aproape negru (12.75/255)
            # Brightness < 0.10 = foarte întunecat
            MIN_BRIGHTNESS_THRESHOLD = 0.08  # ~20/255

            is_too_dark = min_brightness < MIN_BRIGHTNESS_THRESHOLD
            is_too_static = motion_score < min_motion_threshold

            if is_too_dark:
                logger.debug(f"Skipped BLACK FRAME: {start_time:.1f}s - {end_time:.1f}s (brightness: {min_brightness:.3f})")
            elif is_too_static:
                logger.debug(f"Skipped dead zone: {start_time:.1f}s - {end_time:.1f}s (motion: {motion_score:.4f})")
            else:
                segment = VideoSegment(
                    start_time=start_time,
                    end_time=end_time,
                    motion_score=motion_score,
                    variance_score=variance_score,
                    avg_brightness=avg_brightness,
                    visual_hashes=visual_hashes if visual_hashes else None
                )
                segments.append(segment)

            current_time += step
            analyzed_count += 1

            if progress_callback and analyzed_count % 10 == 0:
                progress = int((analyzed_count / total_segments) * 100)
                progress_callback("Analyzing video", f"{progress}% complete")

        # Sortam dupa scor combinat
        segments.sort(key=lambda s: s.combined_score, reverse=True)

        logger.info(f"Analysis complete: {len(segments)} valid segments (filtered {total_segments - len(segments)} dead zones)")
        return segments

    def select_best_segments(
        self,
        target_duration: float,
        min_segment: float = 1.5,
        max_segment: float = 3.0,  # Max 3 secunde pentru dinamism
        similarity_threshold: int = 12,
        min_motion: float = 0.008,
        progress_callback: Optional[callable] = None
    ) -> List[VideoSegment]:
        """
        Selecteaza cele mai bune segmente pentru durata tinta.
        Segmentele sunt scurte (max 3s) pentru un clip dinamic.
        """
        # Segmente scurte pentru dinamism - max 3 secunde
        segment_duration = min(max_segment, max(min_segment, target_duration / 8))

        all_segments = self.analyze_full_video(
            segment_duration=segment_duration,
            overlap=0.3,
            min_motion_threshold=min_motion,
            progress_callback=progress_callback
        )

        selected = []
        total_duration = 0.0
        skipped_duplicates = 0
        skipped_overlap = 0

        for segment in all_segments:
            if total_duration >= target_duration:
                break

            # Verificam overlap temporal
            has_overlap = False
            for sel in selected:
                if not (segment.end_time <= sel.start_time or segment.start_time >= sel.end_time):
                    has_overlap = True
                    break

            if has_overlap:
                skipped_overlap += 1
                continue

            # Verificam similaritate vizuala
            is_duplicate = False
            for sel in selected:
                if segment.is_visually_similar(sel, threshold=similarity_threshold):
                    is_duplicate = True
                    skipped_duplicates += 1
                    break

            if not is_duplicate:
                selected.append(segment)
                total_duration += segment.duration

        # Sortam cronologic
        selected.sort(key=lambda s: s.start_time)

        logger.info(f"Selected {len(selected)} segments, duration: {total_duration:.1f}s")
        logger.info(f"  Skipped: {skipped_duplicates} duplicates, {skipped_overlap} overlaps")

        return selected

    def get_video_info(self) -> dict:
        """Returneaza informatii despre video."""
        return {
            "filename": self.video_path.name,
            "duration": self.duration,
            "fps": self.fps,
            "width": self.width,
            "height": self.height,
            "frame_count": self.frame_count,
            "rotation": getattr(self, 'rotation', 0)  # Rotația pentru corecție output
        }

    def close(self):
        """Elibereaza resursele."""
        self.cap.release()


class VideoEditor:
    """Editor video cu GPU acceleration si cleanup automat."""

    def __init__(self, output_dir: Path, temp_dir: Path, use_gpu: bool = True):
        self.output_dir = Path(output_dir)
        self.temp_dir = Path(temp_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        self.use_gpu = use_gpu and self._check_nvenc_available()
        if self.use_gpu:
            logger.info("GPU encoding enabled (NVIDIA NVENC)")
            self.video_codec = "h264_nvenc"
            self.video_preset = "p4"
            self.video_quality = "23"
        else:
            logger.info("Using CPU encoding (libx264)")
            self.video_codec = "libx264"
            self.video_preset = "fast"
            self.video_quality = "23"

        # Track intermediate files for cleanup
        self._intermediate_files: List[Path] = []

        # Voice detector (lazy loading)
        self._voice_detector = None

    def _get_voice_detector(self):
        """Lazy load voice detector."""
        if self._voice_detector is None:
            try:
                from .voice_detector import VoiceDetector
                self._voice_detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)
            except Exception as e:
                logger.warning(f"Could not initialize voice detector: {e}")
                self._voice_detector = False  # Mark as unavailable
        return self._voice_detector if self._voice_detector else None

    def mute_voice_in_video(
        self,
        video_path: Path,
        output_name: str,
        keep_percentage: float = 0.0,
        fade_duration: float = 0.05
    ) -> Tuple[Path, List[dict]]:
        """
        Detectează și mută segmentele cu voce din video.

        Args:
            video_path: Calea către video
            output_name: Numele pentru output
            keep_percentage: Cât din volum să păstreze (0 = mute complet, 0.1 = 10%)
            fade_duration: Durata fade pentru tranziții line

        Returns:
            Tuple (output_path, voice_segments_info)
        """
        from .voice_detector import VoiceDetector, mute_voice_segments

        video_path = Path(video_path)
        output_path = self.output_dir / f"{output_name}_voice_muted.mp4"

        # Detectăm voce
        detector = self._get_voice_detector()
        if detector is None:
            logger.warning("Voice detector not available, copying original")
            shutil.copy(video_path, output_path)
            return output_path, []

        logger.info(f"Detecting voice in: {video_path.name}")
        voice_segments = detector.detect_voice(video_path)

        if not voice_segments:
            logger.info("No voice detected, keeping original audio")
            shutil.copy(video_path, output_path)
            return output_path, []

        # Aplicăm mute
        logger.info(f"Muting {len(voice_segments)} voice segments")
        success = mute_voice_segments(
            video_path=video_path,
            output_path=output_path,
            voice_segments=voice_segments,
            fade_duration=fade_duration,
            keep_percentage=keep_percentage
        )

        if not success:
            logger.error("Voice muting failed, using original")
            shutil.copy(video_path, output_path)
            return output_path, []

        # Track for cleanup
        self._track_intermediate(output_path)

        # Return info about what was muted
        segments_info = [seg.to_dict() for seg in voice_segments]
        logger.info(f"Voice muting completed: {output_path.name}")

        return output_path, segments_info

    def _check_nvenc_available(self) -> bool:
        """Verifica disponibilitatea NVENC."""
        try:
            result = subprocess.run(["ffmpeg", "-encoders"], capture_output=True, text=True)
            return "h264_nvenc" in result.stdout
        except Exception:
            return False

    def _run_ffmpeg(self, cmd: list, operation: str) -> subprocess.CompletedProcess:
        """
        Executa comanda FFmpeg cu logging detaliat pentru erori.

        Args:
            cmd: Lista de argumente pentru FFmpeg
            operation: Descrierea operatiei (pentru logging)

        Returns:
            CompletedProcess result

        Raises:
            RuntimeError: Daca FFmpeg esueaza
        """
        logger.debug(f"FFmpeg command ({operation}): {' '.join(cmd)}")

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            # Parse FFmpeg stderr for useful info
            stderr = result.stderr
            error_lines = [line for line in stderr.split('\n') if 'error' in line.lower() or 'Error' in line]

            # Log detailed error
            logger.error(f"FFmpeg {operation} failed (exit code {result.returncode})")
            logger.error(f"Command: {' '.join(cmd[:6])}...")  # First 6 args

            if error_lines:
                logger.error(f"Error details: {'; '.join(error_lines[:3])}")
            else:
                # Log last 5 lines of stderr
                last_lines = [l for l in stderr.split('\n') if l.strip()][-5:]
                logger.error(f"FFmpeg output: {'; '.join(last_lines)}")

            raise RuntimeError(f"FFmpeg {operation} failed: {error_lines[0] if error_lines else stderr[-500:]}")

        return result

    def _track_intermediate(self, path: Path):
        """Adauga fisier la lista pentru cleanup."""
        self._intermediate_files.append(path)

    def cleanup_intermediates(self):
        """Sterge toate fisierele intermediare."""
        for f in self._intermediate_files:
            try:
                if f.exists():
                    f.unlink()
                    logger.info(f"Cleaned up: {f.name}")
            except Exception as e:
                logger.warning(f"Failed to cleanup {f}: {e}")
        self._intermediate_files.clear()

    def _get_overlapping_voice_mutes(
        self,
        segment_start: float,
        segment_end: float,
        voice_segments: List
    ) -> List[Tuple[float, float]]:
        """
        Calculează porțiunile de voce care se suprapun cu un segment video.

        Args:
            segment_start: Timpul de start al segmentului video (în video original)
            segment_end: Timpul de end al segmentului video (în video original)
            voice_segments: Lista de VoiceSegment detectate

        Returns:
            Lista de tuple (start_relativ, end_relativ) - timpuri RELATIVE la segmentul extras
            Exemplu: segment video 10-15s, voce la 11-13s → returnează [(1.0, 3.0)]
        """
        overlapping = []

        for vs in voice_segments:
            # Verificăm suprapunerea
            voice_start = vs.start_time if hasattr(vs, 'start_time') else vs['start']
            voice_end = vs.end_time if hasattr(vs, 'end_time') else vs['end']

            # Calculăm intersecția
            overlap_start = max(segment_start, voice_start)
            overlap_end = min(segment_end, voice_end)

            if overlap_start < overlap_end:
                # Există suprapunere - convertim la timp relativ
                relative_start = overlap_start - segment_start
                relative_end = overlap_end - segment_start
                overlapping.append((relative_start, relative_end))

        return overlapping

    def _build_mute_filter(self, mute_intervals: List[Tuple[float, float]]) -> str:
        """
        Construiește filtrul FFmpeg pentru mute selectiv.

        Args:
            mute_intervals: Lista de (start, end) în secunde, relative la segment

        Returns:
            String cu filtrul audio pentru FFmpeg
            Exemplu: "volume=0:enable='between(t,1.0,3.0)+between(t,5.0,7.0)'"
        """
        if not mute_intervals:
            return None

        # Construim condițiile combinate cu + (OR în FFmpeg expressions)
        conditions = []
        for start, end in mute_intervals:
            conditions.append(f"between(t,{start:.3f},{end:.3f})")

        # Un singur filtru volume cu toate condițiile combinate
        # Sintaxa corectă: volume=LEVEL:enable='CONDITION'
        # NOTĂ: FFmpeg NECESITĂ ghilimele în jurul expresiei enable!
        # subprocess.run cu listă de argumente pasează string-ul direct, fără shell interpretation
        combined_condition = "+".join(conditions)
        return f"volume=0:enable='{combined_condition}'"

    def extract_segments(
        self,
        video_path: Path,
        segments: List[VideoSegment],
        output_name: str,
        voice_segments: Optional[List] = None,
        source_rotation: int = 0
    ) -> Path:
        """
        Extrage si concateneaza segmentele selectate.

        Args:
            video_path: Calea către video
            segments: Segmentele video de extras
            output_name: Numele output
            voice_segments: Lista de VoiceSegment pentru mute selectiv (opțional)
                           Dacă e furnizată, vocile sunt mutate doar în porțiunile care se suprapun
            source_rotation: Rotația video sursă (0, 90, 180, 270) pentru a aplica corecție
        """
        video_path = Path(video_path)
        segment_files = []

        # Construim filtrul video pentru rotație (pentru format vertical/reels)
        # FFmpeg transpose values: 1=90°CW, 2=90°CCW, 3=90°CW+vflip
        video_filter = None
        if source_rotation == 90:
            video_filter = "transpose=1"  # 90° clockwise
        elif source_rotation == 270:
            video_filter = "transpose=2"  # 90° counter-clockwise
        elif source_rotation == 180:
            video_filter = "hflip,vflip"  # 180° rotation

        for i, seg in enumerate(segments):
            temp_file = self.temp_dir / f"segment_{output_name}_{i:03d}.mp4"

            # Verificăm dacă acest segment are voce care trebuie mutată
            audio_filter = None
            if voice_segments:
                # Găsim vocile care se suprapun cu acest segment
                overlapping_mutes = self._get_overlapping_voice_mutes(
                    seg.start_time, seg.end_time, voice_segments
                )
                if overlapping_mutes:
                    # Construim filtrul de volum pentru mute selectiv
                    audio_filter = self._build_mute_filter(overlapping_mutes)
                    logger.info(f"Segment {i+1}: Muting {len(overlapping_mutes)} voice portions")

            # Funcție helper pentru a construi comanda
            def build_cmd(use_gpu_encoding: bool):
                if use_gpu_encoding:
                    cmd = [
                        "ffmpeg", "-y",
                        "-hwaccel", "cuda",
                        "-hwaccel_output_format", "cuda",
                        "-i", str(video_path),
                        "-ss", str(seg.start_time),
                        "-t", str(seg.duration),
                    ]
                    # Pentru GPU: trebuie să descărcăm din CUDA înainte de filtru video
                    if video_filter:
                        cmd.extend(["-vf", f"hwdownload,format=nv12,{video_filter},hwupload_cuda"])
                    if audio_filter:
                        cmd.extend(["-af", audio_filter])
                    cmd.extend([
                        "-c:v", self.video_codec,
                        "-preset", self.video_preset,
                        "-cq", self.video_quality,
                        # Keyframe interval (2 sec at 30fps)
                        "-g", "60",
                        "-bf", "2",
                        # Audio
                        "-c:a", "aac", "-b:a", "128k",
                        "-ar", "48000", "-ac", "2",
                        # Pixel format
                        "-pix_fmt", "yuv420p",
                        str(temp_file)
                    ])
                else:
                    cmd = [
                        "ffmpeg", "-y",
                        "-i", str(video_path),
                        "-ss", str(seg.start_time),
                        "-t", str(seg.duration),
                    ]
                    if video_filter:
                        cmd.extend(["-vf", video_filter])
                    if audio_filter:
                        cmd.extend(["-af", audio_filter])
                    cmd.extend([
                        "-c:v", "libx264",  # CPU codec
                        "-profile:v", "high",
                        "-level:v", "4.0",
                        "-preset", "fast",
                        "-crf", "23",
                        # Keyframe interval (2 sec at 30fps) - prevents platform recompression
                        "-g", "60",
                        "-keyint_min", "60",
                        "-sc_threshold", "0",
                        "-bf", "2",
                        # Audio
                        "-c:a", "aac", "-b:a", "128k",
                        "-ar", "48000", "-ac", "2",
                        # Pixel format
                        "-pix_fmt", "yuv420p",
                        "-sar", "1:1",
                        str(temp_file)
                    ])
                return cmd

            # Încearcă GPU, fallback pe CPU dacă eșuează
            try:
                cmd = build_cmd(self.use_gpu)
                self._run_ffmpeg(cmd, f"extract segment {i+1}/{len(segments)}")
            except RuntimeError as e:
                error_lower = str(e).lower()
                # Fallback pe CPU pentru erori NVENC sau filtergraph (combinația GPU + audio filter poate cauza probleme)
                if self.use_gpu and ("nvenc" in error_lower or "filtergraph" in error_lower or "filter not found" in error_lower):
                    logger.warning(f"GPU encoding failed for segment {i+1}, falling back to CPU: {str(e)[:100]}")
                    cmd = build_cmd(False)
                    self._run_ffmpeg(cmd, f"extract segment {i+1}/{len(segments)} (CPU fallback)")
                else:
                    raise

            segment_files.append(temp_file)
            has_mute = " (voice muted)" if audio_filter else ""
            logger.info(f"Extracted segment {i+1}/{len(segments)}: {seg.start_time:.1f}s-{seg.end_time:.1f}s{has_mute}")

        # Concatenare
        concat_file = self.temp_dir / f"concat_{output_name}.txt"
        with open(concat_file, 'w') as f:
            for seg_file in segment_files:
                f.write(f"file '{seg_file}'\n")

        output_video = self.output_dir / f"{output_name}_segments.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output_video)
        ]

        self._run_ffmpeg(cmd, "concatenate segments")

        # Cleanup segment files
        for f in segment_files:
            f.unlink(missing_ok=True)
        concat_file.unlink(missing_ok=True)

        # NOTE: Don't track as intermediate - this may be the final output
        # The caller should track it if needed for further processing

        logger.info(f"Created segments video: {output_video}")
        return output_video

    def add_audio(self, video_path: Path, audio_path: Path, output_name: str) -> Path:
        """Adauga audio la video."""
        output_video = self.output_dir / f"{output_name}_with_audio.mp4"

        # Obtinem durata audio
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(audio_path)
        ]
        result = subprocess.run(probe_cmd, capture_output=True, text=True)
        audio_duration = float(json.loads(result.stdout)['format']['duration'])

        if self.use_gpu:
            cmd = [
                "ffmpeg", "-y",
                "-hwaccel", "cuda",
                "-i", str(video_path),
                "-i", str(audio_path),
                "-t", str(audio_duration),
                "-map", "0:v", "-map", "1:a",
                "-c:v", self.video_codec,
                "-preset", self.video_preset,
                "-cq", self.video_quality,
                "-c:a", "aac",
                str(output_video)
            ]
        else:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-i", str(audio_path),
                "-t", str(audio_duration),
                "-map", "0:v", "-map", "1:a",
                "-c:v", self.video_codec,
                "-preset", self.video_preset,
                "-c:a", "aac",
                str(output_video)
            ]

        self._run_ffmpeg(cmd, "add audio")

        # Track for cleanup
        self._track_intermediate(output_video)

        logger.info(f"Added audio: {output_video}")
        return output_video

    def add_subtitles(
        self,
        video_path: Path,
        srt_path: Path,
        output_name: str,
        subtitle_settings: Optional[dict] = None,
        video_width: int = 1080,
        video_height: int = 1920
    ) -> Path:
        """
        Adauga subtitrari cu font size SCALAT corect pentru rezolutia video.
        """
        output_video = self.output_dir / f"{output_name}_final.mp4"

        # Default settings
        settings = {
            "fontSize": 24,
            "fontFamily": "Arial",
            "textColor": "#FFFFFF",
            "outlineColor": "#000000",
            "outlineWidth": 2,
            "position": "bottom",
            "marginV": 50,
            "positionY": 85
        }
        if subtitle_settings:
            settings.update(subtitle_settings)

        # FONT SIZE - NU MAI SCALAM!
        # Cu PlayResX/PlayResY setate la rezolutia video-ului, fontul este interpretat
        # direct in pixeli la rezolutia respectiva.
        # Frontend preview calculeaza: (fontSize / videoHeight) * 600px
        # Deci fontSize=48 in video 1920px = 48/1920 = 2.5% din inaltime
        # In preview 600px: (48/1920)*600 = 15px = 2.5% din 600px ✓
        # Folosim direct valoarea din frontend fara scalare!
        font_size = int(settings["fontSize"])
        # Limitam intre 16 si 200 pentru siguranta
        font_size = max(16, min(200, font_size))

        # Outline width - folosim direct, fara scalare
        outline_width = max(1, int(settings["outlineWidth"]))
        outline_width = min(outline_width, 10)  # Max 10px

        # MarginV scalat bazat pe positionY
        # positionY: 0=sus, 100=jos
        # IMPORTANT: Folosim PlayResX/PlayResY pentru videouri portrait
        position_y = settings.get("positionY", 85)

        # Alignment: 2 = bottom-center (standard pentru subtitrari)
        # Pentru pozitii foarte sus folosim alignment=8 (top-center)
        if position_y <= 20:
            alignment = 8  # top-center
            # MarginV = distanta de la marginea de sus
            margin_v = int(position_y / 100 * video_height)
        else:
            alignment = 2  # bottom-center
            # MarginV = distanta de la marginea de jos
            # position_y=85 -> marginV = 15% din inaltime
            margin_v = int((100 - position_y) / 100 * video_height)

        # Asiguram un minim pentru margin
        margin_v = max(50, margin_v)

        logger.info(f"Subtitle: fontSize={font_size}px, outline={outline_width}px (video: {video_width}x{video_height})")
        logger.info(f"Position Y: {position_y}% -> Alignment: {alignment}, MarginV: {margin_v}px")

        # Convertim culorile
        def hex_to_ass(hex_color):
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            return f"&H00{b:02X}{g:02X}{r:02X}"

        primary_color = hex_to_ass(settings["textColor"])
        outline_color = hex_to_ass(settings["outlineColor"])

        # Extragem font family name (fara CSS variables)
        font_family = settings['fontFamily']
        # Remove CSS variable prefix if present
        if 'var(--' in font_family:
            # Extract actual font name: "var(--font-montserrat), Montserrat, sans-serif" -> "Montserrat"
            parts = font_family.split(',')
            for part in parts:
                part = part.strip()
                if not part.startswith('var(') and part not in ['sans-serif', 'serif', 'monospace']:
                    font_family = part.strip("'\"")
                    break

        # PlayResX/PlayResY sunt esentiale pentru pozitionarea corecta pe videouri portrait
        # Fara ele, ASS/libass presupune o rezolutie 4:3 si calculeaza gresit pozitia
        subtitle_style = (
            f"PlayResX={video_width},"
            f"PlayResY={video_height},"
            f"FontName={font_family},"
            f"FontSize={font_size},"
            f"PrimaryColour={primary_color},"
            f"OutlineColour={outline_color},"
            f"Outline={outline_width},"
            f"Shadow=1,"
            f"Alignment={alignment},"
            f"MarginV={margin_v},"
            f"Bold=1"
        )

        # Escaping corect pentru ffmpeg subtitles filter pe Windows
        # 1. Convertim backslash la forward slash
        # 2. Escape-uim : cu \:
        # 3. Escape-uim ' cu '\'' (inchidem quote, adaugam escaped quote, redeschidem)
        # 4. Escape-uim [ si ] care sunt speciale in ffmpeg filters
        srt_path_escaped = str(srt_path)
        srt_path_escaped = srt_path_escaped.replace('\\', '/')
        srt_path_escaped = srt_path_escaped.replace("'", "'\\''")
        srt_path_escaped = srt_path_escaped.replace(':', '\\:')
        srt_path_escaped = srt_path_escaped.replace('[', '\\[')
        srt_path_escaped = srt_path_escaped.replace(']', '\\]')

        # IMPORTANT: Pentru subtitles filter, NU putem folosi hwaccel cu filtru pe CPU
        # Subtitles filter ruleaza pe CPU, deci trebuie sa decodam pe CPU si sa encodam cu GPU
        # NU folosim -hwaccel cuda aici pentru ca filtrul subtitles nu suporta GPU
        if self.use_gpu:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-vf", f"subtitles='{srt_path_escaped}':force_style='{subtitle_style}'",
                "-c:v", self.video_codec,
                "-preset", self.video_preset,
                "-cq", self.video_quality,
                "-c:a", "copy",
                str(output_video)
            ]
        else:
            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-vf", f"subtitles='{srt_path_escaped}':force_style='{subtitle_style}'",
                "-c:v", self.video_codec,
                "-preset", self.video_preset,
                "-crf", self.video_quality,
                "-c:a", "copy",
                str(output_video)
            ]

        logger.info(f"Running subtitle command: {' '.join(cmd)}")
        self._run_ffmpeg(cmd, "add subtitles")

        logger.info(f"Added subtitles: {output_video}")
        return output_video

    def _concat_segments(self, segment_files: List[Path], output_name: str) -> Path:
        """
        Concatenează o listă de fișiere video într-un singur video.

        Args:
            segment_files: Lista de fișiere video de concatenat
            output_name: Numele pentru fișierul output

        Returns:
            Calea către video-ul concatenat
        """
        if not segment_files:
            raise ValueError("No segment files to concatenate")

        # Creăm fișierul de concat
        concat_file = self.temp_dir / f"concat_{output_name}.txt"
        with open(concat_file, 'w', encoding='utf-8') as f:
            for seg_file in segment_files:
                # Escape path pentru ffmpeg concat
                escaped_path = str(seg_file).replace("'", "'\\''")
                f.write(f"file '{escaped_path}'\n")

        output_video = self.output_dir / f"{output_name}_segments.mp4"

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output_video)
        ]

        self._run_ffmpeg(cmd, f"concatenate {len(segment_files)} segments")

        # Cleanup concat file
        concat_file.unlink(missing_ok=True)

        # Track for later cleanup
        self._track_intermediate(output_video)

        logger.info(f"Concatenated {len(segment_files)} segments into: {output_video}")
        return output_video

    def cleanup_temp(self, pattern: str = "*"):
        """Curata fisierele temporare."""
        for f in self.temp_dir.glob(pattern):
            f.unlink(missing_ok=True)


class VideoProcessorService:
    """Serviciul principal de procesare video."""

    def __init__(self, input_dir: Path, output_dir: Path, temp_dir: Path):
        self.input_dir = Path(input_dir)
        self.output_dir = Path(output_dir)
        self.temp_dir = Path(temp_dir)

        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        self.editor = VideoEditor(output_dir, temp_dir)

    def analyze_video(self, video_path: Path, target_duration: float = 20.0) -> dict:
        """Analizeaza un video si returneaza segmentele recomandate."""
        analyzer = VideoAnalyzer(video_path)
        try:
            video_info = analyzer.get_video_info()
            segments = analyzer.select_best_segments(target_duration)
            return {
                "status": "success",
                "video_info": video_info,
                "segments": [s.to_dict() for s in segments],
                "total_selected_duration": sum(s.duration for s in segments)
            }
        finally:
            analyzer.close()

    def analyze_video_with_gemini(
        self,
        video_path: Path,
        target_duration: float = 60.0,
        context: Optional[str] = None,
        min_score: float = 50
    ) -> dict:
        """
        Analizează un video folosind Gemini AI pentru selecție inteligentă.

        Args:
            video_path: Calea către video
            target_duration: Durata țintă pentru segmentele selectate
            context: Context opțional (ex: "tutorial de gătit", "review produs")
            min_score: Scorul minim pentru a include un segment (0-100)

        Returns:
            Dict cu segmentele analizate și informații despre video
        """
        if not GEMINI_AVAILABLE:
            logger.warning("Gemini not available, falling back to motion analysis")
            return self.analyze_video(video_path, target_duration)

        video_path = Path(video_path)
        logger.info(f"Starting Gemini analysis for: {video_path.name}")

        try:
            # Inițializăm analizatorul Gemini
            gemini = GeminiVideoAnalyzer()

            # Obținem info despre video folosind VideoAnalyzer clasic
            classic_analyzer = VideoAnalyzer(video_path)
            video_info = classic_analyzer.get_video_info()
            classic_analyzer.close()

            # Analizăm cu Gemini
            gemini_segments = gemini.get_best_segments(
                video_path=video_path,
                target_duration=target_duration,
                min_score=min_score,
                context=context
            )

            # Convertim la VideoSegment pentru compatibilitate
            video_segments = self._gemini_to_video_segments(gemini_segments)

            return {
                "status": "success",
                "analysis_type": "gemini_ai",
                "video_info": video_info,
                "segments": [s.to_dict() for s in video_segments],
                "gemini_analysis": gemini.segments_to_dict(gemini_segments),
                "total_selected_duration": sum(s.duration for s in video_segments)
            }

        except Exception as e:
            logger.error(f"Gemini analysis failed: {e}, falling back to motion analysis")
            return self.analyze_video(video_path, target_duration)

    def _gemini_to_video_segments(
        self,
        gemini_segments: List['AnalyzedSegment']
    ) -> List[VideoSegment]:
        """Convertește segmentele Gemini în VideoSegment pentru compatibilitate."""
        video_segments = []

        for gs in gemini_segments:
            # Convertim scorul Gemini (0-100) la motion_score (0-1)
            # Score-ul Gemini devine motion_score pentru compatibilitate
            motion_score = gs.score / 100.0

            vs = VideoSegment(
                start_time=gs.start_time,
                end_time=gs.end_time,
                motion_score=motion_score,
                variance_score=motion_score * 0.8,  # Estimăm
                avg_brightness=0.5,  # Default
                visual_hashes=None
            )
            video_segments.append(vs)

        return video_segments

    def process_video_smart(
        self,
        video_path: Path,
        output_name: str,
        target_duration: float = 60.0,
        audio_path: Optional[Path] = None,
        srt_path: Optional[Path] = None,
        subtitle_settings: Optional[dict] = None,
        variant_count: int = 1,
        context: Optional[str] = None,
        use_gemini: bool = True,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Procesează video cu selecție inteligentă de segmente.
        Folosește Gemini AI dacă e disponibil, altfel fallback la motion detection.

        Args:
            video_path: Calea către video
            output_name: Numele output-ului
            target_duration: Durata țintă per variantă
            audio_path: Calea către audio (opțional)
            srt_path: Calea către SRT (opțional)
            subtitle_settings: Setări subtitrări
            variant_count: Numărul de variante
            context: Context pentru Gemini (ex: "cooking tutorial")
            use_gemini: Dacă să folosească Gemini (default: True dacă disponibil)
            progress_callback: Callback pentru progres
        """
        results = {"status": "processing", "steps": [], "variants": []}

        def report_progress(step: str, status: str = "in_progress"):
            results["steps"].append({"step": step, "status": status})
            if progress_callback:
                progress_callback(step, status)
            logger.info(f"Step: {step} - {status}")

        try:
            video_path = Path(video_path)

            # Analiză video
            if use_gemini and GEMINI_AVAILABLE:
                report_progress("Analyzing video with AI (Gemini)")
                analysis = self.analyze_video_with_gemini(
                    video_path,
                    target_duration * variant_count * 1.5,  # Mai mult pentru variante
                    context=context,
                    min_score=50
                )
                results["analysis_type"] = "gemini_ai"
            else:
                report_progress("Analyzing video with motion detection")
                analysis = self.analyze_video(video_path, target_duration * variant_count * 2)
                results["analysis_type"] = "motion_detection"

            results["video_info"] = analysis["video_info"]
            report_progress("Video analysis completed", "completed")

            # Verificăm segmentele
            if not analysis.get("segments"):
                raise ValueError("Nu s-au găsit segmente valide în video")

            # Convertim segmentele din dict în VideoSegment
            all_segments = []
            for seg_dict in analysis["segments"]:
                vs = VideoSegment(
                    start_time=seg_dict["start"],
                    end_time=seg_dict["end"],
                    motion_score=seg_dict.get("motion_score", 0.5),
                    variance_score=seg_dict.get("variance_score", 0.5),
                    avg_brightness=0.5,
                    visual_hashes=None
                )
                all_segments.append(vs)

            logger.info(f"Working with {len(all_segments)} segments for {variant_count} variants")

            # Procesăm fiecare variantă
            used_segments_by_variant: Dict[int, set] = {}

            for variant_idx in range(variant_count):
                variant_name = f"{output_name}_v{variant_idx + 1}" if variant_count > 1 else output_name
                report_progress(f"Processing variant {variant_idx + 1}/{variant_count}")

                # Selectăm segmente pentru această variantă
                selected_segments = self._select_variant_segments(
                    all_segments=all_segments,
                    variant_index=variant_idx,
                    variant_count=variant_count,
                    target_duration=target_duration,
                    used_segments_by_variant=used_segments_by_variant
                )

                if not selected_segments:
                    logger.warning(f"Variant {variant_idx + 1}: No segments, skipping")
                    continue

                # Extract segments (cu rotație pentru format vertical)
                report_progress(f"Extracting segments for variant {variant_idx + 1}")
                source_rotation = analysis.get("video_info", {}).get("rotation", 0)
                segments_video = self.editor.extract_segments(
                    video_path, selected_segments, variant_name,
                    source_rotation=source_rotation
                )
                current_video = segments_video

                # Add audio
                if audio_path and Path(audio_path).exists():
                    report_progress(f"Adding audio to variant {variant_idx + 1}")
                    current_video = self.editor.add_audio(current_video, Path(audio_path), variant_name)

                # Add subtitles
                if srt_path and Path(srt_path).exists():
                    report_progress(f"Adding subtitles to variant {variant_idx + 1}")
                    current_video = self.editor.add_subtitles(
                        current_video,
                        Path(srt_path),
                        variant_name,
                        subtitle_settings,
                        video_width=analysis["video_info"]["width"],
                        video_height=analysis["video_info"]["height"]
                    )

                results["variants"].append({
                    "variant_index": variant_idx + 1,
                    "variant_name": variant_name,
                    "final_video": str(current_video),
                    "segments_used": [s.to_dict() for s in selected_segments]
                })

                report_progress(f"Variant {variant_idx + 1} completed", "completed")

            # Cleanup
            report_progress("Cleaning up intermediate files")
            self.editor.cleanup_intermediates()

            # Colectam fisierele finale INAINTE de cleanup
            final_videos = set()
            for var in results["variants"]:
                if var.get("final_video"):
                    final_videos.add(Path(var["final_video"]).name)

            # Stergem doar fisierele intermediare, NU cele finale
            for f in self.output_dir.glob(f"{output_name}*"):
                if f.name not in final_videos:
                    try:
                        f.unlink()
                    except:
                        pass

            report_progress("Cleaning up intermediate files", "completed")

            if results["variants"]:
                results["final_video"] = results["variants"][0]["final_video"]

            results["status"] = "success"
            logger.info(f"Smart processing completed: {len(results['variants'])} variant(s)")

        except Exception as e:
            logger.error(f"Smart processing failed: {e}")
            results["status"] = "error"
            results["error"] = str(e)
            report_progress("Error", str(e))

        return results

    def _select_variant_segments(
        self,
        all_segments: List[VideoSegment],
        variant_index: int,
        variant_count: int,
        target_duration: float,
        used_segments_by_variant: Dict[int, set]
    ) -> List[VideoSegment]:
        """
        Selecteaza segmente UNICE pentru fiecare varianta.

        IMPORTANT: Fiecare varianta incepe dintr-o ZONA DIFERITA a videoclipului!
        Video-ul e impartit in zone si fiecare varianta porneste din zona ei.
        """
        if not all_segments:
            return []

        selected = []
        used_in_this_variant = set()
        total_duration = 0.0

        # Gasim durata totala a videoclipului din segmente
        video_duration = max(seg.end_time for seg in all_segments)

        # Impartim videoclipul in ZONE - fiecare varianta are zona ei de start
        zone_duration = video_duration / max(variant_count, 1)
        zone_start = zone_duration * variant_index
        zone_end = zone_duration * (variant_index + 1)

        logger.info(f"Variant {variant_index + 1}: Zone {zone_start:.1f}s - {zone_end:.1f}s (video: {video_duration:.1f}s)")

        # PASUL 1: Prima scena TREBUIE sa fie din ZONA acestei variante
        zone_segments = []
        for i, seg in enumerate(all_segments):
            # Segmentul trebuie sa inceapa in zona acestei variante
            if zone_start <= seg.start_time < zone_end:
                zone_segments.append((i, seg))

        # Sortam segmentele din zona dupa scor
        zone_segments.sort(key=lambda x: x[1].combined_score, reverse=True)

        if zone_segments:
            # Luam cel mai bun segment din zona
            idx, first_seg = zone_segments[0]
            selected.append(first_seg)
            used_in_this_variant.add(idx)
            total_duration += first_seg.duration
            logger.info(f"Variant {variant_index + 1}: First scene at {first_seg.start_time:.1f}s (zone start)")
        else:
            # Fallback: daca zona nu are segmente, luam primul disponibil
            logger.warning(f"Variant {variant_index + 1}: No segments in zone, using fallback")
            for i, seg in enumerate(all_segments):
                if i not in used_in_this_variant:
                    selected.append(seg)
                    used_in_this_variant.add(i)
                    total_duration += seg.duration
                    break

        # PASUL 2: Restul segmentelor - luam din INTREG videoclipul dar prioritizam diversitatea
        # Sortam toate segmentele dupa pozitie temporala pentru distributie uniforma
        all_with_idx = [(i, seg) for i, seg in enumerate(all_segments)]

        # Amestecam segmentele pentru diversitate - luam alternativ din diferite zone
        num_zones = 5  # Impartim in 5 zone pentru diversitate
        zone_buckets = [[] for _ in range(num_zones)]
        for i, seg in all_with_idx:
            bucket_idx = min(int((seg.start_time / video_duration) * num_zones), num_zones - 1)
            zone_buckets[bucket_idx].append((i, seg))

        # Sortam fiecare bucket dupa scor
        for bucket in zone_buckets:
            bucket.sort(key=lambda x: x[1].combined_score, reverse=True)

        # Luam segmente alternativ din fiecare bucket (round-robin)
        bucket_indices = [0] * num_zones
        segments_added = True

        while total_duration < target_duration and segments_added:
            segments_added = False

            for bucket_idx in range(num_zones):
                if total_duration >= target_duration:
                    break

                bucket = zone_buckets[bucket_idx]

                while bucket_indices[bucket_idx] < len(bucket):
                    idx, seg = bucket[bucket_indices[bucket_idx]]
                    bucket_indices[bucket_idx] += 1

                    if idx in used_in_this_variant:
                        continue

                    # Verificam overlap temporal cu segmentele deja selectate
                    has_overlap = False
                    for sel in selected:
                        if not (seg.end_time <= sel.start_time or seg.start_time >= sel.end_time):
                            has_overlap = True
                            break

                    if has_overlap:
                        continue

                    # Verificam similaritate vizuala
                    is_similar = False
                    for sel in selected:
                        if seg.is_visually_similar(sel, threshold=12):
                            is_similar = True
                            break

                    if is_similar:
                        continue

                    # VERIFICAM TRANZITIE DINAMICA
                    # Segmentul trebuie sa aiba motion score decent pentru tranzitii dinamice
                    if seg.motion_score < 0.015:  # Threshold pentru dinamism
                        continue  # Skip segmente statice/plictisitoare

                    selected.append(seg)
                    used_in_this_variant.add(idx)
                    total_duration += seg.duration
                    segments_added = True
                    break  # Trecem la urmatorul bucket

        used_segments_by_variant[variant_index] = used_in_this_variant

        # Sortam cronologic pentru export
        selected.sort(key=lambda s: s.start_time)

        logger.info(f"Variant {variant_index + 1}: {len(selected)} segments from {len(set(int(s.start_time/zone_duration) for s in selected))} zones, {total_duration:.1f}s")
        return selected

    def process_video(
        self,
        video_path: Path,
        output_name: str,
        target_duration: float = 20.0,
        audio_path: Optional[Path] = None,
        srt_path: Optional[Path] = None,
        subtitle_settings: Optional[dict] = None,
        variant_count: int = 1,
        progress_callback: Optional[callable] = None,
        context_text: Optional[str] = None,
        generate_audio: bool = True,
        mute_source_voice: bool = False
    ) -> dict:
        """
        Proceseaza un video complet.

        Args:
            mute_source_voice: Dacă True, detectează și mută vocile din video-ul sursă
                              DOAR în segmentele selectate, păstrând efectele sonore
        """
        results = {"status": "processing", "steps": [], "variants": []}

        def report_progress(step: str, status: str = "in_progress"):
            results["steps"].append({"step": step, "status": status})
            if progress_callback:
                progress_callback(step, status)
            logger.info(f"Step: {step} - {status}")

        try:
            # Analiza video
            report_progress("Analyzing video")
            analyzer = VideoAnalyzer(video_path)
            video_info = analyzer.get_video_info()

            # Folosim Gemini AI pentru selecție inteligentă dacă avem context
            if context_text and GEMINI_AVAILABLE:
                report_progress("AI Analysis with Gemini")
                logger.info(f"Using Gemini AI for context-based frame selection: {context_text[:100]}...")
                try:
                    gemini_analyzer = GeminiVideoAnalyzer()
                    ai_segments = gemini_analyzer.get_best_segments(
                        video_path=video_path,
                        target_duration=target_duration * variant_count * 2,
                        min_score=50,
                        context=context_text
                    )
                    # Convertim AnalyzedSegment în VideoSegment
                    all_segments = []
                    for ai_seg in ai_segments:
                        seg = VideoSegment(
                            start_time=ai_seg.start_time,
                            end_time=ai_seg.end_time,
                            motion_score=ai_seg.score / 100.0,
                            variance_score=0.8,
                            avg_brightness=0.5
                        )
                        all_segments.append(seg)
                    logger.info(f"Gemini found {len(all_segments)} context-matched segments")
                    report_progress("AI Analysis completed", "completed")
                except Exception as e:
                    logger.warning(f"Gemini analysis failed, falling back to motion analysis: {e}")
                    report_progress("Motion Analysis (fallback)")
                    # Fallback la analiza clasică
                    required_duration = target_duration * variant_count * 2
                    all_segments = analyzer.select_best_segments(
                        required_duration,
                        min_motion=0.008,
                        similarity_threshold=10,
                        progress_callback=progress_callback
                    )
            else:
                # Analizam tot video-ul cu metoda clasică (motion-based)
                report_progress("Motion Analysis")
                required_duration = target_duration * variant_count * 2
                all_segments = analyzer.select_best_segments(
                    required_duration,
                    min_motion=0.008,
                    similarity_threshold=10,
                    progress_callback=progress_callback
                )

            analyzer.close()

            results["video_info"] = video_info
            results["segments"] = [s.to_dict() for s in all_segments]
            results["total_segments_available"] = len(all_segments)
            report_progress("Analyzing video", "completed")

            logger.info(f"Found {len(all_segments)} segments for {variant_count} variants")

            # Verificam daca avem suficiente segmente
            if not all_segments:
                raise ValueError("Nu s-au gasit segmente valide in video. Video-ul poate fi prea static sau prea scurt.")

            # VOICE DETECTION: Detectăm vocile ÎNAINTE de procesare (dacă e activat)
            voice_segments = None
            if mute_source_voice:
                report_progress("Detecting voice in source video")
                try:
                    from .voice_detector import VoiceDetector
                    detector = VoiceDetector(threshold=0.5, min_speech_duration=0.25)
                    voice_segments = detector.detect_voice(video_path)

                    if voice_segments:
                        total_voice = sum(v.duration for v in voice_segments)
                        logger.info(f"Detected {len(voice_segments)} voice segments ({total_voice:.1f}s total)")
                        results["voice_detection"] = {
                            "segments_count": len(voice_segments),
                            "total_duration": round(total_voice, 2)
                        }
                        report_progress(f"Voice detection: {len(voice_segments)} segments", "completed")
                    else:
                        logger.info("No voice detected in source video")
                        report_progress("No voice detected in source", "completed")
                except Exception as e:
                    logger.warning(f"Voice detection failed: {e}")
                    report_progress("Voice detection skipped", "warning")
                    voice_segments = None

            used_segments_by_variant: Dict[int, set] = {}

            # Procesam fiecare varianta
            for variant_idx in range(variant_count):
                variant_name = f"{output_name}_v{variant_idx + 1}" if variant_count > 1 else output_name

                report_progress(f"Processing variant {variant_idx + 1}/{variant_count}")

                selected_segments = self._select_variant_segments(
                    all_segments=all_segments,
                    variant_index=variant_idx,
                    variant_count=variant_count,
                    target_duration=target_duration,
                    used_segments_by_variant=used_segments_by_variant
                )

                # Verificam daca am selectat segmente pentru aceasta varianta
                if not selected_segments:
                    logger.warning(f"Variant {variant_idx + 1}: No segments available, skipping")
                    continue

                # Extract segments (cu mute selectiv + rotație pentru format vertical)
                report_progress(f"Extracting segments for variant {variant_idx + 1}")
                source_rotation = video_info.get("rotation", 0)
                segments_video = self.editor.extract_segments(
                    video_path,
                    selected_segments,
                    variant_name,
                    voice_segments=voice_segments,  # Mute selectiv doar în porțiunile cu voce
                    source_rotation=source_rotation  # Corectează orientarea pentru vertical
                )
                current_video = segments_video

                # Add audio (only if generate_audio is True)
                if generate_audio and audio_path and audio_path.exists():
                    report_progress(f"Adding audio to variant {variant_idx + 1}")
                    current_video = self.editor.add_audio(current_video, audio_path, variant_name)
                elif not generate_audio:
                    logger.info(f"Skipping audio for variant {variant_idx + 1} (generate_audio=False)")

                # Add subtitles (only if generate_audio is True - subtitles go with voice)
                if generate_audio and srt_path and srt_path.exists():
                    report_progress(f"Adding subtitles to variant {variant_idx + 1}")
                    current_video = self.editor.add_subtitles(
                        current_video,
                        srt_path,
                        variant_name,
                        subtitle_settings,
                        video_width=video_info["width"],
                        video_height=video_info["height"]
                    )

                results["variants"].append({
                    "variant_index": variant_idx + 1,
                    "variant_name": variant_name,
                    "final_video": str(current_video),
                    "segments_used": [s.to_dict() for s in selected_segments]
                })

                report_progress(f"Variant {variant_idx + 1} completed", "completed")

            # CLEANUP - stergem fisierele intermediare
            report_progress("Cleaning up intermediate files")
            self.editor.cleanup_intermediates()

            # Colectam fisierele finale INAINTE de cleanup
            final_videos = set()
            for var in results["variants"]:
                if var.get("final_video"):
                    final_videos.add(Path(var["final_video"]).name)

            # Stergem doar fisierele intermediare, NU cele finale
            for f in self.output_dir.glob(f"{output_name}*"):
                if f.name not in final_videos:
                    try:
                        f.unlink()
                        logger.info(f"Cleaned up intermediate: {f.name}")
                    except Exception as e:
                        logger.warning(f"Failed to cleanup {f}: {e}")

            report_progress("Cleaning up intermediate files", "completed")

            if results["variants"]:
                results["final_video"] = results["variants"][0]["final_video"]

            results["status"] = "success"
            logger.info(f"Processing completed: {len(results['variants'])} variant(s)")

        except Exception as e:
            logger.error(f"Processing failed: {e}")
            results["status"] = "error"
            results["error"] = str(e)
            report_progress("Error", str(e))

        return results

    def process_video_with_keywords(
        self,
        main_video_path: Path,
        secondary_videos: List[Dict],  # [{path: Path, keywords: [str]}]
        srt_content: str,
        output_name: str,
        target_duration: float = 20.0,
        audio_path: Optional[Path] = None,
        subtitle_settings: Optional[dict] = None,
        variant_count: int = 1,
        secondary_segment_duration: float = 2.0,
        progress_callback: Optional[callable] = None
    ) -> dict:
        """
        Procesează video cu suport pentru videouri secundare trigger-uite de keywords.

        Args:
            main_video_path: Calea către videoclipul principal
            secondary_videos: Lista de videouri secundare cu keywords
                              [{path: Path, keywords: ["decant", "decanturi"]}]
            srt_content: Conținutul fișierului SRT pentru keyword matching
            output_name: Numele output-ului
            target_duration: Durata țintă per variantă
            audio_path: Calea către audio (opțional)
            subtitle_settings: Setări subtitrări
            variant_count: Numărul de variante de generat
            secondary_segment_duration: Cât durează un segment din video secundar
            progress_callback: Callback pentru progres
        """
        from .keyword_matcher import find_keyword_timestamps, get_keyword_segments

        results = {"status": "processing", "steps": [], "variants": []}

        def report_progress(step: str, status: str = "in_progress"):
            results["steps"].append({"step": step, "status": status})
            if progress_callback:
                progress_callback(step, status)
            logger.info(f"Step: {step} - {status}")

        try:
            # PASUL 1: Analizăm videoclipul principal
            report_progress("Analyzing main video")
            main_analyzer = VideoAnalyzer(main_video_path)
            main_video_info = main_analyzer.get_video_info()

            required_duration = target_duration * variant_count * 2
            main_segments = main_analyzer.select_best_segments(
                required_duration,
                min_motion=0.008,
                similarity_threshold=10
            )
            main_analyzer.close()

            results["main_video_info"] = main_video_info
            report_progress("Analyzing main video", "completed")

            # PASUL 2: Găsim keywords în SRT
            report_progress("Finding keywords in SRT")
            all_keywords = []
            for sv in secondary_videos:
                all_keywords.extend(sv.get('keywords', []))

            keyword_matches = find_keyword_timestamps(srt_content, all_keywords, min_confidence=0.7)
            keyword_segments = get_keyword_segments(keyword_matches, secondary_segment_duration)

            logger.info(f"Found {len(keyword_matches)} keyword matches -> {len(keyword_segments)} segments")
            results["keyword_matches"] = [
                {"keyword": m.keyword, "time": m.start_time, "confidence": m.confidence}
                for m in keyword_matches
            ]
            report_progress("Finding keywords in SRT", "completed")

            # PASUL 3: Analizăm videoclipurile secundare
            report_progress("Analyzing secondary videos")
            secondary_analyzers = {}
            secondary_segments_by_keyword = {}

            for sv in secondary_videos:
                sv_path = Path(sv['path'])
                keywords = sv.get('keywords', [])

                if not sv_path.exists():
                    logger.warning(f"Secondary video not found: {sv_path}")
                    continue

                analyzer = VideoAnalyzer(sv_path)
                # IMPORTANT: Analizăm segmente cu durata EXACT cât e setat secondary_segment_duration
                # Astfel ne asigurăm că întreaga durată extrasă este dinamică, nu doar începutul
                segments = analyzer.select_best_segments(
                    target_duration,  # Suficiente segmente pentru toate variantele
                    min_segment=secondary_segment_duration,  # Minim durata setată
                    max_segment=secondary_segment_duration,  # Maxim tot durata setată
                    min_motion=0.008
                )
                analyzer.close()

                # Asociem segmentele cu keywords
                for kw in keywords:
                    if kw not in secondary_segments_by_keyword:
                        secondary_segments_by_keyword[kw] = []
                    secondary_segments_by_keyword[kw].extend(segments)

                logger.info(f"Secondary video {sv_path.name}: {len(segments)} segments ({secondary_segment_duration}s each) for keywords {keywords}")

            report_progress("Analyzing secondary videos", "completed")

            # PASUL 4: Procesăm fiecare variantă
            used_segments_by_variant: Dict[int, set] = {}

            for variant_idx in range(variant_count):
                variant_name = f"{output_name}_v{variant_idx + 1}" if variant_count > 1 else output_name
                report_progress(f"Processing variant {variant_idx + 1}/{variant_count}")

                # Selectăm segmente din videoclipul principal
                selected_main = self._select_variant_segments(
                    all_segments=main_segments,
                    variant_index=variant_idx,
                    variant_count=variant_count,
                    target_duration=target_duration,
                    used_segments_by_variant=used_segments_by_variant
                )

                if not selected_main:
                    logger.warning(f"Variant {variant_idx + 1}: No main segments, skipping")
                    continue

                # CONSTRUIM TIMELINE-UL COMBINAT
                # Intercalăm segmente secundare la momentele keywords
                timeline = self._build_keyword_timeline(
                    main_segments=selected_main,
                    keyword_segments=keyword_segments,
                    secondary_segments_by_keyword=secondary_segments_by_keyword,
                    target_duration=target_duration,
                    variant_idx=variant_idx,
                    secondary_segment_duration=secondary_segment_duration
                )

                logger.info(f"Variant {variant_idx + 1}: Timeline has {len(timeline)} items")

                # Extragem și concatenăm conform timeline-ului
                report_progress(f"Extracting segments for variant {variant_idx + 1}")
                current_video = self._extract_timeline(
                    timeline=timeline,
                    main_video_path=main_video_path,
                    secondary_videos=secondary_videos,
                    variant_name=variant_name
                )

                # Adăugăm audio
                if audio_path and audio_path.exists():
                    report_progress(f"Adding audio to variant {variant_idx + 1}")
                    current_video = self.editor.add_audio(current_video, audio_path, variant_name)

                # Adăugăm subtitrări
                srt_path = self.temp_dir / f"{variant_name}_subs.srt"
                with open(srt_path, 'w', encoding='utf-8') as f:
                    f.write(srt_content)

                report_progress(f"Adding subtitles to variant {variant_idx + 1}")
                current_video = self.editor.add_subtitles(
                    current_video,
                    srt_path,
                    variant_name,
                    subtitle_settings,
                    video_width=main_video_info["width"],
                    video_height=main_video_info["height"]
                )

                # Cleanup temp SRT
                srt_path.unlink(missing_ok=True)

                results["variants"].append({
                    "variant_index": variant_idx + 1,
                    "variant_name": variant_name,
                    "final_video": str(current_video),
                    "timeline_items": len(timeline)
                })

                report_progress(f"Variant {variant_idx + 1} completed", "completed")

            # Cleanup
            report_progress("Cleaning up intermediate files")
            self.editor.cleanup_intermediates()

            # Colectam fisierele finale INAINTE de cleanup
            final_videos = set()
            for var in results["variants"]:
                if var.get("final_video"):
                    final_videos.add(Path(var["final_video"]).name)

            # Stergem doar fisierele intermediare, NU cele finale
            for f in self.output_dir.glob(f"{output_name}*"):
                if f.name not in final_videos:
                    try:
                        f.unlink()
                    except:
                        pass

            report_progress("Cleaning up intermediate files", "completed")

            if results["variants"]:
                results["final_video"] = results["variants"][0]["final_video"]

            results["status"] = "success"
            logger.info(f"Multi-video processing completed: {len(results['variants'])} variant(s)")

        except Exception as e:
            logger.error(f"Multi-video processing failed: {e}")
            results["status"] = "error"
            results["error"] = str(e)
            report_progress("Error", str(e))

        return results

    def _build_keyword_timeline(
        self,
        main_segments: List[VideoSegment],
        keyword_segments: List[Dict],
        secondary_segments_by_keyword: Dict[str, List[VideoSegment]],
        target_duration: float,
        variant_idx: int,
        secondary_segment_duration: float = 2.0
    ) -> List[Dict]:
        """
        Construiește timeline-ul combinat intercalând video secundar la keywords.

        Returns:
            Lista de timeline items: [{source, video_path, segment, start_time, end_time}]
        """
        timeline = []
        current_time = 0.0
        main_idx = 0
        used_secondary = {kw: set() for kw in secondary_segments_by_keyword}

        # Calculăm când apar keywords în audio (relativ la durata target)
        keyword_times = {}
        for ks in keyword_segments:
            kw = ks['keyword']
            t = ks['start_time']
            if t <= target_duration:  # Doar keywords care încap în durata țintă
                if kw not in keyword_times:
                    keyword_times[kw] = []
                keyword_times[kw].append(t)

        # Sortăm main segments cronologic (deja ar trebui să fie)
        main_segments = sorted(main_segments, key=lambda s: s.start_time)

        while current_time < target_duration and main_idx < len(main_segments):
            main_seg = main_segments[main_idx]

            # Verificăm dacă e un keyword în acest interval
            keyword_to_insert = None
            for kw, times in keyword_times.items():
                for t in times:
                    if current_time <= t < current_time + main_seg.duration:
                        keyword_to_insert = kw
                        # Eliminăm acest timestamp să nu-l folosim din nou
                        keyword_times[kw] = [x for x in times if x != t]
                        break
                if keyword_to_insert:
                    break

            if keyword_to_insert and keyword_to_insert in secondary_segments_by_keyword:
                # Inserăm segment din video secundar
                secondary_segs = secondary_segments_by_keyword[keyword_to_insert]
                available = [i for i, s in enumerate(secondary_segs) if i not in used_secondary[keyword_to_insert]]

                if available:
                    # Luăm un segment diferit pentru fiecare variantă
                    sec_idx = available[variant_idx % len(available)]
                    sec_seg = secondary_segs[sec_idx]
                    used_secondary[keyword_to_insert].add(sec_idx)

                    timeline.append({
                        'source': 'secondary',
                        'keyword': keyword_to_insert,
                        'segment': sec_seg,
                        'timeline_start': current_time,
                        'duration': min(sec_seg.duration, secondary_segment_duration)
                    })
                    current_time += min(sec_seg.duration, secondary_segment_duration)

            # Adăugăm segmentul principal
            remaining = target_duration - current_time
            if remaining <= 0:
                break

            duration = min(main_seg.duration, remaining)
            timeline.append({
                'source': 'main',
                'segment': main_seg,
                'timeline_start': current_time,
                'duration': duration
            })
            current_time += duration
            main_idx += 1

        return timeline

    def _extract_timeline(
        self,
        timeline: List[Dict],
        main_video_path: Path,
        secondary_videos: List[Dict],
        variant_name: str
    ) -> Path:
        """
        Extrage și concatenează segmentele conform timeline-ului.
        """
        segment_files = []

        # Mapăm keywords la video paths
        keyword_to_path = {}
        for sv in secondary_videos:
            for kw in sv.get('keywords', []):
                keyword_to_path[kw] = Path(sv['path'])

        for i, item in enumerate(timeline):
            temp_file = self.temp_dir / f"timeline_{variant_name}_{i:03d}.mp4"

            if item['source'] == 'main':
                video_path = main_video_path
            else:
                kw = item.get('keyword', '')
                video_path = keyword_to_path.get(kw, main_video_path)

            seg = item['segment']

            if self.editor.use_gpu:
                cmd = [
                    "ffmpeg", "-y",
                    "-hwaccel", "cuda",
                    "-hwaccel_output_format", "cuda",
                    "-i", str(video_path),
                    "-ss", str(seg.start_time),
                    "-t", str(item['duration']),
                    "-c:v", self.editor.video_codec,
                    "-preset", self.editor.video_preset,
                    "-cq", self.editor.video_quality,
                    # Keyframe interval (2 sec at 30fps)
                    "-g", "60",
                    "-bf", "2",
                    # Audio
                    "-c:a", "aac", "-b:a", "128k",
                    "-ar", "48000", "-ac", "2",
                    # Pixel format
                    "-pix_fmt", "yuv420p",
                    str(temp_file)
                ]
            else:
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(video_path),
                    "-ss", str(seg.start_time),
                    "-t", str(item['duration']),
                    "-c:v", self.editor.video_codec,
                    "-profile:v", "high",
                    "-level:v", "4.0",
                    "-preset", self.editor.video_preset,
                    "-crf", self.editor.video_quality,
                    # Keyframe interval (2 sec at 30fps)
                    "-g", "60",
                    "-keyint_min", "60",
                    "-sc_threshold", "0",
                    "-bf", "2",
                    # Audio
                    "-c:a", "aac", "-b:a", "128k",
                    "-ar", "48000", "-ac", "2",
                    # Pixel format
                    "-pix_fmt", "yuv420p",
                    "-sar", "1:1",
                    str(temp_file)
                ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                segment_files.append(temp_file)
                self.editor._track_intermediate(temp_file)
                logger.info(f"Extracted timeline item {i+1}/{len(timeline)}: {item['source']} at {seg.start_time:.1f}s")
            else:
                # Parse error for better logging
                stderr = result.stderr
                error_lines = [line for line in stderr.split('\n') if 'error' in line.lower()]
                error_msg = error_lines[0] if error_lines else stderr[-300:]
                logger.error(f"FFmpeg failed for timeline item {i+1}/{len(timeline)}: {error_msg}")
                logger.debug(f"Full FFmpeg stderr: {stderr}")

        # Concatenăm toate segmentele
        if not segment_files:
            raise ValueError("No segments extracted from timeline")

        return self.editor._concat_segments(segment_files, variant_name)
