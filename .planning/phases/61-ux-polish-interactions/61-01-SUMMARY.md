---
phase: 61-ux-polish-interactions
plan: "01"
subsystem: ui
tags: [react, shadcn, alert-dialog, dialog, video-player, keyboard-shortcuts]

# Dependency graph
requires: []
provides:
  - Shadcn AlertDialog component installed at frontend/src/components/ui/alert-dialog.tsx
  - ConfirmDialog reusable wrapper replacing all browser confirm() calls
  - InlineVideoPlayer modal component for in-app HTML5 video playback
  - Keyboard shortcuts in librarie page: Delete/Backspace (delete selected), Escape (close/clear), Space (play/pause)
affects: [62-ux-polish-interactions]

# Tech tracking
tech-stack:
  added: ["@radix-ui/react-alert-dialog (via shadcn)"]
  patterns:
    - Shared confirmDialog state pattern (single dialog instance with dynamic title/description/onConfirm)
    - Controlled AlertDialog via setConfirmDialog state instead of browser confirm()
    - InlineVideoPlayer accepts optional externalRef for keyboard play/pause control

key-files:
  created:
    - frontend/src/components/ui/alert-dialog.tsx
    - frontend/src/components/confirm-dialog.tsx
    - frontend/src/components/inline-video-player.tsx
  modified:
    - frontend/src/app/librarie/page.tsx
    - frontend/src/app/pipeline/page.tsx
    - frontend/src/app/settings/page.tsx

key-decisions:
  - "Single shared confirmDialog state per component (not per-action dialog instances) — simpler and sufficient since only one confirm can be open at a time"
  - "InlineVideoPlayer accepts optional externalRef (RefObject) so parent can control play/pause via keyboard shortcut"
  - "Keyboard shortcut handler in librarie only — pipeline/settings don't have per-item keyboard actions"

patterns-established:
  - "ConfirmDialog pattern: setConfirmDialog({ open: true, title, description, onConfirm: async () => { ... setConfirmDialog(prev => ({ ...prev, open: false })) } })"
  - "AlertDialog e.preventDefault() in onConfirm — prevents auto-close, caller controls close timing after API call"

requirements-completed: [UX-01, UX-02, UX-07]

# Metrics
duration: 35min
completed: 2026-03-03
---

# Phase 61 Plan 01: Inline Video Player, AlertDialogs & Keyboard Shortcuts Summary

**Shadcn AlertDialog replaces all 7 browser confirm() calls across librarie/pipeline/settings, with inline HTML5 video player and Delete/Escape/Space keyboard shortcuts in librarie**

## Performance

- **Duration:** 35 min
- **Started:** 2026-03-03T00:00:00Z
- **Completed:** 2026-03-03T00:33:54Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Installed Shadcn AlertDialog (@radix-ui/react-alert-dialog) and created reusable ConfirmDialog wrapper with destructive/default variants, loading state, and custom labels
- Replaced all 7 `window.confirm()` / `confirm()` calls: 4 in librarie (removeAudio, deleteClip, bulkDeleteSelected, bulkUploadToPostiz), 2 in pipeline (handleDeletePipeline, start-new-pipeline), 1 in settings (handleDeleteAccount)
- Created InlineVideoPlayer component using Dialog — Play button now opens HTML5 video in modal instead of new tab
- Added keyboard shortcuts in librarie: Delete/Backspace triggers delete dialog, Escape closes dialogs/clears selection, Space toggles play/pause on video player

## Task Commits

Each task was committed atomically:

1. **T1: Install Shadcn AlertDialog and Create ConfirmDialog Wrapper** - `9369e26` (feat)
2. **T2: Replace All confirm() Calls and Build Inline Video Player** - `e6bece7` (feat)

## Files Created/Modified
- `frontend/src/components/ui/alert-dialog.tsx` - Shadcn AlertDialog primitives (Radix UI based)
- `frontend/src/components/confirm-dialog.tsx` - Reusable controlled confirm dialog wrapper
- `frontend/src/components/inline-video-player.tsx` - HTML5 video modal with optional external ref
- `frontend/src/app/librarie/page.tsx` - Replaced 4 confirm() calls, added inline player + keyboard shortcuts
- `frontend/src/app/pipeline/page.tsx` - Replaced 2 confirm() calls with AlertDialog
- `frontend/src/app/settings/page.tsx` - Replaced 1 confirm() call with AlertDialog

## Decisions Made
- Single shared `confirmDialog` state per component (not per-action dialog instances) — one confirm dialog can be open at a time, shared state is simpler
- `InlineVideoPlayer` accepts optional `videoRef` (RefObject) from parent so keyboard Space shortcut can control play/pause without context or prop drilling
- `e.preventDefault()` in AlertDialogAction's onClick prevents Radix auto-close — caller controls dialog close after async API call completes
- Keyboard shortcuts guarded against input/textarea focus to avoid interfering with rename UI

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added externalRef support to InlineVideoPlayer**
- **Found during:** T2 (keyboard shortcuts — Space key needs to control video)
- **Issue:** Plan's InlineVideoPlayer spec didn't include videoRef prop, but Space key shortcut in librarie requires direct video element access
- **Fix:** Added optional `videoRef?: RefObject<HTMLVideoElement | null>` prop; component uses external ref if provided, internal ref otherwise
- **Files modified:** frontend/src/components/inline-video-player.tsx, frontend/src/app/librarie/page.tsx
- **Committed in:** e6bece7 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Required for Space key keyboard shortcut to work correctly. No scope creep.

## Issues Encountered
- Pre-existing Next.js build failure in `/setup/page.tsx` (missing Suspense wrapper for useSearchParams) — out of scope, not caused by this plan's changes. TypeScript compilation (`tsc --noEmit`) passes cleanly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AlertDialog pattern established and consistent across all 3 pages — ready for 61-02 (segments drag-drop upload, soft-delete trash)
- InlineVideoPlayer component ready for reuse in other pages if needed
- No blockers

---
*Phase: 61-ux-polish-interactions*
*Completed: 2026-03-03*
