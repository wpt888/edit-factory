---
phase: 39-source-selection-frontend
plan: 01
subsystem: ui, api
tags: [pipeline, segments, supabase, react, nextjs, source-selection]

# Dependency graph
requires: [38-02]
provides:
  - "Source video picker Card in Step 2 of pipeline page with checkboxes and segment counts"
  - "GET /pipeline/{id}/source-selection endpoint restores selection on page load"
  - "PUT /pipeline/{id}/source-selection endpoint persists selection to editai_pipelines"
  - "Preview and render API calls pass selected source_video_ids to backend"
affects: [pipeline, pipeline_routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Debounced selection save: Set state, fire PUT /pipeline/{id}/source-selection after 500ms"
    - "Auto-select-all on mount when selectedSourceIds is empty — sensible default for new pipelines"
    - "Prevent deselecting last source inside setState updater — no async race possible"
    - "Graceful DB degradation: source_video_ids save wrapped in try/except for missing-column case"

key-files:
  created:
    - supabase/migrations/021_add_source_video_ids_to_pipelines.sql
  modified:
    - frontend/src/app/pipeline/page.tsx
    - app/api/pipeline_routes.py

key-decisions:
  - "Migration 021 requires manual application via Supabase Dashboard SQL Editor — anon key cannot execute DDL"
  - "Backend save is wrapped in try/except so the picker still works (in-memory) even before migration is applied"
  - "Source picker placed in Step 2 (Review Scripts) rather than Step 3 — natural flow before Preview All"
  - "handleSourceToggle uses setState updater form to prevent deselect-last race in debounce timer"
  - "restoreSourceSelection called when reloading a full history pipeline (all scripts selected) to restore DB-stored selection"

patterns-established:
  - "Debounced PUT pattern for transient user selections (same as subtitle settings)"
  - "Auto-select all on mount: if selectedSourceIds.size === 0 and data.length > 0, select all"

requirements-completed: [SRC-01, SRC-03, SRC-04]

# Metrics
duration: 18min
completed: 2026-02-24
---

# Phase 39 Plan 01: Source Video Picker Frontend Summary

**Source video picker Card with checkboxes, segment counts, DB persistence, and source_video_ids wired into preview/render API calls**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-02-24T09:38:09Z
- **Completed:** 2026-02-24T09:56:00Z
- **Tasks:** 2
- **Files modified:** 2 (+ 1 created)

## Accomplishments

- Added `source_video_ids` field to `_db_save_pipeline` and `_db_load_pipeline` for full persistence
- Added `GET /pipeline/{id}/source-selection` endpoint to restore selection on page load
- Added `PUT /pipeline/{id}/source-selection` endpoint to persist selection changes
- Added `SourceSelectionRequest` Pydantic model
- Added SQL migration 021 for the `source_video_ids` JSONB column on `editai_pipelines`
- Added source video picker Card in Step 2 of the pipeline page with:
  - Checkbox per source video
  - Thumbnail (or Film icon placeholder)
  - Video name and duration badge
  - Segments count badge
  - "Select All" button in card header
  - Total segments count footer
  - Empty state alert if no source videos exist
- Added `selectedSourceIds` state with auto-select-all on mount
- Added `fetchSourceVideos` and `restoreSourceSelection` callbacks
- Added `handleSourceToggle` (prevents deselecting last, debounced DB save)
- Added `handleSelectAllSources` (immediate DB save)
- Wired `source_video_ids` into `handlePreviewAll` and `handleRender` API calls
- Preview All button disabled when no sources are selected
- Helper text shown when sources exist but none are selected
- `resetPipeline` now resets `selectedSourceIds`
- History load restores source selection via `restoreSourceSelection`

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend persistence + GET/PUT endpoints** - `0622d45` (feat)
2. **Task 2: Source video picker UI + API wiring** - `527caa4` (feat)

## Files Created/Modified

- `supabase/migrations/021_add_source_video_ids_to_pipelines.sql` — Migration to add `source_video_ids JSONB DEFAULT '[]'` to `editai_pipelines`
- `app/api/pipeline_routes.py` — Added `source_video_ids` to save/load helpers; added `SourceSelectionRequest` model; added GET and PUT `/pipeline/{id}/source-selection` endpoints
- `frontend/src/app/pipeline/page.tsx` — Full source video picker implementation: state, callbacks, UI Card, API wiring

## Decisions Made

- Migration 021 requires manual application via Supabase Dashboard SQL Editor because the only available credentials are an anon key that cannot execute DDL. The backend code gracefully handles the missing column with try/except on the save path.
- Source picker placed in Step 2 (Review Scripts) rather than as a separate step — this keeps the workflow at 4 steps while allowing source selection before Preview All.
- `handleSourceToggle` uses the setState updater form to safely access previous state inside the debounce closure without stale-closure bugs.
- `restoreSourceSelection` called only when loading full-pipeline history (all scripts) — when importing a subset, `fetchSourceVideos` re-runs auto-select-all since it's effectively a new pipeline.

## Deviations from Plan

**[Rule 2 - Missing critical functionality] Added `isGenerating` to Preview All disabled condition**
- **Found during:** Task 2
- **Issue:** Plan specified `disabled={previewingIndex !== null || sourceVideos.length === 0 || selectedSourceIds.size === 0}` but `isGenerating` (script generation in progress) should also block Preview All — it was already partially mentioned in the plan but needed adding to the condition
- **Fix:** Added `isGenerating` to the disabled condition
- **Files modified:** `frontend/src/app/pipeline/page.tsx`
- **Commit:** `527caa4`

## User Setup Required

**Migration 021 must be applied manually:**
```sql
-- Run in Supabase Dashboard > SQL Editor
ALTER TABLE editai_pipelines
ADD COLUMN IF NOT EXISTS source_video_ids jsonb DEFAULT '[]'::jsonb;
COMMENT ON COLUMN editai_pipelines.source_video_ids IS 'Selected source video UUIDs for segment matching';
```

Until this migration is applied, the source picker still functions (uses in-memory state), but selections will not persist across page reloads. The DB save is wrapped in try/except and will silently fail with a warning log.

## Next Phase Readiness

- SRC-01, SRC-03, SRC-04 requirements complete
- Phase 40 (PREV — Preview improvements) can proceed
- Phase 41 (TIME — Timeline editor) can proceed after Phase 40

## Self-Check: PASSED

- FOUND: `frontend/src/app/pipeline/page.tsx`
- FOUND: `app/api/pipeline_routes.py`
- FOUND: `supabase/migrations/021_add_source_video_ids_to_pipelines.sql`
- FOUND: `.planning/phases/39-source-selection-frontend/39-01-SUMMARY.md`
- FOUND commit: `0622d45` (Task 1)
- FOUND commit: `527caa4` (Task 2)

---
*Phase: 39-source-selection-frontend*
*Completed: 2026-02-24*
