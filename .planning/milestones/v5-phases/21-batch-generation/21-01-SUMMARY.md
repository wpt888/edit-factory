---
phase: 21-batch-generation
plan: 01
subsystem: api
tags: [fastapi, batch, job-storage, supabase, background-tasks, product-video]

# Dependency graph
requires:
  - phase: 20-product-video-frontend
    provides: "_generate_product_video_task single-product pipeline (6-stage) that batch reuses"
provides:
  - "POST /products/batch-generate endpoint — accepts 2-50 product_ids, dispatches sequential background task"
  - "GET /products/batch/{batch_id}/status endpoint — per-product progress polling with merged child job states"
  - "BatchGenerateRequest Pydantic model with product_ids validation (min 2, max 50)"
  - "_batch_generate_task with per-product except Exception (never re-raises) — BATCH-03"
  - "_update_batch_product_status and _finalize_batch batch state management helpers"
affects: [21-02-batch-frontend, batch-generate-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batch-over-single pattern: BatchGenerateRequest dispatches one background task that calls existing _generate_product_video_task per product"
    - "Sequential batch loop with except Exception per iteration — failure in product N never prevents N+1"
    - "Batch state stored in jobs table JSONB as job_type=batch_product_video with embedded product_jobs list"
    - "Status polling merges child job states server-side — single endpoint returns N product statuses"

key-files:
  created: []
  modified:
    - app/api/product_generate_routes.py

key-decisions:
  - "Sequential loop (not asyncio.gather) for batch: safer on WSL dev machine, avoids FFmpeg memory contention — consistent with Phase 18 zoompan benchmark decision"
  - "BatchGenerateRequest shares all settings uniformly across products — per-product customization explicitly out of scope per REQUIREMENTS.md"
  - "Product titles fetched in one Supabase query at dispatch time (not per-poll) — stored in batch record product_jobs list to avoid repeated DB round-trips"
  - "Child jobs created inside _batch_generate_task (not at dispatch time) — keeps JobStorage clean, child job only exists when actually being processed"

patterns-established:
  - "Batch helper pattern: _update_batch_product_status reads batch record, mutates product_jobs list by product_id, writes back via update_job"
  - "Finalize pattern: _finalize_batch called once after sequential loop completes, counts terminal states, sets overall batch status"

requirements-completed: [BATCH-02, BATCH-03]

# Metrics
duration: 2min
completed: 2026-02-20
---

# Phase 21 Plan 01: Batch Generation Backend Summary

**BatchGenerateRequest model + POST /products/batch-generate + GET /products/batch/{batch_id}/status endpoints with sequential per-product error isolation stored in Supabase jobs table**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-20T23:32:37Z
- **Completed:** 2026-02-20T23:34:41Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added `BatchGenerateRequest` Pydantic model with `product_ids` list field, `field_validator` enforcing 2-50 items
- Implemented `POST /products/batch-generate` that creates a batch job record in Supabase JobStorage and dispatches a single sequential background task
- Implemented `GET /products/batch/{batch_id}/status` that merges child job states from JobStorage into a per-product status array for polling
- Implemented `_batch_generate_task` with `except Exception` that never re-raises — product N failure cannot prevent product N+1 from processing (BATCH-03)
- Implemented `_update_batch_product_status` and `_finalize_batch` helpers for clean batch state management

## Task Commits

Each task was committed atomically:

1. **Tasks 1 & 2: BatchGenerateRequest + batch-generate + batch status endpoints** - `887db6b` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `app/api/product_generate_routes.py` - Added BatchGenerateRequest model, POST /batch-generate, GET /batch/{batch_id}/status, _batch_generate_task, _update_batch_product_status, _finalize_batch (325 lines added)

## Decisions Made
- Tasks 1 and 2 were committed together since they are both in the same file and are tightly coupled (batch task calls the status helpers which are used by both tasks)
- Used `field_validator` (Pydantic v2) instead of deprecated `validator` decorator — correct for the codebase's Pydantic version
- `_batch_generate_task` creates child jobs immediately before calling `_generate_product_video_task` (not at dispatch time) — child job only exists when being processed, keeps storage clean

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Backend batch endpoints are complete and ready for frontend integration (Phase 21-02)
- `POST /products/batch-generate` returns `{"batch_id": str, "total": int}` — frontend should redirect to `/batch-generate?batch_id=...`
- `GET /products/batch/{batch_id}/status` returns `{"batch_id", "status", "total", "completed", "failed", "product_jobs": [...]}` — frontend polls this at 2s intervals
- Batch state persists in Supabase `jobs` table — navigate-away-and-return works by reading `batch_id` from URL

## Self-Check: PASSED

- FOUND: app/api/product_generate_routes.py
- FOUND: .planning/phases/21-batch-generation/21-01-SUMMARY.md
- FOUND: commit 887db6b (feat(21-01): add batch product video generation endpoints)

---
*Phase: 21-batch-generation*
*Completed: 2026-02-20*
