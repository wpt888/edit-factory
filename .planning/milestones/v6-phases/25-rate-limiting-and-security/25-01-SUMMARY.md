---
phase: 25-rate-limiting-and-security
plan: "01"
subsystem: api
tags: [slowapi, rate-limiting, validation, security, fastapi, tts]

# Dependency graph
requires:
  - phase: 24-backend-stability
    provides: validators.py shared module with validate_upload_size

provides:
  - slowapi rate limiting middleware at 60 requests/minute per IP
  - MAX_TTS_CHARS=5000 constant in validators.py (single source of truth)
  - validate_tts_text_length() helper for all TTS endpoints
  - TTS text length enforced at HTTP layer before any background job dispatch

affects:
  - tts_routes
  - tts_library_routes
  - routes
  - library_routes
  - all future TTS endpoints

# Tech tracking
tech-stack:
  added: [slowapi>=0.1.9, limits, deprecated (slowapi transitive deps)]
  patterns:
    - SlowAPIMiddleware registered before CORSMiddleware (FastAPI reverse middleware order)
    - app.state.limiter + RateLimitExceeded handler pattern for slowapi
    - Centralized validation constants in validators.py (import, don't redefine)

key-files:
  created: []
  modified:
    - requirements.txt
    - app/main.py
    - app/api/validators.py
    - app/api/tts_routes.py
    - app/api/tts_library_routes.py
    - app/api/routes.py
    - app/api/library_routes.py

key-decisions:
  - "slowapi default_limits=['60/minute'] on Limiter instance applies globally without per-route decorators"
  - "SlowAPIMiddleware added before CORSMiddleware — FastAPI processes middleware in reverse order so SlowAPI runs after CORS"
  - "validate_tts_text_length() validates and strips text, returning stripped version for downstream use"
  - "MAX_TTS_CHARS defined once in validators.py — all route files import rather than redefine"

patterns-established:
  - "Centralized validation: constants and helpers in validators.py, imported by all route files"
  - "Input validation at HTTP layer: validate before dispatching background jobs, never inside them"

requirements-completed: [SEC-01, SEC-04]

# Metrics
duration: 15min
completed: 2026-02-22
---

# Phase 25 Plan 01: Rate Limiting and TTS Validation Summary

**slowapi rate limiting at 60 requests/minute per IP and centralized MAX_TTS_CHARS=5000 validation enforced at the HTTP layer across all TTS endpoints before background job dispatch**

## Performance

- **Duration:** 15 min
- **Started:** 2026-02-22T00:00:00Z
- **Completed:** 2026-02-22T00:15:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added slowapi>=0.1.9 middleware to FastAPI app with 60/minute default rate limit per IP — exceeding returns HTTP 429
- Added MAX_TTS_CHARS=5000 constant and validate_tts_text_length() helper to validators.py as single source of truth
- Removed 3 inline MAX_TTS_CHARS=5000 definitions from routes.py, replaced with imported constant
- All TTS endpoints (tts_routes /generate, tts_library_routes POST/PUT, routes.py /tts/generate and /tts/generate-with-video, library_routes /generate-from-segments) now validate text length at the endpoint level

## Task Commits

Each task was committed atomically:

1. **Task 1: Add slowapi rate limiting middleware** - `5987b49` (feat)
2. **Task 2: Centralize TTS text length validation** - `1415a83` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `requirements.txt` - Added slowapi>=0.1.9 (and tenacity>=8.2.0 added by linter)
- `app/main.py` - Import slowapi components, create Limiter, register on app with SlowAPIMiddleware
- `app/api/validators.py` - Added MAX_TTS_CHARS=5000 constant and validate_tts_text_length() helper
- `app/api/tts_routes.py` - Import validate_tts_text_length, call before job creation in /tts/generate
- `app/api/tts_library_routes.py` - Import MAX_TTS_CHARS, add length check in create and update endpoints
- `app/api/routes.py` - Import MAX_TTS_CHARS from validators, remove 3 inline definitions
- `app/api/library_routes.py` - Import MAX_TTS_CHARS, add TTS length check in generate-from-segments

## Decisions Made
- SlowAPIMiddleware added before CORSMiddleware registration because FastAPI processes middleware in reverse order — SlowAPI will execute after CORS, which is the correct sequence for rate limiting
- Using `default_limits=["60/minute"]` on the Limiter instance rather than per-route decorators — applies globally to all routes without modifying individual endpoint handlers
- `validate_tts_text_length()` both validates and returns stripped text so callers can use the sanitized value downstream

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- cv2 import error when trying to verify `from app.main import app` — pre-existing environment issue (opencv not installed in .venv-wsl), not related to these changes. Verified via AST syntax check and targeted import tests instead.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Rate limiting and TTS input validation are active
- Remaining Phase 25 plans can proceed (input sanitization, auth hardening)
- slowapi per-route overrides available via `@limiter.limit("N/minute")` if tighter limits needed on specific endpoints

---
*Phase: 25-rate-limiting-and-security*
*Completed: 2026-02-22*

## Self-Check: PASSED

- FOUND: requirements.txt
- FOUND: app/main.py
- FOUND: app/api/validators.py
- FOUND: app/api/tts_routes.py
- FOUND: app/api/tts_library_routes.py
- FOUND: .planning/phases/25-rate-limiting-and-security/25-01-SUMMARY.md
- FOUND commit: 5987b49 (feat: slowapi middleware)
- FOUND commit: 1415a83 (feat: centralized TTS validation)
