---
status: awaiting_human_verify
trigger: "Fix 3 CRITICAL and 4 HIGH severity bugs found during pipeline audit"
created: 2026-03-03T00:00:00Z
updated: 2026-03-03T00:00:00Z
---

## Current Focus

hypothesis: All 7 bugs confirmed in exact locations. Applying targeted fixes now.
test: verified code patterns match audit descriptions
expecting: targeted one-line fixes for each bug
next_action: apply BUG-01 fix in pipeline_routes.py lines 1744 and 2030

## Symptoms

expected: Pipeline handles edge cases without crashing
actual: Multiple crash-causing patterns in pipeline_routes.py, assembly_service.py, pipeline/page.tsx
errors: ValueError (float on non-numeric), AttributeError (None.get()), KeyError (missing dict keys), missing Error Boundary
reproduction: Corrupt MP4, deleted source videos, missing profile_id, script deletion
started: Found during audit of existing code

## Eliminated

(none - all bugs confirmed present)

## Evidence

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py line 1744
  found: `duration = float(dur_result.stdout.strip())` — no ValueError protection
  implication: crashes when ffprobe returns "N/A" or empty string for corrupt/short videos

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py line 2030
  found: second identical pattern in sync_to_library endpoint
  implication: same crash risk in library sync flow

- timestamp: 2026-03-03T00:05:00Z
  checked: assembly_service.py lines 1398 and 1629
  found: `seg.get("editai_source_videos", {}).get("file_path")` — default {} NOT used when Supabase returns None
  implication: AttributeError when source video is deleted from DB

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py tts_previews dict usage
  found: stored with int key (line 1007, 1099, 1293), retrieved with int key (lines 1207, 1531), but invalidated with BOTH str(i) and i (lines 679-680), and DB round-trips convert to int on load. Line 2171-2172 does fallback with both variants already. Pattern is inconsistent but mostly int-keyed.
  implication: tts_previews.pop(str(i), None) at line 679 is defensive but unnecessary; real risk is if str key somehow enters the dict and lookup with int misses it

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py line 1325
  found: `for m in preview_data["matches"]` — direct access, no .get()
  implication: KeyError if assembly service returns preview_data without "matches" key

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py all profile_id accesses
  found: `pipeline["profile_id"]` used 10 times for ownership check; pipeline dict always has profile_id key set (both in-memory creation at lines 748/888 and DB load at line 224). KeyError is not possible. But if DB has NULL profile_id, value would be None (not crash).
  implication: lower risk than described - no KeyError possible, but using .get() is safer

- timestamp: 2026-03-03T00:05:00Z
  checked: pipeline_routes.py lines 1557-1559 (on_progress callback)
  found: `job["current_step"] = step_name; job["progress"] = pct` inside on_progress defined outside the render_jobs_lock
  implication: race condition with polling endpoint reading job dict without lock

- timestamp: 2026-03-03T00:05:00Z
  checked: frontend/src/app/pipeline/page.tsx lines 163-168
  found: PipelinePageWrapper uses Suspense but no ErrorBoundary. PipelinePage is 3745-line component with complex state. Any render throw = white screen.
  implication: no error recovery UI, users see blank page

## Resolution

root_cause: 7 bugs confirmed: float() crash on ffprobe N/A output (BUG-01), None.get() AttributeError on deleted source videos (BUG-03), str vs int tts_previews key inconsistency (BUG-02), direct preview_data["matches"] access (BUG-08), profile_id [] access (BUG-07, lower risk), on_progress race condition (BUG-04), missing ErrorBoundary (BUG-05)
fix: |
  BUG-01: Wrapped float(dur_result.stdout.strip()) in try/except ValueError at lines ~1750 and ~2039 (pipeline_routes.py)
  BUG-02: Added int/str dual-key lookup at tts_previews read sites (lines ~1208 and ~1534 in pipeline_routes.py)
  BUG-03: Changed seg.get("editai_source_videos", {}).get() to (seg.get("editai_source_videos") or {}).get() in assembly_service.py (lines 1398 and 1629)
  BUG-04: Added render_jobs_lock acquisition inside on_progress callback (pipeline_routes.py ~line 1562)
  BUG-05: Added PipelineErrorBoundary class component wrapping PipelinePageWrapper (pipeline/page.tsx lines 164-213)
  BUG-07: Changed all pipeline["profile_id"] to pipeline.get("profile_id") — 10 occurrences + _db_save_pipeline (pipeline_routes.py)
  BUG-08: Changed preview_data["matches"] to preview_data.get("matches", []) (pipeline_routes.py ~line 1326)
verification: TypeScript check passed (only pre-existing unrelated errors). All code patterns verified by re-reading changed sections.
files_changed:
  - app/api/pipeline_routes.py
  - app/services/assembly_service.py
  - frontend/src/app/pipeline/page.tsx
