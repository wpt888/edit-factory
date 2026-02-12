---
phase: 13-tts-based-subtitles
plan: 02
subsystem: tts
tags: [tts, subtitles, srt, render-pipeline, auto-generation, elevenlabs]

# Dependency graph
requires:
  - phase: 13-01
    provides: "Core algorithm for converting ElevenLabs character-level timestamps to SRT format"
provides:
  - "TTS-based subtitle generation fully integrated into render pipeline"
  - "Auto-generation of SRT from TTS timestamps when no user SRT exists"
  - "Priority system: user SRT > auto-generated SRT > no subtitles"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Priority-based SRT source selection in render pipeline"
    - "Default subtitle styling injection for auto-generated SRT"
    - "Graceful degradation with warning logs for SRT generation failures"

key-files:
  created: []
  modified:
    - app/api/library_routes.py

key-decisions:
  - "User-provided srt_content always takes priority over auto-generation"
  - "Default subtitle settings (Montserrat 48px, white text, black outline) for auto-generated SRT"
  - "Auto-generation errors logged as warnings, don't break render pipeline"
  - "No changes to subtitle_styler.py or _render_with_preset - existing pipeline reused"

patterns-established:
  - "Priority chain: user content > auto-generated > none"
  - "Default styling injection when SRT exists but no subtitle_settings configured"

# Metrics
duration: 1.0min
completed: 2026-02-12
---

# Phase 13 Plan 02: TTS-Based Subtitle Integration Summary

**TTS subtitle generator fully wired into render pipeline for auto-synced subtitles from ElevenLabs timestamps**

## Performance

- **Duration:** 1.0 min
- **Started:** 2026-02-12T01:23:18Z
- **Completed:** 2026-02-12T01:24:22Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added import of `generate_srt_from_timestamps` from `tts_subtitle_generator` service to `library_routes.py`
- Implemented priority-based SRT source selection in `_render_final_clip_task()`:
  1. **User-provided SRT** (content_data.srt_content) - highest priority
  2. **Auto-generated from TTS timestamps** (tts_timestamps) - automatic fallback
  3. **No subtitles** - if neither exists
- Added default subtitle styling for auto-generated SRT when no subtitle_settings configured:
  - Font: Montserrat 48px
  - Colors: White text (#FFFFFF), Black outline (#000000)
  - Position: 85% from top
  - Phase 11 enhancements: shadow_depth, enable_glow, glow_blur, adaptive_sizing
- Graceful error handling: SRT generation failures logged as warnings, don't break pipeline
- No changes to existing subtitle_styler.py or _render_with_preset - auto-generated SRT feeds through unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire TTS subtitle generator into render pipeline** - `21fe719` (feat)

## Files Created/Modified

- `app/api/library_routes.py` - Added import, auto-SRT generation logic, default subtitle styling

## Decisions Made

- **User content priority**: When both user-provided SRT and TTS timestamps exist, user-provided SRT is always used. This respects manual caption edits and custom timing.
- **Default styling for auto-SRT**: Auto-generated subtitles get sensible defaults if no subtitle_settings configured. Uses Phase 11 enhancements (shadow, glow, adaptive sizing) with default values.
- **Non-breaking degradation**: If SRT generation from timestamps fails, log warning and continue render without subtitles. Don't crash the render pipeline.
- **No subtitle_styler changes**: Existing v3 subtitle pipeline (shadow, glow, adaptive sizing) works identically with auto-generated SRT. No code duplication.

## Verification Results

All verification checks passed:

1. **Import exists**: ✓ `from app.services.tts_subtitle_generator import generate_srt_from_timestamps` at line 25
2. **Auto-generation logic**: ✓ `generate_srt_from_timestamps(tts_timestamps)` called at line 1919
3. **Default subtitle settings**: ✓ Applied when `srt_path` exists but no `subtitle_settings` configured
4. **Python syntax**: ✓ No syntax errors in modified file

## Integration Flow

```
_render_final_clip_task() execution:
├─ 1. Generate TTS audio with timestamps (lines 1796-1866)
│   └─ tts_timestamps captured from ElevenLabsTTSService
├─ 2. Sync video to audio duration (lines 1868-1908)
├─ 3. Generate SRT (lines 1909-1929) ← NEW LOGIC
│   ├─ Priority 1: User-provided srt_content → write to temp file
│   ├─ Priority 2: Auto-generate from tts_timestamps → generate_srt_from_timestamps()
│   └─ Priority 3: No SRT → srt_path stays None
├─ 4. Inject Phase 11 settings or apply defaults (lines 1931-1945)
│   ├─ Existing subtitle_settings → inject shadow/glow/adaptive
│   └─ No subtitle_settings but srt_path exists → apply defaults
└─ 5. Render with FFmpeg (lines 1947+)
    └─ srt_path passed to _render_with_preset → subtitle_styler.py
```

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The `tts_timestamps` variable was already available in the function scope (set at line 1802, populated at line 1813), so no additional Supabase query was needed. Integration was straightforward.

## Next Phase Readiness

Phase 13 complete! TTS-based subtitle pipeline fully operational:
- Plan 13-01: Core SRT generation algorithm ✓
- Plan 13-02: Integration with render pipeline ✓

Ready for Phase 14 or user testing of TTS-based subtitles.

## Self-Check: PASSED

All files and commits verified:
- FOUND: app/api/library_routes.py (modified)
- FOUND: 21fe719 (Task 1 commit)

---
*Phase: 13-tts-based-subtitles*
*Completed: 2026-02-12*
