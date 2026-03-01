---
phase: 47-desktop-foundation
plan: "03"
subsystem: auth
tags: [desktop-mode, auth-bypass, ffmpeg, fastapi]

# Dependency graph
requires:
  - phase: 47-desktop-foundation
    provides: desktop_mode setting in config.py and _get_app_base_dir()
provides:
  - desktop_mode auth bypass in get_current_user() and get_profile_context()
  - Bundled FFmpeg path resolution via _setup_ffmpeg_path() function
  - Desktop mode startup log in lifespan with base_dir path
affects: [48-electron-shell, 52-installer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Desktop mode auth: same bypass pattern as AUTH_DISABLED but returns desktop@local email"
    - "FFmpeg path resolution: module-level function reads DESKTOP_MODE from os.getenv() before Settings is available"
    - "Bundled binary path: APPDATA/EditFactory/bundled/ffmpeg/bin checked first in desktop mode"

key-files:
  created: []
  modified:
    - app/api/auth.py
    - app/main.py

key-decisions:
  - "FFmpeg setup reads DESKTOP_MODE directly via os.getenv() (not Settings) so PATH is configured before any service import"
  - "Bundled FFmpeg at APPDATA/EditFactory/bundled/ffmpeg/bin — installer (Phase 52) is responsible for placing it there"
  - "Desktop mode returns email desktop@local to distinguish from dev@localhost (AUTH_DISABLED)"

patterns-established:
  - "Desktop mode bypass: settings.auth_disabled or settings.desktop_mode pattern applies everywhere auth is checked"
  - "Module-level setup functions: use os.getenv() directly when Settings may not yet be imported"

requirements-completed: [FOUND-02, FOUND-03]

# Metrics
duration: 3min
completed: "2026-03-01"
---

# Phase 47 Plan 03: Desktop Mode Flag Wiring Summary

**DESKTOP_MODE=true now bypasses JWT auth and routes FFmpeg lookups to APPDATA/EditFactory/bundled/ffmpeg/bin before falling back to the dev checkout**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-01T12:48:06Z
- **Completed:** 2026-03-01T12:50:35Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `get_current_user()` and `get_profile_context()` both accept `settings.desktop_mode` as an auth bypass, identical to `auth_disabled`
- `_setup_ffmpeg_path()` function replaces inline PATH injection — in desktop mode checks `%APPDATA%\EditFactory\bundled\ffmpeg\bin` first, falls back to local dev checkout
- Lifespan startup log now emits desktop mode activation message including `settings.base_dir`

## Task Commits

Each task was committed atomically:

1. **Task C1: Add desktop_mode auth bypass in auth.py** - `de9fac6` (feat)
2. **Task C2: Refactor FFmpeg path setup for bundled binary** - `40a80ea` (feat)
3. **Task C3: Add desktop mode startup log in lifespan** - `40d273c` (feat)

## Files Created/Modified

- `app/api/auth.py` - `get_current_user()` and `get_profile_context()` now check `settings.desktop_mode` in addition to `settings.auth_disabled`; desktop mode returns `desktop@local` email
- `app/main.py` - Inline FFmpeg PATH injection replaced with `_setup_ffmpeg_path()` function that checks bundled AppData path in desktop mode; lifespan logs desktop mode activation

## Decisions Made

- FFmpeg setup reads `DESKTOP_MODE` directly via `os.getenv()` rather than through Settings — ensures FFmpeg is on PATH before any service that shells out to `ffmpeg` is imported (module-level execution order constraint)
- Bundled FFmpeg path is `%APPDATA%\EditFactory\bundled\ffmpeg\bin` — Phase 52 installer is responsible for placing binary there
- Desktop mode returns `desktop@local` email instead of `dev@localhost` to distinguish the two bypass modes in logs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 47 complete: all three plans (47-01 config, 47-02 process cleanup, 47-03 auth+FFmpeg wiring) done
- Phase 48 (Electron Shell) can now proceed — desktop mode flag is fully wired across config, process management, auth, and FFmpeg
- Research flag for Phase 48: electron-builder extraResources config needs validation on clean Windows 11 VM

---
*Phase: 47-desktop-foundation*
*Completed: 2026-03-01*
