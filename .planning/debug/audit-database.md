# Database Schema & API Integration Audit

**Date:** 2026-02-26
**Scope:** All `editai_*` tables, `jobs`, `api_costs`, `profiles`, `elevenlabs_accounts` in Supabase + backend API routes

---

## CRITICAL ISSUES

### 1. Ghost Table Reference: `editai_generation_progress` (SEVERITY: HIGH)

**Location:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, lines 128-186

The code performs `upsert`, `select`, and `delete` operations on `editai_generation_progress`, but **this table does not exist** in the database. No migration creates it. The table was referenced in migration `017_create_generation_progress.sql` in the local files but the migration was never applied to the remote database.

**Impact:** Every call to `update_generation_progress()` silently fails with a warning log. Progress tracking falls back to in-memory only, which means:
- Progress is lost on server restart
- The DB fallback path in `get_generation_progress()` never works

**Fix:** Apply a migration to create the `editai_generation_progress` table, or remove the DB persistence code since in-memory tracking works fine for the current single-server deployment.

---

### 2. Column Mismatch: `editai_postiz_publications.platforms` (SEVERITY: HIGH)

**Location:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/postiz_routes.py`, line 563

The code inserts a `platforms` column:
```python
supabase.table("editai_postiz_publications").insert({
    ...
    "platforms": result.platforms or [],
    ...
}).execute()
```

But the `editai_postiz_publications` table has **no `platforms` column**. The actual columns are: `id, clip_id, export_id, platform (singular), postiz_post_id, status, caption, scheduled_at, published_at, created_at`.

**Impact:** Every publication insert will fail silently (wrapped in try/except), meaning publication tracking is never persisted.

**Fix:** Either rename the code to use `platform` (singular) or add a `platforms` JSONB column via migration.

---

### 3. RLS Policies Created but RLS Not Enabled on 9 Tables (SEVERITY: HIGH)

The Supabase security advisor flagged 9 `editai_*` tables where RLS policies exist but RLS is **not enabled**. This means the policies have zero effect -- all data is publicly accessible via the Supabase API.

| Table | Policies Defined | RLS Enabled |
|-------|-----------------|-------------|
| `editai_assembly_jobs` | 5 policies | NO |
| `editai_clip_content` | 6 policies | NO |
| `editai_clips` | 6 policies | NO |
| `editai_pipelines` | 6 policies | NO |
| `editai_project_segments` | 6 policies | NO |
| `editai_projects` | 6 policies | NO |
| `editai_segments` | 1 policy | NO |
| `editai_source_videos` | 1 policy | NO |
| `editai_tts_assets` | 1 policy | NO |

**Note:** Migration `20260222192626_disable_rls_editai_tables` explicitly disabled RLS. This was likely done to fix API issues when the backend uses the service role key. However, the policies remain as dead code.

**Fix:** Either:
- Re-enable RLS (requires ensuring the backend uses the service role key for all queries, which bypasses RLS), or
- Delete the orphaned policies to reduce confusion

---

### 4. Missing FK on `editai_tts_assets.profile_id` (SEVERITY: MEDIUM)

The `editai_tts_assets` table has a `profile_id` column (NOT NULL) but **no foreign key constraint** to the `profiles` table. This means:
- Orphaned TTS assets can exist for deleted profiles
- No cascade delete when a profile is removed

All other `editai_*` tables have proper FK constraints to `profiles`.

---

## DATA INTEGRITY ISSUES

### 5. Inconsistent Cascade Delete on `editai_clips.profile_id` (SEVERITY: MEDIUM)

The FK `editai_clips_profile_id_fkey` uses `ON DELETE NO ACTION`, while most other tables use `ON DELETE CASCADE` for their `profile_id` FK.

**Current cascade behavior:**
| Table | profile_id FK | On Delete |
|-------|--------------|-----------|
| `editai_projects` | YES | CASCADE |
| `editai_clips` | YES | **NO ACTION** |
| `editai_segments` | YES | CASCADE |
| `editai_source_videos` | YES | CASCADE |
| `editai_pipelines` | YES | CASCADE |
| `editai_assembly_jobs` | YES | CASCADE |
| `editai_tts_assets` | NO FK | N/A |

**Impact:** If a profile is deleted, `editai_projects` cascade-deletes, which cascade-deletes `editai_clips` (via `project_id` FK). But if clips were somehow orphaned from their project, the `profile_id` FK would block profile deletion.

**Fix:** Alter `editai_clips_profile_id_fkey` to `ON DELETE CASCADE` for consistency.

---

### 6. Missing UNIQUE Constraint on `editai_clip_content.clip_id` (SEVERITY: MEDIUM)

The `editai_clip_content` table has a 1:1 relationship with `editai_clips` (the code uses `.single()` when querying by `clip_id`). However, there is **no UNIQUE constraint** on `clip_id` -- only a regular index.

**Impact:** Nothing prevents duplicate `editai_clip_content` rows for the same clip, which would cause `.single()` queries to throw errors.

**Fix:** Add `UNIQUE` constraint on `editai_clip_content.clip_id`.

---

### 7. No Status Value Constraints (CHECK) (SEVERITY: LOW)

Multiple tables have `status` text columns with no CHECK constraints to enforce valid values:

| Table | Status Column | Valid Values Used in Code |
|-------|--------------|--------------------------|
| `editai_projects` | `status` | draft, generating, ready_for_triage, failed |
| `editai_clips` | `final_status` | pending, rendering, completed, failed |
| `editai_exports` | `status` | pending, completed, failed |
| `editai_assembly_jobs` | `status` | processing, completed, failed |
| `editai_postiz_publications` | `status` | pending, scheduled, published |
| `editai_tts_assets` | `status` | ready, error |

**Impact:** Invalid status values could be written, causing frontend logic errors.

---

### 8. Stuck Status States (SEVERITY: MEDIUM)

If the server crashes mid-processing, these statuses can get permanently stuck:

- **`editai_projects.status = 'generating'`** -- The background task sets this on start. If the task crashes, no recovery mechanism resets it. The lock cleanup in `_generate_raw_clips_task` happens in `finally`, but the status update to `failed` might not execute if supabase is also down.

- **`editai_assembly_jobs.status = 'processing'`** -- Same pattern. The `expires_at` column exists (7-day default) but no cleanup job runs to mark expired jobs as failed.

- **`editai_pipelines` render_jobs** -- Individual variant render statuses stored in JSONB can get stuck at `processing` if the render task crashes.

**Fix:** Add a periodic cleanup task or startup hook that marks stale `generating`/`processing` records as `failed` based on `updated_at` age.

---

## PERFORMANCE ISSUES

### 9. N+1 Query Pattern in Product Groups Listing (SEVERITY: MEDIUM)

**Location:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, lines 1328-1347 and 1537-1553

Both `list_product_groups()` and `list_product_groups_bulk()` execute a separate count query **per group** to get `segments_count`:

```python
for g in result.data:
    seg_count = supabase.table("editai_segments")\
        .select("id", count="exact")\
        .eq("source_video_id", g["source_video_id"])\
        .eq("profile_id", profile.profile_id)\
        .eq("product_group", g["label"])\
        .execute()
```

With 10 product groups, this causes 11 queries (1 + 10 counts).

**Fix:** Use a single query with GROUP BY or a database view to compute counts.

---

### 10. N+1 Query Pattern in Segment Reassignment (SEVERITY: MEDIUM)

**Location:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, lines 262-289

`_reassign_all_segments()` fetches all segments, then for each segment:
1. Calls `_assign_product_group()` which queries all product groups
2. Updates the segment individually

With 50 segments and 5 groups, this is 50 * (1 group query + 1 update) = 100 extra queries.

**Fix:** Fetch groups once, compute assignments in Python, then batch-update.

---

### 11. Missing Pagination on Several List Endpoints (SEVERITY: LOW)

These endpoints return all matching rows with no pagination:

| Endpoint | Route File | Query |
|----------|-----------|-------|
| `GET /library/projects` | library_routes.py:434 | `.select("*")` with no limit |
| `GET /segments/` | segments_routes.py:862 | `.select("*")` with no limit |
| `GET /segments/source-videos/{id}/segments` | segments_routes.py:819 | `.select("*")` with no limit |

The pipeline list endpoint correctly uses `limit` (default 20).

**Impact:** Low for current data volumes (4 projects, 13 segments) but will degrade with growth.

---

### 12. Missing Indexes (SEVERITY: LOW)

| Table | Column | Used In | Index Exists |
|-------|--------|---------|-------------|
| `editai_clips` | `profile_id` | Multiple queries filter by profile_id | **NO** |
| `editai_clips` | `(project_id, is_deleted)` | Composite filter in generate-from-segments | **NO** (project_id alone is indexed) |
| `editai_segments` | `product_group` | Product group reassignment queries | **NO** |
| `editai_postiz_publications` | `clip_id` | Join queries from postiz routes | **NO** |
| `editai_exports` | `clip_id` | Export lookups | **NO** |
| `editai_product_groups` | `(source_video_id, profile_id)` | Most queries filter both | Partial (source_video_id composite exists but doesn't include profile_id) |

---

## SCHEMA DESIGN ISSUES

### 13. Redundant `user_id` Column on `editai_projects` (SEVERITY: LOW)

`editai_projects` has both `user_id` (FK to `auth.users`) and `profile_id` (FK to `profiles`). All API queries filter by `profile_id` exclusively. The `user_id` column is never written to by any current code and has indexes that are never used.

**Fix:** Consider deprecating `user_id` or removing the indexes.

---

### 14. Inconsistent Table Naming (SEVERITY: LOW)

Most Edit Factory tables use the `editai_` prefix, but some related tables do not:
- `profiles` (no prefix)
- `jobs` (no prefix)
- `api_costs` (no prefix)
- `elevenlabs_accounts` (no prefix)
- `product_feeds` (no prefix)
- `products_feed_old` (no prefix, plus "_old" suffix suggests a rename that was never cleaned up)
- `segment_product_associations` (no prefix)

This is cosmetic but makes it harder to identify which tables belong to the Edit Factory domain vs. other projects sharing the same Supabase instance (e.g., the ecommerce/UF tables).

---

### 15. `editai_product_groups` Missing Profile FK Constraint (SEVERITY: LOW)

The table has a `profile_id` column and an index on it, but no FK constraint to `profiles`. The `source_video_id` FK cascades correctly.

---

### 16. `editai_postiz_publications` Missing `profile_id` Column (SEVERITY: LOW)

The Postiz publications table has no `profile_id` column. Ownership is determined indirectly through `clip_id -> editai_clips -> editai_projects -> profile_id`. This works for reads (using `!inner` join) but makes direct profile-scoped queries impossible.

---

## SUPABASE-SPECIFIC ISSUES

### 17. Function Search Path Mutable (SEVERITY: WARN)

The Supabase security advisor flagged these functions with mutable `search_path`:
- `public.handle_updated_at`
- `editai.handle_updated_at`
- `editai.set_updated_at`

These are trigger functions. A mutable search path could theoretically allow a malicious schema to inject a different function.

**Fix:** Set `search_path = ''` on these functions.

---

### 18. Multiple RLS-Enabled Tables with No Policies (SEVERITY: INFO)

Several non-editai tables have RLS enabled but zero policies, effectively blocking all access:
- `abandoned_carts`, `addresses`, `api_keys`, `b2b_price_rules`, `coupons`, `gift_rules`, `outbound_webhook_configs`, `redirects`, `stock_movements`, `video_jobs`, `webhook_events`

These are ecommerce/UF tables and may be intentionally locked down, but if any frontend needs to read them, they will get empty results.

---

## SUMMARY

| Severity | Count | Issues |
|----------|-------|--------|
| **CRITICAL** | 3 | Ghost table reference, column mismatch, RLS not enabled |
| **MEDIUM** | 5 | Missing FK, inconsistent cascade, missing UNIQUE, stuck statuses, N+1 queries |
| **LOW** | 6 | No pagination, missing indexes, redundant columns, naming, missing constraints |
| **INFO** | 2 | Mutable search path, empty RLS policies |
| **Total** | 16 | |

### Recommended Priority Order

1. **Fix `editai_generation_progress` ghost table** -- Create migration or remove dead code
2. **Fix `editai_postiz_publications.platforms` column mismatch** -- Add column or fix code
3. **Decide on RLS strategy** -- Either re-enable RLS or remove dead policies
4. **Add UNIQUE on `editai_clip_content.clip_id`** -- Prevent data corruption
5. **Fix `editai_clips.profile_id` cascade to CASCADE** -- Consistency
6. **Add FK on `editai_tts_assets.profile_id`** -- Referential integrity
7. **Fix N+1 queries in product groups** -- Performance
8. **Add stale job cleanup** -- Operational reliability
9. **Add missing indexes** -- Performance (low priority at current scale)
