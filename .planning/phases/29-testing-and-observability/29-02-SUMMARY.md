---
phase: 29-testing-and-observability
plan: "02"
subsystem: infra
tags: [logging, json-logging, python-json-logger, cleanup, data-retention, cli]

# Dependency graph
requires: []
provides:
  - Structured JSON logging for all backend modules via app/logging_config.py
  - Data retention CLI script (python -m app.cleanup) for temp/output/job cleanup
affects: [all-future-backend-phases]

# Tech tracking
tech-stack:
  added: [python-json-logger>=2.0.0]
  patterns:
    - setup_logging() called once at app startup (app/main.py) — all loggers inherit root config
    - Cleanup CLI uses argparse with --days, --dry-run, --temp-only, --jobs-only flags
    - Cleanup output is also JSON (imports setup_logging from logging_config)

key-files:
  created:
    - app/logging_config.py
    - app/cleanup.py
  modified:
    - app/main.py
    - requirements.txt

key-decisions:
  - "python-json-logger used with rename_fields to produce timestamp/level/logger keys (aggregator-friendly)"
  - "setup_logging() replaces logging.basicConfig entirely in main.py — all loggers inherit root handler"
  - "Cleanup CLI handles both Supabase-backed and in-memory fallback job storage"
  - "Output directory files cleaned by age (same --days flag as temp/) but directory itself is preserved"

patterns-established:
  - "JSON logging: all new backend code gets structured fields via extra={} kwargs — parseable by Datadog/Loki/CloudWatch"
  - "Cleanup CLI: run periodically via cron with --days 7 to prevent unbounded temp file growth"

requirements-completed: [TEST-03, TEST-04]

# Metrics
duration: 2min
completed: 2026-02-22
---

# Phase 29 Plan 02: Structured Logging and Data Retention Summary

**Structured JSON log output via python-json-logger with a CLI data retention command that removes temp files, output files, and stale job records by age**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-22T02:08:18Z
- **Completed:** 2026-02-22T02:10:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Replaced `logging.basicConfig` with `setup_logging()` from `app/logging_config.py` — all backend logs are now valid JSON with `timestamp`, `level`, `logger`, `message` keys
- Added `python-json-logger>=2.0.0` to requirements.txt and installed it
- Created `app/cleanup.py` as a standalone CLI runnable via `python -m app.cleanup` with `--dry-run`, `--days`, `--temp-only`, and `--jobs-only` flags
- Cleanup correctly walks temp/ and output/ by file mtime, removes empty directories, and delegates job cleanup to JobStorage (with in-memory fallback)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement structured JSON logging** - `cf8a6ac` (feat)
2. **Task 2: Create data retention cleanup command** - `3cdef7d` (feat)

## Files Created/Modified
- `app/logging_config.py` - setup_logging() with JsonFormatter, quietens noisy third-party loggers
- `app/cleanup.py` - Data retention CLI: temp/output file cleanup + job record cleanup
- `app/main.py` - Replaced logging.basicConfig with setup_logging() import and call
- `requirements.txt` - Added python-json-logger>=2.0.0

## Decisions Made
- python-json-logger used with `rename_fields` to produce `timestamp`/`level`/`logger` keys — matches common aggregator field naming conventions (Datadog, Loki)
- `setup_logging()` replaces `logging.basicConfig` entirely — single call at app startup makes all loggers (including third-party) inherit the JSON root handler
- Cleanup CLI uses JobStorage's existing `cleanup_old_jobs(days)` for Supabase-backed cleanup, and iterates `_memory_store` directly for in-memory fallback
- Output directory files are deleted by age but the directory itself is preserved (unlike empty sub-dirs in temp/ which are pruned)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. `python-json-logger` installed automatically via `pip install -r requirements.txt`.

## Next Phase Readiness
- All backend log output is now valid JSON parseable by log aggregators (TEST-03 satisfied)
- `python -m app.cleanup --days 7` is ready for cron/scheduled use (TEST-04 satisfied)
- Phase 29 plan 02 complete — v6 Production Hardening observability layer is now in place

---
*Phase: 29-testing-and-observability*
*Completed: 2026-02-22*
