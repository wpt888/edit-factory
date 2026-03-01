# Database Audit Fix Report

**Date:** 2026-02-26
**Scope:** 4 fixes from audit-database.md (issues #1, #2, #3/#4/#5/#6, and TLS)

---

## Fix 1: Removed Ghost Table `editai_generation_progress` Code

**File:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`

**What changed:** Removed all Supabase DB persistence code from the three progress-tracking functions:
- `update_generation_progress()` -- removed the `supabase.table("editai_generation_progress").upsert(...)` call
- `get_generation_progress()` -- removed the DB fallback query that tried `supabase.table("editai_generation_progress").select(...)`
- `clear_generation_progress()` -- removed the `supabase.table("editai_generation_progress").delete(...)` call

All three functions now use only the in-memory `_generation_progress` dict, which is sufficient for the single-server deployment. The DB calls were silently failing on every request since the table never existed.

**Lines affected:** ~113-186 reduced to ~113-132 (54 lines removed)

---

## Fix 2: Fixed Column Mismatch `platforms` -> `platform`

**File:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/postiz_routes.py` (line 563)

**What changed:** The insert into `editai_postiz_publications` was writing `"platforms": result.platforms or []` (a list to a non-existent column). Changed to:
```python
"platform": ", ".join(result.platforms) if result.platforms else None,
```

This writes to the actual `platform` column (singular, text type) by joining the list of platform names with commas. For example, `["instagram", "tiktok"]` becomes `"instagram, tiktok"`.

---

## Fix 3: Supabase Migration — Schema Fixes + RLS Cleanup

**Migration name:** `fix_database_audit_issues`

### 3a. UNIQUE constraint on `editai_clip_content.clip_id`
- Dropped the existing non-unique index `idx_clip_content_clip_id`
- Added constraint `editai_clip_content_clip_id_unique` (UNIQUE on clip_id)
- Prevents duplicate content rows for the same clip, which would break `.single()` queries

### 3b. Fixed `editai_clips.profile_id` FK to ON DELETE CASCADE
- Dropped `editai_clips_profile_id_fkey` (was ON DELETE NO ACTION)
- Recreated with ON DELETE CASCADE for consistency with all other profile_id FKs

### 3c. Added FK on `editai_tts_assets.profile_id`
- Added `editai_tts_assets_profile_id_fkey` referencing `profiles(id)` ON DELETE CASCADE
- This was the only editai table missing a profile_id FK constraint

### 3d. Dropped 39 dead RLS policies
RLS is disabled on all editai tables, so all policies were dead code. Dropped all of them:

| Table | Policies Dropped |
|-------|-----------------|
| `editai_assembly_jobs` | 5 |
| `editai_clip_content` | 6 |
| `editai_clips` | 6 |
| `editai_pipelines` | 6 |
| `editai_project_segments` | 6 |
| `editai_projects` | 6 |
| `editai_segments` | 1 |
| `editai_source_videos` | 1 |
| `editai_tts_assets` | 1 |
| `editai.editai_postiz_publications` | 1 |
| **Total** | **39** |

---

## Fix 4: Removed TLS Verification Bypass

**File:** `/mnt/c/OBSID SRL/n8n/edit_factory/app/db.py` (line 23)

**What changed:** Removed `verify=False` from the httpx client used by the Supabase singleton. Changed from:
```python
httpx_client=httpx.Client(verify=False)
```
to:
```python
httpx_client=httpx.Client()
```

This restores proper TLS certificate verification for all Supabase API calls.

---

## Verification

1. **App startup:** `python -c "from app.main import app; print('OK')"` -- passes
2. **RLS policies:** `SELECT ... FROM pg_policies WHERE tablename LIKE 'editai_%'` -- returns 0 rows (all dropped)
3. **FK constraints:** Both `editai_clips_profile_id_fkey` and `editai_tts_assets_profile_id_fkey` show `confdeltype = 'c'` (CASCADE)
4. **UNIQUE constraint:** `editai_clip_content_clip_id_unique` index confirmed present

---

## Audit Issues NOT Addressed (out of scope)

- #7 Missing CHECK constraints on status columns (low severity)
- #8 Stuck status states / stale job cleanup (medium, needs background task design)
- #9-10 N+1 query patterns in product groups (performance, medium)
- #11 Missing pagination (low)
- #12 Missing indexes (low at current scale)
- #13-16 Schema design issues (low)
- #17 Mutable search_path on functions (warn)
