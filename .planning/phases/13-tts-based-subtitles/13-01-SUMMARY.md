---
phase: 13-tts-based-subtitles
plan: 01
subsystem: tts
tags: [tts, subtitles, srt, elevenlabs, timestamps, subtitle-generation]

# Dependency graph
requires:
  - phase: 12-02
    provides: "TTS timestamp data persisted in Supabase as JSONB"
provides:
  - "Core algorithm for converting ElevenLabs character-level timestamps to SRT format"
  - "3-step grouping: characters → words → phrases → SRT entries"
  - "Configurable phrase boundaries (max chars, max words, sentence endings)"
affects: [13-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Character-to-word grouping with space and punctuation handling"
    - "Word-to-phrase grouping with configurable limits"
    - "Manual SRT generation (no external library dependency)"
    - "Graceful degradation with warning logs for edge cases"

key-files:
  created:
    - app/services/tts_subtitle_generator.py
  modified: []

key-decisions:
  - "Manual SRT generation instead of using 'srt' library to avoid extra dependency"
  - "Default phrase limits: 40 chars and 7 words per subtitle entry"
  - "Sentence-ending punctuation (., !, ?) creates natural phrase boundaries"
  - "Edge cases (None, empty dict, single word) return empty string gracefully"

patterns-established:
  - "Helper function pattern: _seconds_to_srt_time() for time format conversion"
  - "3-step grouping algorithm for timestamp processing"
  - "Logging pattern: warning logs for edge cases, info logs for successful generation"

# Metrics
duration: 1.5min
completed: 2026-02-12
---

# Phase 13 Plan 01: TTS Subtitle Generator Service Summary

**Core algorithm for converting ElevenLabs character-level timestamps to perfectly synced SRT subtitles**

## Performance

- **Duration:** 1.5 min
- **Started:** 2026-02-12T01:19:31Z
- **Completed:** 2026-02-12T01:21:04Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created `generate_srt_from_timestamps()` function in `app/services/tts_subtitle_generator.py`
- Implemented 3-step grouping algorithm:
  1. **Characters to words**: Split on spaces, handle punctuation attached to words
  2. **Words to phrases**: Group with limits (40 chars, 7 words) and sentence boundaries
  3. **Phrases to SRT**: Format with sequential numbering and HH:MM:SS,mmm timing
- Added `_seconds_to_srt_time()` helper for time format conversion
- Edge case handling: None input, empty dict, single word, long text all handled gracefully
- Comprehensive logging with info/warning messages for debugging

## Task Commits

Each task was committed atomically:

1. **Task 1: Create TTS subtitle generator service** - `a822774` (feat)

## Files Created/Modified

- `app/services/tts_subtitle_generator.py` - New service with generate_srt_from_timestamps() function and helper utilities

## Decisions Made

- **No external library dependency**: Generate SRT format manually (trivial format) to avoid adding the 'srt' library dependency. The 'srt' library is used in subtitle_styler.py for parsing existing SRT files, but this service only generates.
- **Default phrase limits**: 40 characters and 7 words per subtitle entry provides good readability for social media video formats (reels, TikTok, YouTube Shorts).
- **Sentence boundaries**: Punctuation marks (., !, ?) create natural phrase breaks for better subtitle pacing.
- **Graceful degradation**: Empty or malformed input returns empty string with warning logs instead of raising exceptions.

## Verification Results

All verification tests passed:

1. **Module import**: ✓ Imports cleanly without errors
2. **Basic conversion**: ✓ "Hello world" generates valid SRT with correct timing
3. **Empty dict**: ✓ Returns empty string with warning log
4. **None input**: ✓ Returns empty string with warning log
5. **Multi-sentence text**: ✓ Creates natural phrase boundaries at punctuation
6. **Single word**: ✓ Handles text with no spaces
7. **Long text**: ✓ Automatically splits based on 40 char limit
8. **SRT format**: ✓ Correct HH:MM:SS,mmm format with comma separator (not period)

Example output:
```
1
00:00:00,000 --> 00:00:00,460
Hello world
```

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Implementation was straightforward with clear requirements and comprehensive edge case handling.

## Next Phase Readiness

Core algorithm complete. Ready for:
- Plan 13-02: Integration with render pipeline to use TTS timestamps instead of Whisper for subtitle generation

## Self-Check: PASSED

All files and commits verified:
- FOUND: app/services/tts_subtitle_generator.py
- FOUND: a822774 (Task 1 commit)

---
*Phase: 13-tts-based-subtitles*
*Completed: 2026-02-12*
