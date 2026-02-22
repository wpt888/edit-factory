---
phase: 24-backend-stability
plan: 02
subsystem: api
tags: [fastapi, httpx, upload-validation, error-handling, tts, elevenlabs]

requires:
  - phase: 24-01
    provides: Progress persistence and lock lifecycle (STAB-03)

provides:
  - 413 Payload Too Large rejection for uploads over 500 MB (STAB-05)
  - 400 Bad Request with descriptive detail for malformed JSON in subtitle_settings (STAB-04)
  - Async httpx.AsyncClient in legacy ElevenLabsTTS.generate_audio (QUAL-02)
  - Shared validators module at app/api/validators.py

affects:
  - 24-03
  - routes.py upload endpoints
  - library_routes.py generate endpoint

tech-stack:
  added: []
  patterns:
    - "validate_upload_size() called before shutil.copyfileobj to reject oversized files early"
    - "json.JSONDecodeError raises HTTPException 400 with detail string instead of silent ignore"
    - "async with httpx.AsyncClient pattern for all ElevenLabs HTTP calls"

key-files:
  created:
    - app/api/validators.py
  modified:
    - app/api/library_routes.py
    - app/api/routes.py
    - app/services/elevenlabs_tts.py

key-decisions:
  - "Created app/api/validators.py as shared module rather than duplicating helper in each route file"
  - "Made generate_audio_trimmed and process_video_with_tts async too — required to await async generate_audio internally"
  - "Updated all three callers of legacy generate_audio_trimmed/generate_audio to await (they were already in async background task functions)"

patterns-established:
  - "Upload size validation: call await validate_upload_size(file) before shutil.copyfileobj"
  - "JSON form param parsing: wrap json.loads in try/except json.JSONDecodeError, raise HTTPException 400"

requirements-completed:
  - STAB-04
  - STAB-05
  - QUAL-02

duration: 18min
completed: 2026-02-22
---

# Phase 24 Plan 02: Upload Validation and Async TTS Summary

**413 upload size gate (500 MB), 400 JSON parse errors, and legacy ElevenLabsTTS fully converted to httpx.AsyncClient**

## Performance

- **Duration:** 18 min
- **Started:** 2026-02-22T00:00:00Z
- **Completed:** 2026-02-22T00:18:00Z
- **Tasks:** 2
- **Files modified:** 4 (1 created)

## Accomplishments

- Created `app/api/validators.py` with `validate_upload_size()` helper checking file.size (Content-Length fast path) then seek fallback, raising 413 before file body is read into memory
- Both JSON parse sites in `routes.py` (process_video and multi-video endpoints) now raise 400 with descriptive detail instead of silently continuing with None
- Legacy `ElevenLabsTTS.generate_audio` converted to async using `httpx.AsyncClient` — matches pattern already used in `app/services/tts/elevenlabs.py`
- Cascading async conversion: `generate_audio_trimmed` and `process_video_with_tts` made async; all 5 caller sites updated to `await`

## Task Commits

Each task was committed atomically:

1. **Task 1: File upload size validation and JSON parse error handling** - `161bbed` (feat)
2. **Task 2: Convert legacy ElevenLabsTTS to async httpx client** - `562409f` (feat)

## Files Created/Modified

- `app/api/validators.py` — New shared upload size validation helper (MAX_UPLOAD_SIZE_MB = 500)
- `app/api/library_routes.py` — Import validators, await validate_upload_size before video save, await legacy TTS fallback call
- `app/api/routes.py` — Import validators, await validate_upload_size for video+audio, raise HTTPException 400 on JSON parse errors (2 sites), await tts calls (4 sites)
- `app/services/elevenlabs_tts.py` — generate_audio, generate_audio_trimmed, process_video_with_tts all converted to async; httpx.Client replaced with httpx.AsyncClient

## Decisions Made

- Created `app/api/validators.py` as a shared module rather than duplicating the helper in each route file — DRY and easier to update the size limit in one place
- Made `generate_audio_trimmed` and `process_video_with_tts` async too — necessary because they internally call `generate_audio` which is now async; Python cannot `await` inside a sync function
- All 5 caller sites were already inside `async def` background task functions so the `await` additions required no structural changes

## Deviations from Plan

None — plan executed exactly as written. The cascading async requirement for `generate_audio_trimmed` and `process_video_with_tts` was anticipated in the plan ("if the caller is a sync function, it needs to become async too").

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Upload validation and JSON error handling in place for 24-03 and later phases
- All legacy ElevenLabs TTS calls are now async — consistent with the newer ElevenLabsTTSService pattern
- No open concerns

---
*Phase: 24-backend-stability*
*Completed: 2026-02-22*
