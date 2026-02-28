---
phase: 43-assembly-diversity-fix
plan: 01
subsystem: api
tags: [assembly, round-robin, diversity, timeline, video-pipeline]

# Dependency graph
requires: []
provides:
  - Diversity-preserving merge step in build_timeline (sub-entries instead of single representative)
  - Overlapping-time-range adjacency prevention in match_srt_to_segments
affects: [45-interstitial-controls, 46-render-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sub-entry merge: proportional duration redistribution preserves all segment assignments through the merge step"
    - "Time-range overlap check: same source_video_id + overlapping start/end = avoid adjacency, non-overlapping = acceptable"

key-files:
  created: []
  modified:
    - app/services/assembly_service.py

key-decisions:
  - "Merge step keeps ALL sub-entries as individual TimelineEntry objects with proportionally redistributed durations rather than picking ONE representative; this preserves round-robin diversity end-to-end"
  - "Adjacency check uses actual time ranges (start/end) not just source_video_id equality; segments from same source with non-overlapping ranges are acceptable adjacency"
  - "_rr_next extended with exclude_start/exclude_end params; prefers non-overlapping segment first, falls back to any available (including overlapping) if no alternative exists"

patterns-established:
  - "prev_segment_start/prev_segment_end: track alongside prev_source_video_id for time-range-aware adjacency prevention"
  - "_overlaps_previous() helper inline in keyword candidate filtering for same overlap logic"

requirements-completed: [ASMB-01, ASMB-02, ASMB-03]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 43 Plan 01: Assembly Diversity Fix Summary

**Diversity-preserving merge and overlapping-time-range adjacency prevention in assembly_service.py — all N round-robin segment assignments now survive through the merge step as proportional sub-entries**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T00:07:54Z
- **Completed:** 2026-02-28T00:11:52Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Rewrote `build_timeline` merge step to emit ALL sub-entries from a merged group (each with proportionally redistributed duration) instead of collapsing to a single representative segment
- Extended `_rr_next` with `exclude_start`/`exclude_end` params so the round-robin avoids segments that would create overlapping-time-range adjacency on the same source video
- Added `_overlaps_previous()` helper in keyword candidate filtering to apply the same time-range overlap check for keyword-matched segments
- Verified combined behavior: 10 SRT entries with 10 unique segments uses all 10 distinct segments before any repetition, with zero overlapping adjacency

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite merge logic to preserve per-SRT segment diversity** - `f05f3e5` (fix)
2. **Task 2: Add overlapping-time-range adjacency prevention in match_srt_to_segments** - `e401381` (fix)

## Files Created/Modified

- `app/services/assembly_service.py` - Fixed build_timeline merge step + extended _rr_next + added overlap check to keyword filtering + updated tracking variables

## Decisions Made

- Kept the "last entry is too short, absorb into previous" tail logic intact — it only triggers for the very last timeline entry, which is an acceptable edge case
- In `_rr_next`, "non-overlapping" preference falls back gracefully to "any available" if all remaining segments would overlap; this prevents a hard failure when the pool is exhausted within one source video

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

- Assembly diversity fix is complete and verified with automated tests
- Phase 44 (pipeline_routes TTS preview cache fix) can proceed independently
- Phase 45 (interstitial controls) depends on both 43 and 44 being stable — 43 is now ready

---
*Phase: 43-assembly-diversity-fix*
*Completed: 2026-02-28*
