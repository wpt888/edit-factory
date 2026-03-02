---
phase: 58-architecture-upgrade
plan: "02"
subsystem: infra
tags: [file-storage, supabase-storage, abstraction, cloud-deployment]

# Dependency graph
requires: []
provides:
  - FileStorage ABC with store/retrieve/get_url/delete/exists methods
  - LocalFileStorage (default, no-op, fully transparent)
  - SupabaseFileStorage with 500MB OOM guard and graceful local fallback
  - get_file_storage() singleton factory driven by FILE_STORAGE_BACKEND env var
  - file_storage_backend setting in app/config.py
  - Final render output routed through FileStorage in library_routes.py
  - Remote key retrieval in serve_file and jobs download endpoints
affects: [59-performance, 60-monitoring, cloud-deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: [file-storage-abstraction, graceful-degradation, oom-protection]

key-files:
  created:
    - app/services/file_storage.py
  modified:
    - app/config.py
    - app/api/library_routes.py
    - app/api/routes.py

key-decisions:
  - "FileStorage abstraction covers output files only — FFmpeg input/temp files stay local always"
  - "Local backend is fully transparent: store() returns original path string, no copy/move"
  - "SupabaseFileStorage uses 500MB OOM guard to prevent reading large video files into memory"
  - "Graceful degradation: SupabaseFileStorage falls back to LocalFileStorage on any init or upload failure"
  - "serve_file endpoint retrieves remote keys to .storage_cache/ directory when local file missing"
  - "get_file_storage() uses lru_cache singleton to avoid re-creating backends on every request"

patterns-established:
  - "FileStorage.store() returns the stored path/key — callers update their DB record with this value"
  - "Remote key detection: if local path does not exist, attempt FileStorage.retrieve() before 404"

requirements-completed:
  - ARCH-04

# Metrics
duration: 3min
completed: "2026-03-02"
---

# Phase 58 Plan 02: File Storage Abstraction Layer Summary

**FileStorage ABC with LocalFileStorage (default, transparent) and SupabaseFileStorage (500MB OOM guard, graceful fallback), wired into the render pipeline so FILE_STORAGE_BACKEND=supabase routes final video output to Supabase Storage without any render code changes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T11:26:24Z
- **Completed:** 2026-03-02T11:29:27Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `app/services/file_storage.py` with FileStorage ABC, LocalFileStorage, SupabaseFileStorage, and get_file_storage() singleton factory
- Added `file_storage_backend: str = "local"` to Settings class in app/config.py
- Wired FileStorage into `_render_final_clip_task()` — final video path stored through abstraction before DB update
- Updated `serve_file` endpoint to retrieve remote storage keys when local file is absent
- Updated `jobs/{job_id}/download` endpoint with same remote key retrieval pattern

## Task Commits

Each task was committed atomically:

1. **Task 1: Create FileStorage abstraction with local and Supabase implementations** - `dbd5a1c` (feat)
2. **Task 2: Integrate FileStorage into render pipeline output paths** - `d7ca2fa` (feat)

**Plan metadata:** committed with docs commit after SUMMARY

## Files Created/Modified

- `app/services/file_storage.py` - FileStorage ABC, LocalFileStorage (no-op), SupabaseFileStorage (500MB guard + fallback), get_file_storage() factory
- `app/config.py` - Added `file_storage_backend: str = "local"` to Settings class
- `app/api/library_routes.py` - Import get_file_storage; call store() after render; update serve_file for remote keys
- `app/api/routes.py` - Import get_file_storage; update jobs download endpoint to retrieve remote keys

## Decisions Made

- FileStorage abstraction covers output files only — FFmpeg always needs local paths for input and temp files; the abstraction hooks in at the publish step after FFmpeg produces output
- Local backend is fully transparent: store() returns the original local path string unchanged, so all existing behavior is preserved by default
- SupabaseFileStorage has a 500MB OOM guard — files exceeding limit fall back to local with a warning rather than crashing with OOM
- Graceful degradation: if Supabase Storage is unavailable during init or upload, SupabaseFileStorage falls back to LocalFileStorage silently (warning logged)
- serve_file and download endpoints detect missing local files and attempt retrieval via FileStorage.retrieve() — this makes the abstraction work end-to-end for Supabase backend without frontend changes

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

To use Supabase Storage backend, add to `.env`:
```
FILE_STORAGE_BACKEND=supabase
```
The `editai-output` bucket will be created automatically on first use. No manual Supabase dashboard configuration required.

## Next Phase Readiness

- File storage abstraction complete — pipeline, assembly, and product routes can be integrated in 58-03 if needed
- Local backend default ensures zero regression risk for existing deployments
- Supabase backend ready for cloud deployment testing when needed

## Self-Check: PASSED

- app/services/file_storage.py: FOUND
- app/config.py: FOUND
- app/api/library_routes.py: FOUND
- app/api/routes.py: FOUND
- SUMMARY.md: FOUND
- Commit dbd5a1c (Task 1): FOUND
- Commit d7ca2fa (Task 2): FOUND

---
*Phase: 58-architecture-upgrade*
*Completed: 2026-03-02*
