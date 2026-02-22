"""
Gemini Video Analyzer Service.
Folosește Gemini 2.5 Flash pentru a analiza videoclipuri și a găsi cele mai bune momente.
"""
import os
import logging
import base64
import json
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
import cv2
from google import genai
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


@dataclass
class AnalyzedSegment:
    """Un segment analizat din video."""
    start_time: float
    end_time: float
    score: float  # 0-100, cât de bun e segmentul pentru reels
    description: str
    highlights: List[str]  # Ce face segmentul interesant
    tags: List[str]  # Categorii: "product_demo", "talking_head", "action", etc.


class GeminiVideoAnalyzer:
    """
    Analizează videoclipuri folosind Gemini pentru a găsi cele mai bune momente.

    Workflow:
    1. Extrage frames la interval regulat (default: 1 frame / 2 secunde)
    2. Trimite batch-uri de frames la Gemini
    3. Primește analiza și scoruri pentru fiecare segment
    4. Returnează segmentele sortate după scor
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        frame_interval: float = 2.0,
        max_frames_per_batch: int = 30
    ):
        """
        Args:
            api_key: Gemini API key (sau din GEMINI_API_KEY env var)
            model_name: Modelul Gemini (sau din GEMINI_MODEL env var)
            frame_interval: Interval între frames în secunde
            max_frames_per_batch: Câte frames într-un singur request
        """
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        self.model_name = model_name or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        self.frame_interval = frame_interval
        self.max_frames_per_batch = max_frames_per_batch

        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is required")

        self.client = genai.Client(api_key=self.api_key)
        logger.info(f"GeminiVideoAnalyzer initialized with model: {self.model_name}")

    def extract_frames(
        self,
        video_path: Path,
        interval: Optional[float] = None
    ) -> List[Tuple[float, bytes]]:
        """
        Extrage frames din video la interval specificat.

        Returns:
            Lista de (timestamp, frame_bytes_jpeg)
        """
        interval = interval or self.frame_interval
        frames = []

        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0

        logger.info(f"Video: {duration:.1f}s, {fps:.1f}fps, extracting every {interval}s")

        frame_indices = []
        current_time = 0
        while current_time < duration:
            frame_idx = int(current_time * fps)
            frame_indices.append((current_time, frame_idx))
            current_time += interval

        for timestamp, frame_idx in frame_indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()

            if not ret:
                continue

            # Resize pentru a reduce dimensiunea (max 720p width)
            height, width = frame.shape[:2]
            if width > 720:
                scale = 720 / width
                new_width = 720
                new_height = int(height * scale)
                frame = cv2.resize(frame, (new_width, new_height))

            # Encode as JPEG
            _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frames.append((timestamp, buffer.tobytes()))

        cap.release()
        logger.info(f"Extracted {len(frames)} frames")
        return frames

    def _create_analysis_prompt(self, context: Optional[str] = None) -> str:
        """Creează promptul pentru Gemini."""
        base_prompt = """Analizează aceste frames dintr-un video și identifică cele mai bune momente pentru reels/short-form content.

Pentru fiecare grup de 2-3 frames consecutive (care reprezintă un segment de ~4-6 secunde), evaluează:

1. **Engagement Score (0-100)**: Cât de captivant e pentru social media
   - 90-100: Moment viral (acțiune intensă, emoție puternică, reveal surpriză)
   - 70-89: Foarte bun (demonstrație clară, expresie interesantă)
   - 50-69: OK (conținut decent dar nu ieșit din comun)
   - 0-49: Slab (static, boring, tranziție)

2. **Ce face segmentul interesant** (highlights)

3. **Tags**: product_demo, talking_head, action, tutorial, before_after, reveal, emotional, funny, educational

Returnează DOAR un JSON valid cu această structură:
{
  "segments": [
    {
      "frame_range": [0, 2],
      "start_time": 0.0,
      "end_time": 6.0,
      "score": 85,
      "description": "Descriere scurtă",
      "highlights": ["highlight1", "highlight2"],
      "tags": ["tag1", "tag2"]
    }
  ]
}

Grupează frames-urile în segmente logice. Returnează TOATE segmentele, nu doar cele bune."""

        if context:
            base_prompt += f"\n\nContext adițional despre video: {context}"

        return base_prompt

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
        before_sleep=lambda retry_state: logger.warning(
            f"Gemini API retry {retry_state.attempt_number}/3: {retry_state.outcome.exception()}"
        )
    )
    def _call_gemini_api(self, model: str, contents: list):
        """Call Gemini API with automatic retry on transient failures."""
        return self.client.models.generate_content(model=model, contents=contents)

    def analyze_batch(
        self,
        frames: List[Tuple[float, bytes]],
        context: Optional[str] = None
    ) -> List[AnalyzedSegment]:
        """
        Analizează un batch de frames cu Gemini.

        Args:
            frames: Lista de (timestamp, frame_bytes)
            context: Context opțional despre video

        Returns:
            Lista de AnalyzedSegment
        """
        if not frames:
            return []

        # Pregătim conținutul pentru Gemini
        contents = []

        # Adăugăm promptul
        prompt = self._create_analysis_prompt(context)
        contents.append(prompt)

        # Adăugăm fiecare frame cu timestamp
        for i, (timestamp, frame_bytes) in enumerate(frames):
            # Adăugăm text cu timestamp
            contents.append(f"\n[Frame {i} - {timestamp:.1f}s]")

            # Adăugăm imaginea
            contents.append({
                "inline_data": {
                    "mime_type": "image/jpeg",
                    "data": base64.b64encode(frame_bytes).decode()
                }
            })

        try:
            response = self._call_gemini_api(self.model_name, contents)

            # Parsăm răspunsul JSON
            response_text = response.text

            # Extragem JSON-ul din răspuns
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1

            if json_start == -1 or json_end == 0:
                logger.error(f"No JSON found in response: {response_text[:200]}")
                return []

            json_str = response_text[json_start:json_end]
            data = json.loads(json_str)

            segments = []
            for seg in data.get("segments", []):
                segments.append(AnalyzedSegment(
                    start_time=seg.get("start_time", 0),
                    end_time=seg.get("end_time", 0),
                    score=seg.get("score", 50),
                    description=seg.get("description", ""),
                    highlights=seg.get("highlights", []),
                    tags=seg.get("tags", [])
                ))

            logger.info(f"Analyzed batch: {len(segments)} segments found")
            return segments

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response as JSON: {e}")
            return []
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise

    def analyze_video(
        self,
        video_path: Path,
        context: Optional[str] = None,
        min_score: float = 0
    ) -> List[AnalyzedSegment]:
        """
        Analizează un video complet și returnează segmentele.

        Args:
            video_path: Calea către video
            context: Context opțional (ex: "tutorial de gătit", "review produs")
            min_score: Scorul minim pentru a include un segment

        Returns:
            Lista de AnalyzedSegment sortată după scor (descrescător)
        """
        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        logger.info(f"Analyzing video: {video_path}")

        # Extragem frames
        frames = self.extract_frames(video_path)

        if not frames:
            logger.warning("No frames extracted from video")
            return []

        # Procesăm în batch-uri
        all_segments = []

        for i in range(0, len(frames), self.max_frames_per_batch):
            batch = frames[i:i + self.max_frames_per_batch]
            logger.info(f"Processing batch {i // self.max_frames_per_batch + 1}")

            batch_segments = self.analyze_batch(batch, context)

            # Ajustăm timestamps pentru batch-uri ulterioare
            if i > 0 and batch_segments:
                time_offset = frames[i][0]
                for seg in batch_segments:
                    seg.start_time += time_offset
                    seg.end_time += time_offset

            all_segments.extend(batch_segments)

        # Filtrăm după scor minim
        if min_score > 0:
            all_segments = [s for s in all_segments if s.score >= min_score]

        # Sortăm după scor (descrescător)
        all_segments.sort(key=lambda s: s.score, reverse=True)

        logger.info(f"Video analysis complete: {len(all_segments)} segments")

        # Log cost - calculate duration from last frame timestamp
        try:
            from app.services.cost_tracker import get_cost_tracker
            tracker = get_cost_tracker()
            # Get video duration from the last frame's timestamp
            video_duration = frames[-1][0] + self.frame_interval if frames else 0
            tracker.log_gemini_analysis(
                job_id=video_path.stem,
                frames_analyzed=len(frames),
                video_duration=video_duration
            )
        except Exception as e:
            logger.warning(f"Failed to log cost: {e}")

        return all_segments

    def get_best_segments(
        self,
        video_path: Path,
        target_duration: float = 60.0,
        min_score: float = 60,
        context: Optional[str] = None
    ) -> List[AnalyzedSegment]:
        """
        Găsește cele mai bune segmente pentru a crea un reel de durata specificată.

        Args:
            video_path: Calea către video
            target_duration: Durata țintă pentru reel în secunde
            min_score: Scorul minim acceptat
            context: Context opțional

        Returns:
            Lista de segmente care împreună formează ~target_duration
        """
        all_segments = self.analyze_video(video_path, context, min_score)

        if not all_segments:
            return []

        # Selectăm segmente până atingem durata țintă
        selected = []
        total_duration = 0
        used_times = set()

        for seg in all_segments:
            # Verificăm să nu se suprapună cu segmente deja selectate
            seg_range = set(range(int(seg.start_time), int(seg.end_time) + 1))
            if seg_range & used_times:
                continue

            seg_duration = seg.end_time - seg.start_time
            if total_duration + seg_duration > target_duration * 1.2:  # 20% buffer
                continue

            selected.append(seg)
            total_duration += seg_duration
            used_times.update(seg_range)

            if total_duration >= target_duration:
                break

        # Sortăm cronologic pentru editare
        selected.sort(key=lambda s: s.start_time)

        logger.info(f"Selected {len(selected)} segments, total duration: {total_duration:.1f}s")
        return selected

    def segments_to_dict(self, segments: List[AnalyzedSegment]) -> List[Dict]:
        """Convertește segmentele în format dict pentru JSON/API."""
        return [asdict(seg) for seg in segments]
