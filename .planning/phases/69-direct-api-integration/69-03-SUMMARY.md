---
phase: 69-direct-api-integration
plan: 03
subsystem: api
tags: [tts, edge-tts, gemini, fallback, toast, sonner]

# Dependency graph
requires:
  - phase: 69-01
    provides: KeyVault encrypted API key storage
provides:
  - Backend TTS fallback to Edge TTS when ElevenLabs unavailable
  - Backend analysis fallback indicator when Gemini unavailable
  - Frontend toast utility for fallback notifications with session dedup
affects: [pipeline, library, settings]

# Tech tracking
tech-stack:
  added: []
  patterns: [graceful-degradation-indicators, fallback-toast-dedup]

key-files:
  created:
    - frontend/src/lib/api-fallback.ts
  modified:
    - app/api/routes.py
    - app/api/library_routes.py
    - frontend/src/app/pipeline/page.tsx

key-decisions:
  - "Edge TTS fallback is silent (INFO log, not WARNING) since it is expected behavior"
  - "Toast dedup via Set prevents repeated notifications within a session"
  - "Library page does not integrate checkFallbacks since render is a background task"

patterns-established:
  - "Fallback indicator pattern: tts_fallback/analysis_fallback fields in API responses"
  - "Frontend checkFallbacks() called after any TTS/analysis API response"

requirements-completed: [API-04]

# Metrics
duration: 6min
completed: 2026-03-09
---

# Phase 69 Plan 03: Graceful API Fallback Summary

**TTS falls back to Edge TTS with info toast, video analysis falls back to local scoring — no errors shown to user**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-09T06:00:18Z
- **Completed:** 2026-03-09T06:06:06Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Backend TTS endpoints fall back to Edge TTS instead of raising exceptions when ElevenLabs is unavailable
- Backend adds structured fallback indicator fields (tts_fallback, analysis_fallback) to API responses
- Frontend api-fallback.ts utility shows info toasts with session-level deduplication
- Render pipeline in library_routes.py also uses Edge TTS fallback in legacy TTS path

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fallback indicators to backend TTS and analysis endpoints** - `fa3ea31` (feat)
2. **Task 2: Create frontend fallback toast utility** - `7547155` (feat)

## Files Created/Modified
- `frontend/src/lib/api-fallback.ts` - Fallback toast utility with checkFallbacks() and session dedup
- `app/api/routes.py` - TTS endpoints with Edge TTS fallback + analysis fallback indicators
- `app/api/library_routes.py` - Render pipeline with Edge TTS fallback in legacy path
- `frontend/src/app/pipeline/page.tsx` - checkFallbacks() integration after TTS responses

## Decisions Made
- Edge TTS fallback logs at INFO level (not WARNING/ERROR) since fallback is expected behavior
- Toast dedup uses a module-level Set so same fallback toast only shows once per session
- Library page does not need checkFallbacks integration since renders are background tasks that don't return TTS/analysis data directly to the frontend

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Graceful degradation complete: app works with zero API keys
- Frontend shows informative toasts about fallback usage
- Settings page (from 69-02) allows users to add API keys for premium features

---
*Phase: 69-direct-api-integration*
*Completed: 2026-03-09*
