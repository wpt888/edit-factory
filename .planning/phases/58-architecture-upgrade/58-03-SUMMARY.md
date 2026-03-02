---
phase: 58-architecture-upgrade
plan: 58-03
subsystem: api
tags: [job-storage, assembly, supabase, fastapi, dual-write]

# Dependency graph
requires:
  - phase: 58-01
    provides: JobStorage service with Supabase persistence and in-memory fallback
provides:
  - Assembly jobs stored in unified JobStorage with job_type="assembly"
  - GET /api/v1/jobs/{job_id} returns assembly job data with current_step and final_video_path
  - GET /api/v1/assembly/status/{job_id} reads from JobStorage first, falls back to legacy dict
  - Dual-write to both JobStorage and legacy editai_assembly_jobs table during transition
affects: [59-sse, future-job-management, assembly-frontend-polling]

# Tech tracking
tech-stack:
  added: []
  patterns: [dual-write for backward-compatible migration, JobStorage-first with legacy fallback, job_type field for unified endpoint routing]

key-files:
  created: []
  modified:
    - app/api/assembly_routes.py
    - app/api/routes.py

key-decisions:
  - "Dual-write pattern: assembly_routes writes to both JobStorage and legacy _assembly_jobs dict + editai_assembly_jobs table — no data loss during transition period"
  - "JobStorage-first read in get_assembly_status: checks job_type='assembly' to confirm the hit before using it, falls back cleanly to legacy dict"
  - "Assembly jobs use 'processing' status (not 'running') — matches existing JobStatus.PROCESSING enum value, no schema change needed"
  - "JobResponse.result already typed as Optional[dict] — assembly final_video_path maps cleanly into it without model changes"

patterns-established:
  - "job_type field in JobStorage enables polymorphic routing in unified GET /jobs/{job_id} endpoint"
  - "progress_percentage stored separately from progress text in assembly JobStorage entries — status endpoint returns correct integer"

requirements-completed: [ARCH-03]

# Metrics
duration: 2min
completed: 2026-03-02
---

# Phase 58 Plan 03: Unify Assembly Jobs into JobStorage Summary

**Assembly jobs dual-written to unified JobStorage with job_type='assembly', enabling single GET /api/v1/jobs/{job_id} endpoint for all job types while preserving backward-compatible /assembly/status/{job_id} polling**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-02T11:25:44Z
- **Completed:** 2026-03-02T11:27:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Assembly render endpoint now dual-writes to JobStorage with job_type="assembly" alongside existing _assembly_jobs dict
- Background task (do_assembly) updates JobStorage at TTS progress (10%), completion (100%), and failure points
- get_assembly_status reads from JobStorage first, falls back to legacy _assembly_jobs dict + DB for pre-migration jobs
- GET /api/v1/jobs/{job_id} now handles job_type="assembly" — maps current_step to progress and final_video_path into result dict

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate assembly job creation and updates to JobStorage** - `0e50246` (feat)
2. **Task 2: Handle assembly jobs in unified jobs endpoint** - `6c4d990` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `app/api/assembly_routes.py` - Added get_job_storage import, dual-write on create/update, JobStorage-first read in status endpoint
- `app/api/routes.py` - Added assembly-specific field mapping (current_step, final_video_path) in GET /jobs/{job_id}

## Decisions Made
- Dual-write pattern chosen over cut-over: keeps legacy editai_assembly_jobs table operational for any existing DB queries/dashboards while new code starts using JobStorage
- JobStorage-first in status endpoint: check job_type=="assembly" before trusting the hit — prevents collisions if a non-assembly job somehow shares the ID
- No changes to JobStatus enum or JobResponse model needed — "processing" was already a valid status, result was already Optional[dict]

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `python` binary not in PATH in WSL (uses `python3`); venv at `venv_linux/` not `venv/` — used `source venv_linux/bin/activate && python` for import verification. No code impact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All job types (video processing, TTS, assembly, product generate) now unified under JobStorage
- Phase 58 architecture upgrade complete — foundation ready for Phase 59 SSE streaming
- Legacy editai_assembly_jobs table remains functional; can be deprecated in a future cleanup phase

---
*Phase: 58-architecture-upgrade*
*Completed: 2026-03-02*
