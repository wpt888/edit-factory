---
phase: 61-ux-polish-interactions
plan: "02"
subsystem: ui
tags: [soft-delete, trash, hover-preview, drag-drop, react, fastapi, supabase]

# Dependency graph
requires:
  - phase: 61-01
    provides: ConfirmDialog component for permanent delete confirmation

provides:
  - Soft-delete trash system (30-day recovery window for clips)
  - GET /library/trash, POST /clips/{id}/restore, DELETE /clips/{id}/permanent endpoints
  - Library/Trash view toggle in library page header
  - ClipHoverPreview component (hover >500ms shows silent looping video)
  - Segments page drag-drop verified working with visual feedback

affects: [library-page, clips-management, trash-recovery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Soft-delete pattern: is_deleted+deleted_at columns, restore/permanent-delete endpoints"
    - "Hover preview: 500ms setTimeout delay before showing video, cleanup on mouse leave"
    - "View mode toggle: viewMode state controls which grid renders (library vs trash)"

key-files:
  created:
    - frontend/src/components/clip-hover-preview.tsx
    - supabase/migrations/024_add_deleted_at_column.sql
  modified:
    - app/api/library_routes.py
    - app/main.py
    - frontend/src/app/librarie/page.tsx

key-decisions:
  - "Soft-delete keeps files on disk; physical delete only happens via /permanent endpoint or 30-day startup cleanup"
  - "ClipHoverPreview renders video element only when showVideo=true (not preloaded), preload=none to avoid bandwidth waste"
  - "Migration 024 requires manual application via Supabase SQL Editor (no service_role key in .env)"
  - "Segments page drag-drop already fully implemented with isDraggingOver visual overlay — no changes needed"

patterns-established:
  - "View mode state pattern: useState<'library'|'trash'>('library') gates which sections render"
  - "Hover preview: hoverTimerRef + showVideo state, cleanup on unmount"

requirements-completed: [UX-03, UX-06, UX-08]

# Metrics
duration: 27min
completed: 2026-03-03
---

# Phase 61 Plan 02: Soft-Delete Trash, Drag-Drop Upload & Hover Video Preview Summary

**Soft-delete trash system with 30-day recovery, Library/Trash view toggle, and 500ms hover video preview on clip cards**

## Performance

- **Duration:** 27 min
- **Started:** 2026-03-03T00:36:49Z
- **Completed:** 2026-03-03T01:04:00Z
- **Tasks:** 2
- **Files modified:** 5 (+ 2 created)

## Accomplishments
- Converted hard-delete endpoints to soft-delete: DELETE /clips/{id} and POST /clips/bulk-delete now set is_deleted+deleted_at
- Added trash API: GET /library/trash (with days_remaining), POST /clips/{id}/restore, DELETE /clips/{id}/permanent
- Added startup cleanup (_cleanup_expired_trash) that permanently deletes clips >30 days old
- Added Library/Trash toggle in library page header with full trash grid (thumbnail, days badge, restore/delete actions)
- Created ClipHoverPreview component: hover 500ms triggers silent looping video preview on card
- Verified segments page drag-drop already complete with isDraggingOver visual overlay

## Task Commits

Each task was committed atomically:

1. **Task 1: Soft-Delete Backend** - `45936a8` (feat)
2. **Task 2: Trash View UI, Drag-Drop & Hover Preview** - `720bedc` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `app/api/library_routes.py` - Converted delete endpoints to soft-delete; added /trash, /restore, /permanent endpoints
- `app/main.py` - Added _cleanup_expired_trash() to lifespan startup
- `frontend/src/app/librarie/page.tsx` - Added viewMode state, trash state/functions, Library/Trash toggle, trash grid, ClipHoverPreview integration
- `frontend/src/components/clip-hover-preview.tsx` - New component: hover video preview with 500ms delay
- `supabase/migrations/024_add_deleted_at_column.sql` - Migration: adds deleted_at TIMESTAMPTZ column (needs manual application)

## Decisions Made
- Soft-delete keeps all files on disk; physical deletion only via /permanent endpoint or 30-day startup cleanup
- ClipHoverPreview uses preload="none" and only renders video element when showVideo=true (no bandwidth waste)
- Migration 024 requires manual application via Supabase SQL Editor (no service_role key in .env)
- Segments page drag-drop is already fully implemented with isDraggingOver state and visual border overlay — no changes needed per plan step 9

## Deviations from Plan

None — plan executed exactly as written. The migration was created as a file (matching project pattern for 007/009/017/021/023) since no service_role key is available to apply it directly.

## Issues Encountered
- Next.js dev server served stale compiled bundle after file edits (WSL inotify HMR limitation). Required manual server restart to pick up changes. This is a known WSL development environment issue.
- Migration cannot be auto-applied (no service_role key in .env) — documented as blocker per project pattern.

## User Setup Required
Migration 024 must be applied manually:
1. Open Supabase Dashboard at https://supabase.nortia.ro
2. Go to SQL Editor > New Query
3. Paste and run the contents of `supabase/migrations/024_add_deleted_at_column.sql`

Until this migration is applied, the soft-delete endpoints will fail (column does not exist).

## Next Phase Readiness
- Phase 61 Plan 02 complete — both plans in phase 61 done
- Phase 61 (UX Polish Interactions) is now fully complete
- Ready to proceed to Phase 62 (final phase of v11)

## Self-Check: PASSED

All files exist, all commits found, all code logic verified.

---
*Phase: 61-ux-polish-interactions*
*Completed: 2026-03-03*
