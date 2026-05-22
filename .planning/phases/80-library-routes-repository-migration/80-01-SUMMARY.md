---
phase: 80-library-routes-repository-migration
plan: 01
subsystem: database
tags: [sqlite, repository-pattern, library, route-migration, abc-methods, idor-mitigation]

requires:
  - phase: 77-sqlite-desktop-activation
    provides: DataRepository ABC + SupabaseRepository/SQLiteRepository pair + factory; established Pattern A/B/C/D migration taxonomy

provides:
  - 5 new ABC methods (count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage) implemented on both backends
  - ROUTES-AUDIT.md cataloging all 27 get_client() call sites in library_routes.py with Pattern letter, target ABC method, and owner plan
  - 18 Pattern A/B route migrations in library_routes.py (download/tags/remove-audio/delete/bulk-delete/trash/restore/permanent/content/copy-from/export-presets/cleanup-exports/render/regenerate-voiceover)
  - T-80-01-01 IDOR mitigation: every repo.get_clip() call site followed by profile_id ownership check within ≤2 lines

affects: [80-02-pattern-cd-migration, 80-03-test-rewrite, 77-sqlite-desktop-activation]

tech-stack:
  added: []
  patterns:
    - "repo.get_clip() + immediate profile_id ownership check (T-80-01-01) replaces in-query .eq('profile_id', X)"
    - "table_query upsert escape hatch for clip_content (update_clip_content is UPDATE-only on both backends)"
    - "Per-id loop pattern for bulk operations (silent skip non-owned per T-80-01-06) replaces in_() select chains"
    - "list_export_presets(profile_id) honors profile_id OR NULL semantics on both backends (Supabase via .or_(), SQLite via SQL OR clause)"

key-files:
  created:
    - .planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md
    - .planning/phases/80-library-routes-repository-migration/80-01-SUMMARY.md
    - tests/test_repository_new_methods.py (created in Task 2 RED commit)
  modified:
    - app/repositories/base.py (5 new abstract methods)
    - app/repositories/supabase_repo.py (5 new method implementations)
    - app/repositories/sqlite_repo.py (5 new method implementations + editai_exports schema bootstrap)
    - app/api/library_routes.py (18 sites migrated from supabase.table() to repo.*)

key-decisions:
  - "Site #23 (_regenerate_voiceover_task body) deferred to Plan 80-02 — audit gap discovered during execution: function body contains 7+ in-body supabase.table() calls beyond the get_client() guard, parallel to how _render_final_clip_task is already deferred to 80-02"
  - "Upsert via table_query escape hatch instead of adding upsert_clip_content ABC method — both backends already support upsert with on_conflict via table_query, no new ABC method needed"
  - "/trash project-name enrichment uses per-project repo.get_project loop (not a new bulk method) — desktop scale (<10K clips in trash per profile) makes N small queries acceptable"
  - "bulk-delete uses per-id loop with silent skip (T-80-01-06) instead of adding list_clips_by_ids — reuses existing ABC methods, fewer surface additions"

patterns-established:
  - "T-80-01-01 ownership check: every repo.get_clip(clip_id) MUST be immediately (≤2 lines) followed by 'if not clip or clip.get(\"profile_id\") != profile.profile_id: raise HTTPException(404)' — replaces the older 'select().eq().eq(profile_id)' chain"
  - "503 'Database not available' is eliminated for SQLite mode: routes assume repo is always available (FUNC-01)"
  - "table_query upsert pattern: repo.table_query(table, 'upsert', data=..., filters=QueryFilters(on_conflict='clip_id')) for any clip_content insert-or-update"

requirements-completed: [FUNC-01, FUNC-03]

duration: ~120min
completed: 2026-05-22
---

# Phase 80 Plan 01: Library Routes Repository Migration Summary

**18 Pattern A/B route migrations in library_routes.py + 5 new repository methods, reducing get_client() count from 27 to 9 (Plan 80-02 residual) while applying T-80-01-01 IDOR ownership checks at every repo.get_clip site.**

## Performance

- **Duration:** ~120 min (Task 3 portion; Tasks 1 and 2 completed in prior session)
- **Completed:** 2026-05-22
- **Tasks:** 3 (all complete)
- **Files modified:** 4 (base.py, supabase_repo.py, sqlite_repo.py, library_routes.py)
- **Files created:** 2 (ROUTES-AUDIT.md, test_repository_new_methods.py)

## Accomplishments

- **Audit catalog complete:** ROUTES-AUDIT.md lists all 27 get_client() sites with Pattern letter (A/B/C/D), target ABC method, "method exists?" flag, and owner plan (80-01 vs 80-02). Plan 80-02 has a complete contract.
- **5 new ABC methods added** to DataRepository and implemented on both SupabaseRepository and SQLiteRepository: count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage. All 13 unit tests pass.
- **18 Pattern A/B route migrations** in library_routes.py: SRT/audio/video download (sites 1-3), variant_index calc (site 4), /tags (site 7), remove-audio (site 10), DELETE clip/bulk-delete (sites 11-12), /trash + /trash/empty (sites 13-14), restore + permanent (sites 15-16), PUT content + copy-from (sites 17-18), /export-presets (site 19), cleanup-exports (site 20), render + regenerate-voiceover (sites 21-22).
- **T-80-01-01 (IDOR mitigation) consistently applied:** all 16 repo.get_clip() call sites in the file are immediately followed (next line) by `if not clip or clip.get("profile_id") != profile.profile_id: raise HTTPException(404)`. Verified via grep audit.
- **get_client() count: 27 → 9.** The residual 9 are exactly the Pattern C/D sites + DEAD-CODE sites + the deferred _regenerate_voiceover_task body, all handed to Plan 80-02.

## Task Commits

Each task / sub-task committed atomically:

1. **Task 1 (ROUTES-AUDIT.md)** — `eefb3e8` (docs: catalog 27 get_client() sites)
2. **Task 2 RED (5 failing tests for new ABC methods)** — `08a0691` (test)
3. **Task 2 GREEN (5 new methods on both backends)** — `e969036` (feat)
4. **Task 3 chunk 1 — sites 1,2,3,4,7,10 (downloads/tags/remove-audio)** — `25d915c` (refactor)
5. **Task 3 chunk 2 — sites 11-16 (delete/bulk-delete/trash/restore/permanent)** — `14906c2` (refactor)
6. **Task 3 chunk 3 — sites 17-22 (content/export-presets/cleanup/render/voiceover-prep)** — `aad3ab9` (refactor)

## Files Created/Modified

- `.planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md` — canonical audit of all 27 sites with Pattern letter, target ABC method, owner plan. Updated mid-execution with audit-gap section for site #23 (deferred to 80-02).
- `tests/test_repository_new_methods.py` — 13 unit tests for the 5 new ABC methods (count_clips, get_export_preset_by_name, delete_exports_older_than, get_project_by_name, increment_segment_usage); all passing on both backends.
- `app/repositories/base.py` — 5 new abstract method declarations in sections 1 (Projects), 2 (Clips), 4 (Segments), 9 (Export Presets), 10 (Exports).
- `app/repositories/supabase_repo.py` — 5 new method implementations using `self.client.table(...)` patterns; increment_segment_usage tries RPC first then falls back to per-id read-modify-write.
- `app/repositories/sqlite_repo.py` — 5 new method implementations using parameterized SQL; increment_segment_usage uses single UPDATE with IN clause.
- `app/api/library_routes.py` — 18 route bodies rewritten to use repository methods; 503 "Database not available" guards removed from migrated routes; T-80-01-01 ownership checks consistently applied.

## Verification Results (Acceptance Gates)

All 6 acceptance gates from the executor objective:

| Gate | Check | Result |
|------|-------|--------|
| 1 | `python -c "import ast; ast.parse(open('app/api/library_routes.py').read())"` | **PASS** (exit 0) |
| 2 | `grep -c "get_client()" app/api/library_routes.py` ∈ [6, 10] | **PASS** (9) |
| 3 | `/library/export-presets` endpoint uses `repo.list_export_presets` and NO `supabase.table` | **PASS** (line 2706, uses `repo.list_export_presets(profile.profile_id, QueryFilters(order_by="is_default", order_desc=True))`) |
| 4 | Every `repo.get_clip(` followed within 5 lines by profile_id ownership check | **PASS** (16/16 sites verified) |
| 5 | `pytest tests/test_api_library.py` failures all trace to mocked supabase chains | **PASS** (11 failures = identical to baseline before any Phase 80 changes; same 11 pre-existing failures handed to Plan 80-03 for test rewrite) |
| 6 | `pytest tests/test_repository_new_methods.py` passes | **PASS** (13/13) |

### Residual `get_client()` lines (handed to Plan 80-02)

| Line | Site # | Component | Reason for 80-02 |
|------|--------|-----------|------------------|
| 1164 | #5 | /projects/{id}/generate-from-segments | Pattern C — nested join |
| 1417 | #6 | _generate_from_segments_task | Pattern C — nested join + max + update |
| 1987 | #8 | /all-clips | Pattern C — count + nested join + cursor pagination |
| 2114 | #9 | /sync-orphans | Pattern C — helper rewrite (orphan-sync logic) |
| 2959 | #23 | _regenerate_voiceover_task | Audit gap: function body has 7+ in-body supabase.table() calls beyond the guard. Deferred to 80-02 (see Deviations) |
| 3310 | #24 | _render_final_clip_task initial fetch | DEAD code wrapper — 80-02 removes |
| 3317 | #25 | _render_final_clip_task retry loop | DEAD code — 80-02 removes |
| 3326 | #26 | _render_final_clip_task last-ditch | Pattern A — repo.update_clip; 80-02 |
| 3841 | #27 | _start_render_for_clip helper | Pattern A — 80-02 (parallel to render route) |

## Threat Mitigations Verified

**T-80-01-01 (Information disclosure via missing profile_id filter on get_clip):**

Every `repo.get_clip(clip_id)` call in library_routes.py is followed by an ownership check on the next line. Verified via grep across all 16 call sites (lines 444, 468, 501, 2135, 2178, 2235, 2296, 2385, 2428, 2545, 2588, 2621, 2666, 2670, 2812, 2894). For example:

```python
clip = repo.get_clip(clip_id)
if not clip or clip.get("profile_id") != profile.profile_id:
    raise HTTPException(status_code=404, detail="Clip not found")
```

The bulk-delete site (line 2428) uses the same pattern inside a per-id loop, silently skipping non-owned IDs per T-80-01-06 (accepted threat — maintains parity with pre-migration in_().eq(profile_id) behavior).

**T-80-01-04 (delete_exports_older_than profile_id scoping):**

The new ABC method requires `profile_id` parameter. Verified that both backends include profile_id in their WHERE/filter clauses (SQLite via `WHERE profile_id = ?`; Supabase via `.eq("profile_id", profile_id)` — though note the editai_exports table uses clip_id+profile_id, the Supabase implementation cascades correctly).

## Decisions Made

- **Site #23 (_regenerate_voiceover_task body) deferred to Plan 80-02** (key decision — see Deviations section). Advisor flagged this audit gap before committing the migration: the function body has 7+ supabase.table() calls beyond the get_client() guard.
- **Upsert pattern uses `repo.table_query` escape hatch** rather than adding a new `upsert_clip_content` ABC method. `update_clip_content` is UPDATE-only on both backends (does not auto-create), but `table_query` supports the upsert operation natively with `QueryFilters(on_conflict="clip_id")`. Avoiding a new ABC method keeps the interface lean.
- **/trash project-name enrichment uses per-project repo.get_project loop** — desktop scale means trash never exceeds ~hundreds of unique projects. Adding a `list_projects_by_ids` method would be premature.
- **Bulk-delete uses per-id loop** with `repo.get_clip` per id — reuses existing ABC methods, avoids adding `list_clips_by_ids` for one site. T-80-01-06 (accepted threat) covers the "silent skip non-owned" semantics.

## Deviations from Plan

### Audit gap discovered: Site #23 reassigned to Plan 80-02

**1. [Rule 4 - Audit scope correction] Site #23 (_regenerate_voiceover_task) reassigned from 80-01 to 80-02**

- **Found during:** Task 3 — pre-execution review of `_regenerate_voiceover_task` body (lines 2959-3270 post-migration)
- **Issue:** The original audit assigned this function to Plan 80-01 with the migration scope "remove get_client() guard at line 2989 + migrate the editai_clips update at 2996 + migrate the upsert at 3103." However, the function body contains **7+ additional `supabase.table()` calls** not enumerated:
  - Line 3134: `supabase.table("profiles").select("subtitle_settings")...` — fallback subtitle settings
  - Line 3177: `supabase.table("editai_projects").select("pipeline_id")...`
  - Line 3185: `supabase.table("editai_pipelines").select("previews, source_video_ids")...`
  - Line 3261: `supabase.table("editai_clips").update({"raw_video_path": ...})`
  - Line 3268: `supabase.table("editai_clip_content").update({"segment_composition": ...})`
  - Line 3277: `supabase.table("editai_clips").update({"final_status": "completed", ...})`
  - Line 3287: `supabase.table("editai_clips").update({"final_status": "failed", ...})` (except block)

  Removing only the `get_client()` guard would have caused `NameError: supabase` at runtime when the in-body calls execute.
- **Fix:** Defer the entire function to Plan 80-02 by symmetry with `_render_final_clip_task` (which the audit explicitly enumerates and assigns to 80-02 for the same reason). Updated ROUTES-AUDIT.md with an "Audit gap discovered during 80-01 execution" section listing every in-body call and its target repo method, so Plan 80-02's contract is now complete and unambiguous.
- **Files modified:** `.planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md` (appended audit-gap section)
- **Verification:** `grep -nE "get_client\(\)" app/api/library_routes.py` returns line 2959 in the residual list, matching the 80-02 contract.
- **Committed in:** Will be committed alongside SUMMARY.md (final metadata commit)
- **Impact:** Plan 80-01 ended at 18 sites migrated (not 19); Plan 80-02 owns 9 sites (not 8) + the in-body calls.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Installed missing Python 3.13 test dependencies**

- **Found during:** Task 3 verification (running `pytest tests/test_api_library.py`)
- **Issue:** Default `python` on this system is Python 3.14 with no test dependencies; `py -3.13` had Python 3.13 with fastapi but missing: pytest, pytest-timeout, pytest-asyncio, pytest-cov, slowapi, srt, google-genai, anthropic, edge-tts, elevenlabs, supabase, opencv-python, imagehash, python-json-logger, redis, pyJWT, bcrypt, cryptography.
- **Fix:** `py -3.13 -m pip install` for each missing package. scipy fails to build from source (no Fortran compiler) but is not needed for `test_api_library.py` / `test_repository_new_methods.py`.
- **Files modified:** None (environment only)
- **Verification:** `py -3.13 -m pytest tests/test_repository_new_methods.py -q` passes (13/13); `py -3.13 -m pytest tests/test_api_library.py -q` runs (same 11 baseline failures pre and post-migration).
- **Committed in:** N/A (environment, not code)

**3. [Rule 2 - Missing critical] Added `Dict` ownership-check pattern as new T-80-01-01 hardening**

- **Found during:** Task 3 sites #11-16 migration
- **Issue:** The original audit assumed pre-migration routes scoped queries via `.eq("profile_id", X).eq("is_deleted", False)` chains. After migration to `repo.get_clip(clip_id)`, the IDOR boundary moves into Python code. Without the ownership check, any clip belonging to any profile could be returned.
- **Fix:** Every `repo.get_clip()` site now has an immediate `if not clip or clip.get("profile_id") != profile.profile_id: raise HTTPException(404)` check on the next line. Site-specific extensions: trash/restore additionally check `is_deleted`; permanent-delete checks `is_deleted=True`; DELETE-clip checks `not is_deleted`.
- **Files modified:** `app/api/library_routes.py` (16 call sites, all verified via grep)
- **Verification:** `grep -nE "repo\.get_clip\(" app/api/library_routes.py` + 5-line context inspection confirms all sites comply.
- **Committed in:** Spread across the 3 refactor commits (25d915c, 14906c2, aad3ab9)

---

**Total deviations:** 1 scope correction (audit gap), 2 auto-fixed (env setup + ownership-check hardening).
**Impact on plan:** Audit gap was caught BEFORE applying a broken migration (would have caused runtime NameError). The fix is to extend ROUTES-AUDIT.md, not change the code in 80-01. Ownership-check hardening is a clean implementation of the T-80-01-01 mitigation already specified in the threat model. No scope creep.

## Handoff to Plan 80-02

Plan 80-02 inherits the following work from this plan, all documented in `ROUTES-AUDIT.md`:

**get_client() residual sites (9 lines):**
- Site #5 (line 1164) — /projects/{id}/generate-from-segments (Pattern C)
- Site #6 (line 1417) — _generate_from_segments_task (Pattern C)
- Site #8 (line 1987) — /all-clips (Pattern C — needs count_clips ABC method, ALREADY IMPLEMENTED in this plan)
- Site #9 (line 2114) — /sync-orphans helper (Pattern C — needs get_project_by_name ABC method, ALREADY IMPLEMENTED in this plan)
- Site #23 (line 2959) — _regenerate_voiceover_task (audit gap; see Deviations §1)
- Sites #24/#25/#26 (lines 3310/3317/3326) — _render_final_clip_task DEAD-CODE + last-ditch update
- Site #27 (line 3841) — _start_render_for_clip helper (parallels render route, uses get_export_preset_by_name ABC method ALREADY IMPLEMENTED)

**In-body supabase.table() calls** that Plan 80-02 must also migrate (NOT counted by `grep get_client()`):
- _render_final_clip_task: 8 in-body calls (lines 3395, 3407, 3416, 3567, 3607, 3652, 3772, 3780, 3798 per ROUTES-AUDIT.md — line numbers may shift slightly post-migration)
- _regenerate_voiceover_task: 7+ in-body calls (lines ~3134, 3177, 3185, 3261, 3268, 3277, 3287 — enumerated in audit-gap section of ROUTES-AUDIT.md)
- _increment_segment_usage helper (line ~3945) — `_increment_segment_usage(supabase_client, ...)` helper takes supabase parameter. Plan 80-02 should rewrite to use the new `repo.increment_segment_usage(segment_ids)` ABC method already implemented in this plan.

**Helpers taking supabase parameter** (Plan 80-02 refactors signature):
- `_sync_orphan_clips(profile_id, supabase)` — line ~1908 (1938 pre-migration)
- `_get_or_create_sync_project(supabase, profile_id)` — line ~1882 (1912 pre-migration) — use `repo.get_project_by_name(profile_id, "Imported from disk")` already implemented in this plan
- `_increment_segment_usage(supabase_client, segment_ids)` — see above

**ABC methods Plan 80-02 may add** (deferred from this plan):
- `list_project_segments_with_source(project_id)` — for sites #5/#6 (OR refactor route to 3 calls)
- `list_clips_with_project_info(profile_id, ...)` — for site #8 (OR refactor /all-clips to bulk repo.get_project calls)

## Known Test Breakages Handed to Plan 80-03

`tests/test_api_library.py` has **11 pre-existing failures** that exist BOTH before and after this plan's migration. They fail because:

1. **TestProjectsNoSupabase / TestClipsNoSupabase tests assume `503 "Database not available"`** — these tests pre-date Phase 80's explicit removal of 503 in SQLite mode (FUNC-01). They now get `422` (auth failure) or `200` (route works) instead. Plan 80-03 will rewrite to assert the new semantics.
2. **TestProjectsWithMockedSupabase mocks chained `.table().select().eq().execute()` returns** — those chains no longer exist after migration to repo methods. Plan 80-03 will mock the repo factory return value instead.

Specific failing tests (verified by stash-and-rerun baseline check):
- `test_create_project_no_supabase_returns_503`
- `test_list_projects_no_supabase_returns_503`
- `test_get_project_no_supabase_returns_503`
- `test_delete_project_no_supabase_returns_503`
- `test_create_project_returns_200_with_id`
- `test_create_project_response_structure`
- `test_list_projects_returns_200_with_list`
- `test_list_projects_has_total`
- `test_get_clip_not_found_returns_503`
- `test_delete_clip_not_found_returns_503`
- `test_list_all_clips_no_supabase_returns_503`

None of these failures are caused by this plan's migration — the same 11 fail on `HEAD~3` (before any 80-01 changes).

## Issues Encountered

- **Test environment setup:** Python 3.14 (the default in this shell) lacks fastapi. Python 3.13 was needed but missing pytest and many transitive deps. Installed piecewise; scipy failed to build (no Fortran compiler, not needed for these tests).
- **Audit gap on site #23:** Caught pre-execution via advisor review. Reassigned to Plan 80-02 instead of producing a half-migration that would crash at runtime.

## Self-Check

Run:

```bash
# All key files exist
[ -f .planning/phases/80-library-routes-repository-migration/ROUTES-AUDIT.md ] && echo "FOUND: ROUTES-AUDIT.md"
[ -f .planning/phases/80-library-routes-repository-migration/80-01-SUMMARY.md ] && echo "FOUND: 80-01-SUMMARY.md"
[ -f tests/test_repository_new_methods.py ] && echo "FOUND: test_repository_new_methods.py"

# Commits exist
git log --oneline | grep -q "eefb3e8" && echo "FOUND: eefb3e8 (audit)"
git log --oneline | grep -q "08a0691" && echo "FOUND: 08a0691 (RED)"
git log --oneline | grep -q "e969036" && echo "FOUND: e969036 (GREEN)"
git log --oneline | grep -q "25d915c" && echo "FOUND: 25d915c (refactor 1)"
git log --oneline | grep -q "14906c2" && echo "FOUND: 14906c2 (refactor 2)"
git log --oneline | grep -q "aad3ab9" && echo "FOUND: aad3ab9 (refactor 3)"

# Acceptance gates
python -c "import ast; ast.parse(open('app/api/library_routes.py').read()); print('GATE 1: syntax OK')"
echo "GATE 2: get_client count = $(grep -c 'get_client()' app/api/library_routes.py)"
```

## Self-Check: PASSED

All acceptance gates verified by hand during execution:

- Gate 1 (syntax): PASS
- Gate 2 (get_client count): PASS (9, within [6, 10])
- Gate 3 (export-presets uses repo.list_export_presets): PASS
- Gate 4 (T-80-01-01 ownership checks): PASS (16/16 get_clip sites)
- Gate 5 (library tests): PASS (11 pre-existing failures match baseline; 0 new failures introduced)
- Gate 6 (repository new-methods tests): PASS (13/13)

All commit hashes (eefb3e8, 08a0691, e969036, 25d915c, 14906c2, aad3ab9) verified in git log.

## Next Phase Readiness

- Plan 80-02 has a complete, executable contract via ROUTES-AUDIT.md (including the audit-gap section for site #23)
- All 5 new ABC methods Plan 80-02 needs are already implemented (count_clips, get_export_preset_by_name, get_project_by_name, increment_segment_usage are direct dependencies for sites #8, #9, #23, _increment_segment_usage helper)
- Plan 80-03 has a clear scope: rewrite the 11 chained-mock tests in tests/test_api_library.py to mock the repo factory instead of supabase.table() chains
- No blockers for Plan 80-02 or 80-03

---
*Phase: 80-library-routes-repository-migration*
*Completed: 2026-05-22*
