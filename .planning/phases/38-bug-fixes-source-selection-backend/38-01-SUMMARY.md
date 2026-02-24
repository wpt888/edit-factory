---
phase: 38-bug-fixes-source-selection-backend
plan: 01
subsystem: ui, api
tags: [pipeline, library, ffmpeg, supabase, react, nextjs]

# Dependency graph
requires: []
provides:
  - "Step 4 pipeline render shows variant cards immediately (no empty state flash)"
  - "Rendered pipeline clips persisted to editai_clips and editai_projects tables"
  - "Library page shows pipeline clips with thumbnail, duration, and download"
affects: [pipeline, library]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Build optimistic UI state from request data before API call to avoid loading flash"
    - "Non-critical library save wrapped in try/except in background tasks — render not blocked by save failure"
    - "Pipeline project caching via pipeline['library_project_id'] so multiple variants share one project"

key-files:
  created: []
  modified:
    - frontend/src/app/pipeline/page.tsx
    - app/api/pipeline_routes.py

key-decisions:
  - "Build initialStatuses from selectedVariants BEFORE the render API call — response has no variants field"
  - "Wrap entire library save block in try/except — render completion must not depend on library persistence"
  - "Cache library_project_id in pipeline dict to avoid duplicate project rows when multiple variants render"
  - "Reuse ffprobe + ffmpeg inline in pipeline_routes rather than importing private helpers from library_routes"

patterns-established:
  - "Optimistic render status: set processing cards before API call, polling fills in real data within ~2s"
  - "Library save pattern: create/get project, generate thumbnail, probe duration, insert clip row"

requirements-completed: [BUG-01, BUG-02]

# Metrics
duration: 15min
completed: 2026-02-24
---

# Phase 38 Plan 01: Bug Fixes (Step 4 Flash + Library Save) Summary

**Flicker-free Step 4 render entry via pre-call optimistic state, plus automatic editai_clips insertion after pipeline render completes**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-02-24T09:00:00Z
- **Completed:** 2026-02-24T09:14:20Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Eliminated empty state flash in Step 4: variant processing cards now appear instantly when render starts
- Pipeline renders now automatically save to Library as editai_clips rows with project association
- Thumbnail generated from rendered video and stored with each clip
- Video duration probed via ffprobe and stored on clip row
- All library save logic is non-critical (wrapped in try/except) — render success unaffected if save fails

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix Step 4 empty state flash (BUG-01)** - `21480f6` (fix)
2. **Task 2: Save rendered pipeline clips to library (BUG-02)** - `f935160` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `frontend/src/app/pipeline/page.tsx` — Build initialStatuses from selectedVariants before API call; remove incorrect `data.variants || []`; reset variantStatuses in error paths
- `app/api/pipeline_routes.py` — Add `import subprocess`; add library save block in `do_render` after successful render

## Decisions Made

- Used optimistic state pattern: build initial processing statuses from `selectedVariants` (the request input) before calling the render API, since `PipelineRenderResponse` only returns `rendering_variants` (int indices) and `total_variants`, not a `variants` field
- Cached `library_project_id` in the pipeline dict so the first variant to complete creates the project and subsequent variants reuse it — prevents duplicate project rows
- Kept library save fully isolated in `try/except` so any DB or ffmpeg failure during save never propagates to the render job status

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing TypeScript error in `tests/debug-all-logs.spec.ts` (unused `@ts-expect-error` directive) — unrelated to this plan's changes, out of scope per deviation rules

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both BUG-01 and BUG-02 resolved — pipeline is now production-ready for basic use
- Phase 38 Plan 02 (Source Selection Backend) can proceed without these bugs blocking UX
- Library page will show pipeline clips after next render — no manual DB intervention needed

---
*Phase: 38-bug-fixes-source-selection-backend*
*Completed: 2026-02-24*
