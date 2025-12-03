#!/usr/bin/env python3
"""
Edit Factory - Video Processor
Procesează videoclipuri pentru a extrage secvențele cele mai dinamice
și le combină cu voiceover și subtitrări.

Autor: Obsid SRL
"""

import os
import sys
import json
import argparse
import logging
import subprocess
from pathlib import Path
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from datetime import timedelta

# PySceneDetect pentru detectarea scenelor
from scenedetect import open_video, SceneManager, ContentDetector
from scenedetect.stats_manager import StatsManager

import cv2
import numpy as np

# Configurare logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/home/ubuntu/edit-factory/logs/processor.log')
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class VideoSegment:
    """Reprezintă un segment de video cu scor de dinamism."""
    start_time: float  # în secunde
    end_time: float
    motion_score: float
    scene_changes: int
    avg_brightness: float

    @property
    def duration(self) -> float:
        return self.end_time - self.start_time

    @property
    def combined_score(self) -> float:
        """Scor combinat pentru ranking."""
        return (
            self.motion_score * 0.5 +
            self.scene_changes * 0.3 +
            (1 - abs(self.avg_brightness - 0.5)) * 0.2  # Preferă luminozitate medie
        )


class VideoAnalyzer:
    """Analizează videoclipuri pentru a găsi secvențele cele mai dinamice."""

    def __init__(self, video_path: str):
        self.video_path = Path(video_path)
        if not self.video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        self.cap = cv2.VideoCapture(str(self.video_path))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.frame_count = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.duration = self.frame_count / self.fps if self.fps > 0 else 0
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        logger.info(f"Video loaded: {self.video_path.name}")
        logger.info(f"  Duration: {self.duration:.2f}s, FPS: {self.fps:.2f}")
        logger.info(f"  Resolution: {self.width}x{self.height}")

    def detect_scenes(self, threshold: float = 27.0) -> List[Tuple[float, float]]:
        """Detectează schimbările de scenă folosind PySceneDetect."""
        video = open_video(str(self.video_path))
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=threshold))

        scene_manager.detect_scenes(video)
        scene_list = scene_manager.get_scene_list()

        scenes = []
        for scene in scene_list:
            start = scene[0].get_seconds()
            end = scene[1].get_seconds()
            scenes.append((start, end))

        logger.info(f"Detected {len(scenes)} scenes")
        return scenes

    def calculate_motion_score(self, start_frame: int, end_frame: int) -> float:
        """Calculează scorul de mișcare pentru un interval de frame-uri."""
        self.cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        motion_scores = []
        prev_frame = None

        for i in range(start_frame, min(end_frame, start_frame + 100)):  # Limităm la 100 frame-uri
            ret, frame = self.cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (21, 21), 0)

            if prev_frame is not None:
                diff = cv2.absdiff(prev_frame, gray)
                motion_score = np.mean(diff) / 255.0
                motion_scores.append(motion_score)

            prev_frame = gray

        return np.mean(motion_scores) if motion_scores else 0.0

    def analyze_segments(self, segment_duration: float = 5.0) -> List[VideoSegment]:
        """Analizează video-ul în segmente și returnează scoruri."""
        segments = []
        scenes = self.detect_scenes()

        # Creăm segmente bazate pe scene
        for start, end in scenes:
            start_frame = int(start * self.fps)
            end_frame = int(end * self.fps)

            motion_score = self.calculate_motion_score(start_frame, end_frame)

            # Calculăm luminozitatea medie
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
            ret, frame = self.cap.read()
            avg_brightness = np.mean(frame) / 255.0 if ret else 0.5

            segment = VideoSegment(
                start_time=start,
                end_time=end,
                motion_score=motion_score,
                scene_changes=1,
                avg_brightness=avg_brightness
            )
            segments.append(segment)

        # Sortăm după scorul combinat
        segments.sort(key=lambda s: s.combined_score, reverse=True)

        logger.info(f"Analyzed {len(segments)} segments")
        return segments

    def select_best_segments(
        self,
        target_duration: float,
        min_segment: float = 1.0,
        max_segment: float = 10.0
    ) -> List[VideoSegment]:
        """Selectează cele mai bune segmente pentru a atinge durata țintă."""
        all_segments = self.analyze_segments()

        # Filtrăm segmentele prea scurte sau prea lungi
        valid_segments = [
            s for s in all_segments
            if min_segment <= s.duration <= max_segment
        ]

        selected = []
        total_duration = 0.0

        for segment in valid_segments:
            if total_duration >= target_duration:
                break

            # Verificăm să nu se suprapună cu segmente deja selectate
            overlap = False
            for sel in selected:
                if not (segment.end_time <= sel.start_time or segment.start_time >= sel.end_time):
                    overlap = True
                    break

            if not overlap:
                selected.append(segment)
                total_duration += segment.duration

        # Sortăm cronologic pentru export
        selected.sort(key=lambda s: s.start_time)

        logger.info(f"Selected {len(selected)} segments, total duration: {total_duration:.2f}s")
        return selected

    def close(self):
        """Eliberează resursele."""
        self.cap.release()


class VideoEditor:
    """Editează și combină segmente video cu audio și subtitrări."""

    def __init__(self, output_dir: str = "/home/ubuntu/edit-factory/output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.temp_dir = Path("/home/ubuntu/edit-factory/temp")
        self.temp_dir.mkdir(parents=True, exist_ok=True)

    def extract_segments(
        self,
        video_path: str,
        segments: List[VideoSegment],
        output_name: str
    ) -> str:
        """Extrage și concatenează segmentele selectate."""
        video_path = Path(video_path)

        # Creăm fișiere temporare pentru fiecare segment
        segment_files = []
        for i, seg in enumerate(segments):
            temp_file = self.temp_dir / f"segment_{i:03d}.mp4"

            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-ss", str(seg.start_time),
                "-t", str(seg.duration),
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                str(temp_file)
            ]

            subprocess.run(cmd, capture_output=True, check=True)
            segment_files.append(temp_file)
            logger.info(f"Extracted segment {i+1}/{len(segments)}: {seg.start_time:.2f}s - {seg.end_time:.2f}s")

        # Creăm lista pentru concatenare
        concat_file = self.temp_dir / "concat_list.txt"
        with open(concat_file, 'w') as f:
            for seg_file in segment_files:
                f.write(f"file '{seg_file}'\n")

        # Concatenăm toate segmentele
        output_video = self.output_dir / f"{output_name}_segments.mp4"
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            str(output_video)
        ]

        subprocess.run(cmd, capture_output=True, check=True)

        # Curățăm fișierele temporare
        for f in segment_files:
            f.unlink()
        concat_file.unlink()

        logger.info(f"Created concatenated video: {output_video}")
        return str(output_video)

    def add_audio(self, video_path: str, audio_path: str, output_name: str) -> str:
        """Adaugă audio la video, ajustând durata video-ului la audio."""
        output_video = self.output_dir / f"{output_name}_with_audio.mp4"

        # Obținem durata audio-ului
        probe_cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            audio_path
        ]
        result = subprocess.run(probe_cmd, capture_output=True, text=True)
        audio_duration = float(json.loads(result.stdout)['format']['duration'])

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-filter_complex", f"[0:v]setpts=PTS*({audio_duration}/$(ffprobe -v error -show_entries format=duration -of csv=p=0 {video_path}))[v]",
            "-map", "[v]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "aac",
            "-shortest",
            str(output_video)
        ]

        # Metodă simplificată - taie video-ul la durata audio-ului
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-t", str(audio_duration),
            "-map", "0:v",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "fast",
            "-c:a", "aac",
            str(output_video)
        ]

        subprocess.run(cmd, capture_output=True, check=True)
        logger.info(f"Added audio to video: {output_video}")
        return str(output_video)

    def add_subtitles(self, video_path: str, srt_path: str, output_name: str) -> str:
        """Adaugă subtitrări la video (burn-in)."""
        output_video = self.output_dir / f"{output_name}_final.mp4"

        # Stil pentru subtitrări - optimizat pentru reels
        subtitle_style = (
            "FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,Outline=2,Shadow=1,"
            "Alignment=2,MarginV=50"
        )

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", f"subtitles={srt_path}:force_style='{subtitle_style}'",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "copy",
            str(output_video)
        ]

        subprocess.run(cmd, capture_output=True, check=True)
        logger.info(f"Added subtitles to video: {output_video}")
        return str(output_video)

    def create_reel(
        self,
        video_path: str,
        audio_path: Optional[str] = None,
        srt_path: Optional[str] = None,
        target_duration: float = 20.0,
        output_name: str = "reel"
    ) -> Dict[str, str]:
        """
        Pipeline complet pentru crearea unui reel.

        Args:
            video_path: Calea către video-ul sursă
            audio_path: Calea către fișierul audio (voiceover)
            srt_path: Calea către fișierul SRT cu subtitrări
            target_duration: Durata țintă în secunde
            output_name: Numele de bază pentru fișierele output

        Returns:
            Dict cu căile către fișierele create
        """
        results = {}

        # Pasul 1: Analizăm și selectăm segmentele
        logger.info("Step 1: Analyzing video and selecting best segments...")
        analyzer = VideoAnalyzer(video_path)
        segments = analyzer.select_best_segments(target_duration)
        analyzer.close()

        # Salvăm informații despre segmente
        segments_info = [
            {
                "start": s.start_time,
                "end": s.end_time,
                "duration": s.duration,
                "motion_score": s.motion_score,
                "combined_score": s.combined_score
            }
            for s in segments
        ]
        results['segments'] = segments_info

        # Pasul 2: Extragem și concatenăm segmentele
        logger.info("Step 2: Extracting and concatenating segments...")
        segments_video = self.extract_segments(video_path, segments, output_name)
        results['segments_video'] = segments_video

        # Pasul 3: Adăugăm audio (dacă există)
        if audio_path and Path(audio_path).exists():
            logger.info("Step 3: Adding audio...")
            video_with_audio = self.add_audio(segments_video, audio_path, output_name)
            results['video_with_audio'] = video_with_audio
            current_video = video_with_audio
        else:
            current_video = segments_video
            logger.info("Step 3: Skipped (no audio provided)")

        # Pasul 4: Adăugăm subtitrări (dacă există)
        if srt_path and Path(srt_path).exists():
            logger.info("Step 4: Adding subtitles...")
            final_video = self.add_subtitles(current_video, srt_path, output_name)
            results['final_video'] = final_video
        else:
            results['final_video'] = current_video
            logger.info("Step 4: Skipped (no subtitles provided)")

        logger.info(f"Reel created successfully: {results['final_video']}")
        return results


def main():
    parser = argparse.ArgumentParser(description="Edit Factory - Video Processor")
    parser.add_argument("video", help="Path to input video file")
    parser.add_argument("--audio", help="Path to audio file (voiceover)")
    parser.add_argument("--srt", help="Path to SRT subtitle file")
    parser.add_argument("--duration", type=float, default=20.0, help="Target duration in seconds")
    parser.add_argument("--output", default="reel", help="Output filename base")
    parser.add_argument("--analyze-only", action="store_true", help="Only analyze, don't edit")
    parser.add_argument("--json", action="store_true", help="Output results as JSON")

    args = parser.parse_args()

    try:
        if args.analyze_only:
            # Doar analizăm video-ul
            analyzer = VideoAnalyzer(args.video)
            segments = analyzer.select_best_segments(args.duration)
            analyzer.close()

            result = {
                "status": "success",
                "segments": [
                    {
                        "start": s.start_time,
                        "end": s.end_time,
                        "duration": s.duration,
                        "motion_score": s.motion_score,
                        "combined_score": s.combined_score
                    }
                    for s in segments
                ]
            }
        else:
            # Procesăm complet
            editor = VideoEditor()
            result = editor.create_reel(
                video_path=args.video,
                audio_path=args.audio,
                srt_path=args.srt,
                target_duration=args.duration,
                output_name=args.output
            )
            result["status"] = "success"

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"\nResults:")
            for key, value in result.items():
                print(f"  {key}: {value}")

    except Exception as e:
        logger.error(f"Error: {e}")
        if args.json:
            print(json.dumps({"status": "error", "message": str(e)}))
        else:
            print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
