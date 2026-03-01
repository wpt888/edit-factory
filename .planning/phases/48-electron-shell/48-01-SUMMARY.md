---
phase: 48-electron-shell
plan: 01
subsystem: infra
tags: [electron, nextjs, standalone, ico, postbuild, nodejs]

# Dependency graph
requires:
  - phase: 47-desktop-foundation
    provides: APP_BASE_DIR, DESKTOP_MODE env var, FastAPI desktop mode wiring
provides:
  - frontend/scripts/postbuild.js — copies .next/static and public/ into .next/standalone after build
  - frontend/package.json build script chains postbuild automatically
  - electron/build/icon.ico — valid 16x16 ICO placeholder for Electron tray
  - electron/build/generate-icon.js — repeatable ICO generator script
affects: [48-electron-shell, 52-distribution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Next.js standalone postbuild: always chain node scripts/postbuild.js after next build to copy static assets"
    - "ICO generation: pure Node.js Buffer writes avoid external tool dependencies"

key-files:
  created:
    - frontend/scripts/postbuild.js
    - electron/build/generate-icon.js
    - electron/build/icon.ico
  modified:
    - frontend/package.json
    - .gitignore

key-decisions:
  - "Used Node.js fs stdlib only in postbuild.js for cross-platform compatibility (Windows cmd, PowerShell, WSL)"
  - "Added !electron/build/ negation in .gitignore to override the build/ ignore pattern so ICO can be committed"
  - "ICO generated programmatically via Buffer writes — no external tools needed, works in WSL"

patterns-established:
  - "Next.js standalone postbuild: copy .next/static and public/ after every build"

requirements-completed: [SHELL-01]

# Metrics
duration: 15min
completed: 2026-03-01
---

# Phase 48 Plan 01: Next.js Standalone Postbuild + App Icon Summary

**Next.js standalone asset postbuild script with automatic copy of static and public dirs, plus a valid ICO placeholder for the Electron tray**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-01T13:10:00Z
- **Completed:** 2026-03-01T13:25:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Created `frontend/scripts/postbuild.js` that copies `.next/static` into `.next/standalone/.next/static` and `public/` into `.next/standalone/public/`
- Updated `frontend/package.json` build script to chain `node scripts/postbuild.js` after `next build` using `&&`
- Generated a valid 16x16 32-bit RGBA ICO file at `electron/build/icon.ico` using pure Node.js Buffer writes

## Task Commits

Each task was committed atomically:

1. **Task A1: Create postbuild.js** - `2387a47` (feat)
2. **Task A2: Update package.json build script** - `d0ca68d` (feat)
3. **Task A3: Electron app icon + gitignore fix** - `b8ac255` (feat)

## Files Created/Modified

- `frontend/scripts/postbuild.js` - Postbuild asset copy script, uses only Node.js fs stdlib
- `frontend/package.json` - Build script now chains `&& node scripts/postbuild.js`
- `electron/build/generate-icon.js` - Repeatable ICO generator for Phase 52 replacement
- `electron/build/icon.ico` - 1086-byte valid 16x16 ICO placeholder, dark-blue (#1a1a2e)
- `.gitignore` - Added `!electron/build/` negation to override `build/` ignore pattern

## Decisions Made

- Used Node.js `fs` stdlib only in postbuild.js — no npm dependencies, works on Windows cmd, PowerShell, and WSL identically
- Generated ICO via programmatic Buffer writes instead of external tools (ImageMagick, etc.) — consistent output, no install requirements
- Added `!electron/build/` negation to `.gitignore` rather than removing the `build/` pattern — minimal change, preserves intent of ignoring Python build artifacts

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added !electron/build/ negation to .gitignore**

- **Found during:** Task A3 (creating electron/build/icon.ico)
- **Issue:** Root `.gitignore` has `build/` pattern on line 36, which silently ignored all files under `electron/build/`. The icon.ico was untrackable without this fix.
- **Fix:** Added `!electron/build/` exception after the FFmpeg section in `.gitignore`
- **Files modified:** `.gitignore`
- **Verification:** `git check-ignore -v --no-index electron/build/icon.ico` returns "Not ignored - can be tracked"
- **Committed in:** `b8ac255` (Task A3 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Auto-fix essential for correctness — without it icon.ico could never be committed to the repo. No scope creep.

## Issues Encountered

None beyond the gitignore deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Postbuild script is wired and ready; `npm run build` will copy static assets on the next build run
- `electron/build/icon.ico` present at the path Plan B expects (`electron/build/icon.ico`)
- Plan B (Electron Main Process) can now reference the icon path and load the standalone frontend

---
*Phase: 48-electron-shell*
*Completed: 2026-03-01*
