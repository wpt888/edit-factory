"""
Script-to-Video Assembly Service

Orchestrates the full script-to-video pipeline:
1. Generate TTS audio with timestamps from script text
2. Apply silence removal to TTS audio
3. Generate SRT subtitles from timestamps
4. Match SRT phrases against segment library keywords
5. Build timeline to cover full audio duration
6. Assemble video from matched segments
7. Render final video with audio, subtitles, and v3 quality settings

This service bridges:
- Phase 14 (AI Script Generation)
- Phase 12 (TTS with timestamps)
- Phase 13 (Auto-SRT from timestamps)
- Manual segment selection system
- Existing render pipeline (v3 quality settings)
"""
import logging
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple, Dict

from app.config import get_settings

logger = logging.getLogger(__name__)

from app.db import get_supabase


@dataclass
class MatchResult:
    """Result of matching an SRT entry to a segment."""
    srt_index: int
    srt_text: str
    srt_start: float
    srt_end: float
    segment_id: Optional[str]
    segment_keywords: List[str]
    matched_keyword: Optional[str]
    confidence: float


@dataclass
class TimelineEntry:
    """Entry in the video timeline."""
    source_video_path: str
    start_time: float  # Within source video
    end_time: float    # Within source video
    timeline_start: float  # Position in final video
    timeline_duration: float


class AssemblyService:
    """
    Script-to-Video Assembly Service.

    Orchestrates the full pipeline from script text to final rendered video.
    """

    def __init__(self):
        self.settings = get_settings()
        self.settings.ensure_dirs()

    def _get_audio_duration(self, audio_path: Path) -> float:
        """Get audio duration in seconds using ffprobe."""
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

    def _parse_srt(self, content: str) -> List[dict]:
        """Parse SRT content into list of entries with timestamps."""
        entries = []
        blocks = content.strip().split("\n\n")

        for block in blocks:
            lines = block.strip().split("\n")
            if len(lines) >= 3:
                # Parse timestamp line (format: 00:00:01,000 --> 00:00:03,000)
                time_line = lines[1]
                if " --> " in time_line:
                    start_str, end_str = time_line.split(" --> ")
                    start_time = self._srt_time_to_seconds(start_str.strip())
                    end_time = self._srt_time_to_seconds(end_str.strip())
                    text = " ".join(lines[2:])

                    entries.append({
                        "start_time": start_time,
                        "end_time": end_time,
                        "text": text
                    })

        return entries

    def _srt_time_to_seconds(self, time_str: str) -> float:
        """Convert SRT time format to seconds."""
        try:
            # Format: 00:00:01,000 or 00:00:01.000
            time_str = time_str.replace(",", ".")
            parts = time_str.split(":")
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return hours * 3600 + minutes * 60 + seconds
        except Exception:
            return 0.0

    async def generate_tts_with_timestamps(
        self,
        script_text: str,
        profile_id: str,
        elevenlabs_model: str = "eleven_flash_v2_5"
    ) -> Tuple[Path, float, dict]:
        """
        Generate TTS audio with timestamps and apply silence removal.

        Returns:
            Tuple of (audio_path, duration, timestamps_dict)
        """
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        from app.services.silence_remover import SilenceRemover

        # Create temp directory for this assembly
        temp_dir = self.settings.base_dir / "temp" / profile_id / f"assembly_{uuid.uuid4().hex[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        # Generate TTS with timestamps (profile_id enables multi-account failover)
        tts_service = ElevenLabsTTSService(output_dir=temp_dir, model_id=elevenlabs_model, profile_id=profile_id)

        # Use the configured voice ID
        voice_id = tts_service._voice_id
        raw_audio_path = temp_dir / "tts_raw.mp3"

        logger.info(f"Generating TTS for script ({len(script_text)} chars) with model {elevenlabs_model}")

        tts_result, timestamps = await tts_service.generate_audio_with_timestamps(
            text=script_text,
            voice_id=voice_id,
            output_path=raw_audio_path,
            model_id=elevenlabs_model
        )

        # Apply silence removal (same params as _render_final_clip_task)
        logger.info("Applying silence removal to TTS audio")
        trimmed_audio_path = temp_dir / "tts_trimmed.mp3"

        silence_remover = SilenceRemover(
            min_silence_duration=0.25,
            padding=0.06
        )

        removal_result = silence_remover.remove_silence(
            audio_path=raw_audio_path,
            output_path=trimmed_audio_path
        )

        audio_duration = removal_result.new_duration

        logger.info(
            f"TTS generation complete: {audio_duration:.2f}s "
            f"(removed {removal_result.removed_duration:.2f}s silence)"
        )

        return (trimmed_audio_path, audio_duration, timestamps)

    async def generate_srt_from_timestamps(
        self,
        timestamps: dict
    ) -> str:
        """
        Generate SRT content from ElevenLabs timestamps.

        Returns:
            SRT-formatted string
        """
        from app.services.tts_subtitle_generator import generate_srt_from_timestamps

        srt_content = generate_srt_from_timestamps(timestamps)

        logger.info(f"Generated SRT with {len(srt_content.split(chr(10) + chr(10)))} entries")

        return srt_content

    def match_srt_to_segments(
        self,
        srt_entries: List[dict],
        segments_data: List[dict],
        min_confidence: float = 0.3
    ) -> List[MatchResult]:
        """
        Match SRT subtitle phrases against segment keywords.

        Args:
            srt_entries: List of {start_time, end_time, text} from SRT
            segments_data: List of segment dicts with {id, keywords, ...}
            min_confidence: Minimum confidence score to accept a match

        Returns:
            List of MatchResult objects (one per SRT entry)
        """
        matches = []

        for idx, entry in enumerate(srt_entries):
            srt_text = entry["text"]
            srt_text_lower = srt_text.lower()

            best_segment = None
            best_keyword = None
            best_confidence = 0.0

            # Find best matching segment for this SRT entry
            for segment in segments_data:
                keywords = segment.get("keywords") or []

                for keyword in keywords:
                    keyword_lower = keyword.lower()

                    # Check if keyword appears in SRT text
                    if keyword_lower in srt_text_lower:
                        # Calculate confidence
                        words = srt_text_lower.split()
                        exact_match = keyword_lower in words
                        confidence = 1.0 if exact_match else 0.7

                        # Pick best match (highest confidence, then longest duration)
                        if confidence > best_confidence:
                            best_segment = segment
                            best_keyword = keyword
                            best_confidence = confidence
                        elif confidence == best_confidence and best_segment:
                            # Tie-breaker: prefer longer segment (more visual content)
                            current_duration = segment.get("duration", 0)
                            best_duration = best_segment.get("duration", 0)
                            if current_duration > best_duration:
                                best_segment = segment
                                best_keyword = keyword

            # Create match result (may be unmatched)
            if best_segment and best_confidence >= min_confidence:
                match = MatchResult(
                    srt_index=idx,
                    srt_text=srt_text,
                    srt_start=entry["start_time"],
                    srt_end=entry["end_time"],
                    segment_id=best_segment["id"],
                    segment_keywords=best_segment.get("keywords") or [],
                    matched_keyword=best_keyword,
                    confidence=best_confidence
                )
            else:
                # Unmatched entry
                match = MatchResult(
                    srt_index=idx,
                    srt_text=srt_text,
                    srt_start=entry["start_time"],
                    srt_end=entry["end_time"],
                    segment_id=None,
                    segment_keywords=[],
                    matched_keyword=None,
                    confidence=0.0
                )

            matches.append(match)

        matched_count = sum(1 for m in matches if m.segment_id is not None)
        logger.info(f"Matched {matched_count}/{len(matches)} SRT entries to segments")

        return matches

    def build_timeline(
        self,
        match_results: List[MatchResult],
        segments_data: List[dict],
        audio_duration: float
    ) -> List[TimelineEntry]:
        """
        Build video timeline from match results.

        Arranges matched segments sequentially to cover full audio duration.
        For unmatched entries, uses fallback segments (first available or loop).

        Args:
            match_results: List of MatchResult from matching step
            segments_data: Full segment data for lookup
            audio_duration: Total audio duration to cover

        Returns:
            List of TimelineEntry objects
        """
        timeline = []

        if not match_results:
            logger.warning("No SRT entries to build timeline from")
            return timeline

        # Build segment lookup
        segment_lookup = {seg["id"]: seg for seg in segments_data}

        # Get fallback segment (first available)
        fallback_segment = segments_data[0] if segments_data else None

        current_timeline_pos = 0.0

        for match in match_results:
            # Determine which segment to use
            if match.segment_id and match.segment_id in segment_lookup:
                segment = segment_lookup[match.segment_id]
            elif fallback_segment:
                segment = fallback_segment
                logger.debug(f"Using fallback segment for unmatched SRT entry: '{match.srt_text}'")
            else:
                logger.warning(f"No segment available for SRT entry: '{match.srt_text}'")
                continue

            # Calculate duration needed for this SRT entry
            needed_duration = match.srt_end - match.srt_start

            # Get segment video path from source_video_id
            source_video_path = segment.get("source_video_path")
            segment_start = segment.get("start_time", 0.0)
            segment_end = segment.get("end_time", segment_start + needed_duration)
            segment_duration = segment_end - segment_start

            # Trim or extend segment to match needed duration
            if segment_duration >= needed_duration:
                # Segment is long enough, trim it
                use_end = segment_start + needed_duration
            else:
                # Segment is too short, use full segment (will be extended/looped later)
                use_end = segment_end

            timeline_entry = TimelineEntry(
                source_video_path=source_video_path,
                start_time=segment_start,
                end_time=use_end,
                timeline_start=current_timeline_pos,
                timeline_duration=needed_duration
            )

            timeline.append(timeline_entry)
            current_timeline_pos += needed_duration

        # Handle gap between last SRT entry and audio end
        if current_timeline_pos < audio_duration:
            gap = audio_duration - current_timeline_pos
            logger.info(f"Extending timeline by {gap:.2f}s to match audio duration")

            # Extend last segment or loop fallback
            if timeline and fallback_segment:
                last_segment = fallback_segment
                source_video_path = last_segment.get("source_video_path")
                segment_start = last_segment.get("start_time", 0.0)
                segment_end = last_segment.get("end_time", segment_start + gap)

                gap_entry = TimelineEntry(
                    source_video_path=source_video_path,
                    start_time=segment_start,
                    end_time=min(segment_end, segment_start + gap),
                    timeline_start=current_timeline_pos,
                    timeline_duration=gap
                )
                timeline.append(gap_entry)

        total_duration = sum(e.timeline_duration for e in timeline)
        logger.info(f"Built timeline with {len(timeline)} entries, total duration: {total_duration:.2f}s")

        return timeline

    def assemble_video(
        self,
        timeline: List[TimelineEntry],
        temp_dir: Path
    ) -> Path:
        """
        Assemble video from timeline using FFmpeg.

        Extracts each segment, concatenates them, and trims to exact duration.

        Args:
            timeline: List of TimelineEntry objects
            temp_dir: Temporary directory for intermediate files

        Returns:
            Path to assembled video (no audio, just video track)
        """
        if not timeline:
            raise ValueError("Timeline is empty, cannot assemble video")

        segment_files = []

        # Extract each segment clip
        for i, entry in enumerate(timeline):
            segment_file = temp_dir / f"segment_{i:03d}.mp4"

            duration = entry.end_time - entry.start_time

            cmd = [
                "ffmpeg", "-y",
                "-ss", str(entry.start_time),
                "-i", entry.source_video_path,
                "-t", str(duration),
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-an",  # No audio
                "-pix_fmt", "yuv420p",
                str(segment_file)
            ]

            logger.debug(f"Extracting segment {i}: {entry.source_video_path} [{entry.start_time:.2f}s - {entry.end_time:.2f}s]")

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0 and segment_file.exists():
                segment_files.append(segment_file)
            else:
                logger.error(f"Failed to extract segment {i}: {result.stderr}")

        if not segment_files:
            raise RuntimeError("No segments were extracted successfully")

        # Create concat list file
        concat_file = temp_dir / "concat_list.txt"
        with open(concat_file, 'w', encoding='utf-8') as f:
            for seg_file in segment_files:
                # Escape single quotes for FFmpeg
                escaped = str(seg_file).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")

        # Concatenate all clips
        assembled_path = temp_dir / "assembled_video.mp4"

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            str(assembled_path)
        ]

        logger.info(f"Concatenating {len(segment_files)} segments")

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg concatenation failed: {result.stderr}")

        logger.info(f"Video assembly complete: {assembled_path}")

        return assembled_path

    async def assemble_and_render(
        self,
        script_text: str,
        profile_id: str,
        preset_data: dict,
        subtitle_settings: Optional[dict] = None,
        elevenlabs_model: str = "eleven_flash_v2_5",
        enable_denoise: bool = False,
        denoise_strength: float = 2.0,
        enable_sharpen: bool = False,
        sharpen_amount: float = 0.5,
        enable_color: bool = False,
        brightness: float = 0.0,
        contrast: float = 1.0,
        saturation: float = 1.0,
        shadow_depth: int = 0,
        enable_glow: bool = False,
        glow_blur: int = 0,
        adaptive_sizing: bool = False
    ) -> Path:
        """
        Full pipeline: TTS -> SRT -> match -> timeline -> assemble -> render.

        Returns:
            Path to final rendered video
        """
        # Import render function at call time to avoid circular imports
        from app.api.library_routes import _render_with_preset

        supabase = get_supabase()
        if not supabase:
            raise RuntimeError("Supabase not available")

        # Create temp directory
        temp_dir = self.settings.base_dir / "temp" / profile_id / f"assembly_{uuid.uuid4().hex[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            # Step 1: Generate TTS with timestamps
            logger.info("Step 1/7: Generating TTS audio with timestamps")
            audio_path, audio_duration, timestamps = await self.generate_tts_with_timestamps(
                script_text=script_text,
                profile_id=profile_id,
                elevenlabs_model=elevenlabs_model
            )

            # Step 2: Generate SRT from timestamps (with cache)
            logger.info("Step 2/7: Generating SRT subtitles from timestamps")
            from app.services.tts_cache import srt_cache_lookup, srt_cache_store
            _srt_cache_key = {"text": script_text, "voice_id": "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
            cached_srt = srt_cache_lookup(_srt_cache_key)
            if cached_srt:
                srt_content = cached_srt
            else:
                srt_content = await self.generate_srt_from_timestamps(timestamps)
                if srt_content:
                    srt_cache_store(_srt_cache_key, srt_content)

            srt_path = temp_dir / "subtitles.srt"
            with open(srt_path, 'w', encoding='utf-8') as f:
                f.write(srt_content)

            # Auto-save to TTS Library (non-blocking)
            try:
                from app.services.tts_library_service import get_tts_library_service
                tts_lib = get_tts_library_service()
                tts_lib.save_from_pipeline(
                    profile_id=profile_id,
                    text=script_text,
                    audio_path=str(audio_path),
                    srt_content=srt_content,
                    timestamps=timestamps,
                    model=elevenlabs_model,
                    duration=audio_duration,
                )
            except Exception as e:
                logger.warning(f"Failed to save TTS to library: {e}")

            # Step 3: Parse SRT
            logger.info("Step 3/7: Parsing SRT entries")
            srt_entries = self._parse_srt(srt_content)

            # Step 4: Fetch segments from database
            logger.info("Step 4/7: Fetching segments from library")
            segments_result = supabase.table("editai_segments")\
                .select("id, source_video_id, start_time, end_time, keywords, editai_source_videos(file_path)")\
                .eq("profile_id", profile_id)\
                .execute()

            if not segments_result.data:
                raise RuntimeError("No segments found in library. Please create segments first.")

            # Build segments data with source video paths
            segments_data = []
            for seg in segments_result.data:
                source_video_path = seg.get("editai_source_videos", {}).get("file_path")
                if source_video_path:
                    segments_data.append({
                        "id": seg["id"],
                        "source_video_id": seg["source_video_id"],
                        "start_time": seg["start_time"],
                        "end_time": seg["end_time"],
                        "duration": seg["end_time"] - seg["start_time"],
                        "keywords": seg.get("keywords") or [],
                        "source_video_path": source_video_path
                    })

            logger.info(f"Loaded {len(segments_data)} segments from library")

            # Step 5: Match SRT to segments
            logger.info("Step 5/7: Matching SRT phrases to segments")
            match_results = self.match_srt_to_segments(
                srt_entries=srt_entries,
                segments_data=segments_data,
                min_confidence=0.3
            )

            # Step 6: Build timeline
            logger.info("Step 6/7: Building video timeline")
            timeline = self.build_timeline(
                match_results=match_results,
                segments_data=segments_data,
                audio_duration=audio_duration
            )

            # Step 7: Assemble video
            logger.info("Step 7/7: Assembling and rendering final video")
            assembled_video_path = self.assemble_video(
                timeline=timeline,
                temp_dir=temp_dir
            )

            # Render with preset and subtitle settings
            output_dir = self.settings.output_dir / profile_id
            output_dir.mkdir(parents=True, exist_ok=True)

            final_output_path = output_dir / f"assembly_{uuid.uuid4().hex[:8]}_{preset_data['name']}.mp4"

            _render_with_preset(
                video_path=assembled_video_path,
                audio_path=audio_path,
                srt_path=srt_path,
                subtitle_settings=subtitle_settings,
                preset=preset_data,
                output_path=final_output_path,
                enable_denoise=enable_denoise,
                denoise_strength=denoise_strength,
                enable_sharpen=enable_sharpen,
                sharpen_amount=sharpen_amount,
                enable_color=enable_color,
                brightness=brightness,
                contrast=contrast,
                saturation=saturation
            )

            logger.info(f"Assembly complete: {final_output_path}")

            return final_output_path

        except Exception as e:
            logger.error(f"Assembly failed: {e}")
            raise

    async def preview_matches(
        self,
        script_text: str,
        profile_id: str,
        elevenlabs_model: str = "eleven_flash_v2_5"
    ) -> dict:
        """
        Preview-only: TTS -> SRT -> match -> timeline (no rendering).

        Returns preview data showing matches and timeline without expensive render.

        Returns:
            Dict with {audio_path, audio_duration, srt_content, matches, timeline, unmatched_count, total_phrases}
        """
        supabase = get_supabase()
        if not supabase:
            raise RuntimeError("Supabase not available")

        # Step 1: Generate TTS with timestamps
        logger.info("Preview Step 1/4: Generating TTS audio")
        audio_path, audio_duration, timestamps = await self.generate_tts_with_timestamps(
            script_text=script_text,
            profile_id=profile_id,
            elevenlabs_model=elevenlabs_model
        )

        # Step 2: Generate SRT (with cache)
        logger.info("Preview Step 2/4: Generating SRT subtitles")
        from app.services.tts_cache import srt_cache_lookup, srt_cache_store
        _srt_cache_key = {"text": script_text, "voice_id": "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
        cached_srt = srt_cache_lookup(_srt_cache_key)
        if cached_srt:
            srt_content = cached_srt
        else:
            srt_content = await self.generate_srt_from_timestamps(timestamps)
            if srt_content:
                srt_cache_store(_srt_cache_key, srt_content)
        srt_entries = self._parse_srt(srt_content)

        # Step 3: Fetch segments
        logger.info("Preview Step 3/4: Fetching segments from library")
        segments_result = supabase.table("editai_segments")\
            .select("id, source_video_id, start_time, end_time, keywords, editai_source_videos(file_path)")\
            .eq("profile_id", profile_id)\
            .execute()

        if not segments_result.data:
            raise RuntimeError("No segments found in library. Please create segments first.")

        segments_data = []
        for seg in segments_result.data:
            source_video_path = seg.get("editai_source_videos", {}).get("file_path")
            if source_video_path:
                segments_data.append({
                    "id": seg["id"],
                    "source_video_id": seg["source_video_id"],
                    "start_time": seg["start_time"],
                    "end_time": seg["end_time"],
                    "duration": seg["end_time"] - seg["start_time"],
                    "keywords": seg.get("keywords") or [],
                    "source_video_path": source_video_path
                })

        # Step 4: Match and build timeline
        logger.info("Preview Step 4/4: Matching and building timeline")
        match_results = self.match_srt_to_segments(
            srt_entries=srt_entries,
            segments_data=segments_data,
            min_confidence=0.3
        )

        timeline = self.build_timeline(
            match_results=match_results,
            segments_data=segments_data,
            audio_duration=audio_duration
        )

        # Count matched vs unmatched
        matched_count = sum(1 for m in match_results if m.segment_id is not None)
        unmatched_count = len(match_results) - matched_count

        # Convert to serializable format
        matches_data = [
            {
                "srt_index": m.srt_index,
                "srt_text": m.srt_text,
                "srt_start": m.srt_start,
                "srt_end": m.srt_end,
                "segment_id": m.segment_id,
                "segment_keywords": m.segment_keywords,
                "matched_keyword": m.matched_keyword,
                "confidence": m.confidence
            }
            for m in match_results
        ]

        timeline_data = [
            {
                "source_video_path": e.source_video_path,
                "start_time": e.start_time,
                "end_time": e.end_time,
                "timeline_start": e.timeline_start,
                "timeline_duration": e.timeline_duration
            }
            for e in timeline
        ]

        return {
            "audio_path": str(audio_path),
            "audio_duration": audio_duration,
            "srt_content": srt_content,
            "matches": matches_data,
            "timeline": timeline_data,
            "total_phrases": len(match_results),
            "matched_count": matched_count,
            "unmatched_count": unmatched_count
        }


# Singleton instance
_assembly_service = None

def get_assembly_service() -> AssemblyService:
    """Get singleton AssemblyService instance."""
    global _assembly_service
    if _assembly_service is None:
        _assembly_service = AssemblyService()
    return _assembly_service
