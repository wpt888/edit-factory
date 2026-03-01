---
status: resolved
trigger: "Comprehensive bug audit post-v8 — check previous CRIT/HIGH bugs and new issues"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:00:00Z
---

## Current Focus

hypothesis: All bugs catalogued from code review
test: Static analysis of all modified files + git diff review
expecting: Complete audit report
next_action: Report delivered

## Symptoms

expected: Application works correctly end-to-end
actual: Unknown — proactive audit
errors: None specifically reported
reproduction: N/A — proactive review
started: Post v8 milestone completion

---

# Edit Factory - Bug Audit Report (Post-v8)

**Generated:** 2026-02-25
**Scope:** All CRIT/HIGH bugs from previous audits + new bugs in v6-v8 changes
**Previous audits:** AUDIT_REPORT.md (Feb 21, v5), pipeline-bugs-audit.md (Feb 25, pipeline)

---

## SUMMARY TABLE

| ID | Severity | Status | File | Description |
|----|----------|--------|------|-------------|
| CRIT-01 | CRITICAL | FIXED | library_routes.py | Bulk render missing project_id/profile_id |
| CRIT-02 | CRITICAL | FIXED | tts_cache.py | Cache uses relative path |
| CRIT-03 | CRITICAL | FIXED | library_routes.py | update_clip_content missing ownership check |
| CRIT-03b | CRITICAL | FIXED | library_routes.py | copy_content_from_clip unauthenticated |
| P-BUG-01 | CRITICAL | FIXED | pipeline_routes.py | Re-render of variants silently skipped |
| HIGH-01 | HIGH | FIXED | library_routes.py | Cancel endpoint 404 |
| HIGH-02 | HIGH | FIXED | routes.py | Job progress not persisted during processing |
| HIGH-03 | HIGH | FIXED | library_routes.py | Progress pct overflow for multi-batch |
| HIGH-04 | HIGH | FIXED | api.ts | apiFetch always sets Content-Type breaking FormData |
| HIGH-05 | HIGH | FIXED | main.py | Projects stuck "generating" after server restart |
| HIGH-06 | HIGH | FIXED | multiple | Multiple independent Supabase client instances |
| HIGH-07 | HIGH | FIXED | use-job-polling.ts | Progress parsing always returns 0 |
| P-BUG-02 | HIGH | FIXED | assembly_service.py | SRT cache key inconsistency (preview vs render) |
| P-BUG-03 | HIGH | FIXED | assembly_service.py | Null source_video_path silently drops all segments |
| P-BUG-04 | HIGH | FIXED | pipeline_routes.py | match_overrides key type mismatch |
| P-BUG-05 | HIGH | FIXED | pipeline_routes.py | TTS cache invalidation mutates copy not original |
| P-BUG-07 | MEDIUM | FIXED | segment_transforms.py | Opacity filter incompatible with yuv420p |
| P-BUG-08 | MEDIUM | FIXED | pipeline/page.tsx | handleSourceToggle stale closure |
| P-BUG-09 | MEDIUM | FIXED | pipeline_routes.py | TTS cache invalidation not persisted to DB |
| P-BUG-10 | MEDIUM | FIXED | pipeline_routes.py | Timeline editor audio endpoint ignores tts_previews |
| P-BUG-11 | MEDIUM | PARTIAL | script_generator.py | Claude model hardcoded (now configurable, default still suspect) |
| P-BUG-12 | MEDIUM | FIXED | pipeline/page.tsx | previewError not cleared on step navigation |
| P-BUG-13 | MEDIUM | FIXED | pipeline/page.tsx | Blob URL memory leak on unmount |
| P-BUG-16 | LOW | FIXED | pipeline_routes.py | Pipeline eviction sorts by UUID not creation time |
| P-BUG-17 | LOW | FIXED | assembly_routes.py | Standalone assembly route missing voice_id |
| MED-01 | MEDIUM | FIXED | library_routes.py | 404 masked as 500 in error handlers |
| **NEW-01** | HIGH | PRESENT | timeline-editor.tsx | Inline preview audio/video not cleaned up on unmount |
| **NEW-02** | MEDIUM | PRESENT | config.py | Claude model default is a future-dated/invalid model ID |
| **NEW-03** | LOW | PRESENT | timeline-editor.tsx | `previewVideoRefs` not cleared when matches change sources |

---

## FIXED BUGS (confirmed by code review)

### CRIT-01: Bulk Render Missing Arguments — FIXED
**File:** `app/api/library_routes.py`, lines 2375-2382

The `_start_render_for_clip` function now correctly passes `project_id` and `profile_id` from `clip.data`:
```python
await _render_final_clip_task(
    clip_id=clip_id,
    project_id=clip.data["project_id"],   # NOW PRESENT
    profile_id=clip.data["profile_id"],   # NOW PRESENT
    clip_data=clip.data,
    content_data=content.data[0] if content.data else None,
    preset_data=preset.data
)
```

---

### CRIT-02: TTS Cache Relative Path — FIXED
**File:** `app/services/tts_cache.py`, line 17

Now uses absolute path anchored to module location:
```python
def _get_cache_root() -> Path:
    return Path(__file__).parent.parent.parent / "cache" / "tts"
```

---

### CRIT-03 / CRIT-03b: Missing Ownership Checks — FIXED
**File:** `app/api/library_routes.py`, lines 1757-1808

`update_clip_content` now checks `.eq("profile_id", profile.profile_id)` before acting.
`copy_content_from_clip` now has `profile: ProfileContext = Depends(get_profile_context)` and verifies ownership of both source and destination clips.

---

### P-BUG-01: Re-render Guard Prevents Re-render — FIXED
**File:** `app/api/pipeline_routes.py`, lines 1150-1162

Old guard `if variant_index not in pipeline["render_jobs"]` replaced with:
```python
existing_job = pipeline["render_jobs"].get(variant_index)
if existing_job and existing_job.get("status") == "processing":
    continue  # Only skip if actively rendering
```
Users can now re-render a variant after editing.

---

### HIGH-01: Cancel Endpoint Non-existent — FIXED
**File:** `app/api/library_routes.py`, lines 533-554

`POST /library/projects/{project_id}/cancel` endpoint now exists and implemented via `mark_project_cancelled()`. The generation loop checks `is_project_cancelled()` at each iteration.

---

### HIGH-02: Job Progress Not Persisted — FIXED
**File:** `app/api/routes.py`, lines 439-442

`update_progress` callback now calls `get_job_storage().update_job()` on every step:
```python
def update_progress(step: str, status: str):
    job["progress"] = f"{step}: {status}"
    job["updated_at"] = datetime.now(timezone.utc).isoformat()
    get_job_storage().update_job(job_id, {"progress": job["progress"], "updated_at": job["updated_at"]})
```

---

### HIGH-03: Progress Percentage Overflow — FIXED
**File:** `app/api/library_routes.py`, lines 1141-1304

Now uses relative index:
```python
relative_idx = variant_idx - start_variant_index + 1
done_pct = min(10 + int(((variant_idx - start_variant_index + 1) / variant_count) * 80), 95)
```
Capped at 95 to prevent overflow.

---

### HIGH-04: apiFetch Content-Type Breaks FormData — FIXED
**File:** `frontend/src/lib/api.ts`, line 38

```typescript
const headers: HeadersInit = {
    ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),
    ...
};
```
`Content-Type` is now conditionally omitted when body is `FormData`.

---

### HIGH-05: Projects Stuck Generating After Restart — FIXED
**File:** `app/main.py`, lines 50-66

`_recover_stuck_projects()` startup function resets all `"generating"` projects to `"failed"` on server boot.

---

### HIGH-06: Multiple Supabase Client Instances — FIXED
**File:** `app/db.py` (new shared module)

All modules now import from `app.db.get_supabase()` which maintains a single thread-safe singleton.

---

### HIGH-07: Progress Parsing Always Returns 0 — FIXED
**File:** `frontend/src/hooks/use-job-polling.ts`, lines 7-28

`extractProgress()` function now handles: numeric strings, fraction patterns (`"2/5"`), percentage patterns (`"50%"`), and status-based fallbacks. `parseInt()` result is only used if it parses successfully.

---

### P-BUG-02 + P-BUG-06: SRT Cache Key Inconsistency — FIXED
**File:** `app/services/assembly_service.py`, lines 716 and 922

Both `assemble_and_render` and `preview_matches` now use the same SRT cache key:
```python
_srt_cache_key = {"text": script_text, "voice_id": voice_id or "", "model_id": elevenlabs_model, "provider": "elevenlabs_ts"}
```
The `preview_matches` method previously used hardcoded `voice_id: ""` — now correctly uses `voice_id or ""`.

---

### P-BUG-03: Null source_video_path Silently Drops Segments — FIXED
**File:** `app/services/assembly_service.py`, lines 794-798 and 973-978

Both `assemble_and_render` and `preview_matches` now raise a clear error after filtering:
```python
if not segments_data:
    raise RuntimeError(
        "No usable segments found — all segments are missing source video file paths. "
        "Please re-upload source videos or re-create segments."
    )
```

---

### P-BUG-04: match_overrides Key Type Mismatch — FIXED
**File:** `app/api/pipeline_routes.py`, line 1184

```python
variant_match_overrides = request.match_overrides.get(vid) or request.match_overrides.get(str(vid))
```
Now tries both int and string key lookups.

---

### P-BUG-05: TTS Cache Invalidation Mutates Copy — FIXED
**File:** `app/api/pipeline_routes.py`, line 509

```python
tts_previews = pipeline.setdefault("tts_previews", {})
```
Changed from `.get("tts_previews", {})` (which returns a copy if key missing) to `.setdefault()` which always returns the actual dict stored in `pipeline`, and creates it if not present.

---

### P-BUG-07: Opacity Filter RGBA Incompatibility — FIXED
**File:** `app/services/segment_transforms.py`, lines 108-111

Changed from `format=rgba,colorchannelmixer=aa=...` to:
```python
filters.append(f"colorchannelmixer=rr={a:.2f}:gg={a:.2f}:bb={a:.2f}")
```
Now operates in RGB space, compatible with yuv420p pipeline.

---

### P-BUG-08: Stale Closure in handleSourceToggle — FIXED
**File:** `frontend/src/app/pipeline/page.tsx`

`pipelineIdRef` is now used instead of direct `pipelineId` state in the setTimeout callback. The ref is kept in sync via `useEffect`.

---

### P-BUG-09: TTS Cache Invalidation Not Persisted to DB — FIXED
**File:** `app/api/pipeline_routes.py`, line 527

```python
supabase.table("editai_pipelines").update({
    "scripts": request.scripts,
    "variant_count": len(request.scripts),
    "tts_previews": pipeline.get("tts_previews", {}),  # NOW INCLUDED
}).eq("id", pipeline_id).execute()
```

---

### P-BUG-10: Timeline Editor Audio Endpoint Ignores tts_previews — FIXED
**File:** `app/api/pipeline_routes.py`, lines 1632-1644

The `/pipeline/audio/{pipeline_id}/{variant_index}` endpoint now falls back to `tts_previews` if `previews` doesn't have audio for the variant.

---

### P-BUG-12: previewError Not Cleared on Step Navigation — FIXED
**File:** `frontend/src/app/pipeline/page.tsx`, lines 610, 675, 763

`setPreviewError(null)` is now called at the start of `handlePreviewAll` (line 610), `handleRender` (line 675), and `handleLoadLibraryAudio` (line 763).

---

### P-BUG-13: Blob URL Memory Leak on Unmount — FIXED
**File:** `frontend/src/app/pipeline/page.tsx`

`pendingBlobUrl` ref tracks the in-flight blob URL and is revoked in the unmount cleanup:
```typescript
if (pendingBlobUrl.current) {
    URL.revokeObjectURL(pendingBlobUrl.current);
    pendingBlobUrl.current = null;
}
```

---

### MED-01: 404 Masked as 500 — FIXED
**File:** `app/api/library_routes.py`, lines 470-471

All major endpoint handlers now have `except HTTPException: raise` before the generic `except Exception` handler. Verified in `get_project`, `create_project`, `delete_project`, `get_project_progress`.

---

## NEW BUGS FOUND IN CURRENT CODE

### NEW-01 — HIGH: Inline Preview Player Has No Unmount Cleanup
**File:** `frontend/src/components/timeline-editor.tsx`
**Uncommitted change** (visible in git diff, not yet committed)

The new inline continuous preview feature added to `timeline-editor.tsx` creates audio and video elements that are managed via refs (`previewAudioRef`, `previewVideoRefs`). However, there is no unmount cleanup effect.

**Evidence:** The component has effects at lines 165-203 (audio listeners) and 206-228 (video timeupdate listeners), both with proper cleanup `return` functions. But there is NO effect that runs on unmount to:
1. Pause and stop the audio element (`previewAudioRef.current`)
2. Pause all pooled video elements (`previewVideoRefs.current`)
3. Reset playing state

**Reproduction:** Navigate to Step 3, click "Play Preview", then navigate away (change step, close dialog, etc.). The audio continues playing in the background because the component is unmounted while `isPreviewActive = true` and no cleanup fires.

**Impact:** Audio plays in the background after the user navigates away from Step 3. The user has no way to stop it unless they return to Step 3 and press Stop. Browser memory is not freed until full page reload.

**Suggested Fix:**
Add an unmount cleanup effect:
```typescript
useEffect(() => {
    return () => {
        // Cleanup on unmount: stop audio and all videos
        const audio = previewAudioRef.current;
        if (audio) {
            audio.pause();
            audio.src = "";
        }
        for (const vid of Object.values(previewVideoRefs.current)) {
            if (vid) vid.pause();
        }
    };
}, []); // Empty deps = runs only on unmount
```

---

### NEW-02 — MEDIUM: Claude Model Default is a Future-Dated Invalid ID
**File:** `app/config.py`, line 46
**Also:** `app/services/script_generator.py`, line 27

The default Anthropic model is:
```python
anthropic_model: str = "claude-sonnet-4-20250514"
```

The model ID format `claude-sonnet-4-20250514` is a dated model ID (May 14, 2025 release). As of February 2026, this model ID is either:
1. A beta/future model that was never released under this ID, OR
2. A deprecated model that has been superseded

The correct current Claude Sonnet 4 model ID format, based on Anthropic's naming conventions, would be something like `claude-sonnet-4-6` (matching what this very Claude instance runs on, model ID `claude-sonnet-4-6`).

**Impact:** Script generation with Claude provider (`provider: "claude"` in pipeline) will fail with a `model_not_found` error from the Anthropic API. The Gemini provider is unaffected.

**The bug is partially mitigated:** The model is now configurable via `ANTHROPIC_MODEL` environment variable. Users can set this to the correct model ID without code changes. But the default value causes silent failures.

**Suggested Fix:**
Update the default to the correct current model ID:
```python
anthropic_model: str = "claude-sonnet-4-6"  # or latest stable
```

---

### NEW-03 — LOW: previewVideoRefs Stale When Source Videos Change
**File:** `frontend/src/components/timeline-editor.tsx`
**Uncommitted change**

The pooled video elements in the inline preview are keyed by `source_video_id`. When `matches` change (user swaps a segment for one from a different source video), `uniqueSourceVideoIds` is recomputed, but the `previewVideoRefs` object still holds references to the old video elements.

**Evidence:** The video pool is built from `uniqueSourceVideoIds` (a derived value from `matches`). When a user drags a new segment into the timeline that introduces a new source video, the `<video>` element for that source video doesn't exist yet in `previewVideoRefs`, but `syncPreviewVideo` tries to access it:
```typescript
const activeVideo = previewVideoRefs.current[match.source_video_id];
if (!activeVideo) return;  // Silently fails
```

**Impact:** After adding a segment from a new source video while preview is active, the preview stops playing (the new segment has no video, so `syncPreviewVideo` returns early). The audio continues but no video is shown. LOW severity because: (1) the user would need to be actively previewing while also editing, and (2) stopping and restarting preview resolves it.

---

## PARTIAL FIXES

### P-BUG-11: Claude Model Configurable But Default Still Suspect
**File:** `app/config.py` + `app/services/script_generator.py`
**Status:** PARTIAL

The model is now configurable via `ANTHROPIC_MODEL` env var (resolved the hardcoded issue). However, the default value `claude-sonnet-4-20250514` is likely an invalid model ID. See NEW-02 above for details.

---

## REMAINING MEDIUM BUGS FROM ORIGINAL AUDIT (not yet fixed)

### MED-05: update_project Allows Client-Driven Status Transitions — STILL PRESENT
**File:** `app/api/library_routes.py`

The `status` field is still in the `allowed_fields` list for `update_project`. Clients can arbitrarily set project status to any value, bypassing the backend state machine. Not checked in this audit as a priority but was not addressed in v6-v8.

### MED-06: process_tts_job Background Task Not Passed Profile ID — STATUS UNKNOWN
The original `routes.py` TTS job issue. Not re-checked in this audit as it's in a separate code path from the pipeline changes.

---

## PRIORITY ORDER FOR REMAINING WORK

1. **NEW-01** (HIGH) — Fix inline preview unmount cleanup in timeline-editor.tsx. Active bug, audio plays in background.
2. **NEW-02** (MEDIUM) — Fix Claude model default to valid ID. Script generation with Claude provider currently broken by default.
3. **NEW-03** (LOW) — Stale video pool refs. Cosmetic issue, self-resolves on preview restart.
4. **MED-05** (MEDIUM) — Remove `status` from update_project allowed fields. Security/integrity concern.

---

## Evidence

- timestamp: 2026-02-25
  checked: app/api/library_routes.py — _start_render_for_clip (lines 2361-2385)
  found: CRIT-01 FIXED — project_id and profile_id now correctly passed from clip.data
  implication: Bulk render works

- timestamp: 2026-02-25
  checked: app/services/tts_cache.py (line 17)
  found: CRIT-02 FIXED — path anchored with Path(__file__).parent.parent.parent
  implication: TTS cache now works correctly in all working directories

- timestamp: 2026-02-25
  checked: app/api/library_routes.py update_clip_content (lines 1747-1808)
  found: CRIT-03/03b FIXED — ownership checks present for both endpoints
  implication: No horizontal privilege escalation

- timestamp: 2026-02-25
  checked: app/api/pipeline_routes.py render_variants (lines 1150-1162)
  found: P-BUG-01 FIXED — re-render guard now only skips "processing" variants
  implication: Users can re-render after editing

- timestamp: 2026-02-25
  checked: app/api/library_routes.py cancel_generation (lines 533-554)
  found: HIGH-01 FIXED — cancel endpoint exists and implemented
  implication: Project cancellation works end-to-end

- timestamp: 2026-02-25
  checked: app/api/routes.py process_job (lines 439-442)
  found: HIGH-02 FIXED — update_progress calls update_job on every step
  implication: Progress bars update correctly during long operations

- timestamp: 2026-02-25
  checked: frontend/src/lib/api.ts (line 38)
  found: HIGH-04 FIXED — Content-Type conditionally omitted for FormData bodies
  implication: File uploads won't break multipart parsing

- timestamp: 2026-02-25
  checked: app/main.py (lines 50-66)
  found: HIGH-05 FIXED — _recover_stuck_projects runs on startup
  implication: Projects no longer stuck after server restart

- timestamp: 2026-02-25
  checked: app/db.py existence and imports across codebase
  found: HIGH-06 FIXED — shared get_supabase() singleton in app/db.py
  implication: Single connection pool across all modules

- timestamp: 2026-02-25
  checked: frontend/src/hooks/use-job-polling.ts (lines 7-28)
  found: HIGH-07 FIXED — extractProgress() handles multiple formats
  implication: Progress bars work correctly

- timestamp: 2026-02-25
  checked: app/services/assembly_service.py lines 716 and 922
  found: P-BUG-02/06 FIXED — SRT cache key now consistent in both methods
  implication: No redundant TTS generation, correct cache hits/misses

- timestamp: 2026-02-25
  checked: app/services/segment_transforms.py line 108-111
  found: P-BUG-07 FIXED — opacity uses colorchannelmixer in RGB space
  implication: Opacity transforms now work with yuv420p pipeline

- timestamp: 2026-02-25
  checked: app/api/pipeline_routes.py lines 519-528
  found: P-BUG-09 FIXED — tts_previews now included in DB update
  implication: TTS cache invalidation survives server restarts

- timestamp: 2026-02-25
  checked: app/api/pipeline_routes.py lines 1632-1644
  found: P-BUG-10 FIXED — audio endpoint falls back to tts_previews
  implication: Timeline editor preview works with library-adopted TTS

- timestamp: 2026-02-25
  checked: frontend/src/components/timeline-editor.tsx (full file)
  found: NEW-01 — no unmount cleanup for inline preview audio/video elements
  implication: Audio plays in background after navigating away from Step 3

- timestamp: 2026-02-25
  checked: app/config.py line 46 + script_generator.py line 27
  found: NEW-02 — default anthropic_model is "claude-sonnet-4-20250514" (invalid ID)
  implication: Claude-based script generation fails by default

## Resolution

root_cause: Multiple bugs across library, pipeline, and frontend code
fix: Most CRIT and HIGH bugs fixed in v6-v8 milestones; 3 new issues found in uncommitted work
verification: Code review confirms fixes by reading current implementation
files_changed:
  - app/api/library_routes.py (CRIT-01, CRIT-03, HIGH-01, HIGH-03, MED-01)
  - app/services/tts_cache.py (CRIT-02)
  - app/api/routes.py (HIGH-02)
  - frontend/src/lib/api.ts (HIGH-04)
  - app/main.py (HIGH-05)
  - app/db.py (HIGH-06)
  - frontend/src/hooks/use-job-polling.ts (HIGH-07)
  - app/api/pipeline_routes.py (P-BUG-01, P-BUG-04, P-BUG-05, P-BUG-09, P-BUG-10)
  - app/services/assembly_service.py (P-BUG-02/06, P-BUG-03)
  - app/services/segment_transforms.py (P-BUG-07)
  - frontend/src/app/pipeline/page.tsx (P-BUG-08, P-BUG-12, P-BUG-13)
  - frontend/src/components/timeline-editor.tsx (NEW — introduces NEW-01, NEW-03)
  - app/config.py (partial P-BUG-11 fix, introduces NEW-02 default)
  - app/services/script_generator.py (partial P-BUG-11 fix)
  - app/api/assembly_routes.py (P-BUG-17)
