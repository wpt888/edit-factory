---
phase: 55-security-hardening
plan: 01
subsystem: database
tags: [supabase, rls, row-level-security, postgresql, service-role, profile-isolation]

# Dependency graph
requires:
  - phase: 55-security-hardening
    provides: security hardening plans and requirements
  - phase: 01-database-foundation
    provides: profile table and profile-based isolation pattern (migration 005)
provides:
  - RLS enabled on all 13 editai_* tables with profile-based isolation
  - Service_role bypass policies allowing backend full DB access
  - Startup warning when service_role key is missing
  - .env.example documenting SUPABASE_SERVICE_ROLE_KEY as required
affects:
  - 55-02-rate-limiting
  - 55-03-input-validation
  - all phases using Supabase tables

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "service_role bypass: TO service_role USING (true) WITH CHECK (true) pattern"
    - "Profile isolation via: profile_id IN (SELECT id FROM profiles WHERE user_id = (SELECT auth.uid()))"
    - "(SELECT auth.uid()) wrapper to avoid per-row re-evaluation in RLS policies"

key-files:
  created:
    - supabase/migrations/023_reenable_rls_with_service_role.sql
  modified:
    - app/db.py
    - .env.example

key-decisions:
  - "editai_export_presets is global (no profile_id) — authenticated users get read-only SELECT, backend manages writes via service_role"
  - "service_role bypass uses TO service_role role (not auth.jwt() check) — more reliable and semantically correct in Supabase"
  - "Migration 023 drops all prior policies from migrations 001, 005, 016 before recreating — idempotent and clean"

patterns-established:
  - "RLS bypass pattern: CREATE POLICY 'Service role full access' ON table FOR ALL TO service_role USING (true) WITH CHECK (true)"
  - "Profile-chain isolation: EXISTS (SELECT 1 FROM editai_projects p JOIN profiles pr ON pr.id = p.profile_id WHERE p.id = child_table.project_id AND pr.user_id = (SELECT auth.uid()))"

requirements-completed: [SEC-01]

# Metrics
duration: 3min
completed: 2026-03-02
---

# Phase 55 Plan 01: RLS Re-enable with Service Role Summary

**SQL migration re-enabling Row Level Security on all 13 editai_* tables with profile-based isolation policies and service_role bypass, plus backend startup warning when service role key is absent**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-02T09:28:22Z
- **Completed:** 2026-03-02T09:31:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created migration 023 enabling RLS on all 13 editai_* tables (reversal of migration 022)
- Added service_role bypass policies to all 13 tables (backend bypasses RLS with service_role key)
- Added profile-based isolation policies for authenticated users on all 13 tables
- Updated app/db.py to warn at startup when SUPABASE_SERVICE_ROLE_KEY is not configured
- Updated .env.example with clear comments marking service_role key as required for production

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RLS re-enable migration with profile-based policies** - `50e5c9f` (feat)
2. **Task 2: Ensure backend uses service_role key and document configuration** - `d17f177` (feat)

## Files Created/Modified
- `supabase/migrations/023_reenable_rls_with_service_role.sql` - Migration that re-enables RLS on all 13 editai_* tables, drops all prior policies, creates service_role bypass and authenticated profile-isolation policies
- `app/db.py` - Added startup warning when SUPABASE_SERVICE_ROLE_KEY is not set; distinct log messages for service_role vs anon key initialization
- `.env.example` - Added comments explaining SUPABASE_SERVICE_ROLE_KEY is required for RLS bypass and where to find it in Supabase dashboard

## Decisions Made

1. `editai_export_presets` is a global table (no profile_id column) — authenticated users get SELECT-only access via a permissive policy; backend manages inserts/updates through service_role. This prevents authenticated clients from modifying shared presets.

2. Service_role bypass uses `TO service_role` role specification rather than `auth.jwt() ->> 'role' = 'service_role'` check — this is semantically correct Supabase pattern and does not require JWT parsing.

3. Migration 023 drops ALL prior policies from migrations 001, 005, and 016 before recreating — ensures idempotent execution and clean state.

## Deviations from Plan

None - plan executed exactly as written. editai_export_presets was noted in the plan as requiring investigation (no profile_id), and the global-preset approach (authenticated read-only) is appropriate.

## Issues Encountered

None - venv_linux was used instead of venv for verification (WSL environment).

## User Setup Required

**Manual step required before this migration takes effect:**

Apply migration 023 via Supabase Dashboard SQL Editor:
1. Go to Supabase Dashboard > SQL Editor
2. Open `supabase/migrations/023_reenable_rls_with_service_role.sql`
3. Execute — verify the DO block logs "RLS verified: editai_*" for all 13 tables
4. Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in `.env` (backend uses it to bypass RLS)

## Next Phase Readiness
- RLS migration file is ready for application via Supabase SQL Editor
- Backend will use service_role key automatically (already configured in app/db.py)
- Phase 55-02 (rate limiting) and 55-03 (input validation) can proceed independently

---
*Phase: 55-security-hardening*
*Completed: 2026-03-02*
