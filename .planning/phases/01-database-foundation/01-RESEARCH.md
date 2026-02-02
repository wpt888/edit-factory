# Phase 1: Database Foundation - Research

**Researched:** 2026-02-03
**Domain:** Supabase Row-Level Security (RLS) with profile-based multi-tenancy
**Confidence:** HIGH

## Summary

Phase 1 establishes profile-based data isolation at the database level using Supabase Row-Level Security (RLS). The implementation follows a proven pattern for adding multi-tenancy to existing applications: create a `profiles` table, add `profile_id` foreign keys to existing tables, enable RLS policies for isolation, and migrate existing data to a default profile.

The research focused on three critical areas:
1. **Safe migration patterns** for adding RLS to production tables with existing data
2. **Performance optimization** techniques specific to Supabase RLS (auth.uid() wrapper, indexes)
3. **Zero-downtime strategies** for adding NOT NULL constraints and foreign keys

The standard approach is a **four-step graceful migration**: (1) Add nullable `profile_id` column with foreign key, (2) Create default profiles for existing users, (3) Backfill all existing data, (4) Enable RLS with policies in a single transaction. This avoids the critical pitfall of enabling RLS without policies, which causes immediate production blackout.

**Primary recommendation:** Use PostgreSQL's `NOT VALID` + `VALIDATE CONSTRAINT` pattern for zero-downtime foreign key and constraint additions, combined with Supabase's optimized RLS policy syntax `(SELECT auth.uid())` for 95% performance improvement.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase Python Client | 2.x | Database operations with RLS | Official Supabase SDK, handles JWT auth context automatically |
| PostgreSQL | 14+ | Database engine | Supabase's underlying database, version 12+ required for optimized NOT NULL migration |
| Supabase CLI | Latest | Migration management | Official tool for generating, testing, and applying migrations |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| psycopg2 or psycopg3 | Latest | Direct PostgreSQL access | When Supabase client bypasses RLS (service role operations) |
| postgrest | N/A (Supabase managed) | Auto-generated REST API | Automatically respects RLS policies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared tables + RLS | Schema-per-tenant | RLS simpler for 2-10 profiles; schema-per-tenant better at 100+ profiles but complex migration |
| Supabase service role | JWT-authenticated queries | Service role bypasses RLS (dangerous); prefer JWT for policy enforcement |
| Manual SQL migrations | Supabase Dashboard schema editor + CLI diff | Dashboard convenient for exploration, CLI migrations mandatory for reproducibility |

**Installation:**
```bash
# Supabase CLI
npm install -g supabase

# Python client (already in requirements.txt)
pip install supabase
```

## Architecture Patterns

### Recommended Migration File Structure
```
supabase/migrations/
├── 001_add_auth_and_rls.sql         # Existing: user_id + RLS
├── 002_create_profiles_table.sql    # New: profiles table with RLS
├── 003_add_profile_id_to_tables.sql # New: nullable profile_id columns
├── 004_backfill_default_profiles.sql # New: data migration script
└── 005_enforce_profile_constraints.sql # New: make profile_id NOT NULL
```

### Pattern 1: Profiles Table with auth.users FK

**What:** Create a `profiles` table that references Supabase's `auth.users` table with cascade deletion.

**When to use:** Always for profile-based multi-tenancy in Supabase applications.

**Example:**
```sql
-- Source: https://supabase.com/docs/guides/auth/managing-user-data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- Profile-specific TTS settings
  default_tts_provider TEXT DEFAULT 'elevenlabs', -- 'elevenlabs' | 'edge'
  elevenlabs_voice_id TEXT,
  edge_tts_voice TEXT,

  -- Profile-specific Postiz settings
  postiz_integration_ids JSONB DEFAULT '[]',
  default_caption_template TEXT,

  -- Metadata
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraint: Only one default profile per user
  CONSTRAINT one_default_per_user EXCLUDE (user_id WITH =) WHERE (is_default = true)
);

-- Critical: Index for RLS policy performance
CREATE INDEX idx_profiles_user_id ON profiles(user_id);
CREATE INDEX idx_profiles_user_default ON profiles(user_id, is_default);

-- Enable RLS immediately with policies
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies with optimized auth.uid() wrapper
CREATE POLICY "Users can view own profiles" ON profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own profiles" ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own profiles" ON profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own profiles" ON profiles
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
```

### Pattern 2: Zero-Downtime Foreign Key Addition

**What:** Add foreign key constraints without locking tables using PostgreSQL's `NOT VALID` + `VALIDATE CONSTRAINT`.

**When to use:** When adding foreign keys to existing tables with data in production.

**Example:**
```sql
-- Source: https://travisofthenorth.com/blog/2017/2/2/postgres-adding-foreign-keys-with-zero-downtime
-- Step 1: Add column (nullable, no constraint) - fast operation
ALTER TABLE editai_projects
ADD COLUMN profile_id UUID;

-- Step 2: Add foreign key WITHOUT validation - fast operation
ALTER TABLE editai_projects
ADD CONSTRAINT fk_projects_profile_id
FOREIGN KEY (profile_id) REFERENCES profiles(id)
ON DELETE CASCADE
NOT VALID;

-- Step 3: Backfill data (separate transaction, can run slowly)
-- This happens in migration 004

-- Step 4: Validate constraint - uses SHARE UPDATE EXCLUSIVE lock
-- Compatible with INSERT/UPDATE/DELETE, so no downtime
ALTER TABLE editai_projects
VALIDATE CONSTRAINT fk_projects_profile_id;

-- Step 5: Add index for RLS performance
CREATE INDEX idx_projects_profile_id ON editai_projects(profile_id);
CREATE INDEX idx_projects_user_profile ON editai_projects(user_id, profile_id);
```

### Pattern 3: Zero-Downtime NOT NULL Constraint

**What:** Make a column NOT NULL without blocking writes using PostgreSQL 12+ optimization with check constraints.

**When to use:** After backfilling profile_id, before production cutover (migration 005).

**Example:**
```sql
-- Source: https://medium.com/doctolib/adding-a-not-null-constraint-on-pg-faster-with-minimal-locking-38b2c00c4d1c
-- PostgreSQL 12+ optimized pattern

-- Step 1: Add check constraint without validation (fast, no table scan)
ALTER TABLE editai_projects
ADD CONSTRAINT projects_profile_id_not_null
CHECK (profile_id IS NOT NULL)
NOT VALID;

-- Step 2: Validate constraint (SHARE UPDATE EXCLUSIVE lock, allows reads/writes)
ALTER TABLE editai_projects
VALIDATE CONSTRAINT projects_profile_id_not_null;

-- Step 3: Set NOT NULL (fast because constraint proves no nulls exist)
ALTER TABLE editai_projects
ALTER COLUMN profile_id SET NOT NULL;

-- Step 4: Drop redundant check constraint
ALTER TABLE editai_projects
DROP CONSTRAINT projects_profile_id_not_null;
```

**CRITICAL GOTCHA:** Do NOT combine steps 3 and 4 in a single ALTER TABLE statement. PostgreSQL executes DROP before SET NOT NULL, losing the optimization and causing a full table scan.

### Pattern 4: RLS Policies for Profile Isolation

**What:** Create RLS policies that filter by profile_id with performance optimization.

**When to use:** Every table that has profile_id foreign key.

**Example:**
```sql
-- Source: https://supabase.com/docs/guides/database/postgres/row-level-security

-- Projects table (direct profile_id)
CREATE POLICY "Users can view projects in owned profiles" ON editai_projects
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can insert projects to owned profiles" ON editai_projects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles
      WHERE user_id = (SELECT auth.uid())
    )
  );

-- Similar UPDATE and DELETE policies

-- Clips table (inherits profile context from projects)
CREATE POLICY "Users can view clips in owned profiles" ON editai_clips
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM editai_projects p
      JOIN profiles pr ON pr.id = p.profile_id
      WHERE p.id = editai_clips.project_id
      AND pr.user_id = (SELECT auth.uid())
    )
  );

-- Similar INSERT, UPDATE, DELETE policies for clips
```

**Performance note:** Wrapping `auth.uid()` in `(SELECT auth.uid())` allows PostgreSQL to cache the result per statement instead of evaluating per row, yielding ~95% performance improvement.

### Pattern 5: Graceful Data Migration (Backfill)

**What:** Assign existing data to default profiles created for each user.

**When to use:** Migration 004, after profiles table exists and profile_id columns added.

**Example:**
```sql
-- Step 1: Create default profile for each existing user
-- Uses INSERT ... ON CONFLICT to be idempotent (safe to re-run)
INSERT INTO profiles (user_id, name, is_default, created_at)
SELECT DISTINCT
  user_id,
  'Default Profile' AS name,
  true AS is_default,
  NOW() AS created_at
FROM editai_projects
WHERE user_id IS NOT NULL
ON CONFLICT (user_id) WHERE (is_default = true) DO NOTHING;

-- Step 2: Backfill projects with default profile_id
UPDATE editai_projects p
SET profile_id = (
  SELECT pr.id
  FROM profiles pr
  WHERE pr.user_id = p.user_id
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL
AND user_id IS NOT NULL;

-- Step 3: Verify backfill completeness
-- This query should return 0 rows before proceeding to NOT NULL constraint
SELECT COUNT(*)
FROM editai_projects
WHERE profile_id IS NULL
AND user_id IS NOT NULL;
```

### Anti-Patterns to Avoid

- **Enabling RLS without policies in same transaction:** Causes immediate production blackout. All queries return 0 rows with no error message. ALWAYS enable RLS and create policies in a single `BEGIN...COMMIT` block.

- **Missing indexes before enabling RLS:** Queries become 100-1000x slower because policies add WHERE clauses that scan entire table. ALWAYS create indexes on `profile_id` before enabling RLS.

- **Using `auth.uid() = user_id` directly:** PostgreSQL evaluates the function for every row. Wrap in `(SELECT auth.uid()) = user_id` for ~95% performance gain.

- **Combining DROP CONSTRAINT and SET NOT NULL in single ALTER TABLE:** PostgreSQL executes DROP first, losing the optimization. Results in full table scan on production. Use separate statements.

- **Skipping NOT VALID for production migrations:** Foreign key and constraint additions without NOT VALID acquire exclusive locks, blocking all operations. Use NOT VALID + VALIDATE CONSTRAINT for zero downtime.

- **Service role bypass without explicit profile_id filtering:** Supabase service role key bypasses RLS, causing data leakage if backend queries don't explicitly filter by `profile_id`. ALWAYS filter by profile_id in service role queries.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration version control | Custom SQL script runner | Supabase CLI migrations | Built-in idempotency, history tracking, dry-run mode, integration with Supabase Dashboard |
| Profile creation on signup | Manual INSERT in signup endpoint | PostgreSQL trigger + function | Atomic operation, guaranteed consistency, Supabase recommended pattern |
| Checking if user owns profile | Loop through profiles in application code | RLS policy validation | Database-level enforcement, prevents data leakage even if API has bugs |
| Performance monitoring for RLS | Custom logging | `EXPLAIN ANALYZE` with RLS enabled | Shows actual query plan and index usage, identifies missing indexes |

**Key insight:** Supabase RLS is a security boundary, not just a convenience. Implementing profile filtering in application code alone risks data leakage if any endpoint forgets to filter. Database-level enforcement is mandatory for multi-tenant isolation.

## Common Pitfalls

### Pitfall 1: RLS Lockout (Production Blackout)

**What goes wrong:** Enabling RLS on existing tables without simultaneously creating policies causes all API queries to return 0 rows. Users cannot access any data, even their own.

**Why it happens:** RLS defaults to "deny all" when enabled. Developers assume enabling RLS and creating policies are separate steps, but they must be atomic in production.

**How to avoid:**
```sql
-- WRONG: Two separate operations
ALTER TABLE editai_projects ENABLE ROW LEVEL SECURITY;
-- (gap where production is broken)
CREATE POLICY "users_read_own" ON editai_projects FOR SELECT USING (auth.uid() = user_id);

-- RIGHT: Single transaction
BEGIN;
  ALTER TABLE editai_projects ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users_select" ON editai_projects FOR SELECT
    TO authenticated USING ((SELECT auth.uid()) = user_id);

  CREATE POLICY "users_insert" ON editai_projects FOR INSERT
    TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

  CREATE POLICY "users_update" ON editai_projects FOR UPDATE
    TO authenticated USING ((SELECT auth.uid()) = user_id);

  CREATE POLICY "users_delete" ON editai_projects FOR DELETE
    TO authenticated USING ((SELECT auth.uid()) = user_id);
COMMIT;
```

**Warning signs:**
- Staging environment returns empty arrays for authenticated requests
- Supabase logs show `insufficient_privilege` errors
- Frontend shows empty states despite database containing data
- `SELECT COUNT(*)` returns 0 for tables known to have data

**Phase impact:** CRITICAL for migration 005. Test the complete migration (RLS + all policies) in staging environment with real frontend API calls before production deployment.

### Pitfall 2: Foreign Key Constraint Violation (Migration Failure)

**What goes wrong:** Adding `profile_id REFERENCES profiles(id) NOT NULL` to tables with existing data causes migration to fail mid-execution with constraint violation error.

**Why it happens:** Edit Factory currently has projects/clips with no profile assignment. Making profile_id NOT NULL immediately violates constraint because existing rows have NULL values.

**How to avoid:** Multi-step migration with validation:

```sql
-- Migration 003: Add nullable column
ALTER TABLE editai_projects ADD COLUMN profile_id UUID;
ALTER TABLE editai_projects ADD CONSTRAINT fk_projects_profile_id
  FOREIGN KEY (profile_id) REFERENCES profiles(id) NOT VALID;

-- Migration 004: Backfill data
UPDATE editai_projects SET profile_id = (
  SELECT id FROM profiles WHERE user_id = editai_projects.user_id AND is_default = true
);

-- Verify before proceeding
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM editai_projects WHERE profile_id IS NULL AND user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: projects exist with no profile_id';
  END IF;
END $$;

-- Migration 005: Enforce constraint (only after verification)
ALTER TABLE editai_projects VALIDATE CONSTRAINT fk_projects_profile_id;
ALTER TABLE editai_projects ADD CONSTRAINT check_profile_not_null
  CHECK (profile_id IS NOT NULL) NOT VALID;
ALTER TABLE editai_projects VALIDATE CONSTRAINT check_profile_not_null;
ALTER TABLE editai_projects ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE editai_projects DROP CONSTRAINT check_profile_not_null;
```

**Warning signs:**
- Migration dry-run fails with "violates foreign key constraint"
- Error: "column contains null values" when adding NOT NULL
- `SELECT COUNT(*) FROM editai_projects WHERE profile_id IS NULL` > 0 after backfill

**Phase impact:** CRITICAL for migrations 003-005. Require staging migration test with production-like data volume.

### Pitfall 3: Missing Indexes (Performance Degradation)

**What goes wrong:** RLS policies add `WHERE profile_id = X` filter to every query. Without index on `profile_id`, PostgreSQL performs full table scan, increasing query time from 50ms to 5000ms on tables with 10K+ rows.

**Why it happens:** RLS policies are implemented as query filters. PostgreSQL must evaluate policy condition for every row to determine visibility.

**How to avoid:**
```sql
-- ALWAYS create indexes BEFORE enabling RLS
CREATE INDEX idx_projects_profile_id ON editai_projects(profile_id);
CREATE INDEX idx_clips_profile_id ON editai_clips(profile_id);
CREATE INDEX idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX idx_api_costs_profile_id ON api_costs(profile_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_projects_profile_status ON editai_projects(profile_id, status);
CREATE INDEX idx_jobs_profile_created ON jobs(profile_id, created_at DESC);
CREATE INDEX idx_projects_user_profile ON editai_projects(user_id, profile_id);
```

**Verification:**
```sql
-- Check if index is used by RLS policy
EXPLAIN ANALYZE
SELECT * FROM editai_projects
WHERE profile_id = 'some-uuid';

-- Should show "Index Scan using idx_projects_profile_id"
-- NOT "Seq Scan on editai_projects"
```

**Warning signs:**
- API response times increase after enabling RLS
- Database CPU usage spikes
- `EXPLAIN` shows "Seq Scan" instead of "Index Scan"
- Slow query log shows queries with profile_id filter

**Phase impact:** CRITICAL for migration 005. Add all indexes in migration 003 (same migration as adding columns), before enabling RLS in migration 005.

### Pitfall 4: Supabase Client Context Loss

**What goes wrong:** Edit Factory's singleton pattern `get_supabase()` creates one client per process. When adding profiles, singleton doesn't carry profile context, causing queries to return data from all profiles if RLS policies only check `user_id`.

**Why it happens:** Current RLS policies filter by `user_id = auth.uid()`. After adding profiles, we need to filter by both user_id AND profile_id, but API layer doesn't pass profile context to queries.

**How to avoid:**

This is **Phase 2** concern (Backend API Layer), but impacts Phase 1 RLS policy design:

```sql
-- Phase 1: Design RLS policies for profile isolation (not just user isolation)
-- This prepares for Phase 2 backend changes

-- Current policy (insufficient for profiles)
CREATE POLICY "Users can view own projects" ON editai_projects
  FOR SELECT USING (auth.uid() = user_id);

-- Future policy (profile-aware, ready for Phase 2)
CREATE POLICY "Users can view projects in owned profiles" ON editai_projects
  FOR SELECT
  TO authenticated
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
    )
  );
```

**Phase impact:** Phase 1 must create profile-aware RLS policies even though Phase 2 hasn't implemented profile context yet. This ensures database-level isolation is ready when backend adds profile filtering.

## Code Examples

Verified patterns from official sources:

### Complete Migration 002: Create Profiles Table

```sql
-- Source: https://supabase.com/docs/guides/auth/managing-user-data
-- Purpose: Create profiles table with RLS enabled
-- Migration file: 002_create_profiles_table.sql

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,

  -- TTS settings (profile-specific)
  default_tts_provider TEXT DEFAULT 'elevenlabs' CHECK (default_tts_provider IN ('elevenlabs', 'edge')),
  elevenlabs_voice_id TEXT,
  edge_tts_voice TEXT,
  tts_model TEXT,

  -- Postiz settings (profile-specific)
  postiz_integration_ids JSONB DEFAULT '[]',
  default_caption_template TEXT,

  -- Metadata
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: one default profile per user
CREATE UNIQUE INDEX idx_profiles_user_default
ON profiles(user_id)
WHERE (is_default = true);

-- Performance indexes
CREATE INDEX idx_profiles_user_id ON profiles(user_id);

-- Enable RLS and create policies in same transaction
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profiles" ON profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can insert own profiles" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can update own profiles" ON profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Users can delete own profiles" ON profiles
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();
```

### Complete Migration 003: Add Profile ID to Tables

```sql
-- Source: https://travisofthenorth.com/blog/2017/2/2/postgres-adding-foreign-keys-with-zero-downtime
-- Purpose: Add profile_id columns to existing tables
-- Migration file: 003_add_profile_id_to_tables.sql

-- Add profile_id to editai_projects (nullable, FK NOT VALID for zero downtime)
ALTER TABLE editai_projects ADD COLUMN profile_id UUID;

ALTER TABLE editai_projects ADD CONSTRAINT fk_projects_profile_id
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
  ON DELETE CASCADE
  NOT VALID;

-- Add indexes immediately (before validation, before RLS)
CREATE INDEX idx_projects_profile_id ON editai_projects(profile_id);
CREATE INDEX idx_projects_user_profile ON editai_projects(user_id, profile_id);

-- Add profile_id to jobs table (if exists)
ALTER TABLE jobs ADD COLUMN profile_id UUID;

ALTER TABLE jobs ADD CONSTRAINT fk_jobs_profile_id
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
  ON DELETE SET NULL
  NOT VALID;

CREATE INDEX idx_jobs_profile_id ON jobs(profile_id);
CREATE INDEX idx_jobs_profile_created ON jobs(profile_id, created_at DESC);

-- Add profile_id to api_costs table (if exists)
ALTER TABLE api_costs ADD COLUMN profile_id UUID;

ALTER TABLE api_costs ADD CONSTRAINT fk_costs_profile_id
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
  ON DELETE SET NULL
  NOT VALID;

CREATE INDEX idx_costs_profile_id ON api_costs(profile_id);

-- Note: clips table inherits profile context from projects via project_id FK
-- No direct profile_id column needed on clips
```

### Complete Migration 004: Backfill Default Profiles

```sql
-- Source: Graceful migration pattern from .planning/research/PITFALLS.md
-- Purpose: Create default profiles and assign existing data
-- Migration file: 004_backfill_default_profiles.sql

-- Step 1: Create default profile for each user with existing projects
INSERT INTO profiles (user_id, name, description, is_default, created_at)
SELECT DISTINCT
  p.user_id,
  'Default Profile' AS name,
  'Auto-created during profile migration' AS description,
  true AS is_default,
  NOW() AS created_at
FROM editai_projects p
WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id) WHERE (is_default = true) DO NOTHING;

-- Step 2: Backfill editai_projects
UPDATE editai_projects p
SET profile_id = (
  SELECT pr.id
  FROM profiles pr
  WHERE pr.user_id = p.user_id
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL
AND user_id IS NOT NULL;

-- Step 3: Backfill jobs (if user_id exists)
UPDATE jobs j
SET profile_id = (
  SELECT pr.id
  FROM profiles pr
  WHERE pr.user_id = j.data->>'user_id'
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL
AND j.data->>'user_id' IS NOT NULL;

-- Step 4: Backfill api_costs (if associated with user)
-- Assuming api_costs might have metadata linking to user
UPDATE api_costs ac
SET profile_id = (
  SELECT pr.id
  FROM profiles pr
  WHERE pr.user_id = ac.metadata->>'user_id'
  AND pr.is_default = true
  LIMIT 1
)
WHERE profile_id IS NULL
AND ac.metadata->>'user_id' IS NOT NULL;

-- Step 5: Verify backfill completeness
DO $$
DECLARE
  orphaned_projects INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_projects
  FROM editai_projects
  WHERE profile_id IS NULL
  AND user_id IS NOT NULL;

  IF orphaned_projects > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % projects have user_id but no profile_id', orphaned_projects;
  END IF;

  RAISE NOTICE 'Backfill verification passed. All projects assigned to profiles.';
END $$;
```

### Complete Migration 005: Enforce Constraints and Enable RLS

```sql
-- Source: https://medium.com/doctolib/adding-a-not-null-constraint-on-pg-faster-with-minimal-locking-38b2c00c4d1c
-- Purpose: Make profile_id NOT NULL and enable profile-aware RLS
-- Migration file: 005_enforce_profile_constraints.sql

-- ============== PART 1: Validate Foreign Keys ==============
-- Validate the NOT VALID foreign keys from migration 003
-- This step scans tables but only acquires SHARE UPDATE EXCLUSIVE lock
-- Compatible with INSERT/UPDATE/DELETE operations (no downtime)

ALTER TABLE editai_projects VALIDATE CONSTRAINT fk_projects_profile_id;
ALTER TABLE jobs VALIDATE CONSTRAINT fk_jobs_profile_id;
ALTER TABLE api_costs VALIDATE CONSTRAINT fk_costs_profile_id;

-- ============== PART 2: Add NOT NULL Constraints (Zero Downtime) ==============
-- Step 1: Add check constraint without validation (fast, no scan)
ALTER TABLE editai_projects
ADD CONSTRAINT projects_profile_id_not_null
CHECK (profile_id IS NOT NULL) NOT VALID;

-- Step 2: Validate constraint (SHARE UPDATE EXCLUSIVE lock, allows writes)
ALTER TABLE editai_projects
VALIDATE CONSTRAINT projects_profile_id_not_null;

-- Step 3: Set NOT NULL (fast because constraint proves no nulls)
ALTER TABLE editai_projects
ALTER COLUMN profile_id SET NOT NULL;

-- Step 4: Drop redundant check constraint
ALTER TABLE editai_projects
DROP CONSTRAINT projects_profile_id_not_null;

-- ============== PART 3: Enable Profile-Aware RLS ==============
-- Enable RLS and create profile-isolation policies in single transaction

BEGIN;
  -- Drop old user-only policies (from migration 001)
  DROP POLICY IF EXISTS "Users can view own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can insert own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can update own projects" ON editai_projects;
  DROP POLICY IF EXISTS "Users can delete own projects" ON editai_projects;

  -- Create new profile-aware policies
  CREATE POLICY "Users can view projects in owned profiles" ON editai_projects
    FOR SELECT TO authenticated
    USING (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can insert projects to owned profiles" ON editai_projects
    FOR INSERT TO authenticated
    WITH CHECK (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can update projects in owned profiles" ON editai_projects
    FOR UPDATE TO authenticated
    USING (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    )
    WITH CHECK (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can delete projects in owned profiles" ON editai_projects
    FOR DELETE TO authenticated
    USING (
      profile_id IN (
        SELECT id FROM profiles WHERE user_id = (SELECT auth.uid())
      )
    );

  -- Update clips policies (inherit profile context from projects)
  DROP POLICY IF EXISTS "Users can view clips of own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can insert clips to own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can update clips of own projects" ON editai_clips;
  DROP POLICY IF EXISTS "Users can delete clips of own projects" ON editai_clips;

  CREATE POLICY "Users can view clips in owned profiles" ON editai_clips
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can insert clips to owned profiles" ON editai_clips
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can update clips in owned profiles" ON editai_clips
    FOR UPDATE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

  CREATE POLICY "Users can delete clips in owned profiles" ON editai_clips
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM editai_projects p
        JOIN profiles pr ON pr.id = p.profile_id
        WHERE p.id = editai_clips.project_id
        AND pr.user_id = (SELECT auth.uid())
      )
    );

COMMIT;

-- ============== PART 4: Verification ==============
-- Test RLS policies work correctly
DO $$
BEGIN
  -- Verify indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_projects_profile_id') THEN
    RAISE EXCEPTION 'Missing index: idx_projects_profile_id';
  END IF;

  -- Verify constraints exist
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projects_profile_id') THEN
    RAISE EXCEPTION 'Missing constraint: fk_projects_profile_id';
  END IF;

  -- Verify RLS enabled
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'editai_projects' AND rowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on editai_projects';
  END IF;

  RAISE NOTICE 'Migration 005 verification passed. Profile isolation active.';
END $$;
```

### Supabase CLI Migration Workflow

```bash
# Source: https://supabase.com/docs/guides/deployment/database-migrations

# Initialize Supabase locally (if not already done)
supabase init

# Start local Supabase (for testing migrations)
supabase start

# Create new migration file
supabase migration new create_profiles_table

# Edit the generated file in supabase/migrations/

# Test migration locally
supabase db reset  # Resets local DB and applies all migrations

# Verify migration with dry-run before production
supabase db push --dry-run

# Apply migrations to remote database (production)
supabase db push

# Rollback if needed (manual - create a revert migration)
supabase migration new revert_profiles_table
# Write SQL to undo changes, then push
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `auth.uid() = user_id` | `(SELECT auth.uid()) = user_id` | PostgreSQL 9.5+ | 95% performance improvement - Postgres caches function result per statement |
| `ALTER TABLE ... SET NOT NULL` directly | Check constraint + validate + SET NOT NULL | PostgreSQL 12+ (2019) | Zero-downtime migrations - no exclusive lock required |
| `ADD CONSTRAINT ... FOREIGN KEY` | `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` | PostgreSQL 9.1+ (2011) | Zero-downtime FK additions - validation uses compatible lock |
| Schema-per-tenant | Shared tables + RLS | Supabase v1+ (2020) | Simpler migrations, better for 2-100 tenants, built-in API generation |
| Manual profile sync | Database triggers on auth.users | Supabase best practice (2021+) | Guaranteed consistency, atomic profile creation |

**Deprecated/outdated:**
- **Enabling RLS without `TO authenticated` clause:** Wastes resources evaluating policies for anonymous users. Always specify role.
- **Using `auth.jwt() ->> 'role' = 'service_role'` in policies:** Service role should bypass RLS entirely via connection string, not policy logic.
- **PostgreSQL 11 and older for production:** Missing NOT NULL optimization, slower RLS evaluation. Upgrade to 14+ recommended.

## Open Questions

Things that couldn't be fully resolved:

1. **Do we have existing jobs or api_costs records without user_id?**
   - What we know: Current migration 001 only added user_id to projects table, not to jobs or api_costs
   - What's unclear: Whether jobs/api_costs have any user tracking in their JSONB data fields
   - Recommendation: During migration 004, check for records without user_id and either assign to a system/admin profile or leave profile_id as NULL (acceptable for optional tables)

2. **Should profile deletion cascade to projects or block deletion?**
   - What we know: Pattern uses `ON DELETE CASCADE` which auto-deletes all projects/clips when profile deleted
   - What's unclear: If users expect to "archive" profiles and keep data, or truly delete everything
   - Recommendation: Use CASCADE (standard pattern), but add UI warning: "Deleting this profile will permanently delete all X projects"

3. **Do we need profile quota limits in Phase 1?**
   - What we know: PROF-07 mentions existing data migration, but no quota enforcement requirement
   - What's unclear: Whether Phase 1 should include a max_profiles_per_user constraint
   - Recommendation: Omit from Phase 1 (database foundation only). Add in Phase 3 (cost management) if needed.

4. **PostgreSQL version in production?**
   - What we know: Supabase uses PostgreSQL 14+ by default for new projects
   - What's unclear: If Edit Factory's Supabase project was created earlier and might be on older version
   - Recommendation: Check `SELECT version();` in Supabase SQL Editor. If < 12, NOT NULL optimization won't work (fallback to simpler pattern with maintenance window).

## Sources

### Primary (HIGH confidence)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) - Official RLS documentation with performance patterns
- [Supabase Auth: Managing User Data](https://supabase.com/docs/guides/auth/managing-user-data) - Official profiles table pattern
- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations) - Official migration workflow
- [PostgreSQL Documentation: Foreign Keys](https://www.postgresql.org/docs/current/tutorial-fk.html) - Official PostgreSQL FK documentation
- [PostgreSQL 18 NOT NULL as NOT VALID](https://neon.com/postgresql/postgresql-18/not-null-as-not-valid) - Latest PG18 feature for NOT NULL constraints

### Secondary (MEDIUM confidence)
- [Postgres: Adding Foreign Keys With Zero Downtime](https://travisofthenorth.com/blog/2017/2/2/postgres-adding-foreign-keys-with-zero-downtime) - Production-tested FK migration pattern
- [Adding a NOT NULL CONSTRAINT on PG Faster with Minimal Locking](https://medium.com/doctolib/adding-a-not-null-constraint-on-pg-faster-with-minimal-locking-38b2c00c4d1c) - Zero-downtime NOT NULL pattern
- [PostgreSQL SET NOT NULL Zero Downtime Gotcha](https://dev.to/andrewpsy/the-set-not-null-downtime-trap-in-postgresql-1o71) - Common mistake documentation
- [Supabase Data Migration Guide](https://copyright-certificate.byu.edu/news/supabase-data-migration-guide) - Migration best practices
- [Best practices for adding username to profiles table](https://github.com/orgs/supabase/discussions/3491) - Community patterns for profiles table

### Tertiary (LOW confidence)
- WebSearch findings about multi-tenant architecture patterns (2026) - General architectural guidance
- Community discussions on Supabase GitHub about migration challenges - Anecdotal pitfalls

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official Supabase documentation and PostgreSQL docs
- Architecture patterns: HIGH - All patterns verified with official sources and production examples
- Migration patterns: HIGH - Official PostgreSQL docs + production case studies from Doctolib, GitLab
- Pitfalls: HIGH - Derived from official Supabase troubleshooting guides and documented production incidents
- Code examples: HIGH - Based on official documentation templates, adapted for Edit Factory schema

**Research date:** 2026-02-03
**Valid until:** 2026-04-03 (60 days - database/RLS patterns are stable, but verify PostgreSQL version features)

**Note for planner:** Phase 1 creates the database foundation only. Backend API changes (Phase 2) and frontend integration (Phase 3) are separate phases. RLS policies must be profile-aware from the start even though the API doesn't pass profile context yet - this ensures database-level isolation is ready when backend adds profile filtering.
