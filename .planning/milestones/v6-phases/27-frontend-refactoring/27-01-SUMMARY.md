---
phase: 27-frontend-refactoring
plan: 01
subsystem: ui
tags: [react, nextjs, refactoring, polling, components]

# Dependency graph
requires:
  - phase: 26-frontend-resilience
    provides: usePolling hook used for ClipStatusPoller pattern
provides:
  - 6 focused library components replacing 3085-line monolith
  - ClipStatusPoller using usePolling (no raw setInterval for polling)
  - Shared types module for library components
affects:
  - future library feature work (uses new component structure)
  - 27-02 and beyond (can extend individual components)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Invisible poller component pattern: render <ClipStatusPoller> conditionally instead of calling pollFn() with raw setInterval"
    - "Thin orchestrator page: page.tsx holds state+handlers, delegates all JSX to child components"
    - "State lifter: page.tsx passes setState functions down as props for shared mutable state"

key-files:
  created:
    - frontend/src/components/library/types.ts
    - frontend/src/components/library/project-sidebar.tsx
    - frontend/src/components/library/clip-editor-panel.tsx
    - frontend/src/components/library/postiz-publish-modal.tsx
    - frontend/src/components/library/segment-selection-modal.tsx
    - frontend/src/components/library/clip-gallery.tsx
  modified:
    - frontend/src/app/library/page.tsx

key-decisions:
  - "ClipStatusPoller is an invisible React component (returns null) that wraps usePolling — rendered conditionally per rendering clip ID, auto-cleans on unmount"
  - "renderingClipIds string[] replaces the old pollClipStatus function — multiple clips can be polled simultaneously via multiple ClipStatusPoller instances"
  - "PostizPublishModal owns its own state (integrations, caption, schedule) — fetches integrations on open via useEffect; previously page.tsx owned all Postiz state"
  - "SegmentSelectionModal owns its own state (sourceVideos, modalSegments, pendingSegment) — onSegmentsChange callback propagates selections to page.tsx"
  - "assignedSegmentsCount kept in page.tsx as a convenience counter alongside projectSegments array"

patterns-established:
  - "Invisible poller component: usePolling in a component that returns null, mounted/unmounted to start/stop polling"
  - "Component-owned modal state: modals own fetch state (integrations) and reset via useEffect on open prop"

requirements-completed: [REF-01, REF-02]

# Metrics
duration: 45min
completed: 2026-02-22
---

# Phase 27 Plan 01: Library Page Decomposition Summary

**3085-line library/page.tsx split into 6 focused components; raw setInterval pollClipStatus replaced by ClipStatusPoller component using usePolling hook**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-02-22T00:00:00Z
- **Completed:** 2026-02-22T00:45:00Z
- **Tasks:** 2
- **Files modified:** 7 (1 rewritten + 6 created)

## Accomplishments

- Created 6 files in `frontend/src/components/library/`: types.ts, project-sidebar.tsx, clip-editor-panel.tsx, postiz-publish-modal.tsx, segment-selection-modal.tsx, clip-gallery.tsx
- Eliminated raw `setInterval` polling pattern — `pollClipStatus` replaced by `ClipStatusPoller` invisible component using `usePolling` hook
- Reduced library/page.tsx JSX rendering to a thin orchestrator with <250 lines of JSX (1100 total with state/handlers)
- TypeScript compiles cleanly with zero type errors

## Task Commits

1. **Task 1: Extract shared types and 4 library sub-components** - `6bf465e` (feat)
2. **Task 2: Extract ClipGallery, replace pollClipStatus with usePolling, wire orchestrator** - `76ec710` (feat)

## Files Created/Modified

- `frontend/src/components/library/types.ts` - Shared interfaces: Project, Clip, ClipContent, SubtitleSettings, ExportPreset, SourceVideo, Segment, PostizIntegration + config helpers
- `frontend/src/components/library/project-sidebar.tsx` - Project list with create/delete/select (99 lines)
- `frontend/src/components/library/clip-editor-panel.tsx` - TTS/subtitles/enhancement/render controls right sidebar (256 lines)
- `frontend/src/components/library/postiz-publish-modal.tsx` - Social publishing modal with own state (296 lines)
- `frontend/src/components/library/segment-selection-modal.tsx` - 3-column segment selector with video player and keyword popup (469 lines)
- `frontend/src/components/library/clip-gallery.tsx` - Main center panel with ClipStatusPoller sub-component (1040 lines)
- `frontend/src/app/library/page.tsx` - Thin orchestrator: state + handlers + minimal JSX delegating to child components (1100 lines)

## Decisions Made

- `ClipStatusPoller` is an invisible React component (returns null) that wraps `usePolling` — rendered conditionally per rendering clip ID, auto-cleans on unmount. This satisfies REF-02 without needing hooks-in-functions workaround.
- `renderingClipIds: string[]` array replaces the old `pollClipStatus` function — supports multiple simultaneous clip renders naturally.
- `PostizPublishModal` owns its own state (integrations, caption, schedule) and resets via `useEffect` on `open` prop change — cleaner than page.tsx owning all Postiz state.
- `SegmentSelectionModal` owns its own modal-specific state (sourceVideos, modalSegments) while projectSegments lives in page.tsx — separation of modal-only vs shared state.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - TypeScript compiled cleanly on first attempt. The invisible-component pattern for ClipStatusPoller worked exactly as described in the plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Library page decomposition complete — individual components can now be extended independently
- ClipGallery is the next candidate for further decomposition if needed (1040 lines)
- Phase 27-02 can proceed with further refactoring or other library improvements

---
*Phase: 27-frontend-refactoring*
*Completed: 2026-02-22*
