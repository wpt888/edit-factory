---
phase: 60-monitoring-observability
plan: 60-02
subsystem: infra
tags: [cleanup, ttl, ffmpeg, disk-management, output-files]

# Dependency graph
requires:
  - phase: 60-01
    provides: Sentry init and crash reporting foundation
provides:
  - Partial FFmpeg output file cleanup on render failure
  - TTL-based output directory cleanup for output/finals/ and output/tts/
  - POST /maintenance/cleanup-output endpoint
  - Startup hook to auto-clean stale output files
  - output_ttl_hours config setting (default 72h)
affects: [library-routes, startup-lifecycle, disk-management]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "render_succeeded flag pattern — set True only after successful DB update, used in finally block to conditionally delete partial output"
    - "TTL cleanup targets named subdirectories only (finals/, tts/), never raw clips in output root"
    - "Startup cleanup uses lazy import of cleanup_output_files from library_routes to avoid circular imports"

key-files:
  created: []
  modified:
    - app/api/library_routes.py
    - app/config.py
    - app/main.py

key-decisions:
  - "render_succeeded flag (not status check) determines whether to clean partial output — simpler than querying clip status in finally block"
  - "Output cleanup TTL defaults to 72 hours — final videos should be downloaded or published within that window"
  - "Cleanup targets output/finals/ and output/tts/ only — raw clips in output/ root are source data, not intermediate"
  - "OUTPUT_TTL_HOURS=0 disables startup cleanup — safe override for environments that need persistent output"

patterns-established:
  - "render_succeeded = False before try, render_succeeded = True after success — conditional cleanup in finally without status queries"
  - "cleanup_output_files() returns {deleted_count, freed_bytes} dict — consistent with cleanup_orphaned_temp_files pattern"

requirements-completed: [MON-03, MON-04]

# Metrics
duration: 12min
completed: 2026-03-03
---

# Phase 60 Plan 02: Failed Render Cleanup & Output TTL Summary

**Partial FFmpeg output file cleanup on render failure plus TTL-based output directory management with configurable 72-hour default**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-03T08:00:00Z
- **Completed:** 2026-03-03T08:12:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Failed renders no longer leave partial output files behind — the `render_succeeded` flag pattern ensures partial FFmpeg files are deleted in the finally block on failure
- New `cleanup_output_files()` function removes files older than configurable TTL from `output/finals/` and `output/tts/`, returning `{deleted_count, freed_bytes}`
- POST `/api/v1/maintenance/cleanup-output` endpoint with `max_age_hours` parameter mirrors the existing cleanup-temp endpoint pattern
- Server startup hook in lifespan automatically runs output cleanup (respects `OUTPUT_TTL_HOURS=0` to disable)
- New `output_ttl_hours: int = 72` setting in config.py

## Task Commits

Each task was committed atomically:

1. **Task 1: Clean up partial output file on render failure** - `0a19381` (fix)
2. **Task 2: Add output directory TTL cleanup function and endpoint** - `d847217` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `app/api/library_routes.py` - Added `output_path = None`, `render_succeeded` flag, partial output cleanup in finally block; added `cleanup_output_files()` function; added POST `/maintenance/cleanup-output` endpoint
- `app/config.py` - Added `output_ttl_hours: int = 72` setting
- `app/main.py` - Added startup output cleanup in lifespan function

## Decisions Made
- Used `render_succeeded` flag (set True only after successful DB update) rather than checking clip status in the finally block — avoids an extra DB query and is cleaner
- Output cleanup targets `output/finals/` and `output/tts/` subdirectories only — raw video clips in `output/` root are source data not intermediates
- `OUTPUT_TTL_HOURS=0` disables startup cleanup — zero means disabled, consistent with common configuration conventions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. New `OUTPUT_TTL_HOURS` env var is optional (defaults to 72).

## Next Phase Readiness
- MON-03 and MON-04 requirements complete
- output/finals/ and output/tts/ are now auto-maintained; disk space no longer grows unbounded from failed renders or stale output
- Remaining Phase 60 plans can proceed

## Self-Check: PASSED

- app/api/library_routes.py: FOUND
- app/config.py: FOUND
- app/main.py: FOUND
- 60-02-SUMMARY.md: FOUND
- Commit 0a19381 (Task 1): FOUND
- Commit d847217 (Task 2): FOUND

---
*Phase: 60-monitoring-observability*
*Completed: 2026-03-03*
