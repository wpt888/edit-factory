---
phase: 57-devops-ci
plan: 01
subsystem: infra
tags: [versioning, git-tags, dependencies, pip, reproducible-builds]

# Dependency graph
requires: []
provides:
  - "app/version.py: get_version() using git describe --tags with lru_cache"
  - "requirements.txt: all 41 packages pinned with == exact versions"
  - "APP_VERSION in config.py now auto-derived from git tags"
  - "Health endpoint /api/v1/health returns git-tag version"
affects: [57-02, CI pipeline, any phase reading APP_VERSION or /health]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "git-tag versioning: subprocess.run git describe --tags -> strip v prefix -> lru_cache"
    - "Exact dependency pinning: installed version from pip freeze -> == in requirements.txt, min-range for uninstalled"

key-files:
  created:
    - "app/version.py"
  modified:
    - "requirements.txt"
    - "app/config.py"
    - "app/api/routes.py"

key-decisions:
  - "get_version() uses lru_cache so git is called only once per process — no repeated subprocess calls"
  - "APP_VERSION in config.py is module-level, not inside Settings class — preserves backward-compat for all importers"
  - "Uninstalled optional packages (TTS, kokoro, pydub, sentry-sdk, pytest-cov) pinned to their minimum declared range version"
  - "venv_linux is the active venv for this project (not venv/) — pip freeze run against venv_linux"

patterns-established:
  - "Version chain: git describe -> app/version.py::get_version() -> app/config.py::APP_VERSION -> all consumers"

requirements-completed: [DEVOPS-02, DEVOPS-03]

# Metrics
duration: 15min
completed: 2026-03-02
---

# Phase 57 Plan 01: Dependency Pinning & Git-Tag Versioning Summary

**Reproducible builds via exact pip pinning (41 == pins) and automatic version tracking from git tags via app/version.py with lru_cache**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-02T10:40:00Z
- **Completed:** 2026-03-02T10:56:51Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced all `>=` ranges in requirements.txt with `==` exact pins (41 packages) for reproducible installs
- Created `app/version.py` with `get_version()` that runs `git describe --tags --always` once per process (lru_cache)
- Wired git-tag version into `app/config.py::APP_VERSION` and `/health` endpoint — hardcoded "1.0.0" eliminated
- FastAPI metadata and health response now both reflect the actual git tag

## Task Commits

Each task was committed atomically:

1. **Task 1: Pin dependencies and create version module** - `026b6e9` (chore)
2. **Task 2: Wire git-tag version into health endpoint and app metadata** - `bc44513` (feat)

## Files Created/Modified
- `app/version.py` - New module: get_version() using git describe --tags, lru_cache, fallback to "0.0.0-dev"
- `requirements.txt` - All 41 packages pinned with ==, zero >= ranges remain
- `app/config.py` - APP_VERSION now = get_version() instead of hardcoded "0.1.0"
- `app/api/routes.py` - Health endpoint uses APP_VERSION (imported from config) instead of hardcoded "1.0.0"

## Decisions Made
- `get_version()` is cached with `lru_cache(maxsize=1)` — git subprocess called only once per process lifetime
- `APP_VERSION` stays as a module-level constant in `config.py` (not inside `Settings`) — backward-compatible for all existing importers
- Uninstalled optional packages (TTS, kokoro, pydub, sentry-sdk, pytest-cov) pinned to minimum declared range version as per plan instructions
- `venv_linux/` identified as the active venv (not `venv/`) — pip freeze run against `venv_linux/bin/python`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Health endpoint tests hang because `asyncio.to_thread(subprocess.run, ["ffmpeg", "-version"])` times out in test environment. This is a pre-existing issue unrelated to this plan's changes. Verified via unit import checks and non-blocking unit tests (93/93 pass, 1 pre-existing failure in unrelated srt_validator test).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Dependency pinning complete — CI pipeline (57-02) can now do `pip install -r requirements.txt` with deterministic results
- git-tag versioning ready — CI can create git tags and the app version will auto-update
- No blockers for 57-02

## Self-Check: PASSED

- FOUND: app/version.py
- FOUND: requirements.txt (41 == pins, 0 >= ranges)
- FOUND: app/config.py (APP_VERSION = get_version())
- FOUND: app/api/routes.py (version=APP_VERSION in health endpoint)
- FOUND: 57-01-SUMMARY.md
- FOUND commit: 026b6e9 (chore: pin dependencies + version module)
- FOUND commit: bc44513 (feat: wire version into health + app metadata)

---
*Phase: 57-devops-ci*
*Completed: 2026-03-02*
