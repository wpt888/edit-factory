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
import asyncio
import logging
import random
import re
import subprocess
import tempfile
import threading
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
    is_auto_filled: bool = False
    product_group: Optional[str] = None
    source_video_id: Optional[str] = None
    segment_start_time: Optional[float] = None
    segment_end_time: Optional[float] = None
    thumbnail_path: Optional[str] = None


@dataclass
class TimelineEntry:
    """Entry in the video timeline."""
    source_video_path: str
    start_time: float  # Within source video
    end_time: float    # Within source video
    timeline_start: float  # Position in final video
    timeline_duration: float
    transforms: Optional[dict] = None  # Per-segment visual transforms


def strip_product_group_tags(text: str) -> str:
    """Remove [ProductGroup] tags from script text, leaving only speakable content."""
    return re.sub(r'\[([^\[\]]+)\]', '', text).strip()


def build_word_to_group_map(text: str) -> List[Optional[str]]:
    """Map each word (after tag removal) to its product group (or None).

    Tags like [iPhone 15] set the current group for all words that follow
    until the next tag appears.

    Returns a list parallel to the cleaned words (tags excluded).
    """
    current_group: Optional[str] = None
    word_groups: List[Optional[str]] = []
    tag_pattern = re.compile(r'\[([^\[\]]+)\]')

    # Process text token by token, tracking current group
    pos = 0
    while pos < len(text):
        tag_match = tag_pattern.match(text, pos)
        if tag_match:
            current_group = tag_match.group(1).strip()
            pos = tag_match.end()
            continue

        # Find next non-whitespace run (a word)
        ws_match = re.match(r'\s+', text[pos:])
        if ws_match:
            pos += ws_match.end()
            continue

        # Find end of word (up to whitespace or tag)
        word_end = pos
        while word_end < len(text) and not text[word_end].isspace() and text[word_end] != '[':
            word_end += 1

        if word_end > pos:
            word_groups.append(current_group)
            pos = word_end
        else:
            pos += 1

    return word_groups


def assign_groups_to_srt(
    script_text: str,
    srt_entries: List[dict]
) -> List[Optional[str]]:
    """Assign a product_group to each SRT entry based on word-index mapping.

    Uses build_word_to_group_map to figure out which group each word belongs to,
    then maps SRT entries (which contain subsets of words) to groups by finding
    the majority group of the words in each entry.

    Returns a list parallel to srt_entries.
    """
    word_groups = build_word_to_group_map(script_text)
    if not word_groups or not any(g is not None for g in word_groups):
        return [None] * len(srt_entries)

    cleaned_text = strip_product_group_tags(script_text)
    cleaned_words = cleaned_text.split()

    # Build a simple word-position tracker: for each SRT entry, find which
    # cleaned words it covers by sequential matching
    srt_groups: List[Optional[str]] = []
    word_cursor = 0

    for entry in srt_entries:
        entry_words = entry["text"].split()
        entry_group_counts: Dict[Optional[str], int] = {}

        for ew in entry_words:
            ew_lower = ew.strip(".,!?;:\"'").lower()
            # Scan forward in cleaned_words to find this word
            found = False
            for scan_idx in range(word_cursor, min(word_cursor + 10, len(cleaned_words))):
                cw_lower = cleaned_words[scan_idx].strip(".,!?;:\"'").lower()
                if cw_lower == ew_lower:
                    if scan_idx < len(word_groups):
                        g = word_groups[scan_idx]
                        entry_group_counts[g] = entry_group_counts.get(g, 0) + 1
                    word_cursor = scan_idx + 1
                    found = True
                    break

            if not found:
                # Word not found in lookahead; try broader scan
                for scan_idx in range(word_cursor, len(cleaned_words)):
                    cw_lower = cleaned_words[scan_idx].strip(".,!?;:\"'").lower()
                    if cw_lower == ew_lower:
                        if scan_idx < len(word_groups):
                            g = word_groups[scan_idx]
                            entry_group_counts[g] = entry_group_counts.get(g, 0) + 1
                        word_cursor = scan_idx + 1
                        break

        # Pick majority group (ignoring None)
        non_none = {k: v for k, v in entry_group_counts.items() if k is not None}
        if non_none:
            srt_groups.append(max(non_none, key=non_none.get))  # type: ignore
        elif entry_group_counts:
            srt_groups.append(None)
        else:
            # Inherit from previous entry
            srt_groups.append(srt_groups[-1] if srt_groups else None)

    return srt_groups


class AssemblyService:
    """
    Script-to-Video Assembly Service.

    Orchestrates the full pipeline from script text to final rendered video.
    """

    def __init__(self):
        self.settings = get_settings()
        self.settings.ensure_dirs()

    async def _get_audio_duration(self, audio_path: Path) -> float:
        """Get audio duration in seconds using ffprobe."""
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path)
            ]
            result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=300)
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
        elevenlabs_model: str = "eleven_flash_v2_5",
        voice_id: Optional[str] = None,
        voice_settings: Optional[dict] = None
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

        # Use provided voice ID or fall back to configured default
        voice_id = voice_id or tts_service._voice_id
        raw_audio_path = temp_dir / "tts_raw.mp3"

        logger.info(f"Generating TTS for script ({len(script_text)} chars) with model {elevenlabs_model}")

        tts_result, timestamps = await tts_service.generate_audio_with_timestamps(
            text=script_text,
            voice_id=voice_id,
            output_path=raw_audio_path,
            model_id=elevenlabs_model,
            **(voice_settings or {})
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

        # Remap timestamps to match trimmed audio (fix SRT-audio desync)
        if removal_result.segments_map and removal_result.removed_duration > 0.01:
            from app.services.tts_subtitle_generator import remap_timestamps_dict
            timestamps = remap_timestamps_dict(timestamps, removal_result.segments_map)
            logger.info(
                f"Remapped {len(timestamps.get('characters', []))} character timestamps "
                f"to match trimmed audio"
            )
        elif removal_result.removed_duration > 0.01:
            logger.warning(
                "Silence was removed but no segments_map available (FFmpeg fallback) — "
                "SRT timestamps may be slightly desynchronized"
            )

        logger.info(
            f"TTS generation complete: {audio_duration:.2f}s "
            f"(removed {removal_result.removed_duration:.2f}s silence)"
        )

        return (trimmed_audio_path, audio_duration, timestamps)

    async def generate_srt_from_timestamps(
        self,
        timestamps: dict,
        max_words_per_phrase: int = 2
    ) -> str:
        """
        Generate SRT content from ElevenLabs timestamps.

        Args:
            timestamps: ElevenLabs alignment dict
            max_words_per_phrase: Max words per subtitle entry (default: 2)

        Returns:
            SRT-formatted string
        """
        from app.services.tts_subtitle_generator import generate_srt_from_timestamps

        srt_content = generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase)

        logger.info(f"Generated SRT with {len(srt_content.split(chr(10) + chr(10)))} entries")

        return srt_content

    def match_srt_to_segments(
        self,
        srt_entries: List[dict],
        segments_data: List[dict],
        min_confidence: float = 0.3,
        variant_index: int = 0,
        srt_product_groups: Optional[List[Optional[str]]] = None
    ) -> List[MatchResult]:
        """
        Match SRT subtitle phrases against segment keywords.

        Args:
            srt_entries: List of {start_time, end_time, text} from SRT
            segments_data: List of segment dicts with {id, keywords, ...}
            min_confidence: Minimum confidence score to accept a match
            variant_index: Used to seed randomization for tied matches,
                           giving each variant different segment selections.
            srt_product_groups: Optional list (parallel to srt_entries) of product
                                group labels from script tags. When set for an entry,
                                only segments from that group are considered.

        Returns:
            List of MatchResult objects (one per SRT entry)
        """
        matches = []
        current_product_group = None  # Track product group context across SRT entries
        prev_segment_id = None  # Track previous segment to avoid consecutive duplicates
        variant_rng = random.Random(variant_index)  # Seeded RNG for variant differentiation

        for idx, entry in enumerate(srt_entries):
            srt_text = entry["text"]
            srt_text_lower = srt_text.lower()

            # If this SRT entry has a forced product group from tags, filter segments
            forced_group = srt_product_groups[idx] if srt_product_groups and idx < len(srt_product_groups) else None
            if forced_group:
                group_segments = [s for s in segments_data if s.get("product_group") == forced_group]
                if not group_segments:
                    logger.warning(f"No segments found for forced group '{forced_group}', falling back to all segments")
                    search_segments = segments_data
                else:
                    search_segments = group_segments
            else:
                search_segments = segments_data

            # Collect all candidates with their confidence scores
            candidates = []

            # Find all matching segments for this SRT entry
            for segment in search_segments:
                keywords = segment.get("keywords") or []

                for keyword in keywords:
                    keyword_lower = keyword.lower()

                    # Check if keyword appears in SRT text
                    if keyword_lower in srt_text_lower:
                        # Calculate confidence
                        words = srt_text_lower.split()
                        exact_match = keyword_lower in words
                        confidence = 1.0 if exact_match else 0.7

                        # Product group label boost: if keyword matches a product group label
                        seg_group = segment.get("product_group")
                        if seg_group and keyword_lower == seg_group.lower():
                            confidence += 0.5

                        # Context affinity: prefer segments from the current product group
                        if current_product_group and seg_group == current_product_group:
                            confidence += 0.2

                        candidates.append((segment, keyword, confidence))

            # Among top candidates (within 0.1 of best), pick using variant-seeded RNG
            best_segment = None
            best_keyword = None
            best_confidence = 0.0
            runner_up_segment = None
            runner_up_keyword = None
            runner_up_confidence = 0.0

            if candidates:
                # Sort by confidence descending
                candidates.sort(key=lambda c: c[2], reverse=True)
                top_confidence = candidates[0][2]

                # Gather near-tied candidates (within 0.1 of best)
                top_candidates = [c for c in candidates if c[2] >= top_confidence - 0.1]

                # Use variant-seeded RNG to pick among near-tied candidates
                if len(top_candidates) > 1:
                    chosen = variant_rng.choice(top_candidates)
                else:
                    chosen = top_candidates[0]

                best_segment, best_keyword, best_confidence = chosen

                # Find runner-up (best candidate that isn't the chosen one)
                for c in candidates:
                    if c[0]["id"] != best_segment["id"]:
                        runner_up_segment, runner_up_keyword, runner_up_confidence = c
                        break

            # Avoid consecutive duplicate: if best is same as previous, use runner-up
            if (best_segment and best_segment["id"] == prev_segment_id
                    and runner_up_segment and runner_up_confidence >= min_confidence):
                best_segment = runner_up_segment
                best_keyword = runner_up_keyword
                best_confidence = runner_up_confidence

            # Create match result (may be unmatched)
            if best_segment and best_confidence >= min_confidence:
                seg_group = best_segment.get("product_group")
                match = MatchResult(
                    srt_index=idx,
                    srt_text=srt_text,
                    srt_start=entry["start_time"],
                    srt_end=entry["end_time"],
                    segment_id=best_segment["id"],
                    segment_keywords=best_segment.get("keywords") or [],
                    matched_keyword=best_keyword,
                    confidence=best_confidence,
                    product_group=seg_group,
                    source_video_id=best_segment.get("source_video_id"),
                    segment_start_time=best_segment.get("start_time"),
                    segment_end_time=best_segment.get("end_time"),
                    thumbnail_path=best_segment.get("thumbnail_path"),
                )
                # Update context trackers
                prev_segment_id = best_segment["id"]
                if seg_group:
                    current_product_group = seg_group
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

        # Auto-fill unmatched entries — prefer segments from current/nearest product group
        if segments_data:
            unmatched_indices = [i for i, m in enumerate(matches) if m.segment_id is None]
            if unmatched_indices:
                rng = random.Random(variant_index)

                for um_idx in unmatched_indices:
                    # If forced group from tags, use that strictly
                    forced_group = srt_product_groups[um_idx] if srt_product_groups and um_idx < len(srt_product_groups) else None

                    if forced_group:
                        nearest_group = forced_group
                    else:
                        # Find nearest product group context
                        nearest_group = None
                        for offset in range(1, len(matches)):
                            for check_idx in [um_idx - offset, um_idx + offset]:
                                if 0 <= check_idx < len(matches) and matches[check_idx].product_group:
                                    nearest_group = matches[check_idx].product_group
                                    break
                            if nearest_group:
                                break

                    # Build pool: prefer segments from nearest group
                    if nearest_group:
                        group_pool = [s for s in segments_data if s.get("product_group") == nearest_group]
                        pool = group_pool if group_pool else list(segments_data)
                    else:
                        pool = list(segments_data)

                    # Avoid consecutive duplicate: exclude previous segment from pool
                    prev_seg_id = matches[um_idx - 1].segment_id if um_idx > 0 else None
                    if prev_seg_id and len(pool) > 1:
                        pool = [s for s in pool if s["id"] != prev_seg_id]

                    rng.shuffle(pool)
                    seg = pool[0]
                    matches[um_idx] = MatchResult(
                        srt_index=matches[um_idx].srt_index,
                        srt_text=matches[um_idx].srt_text,
                        srt_start=matches[um_idx].srt_start,
                        srt_end=matches[um_idx].srt_end,
                        segment_id=seg["id"],
                        segment_keywords=seg.get("keywords") or [],
                        matched_keyword=None,
                        confidence=0.0,
                        is_auto_filled=True,
                        product_group=seg.get("product_group"),
                        source_video_id=seg.get("source_video_id"),
                        segment_start_time=seg.get("start_time"),
                        segment_end_time=seg.get("end_time"),
                        thumbnail_path=seg.get("thumbnail_path"),
                    )
                logger.info(f"Auto-filled {len(unmatched_indices)} unmatched entries (seed={variant_index})")

        matched_count = sum(1 for m in matches if m.segment_id is not None)
        logger.info(f"Matched {matched_count}/{len(matches)} SRT entries to segments")

        return matches

    def build_timeline(
        self,
        match_results: List[MatchResult],
        segments_data: List[dict],
        audio_duration: float,
        duration_overrides: Optional[List[Optional[float]]] = None,
        variant_index: int = 0
    ) -> List[TimelineEntry]:
        """
        Build video timeline from match results.

        Arranges matched segments sequentially to cover full audio duration.
        For unmatched entries, uses fallback segments (first available or loop).

        Args:
            match_results: List of MatchResult from matching step
            segments_data: Full segment data for lookup
            audio_duration: Total audio duration to cover
            duration_overrides: Optional list (parallel to match_results) of user-adjusted
                                 durations in seconds. None at a position means use natural SRT
                                 duration for that entry.

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

        for idx, match in enumerate(match_results):
            # Determine which segment to use
            if match.segment_id and match.segment_id in segment_lookup:
                segment = segment_lookup[match.segment_id]
            elif fallback_segment:
                segment = fallback_segment
                logger.debug(f"Using fallback segment for unmatched SRT entry: '{match.srt_text}'")
            else:
                logger.warning(f"No segment available for SRT entry: '{match.srt_text}'")
                continue

            # Calculate duration needed for this SRT entry (user override takes priority)
            override = (
                duration_overrides[idx]
                if duration_overrides and idx < len(duration_overrides)
                else None
            )
            needed_duration = override if override else (match.srt_end - match.srt_start)

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
                timeline_duration=needed_duration,
                transforms=segment.get("transforms"),
            )

            timeline.append(timeline_entry)
            current_timeline_pos += needed_duration

        # Handle gap between last SRT entry and audio end
        if current_timeline_pos < audio_duration:
            gap = audio_duration - current_timeline_pos
            logger.info(f"Extending timeline by {gap:.2f}s to match audio duration")

            # Use seeded random segment for gap fill (varies per variant)
            if timeline and segments_data:
                rng = random.Random(variant_index + 1000)
                gap_segment = rng.choice(segments_data)
                last_segment = gap_segment
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

    async def assemble_video(
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

        # Target output dimensions (portrait)
        target_w, target_h = 1080, 1920

        # Extract each segment clip (with optional per-segment transforms)
        from app.services.segment_transforms import SegmentTransform

        for i, entry in enumerate(timeline):
            segment_file = temp_dir / f"segment_{i:03d}.mp4"

            segment_duration = entry.end_time - entry.start_time
            needed_duration = entry.timeline_duration

            # Build per-segment transform filters
            transform = SegmentTransform.from_dict(entry.transforms)
            transform_filters = transform.to_ffmpeg_filters(width=target_w, height=target_h)

            # Always force consistent portrait dimensions, even without transforms
            # Use increase+crop to fill frame (no black bars) instead of decrease+pad
            if not transform_filters:
                transform_filters = [
                    f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase",
                    f"crop={target_w}:{target_h}",
                ]

            # When segment is shorter than needed, loop it to fill the duration
            use_loop = segment_duration < needed_duration - 0.05

            cmd = ["ffmpeg", "-y"]

            if use_loop:
                # Loop the segment seamlessly to fill needed duration
                cmd.extend(["-stream_loop", "-1"])

            cmd.extend([
                "-ss", str(entry.start_time),
                "-i", entry.source_video_path,
                "-t", str(needed_duration if use_loop else segment_duration),
                "-vf", ",".join(transform_filters),
            ])

            cmd.extend([
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-an",
                "-pix_fmt", "yuv420p",
                str(segment_file)
            ])

            logger.debug(f"Extracting segment {i}: {entry.source_video_path} [{entry.start_time:.2f}s - {entry.end_time:.2f}s]")

            result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=600)
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

        result = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, text=True, timeout=600)
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
        voice_id: Optional[str] = None,
        source_video_ids: Optional[List[str]] = None,
        match_overrides: Optional[List[dict]] = None,
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
        adaptive_sizing: bool = False,
        variant_index: int = 0,
        voice_settings: Optional[dict] = None,
        reuse_audio_path: Optional[str] = None,
        reuse_audio_duration: Optional[float] = None,
        reuse_srt_content: Optional[str] = None,
        on_progress=None,  # Optional[Callable[[str, int], None]]
        max_words_per_phrase: int = 2
    ) -> Path:
        """
        Full pipeline: TTS -> SRT -> match -> timeline -> assemble -> render.

        Args:
            match_overrides: Optional list of match dicts from the timeline editor.
                             When provided, replaces automatic segment matching (Step 5).
                             Each dict has the same shape as MatchResult with an optional
                             duration_override field.
            reuse_audio_path: Path to existing TTS audio to reuse (skips TTS generation).
            reuse_audio_duration: Duration of the reused audio.
            reuse_srt_content: SRT content to reuse with the audio.

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

        def _report(step_name: str, pct: int):
            """Fire progress callback if provided."""
            if on_progress:
                try:
                    on_progress(step_name, pct)
                except Exception:
                    pass

        try:
            # Strip [ProductGroup] tags before TTS (tags must not be spoken)
            cleaned_text = strip_product_group_tags(script_text)

            # Step 1: Generate TTS with timestamps (or reuse existing)
            skip_library_save = False
            if reuse_audio_path and reuse_audio_duration and Path(reuse_audio_path).exists():
                logger.info("Step 1/7: Reusing existing TTS audio (library or cached)")
                audio_path = Path(reuse_audio_path)
                audio_duration = reuse_audio_duration
                timestamps = {}
                skip_library_save = True
                _report("Reusing cached TTS audio", 20)
            else:
                logger.info("Step 1/7: Generating TTS audio with timestamps")
                _report("Generating TTS audio", 10)
                audio_path, audio_duration, timestamps = await self.generate_tts_with_timestamps(
                    script_text=cleaned_text,
                    profile_id=profile_id,
                    elevenlabs_model=elevenlabs_model,
                    voice_id=voice_id,
                    voice_settings=voice_settings
                )
                _report("TTS audio ready", 25)

            # Step 2: Generate SRT from timestamps (with cache — use cleaned text for cache key)
            logger.info("Step 2/7: Generating SRT subtitles from timestamps")
            _report("Generating subtitles", 30)
            if reuse_srt_content and skip_library_save:
                srt_content = reuse_srt_content
                logger.info("Step 2/7: Reusing existing SRT content")
            else:
                from app.services.tts_cache import srt_cache_lookup, srt_cache_store
                _srt_cache_key = {"text": cleaned_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
                cached_srt = srt_cache_lookup(_srt_cache_key)
                if cached_srt:
                    srt_content = cached_srt
                elif timestamps:
                    srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase)
                    if srt_content:
                        srt_cache_store(_srt_cache_key, srt_content)
                else:
                    # Reusing audio but no SRT available — must regenerate TTS for timestamps
                    logger.info("Step 2/7: SRT not available, regenerating TTS for timestamps")
                    _, _, timestamps = await self.generate_tts_with_timestamps(
                        script_text=cleaned_text,
                        profile_id=profile_id,
                        elevenlabs_model=elevenlabs_model,
                        voice_id=voice_id,
                        voice_settings=voice_settings
                    )
                    srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase)

            srt_path = temp_dir / "subtitles.srt"
            with open(srt_path, 'w', encoding='utf-8') as f:
                f.write(srt_content)

            # Auto-save to TTS Library (non-blocking, skip if reusing library audio)
            if not skip_library_save:
                try:
                    from app.services.tts_library_service import get_tts_library_service
                    tts_lib = get_tts_library_service()
                    tts_lib.save_from_pipeline(
                        profile_id=profile_id,
                        text=cleaned_text,
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
            _report("Fetching segments from library", 40)
            if source_video_ids:
                logger.info(f"Filtering to {len(source_video_ids)} source video(s)")
            segments_query = supabase.table("editai_segments")\
                .select("id, source_video_id, start_time, end_time, keywords, transforms, product_group, editai_source_videos(file_path)")\
                .eq("profile_id", profile_id)
            if source_video_ids:
                segments_query = segments_query.in_("source_video_id", source_video_ids)
            segments_result = segments_query.execute()

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
                        "source_video_path": source_video_path,
                        "transforms": seg.get("transforms"),
                        "product_group": seg.get("product_group"),
                    })

            logger.info(f"Loaded {len(segments_data)} segments from library")

            if not segments_data:
                raise RuntimeError(
                    "No usable segments found — all segments are missing source video file paths. "
                    "Please re-upload source videos or re-create segments."
                )

            # Assign product groups from script tags to SRT entries
            srt_product_groups = assign_groups_to_srt(script_text, srt_entries)

            # Step 5: Match SRT to segments (or apply timeline editor overrides)
            _report("Matching segments to script", 50)
            if match_overrides:
                logger.info(
                    f"Step 5/7: Applying {len(match_overrides)} match overrides from timeline editor"
                )
                match_results = [
                    MatchResult(
                        srt_index=m["srt_index"],
                        srt_text=m["srt_text"],
                        srt_start=m["srt_start"],
                        srt_end=m["srt_end"],
                        segment_id=m.get("segment_id"),
                        segment_keywords=m.get("segment_keywords") or [],
                        matched_keyword=m.get("matched_keyword"),
                        confidence=m.get("confidence", 0.0),
                    )
                    for m in match_overrides
                ]
                # Extract duration overrides (parallel list, None where not overridden)
                duration_overrides = [m.get("duration_override") for m in match_overrides]
            else:
                logger.info("Step 5/7: Matching SRT phrases to segments")
                match_results = self.match_srt_to_segments(
                    srt_entries=srt_entries,
                    segments_data=segments_data,
                    min_confidence=0.3,
                    variant_index=variant_index,
                    srt_product_groups=srt_product_groups
                )
                duration_overrides = None

            # Step 6: Build timeline
            logger.info("Step 6/7: Building video timeline")
            _report("Building video timeline", 60)
            timeline = self.build_timeline(
                match_results=match_results,
                segments_data=segments_data,
                audio_duration=audio_duration,
                duration_overrides=duration_overrides,
                variant_index=variant_index
            )

            # Step 7: Assemble video
            logger.info("Step 7/7: Assembling and rendering final video")
            _report("Assembling video segments", 70)
            assembled_video_path = await self.assemble_video(
                timeline=timeline,
                temp_dir=temp_dir
            )

            # Render with preset and subtitle settings
            _report("Rendering final video", 85)
            output_dir = self.settings.output_dir / profile_id
            output_dir.mkdir(parents=True, exist_ok=True)

            safe_preset_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', preset_data['name'])
            final_output_path = output_dir / f"assembly_{uuid.uuid4().hex[:8]}_{safe_preset_name}.mp4"

            await _render_with_preset(
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
        finally:
            try:
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    async def preview_matches(
        self,
        script_text: str,
        profile_id: str,
        elevenlabs_model: str = "eleven_flash_v2_5",
        voice_id: Optional[str] = None,
        source_video_ids: Optional[List[str]] = None,
        variant_index: int = 0,
        reuse_audio_path: Optional[str] = None,
        reuse_audio_duration: Optional[float] = None,
        voice_settings: Optional[dict] = None,
        max_words_per_phrase: int = 2
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

        # Strip [ProductGroup] tags before TTS (tags must not be spoken)
        cleaned_text = strip_product_group_tags(script_text)

        # Step 1: Generate TTS with timestamps (or reuse existing)
        if reuse_audio_path and reuse_audio_duration:
            logger.info("Preview Step 1/4: Reusing existing TTS audio from Step 2")
            audio_path = Path(reuse_audio_path)
            audio_duration = reuse_audio_duration
            timestamps = {}  # Will rely on SRT cache or regenerate below
        else:
            logger.info("Preview Step 1/4: Generating TTS audio")
            audio_path, audio_duration, timestamps = await self.generate_tts_with_timestamps(
                script_text=cleaned_text,
                profile_id=profile_id,
                elevenlabs_model=elevenlabs_model,
                voice_id=voice_id,
                voice_settings=voice_settings
            )

        # Step 2: Generate SRT (with cache — use cleaned text for cache key)
        logger.info("Preview Step 2/4: Generating SRT subtitles")
        from app.services.tts_cache import srt_cache_lookup, srt_cache_store
        _srt_cache_key = {"text": cleaned_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
        cached_srt = srt_cache_lookup(_srt_cache_key)
        if cached_srt:
            srt_content = cached_srt
        elif timestamps:
            srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase)
            if srt_content:
                srt_cache_store(_srt_cache_key, srt_content)
        else:
            # Reusing audio but no SRT cache hit — must regenerate TTS for timestamps
            logger.info("Preview Step 2/4: SRT cache miss, regenerating TTS for timestamps")
            audio_path, audio_duration, timestamps = await self.generate_tts_with_timestamps(
                script_text=cleaned_text,
                profile_id=profile_id,
                elevenlabs_model=elevenlabs_model,
                voice_id=voice_id,
                voice_settings=voice_settings
            )
            srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase)
            if srt_content:
                srt_cache_store(_srt_cache_key, srt_content)
        srt_entries = self._parse_srt(srt_content)

        # Assign product groups from script tags to SRT entries
        srt_product_groups = assign_groups_to_srt(script_text, srt_entries)

        # Step 3: Fetch segments
        logger.info("Preview Step 3/4: Fetching segments from library")
        if source_video_ids:
            logger.info(f"Filtering to {len(source_video_ids)} source video(s)")
        segments_query = supabase.table("editai_segments")\
            .select("id, source_video_id, start_time, end_time, keywords, transforms, thumbnail_path, product_group, editai_source_videos(file_path)")\
            .eq("profile_id", profile_id)
        if source_video_ids:
            segments_query = segments_query.in_("source_video_id", source_video_ids)
        segments_result = segments_query.execute()

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
                    "source_video_path": source_video_path,
                    "transforms": seg.get("transforms"),
                    "thumbnail_path": seg.get("thumbnail_path"),
                    "product_group": seg.get("product_group"),
                })

        if not segments_data:
            raise RuntimeError(
                "No usable segments found — all segments are missing source video file paths. "
                "Please re-upload source videos or re-create segments."
            )

        # Step 4: Match and build timeline
        logger.info("Preview Step 4/4: Matching and building timeline")
        match_results = self.match_srt_to_segments(
            srt_entries=srt_entries,
            segments_data=segments_data,
            min_confidence=0.3,
            variant_index=variant_index,
            srt_product_groups=srt_product_groups
        )

        timeline = self.build_timeline(
            match_results=match_results,
            segments_data=segments_data,
            audio_duration=audio_duration,
            variant_index=variant_index
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
                "confidence": m.confidence,
                "is_auto_filled": m.is_auto_filled,
                "product_group": m.product_group,
                "source_video_id": m.source_video_id,
                "segment_start_time": m.segment_start_time,
                "segment_end_time": m.segment_end_time,
                "thumbnail_path": m.thumbnail_path,
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

        # Build available segments summary for the timeline editor picker
        available_segments = [
            {
                "id": seg["id"],
                "keywords": seg.get("keywords") or [],
                "source_video_id": seg["source_video_id"],
                "duration": seg.get("duration", 0),
                "product_group": seg.get("product_group"),
                "start_time": seg.get("start_time"),
                "end_time": seg.get("end_time"),
                "thumbnail_path": seg.get("thumbnail_path"),
            }
            for seg in segments_data
        ]

        return {
            "audio_path": str(audio_path),
            "audio_duration": audio_duration,
            "srt_content": srt_content,
            "matches": matches_data,
            "timeline": timeline_data,
            "total_phrases": len(match_results),
            "matched_count": matched_count,
            "unmatched_count": unmatched_count,
            "available_segments": available_segments
        }


# Singleton instance
_assembly_service = None
_assembly_service_lock = threading.Lock()

def get_assembly_service() -> AssemblyService:
    """Get singleton AssemblyService instance."""
    global _assembly_service
    if _assembly_service is None:
        with _assembly_service_lock:
            if _assembly_service is None:
                _assembly_service = AssemblyService()
    return _assembly_service
