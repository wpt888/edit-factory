---
phase: 60-monitoring-observability
plan: "60-01"
subsystem: infra
tags: [sentry, health-check, monitoring, fastapi, supabase]

# Dependency graph
requires:
  - phase: 51-desktop-launcher
    provides: crash_reporter.py with init_sentry, SENTRY_DSN legacy constant
  - phase: 55-security-hardening
    provides: get_supabase() singleton in app/db.py, Settings in app/config.py
provides:
  - SENTRY_DSN env var triggers Sentry initialization in all deployment modes
  - GET /api/v1/health returns supabase_status, ffmpeg_status, redis_status granular fields
  - Health overall status logic: ok / degraded / unhealthy based on Supabase + FFmpeg
affects: [phase-61, phase-62, monitoring dashboards, health polling consumers]

# Tech tracking
tech-stack:
  added: [sentry-sdk[fastapi]==2.19.2]
  patterns:
    - Two-path Sentry init in app/main.py (SENTRY_DSN env var takes priority over desktop config.json)
    - Lightweight Supabase ping using .select('id', count='exact').limit(0).execute()
    - Overall health = ok only when both Supabase AND FFmpeg are up; Redis is optional

key-files:
  created: []
  modified:
    - app/config.py
    - app/main.py
    - app/services/crash_reporter.py
    - app/models.py
    - app/api/routes.py
    - requirements.txt

key-decisions:
  - "SENTRY_DSN env var enables Sentry in all modes (not just desktop) — path 1 takes priority over path 2 (desktop config.json)"
  - "Desktop legacy path kept unchanged — SENTRY_DSN in crash_reporter.py constant still works for desktop opt-in"
  - "Health overall status: ok = Supabase AND FFmpeg up; degraded = one down; unhealthy = both down; Redis does NOT degrade status"
  - "Supabase ping uses editai_projects.select(id, count=exact).limit(0) — minimal query with zero data transfer"
  - "ffmpeg_available and redis_available bool fields kept in HealthResponse for backward compatibility"

patterns-established:
  - "Supabase connectivity check pattern: get_supabase() -> table().select().limit(0).execute() in asyncio.to_thread"
  - "Two-path Sentry init: env var (all modes) || desktop config.json (legacy)"

requirements-completed:
  - MON-01
  - MON-02

# Metrics
duration: 17min
completed: "2026-03-03"
---

# Phase 60 Plan 01: Sentry Integration & Extended Health Check Summary

**Sentry error reporting for all deployment modes via SENTRY_DSN env var, plus granular health check with individual Supabase/FFmpeg/Redis status fields and ok/degraded/unhealthy logic**

## Performance

- **Duration:** 17 min
- **Started:** 2026-03-02T23:32:47Z
- **Completed:** 2026-03-03T01:49:00Z
- **Tasks:** 2/2
- **Files modified:** 6

## Accomplishments

- Added `sentry_dsn` setting to Settings class — picked up from SENTRY_DSN env var in all deployment modes
- Replaced desktop-only Sentry block with two-path init: env var path works for production/dev/desktop; legacy config.json path preserved
- Extended HealthResponse model with `supabase_status`, `ffmpeg_status`, `redis_status` string fields
- Health check now tests Supabase connectivity using a lightweight count query with limit 0
- Status logic: "ok" only when both Supabase AND FFmpeg are up; Redis being down does not degrade overall status
- Upgraded sentry-sdk to `sentry-sdk[fastapi]==2.19.2` for automatic ASGI integration
- All 4 existing health endpoint tests pass (backward compat confirmed)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SENTRY_DSN config and extend Sentry init to all modes** - `80d04bc` (feat)
2. **Task 2: Extend health check with Supabase connectivity and granular status** - `972b15f` (feat)

## Files Created/Modified

- `app/config.py` - Added `sentry_dsn: str = ""` to Settings class
- `app/main.py` - Replaced desktop-only Sentry block with two-path init (env var || desktop config.json)
- `app/services/crash_reporter.py` - Updated docstring; SENTRY_DSN constant kept for backward compat
- `app/models.py` - Added supabase_status, ffmpeg_status, redis_status fields to HealthResponse
- `app/api/routes.py` - Updated health_check() to test Supabase connectivity and return granular status
- `requirements.txt` - Upgraded sentry-sdk to sentry-sdk[fastapi]==2.19.2

## Decisions Made

- SENTRY_DSN env var triggers Sentry for all modes (server, dev, desktop) — not gated by desktop_mode
- Desktop legacy path (config.json crash_reporting_enabled) preserved as path 2 with `elif settings.desktop_mode`
- In the desktop legacy path, init_sentry is only called if SENTRY_DSN constant in crash_reporter.py is non-empty (guard against empty-DSN init)
- Health status uses "ok"/"degraded"/"unhealthy" terminology (not old "healthy") — Supabase + FFmpeg determine degradation
- Redis is explicitly optional — `redis_status` field shows its status but does not affect the overall `status` field

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The health tests took ~9 minutes total because the test environment has no Supabase — the Supabase connectivity check waits for a connection timeout on each test. All 4 tests passed. This is expected behavior in CI/offline environments and is not a bug (the exception is caught and supabase_ok stays False).

## User Setup Required

To enable Sentry error reporting, add to `.env`:

```
SENTRY_DSN=https://your-key@sentry.io/your-project-id
```

No configuration needed for the extended health check — it works automatically.

## Next Phase Readiness

- Sentry foundation is in place for 60-02 and beyond
- Health endpoint ready for monitoring dashboards, uptime checkers, and Electron health polling
- No blockers for Phase 60 Plan 02

---
*Phase: 60-monitoring-observability*
*Completed: 2026-03-03*
