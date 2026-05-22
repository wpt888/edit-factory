---
phase: 81-pipeline-routes-repository-migration
plan: 01
subsystem: database
tags: [sqlite, repository-pattern, pipeline, route-migration, abc-methods]

requires:
  - phase: 80-library-routes-repository-migration
    provides: established Pattern A/B/C/D taxonomy, audit format, 6 Phase-80 ABC methods (count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage, get_source_video), and the multi-chunk migration discipline

provides:
  - 1 new ABC method (`upsert_pipeline`) implemented on both backends
  - ROUTES-AUDIT.md cataloging all 24 get_client() guards + 52 in-body ride-alongs across 6 variable names in pipeline_routes.py
  - 19 Pattern A/B sub-migrations in pipeline_routes.py covering 19 of 24 guards + 25 of 52 ride-alongs
  - W-81-01 disposition: `_increment_segment_usage(supabase_client, segment_ids)` body refactored to delegate to repo, legacy first arg KEPT for caller compatibility
  - T-81-01-01 IDOR mitigation pattern applied at `adopt_library_tts` (the only repo.get_tts_asset site in Plan 81-01)

affects: [81-02-pattern-cd-migration, 81-03-test-rewrite]

tech-stack:
  added: []
  patterns:
    - "upsert_pipeline ABC for _db_save_pipeline column-missing-retry envelope (kept in route)"
    - "QueryFilters(gt={...}, in_={...}, select=...) composition for editai_segments usage_count filter (preview_variant)"
    - "table_query upsert escape hatch for clip_content on_conflict='clip_id' (save_selected_captions) — same pattern Phase 80 used"
    - "Legacy first-arg supabase_client kept on _increment_segment_usage (W-81-01) so Plan 81-02 callers do not need signature changes"

key-files:
  created:
    - .planning/phases/81-pipeline-routes-repository-migration/ROUTES-AUDIT.md
    - .planning/phases/81-pipeline-routes-repository-migration/81-01-SUMMARY.md
    - tests/test_repository_upsert_pipeline.py (Task 2 RED commit, then GREEN)
  modified:
    - app/repositories/base.py (1 new abstract method: upsert_pipeline)
    - app/repositories/supabase_repo.py (1 new method implementation)
    - app/repositories/sqlite_repo.py (1 new method implementation)
    - app/api/pipeline_routes.py (19 sites migrated across 4 chunks; helper W-81-01 refactor)

key-decisions:
  - "Chunked across 4 commits (chunks 1+2+3+4) due to mid-execution executor cutoff — each chunk passes AST + the 6 upsert_pipeline tests"
  - "Sites 18, 19, 24 grouped into chunk 4 alongside the _increment_segment_usage helper refactor — small enough to commit atomically once the migration drives get_client() to its 5-site target"
  - "Site 24 (save_selected_captions) uses table_query upsert (NOT update_clip_content) because update_clip_content is UPDATE-only on both backends — mirrors Phase 80 lesson"
  - "Site 19 (preview_variant) deprioritization filter migrates to QueryFilters(gt={'usage_count': 0}, in_={'source_video_id': ...}) rather than a per-id loop — repo.list_segments supports gt+in_ on both backends"
  - "_increment_segment_usage keeps the legacy supabase_client first argument (W-81-01 definitive) — Plan 81-02 callers will pass None without touching their signatures"

patterns-established:
  - "Whole-function in-body audit (lesson from Phase 80 site #23 gap) — every function with a get_client() guard had its full body grepped for ride-alongs across 6 variable names BEFORE the audit was finalized"
  - "Multi-variable-name grep gate `(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib).(table|rpc)` is Phase 81's expanded second-gate; Plan 81-02 inherits this gate AND adds a third gate `from app.db import get_supabase`"
  - "Chunked commit recovery (chunks 1-4) after long-running executor cutoffs: AST-validate the in-progress file, run the relevant test subset, commit as 'chunk N' with a clear resume marker, annotate the audit/contract with a checkpoint — this iteration applied that pattern across 2 executor handoffs"

requirements-completed: [FUNC-01, FUNC-03]

duration: ~varied across multiple iterations (Tasks 1+2 in iteration 76; Task 3 chunks 1+2 in iteration 76; chunks 3+4 in iteration 77)
completed: 2026-05-23
---

# Phase 81 Plan 01: Pipeline Routes Repository Migration Summary

**19 of 24 Pattern A/B guard sites migrated in pipeline_routes.py + 1 new ABC method (upsert_pipeline) on both backends, driving get_client() count from 24 → 5 (Plan 81-02 residual = exactly the Pattern C/D sites + multi-site fns). Helper `_increment_segment_usage` refactored per W-81-01 (legacy arg kept).**

## Performance

- **Duration:** ~3 iterations (Tasks 1+2 + chunks 1+2 in iteration 76; chunks 3+4 in iteration 77)
- **Completed:** 2026-05-23
- **Tasks:** 3 (all complete)
- **Files modified:** 4 (base.py, supabase_repo.py, sqlite_repo.py, pipeline_routes.py)
- **Files created:** 2 (ROUTES-AUDIT.md, test_repository_upsert_pipeline.py)

## Accomplishments

- **Audit catalog complete (Task 1):** ROUTES-AUDIT.md lists all 24 get_client() guards with VERIFIED enclosing-function attributions (5 originally-misattributed sites corrected: 2024 → `update_source_selection`, 2225 → `update_pipeline_scripts`, 2469 → `rename_pipeline`, 2508 → `approve_tts_variant`, 6094 → `save_selected_captions`). All 52 in-body ride-alongs enumerated across 6 variable names. The `get_pipeline_status` body escape hatch (2 ride-alongs via `from app.db import get_supabase` at lines 4848/4874) explicitly marked IN-SCOPE for Plan 81-02 with a third grep gate.
- **1 new ABC method added (Task 2):** `upsert_pipeline(data)` declared in base.py Section 7 and implemented on both SupabaseRepository (native PostgREST upsert) and SQLiteRepository (existence-check + branch to _update or _insert). 6/6 tests pass in tests/test_repository_upsert_pipeline.py.
- **19 Pattern A/B sub-migrations completed (Task 3):**
  - Sites 1, 2: `_restore_missing_tts_audio_paths`, `_persist_one` → `repo.list_tts_assets`
  - Site 3: `_db_save_pipeline` → new `repo.upsert_pipeline` (3 in-body sites collapsed into 1 method call inside the existing column-missing retry envelope)
  - Site 4: `_db_update_render_jobs` → `repo.update_pipeline`
  - Site 5: `_fetch_preset_and_settings` → `repo.get_export_preset_by_name` (Phase 80 method)
  - Site 7: `_db_load_pipeline` → `repo.get_pipeline`
  - Site 8: `_compute_segment_duration` → `repo.list_segments`
  - Site 9: `list_pipelines` → `repo.list_pipelines`
  - Site 10: `delete_pipeline` → `repo.get_pipeline` + `repo.update_pipeline` (with profile_id ownership check)
  - Site 11: `update_source_selection` → `repo.update_pipeline`
  - Site 12: `update_pipeline_scripts` → `repo.update_pipeline`
  - Site 13: `regenerate_script` → `repo.list_segments` + `repo.get_profile`
  - Site 14: `rename_pipeline` → `repo.update_pipeline`
  - Site 15: `approve_tts_variant` → `repo.update_pipeline`
  - Site 16: `generate_pipeline` → `repo.list_segments` + `repo.get_profile`
  - Site 17: `adopt_library_tts` → `repo.get_tts_asset` (with T-81-01-01 IDOR ownership + status check)
  - Site 18: `generate_variant_tts` dedup subhelper → `repo.list_tts_assets`
  - Site 19: `preview_variant` usage-history filter → `repo.list_segments` with `QueryFilters(gt={"usage_count": 0}, in_={"source_video_id": ...}, select="id")`
  - Site 24: `save_selected_captions` → `repo.table_query("editai_clip_content", "upsert", ..., filters=QueryFilters(on_conflict="clip_id"))`
- **W-81-01 helper refactor:** `_increment_segment_usage(supabase_client, segment_ids)` body now delegates to `get_repository().increment_segment_usage(segment_ids)` (Phase 80 method which handles RPC + fallback internally). Legacy `supabase_client` first arg KEPT per the audit's definitive decision so Plan 81-02 callers do not need to drop the argument.
- **get_client() count: 24 → 5.** The 5 residual sites are exactly the Plan 81-02 contract: site 6 (`_save_clip_to_library`), site 20 (`check_render_skip`), site 21 (`render_variants` subroutine), site 22 (`remake_variant`), site 23 (`sync_pipeline_to_library`).
- **Expanded ride-along gate at 27** = 11 (site 6) + 1 (site 20) + 1 (site 21) + 1 (site 22) + 11 (site 23) + 2 (`get_pipeline_status` body) → exactly Plan 81-02's terminal target.

## Acceptance Gates

| Gate | Required | Actual | Pass |
|------|----------|--------|------|
| ROUTES-AUDIT.md exists with ≥ 24 numbered rows | ≥ 24 | 24 + 2 (get_pipeline_status section) | ✅ |
| `grep -c "def upsert_pipeline" app/repositories/base.py` | ≥ 1 | 1 | ✅ |
| `grep -c "def upsert_pipeline" app/repositories/supabase_repo.py` | ≥ 1 | 1 | ✅ |
| `grep -c "def upsert_pipeline" app/repositories/sqlite_repo.py` | ≥ 1 | 1 | ✅ |
| `python -c "import ast; ast.parse(open('app/api/pipeline_routes.py').read())"` | passes | passes | ✅ |
| `grep -c "get_client()" app/api/pipeline_routes.py` between 4 and 10 (target ~5) | 4 ≤ N ≤ 10 | 5 | ✅ |
| `grep -n "_increment_segment_usage" app/api/pipeline_routes.py` shows W-81-01 signature kept | KEPT legacy arg | `def _increment_segment_usage(supabase_client, segment_ids: list)` body now calls `get_repository().increment_segment_usage(segment_ids)` | ✅ |
| `grep -n "repo.upsert_pipeline" app/api/pipeline_routes.py` ≥ 1 | ≥ 1 | 3 | ✅ |
| `grep -n "repo.update_pipeline\|_repo.update_pipeline" app/api/pipeline_routes.py` ≥ 5 (6 routes) | ≥ 5 | 5 | ✅ |
| `grep -n "repo.get_pipeline" app/api/pipeline_routes.py` ≥ 2 | ≥ 2 | 2 | ✅ |
| `grep -n "repo.list_segments" app/api/pipeline_routes.py` ≥ 3 | ≥ 3 | 4 | ✅ |
| `grep -n "list_tts_assets" app/api/pipeline_routes.py` ≥ 3 | ≥ 3 | 3 | ✅ |
| Sites 6, 20, 21, 22, 23 UNTOUCHED (Plan 81-02 contract) | UNTOUCHED | Verified — all 5 guards still call `get_client()` at lines 1007, 3409, 3932, 4378, 4946; supabase_lib/supabase_chk/_supa_render/_supa/supabase ride-alongs all retained | ✅ |
| `python -m pytest tests/ -q -k "pipeline"` passes OR documented mock-chain breakage | 3 failing tests documented below | 3 known mock-chain breakages | ✅ (documented) |

## Known Test Breakages (Plan 81-03 will xfail/rewrite)

These 3 tests fail under the migrated route because they patched the supabase fluent-chain (`repo.get_client().table().select().eq().execute()`) which is no longer hit:

| Test | File | Reason |
|------|------|--------|
| `test_preview_variant_uses_repository_without_local_shadow` | tests/test_pipeline_preview_route.py | Calls `preview_variant(pipeline_id, variant_index, ctx)` without the `visual_version` body arg added after the test was written — pre-existing baseline failure on this branch (verified by stashing and re-running) |
| `test_subtitle_frame_preview_uses_sample_text_and_fingerprint` | tests/test_pipeline_subtitle_frame_preview.py | Patches the old supabase chain that no longer fires |
| `test_restore_missing_tts_audio_path_from_library` | tests/test_pipeline_tts_restore.py | Patches `repo.get_client().table()...` mock that no longer fires because `_restore_missing_tts_audio_paths` now uses `repo.list_tts_assets` directly |

Other 31 pipeline-related tests pass: full upsert_pipeline suite (6/6), library tests (24/24), and other pipeline tests (1+).

## Task Commits

Each task / sub-task committed atomically:

1. **Task 1 (ROUTES-AUDIT.md)** — `05c6843` (docs: catalog 24 guards + 52 ride-alongs across 6 var names)
2. **Task 2 RED (upsert_pipeline failing tests)** — `4d94ec8` (test)
3. **Task 2 GREEN (upsert_pipeline implementations on both backends)** — `0d81fc9` (feat)
4. **Task 3 chunk 1 (sites 1-4)** — `8febdc8` (refactor)
5. **Task 3 chunk 2 (sites 5, 7-11)** — `1106d51` (refactor)
6. **Mid-execution checkpoint annotation in ROUTES-AUDIT.md** — `651970d` (docs)
7. **Task 3 chunk 3 (sites 12-17)** — `f291f53` (refactor)
8. **Task 3 chunk 4 (sites 18, 19, 24 + W-81-01 helper refactor)** — `99a0cdd` (refactor)

## Hand-off to Plan 81-02

Plan 81-02's contract is the audit's "Pattern C/D + multi-site fns" section. Specifically:

1. **Site 6** (`_save_clip_to_library`, line 1006): 11 in-body ride-alongs on `supabase_lib`. Mix migration: `repo.create_project + repo.get_project_by_name + repo.list_clips + repo.create_clip + repo.update_clip + repo.update_clip_content + repo.increment_segment_usage` per the audit's target-method column.
2. **Site 20** (`check_render_skip`, line 3409): in_(clip_ids) + eq is_deleted=True → either `repo.list_clips_by_profile` with `in_` filter or per-id `repo.get_clip` loop (verify in_ support on SQLite first).
3. **Site 21** (`render_variants` subroutine, line 3932): co-migrates with site 22 because both live inside large `render_variants` async fn.
4. **Site 22** (`remake_variant`, line 4378): segment usage_count → `repo.list_segments` or per-id `repo.get_segment`.
5. **Site 23** (`sync_pipeline_to_library`, line 4946): 11 in-body ride-alongs on `supabase`. Mix migration like site 6.
6. **`get_pipeline_status` body escape hatch (lines 4848, 4874)**: 2 ride-alongs via `from app.db import get_supabase` direct import. Migrate to `repo.list_clips_by_profile` with `in_={"id": clip_ids_to_recover}, eq={"is_deleted": False}` OR per-id `repo.get_clip` loop. Then REMOVE the `from app.db import get_supabase` import at line 4842 (third grep gate).
7. **W-81-01 (already done):** callers in Plan 81-02 sites will pass `_increment_segment_usage(None, used_seg_ids)`.

Terminal gates for Plan 81-02:
- `grep -c "get_client()" app/api/pipeline_routes.py` = 0
- `grep -cE "(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\.(table|rpc)\(" app/api/pipeline_routes.py` = 0
- `grep -c "from app.db import get_supabase" app/api/pipeline_routes.py` = 0
