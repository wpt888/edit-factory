---
status: awaiting_human_verify
trigger: "Comprehensive debug audit of the entire Edit Factory application"
created: 2026-02-26T00:00:00Z
updated: 2026-02-26T12:30:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: All bugs found and fixed — awaiting user verification
test: Run the app and verify (1) usage page all-entries loads, (2) scripts don't have parenthetical content stripped
expecting: Confirmed fixed
next_action: Await user confirmation

## Symptoms

expected: All features work correctly — pipeline flow, library CRUD, rendering, TTS, profiles, products, segments, publishing
actual: 3 real bugs found across the codebase
errors: See Evidence section
reproduction: N/A — audit all flows
timeline: Post v8 milestone, current state of main branch with uncommitted changes

## Eliminated

- hypothesis: assembly_router not registered causes frontend breakage
  evidence: No frontend code calls /assembly/* endpoints — assembly_routes.py is orphaned but harmless
  timestamp: 2026-02-26

- hypothesis: import ordering bug in pipeline_routes.py could cause NameError at runtime
  evidence: Python resolves imports at module load time — function definitions don't need imports to be before them. Works fine. Linter auto-fixed the order anyway.
  timestamp: 2026-02-26

- hypothesis: shadowColor/borderStyle missing from DEFAULT_SUBTITLE_SETTINGS breaks subtitle settings response
  evidence: DEFAULT_SUBTITLE_SETTINGS already contained both fields — no bug, was a false alarm
  timestamp: 2026-02-26

- hypothesis: FastAPI route ordering issue with /catalog/products/filters vs /catalog/products/{product_id}
  evidence: /filters is defined before /{product_id} so FastAPI resolves it correctly. No bug.
  timestamp: 2026-02-26

## Evidence

- timestamp: 2026-02-26
  checked: frontend/src/app/usage/page.tsx line 141 vs app/api/routes.py
  found: Frontend calls GET /costs/all but no such route existed in routes.py. Only GET /costs existed.
  implication: MEDIUM — "Show all entries" button on Usage page always returns 404

- timestamp: 2026-02-26
  checked: app/services/script_generator.py line 311 (_sanitize_for_tts)
  found: re.sub(r'\(([^\)]+)\)', '', text) strips ALL parenthetical content — including legitimate speech like "(Pro Max)" or multi-word parenthetical remarks.
  implication: MEDIUM — Scripts with any parenthetical content have that content silently removed before TTS, making the spoken audio incomplete

- timestamp: 2026-02-26
  checked: app/api/pipeline_routes.py lines 28-33 (original)
  found: _stable_hash() was defined BEFORE the module imports (get_supabase, get_script_generator, etc.). Code smell.
  implication: LOW — Worked at runtime. Linter auto-fixed it by reordering.

## Resolution

root_cause: |
  Three bugs found:
  1. MEDIUM: Missing GET /costs/all endpoint — usage page "Show all entries" button always failed with 404
  2. MEDIUM: _sanitize_for_tts() in script_generator.py stripped ALL parenthetical content with a greedy regex, removing legitimate speech text like "(Pro Max)" or "(and that's the point)"
  3. LOW (code smell): _stable_hash() function was defined before its module-level imports in pipeline_routes.py

fix: |
  1. Added GET /costs/all endpoint to app/api/routes.py — queries Supabase api_costs table (up to 500 entries) or falls back to local log
  2. Changed regex from re.sub(r'\(([^\)]+)\)', '', text) to re.sub(r'\((\w+)\)', '', text) — only removes single-word parenthetical stage directions like (whisper) or (loudly), preserving multi-word parenthetical speech
  3. Moved imports before _stable_hash() function definition in pipeline_routes.py (linter auto-applied this)

verification: pending user confirmation
files_changed:
  - app/api/routes.py (added /costs/all endpoint)
  - app/services/script_generator.py (fixed _sanitize_for_tts parentheses regex)
  - app/api/pipeline_routes.py (import ordering fixed by linter)
