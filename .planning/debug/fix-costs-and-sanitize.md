---
status: resolved
trigger: "Verify and fix two bugs: missing /costs/all endpoint and _sanitize_for_tts() regex too aggressive"
created: 2026-02-26T00:00:00Z
updated: 2026-02-26T00:00:00Z
---

## Current Focus

hypothesis: Both fixes are already present and correct in the codebase
test: Read both files and inspect the relevant code
expecting: Endpoint exists at lines 69-98 in routes.py; sanitize regex uses \w+ at line 317 in script_generator.py
next_action: DONE — both fixes confirmed present and correct

## Symptoms

expected:
- Bug 1: GET /api/v1/costs/all should return all cost entries from Supabase api_costs table
- Bug 2: _sanitize_for_tts() should only strip single-word stage directions like (whisper), not multi-word content like (Pro Max)
actual: Needed to verify current state of fixes
errors: Bug 1 caused 404 on "Show All" button in Usage page
reproduction: Bug 1 - go to /usage, click "Show All". Bug 2 - generate script with parenthetical text
started: Found in audit today

## Eliminated

- hypothesis: /costs/all endpoint is missing from routes.py
  evidence: Endpoint exists at lines 69-98 of app/api/routes.py — fully implemented
  timestamp: 2026-02-26T00:00:00Z

- hypothesis: _sanitize_for_tts still uses the too-aggressive r'\(([^\)]+)\)' pattern
  evidence: Line 317 of script_generator.py uses r'\((\w+)\)' — single-word only, with clear comment
  timestamp: 2026-02-26T00:00:00Z

## Evidence

- timestamp: 2026-02-26T00:00:00Z
  checked: app/api/routes.py lines 69-98
  found: |
    @router.get("/costs/all")
    async def get_all_costs(profile: ProfileContext = Depends(get_profile_context)):
        ...queries Supabase api_costs table with profile_id filter, order by created_at desc, limit 500...
        ...falls back to local log summary if Supabase unavailable...
  implication: Bug 1 fix is PRESENT and correct

- timestamp: 2026-02-26T00:00:00Z
  checked: app/services/script_generator.py line 317
  found: |
    text = re.sub(r'\((\w+)\)', '', text)  # (whisper), (loudly) — single-word only
    Comment on line 315-316: "Remove single-word stage directions in parentheses — e.g. (whisper), (loudly)
    but preserve multi-word parenthetical phrases that are legitimate speech."
  implication: Bug 2 fix is PRESENT and correct. (Pro Max) has a space so \w+ won't match it.

## Resolution

root_cause: |
  Both bugs were already fixed in the codebase before this session:
  - Bug 1: /costs/all endpoint was added to routes.py (lines 69-98)
  - Bug 2: _sanitize_for_tts regex was changed from r'\(([^\)]+)\)' (matches anything in parens)
    to r'\((\w+)\)' (only matches single words — no spaces, no special chars)

fix: No changes needed — both fixes are confirmed present and correct.

verification: |
  Bug 1: @router.get("/costs/all") at line 69 — queries Supabase api_costs with profile_id filter,
  ordered by created_at desc, limit 500, with local fallback.

  Bug 2: re.sub(r'\((\w+)\)', '', text) at line 317 — \w+ matches [a-zA-Z0-9_] only,
  so "(whisper)" matches and is removed, but "(Pro Max)" does NOT match because of the space,
  preserving it correctly.

files_changed: []
