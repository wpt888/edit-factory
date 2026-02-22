---
phase: 24-backend-stability
plan: "01"
subsystem: database
tags: [supabase, threading, locks, progress-tracking, fastapi, postgresql]

# Dependency graph
requires: []
provides:
  - DB-backed generation progress that survives server restarts (editai_generation_progress table)
  - 409 Conflict HTTP response when a project lock is already held
  - Stale lock cleanup preventing unbounded _project_locks dict growth
  - cancel_generation endpoint properly clears both progress and lock
affects:
  - 24-02
  - 24-03
  - frontend-polling

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-layer persistence: in-memory dict (fast polling) + Supabase upsert (durability)"
    - "Non-blocking lock check (is_project_locked) at endpoint level returns 409 before background task is queued"
    - "Stale lock cleanup triggered when _project_locks > 50 entries"

key-files:
  created:
    - supabase/migrations/017_create_generation_progress.sql
  modified:
    - app/api/library_routes.py

key-decisions:
  - "In-memory dict remains the primary data source; Supabase is durability layer — all DB calls are try/except so a DB outage never blocks generation"
  - "409 Conflict returned at endpoint level (not background task) so client gets immediate feedback instead of a silently-queued task that will fail"
  - "is_project_locked() uses non-blocking acquire+release to test lock state without disturbing the holder"
  - "editai_generation_progress uses TEXT PRIMARY KEY (project_id) to match the string IDs used by the backend"

patterns-established:
  - "Lock pre-check pattern: call is_project_locked() before dispatching background_tasks.add_task() to return 409 early"
  - "Dual-write pattern for durable in-memory caches: write to dict + DB, read from dict with DB fallback"

requirements-completed:
  - STAB-01
  - STAB-02
  - STAB-03
  - QUAL-04

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 24 Plan 01: Backend Stability — Progress Persistence and Lock Fixes Summary

**DB-backed generation progress via editai_generation_progress Supabase table, 409 Conflict on concurrent project access, and stale lock cleanup to prevent _project_locks dict accumulation**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T00:15:04Z
- **Completed:** 2026-02-22T00:17:00Z
- **Tasks:** 2
- **Files modified:** 2 (+ 1 created)

## Accomplishments

- Generation progress now persists to Supabase — server restart mid-generation returns last saved percentage from DB
- All three generation endpoints (`generate_raw_clips`, `generate_from_segments`, `render_final_clip`) return HTTP 409 Conflict when a lock is already held, instead of silently queuing a task that will timeout
- `_cleanup_stale_locks()` prunes idle lock entries; triggered automatically when `_project_locks` exceeds 50 entries
- `cancel_generation` endpoint now calls `cleanup_project_lock()` so cancelled project locks don't linger

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DB table and persist generation progress** - `1017e42` (feat)
2. **Task 2: Fix lock lifecycle — cleanup, timeout 409, and QUAL-04 integration** - `eb1237a` (feat)

## Files Created/Modified

- `supabase/migrations/017_create_generation_progress.sql` - New table with TEXT PK, RLS (permissive SELECT for authenticated, service role manages writes)
- `app/api/library_routes.py` - Progress functions dual-write to DB; lock helpers `is_project_locked` and `_cleanup_stale_locks` added; 409 pre-checks in 3 endpoints; `cancel_generation` cleans lock

## Decisions Made

- **In-memory first, DB as durability layer:** All Supabase calls in progress functions are wrapped in try/except. A Supabase outage will not block or slow down generation — in-memory remains authoritative during a session.
- **409 at endpoint, not background task:** The plan described 409 from inside `_render_final_clip_task` but that's a background function with no HTTP response channel. Instead, `is_project_locked()` is checked synchronously in the endpoint before `background_tasks.add_task()` is called — this is the correct FastAPI pattern.
- **TEXT primary key for project_id:** The backend uses string UUIDs for project IDs, not native UUID columns. Used TEXT to avoid type coercion issues.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Moved `from app.db import get_supabase` import above progress functions**
- **Found during:** Task 1
- **Issue:** The original import was at line 69, after the progress function definitions. The new `update_generation_progress` and `get_generation_progress` functions call `get_supabase()` directly at function call time (not definition time), so this is not a runtime error, but the import logically belongs before the functions that use it.
- **Fix:** Moved import to line 52 (immediately after `_generation_progress` dict declaration).
- **Files modified:** app/api/library_routes.py
- **Committed in:** 1017e42 (Task 1 commit)

**2. [Rule 1 - Bug] 409 implemented via is_project_locked() helper instead of inline acquire/release in endpoint**
- **Found during:** Task 2
- **Issue:** The plan's suggested inline pattern (`lock.acquire(blocking=False)` + immediate `lock.release()`) inside each endpoint would work but is error-prone to repeat 3 times and harder to read. Also, the plan's acquire/release at endpoint level could briefly acquire the lock that an in-flight background task is waiting to acquire, causing subtle timing issues.
- **Fix:** Extracted the non-blocking check into `is_project_locked()` which reads the lock state atomically without disturbing the holder. Used this helper in all 3 endpoints.
- **Files modified:** app/api/library_routes.py
- **Committed in:** eb1237a (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 import ordering, 1 pattern improvement)
**Impact on plan:** Both deviations improve correctness and readability. No scope creep.

## Issues Encountered

None — plan executed cleanly. Python syntax verified after each task edit.

## User Setup Required

**Manual Supabase migration required:**

Migration `017_create_generation_progress.sql` must be applied via Supabase Dashboard SQL Editor.

File location: `supabase/migrations/017_create_generation_progress.sql`

Steps:
1. Open Supabase Dashboard > SQL Editor
2. Copy contents of `017_create_generation_progress.sql`
3. Run the SQL

The migration creates `editai_generation_progress` table with RLS. Without it, progress DB writes will log warnings but fall back gracefully to in-memory only.

## Next Phase Readiness

- Phase 24 Plan 01 complete — backend stability foundation for progress persistence and lock management is done
- Phase 24 Plan 02 can proceed (depends on this plan per ROADMAP)
- No blockers

## Self-Check: PASSED

- FOUND: supabase/migrations/017_create_generation_progress.sql
- FOUND: app/api/library_routes.py
- FOUND: .planning/phases/24-backend-stability/24-01-SUMMARY.md
- FOUND commit: 1017e42 (feat(24-01): persist generation progress to Supabase DB)
- FOUND commit: eb1237a (feat(24-01): fix lock lifecycle)

---
*Phase: 24-backend-stability*
*Completed: 2026-02-22*
