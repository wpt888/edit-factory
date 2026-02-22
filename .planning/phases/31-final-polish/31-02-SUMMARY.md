---
phase: 31-final-polish
plan: 02
subsystem: ui
tags: [nextjs, api-client, polling, fetch, retry]

# Dependency graph
requires:
  - phase: 26-frontend-resilience
    provides: "apiGetWithRetry, apiFetch exports in api.ts"
  - phase: 30-frontend-error-handling-adoption
    provides: "handleApiError pattern established across all pages"
provides:
  - "usage/page.tsx uses apiGetWithRetry for all 4 JSON data-fetch GET calls"
  - "usePolling hook uses apiFetch from @/lib/api — no raw fetch() or local API_URL"
  - "All frontend GET data-fetching goes through centralized API client with timeout, retry, error handling"
affects: [any future feature pages that add data-fetching, polling consumers]

# Tech tracking
tech-stack:
  added: []
  patterns: [apiGetWithRetry for page-level JSON GET calls, apiFetch in polling hooks]

key-files:
  created: []
  modified:
    - frontend/src/app/usage/page.tsx
    - frontend/src/hooks/use-polling.ts

key-decisions:
  - "31-02: librarie/page.tsx blob download (downloadFile) correctly stays as apiGet per 30-03 convention — binary fetches are not retry candidates"
  - "31-02: apiFetch in usePolling removes both raw fetch() and local API_URL — timeout, profile-header injection, and non-2xx throwing are all now handled by the centralized client"
  - "31-02: if (!response.ok) guard removed from usePolling — apiFetch already throws ApiError on non-2xx, making the guard dead code"

patterns-established:
  - "All page-level JSON GET calls use apiGetWithRetry (not raw apiGet)"
  - "Polling hooks import apiFetch from @/lib/api — no local API_URL constants in hook files"

requirements-completed: [FE-02, FE-03, FE-05]

# Metrics
duration: 10min
completed: 2026-02-22
---

# Phase 31 Plan 02: Final Polish — API Client Adoption Summary

**Centralized API client enforced everywhere: usage/page.tsx switched to apiGetWithRetry (4 calls) and usePolling refactored to use apiFetch instead of raw fetch() with local API_URL**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-22T00:00:00Z
- **Completed:** 2026-02-22T00:10:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced all 4 raw `apiGet()` data-fetch calls in usage/page.tsx with `apiGetWithRetry()` — giving retry on transient errors, 30s timeout, and profile-header injection
- Refactored usePolling hook to use `apiFetch` from `@/lib/api` — removed local `API_URL` constant and raw `fetch()` call
- Removed dead `if (!response.ok)` guard from usePolling (apiFetch already throws ApiError on non-2xx)
- Confirmed librarie/page.tsx blob download correctly remains as `apiGet` per Phase 30-03 convention
- Frontend build passes cleanly with all pages rendered

## Task Commits

Each task was committed atomically:

1. **Task 1: Adopt apiGetWithRetry in usage/page.tsx** - `bee6ccb` (feat)
2. **Task 2: Refactor usePolling to use apiFetch** - `9fa96d3` (feat)

## Files Created/Modified
- `frontend/src/app/usage/page.tsx` - All 4 apiGet() data-fetch calls replaced with apiGetWithRetry(); import updated
- `frontend/src/hooks/use-polling.ts` - apiFetch imported from @/lib/api; raw fetch() and local API_URL removed; if (!response.ok) dead guard removed

## Decisions Made
- librarie/page.tsx blob download (`downloadFile` function using `res.blob()`) correctly stays as `apiGet` per Phase 30-03 convention — binary fetches are not retry candidates
- The `if (!response.ok)` block in usePolling was removed entirely since `apiFetch` already throws `ApiError` on non-2xx responses, making that guard redundant dead code
- `apiFetch` in usePolling automatically provides: URL construction, profile header injection, 30s timeout via AbortSignal.timeout(), and ApiError on failure

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All frontend data-fetching now goes through the centralized API client (`api.ts`)
- No raw `fetch()` calls remain in hook files or page-level data fetching
- Ready for Phase 31 Plan 03 (if any remaining plans)

---
*Phase: 31-final-polish*
*Completed: 2026-02-22*
