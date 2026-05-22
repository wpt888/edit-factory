# Phase 81 — Pipeline Routes Migration Audit

**Source:** `app/api/pipeline_routes.py` (24 `repo.get_client()` call sites + 52 in-body `<var>.table()/.rpc()` ride-alongs across 6 variable names)
**Pattern taxonomy:** `.planning/v13-desktop-production/ARCHITECTURE.md` §1 (A=chained, B=count/aggregate/upsert, C=complex OR/maybe_single/join/in_, D=RPC/raw SQL)
**Variable names used:** `supabase`, `_sb`, `_supa`, `_supa_render`, `supabase_chk`, `supabase_lib`
**Empirical counts (verified at HEAD b5e2b84):**
- `grep -c "get_client()" app/api/pipeline_routes.py` → 24
- `grep -cE "(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\.(table|rpc)\(" app/api/pipeline_routes.py` → 52
- `grep -c "from app.db import get_supabase" app/api/pipeline_routes.py` → 1 (the `get_pipeline_status` escape hatch — REMOVED by Plan 81-02)

## Per-variable ride-along breakdown (sum = 52)

- `supabase`: 33
- `supabase_lib`: 13 (11 in `_save_clip_to_library` + 2 in `get_pipeline_status` body)
- `_sb`: 2
- `_supa`: 2
- `_supa_render`: 1
- `supabase_chk`: 1

## Site-by-site table (24 get_client() guards)

| # | Line | Function / Route (VERIFIED via def boundaries) | Tables touched | Operations | Pattern | Target method | Method exists? | In-body ride-alongs | Owner plan |
|---|------|-----------------------------------------------|----------------|------------|---------|---------------|----------------|---------------------|------------|
| 1 | 184  | `_restore_missing_tts_audio_paths` (def 133) | editai_tts_assets | select where status=ready, eq profile_id | A | `repo.list_tts_assets(profile_id, QueryFilters(eq={"status":"ready"}, select="id, tts_text, mp3_path, audio_duration, srt_content, tts_timestamps"))` | Y | 1 (line 187 `supabase`) | 81-01 |
| 2 | 638  | `_persist_one` inner helper inside `_promote_temp_audio_paths_to_library` (def 591) | editai_tts_assets | select where profile_id+status+tts_text limit 1 | A | `repo.list_tts_assets(profile_id, QueryFilters(eq={"status":"ready","tts_text":text}, select="id, mp3_path", limit=1))` | Y | 1 (line 640 `_sb`) | 81-01 |
| 3 | 734  | `_db_save_pipeline` (def 720) | editai_pipelines | upsert with column-missing retry | B | new `repo.upsert_pipeline(data)` | N → **ADD in Task 2** | 3 (lines 779, 789, 794 `supabase`) | 81-01 |
| 4 | 811  | `_db_update_render_jobs` (def 807) | editai_pipelines | update render_jobs by id | A | `repo.update_pipeline(pipeline_id, {"render_jobs": ...})` | Y | 1 (line 815 `supabase`) | 81-01 |
| 5 | 830  | `_fetch_preset_and_settings` (def 823) | editai_export_presets | select by preset_name | A | `repo.get_export_preset_by_name(name)` (Phase 80) | Y | 1 (line 845 `supabase`) | 81-01 |
| 6 | 1033 | `_save_clip_to_library` (def 1006) | editai_projects, editai_clips, editai_clip_content | insert/select/update/upsert with column-missing retry | C | mix: `repo.create_project + repo.get_project_by_name + repo.list_clips + repo.create_clip + repo.update_clip + repo.update_clip_content + repo.increment_segment_usage` | mostly Y; helpers retain column-missing retry locally | 11 (lines 1051, 1061, 1068, 1123, 1137, 1164, 1169, 1173, 1194, 1199, 1234 `supabase_lib`) | 81-02 |
| 7 | 1285 | `_db_load_pipeline` (def 1281) | editai_pipelines | select by id | A | `repo.get_pipeline(pipeline_id)` | Y | 1 (line 1288 `supabase`) | 81-01 |
| 8 | 1427 | `_compute_segment_duration` (def 1424) | editai_segments | select duration column for profile | A | `repo.list_segments(profile_id, QueryFilters(select="duration"))` | Y | 1 (line 1431 `supabase`) | 81-01 |
| 9 | 1739 | `list_pipelines` (def 1724) | editai_pipelines | select by profile_id, order_by created_at | A | `repo.list_pipelines(profile_id, QueryFilters(order_by="created_at", order_desc=True, limit=...))` | Y | 1 (line 1741 `supabase`) | 81-01 |
| 10 | 1799 | `delete_pipeline` (def 1787) | editai_pipelines | select + update is_deleted=True | A | `repo.get_pipeline + repo.update_pipeline` | Y | 2 (lines 1801, 1809 `supabase`) | 81-01 |
| 11 | 2024 | **`update_source_selection` (def 1999)** ⚠ CORRECTED | editai_pipelines | update source-selection field by id | A | `repo.update_pipeline(pipeline_id, {...})` | Y | 1 (line 2026 `supabase`) | 81-01 |
| 12 | 2225 | **`update_pipeline_scripts` (def 2151)** ⚠ CORRECTED | editai_pipelines | update scripts by id | A | `repo.update_pipeline(pipeline_id, {"scripts": ...})` | Y | 1 (line 2230 `supabase`) | 81-01 |
| 13 | 2305 | `regenerate_script` (def 2263) | editai_segments, profiles | select keywords+product_group + select ai_instructions | A | `repo.list_segments + repo.get_profile` | Y | 2 (lines 2314, 2347 `supabase`) | 81-01 |
| 14 | 2469 | **`rename_pipeline` (def 2455)** ⚠ CORRECTED | editai_pipelines | update name by id | A | `repo.update_pipeline(pipeline_id, {"name": ...})` | Y | 1 (line 2471 `supabase`) | 81-01 |
| 15 | 2508 | `approve_tts_variant` (def 2485) | editai_pipelines | update tts_previews | A | `repo.update_pipeline(pipeline_id, {"tts_previews": ...})` | Y | 1 (line 2511 `supabase`) | 81-01 |
| 16 | 2610 | `generate_pipeline` (def 2577) | editai_segments, profiles | select keywords+product_group + select ai_instructions | A | `repo.list_segments + repo.get_profile` | Y | 2 (lines 2619, 2669 `supabase`) | 81-01 |
| 17 | 2821 | `adopt_library_tts` (def 2793) | editai_tts_assets | select by id (asset_id) | A | `repo.get_tts_asset(asset_id)` | Y | 1 (line 2826 `supabase`) | 81-01 |
| 18 | 3071 | `generate_variant_tts` subhelper (inside def 2887) | editai_tts_assets | select by tts_text + profile + status | A | `repo.list_tts_assets(profile_id, QueryFilters(eq={"status":"ready","tts_text":text}, limit=1))` | Y | 1 (line 3073 `_sb`) | 81-01 |
| 19 | 3336 | `preview_variant` subroutine (inside def 3185) | editai_segments | select usage_count | A | `repo.list_segments` (with in_={"id": ...}) OR loop `repo.get_segment` per id | Y | 1 (line 3338 `_supa`) | 81-01 |
| 20 | 3481 | `check_render_skip` (def 3461) | editai_clips | select id in_(clip_ids) eq is_deleted=True | C | `repo.list_clips_by_profile(profile_id, QueryFilters(in_={"id": clip_ids}, eq={"is_deleted": True}, select="id"))` — OR loop `repo.get_clip` per id | partial | 1 (line 3490 `supabase_chk`) | 81-02 |
| 21 | 4004 | `render_variants` subroutine (inside def 3629) | editai_segments | select usage_count for segment_ids | A | `repo.list_segments` OR `repo.get_segment` per id | Y | 1 (line 4006 `_supa_render`) | 81-02 (lives inside large `render_variants` async fn; co-migrating with #22 keeps the whole render path coherent) |
| 22 | 4450 | `remake_variant` subroutine (inside def 4367) | editai_segments | select usage_count | A | `repo.list_segments` OR `repo.get_segment` | Y | 1 (line 4452 `_supa`) | 81-02 |
| 23 | 5018 | `sync_pipeline_to_library` (def 4998) | editai_projects, editai_clips, editai_clip_content | mix of select-by-name, insert-or-fetch, list, update, upsert, count | C | mix: `repo.get_project_by_name + repo.create_project + repo.list_clips + repo.update_clip + repo.create_clip + repo.update_clip_content + repo.count_clips + repo.update_project` | mostly Y | 11 (lines 5087, 5096, 5106, 5119, 5128, 5203, 5230, 5236, 5275, 5307, 5312 `supabase`) | 81-02 |
| 24 | 6094 | **`save_selected_captions` (def 6048)** ⚠ CORRECTED | editai_clip_content | upsert caption + on_conflict | A | `repo.table_query("editai_clip_content", "upsert", data=..., filters=QueryFilters(on_conflict="clip_id"))` — `update_clip_content` is UPDATE-only on both backends, so use the `table_query` escape hatch | Y (via table_query) | 2 (lines 6117, 6139 `supabase`) | 81-01 |

## Function attribution corrections (verified by reading def boundaries)

The original audit-time draft of this plan had 5 site/function mismatches. The verified attributions at HEAD b5e2b84 are:

| Line | Originally claimed | Verified correct |
|------|--------------------|------------------|
| 2024 | `update_pipeline_scripts` | `update_source_selection` (def 1999, next def 2057) |
| 2225 | `regenerate_script first guard` | `update_pipeline_scripts` (def 2151, next def 2263) |
| 2469 | `approve_tts_variant` | `rename_pipeline` (def 2455, next def 2485) |
| 2508 | `approve_tts_variant 2nd guard` | `approve_tts_variant` (def 2485, next def 2521) — the 2nd-guard framing is correct |
| 6094 | `generate_video_captions OR save_selected_captions` | `save_selected_captions` (def 6048, next def 6152) |

## Additional in-body site (NOT a get_client() guard, but DOES hit the expanded grep gate)

| Line | Function (verified) | Variable | Operations | Disposition |
|------|---------------------|----------|------------|-------------|
| 4848 | `get_pipeline_status` (def 4726) recovery block | `supabase_lib` (constructed via `from app.db import get_supabase()` at line 4842) | select editai_clips by project_id + variant_index + is_(visual_version, null) | Owner: **81-02** |
| 4874 | `get_pipeline_status` (def 4726) recovery block | `supabase_lib` | select editai_clips by project_id + variant_index + visual_version | Owner: **81-02** |

Plan 81-02 MUST:
1. Migrate both ride-alongs to `repo.list_clips_by_profile(profile.profile_id, QueryFilters(in_={"id": clip_ids_to_recover}, eq={"is_deleted": False}, select="id, variant_index, visual_version"))` OR a per-id `repo.get_clip` loop (mirror Plan 81-02 Task 1.A Option B disposition).
2. Remove the `from app.db import get_supabase` import at line 4842.
3. Remove the `supabase_lib = get_supabase()` construction at line 4843.
4. Add a third grep gate to terminal verification: `grep -c "from app.db import get_supabase" app/api/pipeline_routes.py` must return `0`.

## Helpers with supabase parameter (W-81-01 DEFINITIVE DECISION)

These helpers TAKE a supabase client as parameter. Plan 81-01 refactors the body to use `repo` internally:

- `_increment_segment_usage(supabase_client, segment_ids)` at line 47 — Plan 81-01 **KEEPS** the `supabase_client` parameter for backwards compatibility but ignores its value. All callers pass `None` (or a value that will be ignored). The body delegates to `repo.increment_segment_usage(segment_ids)` (Phase 80 method).

This decision is **definitive** — Plan 81-02 does NOT need to choose between two signature options. Plan 81-02 callers will use exactly: `_increment_segment_usage(None, used_seg_ids)`. This mirrors Phase 80's analogous helper disposition (kept the legacy `supabase_client` arg for backward compat).

## Expanded second grep gate (MANDATORY in Plan 81-02)

```bash
grep -cE "(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\.(table|rpc)\(" app/api/pipeline_routes.py
```

Must return 0 at end of Plan 81-02. The bare `supabase\.(table|rpc)\(` gate alone is INSUFFICIENT because Phase 81 has 6 variable names.

## Third grep gate (NEW for Phase 81 — MANDATORY in Plan 81-02)

```bash
grep -c "from app.db import get_supabase" app/api/pipeline_routes.py
```

Must return 0 at end of Plan 81-02 (closes the `get_pipeline_status` direct-import escape hatch).

## Summary

| Pattern | Count | Owner |
|---------|-------|-------|
| A (simple chained) | 18 (sites 1, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24) | mostly 81-01; sites 21/22 in 81-02 because they live inside `render_variants`/`remake_variant` large fns |
| B (count/aggregate/upsert) | 1 (site 3: `_db_save_pipeline` upsert) | 81-01 (uses new `upsert_pipeline`) |
| C (complex OR/maybe_single/in_/join) | 3 (sites 6, 20, 23) | 81-02 |
| D (RPC/raw SQL) | 0 in get_client() sites; the `_increment_segment_usage` helper already delegates to `repo.increment_segment_usage` (Phase 80 RPC method) — no new RPC sites in pipeline_routes.py | 81-01 (refactor helper) |

| Plan | Guards | In-body ride-alongs | Total migrations |
|------|--------|---------------------|------------------|
| 81-01 | 19 sites (1-5, 7-19, 24) | 25 ride-alongs | 19 + 25 |
| 81-02 | 5 sites (6, 20, 21, 22, 23) + 0 `get_client` in get_pipeline_status | 27 ride-alongs (11+1+1+1+11+2 — including 2 in get_pipeline_status) | 5 guards + 27 |
| **TOTAL** | **24** | **52** | matches empirical grep ✓ |

### Plan 81-01 ride-along breakdown (sum = 25)

site 1: 1, site 2: 1, site 3: 3, site 4: 1, site 5: 1, site 7: 1, site 8: 1, site 9: 1, site 10: 2, site 11: 1, site 12: 1, site 13: 2, site 14: 1, site 15: 1, site 16: 2, site 17: 1, site 18: 1, site 19: 1, site 24: 2 = **25** ✓

### Plan 81-02 ride-along breakdown (sum = 27)

site 6: 11, site 20: 1, site 21: 1, site 22: 1, site 23: 11, get_pipeline_status body: 2 = **27** ✓

## New ABC methods required (additions in this plan)

| Method | Signature | Rationale | Implemented in |
|--------|-----------|-----------|----------------|
| `upsert_pipeline` | `upsert_pipeline(self, data: Dict[str, Any]) -> Dict[str, Any]` | line 779 `supabase.table("editai_pipelines").upsert(row).execute()` with column-missing retry. SQLite: existence-check + `_update` else `_insert`. Supabase: `client.table(...).upsert(data).execute()`. | both backends |

No additional new ABC methods identified by the audit. The Phase 80 method `update_clip_content` is UPDATE-only on both backends, so for site #24 (`save_selected_captions`) the migration uses `table_query` with `on_conflict="clip_id"` (escape hatch) rather than adding an `upsert_clip_content` method — same pattern Phase 80 80-01 used for the analogous clip_content upserts.

## Lesson from Phase 80 — explicit countermeasures applied here

1. **Whole-function body audit** (countermeasure for Phase 80 site #23 gap): every function with a get_client() guard had its FULL body grepped during this audit; ride-alongs enumerated with line numbers in the table above.
2. **Multi-variable-name grep gate** (countermeasure for renamed-variable in-body sites): the second gate covers 6 variable names, not just `supabase`.
3. **Multi-site functions belong to a single plan** (countermeasure for half-migrated functions): `_save_clip_to_library`, `sync_pipeline_to_library`, and the `get_pipeline_status` recovery block belong entirely to Plan 81-02. `_db_save_pipeline` (3 ride-alongs) belongs entirely to Plan 81-01.
4. **Function attribution verified** (countermeasure for line-number drift between audit-time draft and implementation-time file): the 5 originally-misattributed sites (2024, 2225, 2469, 2508, 6094) have been corrected against actual def boundaries; the executor still re-derives every attribution at audit time.
5. **Direct-import escape hatch closed** (countermeasure for `from app.db import get_supabase` bypass of get_client()): a third grep gate is added to Plan 81-02's terminal verification.

## Residual `get_client()` count after Plan 81-01

Target: **5** (sites 6, 20, 21, 22, 23) — within the [4, 10] acceptance gate.

---

## Plan 81-01 — Mid-Execution Checkpoint (2026-05-23)

**Reason for checkpoint:** Previous executor agent dispatched 2026-05-23, ran ~27 minutes, was cut off at the boundary between site #11 and site #12 due to runtime interruption. Orchestrator committed chunk 2 (sites 5,7-11) as commit `1106d51` and writes this checkpoint so the resume agent has unambiguous state.

### Migration progress as of commit `1106d51`

| Site | Function | Status | Commit |
|------|----------|--------|--------|
| 1 | `_restore_missing_tts_audio_paths` | ✅ migrated | 8febdc8 (chunk 1) |
| 2 | `_persist_one` inner helper | ✅ migrated | 8febdc8 (chunk 1) |
| 3 | `_db_save_pipeline` (used new `upsert_pipeline` ABC) | ✅ migrated | 8febdc8 (chunk 1) |
| 4 | `_db_update_render_jobs` | ✅ migrated | 8febdc8 (chunk 1) |
| 5 | `_fetch_preset_and_settings` | ✅ migrated | 1106d51 (chunk 2) |
| 7 | `_db_load_pipeline` | ✅ migrated | 1106d51 (chunk 2) |
| 8 | `_compute_segment_duration` | ✅ migrated | 1106d51 (chunk 2) |
| 9 | `list_pipelines` | ✅ migrated | 1106d51 (chunk 2) |
| 10 | `delete_pipeline` | ✅ migrated | 1106d51 (chunk 2) |
| 11 | `update_source_selection` | ✅ migrated | 1106d51 (chunk 2) |
| 12 | `update_pipeline_scripts` | ⏳ remaining | — |
| 13 | `regenerate_script` | ⏳ remaining | — |
| 14 | `rename_pipeline` | ⏳ remaining | — |
| 15 | `approve_tts_variant` | ⏳ remaining | — |
| 16 | `generate_pipeline` | ⏳ remaining | — |
| 17 | `adopt_library_tts` | ⏳ remaining | — |
| 18 | `generate_variant_tts` subhelper | ⏳ remaining | — |
| 19 | `preview_variant` subroutine | ⏳ remaining | — |
| 24 | `save_selected_captions` | ⏳ remaining | — |
| 6 | `_save_clip_to_library` | (Plan 81-02 owns) | — |
| 20 | `check_render_skip` | (Plan 81-02 owns) | — |
| 21 | `render_variants` subroutine | (Plan 81-02 owns) | — |
| 22 | `remake_variant` subroutine | (Plan 81-02 owns) | — |
| 23 | `sync_pipeline_to_library` | (Plan 81-02 owns) | — |

**Empirical residual at `1106d51`:** `grep -c "get_client()" app/api/pipeline_routes.py` = **14** (= 9 remaining 81-01 sites + 5 Plan-81-02 sites).

**Resume contract for the next executor:** Continue Task 3 of Plan 81-01 starting at site #12 (`update_pipeline_scripts` at line 2225). Use the per-site target methods in the site-by-site table above. After site #24 is migrated, residual must be exactly **5** (sites 6, 20, 21, 22, 23). Then create 81-01-SUMMARY.md and update STATE.md + ROADMAP.md.

### Task completion status

- ✅ Task 1 (Audit) — `05c6843` — ROUTES-AUDIT.md created and verified
- ✅ Task 2 (ABC methods TDD red/green) — `4d94ec8`, `0d81fc9` — `upsert_pipeline` added to base.py, supabase_repo.py, sqlite_repo.py; 6/6 tests pass in `tests/test_repository_upsert_pipeline.py`
- ⏳ Task 3 (Pattern A/B migration) — 11 of 19 sites done (chunks 1+2); 8 remaining sites (12-19,24) + final SUMMARY/STATE/ROADMAP wrap-up
