---
phase: 41-timeline-editor
plan: "02"
subsystem: frontend-pipeline
tags: [timeline, drag-drop, segment-swap, ui-component, pipeline-step3]
dependency_graph:
  requires: [41-01]
  provides: [timeline-drag-drop, segment-swap-dialog]
  affects: [frontend/src/components/timeline-editor.tsx]
tech_stack:
  added: []
  patterns: [html5-drag-api, group-hover, swap-segment-assignments]
key_files:
  created: []
  modified:
    - frontend/src/components/timeline-editor.tsx
decisions:
  - Use HTML5 native Drag API (no new npm deps) — sufficient for simple vertical swap UX
  - Swap segment assignments on drop (not reorder rows) — SRT text/timing stays fixed, only segment mapping moves
  - Unified assigningIndex state covers both unmatched assignment and matched swap flows
  - Dialog title and sub-label switch dynamically based on whether target row is already matched
  - Swap button uses group-hover opacity-0/100 pattern to reduce visual clutter on matched rows
metrics:
  duration: "2m 58s"
  completed: "2026-02-24"
  tasks_completed: 2
  files_changed: 1
---

# Phase 41 Plan 02: Timeline Drag-Drop and Segment Swap Summary

**One-liner:** HTML5 drag-and-drop segment assignment swapping and hover-reveal swap button added to TimelineEditor, enabling full manual control over which video segment plays at each phrase.

## What Was Built

### Tasks 1 & 2: Drag-drop reorder + segment swap button (0f7b435)

Modified `frontend/src/components/timeline-editor.tsx` (272 → 387 lines):

**Task 1 — Drag-and-drop reorder:**
- `dragIndex` / `dragOverIndex` state for tracking drag position
- `draggable` attribute + full event handlers on each timeline row: `onDragStart`, `onDragOver`, `onDragLeave`, `onDrop`, `onDragEnd`
- GripVertical icon (lucide-react) as left-side drag handle with `cursor-grab` / `cursor-grabbing` styles
- Visual feedback: dragged row gets `opacity-50`, drop target gets `border-t-2 border-t-blue-500` indicator
- Drop handler swaps segment assignments (not row positions): SRT text/timing stays with original phrase, only `segment_id`, `segment_keywords`, `matched_keyword`, `confidence` moves between rows
- `e.dataTransfer.setData("text/plain")` included for Firefox compatibility
- `dragLeave` only clears state when leaving the row (not entering child elements)

**Task 2 — Segment swap button:**
- RefreshCw icon button added to matched timeline rows (right side, after confidence %)
- Button uses `opacity-0 group-hover:opacity-100 transition-opacity` pattern — hidden until row hover
- Parent row gets `group` class to enable group-hover
- Clicking opens the existing segment assignment dialog
- Unified `assigningIndex` state (renamed from `dialogOpenForIndex`) works for both unmatched assignment and swap
- Dialog title/label switches dynamically: "Swap Segment" / "Swapping segment for phrase" vs "Select Segment" / "Assigning to phrase"
- Swap sets confidence to 1.0 (manual selection)
- All changes call `onMatchesChange` callback to propagate to pipeline page state

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `frontend/src/components/timeline-editor.tsx` exists (387 lines, exceeds min 250)
- [x] `onMatchesChange` called from both drop handler and segment select handler
- [x] `GripVertical` drag handle visible on each row
- [x] `RefreshCw` swap button on matched rows with group-hover
- [x] Dialog title switches based on swap vs assign mode
- [x] TypeScript compiles cleanly (only pre-existing test file error, unrelated)
- [x] Commit exists: 0f7b435
- [x] Playwright screenshot taken: `frontend/screenshots/timeline-dnd-swap.png`
