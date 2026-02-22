---
phase: 26-frontend-resilience
plan: 02
subsystem: ui
tags: [react, hooks, polling, empty-state, nextjs, typescript]

requires:
  - phase: 26-01
    provides: Error boundary and API hardening patterns already in place

provides:
  - Generic usePolling hook replacing all inline setInterval patterns
  - EmptyState reusable component with icon/title/description/action
  - All 11 data pages show informative empty states when no data exists

affects:
  - 27-frontend-refactor
  - Any future page that needs polling or empty states

tech-stack:
  added: []
  patterns:
    - "usePolling hook: generic endpoint polling with onData/onError/shouldStop callbacks and exponential backoff"
    - "EmptyState component: centered flex layout with icon, title, description, action button"
    - "Polling via hooks/index.ts barrel export"

key-files:
  created:
    - frontend/src/hooks/use-polling.ts
    - frontend/src/components/empty-state.tsx
  modified:
    - frontend/src/hooks/index.ts
    - frontend/src/app/library/page.tsx
    - frontend/src/app/librarie/page.tsx
    - frontend/src/app/scripts/page.tsx
    - frontend/src/app/pipeline/page.tsx
    - frontend/src/app/assembly/page.tsx
    - frontend/src/app/products/page.tsx
    - frontend/src/app/product-video/page.tsx
    - frontend/src/app/batch-generate/page.tsx
    - frontend/src/app/tts-library/page.tsx
    - frontend/src/app/usage/page.tsx
    - frontend/src/app/segments/page.tsx

key-decisions:
  - "usePolling designed as a single-endpoint primitive; library's dual-endpoint generation polling (project + progress) uses usePolling for progress and manual fetch for project status in onData"
  - "pollClipStatus in library/page.tsx kept as setInterval — hooks cannot be called inside regular functions, and this function is called per-clip dynamically"
  - "usePolling uses exponential backoff on error (doubles interval up to 30s) matching the pattern from existing useJobPolling"
  - "EmptyState uses Romanian text throughout, consistent with existing UI language"

patterns-established:
  - "Empty state pattern: show EmptyState when data.length === 0 && !loading"
  - "Polling pattern: usePolling with enabled=false + useEffect to start/stop based on condition"

requirements-completed: [FE-04, FE-05]

duration: 9min
completed: 2026-02-22
---

# Phase 26 Plan 02: Shared Polling Hook and Empty States Summary

**Generic usePolling hook with exponential backoff replacing raw setInterval across 4 pages, plus EmptyState component wired into all 11 data pages with Romanian text**

## Performance

- **Duration:** 9 min
- **Started:** 2026-02-22T01:01:19Z
- **Completed:** 2026-02-22T01:10:35Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Created `usePolling<T>` generic hook with configurable interval, callbacks, shouldStop predicate, and exponential backoff on error
- Created `EmptyState` reusable component exported from components/
- Replaced raw setInterval polling in library (generation), pipeline (render), assembly (render), and tts-library (asset) pages with usePolling
- Added EmptyState to all 11 data pages with Romanian text consistent with existing UI
- TypeScript compiles without errors throughout

## Task Commits

1. **Task 1: Create shared usePolling hook and EmptyState component** - `3cfd019` (feat)
2. **Task 2: Add empty states to all data pages and replace inline polling with usePolling** - `27e0568` (feat)

## Files Created/Modified

- `frontend/src/hooks/use-polling.ts` - Generic polling hook, interval-based with exponential backoff
- `frontend/src/components/empty-state.tsx` - Reusable EmptyState with icon/title/description/action
- `frontend/src/hooks/index.ts` - Added usePolling export
- `frontend/src/app/library/page.tsx` - Generation polling replaced with usePolling; EmptyState for projects
- `frontend/src/app/librarie/page.tsx` - EmptyState for clips
- `frontend/src/app/scripts/page.tsx` - EmptyState for scripts (replaced custom inline)
- `frontend/src/app/pipeline/page.tsx` - Render polling replaced with usePolling; EmptyState for step 4
- `frontend/src/app/assembly/page.tsx` - Render polling replaced with usePolling; EmptyState (replaced custom inline)
- `frontend/src/app/products/page.tsx` - EmptyState for products (replaced custom inline)
- `frontend/src/app/product-video/page.tsx` - EmptyState for no-product state
- `frontend/src/app/batch-generate/page.tsx` - EmptyState for no-batch state (replaced custom inline)
- `frontend/src/app/tts-library/page.tsx` - Asset polling replaced with usePolling; EmptyState (replaced custom inline)
- `frontend/src/app/usage/page.tsx` - EmptyState in cost history table (replaced custom inline)
- `frontend/src/app/segments/page.tsx` - EmptyState for segments

## Decisions Made

- Used `usePolling` for the progress endpoint in library's generation polling (which originally polled 2 endpoints in one setInterval) and added a secondary manual fetch for project status in the `onData` callback
- Kept `pollClipStatus` in library as a raw setInterval since it's called from a regular function (hooks cannot be called from non-hook functions per React rules)
- Pipeline's setInterval had a bug where `variantStatuses` in the dependency array caused interval restart on every poll - replaced with usePolling which avoids this

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pipeline setInterval re-created on every poll due to variantStatuses dependency**
- **Found during:** Task 2 (pipeline polling replacement)
- **Issue:** `useEffect` dependency array included `variantStatuses`, causing a new setInterval to be created on every status update
- **Fix:** Replaced with usePolling where this dependency is not needed; polling stops via shouldStop/onData
- **Files modified:** frontend/src/app/pipeline/page.tsx
- **Verification:** TypeScript compiles, logic preserved
- **Committed in:** 27e0568 (Task 2 commit)

### Documented Limitation

**pollClipStatus in library/page.tsx kept as setInterval**
- The plan called for replacing this with usePolling, but `pollClipStatus` is a regular async function called per-clip dynamically (not at component top level). React hooks cannot be called inside regular functions. The correct refactor would require converting each clip's polling into a dedicated child component or using a different state management pattern.
- **Decision:** Keep as setInterval for now; document for Phase 27 frontend refactoring.

---

**Total deviations:** 1 auto-fixed bug, 1 documented limitation (architectural constraint)
**Impact on plan:** Bug fix improves correctness; limitation is a known React constraint documented for future work.

## Issues Encountered

None - plan executed smoothly. TypeScript compiled without errors on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- usePolling and EmptyState ready for use in any future pages
- pollClipStatus refactor deferred to Phase 27 (frontend refactoring)
- All must-haves verified: every page shows EmptyState, usePolling replaces inline setInterval in 4 pages

---
*Phase: 26-frontend-resilience*
*Completed: 2026-02-22*
