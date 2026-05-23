# Phase 83 — Background Services Repository Migration Audit

## Section 1 — Header

**Source files**:
- `app/services/assembly_service.py` — 2 sites: 1 `get_client()` + 1 in-body ride-along
- `app/core/cleanup.py` — 1 site: 1 `get_client()` + 0 in-body ride-alongs

**Total**: 2 `get_client()` sites + 1 in-body ride-along across both files.

**Pattern taxonomy reference**: `.planning/v13-desktop-production/ARCHITECTURE.md` §1 (A = typed SELECT, B = typed CRUD, C = helper-dependent, D = RPC/raw SQL).

**Site-count context**: Phase 83 is the smallest Track-A phase by site count:
| Phase | Site count |
|-------|------------|
| 80 (library_routes.py) | 27 |
| 81 (pipeline_routes.py) | 24 |
| 82 (segments_routes.py) | 37 |
| **83 (background services)** | **2** |

**Empirical counts at HEAD** (commands reproducible — verify before commit):

```bash
python -c "import re; c=open('app/services/assembly_service.py',encoding='utf-8').read(); \
    print('AS get_client:', len(re.findall(r'get_client\(\)', c))); \
    print('AS ride-along:', len(re.findall(r'(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\.(table|rpc)\(', c)))"
# Expected: AS get_client: 1 / AS ride-along: 1

python -c "import re; c=open('app/core/cleanup.py',encoding='utf-8').read(); \
    print('CL get_client:', len(re.findall(r'get_client\(\)', c))); \
    print('CL ride-along:', len(re.findall(r'(supabase|_sb|_supa|_supa_render|supabase_chk|supabase_lib)\.(table|rpc)\(', c)))"
# Expected: CL get_client: 1 / CL ride-along: 0
```

| File | `get_client()` count | 6-var ride-along count |
|------|----------------------|------------------------|
| `app/services/assembly_service.py` | **1** (L2604) | **1** (L2606 — same chain: `_sb.table("editai_tts_assets")...`) |
| `app/core/cleanup.py` | **1** (L145) | **0** (the `raw_client.table("jobs")` chain at L148 is NOT counted because `raw_client` is not in the 6-variable regex set; it's still migrated for FUNC-01 because the `get_client()` precursor is) |
| **Total** | **2** | **1** |

Phase 83 terminal targets: all four gates (2 files × 2 grep patterns) = 0.

## Section 2 — Per-variable ride-along breakdown

| Variable | Count in assembly_service.py | Count in cleanup.py | Notes |
|----------|------------------------------|---------------------|-------|
| `supabase` | 0 | 0 | Not used in these files at HEAD |
| `_sb` | 1 | 0 | assembly_service.py L2604-L2608 — the dedup branch alias |
| `_supa` | 0 | 0 | — |
| `_supa_render` | 0 | 0 | — |
| `supabase_chk` | 0 | 0 | — |
| `supabase_lib` | 0 | 0 | — |
| **Sum** | **1** | **0** | Matches HEAD empirical counts (1 + 0 = 1) |

Phase 83 retains the 6-variable regex gate from Phase 81/82 for forward consistency even though only `_sb` is in use.

## Section 3 — Site-by-site table

| # | File | Line | Enclosing function (def-boundary verified) | Body range | Tables touched | Operations | Pattern | Target method | Method exists? | In-body ride-alongs | Owner plan |
|---|------|------|--------------------------------------------|------------|----------------|------------|---------|---------------|----------------|---------------------|------------|
| 1 | `app/services/assembly_service.py` | 2604 | `assemble_and_render_preview` (defined at L2234) — specifically the dedup branch at L2599-L2612 inside the `if not reuse_audio_path and audio_path.exists():` block at L2582 | L2599-L2612 (the inner `try: ... except Exception as _dedup_err:` block) | `editai_tts_assets` | SELECT with `.eq("profile_id", X).eq("status", "ready").eq("tts_text", Y).limit(1)` | A — typed SELECT with eq filters + limit | `repo.list_tts_assets(profile_id, QueryFilters(eq={"tts_text": cleaned_text.strip(), "status": "ready"}, limit=1))` | **Yes** (base.py:511, supabase_repo.py:651, sqlite_repo.py:1265) | 1 (L2606 — same chain as the guard) | **83-01** |
| 2 | `app/core/cleanup.py` | 145 | `cleanup_old_jobs(days, dry_run)` (defined at L124) — specifically the `if dry_run:` branch at L140-L180 | L140-L180 (the dry-run preview branch) | `jobs` (Supabase) / `jobs` via `_TABLE_MAP` (SQLite) | SELECT with `.lt("created_at", cutoff_iso).execute()` + post-filter for `status in terminal_statuses` | A — typed SELECT with `lt` filter + `in_` filter (post-filter folded into the query) | `repo.list_jobs(filters=QueryFilters(lt={"created_at": cutoff.isoformat()}, in_={"status": sorted(list(terminal_statuses))}))` | **Yes** (base.py:426, supabase_repo.py:548, sqlite_repo.py:1096) | 0 (the `raw_client.table("jobs")` ride-along at L148 is on `raw_client`, not in the 6-variable regex set — still migrated because the `get_client()` precursor at L145 is) | **83-01** |

**Note on Site #2 ride-along count**: the `raw_client.table("jobs")` chain at L148 is NOT counted by the 6-variable regex gate, but it is still migrated. After migration, the entire `if raw_client: try: result = raw_client.table("jobs")...except:...` block becomes `try: result = repo.list_jobs(...); ... except Exception as exc: ... fall through to in-memory`. The post-filter `[r for r in (result.data or []) if r.get("status") in terminal_statuses]` is collapsed into the `in_` filter of QueryFilters.

## Section 4 — Helpers with supabase parameter

**NONE in Phase 83.** Neither `assembly_service.py:assemble_and_render_preview` nor `cleanup.py:cleanup_old_jobs` calls any helper with a `supabase` or `_sb` first argument. No helper refactor work in this phase.

## Section 5 — New ABC methods required (Phase 83 additions)

| Method | Status |
|--------|--------|
| `list_tts_assets` | **NOT NEW** — exists at base.py:511, used as-is with `QueryFilters(eq={...}, limit=1)` |
| `list_jobs` | **NOT NEW** — exists at base.py:426, used as-is with `QueryFilters(lt={...}, in_={...})` |
| `get_tts_asset_by_text` (option considered) | **REJECTED** — adding a single-purpose method would duplicate `list_tts_assets(filters=...)` with the same input shape. Composition over new methods, per Phase 80 Lesson 5 |
| `list_old_jobs(cutoff_date, statuses)` (option considered) | **REJECTED** — adding a single-purpose method would duplicate `list_jobs(filters=QueryFilters(lt=..., in_=...))` with the same input shape. Both backends support `lt` + `in_` via `_apply_filters` (verified at supabase_repo.py:38-46 and sqlite_repo.py:252-265) |

**Phase 83 net new ABC methods: 0.**

## Section 6 — FUNC-03 Disposition

FUNC-03 (`.planning/milestones/v13-REQUIREMENTS.md:14`) states: *"Repository ABC gains the methods required by patterns currently handled via `.table().select()…` chains in `library_routes.py`, `pipeline_routes.py`, `segments_routes.py`, `assembly_service.py`, `core/cleanup.py`."*

**Phase 83's FUNC-03 satisfaction: zero new ABC methods required for `assembly_service.py` and `core/cleanup.py`.** Justification (empirical, verified):

1. **`assembly_service.py:2604` site:** The chain `_sb.table("editai_tts_assets").select("id, mp3_path").eq("profile_id", X).eq("status", "ready").eq("tts_text", Y).limit(1).execute()` decomposes cleanly into existing primitives:
   - `list_tts_assets(profile_id, ...)` already filters by `profile_id` (supabase_repo.py:656: `.eq("profile_id", profile_id)`; sqlite_repo.py:1269: `'"profile_id" = ?'`).
   - `QueryFilters(eq={"status": "ready", "tts_text": cleaned_text.strip()}, limit=1)` covers the remaining two `.eq(...)` and `.limit(1)` clauses via the existing `_apply_filters` (supabase_repo.py:32-59, sqlite_repo.py:243-265).
   - The `select("id, mp3_path")` projection is optional — `list_tts_assets` returns full rows; the caller already picks `mp3_path` from the dict.

2. **`cleanup.py:145` site:** The chain `raw_client.table("jobs").select("id,status,created_at").lt("created_at", cutoff_iso).execute()` + Python post-filter for `status in terminal_statuses` decomposes cleanly into:
   - `list_jobs(filters=QueryFilters(lt={"created_at": cutoff.isoformat()}, in_={"status": sorted(list(terminal_statuses))}))` — both `lt` and `in_` are supported by `_apply_filters` on both backends.
   - The Python post-filter `[r for r in (result.data or []) if r.get("status") in terminal_statuses]` is collapsed into the `in_` filter at the query level.
   - The `select("id,status,created_at")` projection is optional — the post-filter only reads `status`, `id`, `created_at`, all of which are in the default `*` projection.

3. **FUNC-03 phase coverage:** Phases 80/81/82 added new ABC methods (5 + 1 + 2 = 8 total) covering the route-layer migrations. Phase 83's non-route layer migrations require zero additions because the route migrations already populated the ABC with the primitives needed for `assembly_service.py` and `core/cleanup.py`. **This is FUNC-03 closure for Phase 83 by coverage, not by addition.**

**Empirical filter coverage verification** (the load-bearing evidence — re-checked at planning time):

Supabase backend (app/repositories/supabase_repo.py:28-64 `_apply_filters`):
- L32-33: `for col, val in filters.eq.items(): query = query.eq(col, val)` ✓
- L38-39: `for col, val in filters.lt.items(): query = query.lt(col, val)` ✓
- L44-45: `for col, vals in filters.in_.items(): query = query.in_(col, vals)` ✓
- L58-59: `if filters.limit is not None: query = query.limit(filters.limit)` ✓

SQLite backend (app/repositories/sqlite_repo.py:234-298 `_apply_filters`):
- L243-245: `for col, val in filters.eq.items(): where_parts.append(f'"{col}" = ?'); params.append(val)` ✓
- L252-254: `for col, val in filters.lt.items(): where_parts.append(f'"{col}" < ?'); params.append(val)` ✓
- L261-265: `for col, vals in filters.in_.items(): if vals: placeholders = ", ".join("?" for _ in vals); where_parts.append(f'"{col}" IN ({placeholders})'); params.extend(vals)` ✓
- `list_jobs` body at L1096-L1133 wires `_apply_filters` then appends LIMIT/OFFSET — confirmed.

Both backends support every primitive Phase 83 needs. **No new ABC method is required.**

A downstream verifier reading Phase 83 SUMMARY.md and noticing "no new ABC methods" should consult THIS SECTION first. The disposition is intentional, empirically grounded, and documented as the phase's load-bearing FUNC-03 evidence.

## Section 7 — Pattern Taxonomy Summary

| Pattern | Count | Sites |
|---------|-------|-------|
| **A** (typed SELECT with eq/lt/in_ filters, no helper dependency, no cascade) | 2 | assembly_service.py:2604 (eq+eq+eq+limit), cleanup.py:145 (lt+in_ via post-filter) |
| **B** | 0 | — |
| **C** | 0 | — |
| **D** (RPC/raw SQL) | 0 | — |
| **TOTAL** | **2** | matches HEAD empirical guard count |

## Section 8 — Lessons-Carry-Forward from Phase 80/81/82

1. **Composition over new ABC methods** (Phase 80 80-02 lesson, reapplied): when an existing `list_X(filters=QueryFilters(...))` method covers a call site's query shape via existing filter primitives (`eq`, `lt`, `in_`, `limit`, etc.), DO NOT add a single-purpose method like `get_tts_asset_by_text` or `list_old_jobs`. Use the existing method with the appropriate `QueryFilters`. This keeps the ABC surface narrow and avoids "one method per site" sprawl.

2. **try/except behavior preservation is a hard constraint** (carry-forward from Phase 80/81/82 Hard Constraint #1 "Behavior preservation"): both Phase 83 sites are inside `try/except Exception` blocks that log warnings and fall through gracefully. The migration MUST preserve these blocks verbatim — the typed repo call replaces the inner body, but the surrounding `try:` and `except Exception as <name>:` lines are unchanged.

3. **Reuse-justification documentation is mandatory** (new for Phase 83): when a phase touches files listed in FUNC-03 but adds zero ABC methods, the audit MUST contain Section 6 (the "FUNC-03 Reuse Closure" section above) with empirical filter-coverage citations. Otherwise a downstream verifier will read "no new ABC methods" as a FUNC-03 miss. The reuse section converts the omission into documented coverage.

4. **Atomic per-task commits replace chunked commits** (new for tiny phases): Phase 80/81/82 used chunked commits inside a single migration task because each task migrated 8-25 sites in one file. Phase 83 migrates 1 site per file, so each task naturally produces 1 commit. No chunking required.

5. **SQLite test surface for service/CLI functions** (new for Phase 83): unlike Phase 80/81/82 which tested HTTP routes via `TestClient`, Phase 83 tests the migrated functions DIRECTLY (no TestClient). The `_assert_not_db_unavailable(r)` dual-gate idiom does not apply (no HTTP response). Tests assert function-level postconditions: return type, return value sanity (e.g., `count >= 0`), and no-exception-raised under `DATA_BACKEND=sqlite`.

## Section 9 — Residual `get_client()` count target after Plan 83-01

**Target: 0 in both files (combined gate count = 0). Acceptance: exactly 0, no band. The phase is too small for a band.**

| Gate | File | Target | Source of truth |
|------|------|--------|-----------------|
| `get_client()` | assembly_service.py | 0 | Plan 83-01 must_have |
| `get_client()` | cleanup.py | 0 | Plan 83-01 must_have |
| 6-var ride-along | assembly_service.py | 0 | Plan 83-01 must_have |
| 6-var ride-along | cleanup.py | 0 | Plan 83-01 must_have |
| `except Exception as _dedup_err` | assembly_service.py | 1 (preserved) | behavior preservation gate |
| `Could not query jobs for dry-run` | cleanup.py | 1 (preserved) | behavior preservation gate |
| `storage.cleanup_old_jobs(days)` | cleanup.py | ≥ 1 (non-dry-run path unchanged) | regression gate |

## Section 10 — Test plan slot for Task 4

Task 4 will add `tests/test_background_services_sqlite.py` with ≥ 4 tests:

| # | Test name | Function exercised | Postcondition |
|---|-----------|-------------------|---------------|
| 1 | `test_sqlite_backend_fixture_loads_for_phase83` | `sqlite_backend` fixture | Fixture yields a `SQLiteRepository` + default profile; fail-loud sanity. |
| 2 | `test_cleanup_old_jobs_dry_run_returns_count_sqlite` | `app.core.cleanup.cleanup_old_jobs(days=7, dry_run=True)` | Returns `int >= 0`, does not raise. |
| 3 | `test_cleanup_old_jobs_dry_run_counts_old_terminal_jobs_sqlite` | Same — with seeded old + fresh terminal jobs | Returns `int >= 1` (the old seeded job is counted; the fresh one is not). |
| 4 | `test_assembly_tts_dedup_lookup_returns_existing_mp3_path_sqlite` | The migrated dedup lookup logic (direct `repo.list_tts_assets(...)` call mirroring the migrated code path) | Returns the seeded asset's `mp3_path` when a `status='ready'` row matching `tts_text` and `profile_id` exists. |
| 5 | `test_assembly_tts_dedup_lookup_returns_empty_for_missing_text_sqlite` | Same — with non-matching `tts_text` | Returns empty `data` (no asset). |

All tests use the existing `sqlite_backend` fixture from `tests/conftest.py:161`. **A module-level `autouse` fixture `_reset_job_storage_singleton` is included to clear the `app.services.job_storage._job_storage` singleton before/after each test** — this is required because JobStorage captures `self._repo = get_repository()` once in `__init__` (job_storage.py:58) and never re-checks; without the reset, the sqlite_backend repo binding would not take effect if a prior test had already instantiated the singleton.

No new fixture or seed helper required beyond the existing `sqlite_backend`; `repo.create_tts_asset(...)` and `repo.create_job(...)` are available on both backends.
