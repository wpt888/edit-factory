---
phase: 32-association-data-layer
plan: 02
subsystem: api
tags: [fastapi, supabase, pydantic, crud, associations, product-overlay]

# Dependency graph
requires:
  - phase: 32-01
    provides: "segment_product_associations table with segment_id FK, catalog_product_id, selected_image_urls JSONB, pip_config JSONB, slide_config JSONB"
provides:
  - "POST /api/v1/associations - upsert segment-product association (ASSOC-01)"
  - "DELETE /api/v1/associations/segment/{id} - remove product association (ASSOC-02)"
  - "GET /api/v1/associations/segment/{id} - fetch association with product details (ASSOC-03)"
  - "GET /api/v1/associations/segments - batch fetch associations (ASSOC-03)"
  - "PATCH /api/v1/associations/{id} - update selected image URLs (ASSOC-04)"
affects:
  - "33-segment-picker-ui - frontend calls POST/GET/DELETE to manage associations on segments page"
  - "34-pipeline-overlay-ui - pipeline page calls same endpoints for product overlay linking"
  - "35-pip-overlay - PATCH endpoint will receive pip_config updates in addition to selected_image_urls"
  - "36-interstitial - PATCH endpoint will receive slide_config updates"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Profile-scoped CRUD pattern: validate segment ownership before association create/read/delete"
    - "Batch fetch with bulk product enrichment (collect product_ids, single IN query) to prevent N+1"
    - "Upsert on single-column unique constraint (segment_id) for idempotent association creation"

key-files:
  created:
    - "app/api/association_routes.py"
  modified:
    - "app/main.py"

key-decisions:
  - "GET /associations/segments placed before GET /associations/segment/{id} to prevent FastAPI routing conflict with literal 'segments' path"
  - "Batch endpoint fetches all product details in one IN query (not N separate calls) — essential for segments page with many rows"
  - "PATCH joins to editai_segments via FK in select to perform profile ownership check without a separate query"

patterns-established:
  - "Profile ownership check pattern: query segments table to confirm profile_id matches before association mutation"

requirements-completed: [ASSOC-01, ASSOC-02, ASSOC-03, ASSOC-04]

# Metrics
duration: 2min
completed: 2026-02-23
---

# Phase 32 Plan 02: Association CRUD Routes Summary

**Five-endpoint FastAPI router for segment-product associations: upsert, read (single + batch), update images, delete — all profile-scoped and enriched with product title/image/brand from v_catalog_products_grouped**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-23T12:51:15Z
- **Completed:** 2026-02-23T12:53:09Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `app/api/association_routes.py` with all 5 CRUD endpoints, Pydantic models (AssociationCreate, AssociationUpdate, AssociationResponse), and profile-scoping on every route
- Batch GET endpoint (`GET /associations/segments?segment_ids=...`) uses a single IN query for product enrichment to prevent N+1 on the segments page
- Registered `association_router` in `app/main.py` under `/api/v1` prefix, following catalog_router pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Create association CRUD routes** - `6f635d4` (feat)
2. **Task 2: Register association router in main.py** - `2276773` (feat)

## Files Created/Modified
- `app/api/association_routes.py` - Full CRUD router: POST upsert, GET single, GET batch, PATCH images, DELETE; profile-scoped; product details enriched from v_catalog_products_grouped
- `app/main.py` - Added import of association_router and include_router call at /api/v1

## Decisions Made
- Route ordering: `GET /associations/segments` placed before `GET /associations/segment/{segment_id}` to prevent FastAPI treating "segments" as a `segment_id` path parameter
- Batch endpoint fetches all products in a single `IN` query rather than N separate calls — critical for pages showing many segments at once
- PATCH endpoint uses a join (`editai_segments!segment_id(profile_id)`) to check segment ownership in one query instead of two separate lookups

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 ASSOC requirements satisfied via API endpoints
- `POST /api/v1/associations` persists to Supabase `segment_product_associations` table
- `GET /api/v1/associations/segment/{id}` returns product name + thumbnail (ASSOC-03)
- `GET /api/v1/associations/segments` batch endpoint ready for segments page load (ASSOC-03)
- `PATCH /api/v1/associations/{id}` stores selected image URLs (ASSOC-04)
- Phase 33 (segment-picker-ui) and Phase 34 (pipeline-overlay-ui) can integrate these endpoints immediately

## Self-Check: PASSED

- `app/api/association_routes.py` — FOUND
- `app/main.py` — FOUND (contains association_router import and include_router)
- Commit `6f635d4` (Task 1) — FOUND
- Commit `2276773` (Task 2) — FOUND
- All 5 endpoints verified via Python import: POST, GET /segments, GET /segment/{id}, PATCH, DELETE

---
*Phase: 32-association-data-layer*
*Completed: 2026-02-23*
