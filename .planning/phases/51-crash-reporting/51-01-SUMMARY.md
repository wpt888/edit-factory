---
phase: 51-crash-reporting
plan: 01
subsystem: infra
tags: [sentry, crash-reporting, pii-scrubbing, desktop, fastapi]

# Dependency graph
requires:
  - phase: 50-setup-wizard
    provides: crash_reporting_enabled field in config.json, GET /desktop/settings endpoint
  - phase: 47-desktop-foundation
    provides: settings.desktop_mode flag, settings.base_dir path
provides:
  - app/services/crash_reporter.py with init_sentry, set_crash_reporting, _before_send, is_enabled
  - POST /desktop/crash-reporting endpoint for runtime toggle
  - Sentry initialized once at startup, gated by desktop_mode + crash_reporting_enabled
affects: [51-02, 52-distribution]

# Tech tracking
tech-stack:
  added: [sentry-sdk>=2.0.0]
  patterns:
    - "Module-level boolean flag (_crash_reporting_enabled) checked in before_send for zero-restart runtime toggle"
    - "EventScrubber with extended denylist for PII scrubbing before data leaves machine"
    - "Lazy import of set_crash_reporting inside endpoint body to avoid import-time issues outside desktop mode"
    - "init_sentry() no-op when DSN empty or enabled=False — safe to call unconditionally"

key-files:
  created:
    - app/services/crash_reporter.py
  modified:
    - requirements.txt
    - app/main.py
    - app/api/desktop_routes.py

key-decisions:
  - "sentry_sdk.init() called ONLY when desktop_mode=True AND crash_reporting_enabled=True — never in dev/web mode"
  - "SENTRY_DSN left as empty string placeholder — must be replaced when Sentry project is created"
  - "Graceful ImportError fallback in crash_reporter.py allows app to start even if sentry_sdk not installed"
  - "init_sentry() is no-op when DSN is empty — no Sentry init call, avoiding undefined behavior"

patterns-established:
  - "Runtime toggle pattern: module-level flag checked in before_send — events dropped client-side before any network call"
  - "PII denylist pattern: extend DEFAULT_DENYLIST with app-specific secret key names"

requirements-completed: [UPDT-03, UPDT-04]

# Metrics
duration: 8min
completed: 2026-03-01
---

# Phase 51 Plan 01: Sentry Crash Reporter Backend Summary

**Conditional Sentry crash reporting with PII scrubbing via EventScrubber + runtime toggle via before_send module flag, desktop-mode only**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-01T14:55:00Z
- **Completed:** 2026-03-01T15:03:00Z
- **Tasks:** 4
- **Files modified:** 4

## Accomplishments
- Created crash_reporter.py with full Sentry integration, PII scrubbing denylist, and runtime toggle mechanism
- Wired init_sentry() into main.py after FastAPI app and middleware creation (Sentry requirement)
- Added POST /desktop/crash-reporting endpoint for immediate runtime toggle + config.json persistence
- Added sentry-sdk>=2.0.0 to requirements.txt

## Task Commits

Each task was committed atomically:

1. **Task 1: Add sentry-sdk to requirements.txt** - `8f88694` (chore)
2. **Task 2: Create app/services/crash_reporter.py** - `3c8d68f` (feat)
3. **Task 3: Wire init_sentry() into app/main.py** - `beb56ce` (feat)
4. **Task 4: Add POST /desktop/crash-reporting endpoint** - `4c67b63` (feat)

## Files Created/Modified
- `app/services/crash_reporter.py` - Sentry service with init_sentry, set_crash_reporting, _before_send, is_enabled, SENTRY_DSN placeholder
- `requirements.txt` - Added sentry-sdk>=2.0.0 in Utilities section
- `app/main.py` - Added desktop_mode-gated Sentry init block after SlowAPIMiddleware
- `app/api/desktop_routes.py` - Added POST /crash-reporting endpoint for runtime toggle

## Decisions Made
- SENTRY_DSN left as empty string — init_sentry() is a no-op with empty DSN, safe until real Sentry project created
- Graceful ImportError fallback means app starts even without sentry_sdk installed (useful for dev without the package)
- init_sentry() called in global scope of main.py (not inside lifespan) to ensure Sentry instruments the app object before any requests

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — SENTRY_DSN placeholder in crash_reporter.py needs to be populated when a real Sentry project is created. The app functions correctly with an empty DSN (crash reporting stays disabled).

## Next Phase Readiness
- Backend crash reporting infrastructure complete
- Phase 51-02 (frontend toggle UI) can connect to POST /desktop/crash-reporting endpoint
- When Sentry project is created: replace SENTRY_DSN = "" in app/services/crash_reporter.py

---
*Phase: 51-crash-reporting*
*Completed: 2026-03-01*
