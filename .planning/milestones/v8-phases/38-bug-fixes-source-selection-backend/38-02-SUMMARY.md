---
phase: 38-bug-fixes-source-selection-backend
plan: 02
subsystem: api, services
tags: [pipeline, assembly, segments, supabase, filtering]

# Dependency graph
requires: [38-01]
provides:
  - "Preview endpoint filters segments to user-selected source videos"
  - "Render endpoint filters segments to user-selected source videos"
  - "Backward-compatible: omitting source_video_ids matches all segments"
affects: [pipeline, assembly_service]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-step Supabase query: build base query, conditionally add .in_() filter before .execute()"
    - "Optional list parameter with None default for backward-compatible API extension"

key-files:
  created: []
  modified:
    - app/services/assembly_service.py
    - app/api/pipeline_routes.py

key-decisions:
  - "source_video_ids defaults to None so existing callers without it continue to match all segments"
  - "Filter applied at DB query level via Supabase .in_() — not post-fetch filtering — for efficiency"
  - "Stored source_video_ids in pipeline dict for observability/reference during later status checks"

patterns-established:
  - "Two-step query pattern: assign query to variable, conditionally append .in_() filter, then .execute()"

requirements-completed: [SRC-02]

# Metrics
duration: 5min
completed: 2026-02-24
---

# Phase 38 Plan 02: Source-Scoped Segment Matching (Backend) Summary

**Optional source_video_ids parameter on preview and render endpoints filters Supabase segment queries to selected source videos, improving match quality without breaking existing clients**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-24T09:14:00Z
- **Completed:** 2026-02-24T09:19:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `source_video_ids: Optional[List[str]]` to `AssemblyService.preview_matches()` — filters segment fetch to specified videos when provided
- Added `source_video_ids: Optional[List[str]]` to `AssemblyService.assemble_and_render()` — same filter for render path
- Added `source_video_ids` Body parameter to `preview_variant` endpoint in pipeline_routes.py
- Added `source_video_ids` field to `PipelineRenderRequest` Pydantic model
- Both parameters pass through to assembly service correctly
- Filter applied at DB layer via Supabase `.in_("source_video_id", source_video_ids)` — no over-fetching
- Backward compatible: None/omitted = no filter = all segments matched (identical to previous behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add source_video_ids filtering to assembly service** - `b3a0b1f` (feat)
2. **Task 2: Wire source_video_ids through pipeline endpoints** - `8d816db` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `app/services/assembly_service.py` — Added `source_video_ids` param to both `preview_matches` and `assemble_and_render`; replaced inline Supabase chain with two-step pattern + conditional `.in_()` filter; log message when filter active
- `app/api/pipeline_routes.py` — Added `source_video_ids` to `PipelineRenderRequest`; added Body param to `preview_variant`; passed through to both assembly service calls; stored in pipeline dict

## Decisions Made

- Filter is applied at the Supabase query level (not post-fetch) so only matching segments are returned — avoids transferring irrelevant data from DB
- `source_video_ids` defaults to `None` in all signatures and models so existing API consumers are unaffected
- Pipeline dict stores `source_video_ids` for observability — useful if the frontend later needs to read it back from status

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no migrations required. `source_video_id` column already exists on `editai_segments` table (used in Phase 38-01 context).

## Next Phase Readiness

- SRC-02 requirement complete — backend now accepts and applies source video filter
- Phase 39 (Source Selection Frontend) can now wire up the UI to pass `source_video_ids` in preview/render requests
- No blocking issues

## Self-Check: PASSED

- FOUND: `app/services/assembly_service.py`
- FOUND: `app/api/pipeline_routes.py`
- FOUND commit: `b3a0b1f` (Task 1)
- FOUND commit: `8d816db` (Task 2)

---
*Phase: 38-bug-fixes-source-selection-backend*
*Completed: 2026-02-24*
