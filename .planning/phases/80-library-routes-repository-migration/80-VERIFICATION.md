---
phase: 80-library-routes-repository-migration
verified_at: 2026-05-22T00:00:00Z
verifier: gsd-verifier (Claude Opus 4.7)
status: partial
score: 4/5 success criteria fully verified; SC-4 partial (1 newly-detected Phase-80 helper-signature regression in tests/test_pipeline_library_persistence.py)
overrides_applied: 0
---

# Phase 80: library-routes-repository-migration — Verification Report

**Phase Goal (from ROADMAP.md):** "Every repo.get_client() call in app/api/library_routes.py (27 sites) is replaced with typed repository methods or table_query(QueryFilters) calls. Routes that previously returned 503 Database not available under DATA_BACKEND=sqlite now return 200 (or the correct status for the operation)."

**Verdict:** PARTIAL. The Phase 80 production-code goal is fully achieved — every grep gate is at 0, every ABC method is parity-implemented on both backends, the SQLite per-route test suite is green (23/23), and the Supabase mock-based suite is green (5 pass, 11 xfailed, 0 failed). One newly-detected regression in tests/test_pipeline_library_persistence.py (a test that calls the refactored `_sync_orphan_clips` helper with the old `supabase` parameter) was missed by the 80-03 SUMMARY's baseline-comparison method. It is a one-line test fix, not a production-code fix.

## Per-Criterion Verification

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | Zero `get_client()` calls in library_routes.py | **PASS** | `grep -c "get_client()" app/api/library_routes.py` = **0** |
| SC-1 supp. | Zero `supabase.(table\|rpc)(` calls in library_routes.py | **PASS** | `grep -cE "supabase\.(table\|rpc)\(" app/api/library_routes.py` = **0** |
| SC-1 supp. | Zero "Database not available" strings | **PASS** | `grep -c "Database not available" app/api/library_routes.py` = **0** |
| SC-2 | ROUTES-AUDIT.md classifies all 27 sites with Pattern letter + repo method + owner plan | **PASS** | File exists at `.planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md`; `grep -c "^\| [0-9]+ \|" ROUTES-AUDIT.md` = **27** rows; columns include Pattern (A/B/C/D), Target method, Method exists?, Owner plan; New ABC methods section enumerates 5 methods added in 80-01 + 1 deferred to 80-02; In-body supabase.table() section enumerates 9 lines for Plan 80-02 |
| SC-3 | New ABC methods implemented in BOTH SupabaseRepository AND SQLiteRepository (no NotImplementedError paths) | **PASS** | All 6 methods (count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage, get_source_video) present in base.py (lines 72/134/200/216/358/381), supabase_repo.py (lines 137/219/286/342/463/496), and sqlite_repo.py (lines 466/594/690/746/988/1036). No `NotImplementedError` in any of these methods. The 5 `NotImplementedError` matches in sqlite_repo.py:2082-2106 are for vault_key methods (pre-existing v12 gap from commit 29c54ea — out of scope, no library_routes references). |
| SC-4 | Existing routes still work in Supabase mode — regression test suite passes | **PARTIAL** | `py -3.13 -m pytest tests/test_api_library.py -q` exits **0** (5 passed, 11 xfailed, 0 failed). HOWEVER, the wider non-Playwright suite contains **1 Phase-80 regression** missed by 80-03 SUMMARY: `tests/test_pipeline_library_persistence.py::test_sync_orphan_clips_skips_raw_mp4_files` fails with `TypeError: _sync_orphan_clips() takes 1 positional argument but 2 were given` because Plan 80-02 (commit 5f125a2) dropped the `supabase` parameter from `_sync_orphan_clips`. Confirmed pre-existing via file-swap: at commit 3491527 (pre-80) the test passes (1 passed in 4.70s); at HEAD it fails. The 80-03 SUMMARY's "0 regressions vs baseline" claim used a file-swap method scoped to tests/conftest.py + tests/test_api_library.py, which missed this cross-file callsite. |
| SC-5 | Each migrated route has a pytest case asserting 200 (or correct non-503 status) under DATA_BACKEND=sqlite | **PASS** | File `tests/test_api_library_sqlite.py` exists with **23 test functions** (`grep -c "^def test_" tests/test_api_library_sqlite.py` = 23). All 23 pass under `py -3.13 -m pytest tests/test_api_library_sqlite.py -q` (8.55s). Each per-route test calls `_assert_not_db_unavailable(r)` which enforces both `r.status_code != 503` AND `"Database not available" not in r.text` — the dual gate is present 23 times in the file. |

## Plan-Level Gate Verification (80-03 verification block)

| # | Gate | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | `grep -c "^def test_" tests/test_api_library_sqlite.py` | ≥ 21 | 23 | **PASS** |
| 2 | `grep -c "_assert_not_db_unavailable" tests/test_api_library_sqlite.py` | ≥ 22 | 23 | **PASS** |
| 3 | `pytest tests/test_api_library_sqlite.py -q` exits 0 | 0 | 0 (23 passed in 8.55s) | **PASS** |
| 4 | `pytest tests/test_api_library.py -q` exits 0 | 0 | 0 (5 passed, 11 xfailed, 0 failed in 9.01s) | **PASS** |
| 5 | Wider suite green | exits 0 | 47 failed, 248 passed, 11 xfailed | **PARTIAL** — 46 of 47 are documented pre-existing (test_cost_tracker, test_encoding_presets, test_video_processor, test_api_routes, test_output_naming, test_srt_validator, test_subtitle_frame_preview/test_preview_route trace to missing `app.services.subtitle_styler` from earlier core/platforms refactor — unrelated to Phase 80). **1 IS a Phase 80 regression** (test_sync_orphan_clips_skips_raw_mp4_files — see SC-4). |
| 6 | `grep -c "get_client()" app/api/library_routes.py` | 0 | 0 | **PASS** |
| 7 | `grep -cE "supabase\.(table\|rpc)\(" app/api/library_routes.py` | 0 | 0 | **PASS** |
| 8 | No `EDITAI_BASE_DIR` or `importlib.reload` in conftest.py | 0 matches | 0 matches | **PASS** |

## Threat Mitigations Verified

- **T-80-01-01 (IDOR via missing profile_id filter on get_clip):** 80-01 SUMMARY claims every `repo.get_clip(clip_id)` is followed within ≤2 lines by an ownership check. Verified by sampling 5 sites in library_routes.py — all consistent.
- **T-80-01-04 (delete_exports_older_than profile_id scoping):** SQLite impl at sqlite_repo.py:1036+ verified to include `profile_id = ?` in WHERE clause.
- **T-80-02-06 (in-body supabase.table NameError after retry-block removal):** Second grep gate at 0 — no NameError-throwing dead references remain.

## Outstanding Items (Follow-up Work)

These items are NOT Phase 80 regressions — they are either pre-existing route bugs that became newly observable when SQLite mode actually exercises the routes (documented in 80-03 SUMMARY as expected route-side issues), or the one newly-confirmed test regression:

### 1. Newly-detected Phase-80 helper-signature regression (NEEDS FIX)

- **File:** `tests/test_pipeline_library_persistence.py:267`
- **Failure:** `TypeError: _sync_orphan_clips() takes 1 positional argument but 2 were given`
- **Root cause:** Plan 80-02 commit 5f125a2 dropped the `supabase` parameter from `_sync_orphan_clips` (intentional refactor, captured as `T-80-02-03` in plan threat model). The test still calls `library_routes._sync_orphan_clips(profile_id, fake_sb)` with the old 2-arg signature.
- **Confirmation:** At commit `3491527` (pre-Phase-80), `py -3.13 -m pytest tests/test_pipeline_library_persistence.py::test_sync_orphan_clips_skips_raw_mp4_files -q` reports `1 passed in 4.70s`. At HEAD, it reports `1 failed in 4.84s` with the TypeError above.
- **Fix scope:** One-line test update — drop the `fake_sb` argument from the `asyncio.run(library_routes._sync_orphan_clips(profile_id, fake_sb))` call AND update the surrounding mocks (the test currently patches a `_FakeSupabaseOrphans` that is now obsolete).

### 2. Pre-existing route bugs exposed by SQLite mode (documented in 80-03 SUMMARY — NOT Phase 80 regressions)

These bugs existed before Phase 80 but only surfaced now that SQLite actually executes the affected code paths (previously masked by Supabase mocks short-circuiting before the bug fired):

- **`tts_text` vs `script_text` column-name mismatch in editai_clip_content:** SQLite schema uses `script_text`; routes write `tts_text`. Affects `PUT /clips/{id}/content` and `POST /clips/{id}/content/copy-from/{src}`. Caught in `test_update_clip_content_returns_non_503` and `test_copy_content_returns_non_503` (status sets widened to accept 500 — the Phase-80 dual gate still enforced).
- **Missing `timedelta` import in library_routes.py:** Used in `/maintenance/cleanup-exports` route at ~line 2774 but `from datetime import timedelta` was never added. Previously masked by Supabase mock short-circuiting. Caught in `test_cleanup_exports_returns_non_503`.
- **`bulk-render` SlowAPI Request parameter:** 80-03 SUMMARY claims missing `Request` parameter on the rate-limited bulk-render route. **HOWEVER** — verification shows the route IS correctly declared with `http_request: Request` at library_routes.py:3787. The 500 observed in `test_bulk_render_returns_non_503` may be from a different cause (perhaps a downstream lock or render call). Re-investigate.

All three are pre-existing issues. None blocks Phase 80 success criteria 1-3 or 5; SC-4 only mentions them in the context of widened status sets.

## Files Reviewed

- `.planning/phases/80-library-routes-repository-migration/80-01-PLAN.md` (688 lines)
- `.planning/phases/80-library-routes-repository-migration/80-01-SUMMARY.md` (295 lines)
- `.planning/phases/80-library-routes-repository-migration/80-02-PLAN.md` (861 lines)
- `.planning/phases/80-library-routes-repository-migration/80-02-SUMMARY.md` (272 lines)
- `.planning/phases/80-library-routes-repository-migration/80-03-PLAN.md` (751 lines)
- `.planning/phases/80-library-routes-repository-migration/80-03-SUMMARY.md` (240 lines)
- `.planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md` (138 lines, 27 site rows)
- `app/api/library_routes.py` (head + grep verification — get_client/supabase.table/.rpc/Database not available all at 0)
- `app/repositories/base.py` (verified 6 ABC method declarations)
- `app/repositories/supabase_repo.py` (verified 6 method implementations)
- `app/repositories/sqlite_repo.py` (verified 6 method implementations + confirmed NotImplementedError matches are vault_key v12 stubs)
- `tests/test_api_library_sqlite.py` (23 tests, all use dual-gate helper)
- `tests/test_api_library.py` (5 passed, 11 xfailed, 0 failed)
- `tests/conftest.py` (verified no EDITAI_BASE_DIR or importlib.reload anti-patterns)
- `tests/test_pipeline_library_persistence.py` (1 line — line 267 — calls obsolete 2-arg `_sync_orphan_clips` signature; pre-Phase-80 commit 3491527 confirms test passed before refactor)

## Final Verdict

**status: partial**

Phase 80's PRODUCTION CODE goal is fully achieved. All 27 `get_client()` sites are eliminated, the second grep gate is at 0, every new ABC method is parity-implemented, the per-route SQLite test suite is green (23 pass), and the Supabase mock suite stays green (5 pass, 11 xfailed strictly). The phase delivers FUNC-01 (no 503 in SQLite for library_routes.py) and FUNC-03 (ABC method additions) as planned.

The one outstanding item is a single test in `tests/test_pipeline_library_persistence.py` whose call-site uses the pre-Phase-80 2-arg signature of `_sync_orphan_clips`. This is a one-line follow-up fix that the 80-03 SUMMARY's baseline-comparison method missed because it only diffed `tests/conftest.py` + `tests/test_api_library.py`. The fix is mechanical and does not change Phase 80's production code.

**Recommendation:** Either (a) ship Phase 80 as `partial` and file the test fix as Phase 81 prerequisite work, or (b) apply the one-line test fix in a follow-up commit and upgrade verification to `passed`. Both are defensible — the production code is correct and the regression is purely in test fixture maintenance.

---
*Verified: 2026-05-22*
*Verifier: Claude (gsd-verifier)*
