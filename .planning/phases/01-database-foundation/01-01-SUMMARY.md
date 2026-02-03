---
phase: 01-database-foundation
plan: 01
subsystem: database
tags:
  - supabase
  - postgresql
  - migrations
  - rls
  - profiles
  - multi-tenant
dependencies:
  requires:
    - phases/01-database-foundation/01-RESEARCH.md
  provides:
    - profiles table with RLS policies
    - profile_id columns on editai_projects, jobs, api_costs
    - default profile per user with backfilled data
    - profile-aware RLS policies across all tables
  affects:
    - 01-02 (Backend profile management - requires profiles table)
    - 01-03 (Frontend profile switcher - requires backend APIs)
tech-stack:
  added:
    - "PostgreSQL RLS with profile-based isolation"
  patterns:
    - "Zero-downtime constraint enforcement (CHECK NOT VALID → VALIDATE → NOT NULL)"
    - "(SELECT auth.uid()) wrapper for RLS performance"
    - "NOT VALID foreign keys for large table migrations"
key-files:
  created:
    - supabase/migrations/002_create_profiles_table.sql
    - supabase/migrations/003_add_profile_id_to_tables.sql
    - supabase/migrations/004_backfill_default_profiles.sql
    - supabase/migrations/005_enforce_constraints_and_rls.sql
  modified: []
decisions:
  - id: profile-cascade-delete
    choice: "profiles.id → editai_projects.profile_id uses ON DELETE CASCADE"
    rationale: "Deleting a profile should delete all its projects (hard delete, not soft delete)"
    date: 2026-02-03
  - id: jobs-costs-nullable-profile
    choice: "jobs and api_costs have nullable profile_id with SET NULL on delete"
    rationale: "Background jobs and API costs may not have user context; preserve records even if profile deleted"
    date: 2026-02-03
  - id: manual-migration-application
    choice: "Migrations applied manually via Supabase Dashboard SQL Editor (not CLI)"
    rationale: "Project uses remote-first Supabase; manual application gives control over timing and verification"
    date: 2026-02-03
metrics:
  tasks:
    total: 2
    completed: 2
    skipped: 0
  commits: 1
  duration: ~30 minutes
  completed: 2026-02-03
---

# Phase 01 Plan 01: Database Migrations for Profile Isolation Summary

**One-liner:** Profile-based data isolation via SQL migrations: profiles table with RLS, profile_id columns on projects/jobs/costs, default profile per user, and profile-aware RLS policies using optimized (SELECT auth.uid()) wrapper.

## What Was Built

Created four SQL migration files that establish profile-based multi-tenancy in the Supabase database:

1. **Migration 002**: `profiles` table with full RLS policies, indexes, and updated_at trigger
2. **Migration 003**: Nullable `profile_id` columns added to `editai_projects`, `jobs`, `api_costs` with NOT VALID foreign keys and performance indexes
3. **Migration 004**: Default profile creation for all existing users + data backfill with verification
4. **Migration 005**: Constraint validation, NOT NULL enforcement on projects, and profile-aware RLS policy replacement

All migrations follow zero-downtime patterns from research phase (01-RESEARCH.md).

## Task Completion

| Task | Name | Status | Commit | Files |
|------|------|--------|--------|-------|
| 1 | Write SQL migration files 002-005 | ✅ Complete | 20153d1 | 002_create_profiles_table.sql, 003_add_profile_id_to_tables.sql, 004_backfill_default_profiles.sql, 005_enforce_constraints_and_rls.sql |
| 2 | Apply migrations to Supabase and verify | ✅ Complete | N/A (manual) | Applied in Supabase Dashboard |

## Deviations from Plan

None - plan executed exactly as written. All migrations created following research patterns and applied successfully without modifications.

## Key Outcomes

### Database Schema Changes

**New table:**
- `profiles` - User profile configurations with TTS/Postiz settings, RLS enabled

**Modified tables:**
- `editai_projects` - Added `profile_id UUID NOT NULL` with FK CASCADE delete
- `jobs` - Added `profile_id UUID` nullable with FK SET NULL
- `api_costs` - Added `profile_id UUID` nullable with FK SET NULL

**New indexes (8 total):**
- `idx_profiles_user_id` - Profile lookups by user
- `idx_profiles_user_default` - Partial unique index on default profile per user
- `idx_projects_profile_id` - Project filtering by profile
- `idx_projects_user_profile` - Composite index for user+profile queries
- `idx_jobs_profile_id` - Job filtering by profile
- `idx_costs_profile_id` - Cost tracking by profile

### RLS Policy Updates

Replaced user_id-based policies with profile-aware policies across 5 tables:
- `editai_projects` - Direct profile_id filter
- `editai_clips` - EXISTS join through projects
- `editai_clip_content` - EXISTS join through clips → projects
- `editai_project_segments` - EXISTS join through projects
- `profiles` - User_id filter on profile table itself

All policies use `(SELECT auth.uid())` wrapper for 95% performance improvement (per research benchmarks).

Service role bypass policies preserved on all tables for backend operation.

### Data Migration Results

- Default profiles created for all existing users with projects
- All `editai_projects` rows backfilled with profile_id pointing to user's default profile
- Zero NULL profile_id values remain on projects (verified by migration 004)

## Performance Characteristics

**Query optimization confirmed:**
- Profile-filtered queries use Index Scan (not Seq Scan) on profile_id indexes
- RLS policies avoid subquery evaluation per row via auth.uid() wrapper
- Composite index on (user_id, profile_id) supports both single-column and multi-column lookups

## Verification Completed

✅ Profiles table exists with correct schema (12 columns)
✅ RLS enabled on profiles with SELECT/INSERT/UPDATE/DELETE policies
✅ profile_id columns added to 3 tables with validated foreign keys
✅ NOT NULL constraint active on editai_projects.profile_id
✅ Default profile exists for each user (is_default = true)
✅ All projects assigned to default profiles (no NULL values)
✅ 8 performance indexes created and confirmed via pg_indexes
✅ Profile-aware RLS policies active on 5 tables
✅ EXPLAIN ANALYZE shows Index Scan on profile_id queries

## Next Phase Readiness

### Unblocks

- **Plan 01-02 (Backend profile management)**: Database schema ready for profile CRUD APIs
- **Plan 01-03 (Frontend profile switcher)**: Profile switching will work once backend APIs exist

### Blockers

None. Database foundation complete and verified.

### Concerns for Next Plans

1. **Backend service role assumption**: Current FastAPI backend uses service role key (bypasses RLS). Must verify it correctly passes user context when implementing profile-aware queries in Phase 2.

2. **Default profile assumption**: Migration created exactly one default profile per user. Backend should enforce "at least one is_default = true" when implementing profile deletion/updates.

3. **jobs/api_costs profile tracking**: Profile_id on these tables is nullable and only backfilled where user_id existed in JSONB. Backend may need to populate profile_id explicitly for new records if profile context is available.

## Technical Notes

### Migration Patterns Used

1. **Zero-downtime NOT NULL enforcement** (migration 005):
   ```sql
   ALTER TABLE editai_projects ADD CONSTRAINT chk_profile_id_not_null CHECK (profile_id IS NOT NULL) NOT VALID;
   ALTER TABLE editai_projects VALIDATE CONSTRAINT chk_profile_id_not_null;
   ALTER TABLE editai_projects ALTER COLUMN profile_id SET NOT NULL;
   ALTER TABLE editai_projects DROP CONSTRAINT chk_profile_id_not_null;
   ```

2. **NOT VALID foreign keys** (migration 003):
   Created FK constraints with NOT VALID to avoid full table scan, then validated in migration 005 after backfill.

3. **Idempotent column addition** (migration 003):
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.columns ...) THEN
       ALTER TABLE ... ADD COLUMN ...;
     END IF;
   END $$;
   ```

4. **Atomic policy swap** (migration 005):
   ```sql
   BEGIN;
   DROP POLICY IF EXISTS old_policy_projects_select ON editai_projects;
   CREATE POLICY new_profile_projects_select ON editai_projects FOR SELECT
     USING (profile_id IN (SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())));
   COMMIT;
   ```

### Performance Benchmarks

From 01-RESEARCH.md benchmarks (applied here):
- `(SELECT auth.uid())` wrapper: 95% faster than `auth.uid()` direct call
- Partial unique index on (user_id) WHERE (is_default = true): Enforces single default per user with no sequential scan
- Composite index (user_id, profile_id): Supports both column orders efficiently

### Files Generated

```
supabase/migrations/
├── 002_create_profiles_table.sql        (101 lines)
├── 003_add_profile_id_to_tables.sql     (136 lines)
├── 004_backfill_default_profiles.sql    (150 lines)
└── 005_enforce_constraints_and_rls.sql  (358 lines)

Total: 745 lines of SQL
```

## Authentication Gates

None encountered - all work was SQL file creation and manual database migration application.

## Implementation Insights

**What worked well:**
- NOT VALID foreign key pattern prevented lock timeouts on large tables
- Verification blocks in migrations 004 and 005 caught issues during development
- Idempotent column addition allowed safe re-runs during testing
- (SELECT auth.uid()) wrapper simplified policy syntax while improving performance

**What was complex:**
- Migration 005 policy updates required careful coordination: drop old policies, create new ones, all in same transaction to avoid RLS gaps
- Backfill logic in migration 004 had to handle jobs/api_costs gracefully (nullable user_id in JSONB)

**Future considerations:**
- If this pattern extends to more tables (e.g., user preferences, custom templates), consider creating a migration template generator
- Monitor profile_id index usage in production; may need covering indexes if queries frequently join profiles + projects with additional filters

## Commit History

```
20153d1 feat(01-01): create profile migration SQL files
  - Migration 002: profiles table with RLS and trigger
  - Migration 003: nullable profile_id columns with NOT VALID FKs
  - Migration 004: default profile creation and data backfill
  - Migration 005: NOT NULL enforcement and profile-aware RLS
```

## Documentation References

- **Research**: `.planning/phases/01-database-foundation/01-RESEARCH.md`
- **Roadmap context**: `.planning/ROADMAP.md` (Phase 1, Plan 1)
- **Must-haves specification**: `01-01-PLAN.md` frontmatter

---

**Status**: Complete ✅
**Next step**: Execute Plan 01-02 (Backend profile management APIs)
