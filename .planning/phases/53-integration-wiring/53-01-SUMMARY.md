---
phase: 53-integration-wiring
plan: "01"
subsystem: electron-env-wiring
tags: [electron, ffmpeg, desktop-mode, env-vars, gap-closure]
dependency_graph:
  requires: []
  provides: [NEXT_PUBLIC_DESKTOP_MODE-env, RESOURCES_PATH-env, ffmpeg-path-resolution]
  affects: [frontend/setup/page.tsx, frontend/settings/page.tsx, app/main.py ffmpeg resolution]
tech_stack:
  added: []
  patterns: [conditional-env-injection, env-var-baked-build-time, candidate-path-resolution]
key_files:
  created:
    - frontend/.env.production
  modified:
    - electron/src/main.js
    - app/main.py
    - .gitignore
    - frontend/.gitignore
decisions:
  - "RESOURCES_PATH injected only in packaged mode (guarded by isDev) — dev mode resourcesPath points to wrong directory"
  - "frontend/.env.production negation added to root and frontend .gitignore — NEXT_PUBLIC_* vars are not secrets"
  - "AppData fallback kept in _setup_ffmpeg_path() for backwards compat with any existing installs"
metrics:
  duration_seconds: 106
  completed_date: "2026-03-01"
  tasks_completed: 2
  files_modified: 5
---

# Phase 53 Plan 01: Electron Env Wiring Summary

**One-liner:** Electron injects NEXT_PUBLIC_DESKTOP_MODE and RESOURCES_PATH env vars so desktop frontend detects desktop mode and backend resolves FFmpeg from extraResources.

## What Was Built

Closed Gap 1 (NEXT_PUBLIC_DESKTOP_MODE never set) and Gap 3 (FFmpeg path mismatch) from the v10 milestone audit.

Three changes across two files plus one new file:

1. **`electron/src/main.js` — startBackend() env** — Added `RESOURCES_PATH: process.resourcesPath` injected only in packaged mode (`isDev` guard). Dev mode omits it because `process.resourcesPath` points to the Electron source directory in dev, not the bundled resources.

2. **`electron/src/main.js` — startFrontend() env** — Added `NEXT_PUBLIC_DESKTOP_MODE: 'true'` for belt-and-suspenders coverage of any SSR code paths.

3. **`frontend/.env.production`** — New file that bakes `NEXT_PUBLIC_DESKTOP_MODE=true` into the Next.js client JS bundle at build time. This is the primary mechanism for `use client` components (setup/page.tsx, settings/page.tsx) which cannot read runtime env vars.

4. **`app/main.py` — `_setup_ffmpeg_path()`** — Added RESOURCES_PATH as the first candidate in desktop mode (before the AppData fallback). Resolves `RESOURCES_PATH/ffmpeg/bin` which is where electron-builder's `extraResources` places the bundled FFmpeg binary.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Inject NEXT_PUBLIC_DESKTOP_MODE and RESOURCES_PATH in Electron main process | b59117a | electron/src/main.js, frontend/.env.production, .gitignore, frontend/.gitignore |
| 2 | Update _setup_ffmpeg_path() to resolve from RESOURCES_PATH | be80e30 | app/main.py |

## Verification Results

All 5 verification checks passed:
- `NEXT_PUBLIC_DESKTOP_MODE` appears in `electron/src/main.js` startFrontend() env
- `RESOURCES_PATH` appears in `electron/src/main.js` startBackend() env (conditional)
- `RESOURCES_PATH` appears in `app/main.py` _setup_ffmpeg_path()
- `frontend/.env.production` contains `NEXT_PUBLIC_DESKTOP_MODE=true`
- Python syntax validates cleanly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] .gitignore blocked frontend/.env.production from being tracked**
- **Found during:** Task 1 git staging
- **Issue:** Root `.gitignore` had `.env.production` explicitly listed; `frontend/.gitignore` had `.env*` catch-all. Both blocked the file from being staged.
- **Fix:** Added `!frontend/.env.production` negation to root `.gitignore` and `!.env.production` negation to `frontend/.gitignore`. File contains no secrets (only `NEXT_PUBLIC_*` vars which are baked into public JS bundle).
- **Files modified:** `.gitignore`, `frontend/.gitignore`
- **Commit:** b59117a

## Requirements Closed

This plan closes or advances:
- WIZD-01, WIZD-02, WIZD-03, WIZD-04, WIZD-06 — Setup wizard desktop mode detection now works
- UPDT-05, UPDT-06 — Env injection required for update flow
- FOUND-03 — FFmpeg path resolution from extraResources
- INST-02 — Installer bundle correctly wired to backend

## Self-Check: PASSED

Files exist:
- FOUND: frontend/.env.production
- FOUND: electron/src/main.js (modified)
- FOUND: app/main.py (modified)

Commits exist:
- FOUND: b59117a
- FOUND: be80e30
