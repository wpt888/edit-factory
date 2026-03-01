---
phase: 51-crash-reporting
plan: 02
subsystem: ui
tags: [react, nextjs, settings, crash-reporting, sentry, switch, desktop-mode]

# Dependency graph
requires:
  - phase: 51-01
    provides: POST /desktop/crash-reporting endpoint and GET /desktop/settings returning crash_reporting_enabled
provides:
  - Crash Reporting toggle card in Settings page (desktop-mode gated)
  - Optimistic switch with error revert for crash reporting on/off
  - State load from GET /desktop/settings on mount
affects: [52-distribution, settings-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Desktop-mode gated settings card using NEXT_PUBLIC_DESKTOP_MODE env var
    - Optimistic toggle with error revert pattern (setCrashReporting then revert on failure)
    - Load desktop-only state in existing desktop useEffect (no new effect)

key-files:
  created: []
  modified:
    - frontend/src/app/settings/page.tsx

key-decisions:
  - "Crash Reporting card placed BEFORE Setup Wizard card in settings page (alphabetical priority)"
  - "Reuse existing desktop useEffect for crash_reporting_enabled fetch alongside version fetch"
  - "Optimistic update with full revert on error — no half-state persistence"

patterns-established:
  - "Desktop-only settings toggle: NEXT_PUBLIC_DESKTOP_MODE gate + optimistic Switch + error revert"

requirements-completed: [UPDT-03]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 51 Plan 02: Settings Page Crash Reporting Toggle Summary

**Settings page gains a desktop-mode-gated Crash Reporting toggle using Shadcn Switch, loading initial state from GET /desktop/settings and calling POST /desktop/crash-reporting with optimistic update and error revert**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T13:34:20Z
- **Completed:** 2026-03-01T13:38:30Z
- **Tasks:** 3
- **Files modified:** 2 (settings page + test file)

## Accomplishments
- Added `crashReporting` + `crashReportingLoading` state to Settings page
- Extended existing desktop useEffect to fetch `crash_reporting_enabled` from `GET /desktop/settings`
- Implemented `handleCrashReportingToggle` with optimistic update and full revert on API error
- Added Crash Reporting card with Shield icon, gated on `NEXT_PUBLIC_DESKTOP_MODE === "true"`, placed before Setup Wizard card
- Card includes privacy explanation ("API keys and sensitive data are automatically scrubbed before sending")
- TypeScript compilation passes with no errors on all changed files

## Task Commits

Each task was committed atomically:

1. **Task 1: Add crash reporting state and load from GET /desktop/settings** - `0ab5982` (feat)
2. **Task 2: Add Crash Reporting card to Settings page JSX** - `8f5f0e4` (feat)
3. **Task 3: Verify Switch component import works** - `44cb668` (test — added Playwright screenshot test)

## Files Created/Modified
- `frontend/src/app/settings/page.tsx` - Added Shield import, Switch import, crashReporting state, handleCrashReportingToggle handler, desktop settings fetch, and Crash Reporting card JSX
- `frontend/tests/verify-crash-reporting-settings.spec.ts` - Playwright screenshot test for visual verification

## Decisions Made
- Reused the existing desktop `useEffect` for the `GET /desktop/settings` call — no new effect needed, keeps related desktop state loading together
- Crash Reporting card placed BEFORE Setup Wizard card (plan spec)
- Optimistic update pattern: immediate state change, full revert on any failure with toast.error

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Dev server not running in WSL environment, so Playwright screenshot could not be captured at runtime. TypeScript compilation (`npx tsc --noEmit`) confirmed all imports and type usage correct.

## User Setup Required

None - no external service configuration required. This UI toggle uses the endpoint built in plan 51-01.

## Next Phase Readiness
- Settings page crash reporting toggle complete
- Phase 51 both plans complete — ready for phase summary and Phase 52 (Distribution)
- Desktop crash reporting flow fully wired: Sentry init (51-01) + UI toggle (51-02)

## Self-Check: PASSED

All files exist and all commits verified.

---
*Phase: 51-crash-reporting*
*Completed: 2026-03-01*
