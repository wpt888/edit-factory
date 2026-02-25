---
status: resolved
trigger: "Audit and debug Pipeline Step 1: Idea Input & Script Generation"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T01:00:00Z
---

## Current Focus

hypothesis: RESOLVED — 3 bugs found and fixed
test: Full audit of pipeline page, routes, and script generator
expecting: All bugs found
next_action: Archive session

## Symptoms

expected: Step 1 allows users to input context text, select source videos, configure TTS voice/provider, set variant count, and generate scripts via Gemini AI. All form validation, API calls, and state management work flawlessly.
actual: Unknown — performing proactive audit to find any bugs before users hit them.
errors: None reported yet — proactive audit.
reproduction: Go through the full Step 1 flow in the pipeline page.
started: Proactive audit — checking current codebase state.

## Eliminated

- hypothesis: form validation bugs (missing required fields, wrong types)
  evidence: variant_count validated 1-10 both FE and BE; idea.trim() guard; provider validated server-side; context is optional with correct default
  timestamp: 2026-02-25

- hypothesis: API endpoint parameter mismatches between frontend and backend
  evidence: PipelineGenerateRequest fields (idea, context, variant_count, provider) match exactly what the frontend sends; JSON.stringify omits undefined keys, matching FastAPI defaults
  timestamp: 2026-02-25

- hypothesis: source video selection logic errors
  evidence: fetchSourceVideos uses correct endpoint /segments/source-videos; auto-select-all on first load is correct; toggle/select-all/deselect-all work correctly; debounced save to DB is correct
  timestamp: 2026-02-25

- hypothesis: TTS provider/voice selection state bugs
  evidence: voiceId initialized as "" handled correctly everywhere; "default" sentinel value handled in all send paths; voices grouped into custom/premade correctly
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25
  checked: app/services/script_generator.py — ScriptGenerator class defaults
  found: anthropic_model default was "claude-sonnet-4-20250514" but config.py sets "claude-sonnet-4-6"
  implication: No runtime bug (factory overrides the default), but stale docstring/default causes confusion if anyone instantiates ScriptGenerator() directly

- timestamp: 2026-02-25
  checked: app/api/pipeline_routes.py — update_pipeline_scripts endpoint DB persistence
  found: tts_previews saved to DB with raw in-memory keys (could be int or str depending on whether pipeline was freshly created vs loaded from DB) without the explicit {str(k): v} conversion that _db_save_pipeline uses
  implication: JSONB key type corruption — when reloaded, the _db_load_pipeline int-key conversion at line 136 (int(k)) would fail if keys stored as integers in JSON; Python's json.dumps coerces int keys to str but Supabase client behavior may differ. Fixed to be consistent with _db_save_pipeline pattern.

- timestamp: 2026-02-25
  checked: frontend catch blocks in handleGenerate, handlePreviewAll, handleRender
  found: apiFetch (in api.ts) throws ApiError for ALL non-2xx responses (including 400, 503) with the FastAPI detail message in err.detail. But the catch blocks only show the actual error for timeouts — non-timeout ApiErrors (Gemini failure, API key missing, rate limit) showed generic "Network error. Please check if the backend is running." instead of the real error.
  implication: Users see useless error messages when AI generation fails (e.g., "GEMINI_API_KEY is required" or "provider must be 'gemini' or 'claude'" — these are swallowed). Fixed to use err.detail || err.message for ApiError instances.

- timestamp: 2026-02-25
  checked: res.ok checks in handleGenerate, handlePreviewAll, handleRender
  found: These else branches are dead code — apiFetch always throws before returning a non-ok response. The error detail reading logic is unreachable.
  implication: Low priority — error handling is still covered by catch blocks. Not fixed (removing dead code is cleanup not a bug fix).

## Resolution

root_cause: Three independent bugs: (1) stale anthropic_model default in ScriptGenerator, (2) int-keyed tts_previews saved to DB in update_pipeline_scripts path, (3) ApiError detail swallowed in all catch blocks showing generic "Network error" instead of real error message.

fix: |
  1. script_generator.py: Updated ScriptGenerator default anthropic_model from "claude-sonnet-4-20250514" to "claude-sonnet-4-6" (matches config.py)
  2. pipeline_routes.py update_pipeline_scripts: Added {str(k): v} key conversion before saving tts_previews to DB, matching the _db_save_pipeline pattern
  3. pipeline/page.tsx: Fixed catch blocks in handleGenerate, handlePreviewAll, handleRender to check ApiError first and use err.detail || err.message for non-timeout errors

verification: Code review — fixes are minimal and targeted. Each fix directly addresses the identified root cause.

files_changed:
  - app/services/script_generator.py
  - app/api/pipeline_routes.py
  - frontend/src/app/pipeline/page.tsx
