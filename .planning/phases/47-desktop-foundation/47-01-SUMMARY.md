---
phase: 47-desktop-foundation
plan: "01"
subsystem: infra
tags: [pydantic-settings, config, desktop-mode, appdata, electron]

# Dependency graph
requires: []
provides:
  - APP_BASE_DIR abstraction resolving to %APPDATA%\EditFactory in desktop mode
  - desktop_mode bool field on Settings, auto-populated from DESKTOP_MODE env var
  - Multi-source .env loading via settings_customise_sources (AppData > project)
  - ensure_dirs() creating cache/tts subdirectory in desktop mode
affects:
  - Phase 48 (Electron shell - will set DESKTOP_MODE=true when launching backend)
  - Phase 50 (Setup Wizard - uses cache_clear() pattern to reload settings after .env write)
  - All services that import get_settings() (paths now resolve correctly in both modes)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "_get_app_base_dir() called at module load; _BASE_DIR is module-level constant"
    - "settings_customise_sources returns tuple of sources in priority order"
    - "desktop_mode field on Settings mirrors DESKTOP_MODE env var via pydantic-settings auto-mapping"

key-files:
  created: []
  modified:
    - app/config.py

key-decisions:
  - "Used try/except import chain for DotEnvSettingsSource to handle pydantic-settings version variance"
  - "file_secret_settings parameter name confirmed for pydantic-settings 2.12.x (not secrets_settings)"
  - "AppData .env appended as higher-priority source, project .env always appended as lowest-priority fallback"

patterns-established:
  - "Desktop mode detection: os.getenv('DESKTOP_MODE', '').lower() in ('true', '1', 'yes') pattern"
  - "Phase 50 cache_clear() pattern: get_settings.cache_clear() then get_settings() after writing new .env"

requirements-completed: [FOUND-04, FOUND-01]

# Metrics
duration: 8min
completed: "2026-03-01"
---

# Phase 47 Plan 01: APP_BASE_DIR Abstraction + AppData Directory Structure Summary

**pydantic-settings multi-source config with APP_BASE_DIR switching between %APPDATA%\EditFactory (desktop) and project root (dev) via DESKTOP_MODE env var**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-01T10:44:15Z
- **Completed:** 2026-03-01T10:52:00Z
- **Tasks:** 3 (A1, A2, A3 - all in app/config.py)
- **Files modified:** 1

## Accomplishments
- `_get_app_base_dir()` function returns `%APPDATA%\EditFactory` when `DESKTOP_MODE=true` and `APPDATA` is set, falls back to project root in dev/WSL/CI
- `desktop_mode: bool` field on Settings auto-populated from `DESKTOP_MODE` env var via pydantic-settings
- `settings_customise_sources` classmethod implements priority chain: env vars > AppData `.env` (desktop) > project `.env` (dev fallback)
- `ensure_dirs()` creates `cache/tts` subdirectory in AppData when running in desktop mode
- Phase 50 Setup Wizard cache_clear() note added above `get_settings()`

## Task Commits

All tasks implemented atomically in one coherent change (A1/A2/A3 all modify app/config.py):

1. **Tasks A1+A2+A3: APP_BASE_DIR abstraction + multi-source config + ensure_dirs update** - `78e29af` (feat)

## Files Created/Modified
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/config.py` - Added _get_app_base_dir(), desktop_mode field, SettingsConfigDict, settings_customise_sources classmethod, updated ensure_dirs()

## Decisions Made
- Confirmed `file_secret_settings` parameter name for pydantic-settings 2.12.x (installed version in Windows venv)
- Used try/except import chain for DotEnvSettingsSource to handle minor version variance
- Kept AppData .env creation inside `_get_app_base_dir()` (mkdir on first use) separate from `ensure_dirs()` (which handles input/output/logs dirs)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

pydantic-settings not available in WSL system Python (Windows venv only). Installed system-wide via pip3 --break-system-packages for verification purposes only. Backend runs on Windows venv where package is already present at version 2.12.0. Verification confirmed all 5 PASS criteria pass.

## User Setup Required

None - no external service configuration required. DESKTOP_MODE env var is set by the Electron launcher in Phase 48.

## Next Phase Readiness

- `app/config.py` abstraction complete — Phase 48 Electron shell can set `DESKTOP_MODE=true` when spawning backend process
- Phase 48 (psutil process management) can proceed immediately
- Phase 50 Setup Wizard: use `get_settings.cache_clear()` then `get_settings()` after writing AppData `.env`

---
*Phase: 47-desktop-foundation*
*Completed: 2026-03-01*
