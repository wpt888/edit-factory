---
phase: 32-association-data-layer
plan: 01
subsystem: database
tags: [supabase, postgresql, rls, migration, catalog, fastapi]

# Dependency graph
requires: []
provides:
  - "segment_product_associations table with segment_id FK, catalog_product_id, selected_image_urls JSONB, pip_config JSONB, slide_config JSONB"
  - "GET /api/v1/catalog/products/{id}/images endpoint returning variant images grouped by product"
  - "get_catalog_product_images() SQL function (SECURITY DEFINER, accessible to anon/authenticated)"
  - "public.handle_updated_at() trigger function in public schema"
affects:
  - "32-02 - association CRUD routes will build on segment_product_associations table"
  - "33-segment-picker-ui - images endpoint enables ASSOC-04 gallery selection"
  - "35-pip-overlay - pip_config column reserved for PiP settings"
  - "36-interstitial - slide_config column reserved for interstitial settings"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER SQL functions with SET search_path for cross-schema access from PostgREST anon/authenticated roles"
    - "GRANT EXECUTE TO anon, authenticated for public.* RPC functions accessing uf.* schema"
    - "DO $$ BEGIN IF NOT EXISTS... END $$ guard pattern for idempotent DDL migrations"

key-files:
  created:
    - "supabase/migrations/019_create_segment_product_associations.sql"
  modified:
    - "app/api/catalog_routes.py"

key-decisions:
  - "catalog_product_id stored as plain UUID without FK constraint (cross-schema FK to uf.products_catalog avoided due to RLS complexity)"
  - "UNIQUE constraint on segment_id enforces one product per segment (multiple products per segment out of scope for v7)"
  - "get_catalog_product_images() uses SECURITY DEFINER + SET search_path so anon/authenticated roles can call it via PostgREST RPC without direct access to uf schema"
  - "public.handle_updated_at() created in public schema (existing function was in editai schema, not accessible from public tables)"
  - "Images endpoint placed before /{product_id} endpoint in router to prevent FastAPI routing conflict with /images literal path"

patterns-established:
  - "Cross-schema DB functions: use SECURITY DEFINER + SET search_path + GRANT EXECUTE for PostgREST compatibility"

requirements-completed: [ASSOC-04]

# Metrics
duration: 8min
completed: 2026-02-23
---

# Phase 32 Plan 01: Association Data Layer Summary

**segment_product_associations table (RLS + indexes + trigger) and /catalog/products/{id}/images endpoint using SECURITY DEFINER grouped variant image lookup**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-23T12:39:56Z
- **Completed:** 2026-02-23T12:47:52Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `segment_product_associations` table with all 8 required columns, RLS enabled, 2 RLS policies (service_role bypass + authenticated ownership chain), 4 indexes (PK, unique, segment_id, catalog_product_id), and updated_at trigger
- Created `public.get_catalog_product_images()` SQL function using SECURITY DEFINER to expose cross-schema `uf.products_catalog` data to PostgREST anon/authenticated callers
- Added `GET /api/v1/catalog/products/{id}/images` endpoint returning grouped variant images with RPC fallback to product's own image_link

## Task Commits

Each task was committed atomically:

1. **Task 1: Create segment_product_associations migration** - `4ec9f9c` (feat)
2. **Task 2: Add catalog product images endpoint** - `636240c` (feat)

## Files Created/Modified
- `supabase/migrations/019_create_segment_product_associations.sql` - Full migration with table, RLS, indexes, trigger, and get_catalog_product_images function
- `app/api/catalog_routes.py` - Added GET /catalog/products/{product_id}/images endpoint with RPC + fallback pattern

## Decisions Made
- `catalog_product_id` stored as plain UUID without FK constraint to avoid cross-schema FK issues with RLS on `uf.products_catalog`
- UNIQUE constraint on `segment_id` enforces one product per segment (per v7 scope: multiple products out of scope)
- `get_catalog_product_images()` uses `SECURITY DEFINER` so the PostgREST anon role can access `uf.products_catalog` indirectly
- `public.handle_updated_at()` was created in public schema (existing function lived only in `editai` schema)
- New `/images` route placed before `/{product_id}` route to prevent FastAPI route conflict with the literal `/images` path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing public.handle_updated_at() function**
- **Found during:** Task 1 (trigger creation)
- **Issue:** Migration referenced `public.handle_updated_at()` but the function only existed in the `editai` schema, not `public`
- **Fix:** Created `CREATE OR REPLACE FUNCTION public.handle_updated_at()` in the migration
- **Files modified:** `supabase/migrations/019_create_segment_product_associations.sql`
- **Verification:** Trigger created successfully, updated_at trigger confirmed active
- **Committed in:** `4ec9f9c` (Task 1 commit)

**2. [Rule 1 - Bug] get_catalog_product_images() returned empty for anon role**
- **Found during:** Task 2 (endpoint verification)
- **Issue:** SQL function accessed `uf.products_catalog` but anon role lacks direct access to `uf` schema; PostgREST returned empty results for anon callers
- **Fix:** Recreated function with `SECURITY DEFINER SET search_path = public, uf` and added `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated`
- **Files modified:** `supabase/migrations/019_create_segment_product_associations.sql`, applied directly to database
- **Verification:** `/api/v1/catalog/products/{id}/images` returns image URLs correctly
- **Committed in:** `636240c` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** Both auto-fixes essential for correctness. No scope creep.

## Issues Encountered
- PostgREST schema cache takes a few seconds to reflect new functions — endpoint returned 404 during the brief cache refresh window after initial deployment. Resolved automatically after cache refresh.

## User Setup Required
None - migration applied directly to Supabase via pg/query API. No additional setup required.

## Next Phase Readiness
- `segment_product_associations` table is live and queryable in Supabase
- `GET /api/v1/catalog/products/{id}/images` is functional and returning grouped variant images
- Plan 02 (association CRUD routes) can build `GET/POST/PATCH/DELETE /segments/{id}/association` on top of this foundation
- `pip_config` and `slide_config` JSONB columns are reserved for Phase 35 and Phase 36

## Self-Check: PASSED

- `supabase/migrations/019_create_segment_product_associations.sql` — FOUND
- `app/api/catalog_routes.py` — FOUND
- Commit `4ec9f9c` (Task 1) — FOUND
- Commit `636240c` (Task 2) — FOUND
- DB table `segment_product_associations` (8 columns, RLS, 2 policies, 4 indexes) — VERIFIED
- Endpoint `GET /api/v1/catalog/products/{id}/images` returning images — VERIFIED

---
*Phase: 32-association-data-layer*
*Completed: 2026-02-23*
