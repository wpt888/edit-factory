---
phase: 47-desktop-foundation
plan: "02"
subsystem: infra
tags: [psutil, process-cleanup, cli, desktop, ports]

# Dependency graph
requires: []
provides:
  - "app/desktop.py CLI with cleanup and ensure-dirs subcommands"
  - "kill_processes_on_port() using psutil with child-tree support"
  - "psutil>=5.9.0 in requirements.txt"
affects: [48-electron-launcher]

# Tech tracking
tech-stack:
  added: [psutil>=5.9.0]
  patterns:
    - "Lazy psutil import inside function body (avoids import cost when not running cleanup)"
    - "psutil.net_connections() + children(recursive=True) for full process tree cleanup"

key-files:
  created:
    - app/desktop.py
  modified:
    - requirements.txt

key-decisions:
  - "Lazy import psutil inside kill_processes_on_port() so module can be imported without psutil installed in non-desktop contexts"
  - "Handles AccessDenied gracefully with warnings rather than raising exceptions"

patterns-established:
  - "Pattern 1: CLI subcommand pattern via argparse subparsers for desktop utility scripts"
  - "Pattern 2: Kill child processes before parent to ensure full cleanup of uvicorn/node worker trees"

requirements-completed: [FOUND-04]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 47 Plan 02: Process Cleanup Utility Summary

**psutil-based port cleanup CLI (app/desktop.py) that kills orphaned uvicorn/node processes and their child trees before Electron restarts services**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T10:43:50Z
- **Completed:** 2026-03-01T10:45:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `app/desktop.py` with `kill_processes_on_port()` using psutil net_connections scan
- Cleanup subcommand kills full process trees (parent + all children) on specified ports
- Added `psutil>=5.9.0` to requirements.txt enabling cross-platform process management
- Module runnable via `python -m app.desktop cleanup --ports 8000 3000`

## Task Commits

Each task was committed atomically:

1. **Task B1: Add psutil to requirements.txt** - `c44f81d` (chore)
2. **Task B2: Create app/desktop.py with port cleanup CLI** - `d9be665` (feat)

## Files Created/Modified
- `app/desktop.py` - Desktop CLI utility: cleanup and ensure-dirs subcommands using psutil
- `requirements.txt` - Added psutil>=5.9.0 under # Utilities section

## Decisions Made
- Lazy import of psutil inside `kill_processes_on_port()` function body rather than top-level import — avoids import-time cost in non-desktop server contexts
- Both `NoSuchProcess` and `AccessDenied` handled silently/with warnings so cleanup never crashes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed psutil in venv_linux for verification**
- **Found during:** Task B2 verification
- **Issue:** psutil not yet installed in venv_linux (only added to requirements.txt), causing ModuleNotFoundError during `python -m app.desktop cleanup --ports 9999`
- **Fix:** Ran `pip install "psutil>=5.9.0"` in venv_linux to enable immediate verification
- **Files modified:** None (venv install only, requirements.txt already updated in B1)
- **Verification:** `python -m app.desktop cleanup --ports 9999` output: `port 9999: killed 0 processes`, exit code 0
- **Committed in:** d9be665 (Task B2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking - missing package install)
**Impact on plan:** Essential for verification. No scope creep.

## Issues Encountered
None beyond the psutil install noted above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `app/desktop.py` is ready for Electron launcher (Phase 48) to call as `python -m app.desktop cleanup --ports 8000 3000`
- `ensure-dirs` subcommand ready once `settings.ensure_dirs()` is implemented in app/config.py (Phase 47-A or 47-C)
- No blockers for Phase 48

---
*Phase: 47-desktop-foundation*
*Completed: 2026-03-01*
