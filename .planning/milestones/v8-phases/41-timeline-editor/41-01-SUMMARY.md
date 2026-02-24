---
phase: 41-timeline-editor
plan: "01"
subsystem: frontend-pipeline
tags: [timeline, segment-assignment, ui-component, pipeline-step3]
dependency_graph:
  requires: [39-01, 38-01]
  provides: [TimelineEditor-component, available-segments-in-preview]
  affects: [frontend/src/app/pipeline/page.tsx, app/services/assembly_service.py]
tech_stack:
  added: []
  patterns: [shadcn-dialog, shadcn-scroll-area, color-coded-rows, segment-assignment-dialog]
key_files:
  created:
    - frontend/src/components/timeline-editor.tsx
  modified:
    - frontend/src/app/pipeline/page.tsx
    - app/services/assembly_service.py
decisions:
  - Export MatchPreview from pipeline/page.tsx so TimelineEditor can reference it without duplication
  - Collect available_segments from first preview response — all variants share same segment pool
  - Backend adds available_segments to preview_matches() return dict for zero-extra-request design
  - Remove dead product-association inline UI code (Package/Images/Layers icons, PiP state, handlers) left over from replaced top-3 section
metrics:
  duration: "8m 17s"
  completed: "2026-02-24"
  tasks_completed: 2
  files_changed: 3
---

# Phase 41 Plan 01: Timeline Editor Component Summary

**One-liner:** Visual phrase-to-segment timeline with green/amber color-coded rows and manual segment assignment dialog replacing the "Top 3 Matches" summary in Step 3.

## What Was Built

### Task 1: TimelineEditor component (8a38158)

New reusable component at `frontend/src/components/timeline-editor.tsx`:

- Vertical scrollable list of all SRT phrases as timeline rows (max-height 400px with ScrollArea)
- Each row: phrase index, time range (M:SS – M:SS), truncated text, match status
- Matched rows: green left border + green background, keyword badge, confidence percentage
- Unmatched rows: amber left border + amber background, "Unmatched" badge, "Select Segment" button
- Segment assignment Dialog: searchable list of available segments by keyword, selects and updates match in local state
- `onMatchesChange` callback propagates changes to parent page state
- Props: `matches`, `audioDuration`, `sourceVideoIds`, `availableSegments`, `onMatchesChange`

### Task 2: Pipeline page integration + backend (306a04a)

Modified `frontend/src/app/pipeline/page.tsx`:
- `export interface MatchPreview` — exported for TimelineEditor import
- Added `SegmentOption` type import and `availableSegments: SegmentOption[]` state
- `handlePreviewAll` now collects `available_segments` from first preview response
- Step 3 variant cards replaced "Top 3 Matches" section with `<TimelineEditor>` component
- Kept match summary counts (matched/unmatched/total) above the timeline
- `onMatchesChange` updates previews state including recalculated matched/unmatched counts
- Removed unused imports/state from removed inline product association UI

Modified `app/services/assembly_service.py`:
- `preview_matches()` return dict now includes `available_segments` key — list of `{id, keywords, source_video_id, duration}` objects built from the already-fetched `segments_data` list

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Cleanup] Removed dead product-association inline UI after replacing Top 3 Matches**
- **Found during:** Task 2 — ESLint reported 11 unused variables/imports after replacing the top-3-matches section
- **Issue:** `Package`, `Images`, `Layers` icons, `PipOverlayPanel`, `DEFAULT_PIP_CONFIG` import, `pipExpandedSegId`, `pipSaving` state, `handleRemoveAssociation`, `handleSavePipConfig` were all exclusively used in the top-3 inline product picker that we removed
- **Fix:** Removed the unused imports, state declarations, and handler functions. Kept `associations` state (still written by product fetch but no longer displayed — single warning acceptable since dialogs are still rendered at bottom)
- **Files modified:** `frontend/src/app/pipeline/page.tsx`
- **Commit:** 306a04a (part of Task 2 commit)

## Self-Check: PASSED

- [x] `frontend/src/components/timeline-editor.tsx` exists (272 lines)
- [x] `frontend/src/app/pipeline/page.tsx` updated with TimelineEditor import and rendering
- [x] `app/services/assembly_service.py` updated with `available_segments` in return dict
- [x] TypeScript compiles cleanly (only pre-existing test file error unrelated to this work)
- [x] Commits exist: 8a38158, 306a04a
- [x] Playwright screenshot taken: `frontend/screenshots/timeline-editor-pipeline.png`
