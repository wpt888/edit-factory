---
phase: 57-devops-ci
plan: "02"
subsystem: ci-pipeline
tags: [ci, github-actions, ruff, mypy, pytest, typescript, eslint]
dependency_graph:
  requires: ["57-01"]
  provides: [DEVOPS-01]
  affects: [all-pull-requests]
tech_stack:
  added: [github-actions, ruff, mypy]
  patterns: [parallel-ci-jobs, lint-typecheck-test-gate]
key_files:
  created:
    - .github/workflows/ci.yml
  modified:
    - frontend/package.json
    - frontend/tests/debug-all-logs.spec.ts
decisions:
  - "Two parallel jobs (backend + frontend) for faster CI feedback"
  - "mypy uses permissive flags (--ignore-missing-imports --no-strict-optional --allow-untyped-defs) since codebase is not fully typed"
  - "ruff with lenient ignore list (E501,E402,W291,W292,W293) since codebase has long lines and import ordering"
  - "Playwright E2E tests excluded from CI — require running dev server + Supabase"
  - "AUTH_DISABLED=true for pytest so tests skip Supabase JWT validation"
metrics:
  duration: "2 minutes"
  completed: "2026-03-02"
  tasks_completed: 2
  files_modified: 3
---

# Phase 57 Plan 02: CI Pipeline Summary

GitHub Actions CI workflow with two parallel jobs — Python (ruff lint + mypy type-check + pytest) and Next.js (eslint + tsc) — gating all PRs to main.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add typecheck script to frontend package.json | 6d07498 | frontend/package.json, frontend/tests/debug-all-logs.spec.ts |
| 2 | Create GitHub Actions CI workflow | aa1b53b | .github/workflows/ci.yml |

## What Was Built

### CI Workflow (`.github/workflows/ci.yml`)

Two parallel jobs triggered on push and pull_request to main:

**backend job** — "Python (lint + type-check + test)":
- ubuntu-latest, Python 3.11 with pip cache
- System deps: libmagic1, ffmpeg (required by tests)
- `pip install -r requirements.txt`
- `pip install ruff mypy` (dev-only, not in requirements.txt)
- `ruff check app/ --select=E,F,W --ignore=E501,E402,W291,W292,W293`
- `mypy app/ --ignore-missing-imports --no-strict-optional --allow-untyped-defs`
- `pytest tests/ -x -q --tb=short` with AUTH_DISABLED=true

**frontend job** — "Next.js (lint + type-check)":
- ubuntu-latest, Node 20 with npm cache
- working-directory: frontend
- `npm ci`
- `npm run lint` (eslint)
- `npm run typecheck` (tsc --noEmit)

### Frontend package.json update

Added `"typecheck": "tsc --noEmit"` script after lint. Verified locally: exits 0 with no errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unused @ts-expect-error in debug-all-logs.spec.ts**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** `@ts-expect-error` directive at line 38 was unused — TypeScript now correctly types the window.evaluate callback, so the directive caused TS2578 error
- **Fix:** Replaced with `(window as any)` cast + eslint-disable comment for explicit-any
- **Files modified:** `frontend/tests/debug-all-logs.spec.ts`
- **Commit:** 6d07498 (included in Task 1 commit)

## Next Steps (Manual — GitHub UI)

After this CI workflow is committed and pushed, enable branch protection on GitHub:
Settings → Branches → main → Require status checks → select "Python (lint + type-check + test)" and "Next.js (lint + type-check)"

## Success Criteria Verification

- [x] `.github/workflows/ci.yml` exists with backend and frontend jobs (69 lines, min 40 required)
- [x] Backend job: ruff lint, mypy type-check, pytest
- [x] Frontend job: eslint lint, tsc type-check
- [x] Both jobs run in parallel on push and pull_request to main
- [x] `frontend/package.json` has "typecheck" script
- [x] `npm run typecheck` exits 0 locally

## Self-Check: PASSED

Files confirmed:
- FOUND: .github/workflows/ci.yml
- FOUND: frontend/package.json (contains "typecheck")
- FOUND: .planning/phases/57-devops-ci/57-02-SUMMARY.md

Commits confirmed:
- FOUND: 6d07498 (feat(57-02): add typecheck script)
- FOUND: aa1b53b (feat(57-02): create GitHub Actions CI workflow)
