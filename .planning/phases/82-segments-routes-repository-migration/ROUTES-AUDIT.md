# Phase 82 ROUTES-AUDIT: app/api/segments_routes.py

**Canonical migration contract for Phase 82.** Mirrors `.planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md` and `.planning/phases/81-pipeline-routes-repository-migration/ROUTES-AUDIT.md` format.

## Section 1 — Header

- **Source file:** `app/api/segments_routes.py` (2819 lines)
- **Pattern taxonomy reference:** `.planning/v13-desktop-production/ARCHITECTURE.md` §1
- **Plan-checker classification rule:** A = single repo method or simple chain; B = 2 ride-alongs / count / aggregate; C = ≥ 3 ride-alongs OR helper-with-supabase-arg call OR composed nested-join / in_+eq batch / cascading multi-table mutation; D = RPC/raw SQL (not present in this file).

**Empirical counts at HEAD (verify command, must reproduce identically):**

```bash
py -3.13 -c "import re; c=open('app/api/segments_routes.py',encoding='utf-8').read(); \
    print('get_client:', len(re.findall(r'get_client\\(\\)', c))); \
    print('ride-along (6 vars):', len(re.findall(r'(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\\.(table|rpc)\\(', c))); \
    print('from app.db import get_supabase:', len(re.findall(r'from app\\.db import get_supabase', c)))"
```

| Gate | Count at HEAD |
|------|---------------|
| `get_client()` | **37** |
| 6-variable ride-along `(supabase\|_sb\|_supa\|_supa_render\|supabase_chk\|supabase_lib)\.(table\|rpc)\(` | **76** |
| `from app.db import get_supabase` | **0** |

Phase 82 success criterion targets (driven by Plans 82-01 + 82-02):
- Plan 82-01 residual: `get_client()` ∈ [13, 19] (target ≈ 15)
- Plan 82-02 terminal: all three gates = 0

## Section 2 — Per-variable ride-along breakdown

| Variable | Count | Notes |
|----------|-------|-------|
| `supabase` | 76 | All ride-alongs use this single name |
| `_sb` | 0 | Not used in this file |
| `_supa` | 0 | Not used in this file |
| `_supa_render` | 0 | Not used in this file |
| `supabase_chk` | 0 | Not used in this file |
| `supabase_lib` | 0 | Not used in this file |
| **Sum** | **76** | Matches 6-variable regex empirical count |

Phase 82 retains the 6-variable regex gate from Phase 81 for forward consistency even though only `supabase` is in use, so executor / 82-02 / 82-03 don't have to remember a different gate per phase.

## Section 3 — Site-by-site table (37 rows)

Body range was computed by AST-style def-boundary detection. Ride-along counts and helper-call counts (positional `_assign_product_group` / `_reassign_all_segments` with `supabase` as one of the args) were both grep'd inside each body. Pattern letter follows the classification rule from Section 1.

Plan 82-02 owns Pattern C and any A/B function exceeding the chunk-2/3 safeguard threshold or where the migration recipe requires multi-route helper coupling (cascading product-group reassign).

| # | Line | Function / Route (def-boundary verified) | Body range | Tables touched | Operations | Pattern | Target method(s) | Method exists? | In-body ride-alongs | Helper-w-supabase calls | Owner plan |
|---|------|------------------------------------------|------------|----------------|------------|---------|------------------|----------------|---------------------|-------------------------|------------|
| 1 | 305 | `_generate_preview_proxy_background` (BG task) | L300-L327 | editai_source_videos | update | B | repo.update_source_video | Y | 2 | 0 | **82-02** (BG task / cascading update with proxy_path) |
| 2 | 491 | `_process_source_video_background` (BG task) | L481-L569 | editai_source_videos | update (2x) | B | repo.update_source_video | Y | 2 | 0 | **82-02** (BG task / dual update) |
| 3 | 729 | `add_local_source_video` (POST /source-videos/local) | L715-L796 | editai_source_videos | insert | A | repo.create_source_video | Y | 1 | 0 | **82-02** (insert path; co-migrate with upload_source_video) |
| 4 | 811 | `_process_local_video_background` (BG task) | L797-L851 | editai_source_videos | update (2x) | B | repo.update_source_video | Y | 2 | 0 | **82-02** (BG task) |
| 5 | 869 | `upload_source_video` (POST /source-videos) | L852-L949 | editai_source_videos | insert | A | repo.create_source_video | Y | 1 | 0 | **82-02** (insert path) |
| 6 | 959 | `list_source_videos` (GET /source-videos) | L950-L976 | editai_source_videos | select all (profile) | A | repo.list_source_videos | Y | 1 | 0 | **82-01** |
| 7 | 985 | `get_source_video` (GET /source-videos/{id}) | L977-L1002 | editai_source_videos | select by id+profile | A | repo.get_source_video + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 8 | 1012 | `update_source_video` (PATCH /source-videos/{id}) | L1003-L1035 | editai_source_videos | update by id+profile | A | repo.get_source_video + repo.update_source_video | Y | 1 | 0 | **82-01** |
| 9 | 1045 | `delete_source_video` (DELETE /source-videos/{id}) | L1036-L1094 | editai_source_videos, editai_segments | select+select+delete (3 ops, all cleanly map to existing methods) | C-mapped-to-A/B | repo.get_source_video + repo.list_segments + repo.delete_source_video | Y | 3 | 0 | **82-01** (explicit migration recipe per plan; 3 ride-alongs all map cleanly to existing repo methods, no helper call) |
| 10 | 1105 | `stream_source_video` (GET /source-videos/{id}/stream) | L1095-L1127 | editai_source_videos | select by id+profile | A | repo.get_source_video + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 11 | 1139 | `preview_stream_source_video` (GET /source-videos/{id}/preview-stream) | L1128-L1192 | editai_source_videos | select + conditional update | B | repo.get_source_video + repo.update_source_video + T-82-01-01 | Y | 2 | 0 | **82-01** |
| 12 | 1279 | `get_source_video_waveform` (GET /source-videos/{id}/waveform) | L1268-L1309 | editai_source_videos | select by id+profile | A | repo.get_source_video + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 13 | 1322 | `get_source_video_voice_detection` (GET /source-videos/{id}/voice-detection) | L1310-L1353 | editai_source_videos | select by id+profile | A | repo.get_source_video + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 14 | 1378 | `create_segment` (POST /source-videos/{id}/segments) | L1368-L1463 | editai_source_videos, editai_segments, editai_product_groups (via helper) | select + insert + update + helper call (`_assign_product_group(supabase,...)` at L1426) | C | repo.get_source_video + repo.create_segment + repo.update_segment + refactored helper | Y | 3 | 1 (`_assign_product_group(supabase,...)`) | **82-02** (helper-with-supabase-arg dep — refactor helper as a unit in 82-02) |
| 15 | 1474 | `list_video_segments` (GET /source-videos/{id}/segments) | L1464-L1509 | editai_segments + nested join editai_source_videos(name) | select with nested join | A (nested-join handled in Python composition) | repo.list_segments + per-row repo.get_source_video composition | Y | 1 | 0 | **82-01** |
| 16 | 1524 | `list_all_segments` (GET /) | L1510-L1580 | editai_segments + nested join editai_source_videos(name) | select with optional filters + nested join | A | repo.list_segments + per-row repo.get_source_video composition | Y | 1 | 0 | **82-01** |
| 17 | 1592 | `reset_segment_usage` (POST /reset-usage) | L1581-L1615 | editai_segments | bulk update where profile_id + optional source_video_id + usage_count > 0 | A | repo.table_query("editai_segments", "update", data, filters=QueryFilters(eq=..., gt=...)) | Y (escape hatch) | 1 | 0 | **82-01** |
| 18 | 1629 | `list_product_groups_bulk` (GET /product-groups-bulk) | L1616-L1679 | editai_product_groups, editai_segments | in_+eq select + count select | B | repo.list_product_groups with QueryFilters(in_={"source_video_id":...}) + composition for seg counts | Y | 2 | 0 | **82-01** (schema-drift note: SQLite editai_product_groups lacks `source_video_id` — returns 500 in SQLite mode, ACCEPTED per Phase 80/81 precedent) |
| 19 | 1688 | `get_segment` (GET /{segment_id}) | L1680-L1721 | editai_segments + nested join editai_source_videos(name) | select by id+profile | A | repo.get_segment + repo.get_source_video composition + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 20 | 1731 | `update_segment` (PATCH /{segment_id}) | L1722-L1807 | editai_segments, editai_source_videos, editai_product_groups (via helper) | select + select + update + helper call (`_assign_product_group(supabase,...)` at L1788) + conditional update | C | repo.get_segment + repo.update_segment + refactored helper | Y | 4 | 1 | **82-02** (Pattern C: 4 ride-alongs + helper-with-supabase-arg call) |
| 21 | 1817 | `delete_segment` (DELETE /{segment_id}) | L1808-L1851 | editai_segments | select by id+profile + delete by id+profile | B | repo.get_segment + repo.delete_segment + T-82-01-01 | Y | 2 | 0 | **82-01** |
| 22 | 1860 | `toggle_favorite` (POST /{segment_id}/favorite) | L1852-L1886 | editai_segments | select is_favorite + update | B | repo.get_segment + repo.update_segment + T-82-01-01 | Y | 2 | 0 | **82-01** |
| 23 | 1895 | `toggle_single_use` (POST /{segment_id}/single-use) | L1887-L1920 | editai_segments | select single_use + update | B | repo.get_segment + repo.update_segment + T-82-01-01 | Y | 2 | 0 | **82-01** |
| 24 | 1930 | `update_segment_transforms` (PUT /{segment_id}/transforms) | L1921-L1948 | editai_segments | update by id+profile | A | repo.get_segment + repo.update_segment + T-82-01-01 (read-then-write for ownership) | Y | 1 | 0 | **82-01** |
| 25 | 1957 | `bulk_update_transforms` (PUT /bulk-transforms) | L1949-L2009 | editai_segments | in_+eq select + per-id update OR in_+eq update | C-mapped-to-A/B | repo.list_segments(QueryFilters(in_={"id":...})) + per-id repo.get_segment + repo.update_segment (per-id loop pattern, T-82-01-02) | Y | 3 | 0 | **82-01** (explicit per-id loop migration recipe per plan; 3 ride-alongs map cleanly; no helper call) |
| 26 | 2020 | `update_project_segment_transforms` (PUT /projects/{id}/segments/{id}/transforms) | L2010-L2046 | editai_projects, editai_project_segments | select project + update project_segment | B | repo.get_project + repo.update_project_segment + T-82-01-01 (project) | Y | 2 | 0 | **82-01** |
| 27 | 2057 | `extract_segment` (POST /{segment_id}/extract) | L2047-L2112 | editai_segments + nested join editai_source_videos(file_path) | select + bg update | B | repo.get_segment + repo.get_source_video + bg repo.update_segment | Y | 2 | 0 | **82-02** (extract with usage_count + cascade — co-migrate with create_segment for helper boundary) |
| 28 | 2121 | `stream_segment` (GET /{segment_id}/stream) | L2113-L2153 | editai_segments + nested join editai_source_videos(file_path) | select by id+profile with join | A | repo.get_segment + repo.get_source_video composition + T-82-01-01 | Y | 1 | 0 | **82-01** |
| 29 | 2163 | `create_product_group` (POST /source-videos/{id}/product-groups) | L2154-L2226 | editai_source_videos, editai_product_groups, editai_segments | select video + conditional color select + insert + helper call (`_reassign_all_segments(supabase,...)` at L2204) + count | C | repo.get_source_video + repo.create_product_group + refactored helper + count via table_query | Y | 4 | 1 | **82-02** (helper-with-supabase-arg dep) |
| 30 | 2235 | `list_product_groups` (GET /source-videos/{id}/product-groups) | L2227-L2269 | editai_product_groups, editai_segments | select by source_video_id+profile + per-group count select | B | repo.list_product_groups + per-group count via repo.table_query | Y | 2 | 0 | **82-01** (schema-drift: SQLite returns 500, ACCEPTED per precedent) |
| 31 | 2279 | `update_product_group` (PATCH /product-groups/{group_id}) | L2270-L2374 | editai_product_groups, editai_source_videos, editai_segments | select + update + conditional segment cascade + helper call (`_reassign_all_segments(supabase,...)` at L2352) + count | C | NEW repo.get_product_group + NEW repo.update_product_group + repo.list_segments + repo.update_segment + refactored helper | Y (after Task 2) | 6 | 1 | **82-02** (Pattern C: 6 ride-alongs + helper-with-supabase-arg call + cascade) |
| 32 | 2383 | `delete_product_group` (DELETE /product-groups/{group_id}) | L2375-L2426 | editai_product_groups, editai_segments | select + cascade segment unassign + delete + helper call (`_reassign_all_segments(supabase,...)` at L2421) | C | NEW repo.get_product_group + repo.list_segments + repo.update_segment + repo.delete_product_group + refactored helper | Y (after Task 2) | 4 | 1 | **82-02** (Pattern C: 4 ride-alongs + helper-with-supabase-arg call) |
| 33 | 2435 | `reassign_product_groups` (POST /source-videos/{id}/product-groups/reassign) | L2427-L2455 | editai_source_videos, editai_product_groups, editai_segments (via helper) | select video + helper call (`_reassign_all_segments(supabase,...)` at L2448) | C | repo.get_source_video + refactored helper | Y (after helper refactor) | 1 | 1 | **82-02** (helper-with-supabase-arg dep) |
| 34 | 2464 | `match_segments_to_srt` (POST /match-srt) | L2456-L2509 | editai_segments | select all with keywords (profile-scoped) | A | repo.list_segments(profile_id, QueryFilters(select="id, keywords")) | Y | 1 | 0 | **82-02** (keyword scan body — co-migrate with the keyword-storage refactor decision in 82-02; can stay in 82-01 if no schema drift but the SQLite drift makes the keywords column missing) |
| 35 | 2563 | `assign_segments_to_project` (POST /projects/{id}/assign) | L2553-L2614 | editai_projects, editai_project_segments, editai_segments | select project + in_+eq batch ownership + delete + per-id insert | C | repo.get_project + repo.list_segments(QueryFilters(in_+select)) + repo.delete_project_segments + per-id repo.create_project_segment | Y | 4 | 0 | **82-02** (Pattern C: in_+eq batch ownership + cascade delete + bulk insert) |
| 36 | 2623 | `get_project_segments` (GET /projects/{id}/segments) | L2615-L2672 | editai_projects, editai_project_segments + nested editai_segments + nested editai_source_videos | select project + select with nested join | C | repo.get_project + repo.list_project_segments + per-row repo.get_segment + repo.get_source_video composition | Y | 2 | 0 | **82-02** (Pattern C: nested-join via composition — Phase 80 80-02 lesson) |
| 37 | 2682 | `extract_segment_frames` (GET /{segment_id}/frames) | L2673-L2753 | editai_segments, editai_source_videos | select segment + select source video | B | repo.get_segment + repo.get_source_video + T-82-01-01 | Y | 2 | 0 | **82-01** |

### Owner plan summary

| Plan | Sites | Lines |
|------|-------|-------|
| **82-01** | 22 | 959, 985, 1012, 1045, 1105, 1139, 1279, 1322, 1474, 1524, 1592, 1629, 1688, 1817, 1860, 1895, 1930, 1957, 2020, 2121, 2235, 2682 |
| **82-02** | 15 | 305, 491, 729, 811, 869, 1378, 1731, 2057, 2163, 2279, 2383, 2435, 2464, 2563, 2623 |
| **TOTAL** | 37 | (matches HEAD empirical count) |

Residual after 82-01: 37 − 22 = **15** (within the [13, 19] acceptance band).

## Section 4 — Helpers with supabase parameter

Empirical caller counts (verified via `grep -n "_assign_product_group\\(\\|_reassign_all_segments\\(" app/api/segments_routes.py` + manual filter to exclude `def` lines):

### `_assign_product_group(supabase, video_id, profile_id, seg_start, seg_end)` (defined at L408)

**3 callers:**

| Line | Caller function | Caller's owner plan | Notes |
|------|-----------------|---------------------|-------|
| L458 | `_reassign_all_segments` (recursive — internal to the other helper) | 82-02 (with helper refactor) | Internal recursion site |
| L1426 | `create_segment` (POST /source-videos/{id}/segments) | 82-02 | Via `asyncio.to_thread` |
| L1788 | `update_segment` (PATCH /{segment_id}) | 82-02 | Via `asyncio.to_thread` |

### `_reassign_all_segments(supabase, video_id, profile_id)` (defined at L447)

**4 callers:**

| Line | Caller function | Caller's owner plan | Notes |
|------|-----------------|---------------------|-------|
| L2204 | `create_product_group` (POST /source-videos/{id}/product-groups) | 82-02 | Via `asyncio.to_thread` |
| L2352 | `update_product_group` (PATCH /product-groups/{group_id}) | 82-02 | Via `asyncio.to_thread` |
| L2421 | `delete_product_group` (DELETE /product-groups/{group_id}) | 82-02 | Via `asyncio.to_thread` |
| L2448 | `reassign_product_groups` (POST /source-videos/{id}/product-groups/reassign) | 82-02 | Via `asyncio.to_thread` |

### Disposition for Plan 82-02

Per Phase 80 80-02 precedent + Phase 81 W-81-01 lesson:

**Refactor body to use `get_repository()` internally and drop the `supabase` first argument entirely.**

`_reassign_all_segments` has 4 callers, which exceeds the Phase 80 80-02 "≤ 3 callers prefer dropping" preference. Re-justification:
- The helper itself uses `get_repository()` internally after the refactor — there is no second source-of-truth to maintain.
- ALL 4 call sites are in routes owned by Plan 82-02, so they are updated in the same atomic chunk as the helper refactor — no orphan caller risk.
- Alternative (keep the `supabase` param) would leave a stale dependency on `repo.get_client()` indefinitely.

Plan 82-02 owns this refactor along with all corresponding routes. The 4 caller sites and the helper become a single migration unit.

## Section 5 — New ABC methods required (Phase 82 additions)

| Method | Signature | Rationale | Implemented in |
|--------|-----------|-----------|----------------|
| `update_product_group` | `update_product_group(self, group_id: str, data: Dict[str, Any]) -> Dict[str, Any]` | Line 2325 `supabase.table("editai_product_groups").update(...).eq("id", group_id).eq("profile_id", X).execute()`. The PostgREST chain returns the updated row; the ABC method takes ownership-check responsibility OUT of the query (ownership done via `get_product_group + Python check`). | both backends — Task 2 |
| `get_product_group` | `get_product_group(self, group_id: str) -> Optional[Dict[str, Any]]` | Lines 2297, 2388 select-by-id for ownership checks before update/delete. Mirrors `get_clip` / `get_segment` / `get_source_video` pattern. | both backends — Task 2 |

**No other new ABC methods are required.** Composition patterns (Phase 80 80-02 lesson) handle:
- `get_project_segments` nested-join → `repo.list_project_segments + per-row repo.get_segment + repo.get_source_video` composition (all 3 methods exist)
- `assign_segments_to_project` ownership batch → `repo.list_segments(profile_id, QueryFilters(in_={"id": segment_ids}, select="id"))` (in_ + eq via filters)
- `list_video_segments` / `list_all_segments` / `get_segment` nested-join → `repo.list_segments` + per-row `repo.get_source_video` composition

## Section 6 — Pattern Taxonomy Summary

| Pattern | Count | Sites |
|---------|-------|-------|
| **A** (single ride-along: get/update/delete by id + ownership eq, no helper) | 14 | 729, 869, 959, 985, 1012, 1105, 1279, 1322, 1474, 1524, 1592, 1688, 1930, 2121, 2464 |
| **B** (2 ride-alongs: count / aggregate / insert + select) | 13 | 305, 491, 811, 1139, 1629, 1817, 1860, 1895, 2020, 2057, 2235, 2623, 2682 |
| **C** (≥ 3 ride-alongs OR helper-with-supabase-arg OR composed nested-join / in_+eq batch / cascading multi-table mutation) | 10 | 1045 (3 rides, explicit clean recipe), 1378 (3 + helper), 1731 (4 + helper), 1957 (3, explicit per-id loop recipe), 2163 (4 + helper), 2279 (6 + helper), 2383 (4 + helper), 2435 (1 + helper), 2563 (4), 2623 (composed nested-join) |
| **D** (RPC/raw SQL) | 0 | segments_routes.py has zero RPC calls (verified) |
| **TOTAL** | **37** | (matches HEAD empirical guard count) |

Note: Sites 1045 and 1957 are technically Pattern C by ride-along count but the plan enumerates an explicit, clean migration recipe (each ride-along maps 1:1 to an existing repo method, no helper dependency, no schema cascade), so the executor migrates them in 82-01.

Note: "Pattern" is the underlying complexity classification; "Owner plan" in Section 3 takes into account whether the migration recipe is unambiguous enough for 82-01 (e.g., sites 1045 and 1957 are technically 3 ride-alongs but ALL three map cleanly to existing repo methods with no helper dependency, so the executor can safely migrate them in 82-01 per the plan's explicit per-site instructions). The plan-checker rule "≥ 3 ride-alongs ⇒ defer" is a heuristic for catching surprises, not a hard threshold; the plan and audit list these specific routes explicitly as 82-01 owners.

## Section 7 — Schema Drift (informational)

Copied verbatim from `82-01-PLAN.md` <context>:

The SQLite schema for segments-related tables differs from Supabase. This is **NOT in scope to fix in Phase 82** (Hard Constraint #8: "No new business logic"). Document and treat as accepted in 82-03 via status-set widening:

| Table | SQLite columns | Missing vs Supabase |
|-------|---------------|---------------------|
| editai_segments | id, source_video_id, start_time, end_time, duration, thumbnail_path, video_path, score, label, is_selected, profile_id, created_at, updated_at | keywords, product_group, transforms, is_favorite, notes, extracted_video_path, usage_count |
| editai_source_videos | id, filename, file_path, duration, width, height, file_size, status, preview_proxy_path/status/error/created_at, segment_count, profile_id, timestamps | fps, file_size_bytes, thumbnail_path, name |
| editai_product_groups | id, profile_id, name, description, product_ids, timestamps | source_video_id, label, start_time, end_time, color (SQLite's table is a different entity — catalog product groupings, not region annotations) |
| editai_project_segments | id, project_id, segment_id, sequence_order, is_manual_selection, created_at | transforms |

Routes touching `keywords` / `product_group` / `transforms` on `editai_segments` will return 500 in SQLite mode due to `OperationalError` — that is **ACCEPTED** per Phase 80 / 81 precedent (dual gate is `status != 503` AND `"Database not available" not in r.text`). 82-03 documents these as deferred items.

**NOT in scope to fix in Phase 82. Routes hitting OperationalError in SQLite mode are documented as deferred items in 82-03 per the Phase 80 / 81 status-widening precedent.**

## Section 8 — Lessons-Carry-Forward from Phase 80 / 81

1. **Audit re-verification is mandatory per chunk, not just at audit creation**: The audit's ownership column is a **starting point**; the executor MUST run a per-function ride-along sweep before each chunk commit and reclassify any function exceeding the Pattern A/B threshold (≥ 3 ride-alongs OR ≥ 1 helper-with-supabase-arg call) UNLESS the plan explicitly enumerates the migration recipe for that function with all ride-alongs mapping cleanly to existing repo methods (e.g., `delete_source_video` L1045 has 3 ride-alongs but each maps to a distinct repo method — get_source_video / list_segments / delete_source_video — and there is no helper dependency, so 82-01 can safely migrate it). This countermeasure exists because earlier Phase 82 audit drafts mis-classified `update_segment` (L1731) and `delete_product_group` (L2383) as Pattern A/B when both have helper dependencies — caught by gsd-plan-checker empirical grep BLOCKER 1/2 during planning, not execution. Generalize: never trust the ownership column without re-running the per-function ride-along + helper-call grep at chunk-commit time, but DO trust the plan's explicit per-site migration recipes for the routes it enumerates.

2. **Helpers with supabase params are refactored as part of the OWNING route's plan** (not a separate plan). `_assign_product_group` (3 callers: L458/L1426/L1788) + `_reassign_all_segments` (4 callers: L2204/L2352/L2421/L2448) live in 82-02 because all routes that call them do.

3. **Chunk-commit safety:** even with no 11-ride-along fat-fn in this phase, executor commits every 6-13 sites within Task 3, validating AST + the dedicated test suite per commit.

4. **"Database not available" gate**: currently ≈ 68 occurrences (mostly the dead `if not repo:` + `if not supabase:` paired guards on each route). Driven to 0 in 82-02 along with the ride-alongs; not elevated to a Phase 82 hard SC because the ROADMAP didn't list it.

5. **Composition over new ABC methods**: nested-join routes are migrated via Python composition (Phase 80 80-02 lesson). No new `list_X_with_join` ABC methods are added.

## Section 9 — Residual `get_client()` count target after Plan 82-01

**Target band: [13, 19]** (≈ 37 − 22 ≈ 15). The band was widened by +1 from the original [12, 18] to account for `update_segment` (L1731) and `delete_product_group` (L2383) being reclassified to 82-02 as Pattern C with helper dependency (net effect: 2 fewer sites migrated in 82-01 vs. earlier draft).

**Plan 82-02 contract (residual 15 sites that 82-02 will drive to 0 along with the 76 ride-alongs):**

| # | Line | Function | Reason |
|---|------|----------|--------|
| 1 | 305 | _generate_preview_proxy_background | BG task with cascading update |
| 2 | 491 | _process_source_video_background | BG task, dual update |
| 3 | 729 | add_local_source_video | Insert path (co-migrate with upload_source_video) |
| 4 | 811 | _process_local_video_background | BG task |
| 5 | 869 | upload_source_video | Insert path |
| 6 | 1378 | create_segment | Pattern C: helper-with-supabase-arg dep |
| 7 | 1731 | update_segment | Pattern C: 4 rides + helper-with-supabase-arg dep |
| 8 | 2057 | extract_segment | BG update + cascade — co-migrate with create_segment for helper boundary |
| 9 | 2163 | create_product_group | Pattern C: helper-with-supabase-arg dep |
| 10 | 2279 | update_product_group | Pattern C: 6 rides + helper-with-supabase-arg dep + cascade |
| 11 | 2383 | delete_product_group | Pattern C: 4 rides + helper-with-supabase-arg dep |
| 12 | 2435 | reassign_product_groups | Helper-with-supabase-arg dep |
| 13 | 2464 | match_segments_to_srt | Keyword scan (co-migrate boundary with helper / keywords schema drift) |
| 14 | 2563 | assign_segments_to_project | Pattern C: in_+eq batch ownership + cascade delete + bulk insert |
| 15 | 2623 | get_project_segments | Pattern C: nested-join composition |

Phase 82-02 terminal gates: all three gates = 0.

---

## Section 10 — Test plan slot for Plan 82-03

Plan 82-03 will add per-route SQLite integration tests for `app/api/segments_routes.py` (mirroring `tests/test_api_library_sqlite.py` / `tests/test_api_pipeline_sqlite.py` from Plans 80-03 / 81-03). The schema drift in Section 7 means several routes will be documented as "expected 500 in SQLite mode" rather than full coverage. The deferred-items.md file in this phase directory will track them.

---
*Plan 82-01 will execute against this contract. Plan 82-02 inherits the residual + helper refactors. Plan 82-03 inherits the schema drift list.*
