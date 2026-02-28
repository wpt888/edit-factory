---
phase: 44-subtitle-data-flow-fix
plan: 02
subsystem: api
tags: [srt, subtitles, tts, assembly, ffmpeg, timeline]

# Dependency graph
requires:
  - phase: 44-subtitle-data-flow-fix
    provides: srt_content persisted in tts_previews cache (plan 01)
provides:
  - Minimum 100ms duration floor on all SRT subtitle entries
  - 0.5s video timeline safety margin beyond audio duration in build_timeline
affects: [45-interstitial-controls, 46-render-integration, assembly pipeline rendering]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MIN_DURATION floor on SRT entries: extend end before creating entry, skip if still zero-duration"
    - "target_video_duration = audio_duration + 0.5 safety margin for timeline gap fill"

key-files:
  created: []
  modified:
    - app/services/tts_subtitle_generator.py
    - app/services/assembly_service.py

key-decisions:
  - "100ms (0.1s) chosen as minimum SRT duration — below human perception threshold but above floating-point noise"
  - "0.5s safety margin chosen for timeline extension — large enough to absorb float accumulation, trimmed harmlessly by -t flag in render"
  - "Zero-duration entries (< 1ms after clamping) are skipped with a warning rather than extended, since they indicate back-to-back identical timestamps"

patterns-established:
  - "SRT generation: always enforce MIN_DURATION floor; clamp to next phrase start to avoid overlap; skip if still < 1ms"
  - "Timeline gap fill: target_video_duration = audio_duration + safety_margin, not raw audio_duration"

requirements-completed:
  - SUBS-03
  - SUBS-04

# Metrics
duration: 12min
completed: 2026-02-28
---

# Phase 44 Plan 02: Subtitle Duration Floor and Timeline Safety Margin Summary

**100ms minimum duration floor on all SRT entries eliminates invisible zero-duration subtitles, and a 0.5s video timeline safety margin prevents subtitle cutoff at audio track end.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-28T00:17:58Z
- **Completed:** 2026-02-28T00:29:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Step 3 of generate_srt_from_timestamps now enforces 100ms minimum duration per entry, extending short entries without overlapping the next phrase and skipping truly zero-duration entries with a warning log
- build_timeline in assembly_service.py now extends the gap-fill target to audio_duration + 0.5s, ensuring video frames are never exhausted before audio ends
- Sequential srt_index replaces enumerate so entry numbering stays correct after any skipped entries
- Log line updated to report actual output count rather than input phrase count

## Task Commits

Each task was committed atomically:

1. **Task 1: Enforce minimum SRT entry duration** - `09af561` (fix)
2. **Task 2: Add safety margin to timeline extension** - `ab704d4` (fix)

## Files Created/Modified
- `app/services/tts_subtitle_generator.py` - Added MIN_DURATION = 0.1 floor in Step 3 SRT loop; skip zero-duration entries; corrected log count
- `app/services/assembly_service.py` - Changed gap target from audio_duration to audio_duration + 0.5 in build_timeline

## Decisions Made
- 100ms minimum: chosen as the lowest perceptible flash duration; below this subtitles are invisible to viewers
- 0.5s safety margin: generous enough to absorb any floating-point segment accumulation error, but trimmed cleanly by the existing -t {audio_duration} flag in _render_with_preset — no change to final output length
- Skipping entries < 1ms after clamping is correct behavior because they represent two back-to-back identical timestamps where no content can be displayed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both subtitle data flow bugs from the v9 audit are now resolved (plan 01 fixed cache miss, plan 02 fixed duration and timeline alignment)
- Phase 45 (interstitial controls) and Phase 46 (render integration) can proceed on a stable assembly foundation
- No blockers

## Self-Check: PASSED

- FOUND: app/services/tts_subtitle_generator.py
- FOUND: app/services/assembly_service.py
- FOUND: .planning/phases/44-subtitle-data-flow-fix/44-02-SUMMARY.md
- FOUND commit: 09af561
- FOUND commit: ab704d4

---
*Phase: 44-subtitle-data-flow-fix*
*Completed: 2026-02-28*
