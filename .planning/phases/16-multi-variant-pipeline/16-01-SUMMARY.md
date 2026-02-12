---
phase: 16-multi-variant-pipeline
plan: 01
subsystem: api
tags: [fastapi, pipeline-orchestration, multi-variant, background-tasks, in-memory-state]

# Dependency graph
requires:
  - phase: 14-ai-script-generation
    provides: ScriptGenerator service with generate_scripts() method
  - phase: 15-script-to-video-assembly
    provides: AssemblyService with preview_matches() and assemble_and_render() methods
provides:
  - Multi-variant pipeline API with 4 endpoints (generate, preview, render, status)
  - In-memory pipeline state tracking across script generation and assembly steps
  - Batch rendering support for selected variants with independent progress tracking
affects: [16-02, frontend-pipeline-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [pipeline-orchestration, in-memory-state-dict, public-status-endpoint, background-task-per-variant]

key-files:
  created: [app/api/pipeline_routes.py]
  modified: [app/main.py]

key-decisions:
  - "Pipeline state stored in-memory (_pipelines dict) consistent with _assembly_jobs and _generation_progress patterns"
  - "Status endpoint is public (pipeline_id is the secret) for easy polling without auth headers"
  - "Each variant renders independently in background task for true parallelism"
  - "Preview data cached in pipeline state to avoid regenerating TTS for render step"

patterns-established:
  - "Pipeline orchestration pattern: create pipeline → preview variants → batch render selected → poll status"
  - "In-memory state dict keyed by pipeline_id with nested render_jobs dict keyed by variant_index"
  - "Auth-required for create/preview/render, public status endpoint with pipeline_id as secret"
  - "Background task closure pattern for per-variant rendering with progress updates"

# Metrics
duration: 2min
completed: 2026-02-12
---

# Phase 16 Plan 01: Multi-Variant Pipeline Backend Summary

**Backend API orchestrating end-to-end multi-variant workflow: generate N scripts, preview each variant's segment matching, and batch-render selected variants with per-job progress tracking**

## Performance

- **Duration:** 1min 54sec
- **Started:** 2026-02-12T09:27:55Z
- **Completed:** 2026-02-12T09:29:49Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created 4 pipeline API endpoints connecting Phase 14 (script generation) and Phase 15 (assembly)
- In-memory pipeline state tracking across full workflow (scripts → previews → render jobs)
- Background rendering with independent progress tracking per variant
- Registered pipeline router in main.py making endpoints accessible under /api/v1/pipeline

## Task Commits

Each task was committed atomically:

1. **Task 1: Create pipeline routes with 4 endpoints** - `4690574` (feat)
2. **Task 2: Register pipeline router in main.py** - `9e41f28` (feat)

## Files Created/Modified
- `app/api/pipeline_routes.py` - Multi-variant pipeline orchestration with 4 endpoints (generate, preview, render, status)
- `app/main.py` - Pipeline router registration under /api/v1 prefix

## Decisions Made
- **In-memory state storage**: Used `_pipelines` dict pattern consistent with existing `_assembly_jobs` and `_generation_progress` patterns from library_routes and assembly_routes
- **Public status endpoint**: Made `/status/{pipeline_id}` public (no auth) since pipeline_id acts as secret - same pattern as assembly status endpoint
- **Independent variant rendering**: Each variant gets its own background task for true parallel execution, not sequential loop
- **Preview caching**: Store preview results in pipeline state to avoid regenerating TTS if user proceeds to render

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all endpoints implemented following established patterns from script_routes.py and assembly_routes.py.

## User Setup Required

None - no external service configuration required. Uses existing services (script_generator, assembly_service) and Supabase setup.

## Next Phase Readiness

Pipeline backend complete and ready for frontend integration (Plan 02). All 4 endpoints functional:
- `POST /api/v1/pipeline/generate` - Create pipeline with N script variants
- `POST /api/v1/pipeline/preview/{pipeline_id}/{variant_index}` - Preview segment matching per variant
- `POST /api/v1/pipeline/render/{pipeline_id}` - Batch render selected variants
- `GET /api/v1/pipeline/status/{pipeline_id}` - Poll progress for all variants

No blockers for Plan 02 (frontend UI).

## Self-Check: PASSED

All claims verified:
- FOUND: app/api/pipeline_routes.py
- FOUND: 4690574 (Task 1 commit)
- FOUND: 9e41f28 (Task 2 commit)

---
*Phase: 16-multi-variant-pipeline*
*Completed: 2026-02-12*
