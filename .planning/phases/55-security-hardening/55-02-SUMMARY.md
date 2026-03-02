---
phase: 55-security-hardening
plan: "02"
subsystem: api-security
tags: [rate-limiting, mime-validation, security, slowapi, python-magic]
one_liner: "Per-route rate limits (upload 10/min, render 5/min, TTS 20/min) and python-magic MIME validation on all file upload endpoints"
dependency_graph:
  requires: []
  provides: [rate-limited-upload-endpoints, mime-type-validation, shared-rate-limiter-module]
  affects: [routes.py, library_routes.py, segments_routes.py, tts_routes.py, pipeline_routes.py, postiz_routes.py]
tech_stack:
  added: [python-magic>=0.4.27]
  patterns:
    - "Shared limiter module (app/rate_limit.py) avoids circular imports from main.py"
    - "slowapi @limiter.limit() decorator requires request: Request as first param"
    - "validate_file_mime_type reads first 8KB, seeks back to 0, graceful degradation on ImportError"
key_files:
  created:
    - app/rate_limit.py
  modified:
    - app/main.py
    - app/api/validators.py
    - app/api/routes.py
    - app/api/library_routes.py
    - app/api/segments_routes.py
    - app/api/tts_routes.py
    - app/api/pipeline_routes.py
    - app/api/postiz_routes.py
    - requirements.txt
decisions:
  - "Extracted limiter to app/rate_limit.py to avoid circular imports (route files are imported by main.py)"
  - "validate_file_mime_type uses graceful degradation: ImportError or any exception logs warning and allows upload"
  - "Replaced Content-Type header check in tts_routes clone_voice with magic-number validation"
  - "Bulk render endpoints also rate-limited at 5/min (same as single render)"
metrics:
  duration_minutes: 7
  completed_date: "2026-03-02"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 9
  files_created: 1
---

# Phase 55 Plan 02: Rate Limiting and MIME Validation Summary

Per-route rate limits (upload 10/min, render 5/min, TTS 20/min) and python-magic MIME validation on all file upload endpoints, with graceful degradation when libmagic is absent.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Add per-route rate limits to upload, render, TTS endpoints | cc25d0d |
| 2 | Add MIME type validation using python-magic to upload endpoints | 79cb535 |

## What Was Built

### Task 1: Per-Route Rate Limits

Created `app/rate_limit.py` as a shared limiter module — this avoids circular imports since route files are imported by `app/main.py`. Updated `app/main.py` to import from the shared module instead of defining limiter locally.

Applied `@limiter.limit()` decorators with `request: Request` as first parameter (slowapi requirement):

**Upload endpoints (10/min):**
- `routes.py`: `GET /video-info`, `POST /jobs`
- `library_routes.py`: `POST /projects/{id}/generate`
- `segments_routes.py`: `POST /source-videos`
- `tts_routes.py`: `POST /clone-voice`
- `postiz_routes.py`: `POST /upload`, `POST /bulk-upload`

**Render endpoints (5/min):**
- `library_routes.py`: `POST /clips/{id}/render`, `POST /clips/bulk-render`
- `pipeline_routes.py`: `POST /render/{pipeline_id}`

**TTS endpoints (20/min):**
- `routes.py`: `POST /tts/generate`
- `tts_routes.py`: `POST /generate`

Total: 12 rate-limited endpoints.

### Task 2: MIME Type Validation

Added to `app/api/validators.py`:
- `ALLOWED_VIDEO_MIMES` — 10 video MIME types
- `ALLOWED_AUDIO_MIMES` — 10 audio MIME types
- `ALLOWED_SUBTITLE_MIMES` — 4 subtitle MIME types (SRT often detected as text/plain or application/octet-stream)
- `validate_file_mime_type(file, allowed_mimes, file_type_label)` — reads first 8KB, detects via libmagic, seeks back to 0

Added `python-magic>=0.4.27` to `requirements.txt` with system dependency comment.

Validation applied before any file processing:
- `routes.py /jobs`: video (+ audio if provided, + srt if provided)
- `routes.py /video-info`: video
- `library_routes.py /generate`: video
- `segments_routes.py /source-videos`: video
- `tts_routes.py /clone-voice`: audio (replaced spoofable Content-Type header check)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced spoofable Content-Type check in tts_routes.py clone-voice**
- **Found during:** Task 2
- **Issue:** clone_voice_endpoint already had MIME validation but used `audio_file.content_type` (HTTP header, easily spoofed by client)
- **Fix:** Replaced with `validate_file_mime_type()` using libmagic detection
- **Files modified:** `app/api/tts_routes.py`
- **Commit:** 79cb535

## Success Criteria Verification

- Uploading more than 10 files/min to upload endpoints → HTTP 429 (slowapi enforces)
- Uploading more than 5 renders/min → HTTP 429
- Uploading more than 20 TTS requests/min → HTTP 429
- A .exe renamed as .mp4 → HTTP 400 with "Detected: application/x-dosexec. Allowed types: ..."
- python-magic not installed → warning logged, upload allowed (graceful degradation)

## Self-Check

Files created/modified:
- app/rate_limit.py: FOUND
- app/api/validators.py: FOUND (validate_file_mime_type added)
- requirements.txt: FOUND (python-magic entry added)

Commits:
- cc25d0d: FOUND
- 79cb535: FOUND

## Self-Check: PASSED
