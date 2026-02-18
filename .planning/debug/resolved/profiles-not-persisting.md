---
status: resolved
trigger: "profiles-not-persisting"
created: 2026-02-18T00:00:00Z
updated: 2026-02-18T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: Replaced in-memory dict with JSON file-backed store
expecting: Profiles survive backend restarts
next_action: Archived

## Symptoms

expected: Profiles saved by the user persist across redeploys and are visible in the profile dropdown selector
actual: After redeploying (restarting backend+frontend), saved profiles disappear. Only "Default" shows in the dropdown.
errors: No known error messages
reproduction: 1) Create and save a profile, 2) Redeploy/restart the app, 3) Open profile dropdown — saved profile is gone
started: Has been happening since profiles were implemented. User noticed after a redeploy.

## Eliminated

(none — root cause found on first hypothesis)

## Evidence

- timestamp: 2026-02-18T00:01:00Z
  checked: .env
  found: AUTH_DISABLED=true is set
  implication: Backend runs in dev mode — `_is_dev_mode()` returns True for ALL requests

- timestamp: 2026-02-18T00:01:00Z
  checked: app/api/profile_routes.py lines 39-63 (original), all route handlers
  found: Every route handler checks `if _is_dev_mode():` first. When True, reads/writes go to `_dev_profiles: Dict[str, dict] = {}` (module-level in-memory dict). On restart, this dict resets to empty and `_ensure_dev_profiles()` re-seeds only the hardcoded "Default". No Supabase writes occur in dev mode.
  implication: Profiles created by the user were stored ONLY in this in-memory dict — lost on every restart.

- timestamp: 2026-02-18T00:01:00Z
  checked: supabase/migrations/002_create_profiles_table.sql
  found: Profiles table has RLS policies requiring auth.uid() == user_id. Dev user_id is "dev-user-local" — not a real auth.users UUID, so Supabase writes would be blocked by RLS and FK constraints anyway.
  implication: Can't fix by routing dev mode to Supabase without service role key. JSON file is the correct approach.

## Resolution

root_cause: AUTH_DISABLED=true routes all profile operations to a Python module-level dict (`_dev_profiles: Dict[str, dict] = {}`). This dict is reset to empty on every backend process restart, with only a hardcoded "Default" profile re-initialized. No disk or database persistence existed.

fix: Replaced the in-memory dict with a JSON file-backed store at `.planning/dev-profiles.json`. Three helper functions handle the persistence:
  - `_load_dev_profiles()` - reads JSON file, returns empty dict on missing/corrupt file
  - `_save_dev_profiles(profiles)` - writes dict to JSON file atomically
  - `_ensure_dev_profiles(user_id)` - loads from disk, seeds "Default" if new user, returns live dict
  Every write operation (create, update, patch, delete, set-default) now calls `_save_dev_profiles()` to persist immediately. Added `.planning/dev-profiles.json` to `.gitignore`.

verification: Python3 syntax check passed. File path resolves to project root `.planning/dev-profiles.json` via `Path(__file__).parent.parent.parent / ".planning" / "dev-profiles.json"`.

files_changed:
  - app/api/profile_routes.py
  - .gitignore
