---
phase: 41-timeline-editor
plan: "03"
subsystem: frontend-pipeline
tags: [timeline, duration-controls, match-overrides, render-pipeline, assembly-service]
dependency_graph:
  requires: [41-01, 41-02]
  provides: [duration-adjustment-ui, match-overrides-render-integration]
  affects:
    - frontend/src/components/timeline-editor.tsx
    - app/api/pipeline_routes.py
    - app/services/assembly_service.py
    - frontend/src/app/pipeline/page.tsx
tech_stack:
  added: []
  patterns: [duration-override-field, match-overrides-passthrough, build-timeline-overrides]
key_files:
  created: []
  modified:
    - frontend/src/components/timeline-editor.tsx
    - app/api/pipeline_routes.py
    - app/services/assembly_service.py
    - frontend/src/app/pipeline/page.tsx
decisions:
  - Add duration_override as optional field directly on MatchPreview interface — keeps data co-located with match, flows naturally through onMatchesChange callback
  - Frontend always sends previews.matches as match_overrides — even unmodified matches are forwarded, ensuring segment assignments from drag/swap also apply
  - duration_overrides extracted as parallel list before build_timeline — avoids MatchResult dataclass mutation
  - match_overrides=None as default preserves full backward compatibility with all callers
metrics:
  duration: "5m 49s"
  completed: "2026-02-24"
  tasks_completed: 2
  files_changed: 4
---

# Phase 41 Plan 03: Duration Adjustment and Render Integration Summary

**One-liner:** Duration +/- controls on timeline rows plus full match_overrides pipeline wiring so segment swaps, manual assignments, and duration edits from Plans 01/02 all flow into the final rendered video.

## What Was Built

### Task 1: Duration adjustment controls (e50547c)

Modified `frontend/src/components/timeline-editor.tsx` (387 → 447 lines):

- Added `duration_override?: number` optional field to `MatchPreview` interface
- Imported `Clock`, `Plus`, `Minus` from lucide-react
- Added `adjustDuration(index, delta)` handler: clamps to [0.5, 10]s, updates match via `onMatchesChange`
- Per-row duration control UI: Clock icon + Minus button + duration display + Plus button
- Duration shown in blue (`text-blue-600`) with `font-semibold` when it differs from natural SRT timing by >0.05s
- Natural duration (`srt_end - srt_start`) used as default when no override set
- Title tooltip on duration span shows "Adjusted from Xs" when overridden

### Task 2: Match overrides wired into render pipeline (4c7685d)

Modified `app/api/pipeline_routes.py`:
- `PipelineRenderRequest` model gets optional `match_overrides: Optional[Dict[int, List[dict]]] = None` field
- `do_render` background task extracts `variant_match_overrides` for the current variant index and passes to `assemble_and_render`

Modified `app/services/assembly_service.py`:
- `assemble_and_render()` gains `match_overrides: Optional[List[dict]] = None` parameter
- When `match_overrides` provided: builds `MatchResult` list from override dicts (skips automatic keyword matching), extracts `duration_overrides` list
- When `match_overrides` absent: runs normal `match_srt_to_segments()`, `duration_overrides = None`
- `build_timeline()` gains `duration_overrides: Optional[List[Optional[float]]] = None` parameter
- Loop changed to `enumerate` — applies `override` per index, falls back to `srt_end - srt_start` when None

Modified `frontend/src/app/pipeline/page.tsx`:
- `handleRender` builds `matchOverrides` dict from `previews[idx].matches` for each selected variant
- Sends `match_overrides` in the render POST body (omitted if empty)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `frontend/src/components/timeline-editor.tsx` updated (447 lines, +/- buttons on each row)
- [x] `duration_override` field on `MatchPreview` interface
- [x] `adjustDuration` handler clamps to [0.5, 10]s range
- [x] `app/api/pipeline_routes.py` `PipelineRenderRequest` has `match_overrides` field
- [x] `app/services/assembly_service.py` `assemble_and_render` has `match_overrides` param
- [x] `app/services/assembly_service.py` `build_timeline` has `duration_overrides` param
- [x] `frontend/src/app/pipeline/page.tsx` `handleRender` sends `match_overrides`
- [x] TypeScript compiles cleanly (only pre-existing test file error)
- [x] Python imports cleanly (`source .venv-wsl/bin/activate && python -c "from app.services.assembly_service import AssemblyService; print('OK')"`)
- [x] Method signatures verified: `assemble_and_render` and `build_timeline` show new params
- [x] Commits exist: e50547c, 4c7685d
- [x] Playwright screenshot taken: `frontend/screenshots/timeline-duration-controls.png`
