---
phase: 58
plan: 58-01
title: "Durable Job Progress & Pipeline State Persistence"
subsystem: backend-job-tracking
tags: [job-storage, progress-tracking, crash-recovery, supabase, graceful-degradation]
completed_date: "2026-03-02"
duration_minutes: 20
tasks_completed: 3
tasks_total: 3
files_modified: 3
requirements: [ARCH-01, ARCH-02]

dependency_graph:
  requires: []
  provides: [durable-progress-tracking, stale-job-cleanup]
  affects: [app/services/job_storage.py, app/api/library_routes.py, app/main.py]

tech_stack:
  added: []
  patterns:
    - "JobStorage.get_jobs_by_project: targeted Supabase query by JSONB field (no O(N) scan)"
    - "JobStorage.cleanup_stale_jobs: time-based stale job recovery on startup"
    - "update_generation_progress: dual-write pattern (memory + JobStorage)"
    - "get_generation_progress: memory-first with JobStorage fallback"

key_files:
  created: []
  modified:
    - app/services/job_storage.py
    - app/api/library_routes.py
    - app/main.py

decisions:
  - "Used Supabase JSONB field query (data->>project_id) instead of O(N) scan for get_jobs_by_project"
  - "cleanup_stale_jobs adds time-based filter (>10 min) on top of existing _recover_stuck_jobs (which marks all processing as failed)"
  - "Only _generate_from_segments_task calls update_generation_progress — _generate_raw_clips_task uses progress_callback to logger instead"
  - "No Redis — Supabase + in-memory fallback provides equivalent durability per user decision"
---

# Phase 58 Plan 01: Durable Job Progress & Pipeline State Persistence Summary

**One-liner:** Supabase-backed progress tracking with memory-first fallback and 10-minute stale job crash recovery on startup.

## What Was Built

Progress state for background render/generation tasks was purely in-memory and lost on server restart. This plan adds durable persistence via `JobStorage` (Supabase primary, in-memory fallback):

1. **`JobStorage.get_jobs_by_project(project_id, status)`** — Queries the `jobs` table by `data->>project_id` (JSONB field extraction) so the progress fallback avoids an O(N) scan of all jobs.

2. **`JobStorage.cleanup_stale_jobs(max_age_minutes=10)`** — On server startup, marks jobs stuck in `processing` for more than 10 minutes as `failed`. Provides minimum viable crash recovery without Redis.

3. **`update_generation_progress()`** — Now accepts optional `job_id` parameter. When provided, persists progress to `JobStorage.update_job()` in addition to the in-memory dict.

4. **`get_generation_progress()`** — Memory-first. When memory is empty (post-restart), falls back to `get_jobs_by_project(project_id, status="processing")` to reconstruct progress from Supabase.

5. **`_generate_from_segments_task()`** — Creates a `JobStorage` record at task start with `project_id` field, then passes `job_id` to all 5 `update_generation_progress()` call sites.

6. **`app/main.py` lifespan startup** — Calls `cleanup_stale_jobs(max_age_minutes=10)` after the existing recovery hooks.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5f6fe57 | add get_jobs_by_project and durable progress tracking |
| 2 | 242327f | wire segment generation task to persist job_id to progress updates |
| 3 | d55d40d | add stale job cleanup on server startup for crash recovery |

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed incorrect `_jobs` attribute reference in `get_jobs_by_project`**
- **Found during:** Task 1 implementation
- **Issue:** Plan template used `self._jobs` but JobStorage uses `self._memory_store`
- **Fix:** Changed in-memory fallback loop to iterate `self._memory_store.items()`
- **Files modified:** app/services/job_storage.py
- **Commit:** 5f6fe57

**2. [Scope observation] `_generate_raw_clips_task` has no `update_generation_progress` calls**
- Plan mentioned ~6 call sites but only 5 exist, all within `_generate_from_segments_task`
- `_generate_raw_clips_task` uses `progress_callback` to logger — no progress dict calls to update
- No fix needed — all existing call sites updated

## Regression Checks

- `pipeline_routes.py`: `_get_pipeline_or_load()` and `_db_load_pipeline()` still present — pipeline loads from DB on cache miss
- `assembly_routes.py`: `_db_load_assembly_job()` still present — assembly loads from DB on cache miss

## Self-Check: PASSED

- app/services/job_storage.py: FOUND (get_jobs_by_project + cleanup_stale_jobs methods)
- app/api/library_routes.py: FOUND (job_id parameter in update_generation_progress, fallback in get_generation_progress)
- app/main.py: FOUND (cleanup_stale_jobs call in lifespan)
- Commits 5f6fe57, 242327f, d55d40d: all verified in git log
