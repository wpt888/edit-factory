# Fix-All Report: Backend, Frontend & Cleanup

**Date:** 2026-02-26
**Scope:** 10 fixes from audit-backend.md, audit-frontend.md, and audit-uncommitted.md

---

## Pre-requisite: Database Agent

Waited for `/mnt/c/OBSID SRL/n8n/edit_factory/.planning/debug/fix-database-report.md` to complete. DB agent successfully:
- Removed ghost table code (`editai_generation_progress`)
- Fixed `platforms` -> `platform` column mismatch in postiz_routes
- Applied Supabase migration (UNIQUE constraint, FK cascade fixes, dropped 39 dead RLS policies)
- Removed TLS verification bypass in `app/db.py`

---

## Fix Group A: Backend Quick Fixes

### 1. Fixed silent error swallowing in segments background task
**File:** `app/api/segments_routes.py` (line ~1179, `do_extract` function)

Wrapped the entire `do_extract` body in try/except that:
- Logs errors with `exc_info=True` for full tracebacks
- Logs success on completion
- Logs failure when FFmpeg returns non-zero

### 2. Added FFmpeg subprocess timeouts
**File:** `app/api/segments_routes.py` (3 locations)

Added `timeout=300` (5 minutes) to three `subprocess.run()` calls:
- `_get_video_info()` (line ~137) — ffprobe call
- `_generate_thumbnail()` (line ~175) — ffmpeg thumbnail
- `_extract_segment_video()` (line ~200) — ffmpeg segment extraction

Also added `subprocess.TimeoutExpired` exception handlers with proper logging for the thumbnail and extraction functions.

### 3. Removed unused import `StreamingResponse`
**File:** `app/api/segments_routes.py` (line 15)

Changed `from fastapi.responses import FileResponse, StreamingResponse` to `from fastapi.responses import FileResponse`.

### 4. Fixed pipeline delete order (authorization bypass)
**File:** `app/api/pipeline_routes.py` (line ~398)

**Security fix:** Moved `_pipelines.pop(pipeline_id, None)` from BEFORE ownership verification to AFTER both verification and DB deletion succeed. Previously, an unauthorized user could evict another user's pipeline from the in-memory cache even though the HTTP 403 would be raised.

---

## Fix Group B: Frontend Quick Fixes

### 5. Fixed duplicate API_URL constants
**Files:**
- `frontend/src/components/video-segment-player.tsx`: Removed local `const API_URL = ...` and added `API_URL` to the existing import from `@/lib/api`.
- `frontend/src/components/video-processing/variant-triage.tsx`: Added `import { API_URL } from "@/lib/api"` and changed prop default from inline `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"` to `API_URL`.

### 6. Deleted dead code file `frontend/src/proxy.ts`
Confirmed no imports reference this file anywhere in the codebase. Deleted.

---

## Fix Group C: Cleanup

### 7. Deleted root PNG screenshots
Removed all `*.png` files from project root (pipeline screenshots, segments screenshots, TTS library screenshots).

### 8. Deleted backup and migration scripts
- `app/api/library_routes.py.backup`
- `update_library_routes.py`

### 9. Deleted ad-hoc screenshot tests (7 files)
- `frontend/tests/screenshot-inline-preview.spec.ts`
- `frontend/tests/screenshot-pipeline-debug.spec.ts`
- `frontend/tests/screenshot-pipeline-overlap.spec.ts`
- `frontend/tests/screenshot-settings.spec.ts`
- `frontend/tests/screenshot-source-picker.spec.ts`
- `frontend/tests/screenshot-tts-preview.spec.ts`
- `frontend/tests/screenshot-voice-settings.spec.ts`

### 10. Updated `.gitignore`
Added patterns:
```
.backend.pid
.venv-wsl/
*.backup
supabase/.temp/
```

---

## Fix Group D: Verification

### 11. Backend import test
`python -c "from app.main import app; print('Backend import OK')"` — **PASSED** (using venv activation)

---

## Summary

| # | Fix | File(s) | Status |
|---|-----|---------|--------|
| 1 | Error logging in do_extract | segments_routes.py | Done |
| 2 | FFmpeg timeouts (3 locations) | segments_routes.py | Done |
| 3 | Remove unused StreamingResponse | segments_routes.py | Done |
| 4 | Pipeline delete order (security) | pipeline_routes.py | Done |
| 5 | Deduplicate API_URL | video-segment-player.tsx, variant-triage.tsx | Done |
| 6 | Delete dead proxy.ts | proxy.ts | Done |
| 7 | Delete root PNGs | *.png | Done |
| 8 | Delete backup/migration | library_routes.py.backup, update_library_routes.py | Done |
| 9 | Delete screenshot tests | 7 test files | Done |
| 10 | Update .gitignore | .gitignore | Done |
| 11 | Backend verification | — | Passed |
