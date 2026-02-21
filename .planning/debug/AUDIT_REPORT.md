# Edit Factory - Comprehensive Bug Audit Report (v5 Post-Milestone)

**Generated:** 2026-02-21
**Scope:** All backend routes, services, frontend pages, contexts, hooks, integrations
**Previous audit:** 2026-02-12 (resolved). This is a fresh audit after v5 completion.

---

## SUMMARY

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH     | 7 |
| MEDIUM   | 8 |
| LOW      | 7 |
| **TOTAL** | **25** |

---

## CRITICAL BUGS

### CRIT-01: Bulk Render Missing Required Arguments - RUNTIME CRASH
**File:** `app/api/library_routes.py`, lines 2158-2177
**Function:** `_start_render_for_clip`

```python
await _render_final_clip_task(
    clip_id=clip_id,
    clip_data=clip.data,
    content_data=content.data[0] if content.data else None,
    preset_data=preset.data
    # MISSING: project_id (required), profile_id (required)
)
```

`_render_final_clip_task` has this signature:
```python
async def _render_final_clip_task(
    clip_id: str,
    project_id: str,    # Required, NOT passed
    profile_id: str,    # Required, NOT passed
    ...
)
```

**Impact:** Every call to `POST /library/clips/bulk-render` crashes with `TypeError: _render_final_clip_task() missing 2 required positional arguments: 'project_id' and 'profile_id'`. The exception is caught by the outer `try/except` in `_start_render_for_clip`, error is logged, clips remain stuck in `"processing"` status permanently.

**Fix:** Pull from clip.data:
```python
if clip.data and preset.data:
    await _render_final_clip_task(
        clip_id=clip_id,
        project_id=clip.data["project_id"],
        profile_id=clip.data["profile_id"],
        clip_data=clip.data,
        content_data=content.data[0] if content.data else None,
        preset_data=preset.data
    )
```

---

### CRIT-02: TTS Cache Uses Relative Path - Cache Never Works
**File:** `app/services/tts_cache.py`, line 16

```python
CACHE_ROOT = Path("cache/tts")
```

This is a relative path resolved from the process's current working directory at import time. In WSL/uvicorn environments, this resolves to a different directory than expected, and cache directories are created in random locations. The cache silently misses on every lookup (the `except Exception` in `cache_lookup` returns `None`), so every TTS generation hits the ElevenLabs API.

**Impact:** TTS cache is completely broken. All cost savings from caching are lost. Potential ElevenLabs rate limit exhaustion.

**Fix:**
```python
from app.config import get_settings
# Anchor to the project's base directory:
CACHE_ROOT = get_settings().base_dir / "cache" / "tts"
```
Or at module level: `CACHE_ROOT = Path(__file__).parent.parent.parent / "cache" / "tts"`

---

### CRIT-03: Security - `update_clip_content` Missing Ownership Check
**File:** `app/api/library_routes.py`, lines 1583-1621

```python
@router.put("/clips/{clip_id}/content")
async def update_clip_content(clip_id: str, content: ClipContentUpdate, profile: ProfileContext = ...):
    # ...
    clip = supabase.table("editai_clips").select("id")\
        .eq("id", clip_id)\
        .single().execute()  # BUG: Missing .eq("profile_id", profile.profile_id)
```

The endpoint authenticates the user but does not verify the clip belongs to the authenticated profile. Any authenticated user can overwrite TTS text, SRT subtitles, and subtitle settings for any other user's clip.

**Impact:** Horizontal privilege escalation - authenticated users can corrupt other users' content.

**Fix:** Add ownership check:
```python
clip = supabase.table("editai_clips").select("id")\
    .eq("id", clip_id)\
    .eq("profile_id", profile.profile_id)\
    .single().execute()
```

**Related:** `copy_content_from_clip` (line 1624) has NO auth dependency at all - completely unauthenticated endpoint:
```python
async def copy_content_from_clip(clip_id: str, source_clip_id: str):
    # No profile context dependency!
```

---

## HIGH BUGS

### HIGH-01: `cancelGeneration` Calls Non-Existent Backend Endpoint
**File:** `frontend/src/app/library/page.tsx`, line 775

```typescript
await fetch(`${API_URL}/library/projects/${selectedProject.id}/cancel`, {
  method: "POST"
});
```

There is no `POST /library/projects/{id}/cancel` endpoint in `library_routes.py`. The request returns 404 (silently caught and ignored). The project status is never reset on the backend, so the generation task continues running in the background.

**Impact:** User sees cancel succeed in UI (client state reset), but backend keeps generating clips. Clips appear later unexpectedly. Projects never actually get cancelled.

**Fix:** Either implement the cancel endpoint that resets project status to `"failed"` and records the lock state, or remove the cancel UI button.

---

### HIGH-02: Background Job Progress Updates Not Persisted During Processing
**File:** `app/api/routes.py`, lines 659-712

```python
async def process_job(job_id: str):
    job = get_job_storage().get_job(job_id)
    job["status"] = JobStatus.PROCESSING  # Mutates local dict
    job["progress"] = "Starting..."       # NOT written to Supabase yet

    # ... long video processing ...

    get_job_storage().update_job(job_id, job)  # Only persisted at end
```

When Supabase is the primary storage, `get_job(job_id)` returns a fresh dict from the DB. Mutations to that dict are NOT reflected in Supabase until `update_job` is called at the very end. Polling clients always see the initial `"pending"` status through the entire processing duration.

**Impact:** Progress bars are frozen at initial state during all long-running video processing jobs.

**Fix:** Call `get_job_storage().update_job(job_id, {"status": ..., "progress": ...})` inside the `progress_callback` that is passed to `process_video`.

---

### HIGH-03: Progress Percentage Calculation Overflow for Multi-Batch Generation
**File:** `app/api/library_routes.py`, line 1157

```python
done_pct = 10 + int((variant_idx / variant_count) * 80)
```

When generating additional variants (not the first batch), `variant_idx` (e.g., 5, 6, 7) can exceed `variant_count` (e.g., 3 for the new batch). Result: 10 + (5/3)*80 = **143%** progress reported to UI.

**Impact:** Progress bar overflows to >100%, breaking the UI display.

**Fix:** Use the relative index computed earlier in the loop:
```python
relative_idx = variant_idx - start_variant_index + 1
done_pct = 10 + int((relative_idx / variant_count) * 80)
```

---

### HIGH-04: `apiFetch` Always Sets `Content-Type: application/json` Breaking FormData
**File:** `frontend/src/lib/api.ts`, lines 27-31

```typescript
const headers: HeadersInit = {
  "Content-Type": "application/json",  // Always injected
  ...customHeaders,
};
```

If `apiFetch` is ever called with a `FormData` body, the `Content-Type` header overrides the browser's automatic `multipart/form-data; boundary=...` header, breaking multipart parsing on the backend.

Currently the library page uses raw `fetch()` for all uploads (bypassing `apiFetch`), which works but means the `X-Profile-Id` header from `apiFetch` is NOT sent on upload requests. In production (auth enabled), this results in the server auto-selecting the default profile rather than the one the user has selected in the UI.

**Fix:** Add a dedicated upload helper that omits `Content-Type` but still injects `X-Profile-Id`.

---

### HIGH-05: No Recovery for Projects Stuck in `"generating"` After Server Restart
**File:** `app/api/library_routes.py`, `app/main.py`

Background tasks (FastAPI `BackgroundTasks`) are in-process. A server restart kills all in-flight generation tasks. The `_generation_progress` dict is also cleared. But projects in Supabase remain with `status="generating"` indefinitely.

**Impact:** After any server restart, users see projects permanently stuck at "Generating..." with no way to retry except manually editing the DB.

**Fix:** Add a startup task that queries all projects with `status="generating"` and resets them to `status="failed"` with `error_message="Server restarted during generation"`.

---

### HIGH-06: Multiple Independent Supabase Client Instances (5+ per process)
**Files:** `library_routes.py`, `segments_routes.py`, `auth.py`, `assembly_service.py`, `tts_library_routes.py`, `elevenlabs_account_manager.py`

Each module maintains its own `_supabase_client` singleton, resulting in 6+ independent Supabase connections per server process. The `elevenlabs_account_manager.py` doesn't even cache — creates a new client on every call to `_get_supabase()`.

**Impact:** Connection exhaustion under load; wasted resources; no shared connection pooling.

**Fix:** Create a shared `get_supabase()` in `app/db.py` imported everywhere.

---

### HIGH-07: `use-job-polling.ts` Progress Parsing Always Returns 0
**File:** `frontend/src/hooks/use-job-polling.ts`, line 110

```typescript
const progressNum = parseInt(job.progress) || 0;
```

Backend `job.progress` is always a human-readable string like `"Generating voice-over..."` or `"Completed: 3/5 videos"`. `parseInt("Generating...")` returns `NaN`, so `progressNum` is always `0`.

**Impact:** Any UI component that uses the `progress` value from `useJobPolling` shows 0% throughout. ETA calculation (`calculateETA`) with `progressDone = 0 - 10 = -10` produces nonsensical results.

**Fix:** Either change backend to send numeric progress (0-100) in a separate field, or use the `status` field to infer rough progress (pending=10, processing=50, completed=100).

---

## MEDIUM BUGS

### MED-01: `get_project` and Similar Endpoints Mask 404 as 500
**File:** `app/api/library_routes.py`, lines 338-367 (and similar pattern in create_project, delete_project)

```python
try:
    if result.data:
        return ProjectResponse(...)
    raise HTTPException(status_code=404, detail="Project not found")  # Raised inside try
except Exception as e:       # Catches HTTPException!
    raise HTTPException(status_code=500, detail=str(e))  # Re-raises as 500
```

The `except Exception` catches the `HTTPException(404)` thrown two lines above and converts it to a 500. The frontend sees a 500 error instead of a clean 404.

**Fix:** Add `except HTTPException: raise` before the generic `except Exception` handler in all route functions.

---

### MED-02: `verify_project_ownership` Returns 404 on DB Errors
**File:** `app/api/library_routes.py`, lines 144-162

```python
except Exception as e:
    logger.error(f"Error verifying project ownership: {e}")
    raise HTTPException(status_code=404, detail="Project not found")
```

Database connection failures return 404 instead of 503, masking infrastructure outages as "project not found" to callers and monitoring.

---

### MED-03: TTS Audio Persist Failure Silently Allows Cleanup to Delete Audio
**File:** `app/api/library_routes.py`, lines 1953-1964 and 2113-2124

The TTS audio is copied to a persistent path in a `try/except` that silently suppresses errors. If the copy fails, the audio is still deleted in the `finally` cleanup block. The clip ends up with a `tts_audio_path` in the DB pointing to a non-existent file, and the audio download endpoint returns 404.

---

### MED-04: `ExportPreset` Type Mismatch Frontend vs Backend
**File:** `frontend/src/types/video-processing.ts` line 85 vs `library_routes.py` line 130

```typescript
// Frontend:
export interface ExportPreset { bitrate: string; }

// Backend:
class ExportPresetResponse(BaseModel):
    video_bitrate: str  # Different name
    audio_bitrate: str  # Not in frontend type
```

Frontend `preset.bitrate` will always be `undefined`. Any code displaying bitrate info will show nothing.

---

### MED-05: `update_project` Allows Client-Driven Status Transitions
**File:** `app/api/library_routes.py`, lines 399-421

```python
allowed_fields = ["name", "description", "status", "target_duration", "context_text"]
```

The `status` field is in the allowlist. Any authenticated client can set project status to arbitrary values like `"completed"`, `"generating"`, `"ready_for_triage"`, bypassing the backend state machine.

---

### MED-06: `process_tts_job` Background Task Not Passed Profile ID
**File:** `app/api/routes.py`, lines 1241 and 1251

```python
# Route handler (has profile context):
background_tasks.add_task(process_tts_job, job_id)  # profile_id not passed

# Background function default:
async def process_tts_job(job_id: str, profile_id: Optional[str] = "default"):
    temp_dir = settings.base_dir / "temp" / profile_id  # Always "temp/default"
```

TTS jobs always use `temp/default` as the temp directory regardless of profile. In a multi-profile setup this is a shared dir.

---

### MED-07: `_generate_raw_clips_task` Wraps Dict in Anonymous Object
**File:** `app/api/library_routes.py`, line 477

```python
project_data = verify_project_ownership(...)
project = type('obj', (object,), {'data': project_data})()  # Unnecessary wrapper
# Then: target_duration=project.data["target_duration"]
```

Dynamic object creation via `type()` is a code smell. This is done just to write `project.data["target_duration"]` instead of `project_data["target_duration"]`. Same pattern in `generate_from_segments`.

---

### MED-08: `_delete_clip_files` Silently Ignores All Errors
**File:** `app/api/library_routes.py`, lines 2263-2270

```python
except Exception:
    pass  # Not even logged - orphaned files accumulate silently
```

File deletion failures leave orphaned files on disk with no log trace and no way to identify them during maintenance.

---

## LOW / CODE QUALITY

### LOW-01: `startup_event` Uses Deprecated FastAPI `on_event`
**File:** `app/main.py`, line 86
`@app.on_event("startup")` is deprecated in FastAPI in favor of `lifespan` context manager.

### LOW-02: Frontend Hardcodes `localhost:8000` in Component Defaults
**File:** `frontend/src/components/video-processing/variant-triage.tsx`, line 51
`apiBaseUrl = "http://localhost:8000/api/v1"` as a prop default means production builds without the prop will try to connect to localhost.

### LOW-03: `_build_mute_filter` Type Hint Says `str` but Returns `None`
**File:** `app/api/library_routes.py`, line 808
```python
def _build_mute_filter(mute_intervals: list, ...) -> str:  # Wrong - can return None
    if not mute_intervals:
        return None
```

### LOW-04: `ElevenLabsAccountManager._get_supabase()` Creates New Client Every Call
**File:** `app/services/elevenlabs_account_manager.py`, lines 46-53
No caching in `_get_supabase()` - a new Supabase client is created on every call.

### LOW-05: `generate-from-segments` Frontend Requests Missing Profile Header
**File:** `frontend/src/app/library/page.tsx`, raw `fetch()` calls at lines 742, 800
These bypass `apiFetch()` and therefore don't include the `X-Profile-Id` header. In production this means the backend auto-selects the default profile, ignoring the UI-selected profile.

### LOW-06: Progress Bar Polling State Not Reset Between Jobs in `useJobPolling`
**File:** `frontend/src/hooks/use-job-polling.ts`
When `startPolling` is called for a second job, `startTimeRef` is reset but `estimatedRemaining` from the previous job flashes briefly before being replaced.

### LOW-07: `cleanup_orphaned_temp_files` Doesn't Recurse Into Subdirectories
**File:** `app/api/library_routes.py`, lines 2554-2566
The cleanup only iterates files directly in each temp directory, not nested subdirectories created by `extend_{project_id[:8]}` or `ttslib_{asset_id[:8]}`. These subdirectories accumulate without cleanup.

---

## INTEGRATION NOTES

### Supabase Tables Referenced Without Confirmed Migrations
The following tables are used in code but not confirmed to exist in the visible migration files (migrations 008, 010, 011 are untracked):
- `editai_exports` (insert in `_render_final_clip_task`) - if missing, every render fails at final insert
- `editai_export_presets` (queried in render) - if missing, all renders fail immediately
- `editai_clip_content` (used throughout)
- `editai_project_segments` (used in segment generation)
- `profiles` (used in auth)

The git status shows migrations 008, 010, 011 as untracked (not committed). If they haven't been run in Supabase, the app will have broken DB operations.

---

## PRIORITY ORDER FOR FIXES

1. **CRIT-01** - Bulk render crash (blocks a core feature)
2. **CRIT-03** - Security vulnerability (data integrity)
3. **CRIT-03b** - Unauthenticated `copy_content_from_clip`
4. **CRIT-02** - TTS cache path (cost leak)
5. **HIGH-01** - Cancel endpoint 404 (broken UX)
6. **HIGH-05** - Stuck "generating" projects after restart (operational issue)
7. **MED-01** - 404/500 confusion in error handling (debugging quality)
8. **HIGH-07** - Progress parsing (bad UX)
9. **HIGH-04** - FormData Content-Type issue (production correctness)
10. All other HIGH/MEDIUM items
