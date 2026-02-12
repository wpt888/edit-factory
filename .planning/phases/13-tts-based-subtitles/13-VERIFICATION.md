---
phase: 13-tts-based-subtitles
verified: 2026-02-12T03:30:00Z
status: human_needed
score: 3/4
human_verification:
  - test: "Render a video with TTS audio and verify subtitle sync"
    expected: "Subtitles appear perfectly synced with TTS voiceover timing"
    why_human: "Visual/audio sync requires human perception to verify timing feels natural"
  - test: "Verify subtitle styling (shadow, glow, adaptive sizing) works with auto-generated SRT"
    expected: "Subtitles have shadow effects, glow, and adaptive sizing identical to manually uploaded SRT"
    why_human: "Visual appearance verification requires human inspection"
---

# Phase 13: TTS-Based Subtitles Verification Report

**Phase Goal:** Generate SRT subtitles from ElevenLabs character timestamps without Whisper
**Verified:** 2026-02-12T03:30:00Z
**Status:** human_needed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                              | Status     | Evidence                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| 1   | System generates SRT subtitle files from ElevenLabs character-level timestamps                     | ✓ VERIFIED | generate_srt_from_timestamps() exists, converts timestamps to SRT format, tested with sample data         |
| 2   | Character timestamps are grouped into word-level and phrase-level subtitle entries with natural timing | ✓ VERIFIED | 3-step algorithm implemented (chars→words→phrases→SRT), configurable limits (40 chars, 7 words)          |
| 3   | Generated subtitles use existing v3 styling (shadow, glow, adaptive sizing) without modification   | ✓ VERIFIED | Auto-generated SRT feeds into subtitle_styler.py pipeline, default Phase 11 settings applied              |
| 4   | Subtitle sync is visually perfect when tested with generated TTS audio                            | ? HUMAN    | Timing comes from same TTS generation (should be perfect), but visual verification needed                 |

**Score:** 3/4 truths verified (1 requires human verification)

### Required Artifacts

| Artifact                                   | Expected                                      | Status     | Details                                                                                                               |
| ------------------------------------------ | --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `app/services/tts_subtitle_generator.py`   | TTS timestamp to SRT conversion service       | ✓ VERIFIED | 221 lines, contains generate_srt_from_timestamps(), _seconds_to_srt_time(), full edge case handling                  |
| `app/api/library_routes.py` (modified)     | TTS-based subtitle generation wired to render | ✓ VERIFIED | Import added (line 25), auto-generation logic (lines 1916-1928), default styling (lines 1937-1953), srt_path passed to renderer |

**All artifacts exist, substantive, and wired.**

### Key Link Verification

| From                                 | To                                          | Via                                           | Status  | Details                                                                                           |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| app/api/library_routes.py            | app/services/tts_subtitle_generator.py      | import and call in _render_final_clip_task    | ✓ WIRED | Import at line 25, called at line 1919 with tts_timestamps                                        |
| app/api/library_routes.py (auto SRT) | app/services/subtitle_styler.py             | srt_path passed to _render_with_preset        | ✓ WIRED | srt_path set at line 1921 (auto-generated) or line 1912 (user-provided), passed at line 1961      |
| TTS generation                       | SRT generation                              | tts_timestamps variable in function scope     | ✓ WIRED | tts_timestamps populated at line 1814, consumed at line 1919                                      |
| Auto-generated SRT                   | Phase 11 styling pipeline                   | Default subtitle_settings when none exist     | ✓ WIRED | Default styling injected at lines 1937-1953 when srt_path exists but no subtitle_settings         |

**All key links verified as wired.**

### Requirements Coverage

Phase 13 requirements from ROADMAP.md:

| Requirement | Description                                                                   | Status       | Blocking Issue                    |
| ----------- | ----------------------------------------------------------------------------- | ------------ | --------------------------------- |
| SUB-01      | Generate SRT from ElevenLabs character timestamps                            | ✓ SATISFIED  | None                              |
| SUB-02      | Group timestamps into natural word/phrase boundaries                          | ✓ SATISFIED  | None                              |
| SUB-03      | Integrate with existing v3 subtitle styling                                   | ✓ SATISFIED  | None                              |
| SUB-04      | Perfect subtitle sync with TTS audio                                          | ? NEEDS HUMAN | Visual verification required      |

**3/4 requirements satisfied, 1 needs human verification.**

### Anti-Patterns Found

**No anti-patterns detected.**

| Pattern Type | Files Checked                                    | Result                                                      |
| ------------ | ------------------------------------------------ | ----------------------------------------------------------- |
| TODO/FIXME   | tts_subtitle_generator.py, library_routes.py     | None found                                                  |
| Empty impls  | tts_subtitle_generator.py                        | None - full implementation with comprehensive edge handling |
| Placeholders | tts_subtitle_generator.py                        | None found                                                  |
| Console logs | tts_subtitle_generator.py                        | None - uses proper logging module                           |

### Implementation Quality

**Strengths:**
- Comprehensive edge case handling (None input, empty dict, single word, long text)
- 3-step grouping algorithm with clear separation of concerns
- Configurable phrase boundaries (max_chars, max_words, sentence punctuation)
- Graceful degradation with warning logs, not exceptions
- Manual SRT generation (no external library dependency)
- Priority system: user SRT > auto-generated > no subtitles
- Perfect integration with existing Phase 11 subtitle styling pipeline

**Function Verification (Tested):**
- ✓ Basic conversion: "Hello world" → valid SRT with correct timing
- ✓ Empty dict input → empty string with warning log
- ✓ None input → empty string with warning log
- ✓ Multi-sentence text → natural phrase boundaries at punctuation
- ✓ SRT format correct: HH:MM:SS,mmm with comma separator (not period)

**Code Flow:**
```
Render Pipeline (_render_final_clip_task):
├─ 1. Generate TTS audio with timestamps (lines 1797-1867)
│   ├─ ElevenLabsTTSService.generate_audio_with_timestamps()
│   ├─ tts_timestamps populated from API response
│   └─ Timestamps persisted to Supabase (editai_clip_content.tts_timestamps)
├─ 2. Generate SRT (lines 1910-1928) ← PHASE 13 LOGIC
│   ├─ Priority 1: User-provided srt_content → write to temp file
│   ├─ Priority 2: Auto-generate from tts_timestamps → generate_srt_from_timestamps()
│   └─ Priority 3: No SRT → srt_path stays None
├─ 3. Apply subtitle styling (lines 1930-1953)
│   ├─ Inject Phase 11 settings if subtitle_settings exist
│   └─ Apply defaults if srt_path exists but no settings configured
└─ 4. Render with FFmpeg (lines 1955+)
    └─ srt_path passed to _render_with_preset → subtitle_styler.py
```

### Database Integration

**Migration 009:** `add_tts_timestamps_to_clips.sql`
- ✓ Adds `tts_timestamps` JSONB column to `editai_clip_content`
- ✓ Adds `tts_model` TEXT column to track ElevenLabs model used
- ✓ Comments document schema and purpose

**Persistence:**
- Timestamps saved after TTS generation (lines 1854-1862)
- Model name persisted alongside timestamps
- Graceful degradation if persistence fails (warning log, doesn't break render)

**Note:** Timestamps are regenerated on every render (not retrieved from previous renders). This is intentional - fresh TTS generation ensures audio/subtitle sync is always perfect for current model/settings.

### Human Verification Required

#### 1. Subtitle Sync with TTS Audio

**Test:**
1. Create a new clip with TTS text (e.g., "Hello world. This is a test of TTS-based subtitles!")
2. Enable TTS generation with ElevenLabs flash v2.5 model
3. Render the clip with a preset (e.g., TikTok preset)
4. Play the final video and observe subtitle timing

**Expected:**
- Subtitles appear exactly when words are spoken in the TTS voiceover
- Phrase boundaries feel natural (not cutting mid-sentence)
- Timing feels smooth without visible lag or early appearance

**Why human:**
Audio-visual sync requires human perception. Automated tests can verify SRT format correctness but cannot judge if timing "feels right" when watching the video.

#### 2. Subtitle Styling with Auto-Generated SRT

**Test:**
1. Render a clip with auto-generated subtitles (from TTS timestamps)
2. Render a similar clip with manually uploaded SRT file
3. Compare visual appearance of subtitles in both videos

**Expected:**
- Auto-generated subtitles have shadow effects (Phase 11)
- Glow effect appears if enabled
- Adaptive sizing works correctly
- Styling is identical between auto-generated and manually uploaded SRT

**Why human:**
Visual appearance (shadow depth, glow quality, text sizing) requires human inspection to verify it looks professional and matches expectations.

### Commits Verified

| Commit  | Plan   | Description                                       | Status     |
| ------- | ------ | ------------------------------------------------- | ---------- |
| a822774 | 13-01  | Create TTS subtitle generator service             | ✓ VERIFIED |
| 21fe719 | 13-02  | Wire TTS subtitle generator into render pipeline  | ✓ VERIFIED |

Both commits exist in repository history with correct file changes.

---

**Verification Complete**

All automated checks passed. Phase 13 implementation is complete and correct. Two human verification tests are required to confirm visual/audio quality meets user expectations.

---

_Verified: 2026-02-12T03:30:00Z_
_Verifier: Claude (gsd-verifier)_
