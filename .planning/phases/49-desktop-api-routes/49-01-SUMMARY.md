---
phase: 49-desktop-api-routes
plan: 49-01
subsystem: api
tags: [license, lemon-squeezy, desktop, httpx, fastapi, settings]

# Dependency graph
requires:
  - phase: 47-desktop-foundation
    provides: settings.base_dir, settings.desktop_mode, DESKTOP_MODE env var gating

provides:
  - LicenseService with Lemon Squeezy activate/validate + 7-day offline grace period
  - desktop_routes.py router (GET /version, POST /license/activate, POST /license/validate, GET /settings, POST /settings)
  - APP_VERSION constant in app/config.py
  - Conditional desktop router mount in app/main.py (gated by settings.desktop_mode)

affects:
  - phase: 50-setup-wizard (consumes /license/activate, /license/validate, /settings endpoints)
  - phase: 50-setup-wizard (uses 404 vs 403 distinction from validate_license for wizard vs re-activation flow)

# Tech tracking
tech-stack:
  added: []  # httpx was already in requirements.txt
  patterns:
    - "Conditional router mount: import inside if settings.desktop_mode block prevents unused import in web mode"
    - "Lemon Squeezy form-encoded POST: data= kwarg (not json=) required by LS License API"
    - "7-day offline grace period: network errors within GRACE_PERIOD_DAYS return valid=True, valid LS false response does not"
    - "API key redaction: _hint() returns ***last4 for display, never exposes full key via GET /settings"
    - "404 vs 403 distinction: not_activated returns 404, invalid/expired returns 403"

key-files:
  created:
    - app/services/license_service.py
    - app/api/desktop_routes.py
  modified:
    - app/config.py
    - app/main.py

key-decisions:
  - "404 for not-activated (redirect to wizard), 403 for invalid/expired (show re-activation prompt) — Phase 50 frontend uses this distinction"
  - "Conditional desktop router import inside if block — avoids loading desktop_routes in web/server deployments"
  - "Grace period only on network errors (ConnectError, TimeoutException, NetworkError) — explicit LS valid=false bypasses grace even within 7 days"
  - "Settings GET redacts to last-4-char hints — write-only API keys from frontend perspective, prevents key leakage via GET"

patterns-established:
  - "Desktop-only services: LicenseService(settings.base_dir) instantiated per-request — no singleton needed for local file I/O"
  - "Config merge pattern: _read_config() + existing.update({k: v for k, v in body.items() if v is not None}) for non-destructive settings write"

requirements-completed: [LICS-01, LICS-02, LICS-03, LICS-04, UPDT-05]

# Metrics
duration: 3min
completed: 2026-03-01
---

# Phase 49 Plan 01: LicenseService + Desktop API Routes Summary

**Lemon Squeezy license activation/validation backend with 7-day offline grace period, desktop API router conditionally mounted under DESKTOP_MODE=true, and APP_VERSION constant wired into FastAPI app**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-01T12:27:53Z
- **Completed:** 2026-03-01T12:30:31Z
- **Tasks:** 4
- **Files modified:** 4 (2 new, 2 modified)

## Accomplishments
- LicenseService class with activate() using form-encoded Lemon Squeezy API, validate() with 7-day offline grace period, and is_activated() check against license.json
- desktop_routes.py router with 5 endpoints: GET /version, POST /license/activate, POST /license/validate, GET /settings, POST /settings — no auth dependency (desktop = local trusted user)
- APP_VERSION = "0.1.0" constant added to app/config.py, wired into FastAPI constructor and root endpoint
- Conditional desktop router mount in app/main.py — only loaded when settings.desktop_mode is True

## Task Commits

Each task was committed atomically:

1. **Task 1: Add APP_VERSION constant to app/config.py** - `0ae5cd8` (feat)
2. **Task 2: Create app/services/license_service.py** - `d87491d` (feat)
3. **Task 3: Create app/api/desktop_routes.py** - `916b720` (feat)
4. **Task 4: Register desktop_routes conditionally in app/main.py** - `58f30d4` (feat)

## Files Created/Modified
- `app/config.py` - Added APP_VERSION = "0.1.0" constant before _get_app_base_dir
- `app/services/license_service.py` - NEW: LicenseService with Lemon Squeezy activate/validate, grace period logic
- `app/api/desktop_routes.py` - NEW: Desktop router with version, license, settings endpoints
- `app/main.py` - Import APP_VERSION, use in constructor/root, conditional desktop_router mount

## Decisions Made
- 404 vs 403 HTTP status codes for license states: 404 for "not activated" (Phase 50 Setup Wizard redirect), 403 for "invalid/expired" (re-activation prompt) — enables Phase 50 frontend to show correct UI flow
- Conditional import inside `if settings.desktop_mode:` block — prevents desktop_routes from loading in web/server deployments where LicenseService and httpx license calls are not needed
- Grace period strictly for network errors only (ConnectError, TimeoutException, NetworkError) — a successful HTTP response from Lemon Squeezy returning valid=false is NOT covered, preventing grace period abuse

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required at this stage. Lemon Squeezy API keys are user-provided at activation time via license_key.

## Next Phase Readiness
- All 5 desktop API endpoints ready for Phase 50 Setup Wizard frontend consumption
- License state machine complete: not_activated (404) → activate → validate (200/grace/403)
- Settings read/write endpoints ready for Setup Wizard config flow
- APP_VERSION wired into FastAPI for electron-builder version alignment

---
*Phase: 49-desktop-api-routes*
*Completed: 2026-03-01*
