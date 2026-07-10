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
import math
import random
import re
import subprocess
import tempfile
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple, Dict

from app.config import get_settings
from app.utils import normalize_path
from app.services.ffmpeg_semaphore import safe_ffmpeg_run, get_prep_codec_params

TARGET_FPS = 30  # All segments normalized to this frame rate before concat
from app.services.srt_validator import sanitize_srt_full

logger = logging.getLogger(__name__)

from app.repositories.factory import get_repository


# F4: transparent scoring weights per preset. Values are literals — the whole
# selection policy lives here. "balanced" is the default and reproduces roughly
# the old round-robin-with-cooldown behaviour.
MATCH_PRESETS: Dict[str, Dict[str, float]] = {
    "keyword_strict": {"w_kw": 3.0, "w_rec": 0.5, "w_div": 0.3, "w_ovl": 1.0, "w_avoid": 0.8},
    "balanced":       {"w_kw": 1.0, "w_rec": 1.5, "w_div": 0.5, "w_ovl": 1.0, "w_avoid": 0.8},
    "max_variety":    {"w_kw": 0.7, "w_rec": 1.0, "w_div": 2.0, "w_ovl": 1.5, "w_avoid": 1.2},
    "shuffle":        {"w_kw": 1.0, "w_rec": 1.5, "w_div": 0.5, "w_ovl": 1.0, "w_avoid": 0.8},
    # ai_smart: Gemini pre-assigns segments (see _ai_match_segments); phrases the
    # AI couldn't place fall through to scoring with balanced weights.
    "ai_smart":       {"w_kw": 1.0, "w_rec": 1.5, "w_div": 0.5, "w_ovl": 1.0, "w_avoid": 0.8},
}
_SHUFFLE_EPSILON = 0.25  # scores within this of the max are tie-broken by seeded RNG


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
    transforms: Optional[dict] = None
    explanation: Optional[str] = None  # F5: human-readable reason for this pick
    pinned: bool = False               # F6: user-locked assignment


@dataclass
class TimelineEntry:
    """Entry in the video timeline."""
    source_video_path: str
    start_time: float  # Within source video
    end_time: float    # Within source video
    timeline_start: float  # Position in final video
    timeline_duration: float
    transforms: Optional[dict] = None  # Per-segment visual transforms
    pinned: bool = False  # F6: originates from a pinned match — never absorbed/swapped


def strip_product_group_tags(text: str) -> str:
    """Remove [ProductGroup] tags from script text, leaving only speakable content."""
    return re.sub(r'\[([^\[\]]+)\]', '', text).strip()


_SRT_TS_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})")


def shift_srt(content: str, offset_sec: float) -> str:
    """Shift every SRT timestamp by offset_sec (F1: intro delay).

    Keeps the HH:MM:SS,mmm format. offset_sec of 0 returns content unchanged.
    """
    if not content or offset_sec <= 0:
        return content

    def _shift(m: "re.Match") -> str:
        total_ms = (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))) * 1000 + int(m.group(4))
        total_ms += int(round(offset_sec * 1000))
        h, rem = divmod(total_ms, 3600_000)
        mnt, rem = divmod(rem, 60_000)
        s, ms = divmod(rem, 1000)
        return f"{h:02d}:{mnt:02d}:{s:02d},{ms:03d}"

    return _SRT_TS_RE.sub(_shift, content)


def _slugify_output_component(value: Optional[str], *, fallback: str, max_words: int = 8, max_length: int = 48) -> str:
    """Convert free text into a short filesystem-safe label."""
    if not value:
        return fallback
    tokens = re.findall(r"[A-Za-z0-9]+", value.strip())
    if not tokens:
        return fallback
    slug = "_".join(tokens[:max_words]).lower()
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug[:max_length].strip("_") or fallback


def build_output_basename(
    *,
    variant_index: int,
    visual_version_label: Optional[str] = None,
    preset_name: Optional[str] = None,
    project_label: Optional[str] = None,
    script_label: Optional[str] = None,
    created_at: Optional[datetime] = None,
) -> str:
    """Build a human-readable output filename stem for rendered videos."""
    project_slug = _slugify_output_component(project_label, fallback="pipeline")
    script_slug = _slugify_output_component(script_label, fallback=f"variant_{variant_index + 1}", max_words=6)
    variant_suffix = f"{variant_index + 1}{str(visual_version_label).lower()}" if visual_version_label else f"{variant_index + 1}"
    timestamp = (created_at or datetime.now()).strftime("%Y%m%d_%H%M%S")
    preset_slug = _slugify_output_component(preset_name, fallback="", max_words=4, max_length=24) if preset_name else ""

    parts = [project_slug]
    if script_slug != project_slug:
        parts.append(script_slug)
    parts.append(f"v{variant_suffix}")
    parts.append(timestamp)
    if preset_slug and preset_slug != "tiktok":
        parts.append(preset_slug)

    return "_".join(part for part in parts if part)


def build_word_to_group_map(text: str) -> List[Optional[str]]:
    """Map each word (after tag removal) to its product group (or None).

    Supports paired tags: first [Tag] opens a group section, second [Tag]
    closes it.  Unpaired tags stay open for the rest of the script
    (backwards-compatible with old single-tag behaviour).

    Returns a list parallel to the cleaned words (tags excluded).
    """
    open_stack: List[str] = []
    word_groups: List[Optional[str]] = []
    tag_pattern = re.compile(r'\[([^\[\]]+)\]')

    # Process text token by token, toggling groups on/off
    pos = 0
    while pos < len(text):
        tag_match = tag_pattern.match(text, pos)
        if tag_match:
            label = tag_match.group(1).strip()
            if label in open_stack:
                # Second occurrence — close this group
                open_stack.remove(label)
            else:
                # First occurrence — open this group
                open_stack.append(label)
            pos = tag_match.end()
            continue

        # Find next non-whitespace run (a word)
        ws_match = re.match(r'\s+', text[pos:])
        if ws_match:
            pos += ws_match.end()
            continue

        # Find end of word (up to whitespace or tag)
        # NOTE: This whitespace-based split works for Latin/Cyrillic scripts but
        # will not correctly tokenise CJK, Arabic, Thai, or other scripts that
        # lack inter-word spaces.  A proper solution would use ICU/regex \b.
        word_end = pos
        while word_end < len(text) and not text[word_end].isspace() and text[word_end] != '[':
            word_end += 1

        if word_end > pos:
            # Assign the most recently opened group (top of stack), or None
            word_groups.append(open_stack[-1] if open_stack else None)
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
        self._cleanup_timers: Dict[str, threading.Timer] = {}  # temp_dir -> timer for cancellation

    async def _get_audio_duration(self, audio_path: Path) -> float:
        """Get audio duration in seconds using ffprobe."""
        try:
            cmd = [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(audio_path)
            ]
            result = await asyncio.to_thread(safe_ffmpeg_run, cmd, 30, "audio duration")
            if result.returncode == 0 and result.stdout.strip():
                duration_str = result.stdout.strip()
                try:
                    val = float(duration_str)
                    return val if val > 0 else 0.0
                except ValueError:
                    return 0.0
        except Exception as e:
            logger.warning(f"Could not get audio duration: {e}")
        return 0.0

    def _parse_srt(self, content: str) -> List[dict]:
        """Parse SRT content into list of entries with timestamps."""
        content = content.replace('\r\n', '\n').replace('\r', '')
        entries = []
        blocks = content.strip().split("\n\n")

        for block in blocks:
            lines = block.strip().split("\n")
            if len(lines) >= 2:
                # Parse timestamp line (format: 00:00:01,000 --> 00:00:03,000)
                time_line = lines[1]
                if " --> " in time_line:
                    start_str, end_str = time_line.split(" --> ")
                    start_time = self._srt_time_to_seconds(start_str.strip())
                    end_time = self._srt_time_to_seconds(end_str.strip())
                    # Handle 2-line blocks (index + timestamp, no text)
                    text = " ".join(lines[2:]) if len(lines) >= 3 else ""

                    # Skip entries with empty or whitespace-only text
                    if not text.strip():
                        continue

                    entries.append({
                        "start_time": start_time,
                        "end_time": end_time,
                        "text": text
                    })

        return entries

    def _srt_time_to_seconds(self, time_str: str) -> float:
        """Convert SRT time format to seconds."""
        try:
            time_str = time_str.replace(",", ".")
            parts = time_str.split(":")
            if len(parts) < 3:
                return 0.0
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return max(0.0, hours * 3600 + minutes * 60 + seconds)
        except Exception:
            return 0.0

    async def generate_tts_with_timestamps(
        self,
        script_text: str,
        profile_id: str,
        elevenlabs_model: str = "eleven_flash_v2_5",
        voice_id: Optional[str] = None,
        voice_settings: Optional[dict] = None,
        temp_dir: Optional[Path] = None
    ) -> Tuple[Path, float, dict]:
        """
        Generate TTS audio with timestamps and apply silence removal.

        Returns:
            Tuple of (audio_path, duration, timestamps_dict)
        """
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        from app.services.audio.silence_remover import SilenceRemover

        # Use provided temp_dir or create a new one
        _owns_temp_dir = temp_dir is None
        if temp_dir is None:
            temp_dir = self.settings.base_dir / "temp" / profile_id / f"assembly_{uuid.uuid4().hex[:8]}"
        temp_dir.mkdir(parents=True, exist_ok=True)

        try:
            return await self._generate_tts_with_timestamps_impl(
                script_text, profile_id, elevenlabs_model, voice_id, voice_settings, temp_dir
            )
        except Exception:
            # Clean up temp dir only if we created it
            if _owns_temp_dir and temp_dir.exists():
                import shutil
                shutil.rmtree(temp_dir, ignore_errors=True)
                logger.info(f"Cleaned up assembly temp dir after failure: {temp_dir}")
            raise

    async def _generate_tts_with_timestamps_impl(
        self,
        script_text: str,
        profile_id: str,
        elevenlabs_model: str,
        voice_id: Optional[str],
        voice_settings: Optional[dict],
        temp_dir: Path
    ) -> Tuple[Path, float, dict]:
        """Internal implementation for generate_tts_with_timestamps."""
        from app.services.tts.elevenlabs import ElevenLabsTTSService
        from app.services.audio.silence_remover import SilenceRemover

        # Generate TTS with timestamps (profile_id enables multi-account failover)
        tts_service = ElevenLabsTTSService(output_dir=temp_dir, model_id=elevenlabs_model, profile_id=profile_id)

        # Use provided voice ID or fall back to configured default
        voice_id = voice_id or tts_service._voice_id
        raw_audio_path = temp_dir / "tts_raw.mp3"

        logger.info(f"Generating TTS for script ({len(script_text)} chars) with model {elevenlabs_model}")

        ALLOWED_VOICE_KEYS = {"stability", "similarity_boost", "style", "use_speaker_boost", "speed"}
        safe_settings = {k: v for k, v in (voice_settings or {}).items() if k in ALLOWED_VOICE_KEYS}
        try:
            tts_result, timestamps = await tts_service.generate_audio_with_timestamps(
                text=script_text,
                voice_id=voice_id,
                output_path=raw_audio_path,
                model_id=elevenlabs_model,
                **safe_settings
            )
        except Exception as el_err:
            # F7 offline path: ElevenLabs unavailable (no key, quota, network)
            # must not kill the pipeline — Edge TTS is free and local-friendly.
            # Character timings are estimated uniformly over the audio duration;
            # subtitle timing fidelity is approximate but the deterministic
            # matching/render flow stays fully functional without any API key.
            logger.warning(
                f"ElevenLabs TTS failed ({str(el_err)[:200]}) — falling back to Edge TTS (free)"
            )
            timestamps = await self._generate_edge_tts_fallback(
                script_text, profile_id, raw_audio_path
            )

        # Apply silence removal (same params as _render_final_clip_task)
        logger.info("Applying silence removal to TTS audio")
        trimmed_audio_path = temp_dir / "tts_trimmed.mp3"

        silence_remover = SilenceRemover(
            min_silence_duration=0.25,
            padding=0.06,
            target_pause_duration=0.1  # Shorten pauses instead of removing (consistent with library render)
        )

        removal_result = await asyncio.to_thread(
            silence_remover.remove_silence,
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

        # Clean up raw audio now that trimmed version is ready
        raw_audio_path.unlink(missing_ok=True)

        return (trimmed_audio_path, audio_duration, timestamps)

    async def _generate_edge_tts_fallback(
        self,
        script_text: str,
        profile_id: str,
        raw_audio_path: Path,
    ) -> dict:
        """Generate TTS via Edge (free) and return ESTIMATED character timestamps.

        Edge TTS has no character-level alignment API, so timings are spread
        uniformly across the measured audio duration — good enough for the
        subtitle/matching flow when no ElevenLabs key is available (F7
        offline path).
        """
        from app.services.tts.edge import EdgeTTSService

        # Respect the profile's configured Edge voice when present
        edge_voice = "en-US-GuyNeural"
        try:
            repo = get_repository()
            profile_row = repo.get_profile(profile_id) if repo else None
            edge_cfg = ((profile_row or {}).get("tts_settings") or {}).get("edge") or {}
            edge_voice = edge_cfg.get("voice") or edge_voice
        except Exception:
            pass

        edge = EdgeTTSService(output_dir=raw_audio_path.parent, default_voice=edge_voice)
        result = await edge.generate_audio(
            text=script_text, voice_id=edge_voice, output_path=raw_audio_path
        )
        duration = result.duration_seconds or await self._get_audio_duration(raw_audio_path)
        if not duration or duration <= 0:
            raise RuntimeError("Edge TTS fallback produced no measurable audio")

        chars = list(script_text)
        n = max(1, len(chars))
        return {
            "characters": chars,
            "character_start_times_seconds": [duration * i / n for i in range(n)],
            "character_end_times_seconds": [duration * (i + 1) / n for i in range(n)],
        }

    async def generate_srt_from_timestamps(
        self,
        timestamps: dict,
        max_words_per_phrase: int = 2,
        karaoke: bool = False
    ) -> str:
        """
        Generate SRT content from ElevenLabs timestamps.

        Args:
            timestamps: ElevenLabs alignment dict
            max_words_per_phrase: Max words per subtitle entry (default: 2)
            karaoke: Emit per-word {\\k} timing tags for karaoke captions

        Returns:
            SRT-formatted string
        """
        from app.services.tts_subtitle_generator import generate_srt_from_timestamps

        srt_content = generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase, karaoke=karaoke)

        logger.info(f"Generated SRT with {len(srt_content.split(chr(10) + chr(10)))} entries")

        return srt_content

    def _ai_match_segments(
        self,
        srt_entries: List[dict],
        segments_data: List[dict],
        profile_id: Optional[str] = None,
    ) -> Optional[Dict[int, str]]:
        """One text-only Gemini call: pick the best segment for each SRT phrase.

        Returns {srt_index: segment_id} or None on ANY failure — the caller
        falls back to keyword scoring, so this can never break a preview.
        Blocking (sync); async callers run it via asyncio.to_thread.
        """
        import json
        try:
            from app.services.gemini_analyzer import GeminiVideoAnalyzer
            analyzer = GeminiVideoAnalyzer(profile_id=profile_id)

            catalog = [
                {
                    "id": s["id"],
                    "keywords": s.get("keywords") or [],
                    "duration": round(
                        float(s.get("end_time") or 0) - float(s.get("start_time") or 0), 1
                    ),
                }
                for s in segments_data
            ]
            phrases = [{"index": i, "text": e["text"]} for i, e in enumerate(srt_entries)]
            prompt = (
                "You match narration phrases to stock video segments for a short-form "
                "social video. For EACH phrase pick the segment whose keywords best fit "
                "its meaning. Prefer visual variety: avoid giving consecutive phrases "
                "the same segment unless nothing else fits.\n"
                f"Phrases: {json.dumps(phrases, ensure_ascii=False)}\n"
                f"Segments: {json.dumps(catalog, ensure_ascii=False)}\n"
                'Reply ONLY with JSON: {"matches": [{"index": 0, "segment_id": "..."}]} '
                "covering every phrase index exactly once."
            )

            response = analyzer.client.models.generate_content(
                model=analyzer.model_name, contents=[prompt]
            )
            text = response.text or ""
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            if not json_match:
                logger.warning("AI smart match: no JSON found in Gemini response")
                return None

            data = json.loads(json_match.group(0))
            valid_ids = {s["id"] for s in segments_data}
            result: Dict[int, str] = {}
            for item in data.get("matches", []):
                idx = item.get("index")
                seg_id = item.get("segment_id")
                if isinstance(idx, int) and 0 <= idx < len(srt_entries) and seg_id in valid_ids:
                    result[idx] = seg_id

            if not result:
                logger.warning("AI smart match: Gemini returned no usable assignments")
                return None
            logger.info(
                f"AI smart match: Gemini assigned {len(result)}/{len(srt_entries)} phrases"
            )
            return result
        except Exception as e:
            logger.warning(f"AI smart match failed, falling back to keyword scoring: {e}")
            return None

    def match_srt_to_segments(
        self,
        srt_entries: List[dict],
        segments_data: List[dict],
        min_confidence: float = 0.3,
        variant_index: int = 0,
        srt_product_groups: Optional[List[Optional[str]]] = None,
        avoid_segment_ids: Optional[set] = None,
        preset: str = "balanced",
        pinned_assignments: Optional[Dict[int, str]] = None,
        ai_assignments: Optional[Dict[int, str]] = None,
    ) -> List[MatchResult]:
        """
        Assign one library segment to each SRT phrase via a transparent scoring
        function (F4).  For each phrase i, every segment passing the hard
        constraints is scored:

            score = w_kw*keyword_affinity + w_rec*recency + w_div*diversity
                    - w_ovl*overlap_penalty - w_avoid*avoided

        and the argmax wins (deterministic tie-break by segment id).  Weights are
        chosen by ``preset`` (see MATCH_PRESETS).  The "shuffle" preset breaks
        near-ties with a per-variant seeded RNG so each variant looks different;
        all other presets are fully deterministic.

        Hard constraints per phrase:
          - product-group match when the phrase forces a group (falls back to any
            group when the forced group is empty, but logs it);
          - not a single_use segment already spent this render;
          - not identical to the immediately previous pick (when n > 1).

        Args:
            min_confidence: a keyword only counts as "matched" (populating
                matched_keyword/confidence and the w_kw term) when its affinity
                is >= this threshold; weaker keyword hits contribute 0.
            variant_index: seeds the "shuffle" preset's tie-break RNG.
            avoid_segment_ids: cross-variant deprioritization (w_avoid term).
            pinned_assignments: srt_index -> segment_id.  A pinned phrase skips
                scoring entirely, is marked pinned, and still updates the recency
                ledger so neighbours see it.
        """
        weights = MATCH_PRESETS.get(preset)
        if weights is None:
            logger.warning("Unknown match preset %r — falling back to 'balanced'", preset)
            preset = "balanced"
            weights = MATCH_PRESETS["balanced"]
        w_kw = weights["w_kw"]
        w_rec = weights["w_rec"]
        w_div = weights["w_div"]
        w_ovl = weights["w_ovl"]
        w_avoid = weights["w_avoid"]

        matches: List[MatchResult] = []
        _avoid_ids: set = avoid_segment_ids or set()
        pinned_assignments = pinned_assignments or {}
        n = len(segments_data)
        segment_lookup: Dict[str, dict] = {s["id"]: s for s in segments_data}
        groups_present = {s.get("product_group") for s in segments_data}

        # Recency ledger: srt index each segment was last used at (-inf = never).
        last_used: Dict[str, int] = {}
        _used_single_use_ids: set = set()

        # RNG only used by the "shuffle" preset for near-tie scatter.
        shuffle_rng = random.Random(variant_index) if preset == "shuffle" else None

        prev_segment_id: Optional[str] = None
        prev_source_video_id: Optional[str] = None
        prev_segment_start: Optional[float] = None
        prev_segment_end: Optional[float] = None
        current_product_group: Optional[str] = None

        def _keyword_affinity(seg: dict, srt_text_lower: str, words: set,
                              forced_group: Optional[str]) -> Tuple[float, Optional[str]]:
            """Best keyword affinity for seg against this phrase (0 if none).

            Returns (affinity, matched_keyword). Mirrors the old 0.7/1.0 + group
            bonus heuristic.
            """
            seg_group = seg.get("product_group")
            best = 0.0
            best_kw = None
            for keyword in (seg.get("keywords") or []):
                kw_lower = keyword.lower()
                if kw_lower not in srt_text_lower:
                    continue
                conf = 1.0 if kw_lower in words else 0.7
                if seg_group and kw_lower == seg_group.lower():
                    conf += 0.5
                if current_product_group and seg_group == current_product_group:
                    conf += 0.2
                conf = min(conf, 1.0)
                if conf > best:
                    best = conf
                    best_kw = keyword
            return best, best_kw

        keyword_matched = 0
        auto_filled = 0
        pinned_count = 0

        for idx, entry in enumerate(srt_entries):
            srt_text = entry["text"]
            srt_start = entry["start_time"]
            srt_end = entry["end_time"]

            # --- F6: pinned assignment short-circuits scoring ---
            pin_id = pinned_assignments.get(idx)
            if pin_id and pin_id in segment_lookup:
                seg = segment_lookup[pin_id]
                seg_group = seg.get("product_group")
                last_used[pin_id] = idx
                if seg.get("single_use"):
                    _used_single_use_ids.add(pin_id)
                if seg_group:
                    current_product_group = seg_group
                prev_segment_id = pin_id
                prev_source_video_id = seg.get("source_video_id")
                prev_segment_start = seg.get("start_time")
                prev_segment_end = seg.get("end_time")
                matches.append(MatchResult(
                    srt_index=idx, srt_text=srt_text, srt_start=srt_start, srt_end=srt_end,
                    segment_id=pin_id,
                    segment_keywords=seg.get("keywords") or [],
                    matched_keyword=None, confidence=0.0, is_auto_filled=False,
                    product_group=seg_group,
                    source_video_id=seg.get("source_video_id"),
                    segment_start_time=seg.get("start_time"),
                    segment_end_time=seg.get("end_time"),
                    thumbnail_path=seg.get("thumbnail_path"),
                    transforms=seg.get("transforms"),
                    explanation="pinned by user", pinned=True,
                ))
                pinned_count += 1
                continue

            # --- ai_smart: Gemini-assigned pick. Soft — skipped when the pick
            # violates a hard constraint (spent single-use / same as previous),
            # in which case the phrase falls through to normal scoring. ---
            ai_id = ai_assignments.get(idx) if ai_assignments else None
            if (
                ai_id
                and ai_id in segment_lookup
                and ai_id not in _used_single_use_ids
                and not (n > 1 and ai_id == prev_segment_id)
            ):
                seg = segment_lookup[ai_id]
                seg_group = seg.get("product_group")
                last_used[ai_id] = idx
                if seg.get("single_use"):
                    _used_single_use_ids.add(ai_id)
                if seg_group:
                    current_product_group = seg_group
                prev_segment_id = ai_id
                prev_source_video_id = seg.get("source_video_id")
                prev_segment_start = seg.get("start_time")
                prev_segment_end = seg.get("end_time")
                matches.append(MatchResult(
                    srt_index=idx, srt_text=srt_text, srt_start=srt_start, srt_end=srt_end,
                    segment_id=ai_id,
                    segment_keywords=seg.get("keywords") or [],
                    matched_keyword=None, confidence=0.9, is_auto_filled=False,
                    product_group=seg_group,
                    source_video_id=seg.get("source_video_id"),
                    segment_start_time=seg.get("start_time"),
                    segment_end_time=seg.get("end_time"),
                    thumbnail_path=seg.get("thumbnail_path"),
                    transforms=seg.get("transforms"),
                    explanation="AI smart match",
                ))
                keyword_matched += 1
                continue

            srt_text_lower = srt_text.lower()
            words = set(srt_text_lower.split())

            forced_group = (
                srt_product_groups[idx]
                if srt_product_groups and idx < len(srt_product_groups)
                else None
            )
            # Resolve the hard product-group constraint. When a group is forced
            # but has no segments, fall back to the whole pool (logged).
            group_constraint: Optional[str]
            if forced_group is not None and forced_group in groups_present:
                group_constraint = forced_group
            elif forced_group is not None:
                logger.info(
                    "SRT %d forces product_group %r which has no segments — "
                    "falling back to any group", idx, forced_group,
                )
                group_constraint = None
            else:
                group_constraint = None

            # --- Score every eligible candidate ---
            best_seg = None
            best_kw = None
            best_conf = 0.0
            best_score = None
            tie_pool: list = []  # (segment, kw, conf) within epsilon of best (shuffle only)

            for seg in segments_data:
                sid = seg["id"]
                # Hard constraints
                if group_constraint is not None and seg.get("product_group") != group_constraint:
                    continue
                if seg.get("single_use") and sid in _used_single_use_ids:
                    continue
                if n > 1 and sid == prev_segment_id:
                    continue

                affinity, kw = _keyword_affinity(seg, srt_text_lower, words, group_constraint)
                # A keyword only "counts" (matched_keyword + w_kw term) at/above
                # min_confidence; weaker hits contribute nothing.
                kw_term = affinity if affinity >= min_confidence else 0.0
                effective_kw = kw if affinity >= min_confidence else None

                last = last_used.get(sid)
                recency = 1.0 if last is None else min(1.0, (idx - last) / max(2, n))

                same_src_as_prev = (
                    prev_source_video_id is not None
                    and seg.get("source_video_id") == prev_source_video_id
                )
                diversity = 0.0 if same_src_as_prev else 1.0

                overlap = 0.0
                if (same_src_as_prev and prev_segment_start is not None
                        and prev_segment_end is not None
                        and seg.get("start_time", 0.0) < prev_segment_end
                        and prev_segment_start < seg.get("end_time", 0.0)):
                    overlap = 1.0

                avoided = 1.0 if sid in _avoid_ids else 0.0

                score = (w_kw * kw_term + w_rec * recency + w_div * diversity
                         - w_ovl * overlap - w_avoid * avoided)

                # argmax with deterministic tie-break by segment id
                if (best_score is None or score > best_score
                        or (score == best_score and best_seg is not None and sid < best_seg["id"])):
                    best_score = score
                    best_seg = seg
                    best_kw = effective_kw
                    best_conf = affinity if affinity >= min_confidence else 0.0

            if best_seg is None:
                # No candidate cleared the hard constraints (e.g. only 1 segment
                # and it equals prev). Relax the no-repeat rule as last resort.
                for seg in segments_data:
                    if seg.get("single_use") and seg["id"] in _used_single_use_ids:
                        continue
                    if group_constraint is not None and seg.get("product_group") != group_constraint:
                        continue
                    best_seg = seg
                    break
                if best_seg is None and segments_data:
                    best_seg = segments_data[0]

            if best_seg is None:
                logger.warning("No segment matched for SRT entry %d: %s", idx, srt_text[:80])
                matches.append(MatchResult(
                    srt_index=idx, srt_text=srt_text, srt_start=srt_start, srt_end=srt_end,
                    segment_id=None, segment_keywords=[], matched_keyword=None, confidence=0.0,
                ))
                continue

            # --- Shuffle preset: scatter near-ties by seeded RNG ---
            if shuffle_rng is not None and best_score is not None:
                near = []
                for seg in segments_data:
                    sid = seg["id"]
                    if group_constraint is not None and seg.get("product_group") != group_constraint:
                        continue
                    if seg.get("single_use") and sid in _used_single_use_ids:
                        continue
                    if n > 1 and sid == prev_segment_id:
                        continue
                    affinity, kw = _keyword_affinity(seg, srt_text_lower, words, group_constraint)
                    kw_term = affinity if affinity >= min_confidence else 0.0
                    last = last_used.get(sid)
                    recency = 1.0 if last is None else min(1.0, (idx - last) / max(2, n))
                    same_src = (prev_source_video_id is not None
                                and seg.get("source_video_id") == prev_source_video_id)
                    diversity = 0.0 if same_src else 1.0
                    overlap = 1.0 if (same_src and prev_segment_start is not None
                                      and prev_segment_end is not None
                                      and seg.get("start_time", 0.0) < prev_segment_end
                                      and prev_segment_start < seg.get("end_time", 0.0)) else 0.0
                    avoided = 1.0 if sid in _avoid_ids else 0.0
                    score = (w_kw * kw_term + w_rec * recency + w_div * diversity
                             - w_ovl * overlap - w_avoid * avoided)
                    if score >= best_score - _SHUFFLE_EPSILON:
                        near.append((seg, kw if affinity >= min_confidence else None,
                                     affinity if affinity >= min_confidence else 0.0))
                if len(near) > 1:
                    near.sort(key=lambda t: t[0]["id"])  # stable order before seeded pick
                    best_seg, best_kw, best_conf = shuffle_rng.choice(near)

            sid = best_seg["id"]
            seg_group = best_seg.get("product_group")
            is_auto = best_kw is None
            if best_kw is not None:
                keyword_matched += 1
            else:
                auto_filled += 1

            # Build explanation from the winning terms (F5).
            expl_parts = []
            if best_kw is not None:
                expl_parts.append(f"keyword '{best_kw}' matched ({best_conf:.2f})")
            last = last_used.get(sid)
            if last is None:
                expl_parts.append("never used before")
            else:
                expl_parts.append(f"unused for {idx - last} phrases")
            if prev_source_video_id is not None:
                if best_seg.get("source_video_id") != prev_source_video_id:
                    expl_parts.append("different source than previous")
                else:
                    expl_parts.append("same source as previous")
            if sid in _avoid_ids:
                expl_parts.append("(deprioritized cross-variant)")
            explanation = "; ".join(expl_parts)

            # Record ledger + single_use before advancing prev-state.
            last_used[sid] = idx
            if best_seg.get("single_use"):
                _used_single_use_ids.add(sid)
            if seg_group:
                current_product_group = seg_group

            matches.append(MatchResult(
                srt_index=idx, srt_text=srt_text, srt_start=srt_start, srt_end=srt_end,
                segment_id=sid,
                segment_keywords=best_seg.get("keywords") or [],
                matched_keyword=best_kw, confidence=best_conf, is_auto_filled=is_auto,
                product_group=seg_group,
                source_video_id=best_seg.get("source_video_id"),
                segment_start_time=best_seg.get("start_time"),
                segment_end_time=best_seg.get("end_time"),
                thumbnail_path=best_seg.get("thumbnail_path"),
                transforms=best_seg.get("transforms"),
                explanation=explanation, pinned=False,
            ))
            prev_segment_id = sid
            prev_source_video_id = best_seg.get("source_video_id")
            prev_segment_start = best_seg.get("start_time")
            prev_segment_end = best_seg.get("end_time")

        logger.info(
            "Segment allocation [%s]: %d keyword-matched, %d scored auto-fill, "
            "%d pinned, %d total (variant=%d)",
            preset, keyword_matched, auto_filled, pinned_count, len(matches), variant_index,
        )

        return matches

    def build_timeline(
        self,
        match_results: List[MatchResult],
        segments_data: List[dict],
        audio_duration: float,
        duration_overrides: Optional[List[Optional[float]]] = None,
        variant_index: int = 0,
        min_segment_duration: float = 3.0,
        ultra_rapid_intro: bool = True
    ) -> Tuple[List[TimelineEntry], float]:
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
            (timeline, intro_offset_sec) — intro_offset_sec is the total duration
            of the ultra-rapid intro prepended before the body (0.0 when disabled).
            The body starts at t=intro_offset_sec, so callers must shift the SRT
            and delay the audio by this amount to keep A/V/subtitles in sync (F1).
        """
        timeline = []

        # F3: probe each source video's real duration once, cached per path, so
        # merge/gap-fill never extend an entry past EOF (which would produce a
        # short clip and shift everything after it).
        _duration_cache: Dict[str, float] = {}

        def _real_duration(path: Optional[str]) -> Optional[float]:
            if not path:
                return None
            if path in _duration_cache:
                return _duration_cache[path]
            dur = None
            try:
                probe = safe_ffmpeg_run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=noprint_wrappers=1:nokey=1", path],
                    timeout=30, operation="ffprobe source duration (timeline)",
                )
                if probe.returncode == 0 and probe.stdout.strip():
                    dur = float(probe.stdout.strip())
            except Exception:
                dur = None
            _duration_cache[path] = dur
            return dur

        def _clamp_end(path: Optional[str], start: float, desired_end: float) -> float:
            """Clamp desired_end to the source's real length (F3)."""
            real = _real_duration(path)
            if real is not None and desired_end > real:
                return max(start, real)
            return desired_end

        if not match_results:
            logger.warning("No SRT entries to build timeline from")
            return timeline, 0.0

        # Build segment lookup
        segment_lookup = {seg["id"]: seg for seg in segments_data}

        # Fallback segments: rotate through available segments to avoid
        # always repeating segments_data[0] when unmatched entries exist.
        fallback_segment = segments_data[0] if segments_data else None
        _fallback_idx = 0
        # Track single_use segments already placed in this timeline
        _used_single_use_in_timeline: set = set()

        current_timeline_pos = 0.0
        intro_entry_count = 0  # Track how many intro micro-segments were added

        # Ultra-rapid intro: prepend 3-4 micro-segments from highest-scored segments
        if ultra_rapid_intro and segments_data:
            MICRO_COUNT = 4
            MICRO_DURATION = 0.50  # seconds per micro-segment (4 x 0.5 = 2.0s intro)

            # Sort segments by duration (longer = more content to pick from) as proxy for quality
            scored = sorted(segments_data, key=lambda s: s.get("end_time", 0) - s.get("start_time", 0), reverse=True)

            # Build a larger candidate pool for diversity between variants
            CANDIDATE_POOL_SIZE = max(MICRO_COUNT * 3, 12)
            candidate_pool = []
            used_sources = set()
            for seg in scored:
                if len(candidate_pool) >= CANDIDATE_POOL_SIZE:
                    break
                # Ensure diversity: different source videos or different time regions
                source_key = (seg.get("source_video_path", ""), round(seg.get("start_time", 0) / 5))
                if source_key in used_sources:
                    continue
                used_sources.add(source_key)
                candidate_pool.append(seg)

            # Shuffle per variant_index so each variant gets a different intro
            # Same variant_index always produces the same intro (reproducible)
            rng = random.Random(variant_index)
            rng.shuffle(candidate_pool)
            intro_segments = candidate_pool[:MICRO_COUNT]

            # Create micro timeline entries
            for seg in intro_segments:
                seg_start = seg.get("start_time", 0.0)
                seg_end = seg.get("end_time", seg_start + MICRO_DURATION)
                seg_duration = seg_end - seg_start
                # Extract from the middle of the segment for best content
                seg_mid = (seg_start + seg_end) / 2
                micro_start = max(seg_start, seg_mid - MICRO_DURATION / 2)
                # Clamp end_time to never exceed segment boundary
                micro_end = min(micro_start + MICRO_DURATION, seg_end)
                actual_micro_duration = micro_end - micro_start

                entry = TimelineEntry(
                    source_video_path=seg.get("source_video_path"),
                    start_time=micro_start,
                    end_time=micro_end,
                    timeline_start=current_timeline_pos,
                    timeline_duration=actual_micro_duration,
                    transforms=seg.get("transforms"),
                )
                timeline.append(entry)
                current_timeline_pos += actual_micro_duration

            intro_entry_count = len(intro_segments)
            logger.info(f"Ultra-rapid intro: added {intro_entry_count} micro-segments ({current_timeline_pos:.2f}s)")

        for idx, match in enumerate(match_results):
            # Determine which segment to use
            if match.segment_id and match.segment_id in segment_lookup:
                segment = segment_lookup[match.segment_id]
            elif match.segment_id and match.source_video_id and match.segment_start_time is not None:
                # Segment not in current DB query but override carries full data —
                # reconstruct a synthetic segment dict so the user's choice is honoured.
                logger.warning(
                    f"Segment {match.segment_id} from override not found in DB query — "
                    f"reconstructing from override data for SRT entry: '{match.srt_text}'"
                )
                # Find source_video_path from any segment with same source_video_id
                sv_path = None
                for seg in segments_data:
                    if seg.get("source_video_id") == match.source_video_id:
                        sv_path = seg.get("source_video_path")
                        break
                if sv_path:
                    segment = {
                        "id": match.segment_id,
                        "source_video_id": match.source_video_id,
                        "start_time": match.segment_start_time,
                        "end_time": match.segment_end_time or (match.segment_start_time + 5.0),
                        "source_video_path": sv_path,
                        "keywords": match.segment_keywords,
                        "transforms": match.transforms,
                    }
                elif fallback_segment:
                    segment = fallback_segment
                    logger.warning(f"Could not resolve source_video_path for override segment {match.segment_id}")
                else:
                    logger.warning(f"No segment available for SRT entry: '{match.srt_text}'")
                    continue
            elif fallback_segment:
                # Rotate through segments to avoid repeating the same one,
                # skipping single_use segments already placed
                segment = segments_data[_fallback_idx % len(segments_data)]
                _fallback_idx += 1
                if segment.get("single_use") and segment["id"] in _used_single_use_in_timeline:
                    # Try to find a non-single-use-exhausted segment
                    _found_alt = False
                    for _try in range(len(segments_data)):
                        alt = segments_data[_fallback_idx % len(segments_data)]
                        _fallback_idx += 1
                        if not (alt.get("single_use") and alt["id"] in _used_single_use_in_timeline):
                            segment = alt
                            _found_alt = True
                            break
                    # If all exhausted, use the original pick (better than no video)
                if match.segment_id:
                    logger.error(
                        f"RENDER MISMATCH: Override segment_id {match.segment_id} NOT FOUND "
                        f"in segment_lookup ({len(segment_lookup)} segments) AND reconstruction "
                        f"failed (source_video_id={match.source_video_id}, "
                        f"segment_start_time={match.segment_start_time}). "
                        f"Using fallback segment '{segment.get('id')}'. "
                        f"SRT entry: '{match.srt_text}'"
                    )
                else:
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
            needed_duration = override if override is not None else (match.srt_end - match.srt_start)

            # Get segment video path from source_video_id
            source_video_path = segment.get("source_video_path")
            segment_start = segment.get("start_time", 0.0)
            segment_end = segment.get("end_time", segment_start + needed_duration)
            segment_duration = segment_end - segment_start

            # F2: the timeline entry ALWAYS occupies exactly needed_duration so
            # video time never falls behind audio/SRT. If the source span is
            # shorter, keep end_time at the real segment end (clamped to EOF) and
            # let the extraction layer loop/hold to fill the slot.
            if segment_duration >= needed_duration:
                use_end = segment_start + needed_duration
            else:
                use_end = _clamp_end(source_video_path, segment_start, segment_end)
                logger.info(
                    f"  timeline[{idx}]: segment short ({segment_duration:.2f}s < "
                    f"{needed_duration:.2f}s) — slot held at {needed_duration:.2f}s (loop-fill)"
                )
            use_duration = needed_duration

            timeline_entry = TimelineEntry(
                source_video_path=source_video_path,
                start_time=segment_start,
                end_time=use_end,
                timeline_start=current_timeline_pos,
                timeline_duration=use_duration,
                transforms=segment.get("transforms"),
                pinned=getattr(match, "pinned", False),
            )
            timeline.append(timeline_entry)
            current_timeline_pos += use_duration

            # Track single_use segments placed in timeline
            if segment.get("single_use") and segment.get("id"):
                _used_single_use_in_timeline.add(segment["id"])

            # Diagnostic: log each timeline entry's source for debugging render mismatches
            if idx < 10 or idx == len(match_results) - 1:
                logger.info(
                    f"  timeline[{idx}]: seg={segment.get('id', '?')!r} "
                    f"src={Path(source_video_path).name if source_video_path else 'NONE'} "
                    f"clip={segment_start:.2f}-{segment.get('end_time', 0):.2f}s "
                    f"@timeline={current_timeline_pos - use_duration:.2f}s "
                    f"dur={use_duration:.2f}s"
                )

        # Handle gap between last SRT entry and audio end
        # Add 0.5s safety margin so video track fully covers audio (prevents subtitle cutoff
        # from floating-point accumulation in segment durations during concat)
        target_video_duration = audio_duration + 0.5
        if current_timeline_pos < target_video_duration:
            gap = target_video_duration - current_timeline_pos
            logger.info(f"Extending timeline by {gap:.2f}s to cover audio duration + safety margin")

            if len(timeline) > intro_entry_count:
                last_entry = timeline[-1]
                # For large gaps, try to use a DIFFERENT segment than the last
                # to avoid visual repetition at the end of the video.
                if gap > 1.5 and segments_data:
                    alt_segments = [s for s in segments_data if s.get("source_video_path") != last_entry.source_video_path]
                    if alt_segments:
                        alt = max(alt_segments, key=lambda s: s.get("end_time", 0) - s.get("start_time", 0))
                        alt_start = alt.get("start_time", 0.0)
                        # F3: clamp to source EOF; loop-fill covers any shortfall.
                        alt_end = _clamp_end(alt.get("source_video_path"), alt_start, alt.get("end_time", alt_start + gap))
                        timeline.append(TimelineEntry(
                            source_video_path=alt.get("source_video_path"),
                            start_time=alt_start,
                            end_time=alt_end,
                            timeline_start=current_timeline_pos,
                            timeline_duration=gap,
                            transforms=alt.get("transforms"),
                        ))
                        logger.info(f"Gap fill: added diverse segment instead of extending last entry")
                    else:
                        # No alternative — extend last entry (clamped to EOF, F3)
                        timeline[-1] = TimelineEntry(
                            source_video_path=last_entry.source_video_path,
                            start_time=last_entry.start_time,
                            end_time=_clamp_end(last_entry.source_video_path, last_entry.start_time,
                                                last_entry.start_time + last_entry.timeline_duration + gap),
                            timeline_start=last_entry.timeline_start,
                            timeline_duration=last_entry.timeline_duration + gap,
                            transforms=last_entry.transforms,
                            pinned=last_entry.pinned,
                        )
                else:
                    # Small gap or no segments — extend the last entry (clamped, F3)
                    timeline[-1] = TimelineEntry(
                        source_video_path=last_entry.source_video_path,
                        start_time=last_entry.start_time,
                        end_time=_clamp_end(last_entry.source_video_path, last_entry.start_time,
                                            last_entry.start_time + last_entry.timeline_duration + gap),
                        timeline_start=last_entry.timeline_start,
                        timeline_duration=last_entry.timeline_duration + gap,
                        transforms=last_entry.transforms,
                        pinned=last_entry.pinned,
                    )
            elif segments_data:
                # Fallback: no timeline entries yet, use first available segment
                fallback = segments_data[0]
                source_video_path = fallback.get("source_video_path")
                segment_start = fallback.get("start_time", 0.0)
                segment_end = fallback.get("end_time", segment_start + gap)
                gap_entry = TimelineEntry(
                    source_video_path=source_video_path,
                    start_time=segment_start,
                    end_time=_clamp_end(source_video_path, segment_start, min(segment_end, segment_start + gap)),
                    timeline_start=current_timeline_pos,
                    timeline_duration=gap,
                )
                timeline.append(gap_entry)

        # Post-process: merge short consecutive entries into single segments to
        # meet min_segment_duration.  When a group of entries is merged, the
        # longest entry's source video is kept and its duration is extended to
        # cover the whole group — this eliminates rapid visual cuts.
        # IMPORTANT: intro micro-segments are preserved as-is (they're meant to be rapid).
        if min_segment_duration > 0 and len(timeline) > 1:
            merged = []
            # Preserve intro micro-segments untouched
            for intro_idx in range(intro_entry_count):
                merged.append(timeline[intro_idx])
            # Sliding window of recent representative paths — prevents repetition
            # across a wider range than just the immediately preceding group.
            # Track source_video_path for diversity (not exact coordinates, since
            # trimming can produce different start/end for visually identical content).
            recent_reps: list = []  # list of source_video_path strings
            # Dynamic window: at least 3, but scale with unique segment count
            # so small pools never repeat consecutively
            _unique_sources = set(e.source_video_path for e in timeline[intro_entry_count:])
            DIVERSITY_WINDOW = max(3, len(_unique_sources))

            i = intro_entry_count
            MAX_ITERATIONS = len(timeline) * 1000  # Safety cap to prevent infinite loops
            _iter_count = 0
            while i < len(timeline):
                _iter_count += 1
                if _iter_count > MAX_ITERATIONS:
                    logger.error(f"build_timeline merge loop exceeded {MAX_ITERATIONS} iterations, breaking")
                    break

                current = timeline[i]
                # Skip segments with zero/negative duration
                if current.timeline_duration <= 0.001:
                    i += 1
                    continue

                accumulated_duration = current.timeline_duration
                last_merged_idx = i

                # F6: a pinned entry never merges — it stays its own group at its
                # own duration, and it never absorbs following entries.
                if not current.pinned:
                    # Absorb following entries while under minimum, but stop before
                    # a pinned entry (it must start its own group).
                    while accumulated_duration < min_segment_duration and last_merged_idx + 1 < len(timeline):
                        if timeline[last_merged_idx + 1].pinned:
                            break
                        last_merged_idx += 1
                        # Skip zero-duration entries in accumulation
                        if timeline[last_merged_idx].timeline_duration <= 0.001:
                            continue
                        accumulated_duration += timeline[last_merged_idx].timeline_duration

                # Pick representative: avoid any source_video_path used in the
                # last DIVERSITY_WINDOW groups.  Compare by path only (not exact
                # coordinates) so trimmed variants of the same clip are still
                # caught as duplicates.  Prefer diversity FIRST, then duration.
                sub_entries = timeline[i:last_merged_idx + 1]
                recent_paths = set(recent_reps[-DIVERSITY_WINDOW:])

                # BUG-5 fix: Filter out zero-duration entries so they are never picked as representative
                sub_entries = [e for e in sub_entries if e.timeline_duration > 0.001]
                if not sub_entries:
                    # All entries are zero-duration — skip this group entirely
                    i = last_merged_idx + 1
                    continue

                # F6: if the group contains a pinned entry, it MUST be the
                # representative — the user's chosen clip cannot be swapped out.
                _pinned_in_group = [e for e in sub_entries if e.pinned]
                diverse_candidates = [
                    e for e in sub_entries
                    if e.source_video_path not in recent_paths
                ]
                if _pinned_in_group:
                    representative = _pinned_in_group[0]
                elif diverse_candidates:
                    # Among diverse candidates, pick longest
                    representative = max(diverse_candidates, key=lambda e: e.timeline_duration)
                elif len(recent_paths) > 1:
                    # All sub-entries share paths with recent — pick the one whose
                    # path was used LEAST recently (furthest back in recent_reps)
                    def _staleness(e):
                        try:
                            # Higher index = more recent, so we want lowest index
                            return -next(
                                j for j in range(len(recent_reps) - 1, -1, -1)
                                if recent_reps[j] == e.source_video_path
                            )
                        except StopIteration:
                            return 999  # not found = very stale = good
                    representative = max(sub_entries, key=_staleness)
                else:
                    representative = max(sub_entries, key=lambda e: e.timeline_duration)
                recent_reps.append(representative.source_video_path)

                # Extend end_time to cover accumulated_duration so FFmpeg doesn't
                # loop a short clip — but F3: clamp to the source's real length so
                # extraction never reads past EOF (the loop-fill covers shortfall).
                extended_end = _clamp_end(
                    representative.source_video_path,
                    representative.start_time,
                    max(representative.end_time, representative.start_time + accumulated_duration),
                )
                merged.append(TimelineEntry(
                    source_video_path=representative.source_video_path,
                    start_time=representative.start_time,
                    end_time=extended_end,
                    timeline_start=current.timeline_start,
                    timeline_duration=accumulated_duration,
                    transforms=representative.transforms,
                    pinned=representative.pinned,
                ))

                i = last_merged_idx + 1

            # If the last entry is shorter than minimum, absorb it into
            # the previous entry — but only if prev is a body entry (not intro).
            # F6: never absorb when either entry is pinned (would drop the user's clip).
            if (len(merged) >= 2 and merged[-1].timeline_duration < min_segment_duration
                    and len(merged) - 1 >= intro_entry_count
                    and not merged[-1].pinned and not merged[-2].pinned):
                last = merged.pop()
                prev = merged[-1]
                combined_duration = prev.timeline_duration + last.timeline_duration
                merged[-1] = TimelineEntry(
                    source_video_path=prev.source_video_path,
                    start_time=prev.start_time,
                    end_time=_clamp_end(prev.source_video_path, prev.start_time,
                                        max(prev.end_time, prev.start_time + combined_duration)),
                    timeline_start=prev.timeline_start,
                    timeline_duration=combined_duration,
                    transforms=prev.transforms,
                    pinned=prev.pinned,
                )
                logger.info(
                    f"Absorbed short last entry ({last.timeline_duration:.2f}s) into previous "
                    f"({prev.timeline_duration:.2f}s -> {combined_duration:.2f}s)"
                )

            logger.info(
                f"Merged timeline: {len(timeline)} entries -> {len(merged)} entries "
                f"(min_segment_duration={min_segment_duration}s)"
            )

            # --- Post-merge consecutive dedup pass ---
            # Scan for near-consecutive entries using the same clip region and
            # swap duplicates with an alternative from the full segment pool.
            # Uses a sliding window of DEDUP_WINDOW to catch repetition at
            # distance 2-3 (not just immediate neighbors).
            all_source_paths = list(_unique_sources)
            DEDUP_WINDOW = 3  # check last N entries for repetition

            # Build a pool of all available clips per source, sorted by
            # duration descending so we can rotate through them.
            _clips_by_source: dict = {}
            for e in timeline[intro_entry_count:]:
                if e.timeline_duration <= 0.001:
                    continue
                key = e.source_video_path
                clip_key = (e.source_video_path, round(e.start_time, 2))
                if key not in _clips_by_source:
                    _clips_by_source[key] = []
                # Avoid duplicate clip entries in the pool
                if not any(round(c.start_time, 2) == round(e.start_time, 2) for c in _clips_by_source[key]):
                    _clips_by_source[key].append(e)
            for key in _clips_by_source:
                _clips_by_source[key].sort(key=lambda e: e.end_time - e.start_time, reverse=True)

            def _clip_key(entry):
                """Identify a clip region by source + start position."""
                return (entry.source_video_path, round(entry.start_time, 2))

            dedup_swaps = 0
            for idx in range(intro_entry_count + 1, len(merged)):
                # F6: never swap a pinned entry — it's the user's explicit choice.
                if merged[idx].pinned:
                    continue
                # Collect clip keys used in the recent window
                window_start = max(intro_entry_count, idx - DEDUP_WINDOW)
                recent_clip_keys = {_clip_key(merged[j]) for j in range(window_start, idx)}
                recent_paths = {merged[j].source_video_path for j in range(window_start, idx)}

                current_clip_key = _clip_key(merged[idx])
                same_path_as_prev = merged[idx].source_video_path == merged[idx - 1].source_video_path
                same_clip_in_window = current_clip_key in recent_clip_keys

                if not same_path_as_prev and not same_clip_in_window:
                    continue  # No repetition issue

                # Also check next neighbor to avoid creating a new duplicate
                next_clip_key = _clip_key(merged[idx + 1]) if idx + 1 < len(merged) else None

                # Try to find a replacement clip not in the recent window
                best_replacement = None
                # 1. Prefer clips from a source path not in recent window
                for src_path in all_source_paths:
                    if src_path in recent_paths and len(all_source_paths) > 1:
                        continue
                    clips = _clips_by_source.get(src_path, [])
                    for clip in clips:
                        ck = _clip_key(clip)
                        if ck not in recent_clip_keys and ck != next_clip_key:
                            best_replacement = clip
                            break
                    if best_replacement:
                        break

                # 2. If no diverse-source clip found, try any clip not in window
                if not best_replacement:
                    for src_path in all_source_paths:
                        clips = _clips_by_source.get(src_path, [])
                        for clip in clips:
                            ck = _clip_key(clip)
                            if ck not in recent_clip_keys and ck != next_clip_key:
                                best_replacement = clip
                                break
                        if best_replacement:
                            break

                if best_replacement:
                    extended_end = _clamp_end(
                        best_replacement.source_video_path,
                        best_replacement.start_time,
                        max(best_replacement.end_time,
                            best_replacement.start_time + merged[idx].timeline_duration),
                    )
                    merged[idx] = TimelineEntry(
                        source_video_path=best_replacement.source_video_path,
                        start_time=best_replacement.start_time,
                        end_time=extended_end,
                        timeline_start=merged[idx].timeline_start,
                        timeline_duration=merged[idx].timeline_duration,
                        transforms=best_replacement.transforms,
                        pinned=merged[idx].pinned,
                    )
                    dedup_swaps += 1
            if dedup_swaps:
                logger.info(f"Post-merge dedup: swapped {dedup_swaps} near-consecutive duplicates")

            # Recalculate timeline_start cumulatively to avoid gaps after merging
            cumulative = 0.0
            for idx_m in range(len(merged)):
                if merged[idx_m].timeline_start != cumulative:
                    merged[idx_m] = TimelineEntry(
                        source_video_path=merged[idx_m].source_video_path,
                        start_time=merged[idx_m].start_time,
                        end_time=merged[idx_m].end_time,
                        timeline_start=cumulative,
                        timeline_duration=merged[idx_m].timeline_duration,
                        transforms=merged[idx_m].transforms,
                        pinned=merged[idx_m].pinned,
                    )
                cumulative += merged[idx_m].timeline_duration

            timeline = merged

        # F1: intro_offset_sec = total duration of the prepended intro (the body
        # begins at this timeline position). Callers shift SRT + delay audio by it.
        intro_offset_sec = sum(
            e.timeline_duration for e in timeline[:intro_entry_count]
        ) if intro_entry_count else 0.0

        total_duration = sum(e.timeline_duration for e in timeline)
        logger.info(
            f"Built timeline with {len(timeline)} entries, total duration: {total_duration:.2f}s, "
            f"intro_offset={intro_offset_sec:.2f}s"
        )

        return timeline, intro_offset_sec

    async def assemble_video(
        self,
        timeline: List[TimelineEntry],
        temp_dir: Path,
        interstitial_slides: Optional[List[dict]] = None,
        pip_overlays: Optional[Dict[str, dict]] = None,
        match_results: Optional[List] = None,
        _preview_mode: bool = False,
        strict_segments: bool = True,
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

        # Target output dimensions (portrait) — preview uses half-res
        if _preview_mode:
            target_w, target_h = 540, 960
        else:
            target_w, target_h = 1080, 1920

        # Extract each segment clip in parallel, throttled by semaphore.
        # Preview mode uses a dedicated semaphore so it never queues behind production.
        from app.services.segment_transforms import SegmentTransform
        from app.services.ffmpeg_semaphore import acquire_prep_slot, acquire_preview_prep_slot, is_nvenc_available
        from app.services import segment_cache
        # Pre-allocate ordered results list (None = failed)
        # Thread-safe: asyncio.gather runs coroutines on single thread
        results: List[Optional[Path]] = [None] * len(timeline)

        # F2: GPU decode for extraction when NVENC (and thus NVDEC) is present.
        # Plain -hwaccel cuda decodes on GPU but hands CPU frames to the filter
        # chain, and FFmpeg silently falls back to software decode when the
        # codec isn't supported — safe to apply unconditionally.
        _hwaccel_args = ["-hwaccel", "cuda"] if is_nvenc_available() else []

        # F2: per-segment cache hit/miss counters (logged after extraction)
        _cache_stats = {"hit": 0, "miss": 0}

        async def extract_segment(i: int, entry: TimelineEntry):
            segment_file = temp_dir / f"segment_{i:03d}.mp4"

            segment_duration = entry.end_time - entry.start_time
            needed_duration = entry.timeline_duration

            if segment_duration <= 0:
                logger.error(f"Timeline entry {i} has zero/negative segment_duration ({segment_duration:.4f}s), skipping")
                return

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

            if not entry.source_video_path:
                logger.error(f"Timeline entry {i} has no source_video_path, skipping")
                return

            if not Path(entry.source_video_path).exists():
                # Skip (don't abort the whole render) but make it loud: the final video
                # will be SHORTER by this segment. Common on desktop when a project's
                # source was added on another machine and its absolute path doesn't exist
                # locally. The message names the file so the user can re-add/relocate it.
                logger.error(
                    f"Source video missing for segment {i} — SKIPPED, final video will be "
                    f"incomplete. Re-add the file in Segments. Path: {entry.source_video_path}"
                )
                results[i] = None
                return

            logger.debug(f"Extracting segment {i}: {entry.source_video_path} [{entry.start_time:.2f}s - {entry.end_time:.2f}s]")

            segment_raw = None  # VID-14: track for cleanup
            try:
                # Preview mode: dedicated semaphore + shorter timeouts + lighter codec
                _slot_fn = acquire_preview_prep_slot if _preview_mode else acquire_prep_slot
                _extract_timeout = 60 if _preview_mode else 120
                _main_timeout = 120 if _preview_mode else 600
                _codec_params = (
                    get_prep_codec_params(preset="ultrafast", crf=28, include_audio=False)
                    if _preview_mode
                    else get_prep_codec_params(include_audio=False)
                )

                # F2: per-segment cache — identical extractions are reused across
                # renders, so an iterative edit only re-extracts what it changed.
                cache_key = segment_cache.make_key(
                    source_video_path=entry.source_video_path,
                    start_time=entry.start_time,
                    end_time=entry.end_time,
                    needed_duration=needed_duration,
                    use_loop=use_loop,
                    transform_filters=transform_filters,
                    codec_params=_codec_params,
                    fps=TARGET_FPS,
                )
                if cache_key and await asyncio.to_thread(segment_cache.lookup, cache_key, segment_file):
                    results[i] = segment_file
                    _cache_stats["hit"] += 1
                    logger.info(f"Segment {i}: cache HIT ({cache_key[:12]})")
                    return
                _cache_stats["miss"] += 1

                async with await _slot_fn():
                    cmd = ["ffmpeg", "-y", *_hwaccel_args]

                    if use_loop:
                        # Extract just the segment to a temp file, then loop it
                        # This prevents bleeding past segment end_time
                        segment_raw = temp_dir / f"segment_{i:03d}_raw.mp4"
                        extract_cmd = [
                            "ffmpeg", "-y", "-threads", "4",
                            *_hwaccel_args,
                            "-ss", str(entry.start_time),
                            "-i", entry.source_video_path,
                            "-t", str(segment_duration),
                            *get_prep_codec_params(preset="ultrafast", crf=18 if not _preview_mode else 28, include_audio=False),
                            "-r", str(TARGET_FPS),
                            "-fps_mode", "cfr",
                            "-video_track_timescale", "15360",
                            "-an", "-pix_fmt", "yuv420p",
                            str(segment_raw)
                        ]
                        result_extract = await asyncio.to_thread(
                            safe_ffmpeg_run, extract_cmd, _extract_timeout, "segment extract loop"
                        )
                        if result_extract.returncode != 0:
                            logger.error(f"Failed to extract raw segment {i}: {result_extract.stderr}")
                            return

                        # Loop the extracted segment (contains only segment content)
                        loop_count = math.ceil(needed_duration / segment_duration)
                        cmd.extend([
                            "-stream_loop", str(loop_count - 1),
                            "-i", str(segment_raw),
                            "-t", str(needed_duration),
                            "-vf", ",".join(transform_filters),
                        ])
                    else:
                        # Without loop, -ss before -i enables fast seeking
                        # CRITICAL: clamp to segment_duration so FFmpeg never reads past
                        # the user-defined segment end_time boundary
                        clamped_duration = min(needed_duration, segment_duration)
                        cmd.extend([
                            "-ss", str(entry.start_time),
                            "-i", entry.source_video_path,
                            "-t", str(clamped_duration),
                            "-vf", ",".join(transform_filters),
                        ])

                    cmd.extend([
                        *_codec_params,
                        "-r", str(TARGET_FPS),
                        "-fps_mode", "cfr",
                        "-video_track_timescale", "15360",
                        "-force_key_frames", "expr:eq(n,0)",
                        "-threads", "4",
                        "-an",
                        "-pix_fmt", "yuv420p",
                        str(segment_file)
                    ])

                    result = await asyncio.to_thread(safe_ffmpeg_run, cmd, _main_timeout, "segment extract")

                if result.returncode == 0 and segment_file.exists():
                    results[i] = segment_file
                    # F2: publish to the segment cache for future renders
                    if cache_key:
                        await asyncio.to_thread(segment_cache.store, cache_key, segment_file)
                else:
                    logger.error(f"Failed to extract segment {i}: {result.stderr}")
            finally:
                # VID-14: Clean up intermediate raw segment file used for looping
                if segment_raw is not None:
                    try:
                        segment_raw.unlink(missing_ok=True)
                    except Exception:
                        pass

        logger.info(f"Extracting {len(timeline)} segments in parallel (throttled by global prep semaphore)")
        await asyncio.gather(*(extract_segment(i, entry) for i, entry in enumerate(timeline)))
        logger.info(
            f"Segment cache: {_cache_stats['hit']} hits, {_cache_stats['miss']} misses "
            f"({len(timeline)} segments)"
        )

        # Apply PiP overlays to extracted segments (before collecting into segment_files)
        if pip_overlays and match_results:
            from app.services.video_effects.overlay_renderer import apply_pip_overlay
            for i, entry in enumerate(timeline):
                if i < len(match_results):
                    seg_id = match_results[i].segment_id
                    if seg_id and seg_id in pip_overlays:
                        pip = pip_overlays[seg_id]
                        seg_file = results[i]
                        if seg_file and seg_file.exists():
                            pip_output = temp_dir / f"segment_{i:03d}_pip.mp4"
                            try:
                                result_path = await apply_pip_overlay(
                                    video_path=seg_file,
                                    image_url_or_path=pip["image_url"],
                                    output_path=pip_output,
                                    position=pip.get("position", "bottom-right"),
                                    size=pip.get("size", "medium"),
                                    animation=pip.get("animation", "static"),
                                )
                                if result_path != seg_file:
                                    results[i] = result_path
                                    logger.info(f"PiP overlay applied to segment {i} (segment_id={seg_id})")
                            except Exception as e:
                                logger.warning(f"PiP overlay failed for segment {i} (segment_id={seg_id}): {e}")

        # Collect successful segments in order (preserves original timeline ordering)
        segment_files = [f for i, f in enumerate(results) if f is not None]
        failed_count = len(results) - len(segment_files)

        if failed_count == len(results):
            raise RuntimeError(f"All {len(results)} segments failed to extract — cannot assemble video")

        if failed_count > 0:
            failed_segments = [
                {
                    "index": i,
                    "source": timeline[i].source_video_path,
                    "start": timeline[i].start_time,
                    "end": timeline[i].end_time,
                }
                for i, result_path in enumerate(results)
                if result_path is None
            ]
            if strict_segments:
                raise RuntimeError(
                    f"{failed_count}/{len(results)} segments failed to extract: "
                    f"{failed_segments}"
                )
            logger.warning(
                f"{failed_count}/{len(results)} segments failed to extract — "
                f"assembled video will be shorter than expected"
            )

        # Generate and insert interstitial slide clips into segment list
        if interstitial_slides:
            from app.services.video_effects.overlay_renderer import generate_interstitial_clip
            # Sort slides by afterMatchIndex
            sorted_slides = sorted(interstitial_slides, key=lambda s: s.get("afterMatchIndex", -1))
            # Build insertion map: afterMatchIndex -> list of clip paths
            slide_clips: Dict[int, List[Path]] = {}
            for slide in sorted_slides:
                idx = slide.get("afterMatchIndex", -1)
                slide_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', str(slide.get('id', 'x')))
                clip_path = temp_dir / f"interstitial_{slide_id}.mp4"
                try:
                    result = await generate_interstitial_clip(
                        image_url_or_path=slide["imageUrl"],
                        output_path=clip_path,
                        duration=slide.get("duration", 2.0),
                        animation=slide.get("animation", "static"),
                        ken_burns_direction=slide.get("kenBurnsDirection", "zoom-in"),
                        # Must match the extracted segments exactly — a 1080x1920
                        # slide in a 540x960 preview concat corrupts the stream.
                        width=target_w,
                        height=target_h,
                        fps=TARGET_FPS,
                    )
                    if result and result.exists():
                        slide_clips.setdefault(idx, []).append(result)
                        logger.info(f"Interstitial slide generated at afterMatchIndex={idx}: {clip_path.name}")
                except Exception as e:
                    logger.warning(f"Interstitial slide generation failed (afterMatchIndex={idx}): {e}")

            # Rebuild segment_files list with interstitials inserted
            if slide_clips:
                new_files: List[Path] = []
                # Insert slides before first segment (afterMatchIndex == -1)
                for clip in slide_clips.get(-1, []):
                    new_files.append(clip)
                for i, seg_file in enumerate(segment_files):
                    new_files.append(seg_file)
                    # Insert slides after segment i
                    for clip in slide_clips.get(i, []):
                        new_files.append(clip)
                segment_files = new_files
                logger.info(f"Interstitial slides inserted: {len(segment_files)} total clips in concat list")

        # Create concat list file
        concat_file = temp_dir / "concat_list.txt"
        with open(concat_file, 'w', encoding='utf-8') as f:
            for seg_file in segment_files:
                # Normalise to forward slashes so FFmpeg concat works on Windows
                posix_path = str(seg_file).replace("\\", "/")
                # Escape single quotes for FFmpeg
                escaped = posix_path.replace("'", "\\'")
                f.write(f"file '{escaped}'\n")

        # Concatenate all clips
        assembled_path = temp_dir / "assembled_video.mp4"

        cmd = [
            "ffmpeg", "-y", "-threads", "4",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_file),
            "-c", "copy",
            "-video_track_timescale", "15360",
            str(assembled_path)
        ]

        _concat_timeout = 120 if _preview_mode else 600
        logger.info(f"Concatenating {len(segment_files)} segments{' (preview)' if _preview_mode else ''}")

        result = await asyncio.to_thread(safe_ffmpeg_run, cmd, _concat_timeout, "assembly concat")
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
        voice_volume: float = 1.0,
        audio_fade_in: float = 0.0,
        audio_fade_out: float = 0.0,
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
        max_words_per_phrase: int = 2,
        min_segment_duration: float = 3.0,
        ultra_rapid_intro: bool = True,
        interstitial_slides: Optional[List[dict]] = None,
        pip_overlays: Optional[Dict[str, dict]] = None,
        avoid_segment_ids: Optional[set] = None,
        _preview_mode: bool = False,
        subtitle_style_override: Optional[Dict[str, object]] = None,
        visual_version_label: Optional[str] = None,
        output_project_label: Optional[str] = None,
        output_script_label: Optional[str] = None,
        output_created_at: Optional[datetime] = None,
        force_cpu: bool = False,
        strict_segments: bool = True,
        preset: str = "balanced",
        pinned_assignments: Optional[Dict[int, str]] = None,
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

        repo = get_repository()
        if not repo:
            raise RuntimeError("Repository not available")

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
                    voice_settings=voice_settings,
                    temp_dir=temp_dir
                )
                _report("TTS audio ready", 25)

            # Step 2: Generate SRT from timestamps (with cache — use cleaned text for cache key)
            logger.info("Step 2/7: Generating SRT subtitles from timestamps")
            _report("Generating subtitles", 30)
            # Karaoke guard: the preview/Step-2 SRT is always generated WITHOUT
            # karaoke tags (preview has no subtitle_settings), so reusing it when
            # karaoke is requested would silently drop the per-word {\k} highlight.
            # Detect karaoke tags in the cached content and force regeneration on mismatch.
            _want_karaoke = bool((subtitle_settings or {}).get("karaoke", False))
            _reused_has_karaoke = bool(reuse_srt_content) and "{\\k" in reuse_srt_content
            if reuse_srt_content and skip_library_save and (not _want_karaoke or _reused_has_karaoke):
                srt_content = reuse_srt_content
                logger.info("Step 2/7: Reusing existing SRT content")
            else:
                if reuse_srt_content and _want_karaoke and not _reused_has_karaoke:
                    logger.info("Step 2/7: Cached SRT lacks karaoke tags — regenerating for karaoke captions")
                from app.services.tts_cache import srt_cache_lookup, srt_cache_store
                _vs = voice_settings or {}
                _vs_hash = f"{_vs.get('stability', 0.5):.2f}_{_vs.get('similarity_boost', 0.75):.2f}_{_vs.get('speed', 1.0):.2f}"
                _srt_cache_key = {"text": cleaned_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts", "wpf": max_words_per_phrase, "vs": _vs_hash, "karaoke": bool((subtitle_settings or {}).get("karaoke", False))}
                cached_srt = srt_cache_lookup(_srt_cache_key)
                if cached_srt:
                    srt_content = cached_srt
                elif timestamps:
                    srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase, karaoke=bool((subtitle_settings or {}).get("karaoke", False)))
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
                        voice_settings=voice_settings,
                        temp_dir=temp_dir
                    )
                    srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase, karaoke=bool((subtitle_settings or {}).get("karaoke", False)))

            if not srt_content:
                raise RuntimeError("SRT subtitle generation failed — no content produced")

            srt_path = temp_dir / "subtitles.srt"
            with open(srt_path, 'w', encoding='utf-8') as f:
                f.write(sanitize_srt_full(srt_content))

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
            from app.repositories.models import QueryFilters
            seg_filters = QueryFilters(
                select="id, source_video_id, start_time, end_time, keywords, transforms, thumbnail_path, product_group, single_use, editai_source_videos(file_path)",
                order_by="id", order_desc=False,
            )
            if source_video_ids:
                seg_filters.in_["source_video_id"] = source_video_ids
            segments_result = repo.list_segments(profile_id, filters=seg_filters)

            if not segments_result.data:
                raise RuntimeError("No segments found in library. Please create segments first.")

            # Build segments data with source video paths
            segments_data = []
            for seg in segments_result.data:
                source_video_path = normalize_path((seg.get("editai_source_videos") or {}).get("file_path", ""))
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
                        "single_use": seg.get("single_use", False),
                    })

            logger.info(f"Loaded {len(segments_data)} segments from library")

            if not segments_data:
                raise RuntimeError(
                    "No usable segments found — all segments are missing source video file paths. "
                    "Please re-upload source videos or re-create segments."
                )

            # When match_overrides are present, ensure ALL referenced segments
            # are in segments_data — even if they weren't returned by the filtered
            # query.  This prevents fallback-to-first-segment when the override
            # references a segment from a source video outside the current filter.
            if match_overrides:
                existing_seg_ids = {seg["id"] for seg in segments_data}
                missing_seg_ids = [
                    m.get("segment_id") for m in match_overrides
                    if m.get("segment_id") and m["segment_id"] not in existing_seg_ids
                ]
                if missing_seg_ids:
                    logger.info(
                        f"Fetching {len(missing_seg_ids)} override segments missing from "
                        f"filtered query: {missing_seg_ids[:5]}..."
                    )
                    missing_filters = QueryFilters(
                        select="id, source_video_id, start_time, end_time, keywords, transforms, thumbnail_path, product_group, single_use, editai_source_videos(file_path)",
                        in_={"id": missing_seg_ids},
                        eq={"profile_id": profile_id},
                    )
                    missing_result = repo.table_query("editai_segments", "select", filters=missing_filters)
                    added = 0
                    for seg in (missing_result.data or []):
                        sv_path = (seg.get("editai_source_videos") or {}).get("file_path")
                        if sv_path:
                            segments_data.append({
                                "id": seg["id"],
                                "source_video_id": seg["source_video_id"],
                                "start_time": seg["start_time"],
                                "end_time": seg["end_time"],
                                "duration": seg["end_time"] - seg["start_time"],
                                "keywords": seg.get("keywords") or [],
                                # Normalize like the main build path (line ~1966) so a
                                # WSL /mnt/... path stored on a web machine resolves on
                                # Windows desktop, keeping exists()/ffmpeg consistent.
                                "source_video_path": normalize_path(sv_path),
                                "transforms": seg.get("transforms"),
                                "thumbnail_path": seg.get("thumbnail_path"),
                                "product_group": seg.get("product_group"),
                                "single_use": seg.get("single_use", False),
                            })
                            added += 1
                    if added:
                        logger.info(f"Added {added} missing override segments to segments_data")

                # Also pre-build a source_video_id -> file_path map from overrides'
                # source_video_ids so the reconstruction path in build_timeline can
                # always resolve the video file path.
                override_sv_ids = {
                    m.get("source_video_id") for m in match_overrides
                    if m.get("source_video_id")
                }
                existing_sv_ids = {seg["source_video_id"] for seg in segments_data}
                missing_sv_ids = list(override_sv_ids - existing_sv_ids)
                if missing_sv_ids:
                    logger.info(
                        f"Fetching file paths for {len(missing_sv_ids)} source videos "
                        f"referenced by overrides but not in segments_data"
                    )
                    sv_result = repo.table_query(
                        "editai_source_videos", "select",
                        filters=QueryFilters(
                            select="id, file_path",
                            in_={"id": missing_sv_ids},
                        ),
                    )
                    # Store as synthetic segment entries so build_timeline can find sv_path
                    for sv in (sv_result.data or []):
                        if sv.get("file_path"):
                            segments_data.append({
                                "id": f"_sv_placeholder_{sv['id']}",
                                "source_video_id": sv["id"],
                                "start_time": 0.0,
                                "end_time": 0.0,
                                "duration": 0.0,
                                "keywords": [],
                                "source_video_path": normalize_path(sv["file_path"]),
                                "transforms": None,
                                "thumbnail_path": None,
                                "product_group": None,
                            })
                    logger.info(f"Added {len(sv_result.data or [])} source video path placeholders")

            # Assign product groups from script tags to SRT entries
            srt_product_groups = assign_groups_to_srt(script_text, srt_entries)

            # Step 5: Match SRT to segments (or apply timeline editor overrides)
            _report("Matching segments to script", 50)
            if match_overrides:
                # Diagnostic: log segment IDs from overrides vs available segments
                override_seg_ids = {m.get("segment_id") for m in match_overrides if m.get("segment_id")}
                available_seg_ids = {seg["id"] for seg in segments_data}
                missing_ids = override_seg_ids - available_seg_ids
                if missing_ids:
                    logger.warning(
                        f"Step 5/7: {len(missing_ids)} override segment IDs NOT in DB query results: "
                        f"{list(missing_ids)[:5]}... (total available: {len(available_seg_ids)})"
                    )
                logger.info(
                    f"Step 5/7: Applying {len(match_overrides)} match overrides from timeline editor "
                    f"({len(override_seg_ids)} unique segments, {len(missing_ids)} missing)"
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
                        is_auto_filled=m.get("is_auto_filled", False),
                        product_group=m.get("product_group"),
                        source_video_id=m.get("source_video_id"),
                        segment_start_time=m.get("segment_start_time"),
                        segment_end_time=m.get("segment_end_time"),
                        thumbnail_path=m.get("thumbnail_path"),
                        transforms=m.get("transforms"),
                        explanation=m.get("explanation"),
                        pinned=m.get("pinned", False),  # F6: honor user lock
                    )
                    for m in match_overrides
                ]
                # Clamp srt_start/srt_end to valid ranges
                for mr in match_results:
                    mr.srt_start = max(0.0, mr.srt_start)
                    if mr.srt_end <= mr.srt_start:
                        mr.srt_end = mr.srt_start + 0.1

                # Extract duration overrides (parallel list, None where not overridden)
                duration_overrides = [m.get("duration_override") for m in match_overrides]

                # ── Collapse entries by merge_group ───────────────────────
                # The frontend sends one entry per SRT phrase (e.g. 28 entries
                # of ~0.3-0.5s each).  Entries that share the same merge_group
                # must be collapsed into a single MatchResult so that
                # build_timeline sees properly-sized segments (≥ min_segment_duration)
                # instead of producing rapid cuts for the entire video.
                _pre_collapse = len(match_results)
                _original_matches = match_results  # keep ref before overwrite
                has_groups = any(m.get("merge_group") is not None for m in match_overrides)
                if has_groups:
                    # Group match_results indices by merge_group
                    grouped: dict[int, list[int]] = {}  # group -> [indices]
                    group_order: list[int] = []
                    for i_m in range(len(match_results)):
                        g = match_overrides[i_m].get("merge_group", i_m)
                        if g not in grouped:
                            grouped[g] = []
                            group_order.append(g)
                        grouped[g].append(i_m)

                    collapsed: list[MatchResult] = []
                    collapsed_dur_overrides: list = []
                    for g in group_order:
                        indices = grouped[g]
                        entries = [_original_matches[i] for i in indices]
                        # F6: a pinned entry MUST be the representative so the
                        # user's chosen clip survives collapse; else longest entry.
                        _pinned = [e for e in entries if getattr(e, "pinned", False)]
                        rep = _pinned[0] if _pinned else max(entries, key=lambda e: e.srt_end - e.srt_start)
                        collapsed.append(MatchResult(
                            srt_index=rep.srt_index,
                            srt_text=" ".join(e.srt_text for e in entries if e.srt_text),
                            srt_start=entries[0].srt_start,
                            srt_end=entries[-1].srt_end,
                            segment_id=rep.segment_id,
                            segment_keywords=rep.segment_keywords,
                            matched_keyword=rep.matched_keyword,
                            confidence=rep.confidence,
                            is_auto_filled=rep.is_auto_filled,
                            product_group=rep.product_group,
                            source_video_id=rep.source_video_id,
                            segment_start_time=rep.segment_start_time,
                            segment_end_time=rep.segment_end_time,
                            thumbnail_path=rep.thumbnail_path,
                            transforms=rep.transforms,
                            explanation=rep.explanation,
                            pinned=bool(_pinned),
                        ))
                        # F7: collapsed override = SUM of the group's overrides
                        # (entries without an explicit override count at their
                        # natural SRT duration), so total requested time is preserved.
                        _any_override = any(
                            match_overrides[i].get("duration_override") is not None for i in indices
                        )
                        if _any_override:
                            group_dur_ov = 0.0
                            for i in indices:
                                ov = match_overrides[i].get("duration_override")
                                if ov is not None:
                                    group_dur_ov += ov
                                else:
                                    group_dur_ov += (_original_matches[i].srt_end - _original_matches[i].srt_start)
                        else:
                            group_dur_ov = None
                        collapsed_dur_overrides.append(group_dur_ov)

                    match_results = collapsed
                    duration_overrides = collapsed_dur_overrides
                    logger.info(
                        f"Step 5/7: Collapsed {_pre_collapse} entries → {len(match_results)} "
                        f"groups via merge_group metadata"
                    )
                else:
                    logger.info(
                        f"Step 5/7: Keeping all {len(match_results)} entries "
                        f"(no merge_group metadata — legacy path)"
                    )
                # Log render entries for debugging
                for c_idx, c_match in enumerate(match_results):
                    seg_id_short = (c_match.segment_id or "NONE")[:8]
                    logger.info(
                        f"  render_entry[{c_idx}]: seg={seg_id_short}... "
                        f"srt={c_match.srt_start:.2f}-{c_match.srt_end:.2f}s "
                        f"({c_match.srt_end - c_match.srt_start:.2f}s)"
                    )
            else:
                logger.info("Step 5/7: Matching SRT phrases to segments")
                _ai_assignments = None
                if preset == "ai_smart":
                    _ai_assignments = await asyncio.to_thread(
                        self._ai_match_segments, srt_entries, segments_data, profile_id
                    )
                match_results = self.match_srt_to_segments(
                    srt_entries=srt_entries,
                    segments_data=segments_data,
                    min_confidence=0.3,
                    variant_index=variant_index,
                    srt_product_groups=srt_product_groups,
                    avoid_segment_ids=avoid_segment_ids,
                    preset=preset,
                    pinned_assignments=pinned_assignments,
                    ai_assignments=_ai_assignments,
                )
                duration_overrides = None

            # Step 6: Build timeline
            logger.info("Step 6/7: Building video timeline")
            _report("Building video timeline", 60)
            # When match_overrides are provided, the collapse pass above already
            # reduced N entries to M groups using merge_group metadata.
            # The collapsed entries are already ≥ min_segment_duration each,
            # so the merge pass in build_timeline won't change them further.
            # Ultra-rapid intro is passed through so it appears in the render
            # just as it did in the preview.
            timeline, intro_offset_sec = self.build_timeline(
                match_results=match_results,
                segments_data=segments_data,
                audio_duration=audio_duration,
                duration_overrides=duration_overrides,
                variant_index=variant_index,
                min_segment_duration=min_segment_duration,
                ultra_rapid_intro=ultra_rapid_intro
            )

            # Log final render timeline for debugging
            for t_idx, t_entry in enumerate(timeline):
                src_name = Path(t_entry.source_video_path).name if t_entry.source_video_path else "NONE"
                seg_dur = t_entry.end_time - t_entry.start_time
                will_loop = seg_dur < t_entry.timeline_duration - 0.05
                logger.info(
                    f"  render_timeline[{t_idx}]: src={src_name} "
                    f"clip={t_entry.start_time:.2f}-{t_entry.end_time:.2f}s ({seg_dur:.2f}s) "
                    f"timeline_dur={t_entry.timeline_duration:.2f}s "
                    f"{'LOOP' if will_loop else 'ok'}"
                )

            # F1: the ultra-rapid intro pushes the body forward by intro_offset_sec,
            # but the SRT/audio start at t=0. Shift the burned-in SRT and (below)
            # delay the audio track by the same offset so captions/voiceover stay
            # aligned with the body. The library-saved SRT content stays unshifted.
            if intro_offset_sec > 0:
                with open(srt_path, 'w', encoding='utf-8') as f:
                    f.write(shift_srt(sanitize_srt_full(srt_content), intro_offset_sec))
                logger.info(f"Shifted burned-in SRT by intro offset {intro_offset_sec:.2f}s")

            # Step 7: Assemble video
            logger.info("Step 7/7: Assembling and rendering final video")
            _report("Assembling video segments", 70)
            assembled_video_path = await self.assemble_video(
                timeline=timeline,
                temp_dir=temp_dir,
                interstitial_slides=interstitial_slides,
                pip_overlays=pip_overlays,
                match_results=match_results,
                _preview_mode=_preview_mode,
                strict_segments=strict_segments,
            )

            # Render with preset and subtitle settings
            _report("Rendering final video", 85)
            output_dir = self.settings.output_dir / profile_id
            output_dir.mkdir(parents=True, exist_ok=True)

            output_stem = build_output_basename(
                variant_index=variant_index,
                visual_version_label=visual_version_label,
                preset_name=preset_data.get("name"),
                project_label=output_project_label,
                script_label=output_script_label or script_text,
                created_at=output_created_at,
            )
            final_output_path = output_dir / f"{output_stem}_{uuid.uuid4().hex[:8]}.mp4"

            # Save pre-subtitle assembly for voiceover regeneration
            raw_assembly_path = output_dir / f"{final_output_path.stem}_raw.mp4"
            import shutil as _shutil
            _shutil.copy2(str(assembled_video_path), str(raw_assembly_path))
            logger.info(f"Saved raw assembly (no subtitles): {raw_assembly_path}")

            # BUG-2 fix: Always sync shadow/glow/adaptive into subtitle_settings
            # (write both True and False to prevent stale values from DB)
            if subtitle_settings is None:
                subtitle_settings = {}
            subtitle_settings["shadowDepth"] = shadow_depth
            subtitle_settings["enableGlow"] = enable_glow
            subtitle_settings["glowBlur"] = glow_blur if enable_glow else 0
            subtitle_settings["adaptiveSizing"] = adaptive_sizing

            # Meta render multiplication: override subtitle style per visual version
            if subtitle_style_override:
                subtitle_settings.update(subtitle_style_override)

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
                saturation=saturation,
                voice_volume=voice_volume,
                audio_fade_in=audio_fade_in,
                audio_fade_out=audio_fade_out,
                _preview_mode=_preview_mode,
                force_cpu=force_cpu,
                intro_offset_sec=intro_offset_sec,  # F1: delay audio by intro length
                # Real encode progress fills the 85%->99% band (replaces the
                # fake freeze at 85%). _report no-ops when no on_progress consumer.
                on_encode_progress=(
                    (lambda f: _report("Rendering final video", min(99, 85 + int(round(14 * f)))))
                    if on_progress else None
                ),
            )

            logger.info(f"Assembly complete: {final_output_path}")

            # Serialize match_results for persistence (segment composition)
            segment_composition = [
                {
                    "srt_index": mr.srt_index,
                    "srt_text": mr.srt_text,
                    "srt_start": mr.srt_start,
                    "srt_end": mr.srt_end,
                    "segment_id": mr.segment_id,
                    "segment_keywords": mr.segment_keywords,
                    "matched_keyword": mr.matched_keyword,
                    "confidence": mr.confidence,
                    "is_auto_filled": mr.is_auto_filled,
                    "product_group": mr.product_group,
                    "source_video_id": mr.source_video_id,
                    "segment_start_time": mr.segment_start_time,
                    "segment_end_time": mr.segment_end_time,
                    "thumbnail_path": mr.thumbnail_path,
                    "transforms": mr.transforms,
                    "explanation": mr.explanation,
                    "pinned": mr.pinned,
                }
                for mr in match_results
            ]

            return final_output_path, raw_assembly_path, segment_composition

        except Exception as e:
            logger.error(f"Assembly failed: {e}")
            raise
        finally:
            try:
                import shutil
                if reuse_audio_path and str(Path(reuse_audio_path).resolve()).startswith(str(temp_dir.resolve())):
                    safe_audio_dir = self.settings.base_dir / "temp" / profile_id / "reused_audio"
                    safe_audio_dir.mkdir(parents=True, exist_ok=True)
                    safe_dest = safe_audio_dir / Path(reuse_audio_path).name
                    shutil.copy2(reuse_audio_path, safe_dest)
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

    async def assemble_and_render_preview(
        self,
        script_text: str,
        profile_id: str,
        pipeline_id: str,
        variant_index: int = 0,
        match_overrides: Optional[List[dict]] = None,
        source_video_ids: Optional[List[str]] = None,
        reuse_audio_path: Optional[str] = None,
        reuse_audio_duration: Optional[float] = None,
        reuse_srt_content: Optional[str] = None,
        subtitle_settings: Optional[dict] = None,
        min_segment_duration: float = 3.0,
        on_progress=None,
        max_words_per_phrase: int = 2,
        voice_settings: Optional[dict] = None,
        avoid_segment_ids: Optional[set] = None,
        ultra_rapid_intro: bool = True,
        voice_id: Optional[str] = None,
        elevenlabs_model: str = "eleven_flash_v2_5",
        interstitial_slides: Optional[List[dict]] = None,
        pip_overlays: Optional[Dict[str, dict]] = None,
        enable_denoise: bool = False,
        denoise_strength: float = 2.0,
        enable_sharpen: bool = False,
        sharpen_amount: float = 0.5,
        enable_color: bool = False,
        brightness: float = 0.0,
        contrast: float = 1.0,
        saturation: float = 1.0,
        voice_volume: float = 1.0,
        audio_fade_in: float = 0.0,
        audio_fade_out: float = 0.0,
        subtitle_style_override: Optional[Dict[str, object]] = None,
        visual_version_label: Optional[str] = None,
    ) -> Path:
        """
        Fast preview render using assemble_and_render() with preview-mode settings.

        Uses 540x960, ultrafast encoding, CRF 32, and no loudnorm. Produces a real MP4 that matches the final render's
        segment order exactly (including ultra_rapid_intro if enabled).

        Returns:
            Path to the preview MP4 file.
        """
        # Build a lightweight 540x960 preset
        # subtitle_ref_width/height ensure subtitle positioning matches the final
        # 1080x1920 render even though the preview is encoded at half resolution
        preview_preset = {
            "name": "Preview",
            "width": 540,
            "height": 960,
            "subtitle_ref_width": 1080,
            "subtitle_ref_height": 1920,
            "fps": 30,
            "video_codec": "libx264",
            "audio_codec": "aac",
            "video_bitrate": "1M",
            "audio_bitrate": "128k",
            "extra_flags": "-movflags +faststart",
        }

        # Extract subtitle style params so they match the final render
        # (assemble_and_render overwrites these keys in subtitle_settings
        # with function-parameter values, so we must pass them explicitly)
        _ss = subtitle_settings or {}
        final_path, _raw_path, _seg_comp = await self.assemble_and_render(
            script_text=script_text,
            profile_id=profile_id,
            preset_data=preview_preset,
            subtitle_settings=subtitle_settings,
            match_overrides=match_overrides,
            source_video_ids=source_video_ids,
            reuse_audio_path=reuse_audio_path,
            reuse_audio_duration=reuse_audio_duration,
            reuse_srt_content=reuse_srt_content,
            on_progress=on_progress,
            max_words_per_phrase=max_words_per_phrase,
            min_segment_duration=min_segment_duration,
            voice_settings=voice_settings,
            avoid_segment_ids=avoid_segment_ids,
            voice_id=voice_id,
            elevenlabs_model=elevenlabs_model,
            enable_denoise=enable_denoise,
            denoise_strength=denoise_strength,
            enable_sharpen=enable_sharpen,
            sharpen_amount=sharpen_amount,
            enable_color=enable_color,
            brightness=brightness,
            contrast=contrast,
            saturation=saturation,
            voice_volume=voice_volume,
            audio_fade_in=audio_fade_in,
            audio_fade_out=audio_fade_out,
            # Pass through subtitle style params to match final render output
            shadow_depth=_ss.get("shadowDepth", 0),
            enable_glow=_ss.get("enableGlow", False),
            glow_blur=_ss.get("glowBlur", 0),
            adaptive_sizing=_ss.get("adaptiveSizing", False),
            ultra_rapid_intro=ultra_rapid_intro,
            interstitial_slides=interstitial_slides,
            pip_overlays=pip_overlays,
            variant_index=variant_index,
            _preview_mode=True,
            subtitle_style_override=subtitle_style_override,
            visual_version_label=visual_version_label,
        )
        # Preview doesn't need the raw assembly — clean it up
        try:
            if _raw_path and _raw_path.exists():
                _raw_path.unlink()
        except Exception:
            pass
        return final_path

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
        max_words_per_phrase: int = 2,
        min_segment_duration: float = 3.0,
        avoid_segment_ids: Optional[set] = None,
        ultra_rapid_intro: bool = True,
        reuse_srt_content: Optional[str] = None,
        subtitle_settings: Optional[dict] = None,
        preset: str = "balanced"
    ) -> dict:
        """
        Preview-only: TTS -> SRT -> match -> timeline (no rendering).

        Returns preview data showing matches and timeline without expensive render.

        Returns:
            Dict with {audio_path, audio_duration, srt_content, matches, timeline, unmatched_count, total_phrases}
        """
        repo = get_repository()
        if not repo:
            raise RuntimeError("Repository not available")

        # Strip [ProductGroup] tags before TTS (tags must not be spoken)
        cleaned_text = strip_product_group_tags(script_text)

        # Step 1: Generate TTS with timestamps (or reuse existing)
        # BUG-4 fix: Verify reuse_audio_path exists before using it
        if reuse_audio_path and reuse_audio_duration and not Path(reuse_audio_path).exists():
            logger.warning(f"reuse_audio_path does not exist, forcing TTS regeneration: {reuse_audio_path}")
            reuse_audio_path = None
            reuse_audio_duration = None
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
        # Include voice_settings hash — different speed/stability produces different timing
        _vs = voice_settings or {}
        _vs_hash = f"{_vs.get('stability', 0.5):.2f}_{_vs.get('similarity_boost', 0.75):.2f}_{_vs.get('speed', 1.0):.2f}"
        _srt_cache_key = {"text": cleaned_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts", "wpf": max_words_per_phrase, "vs": _vs_hash, "karaoke": bool((subtitle_settings or {}).get("karaoke", False))}

        srt_content = ""
        if reuse_srt_content:
            # SRT already available from Step 2 tts_previews — use directly
            srt_content = reuse_srt_content
            logger.info("Preview Step 2/4: Reusing SRT content from Step 2 tts_previews")
            # Populate SRT cache so future calls (render, etc.) also hit cache
            srt_cache_store(_srt_cache_key, srt_content)
        else:
            cached_srt = srt_cache_lookup(_srt_cache_key)
            if cached_srt:
                srt_content = cached_srt
            elif timestamps:
                srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase, karaoke=bool((subtitle_settings or {}).get("karaoke", False)))
                if srt_content:
                    srt_cache_store(_srt_cache_key, srt_content)
            else:
                # Reusing audio but no SRT available — regenerate TTS only for timestamps
                # IMPORTANT: Do NOT overwrite audio_path — keep the original Step 2 audio
                logger.info("Preview Step 2/4: SRT cache miss, regenerating TTS for timestamps only")
                _, _, timestamps = await self.generate_tts_with_timestamps(
                    script_text=cleaned_text,
                    profile_id=profile_id,
                    elevenlabs_model=elevenlabs_model,
                    voice_id=voice_id,
                    voice_settings=voice_settings
                )
                srt_content = await self.generate_srt_from_timestamps(timestamps, max_words_per_phrase=max_words_per_phrase, karaoke=bool((subtitle_settings or {}).get("karaoke", False)))
                if srt_content:
                    srt_cache_store(_srt_cache_key, srt_content)

        if not srt_content:
            raise RuntimeError("SRT subtitle generation failed — no content produced in preview_matches")
        srt_entries = self._parse_srt(srt_content)

        # Assign product groups from script tags to SRT entries
        srt_product_groups = assign_groups_to_srt(script_text, srt_entries)

        # Step 3: Fetch segments
        logger.info("Preview Step 3/4: Fetching segments from library")
        if source_video_ids:
            logger.info(f"Filtering to {len(source_video_ids)} source video(s)")
        from app.repositories.models import QueryFilters
        preview_seg_filters = QueryFilters(
            select="id, source_video_id, start_time, end_time, keywords, transforms, thumbnail_path, product_group, editai_source_videos(file_path)",
            order_by="id", order_desc=False,
        )
        if source_video_ids:
            preview_seg_filters.in_["source_video_id"] = source_video_ids
        segments_result = repo.list_segments(profile_id, filters=preview_seg_filters)

        if not segments_result.data:
            raise RuntimeError("No segments found in library. Please create segments first.")

        segments_data = []
        for seg in segments_result.data:
            source_video_path = (seg.get("editai_source_videos") or {}).get("file_path")
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
        _ai_assignments = None
        if preset == "ai_smart":
            _ai_assignments = await asyncio.to_thread(
                self._ai_match_segments, srt_entries, segments_data, profile_id
            )
        match_results = self.match_srt_to_segments(
            srt_entries=srt_entries,
            segments_data=segments_data,
            min_confidence=0.3,
            variant_index=variant_index,
            srt_product_groups=srt_product_groups,
            avoid_segment_ids=avoid_segment_ids,
            preset=preset,
            ai_assignments=_ai_assignments,
        )

        timeline, _intro_offset_sec = self.build_timeline(
            match_results=match_results,
            segments_data=segments_data,
            audio_duration=audio_duration,
            variant_index=variant_index,
            min_segment_duration=min_segment_duration,
            ultra_rapid_intro=ultra_rapid_intro
        )

        # Count matched vs unmatched
        matched_count = sum(1 for m in match_results if m.segment_id is not None)
        unmatched_count = len(match_results) - matched_count

        # Build merge group mapping (mirrors build_timeline merge logic)
        match_group_map = {}  # match_index -> (group_idx, group_duration)
        if min_segment_duration > 0 and len(match_results) > 1:
            group_idx = 0
            i = 0
            while i < len(match_results):
                duration = match_results[i].srt_end - match_results[i].srt_start
                last = i
                while duration < min_segment_duration and last + 1 < len(match_results):
                    last += 1
                    duration += match_results[last].srt_end - match_results[last].srt_start
                for j in range(i, last + 1):
                    match_group_map[j] = (group_idx, round(duration, 2))
                group_idx += 1
                i = last + 1

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
                "transforms": m.transforms,
                "explanation": m.explanation,
                "pinned": m.pinned,
            }
            for m in match_results
        ]

        # Annotate matches with merge group info
        for idx, m_data in enumerate(matches_data):
            if idx in match_group_map:
                g, d = match_group_map[idx]
            else:
                g = idx
                d = round(m_data["srt_end"] - m_data["srt_start"], 2)
            m_data["merge_group"] = g
            m_data["merge_group_duration"] = d

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
                "transforms": seg.get("transforms"),
            }
            for seg in segments_data
        ]

        # Persist freshly-generated TTS to the library so audio_path survives the
        # 2h temp-dir cleanup below. Without this, pipelines lose voice-overs
        # whenever the cleanup timer fires before Step 2 explicit save runs.
        if not reuse_audio_path and audio_path.exists():
            try:
                from app.services.tts_library_service import get_tts_library_service
                tts_lib = get_tts_library_service()
                saved_asset_id = tts_lib.save_from_pipeline(
                    profile_id=profile_id,
                    text=cleaned_text,
                    audio_path=str(audio_path),
                    srt_content=srt_content,
                    timestamps=timestamps or None,
                    model=elevenlabs_model,
                    duration=audio_duration,
                    voice_id=voice_id,
                )
                lib_rel = None
                if saved_asset_id:
                    lib_rel = f"media/tts/{profile_id}/{saved_asset_id}.mp3"
                else:
                    # Dedup hit — look up existing asset and reuse its path.
                    # Migrated Phase 83-01: typed repo.list_tts_assets with QueryFilters
                    # replaces the raw editai_tts_assets PostgREST select chain; no new
                    # ABC method required (existing list_tts_assets covers eq + limit
                    # primitives on both backends).
                    try:
                        from app.repositories.factory import get_repository as _get_repository
                        from app.repositories.models import QueryFilters as _QueryFilters
                        _repo = _get_repository()
                        if _repo:
                            _existing = _repo.list_tts_assets(
                                profile_id,
                                _QueryFilters(
                                    eq={"status": "ready", "tts_text": cleaned_text.strip()},
                                    limit=1,
                                ),
                            )
                            if _existing.data and _existing.data[0].get("mp3_path"):
                                lib_rel = _existing.data[0]["mp3_path"]
                    except Exception as _dedup_err:
                        logger.warning(f"Preview TTS library dedup lookup failed: {_dedup_err}")
                if lib_rel:
                    lib_full = self.settings.base_dir / lib_rel
                    if lib_full.exists():
                        audio_path = lib_full
                        logger.info(f"Preview TTS persisted to library: {lib_rel}")
            except Exception as lib_err:
                logger.warning(f"Preview TTS library save failed (non-blocking): {lib_err}")

        # Schedule cleanup of temp TTS directory after 2 hours.
        # Only schedule when audio still lives under temp/ — if reuse_audio_path
        # was provided OR we just persisted to the library, audio_path now points
        # at media/tts/ which must NOT be wiped.
        _temp_root = self.settings.base_dir / "temp"
        _audio_under_temp = False
        try:
            audio_path.resolve().relative_to(_temp_root.resolve())
            _audio_under_temp = True
        except ValueError:
            pass
        if not reuse_audio_path and _audio_under_temp:
            temp_dir = audio_path.parent
            def _cleanup_temp():
                import shutil
                try:
                    if temp_dir.exists():
                        shutil.rmtree(str(temp_dir), ignore_errors=True)
                        logger.debug(f"Cleaned up preview temp dir: {temp_dir}")
                except Exception:
                    pass
            # 2 hours — preview temp files needed until render completes
            # VID-18: daemon thread runs independently; local ref prevents premature GC
            # Cancel any existing cleanup timer for this temp_dir before scheduling
            existing_timer = self._cleanup_timers.pop(str(temp_dir), None)
            if existing_timer is not None:
                existing_timer.cancel()
            _cleanup_timer = threading.Timer(7200, _cleanup_temp)
            _cleanup_timer.daemon = True
            _cleanup_timer.start()
            self._cleanup_timers[str(temp_dir)] = _cleanup_timer

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
