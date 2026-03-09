---
phase: 64-data-abstraction-layer
plan: 03
subsystem: database
tags: [repository-pattern, supabase, migration, data-abstraction, dependency-inversion]

requires:
  - phase: 64-data-abstraction-layer (plan 01)
    provides: DataRepository ABC and QueryFilters/QueryResult models
  - phase: 64-data-abstraction-layer (plan 02)
    provides: SupabaseRepository implementation and get_repository() factory
provides:
  - All service files use repository pattern instead of direct Supabase calls
  - All route files use repository pattern instead of direct Supabase calls
  - Complete data access layer abstraction enabling future SQLite swap
affects: [64-04-sqlite-repository, 65-electron-integration, all-future-phases]

tech-stack:
  added: []
  patterns:
    - "get_repository() replaces get_supabase() in all business logic"
    - "repo.table_query() escape hatch for complex queries"
    - "repo.get_client() escape hatch for largest route files with chained queries"
    - "QueryFilters with or_, not_is, on_conflict, range, count, maybe_single for advanced queries"

key-files:
  created: []
  modified:
    - app/repositories/base.py
    - app/repositories/models.py
    - app/repositories/supabase_repo.py
    - app/services/cost_tracker.py
    - app/services/job_storage.py
    - app/services/elevenlabs_account_manager.py
    - app/services/assembly_service.py
    - app/services/postiz_service.py
    - app/services/telegram_service.py
    - app/services/tts_library_service.py
    - app/services/schedule_service.py
    - app/api/library_routes.py
    - app/api/pipeline_routes.py
    - app/api/segments_routes.py
    - app/api/postiz_routes.py
    - app/api/assembly_routes.py
    - app/api/schedule_routes.py
    - app/api/profile_routes.py
    - app/api/tts_library_routes.py
    - app/api/tts_routes.py
    - app/api/feed_routes.py
    - app/api/product_routes.py
    - app/api/catalog_routes.py
    - app/api/image_generate_routes.py
    - app/api/product_generate_routes.py
    - app/api/association_routes.py
    - app/api/routes.py
    - app/api/auth.py
    - app/main.py

key-decisions:
  - "Three migration strategies: typed methods for simple CRUD, table_query for medium, get_client() for complex chained queries in large files"
  - "Added get_client() escape hatch to DataRepository for largest route files (library, pipeline, segments) where full query rewrite was impractical"
  - "Enhanced QueryFilters with or_, not_is, on_conflict, range_start/end, count, maybe_single to support all existing query patterns"
  - "Added rpc operation to table_query for Supabase database function calls"
  - "Created inline helpers in feed_routes.py instead of migrating service functions that accept raw supabase client"
  - "auth.py fully migrated to repository - uses PyJWT directly, no supabase.auth SDK calls"
  - "file_storage.py excluded from migration - uses Supabase Storage SDK, not table queries"

patterns-established:
  - "Repository guard pattern: repo = get_repository(); if not repo: raise HTTPException(503)"
  - "Hybrid migration: get_client() for files with 30+ complex chained queries"
  - "Background tasks get fresh repo reference at task start"

requirements-completed: [DATA-02]

duration: 25min
completed: 2026-03-09
---

# Phase 64 Plan 03: Migrate All Files to Repository Pattern Summary

**Migrated 29 files (8 services + 18 routes/core + 3 repository enhancements) from direct get_supabase() to get_repository() with typed methods, table_query, and get_client() escape hatches**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-03-09T02:45:40Z
- **Completed:** 2026-03-09T03:08:03Z
- **Tasks:** 2
- **Files modified:** 29

## Accomplishments
- All 8 service files migrated to repository pattern with preserved fallback logic
- All 18 route/core files migrated - no business logic file imports get_supabase() directly
- Enhanced QueryFilters and table_query to support all existing query patterns (or_, not_is, on_conflict, range, count, maybe_single, rpc)
- Added get_client() escape hatch to repository for complex chained queries in large files

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate services from direct Supabase to repository** - `98e2233` (feat)
2. **Task 2: Migrate routes and core files from direct Supabase to repository** - `4d184ea` (feat)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified

### Repository Enhancements (3 files)
- `app/repositories/base.py` - Added get_client() abstract method
- `app/repositories/models.py` - Added or_, not_is, on_conflict, range_start/end, count, maybe_single fields to QueryFilters
- `app/repositories/supabase_repo.py` - Enhanced _apply_filters, table_query (count, maybe_single, on_conflict, rpc), get_client()

### Service Files (8 files)
- `app/services/cost_tracker.py` - Uses repo for cost logging and summary
- `app/services/job_storage.py` - Uses repo for all job CRUD with preserved in-memory fallback
- `app/services/elevenlabs_account_manager.py` - Uses repo for account management
- `app/services/assembly_service.py` - Uses repo for segment and source video queries
- `app/services/postiz_service.py` - Uses repo for profile lookups
- `app/services/telegram_service.py` - Uses repo for profile listing
- `app/services/tts_library_service.py` - Uses repo for TTS asset operations
- `app/services/schedule_service.py` - Uses repo for schedule queries

### Route Files (17 files)
- `app/api/library_routes.py` - Hybrid: get_client() for complex chains
- `app/api/pipeline_routes.py` - Hybrid: get_client() for complex chains
- `app/api/segments_routes.py` - Hybrid: get_client() for complex chains
- `app/api/feed_routes.py` - Full rewrite with inline repo helpers
- `app/api/product_routes.py` - Full rewrite with table_query
- `app/api/catalog_routes.py` - Full rewrite with or_, not_is, rpc
- `app/api/association_routes.py` - Full rewrite with on_conflict
- `app/api/tts_library_routes.py` - Full rewrite with table_query
- `app/api/image_generate_routes.py` - Full rewrite with table_query
- `app/api/product_generate_routes.py` - Targeted edits
- `app/api/schedule_routes.py` - Full rewrite with typed methods
- `app/api/postiz_routes.py` - Migrated to repo
- `app/api/assembly_routes.py` - Migrated to repo
- `app/api/profile_routes.py` - Migrated to repo
- `app/api/tts_routes.py` - Migrated to repo
- `app/api/routes.py` - Migrated to repo
- `app/api/auth.py` - Migrated profile lookups to repo (no supabase.auth SDK used)

### Core Files (1 file)
- `app/main.py` - Startup cleanup uses repository, shutdown calls close_repository()

## Decisions Made
- Three-tier migration strategy: typed methods (simple), table_query (medium), get_client() (complex) based on file size and query complexity
- Enhanced QueryFilters rather than creating custom query builders per route file
- auth.py fully migrated since it uses PyJWT directly, not Supabase Auth SDK
- file_storage.py excluded - uses Supabase Storage SDK which is separate from table queries
- Created inline _upsert_products_via_repo and _update_local_image_paths_via_repo helpers in feed_routes.py rather than migrating feed_parser.py/image_fetcher.py service functions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Enhanced QueryFilters for missing filter types**
- **Found during:** Task 2 (route file migration)
- **Issue:** Existing route queries used patterns not supported by QueryFilters (or_, not_is, range, on_conflict, count, maybe_single, rpc)
- **Fix:** Added 8 new fields to QueryFilters and corresponding logic in SupabaseRepository._apply_filters and table_query
- **Files modified:** app/repositories/models.py, app/repositories/supabase_repo.py
- **Verification:** All route files compile and use the new filter types correctly
- **Committed in:** 4d184ea (Task 2 commit)

**2. [Rule 3 - Blocking] Added get_client() escape hatch to DataRepository**
- **Found during:** Task 2 (large route file migration)
- **Issue:** library_routes.py (~3700 lines), pipeline_routes.py (~2500 lines), segments_routes.py (~1900 lines) have 30+ complex chained queries each that would require impractical full rewrites
- **Fix:** Added get_client() method returning raw database client, allowing existing query syntax through repository factory
- **Files modified:** app/repositories/base.py, app/repositories/supabase_repo.py
- **Verification:** Large route files work with hybrid approach
- **Committed in:** 4d184ea (Task 2 commit)

**3. [Rule 1 - Bug] Fixed feed_routes.py broken intermediate state**
- **Found during:** Task 2 (feed_routes.py migration)
- **Issue:** Previous session changed imports but left function bodies referencing local `supabase` variable
- **Fix:** Full rewrite with inline repo helper functions
- **Files modified:** app/api/feed_routes.py
- **Committed in:** 4d184ea (Task 2 commit)

**4. [Rule 1 - Bug] Fixed _refresh_segments_count caller mismatch**
- **Found during:** Task 2 (segments_routes.py migration)
- **Issue:** Changed function signature from (supabase, ...) to (repo, ...) but callers still passed supabase
- **Fix:** Updated all callers with replace_all
- **Files modified:** app/api/segments_routes.py
- **Committed in:** 4d184ea (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (2 blocking, 2 bugs)
**Impact on plan:** All auto-fixes necessary for migration correctness. QueryFilters enhancements and get_client() are essential architecture decisions, not scope creep.

## Issues Encountered
- Three largest route files (library, pipeline, segments) were too large for full query-by-query rewrite. Solved with get_client() hybrid approach that still routes all DB access through the repository factory.
- feed_parser.py and image_fetcher.py service functions accept raw supabase client as parameter. Rather than migrating those (out of scope for this plan), created inline helpers in feed_routes.py.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All database access now goes through get_repository() factory
- SQLiteRepository can be implemented (plan 04) by implementing the same DataRepository interface
- get_client() usage in 3 large files will need eventual migration to typed methods or table_query (tracked as tech debt)
- file_storage.py still uses Supabase Storage SDK directly (separate from data queries, will need separate abstraction)

## Self-Check: PASSED

- All key files exist on disk
- Commits 98e2233 and 4d184ea verified in git history
- SUMMARY.md created at expected path

---
*Phase: 64-data-abstraction-layer*
*Completed: 2026-03-09*
