---
phase: 28-code-quality
plan: 01
subsystem: api
tags: [supabase, refactoring, logging, backend, database-client]

# Dependency graph
requires:
  - phase: 24-backend-stability
    provides: app/db.py singleton Supabase client
provides:
  - Single centralized Supabase client access point via app.db
  - Clean log output without [MUTE DEBUG] noise
affects: [all backend route files, postiz_service]

# Tech tracking
tech-stack:
  added: []
  patterns: [Centralized DB client singleton via app.db import in all backend modules]

key-files:
  created: []
  modified:
    - app/api/product_generate_routes.py
    - app/api/feed_routes.py
    - app/api/tts_routes.py
    - app/api/product_routes.py
    - app/api/script_routes.py
    - app/api/postiz_routes.py
    - app/api/assembly_routes.py
    - app/api/pipeline_routes.py
    - app/api/profile_routes.py
    - app/services/postiz_service.py
    - app/api/library_routes.py

key-decisions:
  - "28-01: All backend modules import get_supabase from app.db — no local redefinitions; app.db is the single source of truth for Supabase client initialization"
  - "28-01: [MUTE DEBUG] logger.info lines deleted entirely (not downgraded) — they were temporary debug artifacts not intended for long-term use"

patterns-established:
  - "Supabase client pattern: always import from app.db, never redefine locally"

requirements-completed: [QUAL-01, QUAL-03]

# Metrics
duration: 15min
completed: 2026-02-22
---

# Phase 28 Plan 01: Code Quality - Supabase Centralization and Debug Cleanup Summary

**Eliminated 10 duplicate Supabase client definitions by centralizing all access through app/db.py, and removed 9 [MUTE DEBUG] log lines from library_routes.py**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-02-22T01:40:00Z
- **Completed:** 2026-02-22T01:55:28Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Removed 10 duplicate get_supabase/_get_supabase function definitions scattered across route and service files
- Added `from app.db import get_supabase` to all 10 affected files, replacing all call sites
- Deleted all 9 [MUTE DEBUG] logger.info lines from library_routes.py, cleaning up log output
- 18 Python files now consistently import Supabase from a single source (app.db)

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace all duplicate Supabase client definitions with app.db import** - `6b9ef9c` (refactor)
2. **Task 2: Remove [MUTE DEBUG] log lines and clean up debug print statements** - `05e0a3a` (refactor)

## Files Created/Modified
- `app/api/product_generate_routes.py` - Removed _get_supabase(), added app.db import, replaced call sites
- `app/api/feed_routes.py` - Removed _get_supabase(), added app.db import, replaced call sites
- `app/api/tts_routes.py` - Removed _get_supabase(), added app.db import, replaced call site
- `app/api/product_routes.py` - Removed _get_supabase(), added app.db import, replaced call sites
- `app/api/script_routes.py` - Removed local get_supabase() with local _supabase_client var, added app.db import
- `app/api/postiz_routes.py` - Removed local get_supabase() that wrapped library_routes, added app.db import
- `app/api/assembly_routes.py` - Removed local get_supabase() with local _supabase_client var, added app.db import
- `app/api/pipeline_routes.py` - Removed local get_supabase() with local _supabase_client var, added app.db import
- `app/api/profile_routes.py` - Removed local get_supabase() with local _supabase_client var, added app.db import
- `app/services/postiz_service.py` - Removed _get_supabase() that re-imported library_routes, added app.db import
- `app/api/library_routes.py` - Deleted 9 [MUTE DEBUG] logger.info lines from generate-from-segments endpoint

## Decisions Made
- Deleted [MUTE DEBUG] lines entirely rather than downgrading to debug level — they were temporary debugging artifacts marked for removal, not permanent logging
- The `_get_supabase` class method in `elevenlabs_account_manager.py` was left in place — it is a class method wrapper that internally calls `from app.db import get_supabase`, not a duplicate module-level definition

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- WSL Python environment missing cv2, srt, and google.genai packages — these are pre-existing environment issues unrelated to our changes. Individual route imports that don't depend on these packages (product_generate, feed, profile, postiz_routes, postiz_service, product_routes) all import successfully.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All backend modules now follow a uniform Supabase access pattern
- Log output is clean of MUTE DEBUG noise, making real debugging easier
- No blockers for remaining Phase 28 plans

---
*Phase: 28-code-quality*
*Completed: 2026-02-22*
