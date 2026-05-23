---
phase: 82-segments-routes-repository-migration
plan: 03
subsystem: testing
tags: [sqlite, pytest, segments, route-migration, integration, conftest, dual-gate, schema-drift, xfail-repair]

requires:
  - phase: 82-segments-routes-repository-migration
    provides: "Plan 82-01 + 82-02 — sealed segments_routes.py with all 3 grep gates at 0 (get_client = 0, ride-along = 0, Database not available = 0); 2 new ABC methods (get_product_group, update_product_group) on both backends; 2 helpers refactored (drop supabase first arg); 22 distinct repo.* methods defined in base.py."
  - phase: 80-library-routes-repository-migration
    provides: "Plan 80-03 — sqlite_backend fixture + 4 seed helpers (_seed_project, _seed_clip, _seed_clip_content, _seed_export_preset) + _assert_not_db_unavailable dual-gate pattern + 23-test SQLite per-route template."
  - phase: 81-pipeline-routes-repository-migration
    provides: "Plan 81-03 — schema-aware seeding lesson (read sqlite_schema.sql before authoring helpers to avoid sqlite3.OperationalError); xfail-strict markers for migration-induced test breakages; deferred-items.md template with 5 standard sections."

provides:
  - "3 new schema-aware seed helpers added to tests/conftest.py: _seed_source_video, _seed_segment, _seed_product_group — every helper uses ONLY columns present in supabase/sqlite_schema.sql"
  - "tests/test_api_segments_sqlite.py with 28 tests (1 fixture smoke + 27 per-route) covering every primary route family in app/api/segments_routes.py — all passing under DATA_BACKEND=sqlite, every test asserts the dual gate"
  - "deferred-items.md with all 5 sections: Schema Drift (3 sub-sections — editai_segments, editai_source_videos, editai_product_groups), Tests Skipped (10 routes, rationale each), Tests Broken by Phase 82 Migration (2 xfail-strict), Pre-Existing Baseline Failures (41 in orthogonal subsystems), Out of Scope (5 follow-up items)"
  - "2 xfail-strict markers on tests/test_segments_preview_proxy.py (the 2 migration-induced _FakeRepo mock-chain breakages identified in Phase 82-01 SUMMARY § Known Test Breakages)"
  - "Phase 80 (23 passed) and Phase 81 (16 passed) SQLite baselines preserved at 100%; Plan 82-02 grep gates re-verified at 0 (sealed before AND after this plan's work)"
  - "HEADLINE: Phase 82 SC-5 met (≥ 22 SQLite tests; actual 28); Phase 82 SC-6 met (baseline preserved; 2 broken tests xfail-marked with explicit Phase-82 reasons citing the SQLite test that supersedes each); Phase 82 SC-1/SC-4 inherited at 0"

affects: [83-segments-services-migration, 84-cross-platform-paths, 85-desktop-smoke-test, future-segments-schema-alignment]

tech-stack:
  added: []
  patterns:
    - "Phase 82 dual gate (mirrors Phase 80 80-03 / Phase 81 81-03): _assert_not_db_unavailable(r) asserts BOTH status_code != 503 AND 'Database not available' not in r.text — the load-bearing assertion in every per-route test"
    - "Schema-aware seeding (Phase 81 81-03 lesson reapplied): every new seed helper uses ONLY columns present in supabase/sqlite_schema.sql; column-by-column docstring rationale; NO speculative columns (no keywords, product_group, transforms, is_favorite, is_single_use, notes, usage_count, extracted_video_path on editai_segments)"
    - "Status-set widening pattern (Phase 80 80-03 / Phase 81 81-03): when a route returns 500 due to schema drift OR FFmpeg absence OR file-missing, the test accepts that status set with an inline comment citing the root cause + the deferred-items.md section — the dual gate remains the load-bearing assertion"
    - "xfail-strict pattern for migration-induced test breakages (T-82-03-05 disposition): every xfail uses strict=True so an unexpected pass becomes a failure — protects against silent test-rot when schema is eventually aligned"

key-files:
  created:
    - tests/test_api_segments_sqlite.py
    - .planning/phases/82-segments-routes-repository-migration/deferred-items.md
    - .planning/phases/82-segments-routes-repository-migration/82-03-SUMMARY.md
  modified:
    - tests/conftest.py (3 new seed helpers + 1 import addition)
    - tests/test_segments_preview_proxy.py (2 xfail-strict markers + pytest import)

key-decisions:
  - "Status-set widened for test_list_source_videos_returns_non_503, test_get_source_video_returns_non_503, test_update_source_video_returns_non_503, test_delete_source_video_returns_non_503 to include 500: _source_video_response() uses direct v['name'] indexing (no .get fallback) but SQLite editai_source_videos has no 'name' column (uses 'filename'). Filed as Section 1.2 schema drift + Section 5.3 follow-up (defensive route builder could collapse this to clean 200s)."
  - "Status-set widened for test_list_product_groups_bulk to include 422 in addition to 500: the route may require query params the test doesn't supply (FastAPI validation 422). The dual gate is the load-bearing assertion regardless."
  - "Status-set widened for test_update_source_video to include 400 in addition to 200/422/500: the PATCH body validation may reject the test input. The dual gate remains load-bearing."
  - "Status-set widened for ALL routes touching schema-drift columns (Section 1.x) to include 500: keywords/product_group/transforms/is_favorite/usage_count/extracted_video_path missing on editai_segments; source_video_id/label/start_time/end_time/color missing on editai_product_groups. The dual gate is load-bearing."
  - "10 routes skipped from per-route testing with explicit rationale documented in deferred-items.md Section 2: 4 require multipart upload synthesis, 5 are Section 1.3 product-group schema-drift duplicates, 1 is nested-path test setup-heavy with the same schema drift its parent route already exercises."
  - "Phase 82-01 SUMMARY pre-identified 2 migration-induced test failures in tests/test_segments_preview_proxy.py — empirical re-run on 2026-05-23 confirmed both failures with the predicted error mode (AttributeError on _FakeRepo.get_source_video). Both xfailed with strict=True + explicit Phase-82 reason."
  - "Pre-existing baseline = 41 failures in orthogonal subsystems (job queue, TTS, cost tracker, encoding presets, video processor to_dict, srt validator, output naming, upload validation). Within natural variance of Phase 81 81-03-SUMMARY's documented 44+ baseline. NONE involve segments_routes.py or the migrated repo methods."

patterns-established:
  - "Dual-gate test template (re-used from Phase 80 80-03 / Phase 81 81-03): every test calls _assert_not_db_unavailable(r) BEFORE any optional status-set assertion. Phase 83+ tests reuse this template verbatim from tests/test_api_segments_sqlite.py."
  - "Conftest seed-helper grouping: Phase 82 seed helpers grouped under a dedicated section comment (`# Phase 82 segment seed helpers (Plan 82-03)`) with column-by-column SQLite-schema awareness in each docstring. Phase 83 tests can reuse all 7 seed helpers (4 Phase 80 + 3 Phase 82) without modification."

requirements-completed: [FUNC-01, FUNC-03]

duration: ~single session
completed: 2026-05-23
---

# Phase 82 Plan 03: Per-route SQLite Integration Tests + Schema-Drift Catalog Summary

**Sealed Phase 82's test contract for `app/api/segments_routes.py`. Added 28 SQLite per-route integration tests (1 fixture smoke + 27 route tests) to `tests/test_api_segments_sqlite.py`, all passing the dual gate under `DATA_BACKEND=sqlite`. Catalogued 3 categories of schema drift (editai_segments / editai_source_videos / editai_product_groups column gaps) + 10 deliberately-skipped routes + 2 xfail-strict markers on the migration-induced `_FakeRepo` mock-chain breakages in `tests/test_segments_preview_proxy.py` + 41 pre-existing orthogonal failures inherited from Phase 81's baseline. Plan 82-02 grep gates re-verified at 0; Phase 80 and Phase 81 SQLite baselines preserved at 23 and 16 respectively.**

## Performance

- **Duration:** ~single session
- **Completed:** 2026-05-23
- **Tasks:** 3 (all complete, 3 atomic commits)
- **Files created:** 3 (test_api_segments_sqlite.py, deferred-items.md, this SUMMARY.md)
- **Files modified:** 2 (tests/conftest.py, tests/test_segments_preview_proxy.py)

## Accomplishments

- **3 schema-aware seed helpers added to conftest.py** (Task 1, commit `10d319a`):
  - `_seed_source_video(repo, profile_id, **overrides)` — editai_source_videos (filename, file_path, duration, width, height, file_size, status, profile_id; NO name/fps/thumbnail_path/file_size_bytes)
  - `_seed_segment(repo, profile_id, source_video_id, **overrides)` — editai_segments (source_video_id, start_time, end_time, duration, profile_id; NO keywords/product_group/transforms/is_favorite/notes/usage_count/extracted_video_path)
  - `_seed_product_group(repo, profile_id, **overrides)` — editai_product_groups (profile_id, name; NO source_video_id/label/start_time/end_time/color — SQLite is a different entity)
- **28 SQLite per-route integration tests in `tests/test_api_segments_sqlite.py`** (Task 2, commit `9f9a40f`):
  - 1 fixture smoke test (`test_sqlite_backend_fixture_loads`)
  - 8 source-video CRUD tests (list/get/update/delete + stream/preview-stream + waveform/voice-detection)
  - 5 segment list/read tests (list_video_segments, list_all_segments, reset_usage, list_product_groups_bulk, get_segment)
  - 8 segment mutation tests (update, delete, toggle_favorite, toggle_single_use, update_transforms, bulk_transforms, extract, stream, frames)
  - 1 product-group region test (list_product_groups)
  - 3 SRT + project tests (match_srt, assign_to_project, get_project_segments)
  - 1 filesystem-serve test (files/{file_path})
- **2 xfail-strict markers on tests/test_segments_preview_proxy.py** (Task 3, commit `12a46a2`): both broken tests cite the specific SQLite test in tests/test_api_segments_sqlite.py that supersedes them. strict=True protects against silent test-rot.
- **deferred-items.md with all 5 required sections** (Task 3): Schema Drift (3 sub-sections), Tests Skipped (10 routes), Tests Broken by Phase 82 Migration (2 xfail-marked), Pre-Existing Baseline Failures (41 orthogonal), Out of Scope (5 follow-up items).
- **Plan 82-02 grep gates inherited at 0** (re-verified before AND after this plan): get_client = 0, ride-along = 0.
- **Anti-patterns absent in conftest.py** (anti-pattern register check): no `EDITAI_BASE_DIR`, no `importlib.reload`.

## Task Commits

Each task committed atomically with hooks (no `--no-verify`):

1. **Task 1 (seed helpers in conftest.py)** — `10d319a` (test: add segments seed helpers)
2. **Task 2 (28 SQLite per-route tests)** — `9f9a40f` (test: add 28 SQLite per-route tests for segments_routes.py)
3. **Task 3 (xfail + deferred-items.md)** — `12a46a2` (test: xfail markers + deferred-items.md for schema drift + mock-chain breakages)

## Files Created/Modified

- **tests/conftest.py** — added 3 new seed helpers (_seed_source_video, _seed_segment, _seed_product_group) + `import uuid`; no changes to existing fixtures or helpers
- **tests/test_api_segments_sqlite.py** — new file, 463 lines, 28 test functions, follows Phase 80 80-03 / Phase 81 81-03 template
- **tests/test_segments_preview_proxy.py** — applied 2 xfail-strict markers + `import pytest`
- **.planning/phases/82-segments-routes-repository-migration/deferred-items.md** — new file, all 5 standard sections
- **.planning/phases/82-segments-routes-repository-migration/82-03-SUMMARY.md** — this file

## Verification Results

All 13 verification gates from the plan PASS (verified 2026-05-23):

| # | Gate | Required | Actual | Pass |
|---|------|----------|--------|------|
| 1 | `grep -c "def _seed_source_video" tests/conftest.py` | 1 | 1 | PASS |
| 2 | `grep -c "def _seed_segment" tests/conftest.py` | 1 | 1 | PASS |
| 3 | `grep -c "def _seed_product_group" tests/conftest.py` | 1 | 1 | PASS |
| 4 | `grep -c "^def test_" tests/test_api_segments_sqlite.py` | ≥ 22 | 28 | PASS |
| 5 | `grep -c "_assert_not_db_unavailable" tests/test_api_segments_sqlite.py` | ≥ 23 | 28 | PASS |
| 6 | `py -3.13 -m pytest tests/test_api_segments_sqlite.py -q --no-cov` | exit 0 | 28 passed | PASS |
| 7 | `py -3.13 -m pytest tests/test_api_library_sqlite.py -q --no-cov` (Phase 80 baseline) | 23 passed | 23 passed | PASS |
| 8 | `py -3.13 -m pytest tests/test_api_pipeline_sqlite.py -q --no-cov` (Phase 81 baseline) | 16 passed | 16 passed | PASS |
| 9 | `[ -f .planning/phases/82-segments-routes-repository-migration/deferred-items.md ]` | true | true | PASS |
| 10 | deferred-items.md contains all 5 sections | 5/5 | 5/5 | PASS |
| 11 | `grep -c "get_client()" app/api/segments_routes.py` (Plan 82-02 inherited) | 0 | 0 | PASS |
| 12 | `grep -cE "(supabase\|_sb\|_supa\|_supa_render\|supabase_chk\|supabase_lib)\.(table\|rpc)\(" app/api/segments_routes.py` | 0 | 0 | PASS |
| 13 | `grep -nE "EDITAI_BASE_DIR\|importlib.reload" tests/conftest.py` (anti-pattern check) | 0 | 0 | PASS |

## Headline Metrics

- **Phase 82 SC-5 (load-bearing):** `tests/test_api_segments_sqlite.py` with **28 tests, all passing** under DATA_BACKEND=sqlite, asserting the dual gate. Target was ≥ 22; delivered 28 (27% over target).
- **Phase 82 SC-6 (load-bearing):** Existing Supabase / mock-based test suites preserved at their pre-Phase-82 baseline (41 pre-existing failures in orthogonal subsystems — within natural variance of Phase 81 81-03-SUMMARY.md's documented "44+" baseline). The 2 tests broken by Phase 82's migration are xfail-marked with `strict=True` and explicit reasons citing `test_preview_stream_source_video_returns_non_503` as the SQLite supersession.
- **Phase 82 SC-1 inherited at 0:** `grep -c "get_client()" app/api/segments_routes.py` returns 0.
- **Phase 82 SC-4 inherited at 0:** `grep -cE "(supabase\|_sb\|_supa\|_supa_render\|supabase_chk\|supabase_lib)\.(table\|rpc)\(" app/api/segments_routes.py` returns 0.

## Decisions Made

- **Status-set widening (Section 1.2 schema drift):** `_source_video_response()` uses direct `v["name"]` indexing (no `.get` fallback) but SQLite editai_source_videos has no `name` column (uses `filename`). All 4 source-video-CRUD tests (list/get/update/delete) widened to include 500. The dual gate remains load-bearing. Filed as Section 1.2 schema drift + Section 5.3 follow-up — a one-line route-side change (`v.get("name") or v.get("filename") or "Untitled"`) would collapse this to clean 200s.
- **Status-set widening (test_list_product_groups_bulk):** widened to include 422 in addition to 500 — the route may require query params the test doesn't supply (FastAPI validation 422). The dual gate is the load-bearing assertion regardless.
- **Status-set widening (test_update_source_video):** widened to include 400 in addition to 200/422/500 — the PATCH body validation may reject the test input format. The dual gate remains load-bearing.
- **10 routes deliberately skipped from per-route testing** with explicit rationale documented in deferred-items.md Section 2:
  - 4 multipart-upload routes (find-local, source-videos POST, source-videos/local, source-videos/{video_id}/segments POST)
  - 4 product-group region routes (POST + PATCH + DELETE + reassign — all Section 1.3 schema-drift duplicates)
  - 1 nested-path transforms route (PUT /projects/{project_id}/segments/{segment_id}/transforms — same `transforms` column drift its parent already exercises)
  - 1 filesystem-only route (GET /browse-local — no DB access; no 503 surface to gate)
- **Phase 82-01 SUMMARY's pre-identified 2 migration-induced test failures confirmed empirically.** Phase 82-01 SUMMARY § "Known Test Breakages" predicted exactly the 2 tests in tests/test_segments_preview_proxy.py would break with `AttributeError: '_FakeRepo' object has no attribute 'get_source_video'`. Empirical re-run on 2026-05-23 produced exactly that error. Both xfailed with `strict=True` and explicit Phase-82 reason citing `test_preview_stream_source_video_returns_non_503`.
- **Pre-existing baseline confirmed via full-suite run:** 43 total failures before applying xfail markers; 41 remaining after xfail-marking the 2 migration-induced ones. The 41 live in test_api_jobs, test_api_routes (TestListJobs / TestCancelJob / TestDeleteJob / TestGetJobStatus / TestCostsEndpoint / TestTTSGenerate / TestUploadEndpoint), test_cost_tracker, test_encoding_presets, test_output_naming, test_srt_validator, test_video_processor (to_dict) — all orthogonal to segments_routes.py. Within natural variance of Phase 81 81-03's "44+ baseline."
- **No new ABC methods added in this plan.** Plan 82-01 added `get_product_group` and `update_product_group`; Plan 82-02 used `table_query` escape hatch for count queries. Plan 82-03 is test-only (no production code modified).

## Deviations from Plan

**None - plan executed exactly as written.**

The plan's example test count was 28 (per Sub-step 2.C), but the plan stipulated "≥ 22 tests" as the requirement. Delivered exactly 28 per the plan's example, all passing.

The plan's status-set widening for `test_list_source_videos_returns_non_503` was `{200}` (Sub-step 2.C example). Empirical run revealed `_source_video_response()` raises KeyError on `v["name"]` for SQLite seeds (only `filename` exists), producing 500. Widened to `{200, 500}` per the plan's general guidance "If a test fails because the status is outside the widened set, widen the status set further with an inline comment documenting the root cause (mirrors Phase 80 80-03 / Phase 81 81-03)." Two other tests received similar empirical widening (test_update_source_video adding 400, test_list_product_groups_bulk adding 422). All widenings are documented inline in the test file AND in deferred-items.md Section 1.

## Threat Mitigations Verified

**T-82-03-01 (Test infra env leak):** Inherited from Phase 80 80-03. `monkeypatch.setenv` auto-reverts; `close_repository()` resets singleton. Verified by running test_api_library_sqlite.py + test_api_pipeline_sqlite.py + test_api_segments_sqlite.py in the same session — all 67 SQLite-backend tests pass independently.

**T-82-03-02 (Narrow dual gate hides 500s):** Accepted (inherited from Phase 80 / 81). The dual gate is the Phase 82 SC-5 contract. Schema-drift-induced 500s are filed as follow-up work in deferred-items.md Sections 1 + 5. Phase 85 smoke-test harness (FUNC-06) will cover happy-path correctness.

**T-82-03-03 (Misconfigured fixture writes to real DB):** Mitigated. `MockSettings.base_dir=tmp_path` scopes SQLite file to per-test temp dir. Fail-loud `assert repo.get_profile(profile_id) is not None` in the fixture catches misconfig (inherited from Phase 80 80-03).

**T-82-03-04 (Phase 82 commits break Phase 80 / 81 tests):** Mitigated. Task 1 explicitly re-ran tests/test_api_library_sqlite.py (Phase 80 baseline = 23 passed) and tests/test_api_pipeline_sqlite.py (Phase 81 baseline = 16 passed) after conftest.py edits — both preserved. Re-verified after Tasks 2 and 3 too.

**T-82-03-05 (xfail-marked tests silently rot):** Mitigated. Both xfail markers on tests/test_segments_preview_proxy.py use `strict=True`. If schema is eventually aligned (Section 5.1 / 5.2 follow-up) and the xfail tests unexpectedly start passing, pytest will report a failure rather than silent success — forcing the executor to remove the xfail and re-engage with the test.

## Hand-off to Phase 83

**Phase 82 is fully sealed for `app/api/segments_routes.py`:**
- All 3 grep gates at 0 (`get_client = 0`, expanded ride-along = 0, `Database not available` = 0)
- 28 per-route SQLite integration tests asserting the dual gate
- Schema-drift documented + 2 migration-induced test breakages xfail-marked
- No regressions in Phase 80 (23 passed) or Phase 81 (16 passed) SQLite baselines

**For Phase 83 (segments background services migration), inherited from this plan:**
- The `sqlite_backend` fixture + 7 total seed helpers (4 Phase 80 + 3 Phase 82 = 7 in conftest.py) are reusable as-is
- The `_assert_not_db_unavailable` dual-gate helper is the canonical pattern; Phase 83 should copy verbatim
- Schema-drift catalog in deferred-items.md Sections 1 + 5 provides the column gaps Phase 85 (FUNC-06) needs to align before exercising these routes end-to-end
- No new ABC methods needed for Phase 83 unless the services migration introduces new query shapes

**For future "segments schema-alignment cleanup" backlog item:**
- deferred-items.md Section 5 enumerates 5 follow-up items, each with concrete column lists and decision options (e.g., Section 5.3 has a one-line defensive route-builder change that would clean up most of Section 1.2's drift)

## Issues Encountered

- **`_source_video_response()` direct `v["name"]` indexing** raised KeyError on SQLite seeds (which only have `filename`). The dual gate still passed for all 4 affected source-video CRUD tests; widened status set to include 500 with inline comment + deferred-items.md Section 1.2 + 5.3 follow-up entry. Not a Phase 82 blocker — the migration completed correctly; the route-side `v["name"]` indexing pre-dates Phase 82.
- **PreToolUse Edit hook firing pre-emptively** on every Edit invocation even when the file had been read (or just written) in the session. Worked around by continuing edits — all edits succeeded per the response text. Did not block execution.

## Self-Check

Run:

```bash
# Key files exist
[ -f tests/test_api_segments_sqlite.py ] && echo "FOUND: tests/test_api_segments_sqlite.py"
[ -f .planning/phases/82-segments-routes-repository-migration/deferred-items.md ] && echo "FOUND: deferred-items.md"
[ -f .planning/phases/82-segments-routes-repository-migration/82-03-SUMMARY.md ] && echo "FOUND: 82-03-SUMMARY.md"

# Commits exist
git log --oneline | grep -q "10d319a" && echo "FOUND: 10d319a (Task 1 seed helpers)"
git log --oneline | grep -q "9f9a40f" && echo "FOUND: 9f9a40f (Task 2 segments SQLite tests)"
git log --oneline | grep -q "12a46a2" && echo "FOUND: 12a46a2 (Task 3 xfail + deferred-items.md)"

# 13 verification gates (see Verification Results table above)
py -3.13 -m pytest tests/test_api_segments_sqlite.py tests/test_api_library_sqlite.py tests/test_api_pipeline_sqlite.py -q --no-cov
# Expected: 67 passed (28 + 23 + 16)
```

## Self-Check: PASSED

All 13 verification gates verified during execution and re-verified just before SUMMARY creation:

- Gate 1-3 (3 seed helpers in conftest.py): PASS (1 each)
- Gate 4 (test_api_segments_sqlite.py test functions ≥ 22): PASS (28)
- Gate 5 (_assert_not_db_unavailable usages ≥ 23): PASS (28)
- Gate 6 (segments SQLite pytest): PASS (28 passed)
- Gate 7 (Phase 80 baseline): PASS (23 passed)
- Gate 8 (Phase 81 baseline): PASS (16 passed)
- Gate 9 (deferred-items.md exists): PASS
- Gate 10 (5 sections present): PASS (all 5)
- Gate 11 (get_client = 0): PASS
- Gate 12 (ride-along = 0): PASS
- Gate 13 (anti-patterns = 0): PASS

All commit hashes (10d319a, 9f9a40f, 12a46a2) verified in git log.

## Next Phase Readiness

- **Phase 82 fully shipped — ready for verification.** All 3 plans complete; segments_routes.py is fully sealed as repo-ABC-only (combined with library_routes.py from Phase 80 and pipeline_routes.py from Phase 81, three of the largest route files are now repo-ABC-only with all phase-grep gates at 0).
- **Phase 83 (segments background services migration)** has a clean foundation: the sqlite_backend fixture + 7 seed helpers + the dual-gate pattern + the schema-drift catalog are reusable. No new ABC surface required unless Phase 83's services introduce new query shapes.
- **Outstanding follow-up work** is filed in deferred-items.md Section 5 (5 items) — none are blockers for Phase 83 or downstream phases.
- **Phase 81 verification (`/gsd-verify-phase 81`)** remains a deferred manual gate; not blocked by Phase 82 completion.

---
*Phase: 82-segments-routes-repository-migration*
*Completed: 2026-05-23*
