---
phase: 83-background-services-repository-migration
plan: 01
subsystem: database
tags: [sqlite, repository-pattern, background-services, assembly-service, cleanup-cli, no-new-abc, func-03-reuse]

requires:
  - phase: 80-library-routes-repository-migration
    provides: "sqlite_backend pytest fixture (conftest.py:161-219) reused for Phase 83 SQLite tests; composition-over-new-ABC-method lesson"
  - phase: 81-pipeline-routes-repository-migration
    provides: "6-variable ride-along regex gate; try/except behavior-preservation pattern carried forward"
  - phase: 82-segments-routes-repository-migration
    provides: "Section 6 FUNC-03 reuse-disposition section format; per-route SQLite test pattern (function-level postconditions for non-route layers)"

provides:
  - ROUTES-AUDIT.md cataloging the 2 get_client() sites (assembly_service.py:2604 + cleanup.py:145) + 1 in-body ride-along + FUNC-03 reuse-coverage disposition with empirical _apply_filters citations on both backends
  - Migrated app/services/assembly_service.py — dedup branch (L2599-L2619) uses repo.list_tts_assets(profile_id, QueryFilters(eq={...}, limit=1)) instead of _sb.table('editai_tts_assets') chain; try/except behavior preserved verbatim
  - Migrated app/core/cleanup.py — dry-run preview (L140-L200) uses repo.list_jobs(filters=QueryFilters(lt={...}, in_={...}, limit=10_000)) instead of raw_client.table('jobs') chain; in-memory fallback extended to also fire on typed-call exception (case-b defensiveness improvement)
  - tests/test_background_services_sqlite.py with 5 SQLite-mode tests (1 fixture sanity + 2 cleanup dry-run + 2 dedup) using sqlite_backend fixture + autouse JobStorage singleton reset
  - HEADLINE: combined `get_client()` count across both files = 2 → 0
  - **Zero new ABC methods added** — FUNC-03 closed by documented coverage (existing list_tts_assets + list_jobs cover both sites via existing eq/lt/in_/limit filter primitives)

affects: [Phase 84 cross-platform paths (unblocked), Phase 85 desktop smoke-test (unblocked), future SQLite-mode work]

tech-stack:
  added: []
  patterns:
    - "Composition over single-purpose ABC methods: list_tts_assets(profile_id, QueryFilters(eq={status, tts_text}, limit=1)) instead of get_tts_asset_by_text"
    - "Composition over single-purpose ABC methods: list_jobs(filters=QueryFilters(lt={created_at}, in_={status}, limit=N)) instead of list_old_jobs(cutoff, statuses)"
    - "Module-level autouse fixture _reset_job_storage_singleton: clears app.services.job_storage._job_storage before/after each test so the sqlite_backend repo binding takes effect (mitigates JobStorage.__init__ eager _repo capture)"
    - "Atomic per-task commits replace chunked commits in tiny phases (4 commits = 4 tasks)"
    - "Function-level postcondition assertions for non-route SQLite tests (no FastAPI TestClient, no dual-gate idiom — pure function I/O contract)"

key-files:
  created:
    - .planning/phases/83-background-services-repository-migration/ROUTES-AUDIT.md
    - .planning/phases/83-background-services-repository-migration/83-01-SUMMARY.md
    - tests/test_background_services_sqlite.py (5 tests, all passing under DATA_BACKEND=sqlite)
  modified:
    - app/services/assembly_service.py (L2599-L2619 — dedup branch only)
    - app/core/cleanup.py (L140-L200 — dry-run preview branch only)

key-decisions:
  - "Zero new ABC methods required for Phase 83 — existing list_tts_assets + list_jobs cover both sites via existing eq/lt/in_/limit filter primitives. Documented as FUNC-03 closure by coverage in ROUTES-AUDIT.md Section 6 (empirical citations: supabase_repo.py:32-46 + sqlite_repo.py:243-265)."
  - "cleanup.py in-memory fallback now fires on BOTH (a) repo is None AND (b) repo.list_jobs raises. Original code only fell back on case (a) — case (b) silently returned count=0. This is a deliberate defensiveness improvement on the dry-run path only; the non-dry-run path at L182-L210 retains its boolean-truthiness check (asymmetry intentional: dry-run is a preview and should never crash; actual deletion can crash loudly because operator invoked it explicitly)."
  - "limit=10_000 cap on list_jobs in dry-run preview — list_jobs defaults to limit=50 (sqlite_repo.py:1098, supabase_repo.py:550). For preview enumeration we want all matching old jobs, not just first 50. 10k is a safety cap (single profile shouldn't accumulate >10k terminal jobs in retention window). If hit, the dry-run undercount is acceptable — it's a preview, not a deletion."
  - "Module-level autouse _reset_job_storage_singleton fixture baked into test file (per Phase 83 plan-checker WARNING). Required because JobStorage.__init__ at job_storage.py:58 eagerly captures self._repo = get_repository() once and never re-checks; without the reset, a prior test's stale singleton would mask the sqlite_backend repo binding."
  - "5 tests instead of the minimum 2 — added (a) fixture sanity test, (b) empty-result dedup test, (c) seeded-job dry-run count test to give the executor and downstream verifier full confidence in both migrated code paths."

patterns-established:
  - "FUNC-03 closure by coverage (not addition): when an existing list_X(filters=QueryFilters(...)) method covers a call site's query shape via existing filter primitives, the audit Section 6 (FUNC-03 Reuse Closure) documents the disposition with empirical _apply_filters citations on both backends. Downstream verifiers reading 'no new ABC methods' must consult this section first."
  - "Behavior-preservation grep gates pair with code migration: every migration commit includes a verbatim try/except block + warning string preservation, validated by grep gates (`except Exception as _dedup_err` = 1; `Could not query jobs for dry-run` = 1)."
  - "Non-route layer SQLite tests skip the HTTP dual-gate idiom: tests/test_background_services_sqlite.py asserts function-level postconditions (return type, return value, no exception raised) instead of _assert_not_db_unavailable(r) on a 200 response. Pattern carries forward for any future non-route Phase X-01 plan."

requirements-completed: [FUNC-01, FUNC-03]

duration: ~single session (4 atomic commits across 4 tasks)
completed: 2026-05-23
---

# Phase 83 Plan 01: Background Services Repository Migration Summary

**Drove combined `get_client()` count across `app/services/assembly_service.py` + `app/core/cleanup.py` from 2 to exactly 0 by migrating the TTS dedup lookup (assembly_service.py:2604, `assemble_and_render_preview`) to `repo.list_tts_assets(profile_id, QueryFilters(eq={...}, limit=1))` and the cleanup dry-run preview (cleanup.py:145, `cleanup_old_jobs(dry_run=True)`) to `repo.list_jobs(filters=QueryFilters(lt={...}, in_={...}, limit=10_000))`, with zero new ABC methods added — FUNC-03 closed by documented coverage rather than addition (existing methods cover both sites via existing `eq` / `lt` / `in_` / `limit` filter primitives on both backends, empirically verified at supabase_repo.py:32-46 + sqlite_repo.py:243-265). 5 SQLite-mode tests in `tests/test_background_services_sqlite.py` exercise the migrated functions directly (no HTTP surface) with a module-level autouse `_reset_job_storage_singleton` fixture to mitigate the JobStorage eager-`_repo`-capture singleton diagnostic.**

## Performance

- **Duration:** single session (4 atomic per-task commits + 1 metadata commit)
- **Completed:** 2026-05-23
- **Tasks:** 4 (all complete)
- **Files modified:** 2 (assembly_service.py, cleanup.py)
- **Files created:** 3 (ROUTES-AUDIT.md, this SUMMARY.md, tests/test_background_services_sqlite.py)

## Accomplishments

- **Audit catalog complete (Task 1, `4e60c0b`):** ROUTES-AUDIT.md with 10 sections — header, per-variable ride-along breakdown, 2-row site table, helpers (none), new ABC methods (0; rejected candidates documented), FUNC-03 Reuse Closure with empirical `_apply_filters` citations, pattern taxonomy summary, 5 lessons carried forward from Phase 80/81/82, residual target (0), test plan for Task 4 (5 tests).
- **assembly_service.py dedup branch migrated (Task 2, `f659081`):** L2599-L2619 dedup branch in `assemble_and_render_preview` now uses `_repo.list_tts_assets(profile_id, QueryFilters(eq={"status": "ready", "tts_text": cleaned_text.strip()}, limit=1))`. The surrounding `try/except Exception as _dedup_err` block is preserved verbatim; the inner-block import is `from app.repositories.models import QueryFilters as _QueryFilters`. The pre-migration `_sb = _repo.get_client()` line was the silent-skip cause under SQLite mode — post-migration the dedup fallback works on both backends transparently.
- **cleanup.py dry-run preview migrated (Task 3, `066cb9b`):** L140-L200 dry-run branch in `cleanup_old_jobs(days, dry_run)` now uses `repo.list_jobs(filters=QueryFilters(lt={"created_at": cutoff.isoformat()}, in_={"status": sorted(list(terminal_statuses))}, limit=10_000))`. New `used_repo` flag explicitly controls fallback so the in-memory snapshot fires on BOTH `repo is None` AND `list_jobs raised`. `try/except Exception as exc` preserved with the same warning message `"Could not query jobs for dry-run"`. Non-dry-run path at L182-L210 (`storage.cleanup_old_jobs(days)`) is UNCHANGED — already uses the existing `cleanup_old_jobs` ABC method.
- **SQLite tests added (Task 4, `507545c`):** `tests/test_background_services_sqlite.py` with 5 tests: (1) `test_sqlite_backend_fixture_loads_for_phase83` (fixture sanity), (2) `test_cleanup_old_jobs_dry_run_returns_count_sqlite` (empty-DB dry-run), (3) `test_cleanup_old_jobs_dry_run_counts_old_terminal_jobs_sqlite` (seeded old+fresh, expects ≥ 1), (4) `test_assembly_tts_dedup_lookup_returns_existing_mp3_path_sqlite` (seeded asset round-trip), (5) `test_assembly_tts_dedup_lookup_returns_empty_for_missing_text_sqlite` (no-match returns empty data). Module-level autouse `_reset_job_storage_singleton` fixture clears `app.services.job_storage._job_storage` before/after each test (the plan-checker-flagged singleton diagnostic).
- **Combined `get_client()` count: 2 → 0.** Both files green on all 4 grep gates (get_client + 6-var ride-along × 2 files). All 13 verification gates from the plan PASS.

## Task Commits

Each task was committed atomically:

1. **Task 1: ROUTES-AUDIT.md** — `4e60c0b` (docs)
2. **Task 2: assembly_service.py dedup migration** — `f659081` (refactor)
3. **Task 3: cleanup.py dry-run migration** — `066cb9b` (refactor)
4. **Task 4: SQLite tests** — `507545c` (test)

**Plan metadata commit:** appended after this SUMMARY.md by `node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" complete-plan 83 1` — updates STATE.md + ROADMAP.md atomically.

## Files Created/Modified

**Created:**
- `.planning/phases/83-background-services-repository-migration/ROUTES-AUDIT.md` — Phase 83 migration contract: 2-row site table + per-variable ride-along breakdown + FUNC-03 Reuse Closure (Section 6) with empirical `_apply_filters` citations on both backends.
- `.planning/phases/83-background-services-repository-migration/83-01-SUMMARY.md` — this file.
- `tests/test_background_services_sqlite.py` — 5 SQLite-mode tests exercising the migrated functions directly with autouse `_reset_job_storage_singleton` fixture.

**Modified:**
- `app/services/assembly_service.py` — dedup branch L2599-L2619 only (the inner `try: ... except Exception as _dedup_err:` block body). Outer `try/except Exception as lib_err:` at L2583/L2624 unchanged.
- `app/core/cleanup.py` — dry-run branch L140-L200 only (the `if dry_run:` body, including the in-memory fallback restructured under the `used_repo` flag). Non-dry-run path L202-L228 (`if storage.supabase: count = storage.cleanup_old_jobs(days)`) UNCHANGED.

## Verification Gates Status

All 13 plan must_haves are GREEN:

| # | Gate | Required | Actual | Pass |
|---|------|----------|--------|------|
| 1 | ROUTES-AUDIT.md exists with FUNC-03 disposition + 2-row site table + line numbers | present, 10 sections | present | PASS |
| 2 | `grep -c "get_client()" app/services/assembly_service.py` | 0 (was 1) | 0 | PASS |
| 3 | `grep -c "get_client()" app/core/cleanup.py` | 0 (was 1) | 0 | PASS |
| 4 | 6-var ride-along grep in assembly_service.py | 0 (was 1 at L2606) | 0 | PASS |
| 5 | 6-var ride-along grep in cleanup.py | 0 (was 0, ensure no regression) | 0 | PASS |
| 6 | AST parse of assembly_service.py | exit 0 | exit 0 | PASS |
| 7 | AST parse of cleanup.py | exit 0 | exit 0 | PASS |
| 8 | `grep -c 'except Exception as _dedup_err' app/services/assembly_service.py` | 1 (preserved verbatim) | 1 | PASS |
| 9 | `grep -c 'Could not query jobs for dry-run' app/core/cleanup.py` | 1 (preserved verbatim) | 1 | PASS |
| 10 | `grep -c 'Preview TTS library dedup lookup failed' app/services/assembly_service.py` | 1 (warning string preserved) | 1 | PASS |
| 11 | `grep -c 'storage.cleanup_old_jobs(days)' app/core/cleanup.py` (non-dry-run path UNCHANGED) | ≥ 1 | 1 | PASS |
| 12 | `cleanup_old_jobs(days=7, dry_run=True)` returns int ≥ 0 under DATA_BACKEND=sqlite | tested via `test_cleanup_old_jobs_dry_run_returns_count_sqlite` | PASS | PASS |
| 13 | Assembly dedup branch returns mp3_path under DATA_BACKEND=sqlite | tested via `test_assembly_tts_dedup_lookup_returns_existing_mp3_path_sqlite` | PASS | PASS |

## Verification Snapshot

Timestamp: 2026-05-23T04:35:05Z

| Command | Result |
|---------|--------|
| `grep -c "get_client()" app/services/assembly_service.py` | `0` |
| `grep -c "get_client()" app/core/cleanup.py` | `0` |
| `grep -cE "(supabase\|_sb\|_supa\|_supa_render\|supabase_chk\|supabase_lib)\.(table\|rpc)\(" app/services/assembly_service.py` | `0` |
| `grep -cE "(supabase\|_sb\|_supa\|_supa_render\|supabase_chk\|supabase_lib)\.(table\|rpc)\(" app/core/cleanup.py` | `0` |
| `grep -c "list_tts_assets" app/services/assembly_service.py` | `3` |
| `grep -c "list_jobs" app/core/cleanup.py` | `4` |
| `grep -c "except Exception as _dedup_err" app/services/assembly_service.py` | `1` |
| `grep -c "Could not query jobs for dry-run" app/core/cleanup.py` | `1` |
| `grep -c "storage.cleanup_old_jobs(days)" app/core/cleanup.py` | `1` |
| `py -3.13 -m pytest tests/test_background_services_sqlite.py -v --no-cov` | `5 passed` |
| `py -3.13 -m pytest tests/test_api_library_sqlite.py tests/test_api_pipeline_sqlite.py tests/test_api_segments_sqlite.py --no-cov` | `67 passed` (23+16+28 baseline preserved) |
| `python -c "import ast; ast.parse(open('app/services/assembly_service.py', encoding='utf-8').read())"` | exit 0 |
| `python -c "import ast; ast.parse(open('app/core/cleanup.py', encoding='utf-8').read())"` | exit 0 |

## Decisions Made

See frontmatter `key-decisions` for the full list. Headline:

1. **Zero new ABC methods.** Phase 83's FUNC-03 disposition is documented coverage, not addition. The existing `list_tts_assets` and `list_jobs` ABC methods cover both call sites via existing `eq` / `lt` / `in_` / `limit` filter primitives on both backends (verified at supabase_repo.py:32-46 + sqlite_repo.py:243-265). ROUTES-AUDIT.md Section 6 is the load-bearing evidence.

2. **cleanup.py case-(b) fallback defensiveness improvement.** The in-memory fallback now fires on both `repo is None` and `repo.list_jobs raises`. Pre-migration code only fell back on case (a); case (b) silently returned `count=0`. Deliberate change, dry-run-only (non-dry-run path unchanged at L202-L228).

3. **`limit=10_000` cap on dry-run preview.** `list_jobs` default is 50; we want to enumerate all matching old jobs for preview. 10k is a safety cap — single profile shouldn't accumulate >10k terminal jobs in retention window. If hit, the undercount is acceptable.

4. **5 tests instead of minimum 2.** Adds fixture sanity + empty-result handling + seeded-count assertion for full confidence.

5. **Module-level autouse `_reset_job_storage_singleton`.** JobStorage captures `self._repo` once in `__init__` and never re-checks; without the reset, prior tests' stale singleton would mask the sqlite_backend repo binding. Plan-checker WARNING from planning time baked into the test template.

## Deviations from Plan

**None.** The plan executed exactly as written. The 4 task commits + 1 metadata commit match the plan's `chunked_commit_rationale` section. All 13 must_haves are GREEN. All acceptance criteria for all 4 tasks pass. Behavior-preservation gates intact. Phase 80/81/82 SQLite baselines (23 + 16 + 28 = 67 tests) preserved at 100%.

## Threat Mitigations Verified

| Threat ID | Status | Verification |
|-----------|--------|--------------|
| T-83-01-01 (cross-profile dry-run enumeration) | accepted (unchanged) | The CLI is operator-only; pre-migration behavior preserved. No HTTP surface introduced. |
| T-83-01-02 (SQL injection in `list_tts_assets`) | mitigated | Both backends parameterize via `_apply_filters` (`.eq(col, val)` on Supabase; `?` placeholders on SQLite). `cleaned_text` comes from validated upstream pipeline state. |
| T-83-01-03 (SQL injection in `list_jobs`) | mitigated | Both backends parameterize `lt` (?) and `in_` (IN (?,?,?)). `cutoff_iso` is server-generated; `terminal_statuses` is a hardcoded set. Zero untrusted input. |
| T-83-01-04 (DoS via large list_jobs result) | accepted (with cap) | Explicit `limit=10_000`. If hit, dry-run undercount logged but does not crash. Non-dry-run path uses a single DELETE statement, not affected. |
| T-83-01-05 (DoS via dropped limit=1 in dedup) | mitigated | Explicit `limit=1` matches pre-migration `.limit(1)`. Strict refactor (Phase 83 Hard Constraint #1). |
| T-83-01-06 (logging) | accepted (unchanged) | Warning strings preserved verbatim — operators can grep `logs/` for `"Preview TTS library dedup lookup failed"` and `"Could not query jobs for dry-run"`. |
| T-83-01-07 (auth bypass / wrong-profile dedup) | accepted (unchanged) | Profile-scoped via `repo.list_tts_assets(profile_id, ...)`. Both backends apply `.eq("profile_id", profile_id)` first (supabase_repo.py:656, sqlite_repo.py:1269). |

## Hand-off to Phase 84

Phase 83 sealed; Phase 84 (Cross-platform paths & FFmpeg discovery) unblocked. Phase 84 has no dependency on Phase 83 per ROADMAP — it operates on path resolution, not the repository ABC. Phase 85 (desktop smoke-test harness) is the downstream gate that exercises the entire SQLite-mode stack end-to-end including the Phase 83 migrations.

## Self-Check

- [x] ROUTES-AUDIT.md present with FUNC-03 disposition section and empirical filter-coverage citations on both backends.
- [x] Both `get_client()` grep gates at 0 (was 1/1 at HEAD).
- [x] Both 6-variable ride-along grep gates at 0 (was 1/0 at HEAD).
- [x] AST parses clean for both files.
- [x] All 4 behavior-preservation grep gates at the expected values (`_dedup_err`=1, "Preview TTS library dedup lookup failed"=1, "Could not query jobs for dry-run"=1, "storage.cleanup_old_jobs(days)"=1).
- [x] All 5 new Phase 83 SQLite tests pass.
- [x] Phase 80/81/82 SQLite baselines preserved at 67 passed (23+16+28).
- [x] 4 atomic commits landed in order (`4e60c0b`, `f659081`, `066cb9b`, `507545c`).
- [x] Zero new ABC methods added — FUNC-03 closed by documented coverage.
- [x] No backwards-compat shims, no commented-out old code, no // removed comments.

---
*Phase: 83-background-services-repository-migration*
*Plan: 01*
*Completed: 2026-05-23*
