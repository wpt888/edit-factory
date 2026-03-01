---
phase: 52-installer-and-packaging
plan: "01"
subsystem: packaging
tags: [electron-builder, nsis, installer, packaging, node-portable]
dependency_graph:
  requires: []
  provides: [electron-builder-config, build-orchestration-script]
  affects: [electron/package.json, scripts/build-installer.js]
tech_stack:
  added: [electron-updater@^6.1.0]
  patterns: [PowerShell-for-archive-ops, build-script-with-prereq-verification]
key_files:
  created:
    - scripts/build-installer.js
  modified:
    - electron/package.json
    - electron/.gitignore
decisions:
  - electron-updater added as runtime dependency (not devDependency) so it bundles into the app
  - FFmpeg filter: ffmpeg.exe + ffprobe.exe only — ffplay.exe (194 MB) excluded as unused
  - venv and app extraResources exclude __pycache__ and .pyc to save 20-50 MB
  - publish.releaseType = draft for safety — dist:publish script overrides with --publish always
  - Node.js download uses PowerShell Invoke-WebRequest for redirect handling and consistency with Expand-Archive
  - node-v22.22.0-win-x64 as portable Node version (LTS 22 stable)
metrics:
  duration: "~2 minutes"
  completed: "2026-03-01"
  tasks_completed: 2
  files_changed: 3
---

# Phase 52 Plan 01: Electron-Builder NSIS Configuration and Build Script Summary

**One-liner:** NSIS installer config with five bundled resources (venv, frontend, app, FFmpeg, portable Node 22) and PowerShell-based build orchestration script.

## What Was Built

### Task 1: electron/package.json — Complete NSIS and Publish Configuration

Updated `electron/package.json` with:

- **NSIS options**: `oneClick: false`, install wizard with directory selection, desktop and Start Menu shortcuts, uninstall entry in Add/Remove Programs
- **GitHub publish config**: provider = github, PLACEHOLDER_ORG/PLACEHOLDER_REPO, releaseType = draft
- **directories.output = dist**: installer output target
- **Five extraResources** covering every runtime dependency:
  1. `../venv` → `venv` (Python venv, excludes `__pycache__` and `.pyc`)
  2. `../frontend/.next/standalone` → `frontend/standalone` (Next.js server)
  3. `../app` → `app` (FastAPI source, excludes `__pycache__` and `.pyc`)
  4. `../ffmpeg/.../bin` → `ffmpeg/bin` (ffmpeg.exe + ffprobe.exe only)
  5. `resources/node` → `node` (portable Node.js 22)
- **electron-updater@^6.1.0** as runtime dependency
- **dist** and **dist:publish** scripts

### Task 2: scripts/build-installer.js — Build Orchestration Script

Created `scripts/build-installer.js` at project root that sequences:

1. **Frontend build**: `npm run build` in `frontend/` — triggers Next.js build + postbuild.js static asset copy
2. **Portable Node.js 22**: Downloads `node-v22.22.0-win-x64.zip` via PowerShell `Invoke-WebRequest`, extracts with `Expand-Archive`, moves to `electron/resources/node/`, cleans up zip — skips if already cached
3. **Prerequisites check**: Verifies `node.exe`, `server.js`, `venv/Scripts/python.exe` all exist before proceeding
4. **electron-builder**: `npx electron-builder --win` in `electron/` with `stdio: inherit`

Output: `electron/dist/EditFactory-Setup-0.1.0.exe`

### electron/.gitignore Update

Added `resources/node/` and `resources/*.zip` to prevent committing the 45 MB portable Node.js binary.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

### Files Created/Modified

- `electron/package.json` — updated
- `electron/.gitignore` — updated
- `scripts/build-installer.js` — created

### Commits

- `6262dee` — chore(52-01): configure electron-builder NSIS and publish config
- `b19407c` — feat(52-01): add build orchestration script for Windows installer

## Self-Check: PASSED
