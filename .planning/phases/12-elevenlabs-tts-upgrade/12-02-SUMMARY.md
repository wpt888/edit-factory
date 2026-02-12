---
phase: 12-elevenlabs-tts-upgrade
plan: 02
subsystem: tts
tags: [elevenlabs, tts, timestamps, render-pipeline, model-selection, supabase]

# Dependency graph
requires:
  - phase: 12-01
    provides: "ElevenLabs flash v2.5 with timestamps generation capability"
provides:
  - "Render endpoint accepts elevenlabs_model parameter for per-render model selection"
  - "TTS timestamp data persisted in Supabase for downstream subtitle generation"
  - "Model name persisted alongside timestamp data for debugging and cost tracking"
  - "Graceful fallback to legacy TTS if timestamps API fails"
affects: [12-03, 13-tts-subtitles]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async TTS service integration in background task with await"
    - "Dual persistence pattern: tts_timestamps (JSONB) + tts_model (TEXT)"
    - "Fallback exception handling for new TTS methods"

key-files:
  created:
    - supabase/migrations/009_add_tts_timestamps_to_clips.sql
  modified:
    - app/api/library_routes.py
    - app/services/tts/base.py

key-decisions:
  - "Store timestamps as JSONB in editai_clip_content for Phase 13 subtitle generation"
  - "Add tts_model column to track which ElevenLabs model generated each clip's audio"
  - "Apply silence removal after timestamp generation to preserve timing data integrity"
  - "Graceful fallback ensures existing workflows continue if timestamps API fails"

patterns-established:
  - "Form parameter pattern: elevenlabs_model: str = Form(default='eleven_flash_v2_5')"
  - "Background task parameter passing for model selection"
  - "Timestamp persistence after successful TTS generation"

# Metrics
duration: 2.3min
completed: 2026-02-12
---

# Phase 12 Plan 02: TTS Timestamp Pipeline Integration Summary

**Wired generate_audio_with_timestamps() into render pipeline with model selection and Supabase persistence**

## Performance

- **Duration:** 2.3 min
- **Started:** 2026-02-12T00:53:41Z
- **Completed:** 2026-02-12T00:55:58Z
- **Tasks:** 1
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- Added `elevenlabs_model` Form parameter to render endpoint for per-render model selection
- Integrated `generate_audio_with_timestamps()` into `_render_final_clip_task`
- Created migration 009 for `tts_timestamps` JSONB and `tts_model` TEXT columns
- Extended `TTSResult` dataclass with optional `timestamps` field
- Implemented graceful fallback to legacy TTS if timestamps generation fails
- Timestamp data persisted to Supabase after successful TTS generation
- Silence removal applied to timestamped audio while preserving timing data

## Task Commits

Each task was committed atomically:

1. **Task 1: Add model selection to render endpoint and use timestamps in render task** - `1f2c88f` (feat)

## Files Created/Modified

- `app/api/library_routes.py` - Added elevenlabs_model parameter, integrated generate_audio_with_timestamps, added timestamp persistence logic
- `app/services/tts/base.py` - Extended TTSResult with optional timestamps field
- `supabase/migrations/009_add_tts_timestamps_to_clips.sql` - Created migration for tts_timestamps JSONB and tts_model TEXT columns

## Decisions Made

- **Timestamp persistence strategy**: Store raw timestamp dict from ElevenLabs as JSONB for flexibility in Phase 13
- **Model tracking**: Persist tts_model alongside timestamps to enable cost tracking and debugging
- **Fallback behavior**: If timestamps API fails, fall back to legacy TTS without breaking user workflow
- **Silence removal timing**: Apply after timestamp generation to preserve audio quality while maintaining timing data integrity

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added silence_stats initialization**
- **Found during:** Task 1 implementation
- **Issue:** The `silence_stats` variable used later in logging was not initialized in the new code path, which would cause NameError
- **Fix:** Initialize `silence_stats = None` at the start of the TTS block and populate it appropriately in each code path
- **Files modified:** app/api/library_routes.py
- **Commit:** 1f2c88f (included in main task commit)

## Issues Encountered

None. Implementation proceeded smoothly with one minor initialization fix applied automatically.

## User Setup Required

**Database Migration Required:**

The migration file `supabase/migrations/009_add_tts_timestamps_to_clips.sql` must be applied manually via Supabase SQL Editor:

1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/009_add_tts_timestamps_to_clips.sql`
3. Execute the migration
4. Verify columns exist: `SELECT column_name FROM information_schema.columns WHERE table_name = 'editai_clip_content' AND column_name IN ('tts_timestamps', 'tts_model');`

**Note:** Application will work without migration (timestamps simply won't be persisted), but Phase 13 subtitle generation will require this data.

## Next Phase Readiness

Backend integration complete for TTS-03 and TTS-04:
- TTS-03 (Timestamp persistence): ✓ SATISFIED - Timestamps retrieved from /with-timestamps and stored in Supabase
- TTS-04 Backend (Model selection): ✓ SATISFIED - elevenlabs_model parameter available in render endpoint

Ready for:
- Plan 12-03: Frontend configuration UI for model selection
- Phase 13: TTS-based subtitle generation using persisted timestamp data

## Self-Check: PASSED

All files and commits verified:
- FOUND: app/api/library_routes.py
- FOUND: app/services/tts/base.py
- FOUND: supabase/migrations/009_add_tts_timestamps_to_clips.sql
- FOUND: 1f2c88f (Task 1 commit)

---
*Phase: 12-elevenlabs-tts-upgrade*
*Completed: 2026-02-12*
