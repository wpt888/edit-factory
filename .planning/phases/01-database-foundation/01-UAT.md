---
status: testing
phase: 01-database-foundation
source: 01-01-SUMMARY.md
started: 2026-02-03T12:00:00Z
updated: 2026-02-03T12:00:00Z
---

## Current Test

number: 1
name: Profiles table exists
expected: |
  In Supabase Dashboard > SQL Editor, run:
  `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles' ORDER BY ordinal_position;`
  Should show 12+ columns including: id (uuid), user_id (uuid), name (text), description (text), is_default (boolean), default_tts_provider (text), created_at (timestamp with time zone)
awaiting: user response

## Tests

### 1. Profiles table exists
expected: In Supabase SQL Editor, query `information_schema.columns` for 'profiles' table shows 12+ columns including id, user_id, name, description, is_default, default_tts_provider, created_at
result: [pending]

### 2. Default profile created for users
expected: In Supabase SQL Editor, run `SELECT * FROM profiles WHERE is_default = true;` — should return at least one row (one default profile per existing user with projects)
result: [pending]

### 3. Projects have profile_id populated
expected: In Supabase SQL Editor, run `SELECT COUNT(*) FROM editai_projects WHERE profile_id IS NULL AND user_id IS NOT NULL;` — should return 0 (all projects with users are assigned to profiles)
result: [pending]

### 4. Profile-aware RLS policies active
expected: In Supabase SQL Editor, run `SELECT policyname FROM pg_policies WHERE tablename = 'editai_projects' AND policyname LIKE '%profile%';` — should return policies with 'profile' in the name (e.g., 'new_profile_projects_select')
result: [pending]

### 5. Performance indexes exist
expected: In Supabase SQL Editor, run `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE '%profile%';` — should return at least 4 indexes including idx_projects_profile_id, idx_profiles_user_id
result: [pending]

### 6. Application still works (service role bypass)
expected: Open the Edit Factory app in browser, go to Library page — should load your existing projects without errors (service role bypass ensures backend still works)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0

## Gaps

[none yet]
