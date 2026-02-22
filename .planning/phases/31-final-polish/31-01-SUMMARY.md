---
phase: 31-final-polish
plan: "01"
subsystem: backend
tags: [tech-debt, supabase, testing, validation]
dependency_graph:
  requires: []
  provides: [centralized-supabase-client, pytest-test-runner, unified-tts-validation]
  affects: [cost_tracker, job_storage, tts_library_service, routes, library_routes, tts_library_routes]
tech_stack:
  added: [pytest]
  patterns: [singleton-supabase-client, validate_tts_text_length-helper]
key_files:
  created: []
  modified:
    - requirements.txt
    - app/services/cost_tracker.py
    - app/services/job_storage.py
    - app/services/tts_library_service.py
    - app/api/routes.py
    - app/api/library_routes.py
    - app/api/tts_library_routes.py
decisions:
  - "31-01: cost_tracker, job_storage, tts_library_service now use get_supabase() from app.db singleton — no local create_client calls"
  - "31-01: All 6 inline MAX_TTS_CHARS comparisons replaced with validate_tts_text_length() helper across 3 route files"
  - "31-01: Background task validation in process_tts_job uses validate_tts_text_length() — HTTPException caught by outer except Exception handler marking job as failed"
metrics:
  duration_minutes: 12
  completed_date: "2026-02-22"
  tasks_completed: 2
  files_modified: 7
---

# Phase 31 Plan 01: Backend Tech Debt Closure Summary

**One-liner:** Added pytest to requirements.txt, centralized Supabase client in 3 services via get_supabase(), and unified 6 inline MAX_TTS_CHARS checks into validate_tts_text_length() helper across 3 route files.

## Objective

Close remaining backend tech debt from the v6 audit: add pytest to requirements.txt, centralize Supabase client initialization in cost_tracker, job_storage, and tts_library_service, and replace all inline MAX_TTS_CHARS comparisons with the validate_tts_text_length() helper.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add pytest and centralize Supabase client in 3 services | fff3694 | requirements.txt, cost_tracker.py, job_storage.py, tts_library_service.py |
| 2 | Replace inline MAX_TTS_CHARS comparisons with validate_tts_text_length() | 09cc9d1 | routes.py, library_routes.py, tts_library_routes.py |

## What Was Done

### Task 1: pytest + Supabase client centralization

- **requirements.txt**: Added `pytest` entry under new `# Testing` section — fresh venv installs now include the test runner without manual steps.
- **cost_tracker.py**: `_init_supabase()` replaced `from supabase import create_client` + `create_client(settings.supabase_url, settings.supabase_key)` with `from app.db import get_supabase` + `get_supabase()`. Fallback structure (try/except, `_supabase = None`) preserved.
- **job_storage.py**: Same pattern — `_init_supabase()` now uses `get_supabase()`. Preserved warning log when client is None. In-memory fallback behavior unchanged.
- **tts_library_service.py**: `save_from_pipeline()` lazy import replaced — `from supabase import create_client` + credential check + `create_client(...)` replaced with `from app.db import get_supabase` + `supabase = get_supabase()` + `if not supabase: return None`. Error handling preserved.

### Task 2: validate_tts_text_length() adoption

Six inline checks across 3 route files replaced:

**routes.py (3 locations):**
- Line ~1048: TTS generate endpoint — empty + length check consolidated into `text = validate_tts_text_length(text)`
- Line ~1219: TTS batch endpoint — empty + length check consolidated into `tts_text = validate_tts_text_length(tts_text, "tts_text")`
- Line ~1287: Background task `process_tts_job` — empty + length check consolidated into `tts_text = validate_tts_text_length(tts_text, "tts_text")` (HTTPException caught by outer `except Exception` handler, marks job as failed — acceptable behavior)

**library_routes.py (1 location):**
- Line ~854: TTS render guard replaced — `if request.generate_tts and request.tts_text:` guard kept; length check replaced with `validate_tts_text_length(request.tts_text, "tts_text")`

**tts_library_routes.py (2 locations):**
- TTS asset create endpoint and TTS asset update endpoint — both two-line checks (empty + length) replaced with single `validate_tts_text_length(request.tts_text, "tts_text")` call

All 3 route files updated their import from `MAX_TTS_CHARS` to `validate_tts_text_length`.

## Verification Results

All 4 verification checks passed:
1. No `create_client` in cost_tracker.py, job_storage.py, tts_library_service.py
2. `pytest` present in requirements.txt
3. `validate_tts_text_length` present in all 3 route files (4 occurrences in routes.py, 2 in library_routes.py, 3 in tts_library_routes.py)
4. Zero `len.*MAX_TTS_CHARS` inline comparisons in all 3 route files

All 6 modified files pass Python AST syntax check.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

Files modified:
- FOUND: requirements.txt (contains pytest)
- FOUND: app/services/cost_tracker.py (contains from app.db import get_supabase)
- FOUND: app/services/job_storage.py (contains from app.db import get_supabase)
- FOUND: app/services/tts_library_service.py (contains from app.db import get_supabase)
- FOUND: app/api/routes.py (contains validate_tts_text_length, 4 occurrences)
- FOUND: app/api/library_routes.py (contains validate_tts_text_length, 2 occurrences)
- FOUND: app/api/tts_library_routes.py (contains validate_tts_text_length, 3 occurrences)

Commits verified:
- FOUND: fff3694 (chore(31-01): add pytest to requirements.txt and centralize Supabase client in 3 services)
- FOUND: 09cc9d1 (refactor(31-01): replace inline MAX_TTS_CHARS comparisons with validate_tts_text_length() helper)
