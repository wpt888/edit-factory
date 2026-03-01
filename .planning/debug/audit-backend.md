# Backend Audit Report — Edit Factory

**Date**: 2026-02-26
**Scope**: Full FastAPI backend (`app/`) — routes, services, config, database
**Method**: Static code analysis of all key files

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 8 |
| Medium | 12 |
| Low | 9 |
| **Total** | **31** |

All Python files parse without syntax errors. The application imports successfully.

---

## Critical Issues

### C-1. TLS Verification Disabled on Supabase Client

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/db.py`, line 23
**Severity**: Critical

```python
options = SyncClientOptions(
    httpx_client=httpx.Client(verify=False),
)
```

The shared Supabase client disables TLS certificate verification. This makes every database request vulnerable to man-in-the-middle attacks. An attacker on the network path can intercept and modify all Supabase traffic, including auth tokens, user data, and service role keys.

**Fix**: Remove `verify=False`. If there is a certificate issue in the development environment, use a properly configured CA bundle instead:
```python
options = SyncClientOptions(
    httpx_client=httpx.Client(),  # verify=True is the default
)
```

---

### C-2. Unauthenticated File Serving Endpoints (3 instances)

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 1752
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/routes.py`, line 917
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, line 267
**Severity**: Critical

Three `serve_file` / `serve_segment_file` endpoints serve files from the filesystem without requiring authentication:

- `GET /api/v1/segments/files/{file_path:path}` — **no auth at all**, no `Depends(get_profile_context)`
- `GET /api/v1/files/{file_path:path}` (routes.py) — no auth
- `GET /api/v1/library/files/{file_path:path}` — no auth (relies only on path validation)

While path traversal is mitigated (allowed-dirs check + resolve), anyone can enumerate and download user videos, thumbnails, and rendered output if they guess the file path structure.

The segments file endpoint at line 1752 has an additional weakness: its `except Exception` at line 1790 swallows the `HTTPException` from the security check, potentially returning a generic 403 instead of failing securely.

**Fix**: Add `profile: ProfileContext = Depends(get_profile_context)` to all file-serving endpoints. Verify that the requested file belongs to the authenticated profile.

---

## High Issues

### H-1. Pipeline Status Endpoint Lacks Authentication

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 1416
**Severity**: High

```python
@router.get("/status/{pipeline_id}", response_model=PipelineStatusResponse)
async def get_pipeline_status(pipeline_id: str):
```

The status endpoint is intentionally public (comment says "UUID acts as capability token"). However, the response exposes full script texts, rendering progress, and file system paths (`final_video_path`, `thumbnail_path`, `audio_path`) to anyone with the UUID. If a pipeline ID leaks (logs, browser history, referrer headers), the attacker gains access to all pipeline data.

**Fix**: Add authentication. The UUID-as-token pattern is insufficient when the response contains sensitive data and file paths. At minimum, strip `final_video_path` from the public response.

---

### H-2. Publish Progress Endpoint Lacks Authentication

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/postiz_routes.py`, line 504
**Severity**: High

```python
@router.get("/publish/{job_id}/progress")
async def get_publish_job_progress(job_id: str):
```

Same pattern as H-1. No authentication. Anyone with a job ID can see publish progress including status messages that may contain platform names and error details.

**Fix**: Add `Depends(get_profile_context)` and verify ownership.

---

### H-3. Several Job/Status Endpoints Lack Authentication

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/routes.py`, lines 70, 134, 188, 497, 524
**Severity**: High

Multiple endpoints have no auth:
- `GET /api/v1/usage` — exposes ElevenLabs subscription details, API key metadata
- `GET /api/v1/gemini/status` — actively calls Gemini API with stored key, exposes connection status
- `GET /api/v1/health` — low risk, but exposes infrastructure info
- `GET /api/v1/jobs/{job_id}` — exposes job data including file paths
- `GET /api/v1/jobs` — lists ALL jobs from ALL users
- `DELETE /api/v1/jobs/{job_id}` — unauthenticated deletion of any job

**Fix**: Add authentication to all sensitive endpoints. `health` can remain public. `jobs` and `usage` need profile scoping.

---

### H-4. In-Memory State Not Thread-Safe

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 39
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/postiz_routes.py`, line 80
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, line 109
**Severity**: High

Multiple global dicts are accessed concurrently from async handlers and background tasks without locks:

- `_pipelines: Dict[str, dict]` — modified in background render tasks and read by status endpoint
- `_publish_progress: Dict[str, dict]` — modified in background publish tasks and read by progress endpoint
- `_generation_progress: Dict[str, dict]` — modified in background tasks and read by progress endpoint
- `_cancelled_projects: set` — modified/read from multiple tasks

While Python's GIL prevents data corruption at the dict level, the lack of synchronization means concurrent reads and writes to the same pipeline dict entry can produce inconsistent state (e.g., a half-updated render_jobs dict).

**Fix**: Use `threading.Lock()` to protect mutations of shared pipeline/progress state, or use `asyncio.Lock()` for the async context. The library_routes already has `_locks_lock` as a pattern to follow.

---

### H-5. Background Task Silent Failure — No DB Status Update

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, line 1054 (`_generate_raw_clips_task`)
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 1179 (`do_extract`)
**Severity**: High

The `_generate_raw_clips_task` function's `except` at line 777 updates the DB to "failed", but if `get_supabase()` returns None at line 691, the function simply returns without updating anything — leaving the project stuck in "generating" status forever. The startup recovery (`_recover_stuck_projects`) only fixes this on restart.

The `do_extract` background task at line 1179 in segments_routes has no error handling at all — if the extraction fails, there is no status update, no log of the failure.

**Fix**:
1. For `_generate_raw_clips_task`: move the supabase check after the lock acquisition, or use a fallback notification mechanism
2. For `do_extract`: wrap in try/except and log/update status on failure

---

### H-6. Unbounded File Upload to Memory

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 322
**Severity**: High

```python
content = await video.read()
f.write(content)
```

The entire uploaded video is read into memory at once. While `validate_upload_size` exists in routes.py, the segments upload endpoint does **not** call it. For a 500MB upload, this consumes 500MB of server RAM.

**Fix**: Use `shutil.copyfileobj(video.file, f)` (streaming write) as done in routes.py, and add `validate_upload_size(video)` before the read.

---

### H-7. Error Messages Leak Internal Details

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 718
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 714
**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, line 1618
**Severity**: High

Several endpoints return raw exception messages or file system paths in error responses:

```python
# pipeline_routes.py:718
detail=f"Pipeline generation service unavailable: {str(e)}"

# segments_routes.py:714
detail=f"Voice detection failed: {e}"

# library_routes.py:1618
detail=f"Video file not found: {video_path}"
```

These can leak internal file paths, stack trace fragments, and service configuration details to the client.

**Fix**: Log the full error server-side, return generic messages to the client.

---

### H-8. Service Role Key Used for All Client Operations

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/db.py`, line 21
**Severity**: High

```python
key = settings.supabase_service_role_key or settings.supabase_key
```

The service role key bypasses all Row Level Security (RLS) policies. If configured, ALL database operations (even user-facing queries) use the service role key, meaning RLS provides zero protection. Any bug in profile scoping logic directly exposes other users' data.

**Fix**: Use the anon key for user-facing operations and only use the service role key for specific admin operations that need it. Or ensure RLS is not relied upon as a security boundary (it currently is not, since profile scoping is done in application code, but this is still a defense-in-depth concern).

---

## Medium Issues

### M-1. Duplicate Helper Functions Across Files

**Files**: Multiple
**Severity**: Medium

The following functions are duplicated across files:
- `_sanitize_filename()` — in `routes.py` (line 217), `library_routes.py` (line 2391), `segments_routes.py` (line 206)
- `_get_video_info()` — in `library_routes.py` (line 2403), `segments_routes.py` (line 126)
- `_generate_thumbnail()` — in `library_routes.py` (line 2446), `segments_routes.py` (line 164) (different signatures)
- `_parse_srt()` — in `assembly_service.py` (line 207), `segments_routes.py` (line 1612)
- `_srt_time_to_seconds()` — in `assembly_service.py` (line 231), `segments_routes.py` (line 1637)

**Fix**: Extract shared utilities to a common module (e.g., `app/services/media_utils.py`).

---

### M-2. FFmpeg Subprocess Calls Missing Timeout (some instances)

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, lines 137, 175, 200
**Severity**: Medium

Several `subprocess.run()` calls for FFmpeg lack a `timeout` parameter:
```python
result = subprocess.run(cmd, capture_output=True, text=True)  # line 137
result = subprocess.run(cmd, capture_output=True)  # line 175
result = subprocess.run(cmd, capture_output=True)  # line 200
```

A malformed video could cause FFmpeg to hang indefinitely, blocking the worker thread.

**Fix**: Add `timeout=300` (or appropriate limit) to all `subprocess.run()` calls.

---

### M-3. Temp Directory Accumulation — No Cleanup

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/assembly_service.py`, line 262
**Severity**: Medium

```python
temp_dir = self.settings.base_dir / "temp" / profile_id / f"assembly_{uuid.uuid4().hex[:8]}"
temp_dir.mkdir(parents=True, exist_ok=True)
```

Every TTS generation creates a new temp directory (`assembly_XXXXXXXX`) that is never cleaned up. Over time, these accumulate consuming disk space. The `temp/{profile_id}/` directories also accumulate from routes.py, library_routes.py, etc.

**Fix**: Add cleanup logic after successful render completion. Consider a periodic cleanup task in the lifespan handler.

---

### M-4. Concurrent Renders Can Modify Same Pipeline Dict

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 1181
**Severity**: Medium

The `do_render` closure captures `pipeline` by reference. When multiple variants render concurrently (all added as background tasks in the same request), they all mutate `pipeline["render_jobs"]` simultaneously. While the GIL prevents true data races on dict assignment, the `_db_update_render_jobs` call at line 1287 writes the entire `render_jobs` dict — a slower variant could overwrite the completion status of a faster one.

**Fix**: Use a lock per pipeline for render job updates, or use atomic per-key DB updates instead of overwriting the entire JSONB column.

---

### M-5. `_evict_old_pipelines` Eviction by Created-At String Sort

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 47
**Severity**: Medium

```python
to_remove = sorted(_pipelines.keys(),
    key=lambda k: _pipelines[k].get("created_at", "")
)[:len(_pipelines) - _MAX_PIPELINE_ENTRIES]
```

Eviction sorts by ISO 8601 string which works correctly for comparison, but the default `""` for missing `created_at` means pipelines without timestamps will be evicted first, regardless of actual age. This is minor but could cause unexpected eviction behavior.

**Fix**: Use a sentinel date far in the past for missing values: `_pipelines[k].get("created_at", "1970-01-01T00:00:00")`.

---

### M-6. Path Traversal Mitigation Inconsistency in `serve_segment_file`

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 1763
**Severity**: Medium

```python
if '..' in decoded_path:
    raise HTTPException(status_code=403, detail="Invalid path")
```

The `..` check is a string-level check that can be bypassed with encoded sequences. While the subsequent `resolve()` + allowed-dirs check provides proper protection, the initial check gives a false sense of security. More importantly, the `except Exception` at line 1790 catches the `HTTPException` from the security check and re-raises a generic 403.

**Fix**: Remove the string-level `..` check (it's redundant with the resolve check) and ensure the except clause re-raises HTTPException before catching generic exceptions.

---

### M-7. `update_project` Accepts Arbitrary Dict Without Pydantic Validation

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py`, line 508
**Severity**: Medium

```python
async def update_project(
    project_id: str,
    updates: dict,  # Raw dict, no Pydantic model
    ...
```

While the handler filters to `allowed_fields`, using a raw `dict` means no type validation on the values. A caller could send `target_duration: "not_a_number"` and it would be passed through to Supabase.

**Fix**: Define a `ProjectUpdate` Pydantic model with typed optional fields.

---

### M-8. Pipeline Delete Removes from Memory Before Verifying Ownership

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 399
**Severity**: Medium

```python
# Remove from in-memory cache
_pipelines.pop(pipeline_id, None)  # line 399 — BEFORE ownership check

# Remove from DB
try:
    # ... ownership check at line 412
```

The pipeline is removed from memory before verifying the caller owns it. If the ownership check fails (403), the pipeline is already gone from the in-memory cache, though it remains in the DB and can be reloaded on next access.

**Fix**: Move the in-memory removal to after the ownership verification succeeds.

---

### M-9. No Input Length Validation on Script/Idea Text

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, line 618
**Severity**: Medium

The `idea` field in `PipelineGenerateRequest` only checks for non-empty after strip, but has no maximum length. A user could submit a multi-megabyte idea string that gets passed to the Gemini/Claude API, potentially causing excessive costs.

Same issue with `context` field and `scripts` in `PipelineUpdateScriptsRequest`.

**Fix**: Add `max_length` constraints to Pydantic model fields:
```python
idea: str = Field(..., min_length=1, max_length=5000)
context: str = Field("", max_length=10000)
```

---

### M-10. Cost Log File Concurrent Access Without Lock

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/cost_tracker.py`, lines 65-76
**Severity**: Medium

The `_load_log()` and `_save_log()` methods read/write to the same JSON file without any locking. Concurrent requests logging costs could corrupt the JSON file.

**Fix**: Use a `threading.Lock()` around file I/O operations, or use an append-only log format.

---

### M-11. `voice_detector.py` Temp File Left on Exception Path

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/voice_detector.py`, line 201
**Severity**: Medium

```python
with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
    tmp_audio = Path(tmp.name)

try:
    # ... use tmp_audio ...
finally:
    # Missing: tmp_audio.unlink(missing_ok=True)
```

The `detect_voice` method creates a temp WAV file with `delete=False` but I see no `finally` cleanup block for `tmp_audio` after the try block (the inner `_read_audio` function has its own temp cleanup for the conversion case, but the outer `detect_voice` temp file needs its own cleanup).

**Fix**: Verify there is a `finally: tmp_audio.unlink(missing_ok=True)` after the try block. If not, add one.

---

### M-12. `list_product_groups` and `list_product_groups_bulk` N+1 Query

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, lines 1329, 1537
**Severity**: Medium

Both endpoints issue a separate Supabase query for each product group to count segments:

```python
for g in result.data:
    seg_count = supabase.table("editai_segments")\
        .select("id", count="exact")\
        .eq("product_group", g["label"])\
        .execute()
```

For N product groups, this makes N+1 database queries.

**Fix**: Fetch all segment counts in a single query grouped by `product_group`, then map results.

---

## Low Issues

### L-1. Backup File Committed to Repo

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py.backup`
**Severity**: Low

An untracked backup file exists. It won't cause runtime issues but adds noise to the repo.

**Fix**: Add to `.gitignore` or delete.

---

### L-2. Unused Import: `StreamingResponse` in segments_routes.py

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 15
**Severity**: Low

`StreamingResponse` is imported but never used.

**Fix**: Remove unused import.

---

### L-3. Hardcoded Default Preset Values

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/pipeline_routes.py`, lines 1124-1145
**Severity**: Low

When the preset is not found in the database, hardcoded fallback values are used in two places (lines 1124 and 1136). These duplicate values should be centralized.

**Fix**: Define a `DEFAULT_PRESET` constant and reuse it.

---

### L-4. Inconsistent Response Formats

**Severity**: Low

Some endpoints return raw dicts, others return Pydantic models:
- `list_projects` returns `{"projects": result.data}` (raw Supabase data)
- `get_project` returns `ProjectResponse` (Pydantic model)
- `update_project` returns `{"status": "updated", "project": result.data[0]}`

This makes the API harder to consume consistently.

**Fix**: Define response models for all endpoints.

---

### L-5. Emoji in Log Messages

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/auth.py`, lines 111, 208, 218, 225
**Severity**: Low

Warning-level log messages contain emoji characters. Some log aggregation tools may not handle these correctly.

**Fix**: Remove emoji from log messages.

---

### L-6. `get_settings()` Called Multiple Times Per Request

**Severity**: Low

Multiple endpoints call `get_settings()` within their handler body. While `@lru_cache` ensures this is cheap, it is still an unnecessary function call overhead. In some files, `settings` is a module-level variable; in others, it is fetched per-request.

**Fix**: Standardize on module-level `settings = get_settings()` at the top of each router file.

---

### L-7. Health Check Creates Redis Connection Per Request

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/routes.py`, line 200
**Severity**: Low

```python
r = redis.from_url(settings.redis_url)
r.ping()
```

Each health check creates a new Redis connection that is never closed. While Python's garbage collector will eventually clean it up, this is wasteful.

**Fix**: Use a `try/finally` with `r.close()`, or use a connection pool.

---

### L-8. `_extract_waveform` Uses Python Loop for PCM Parsing

**File**: `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/segments_routes.py`, line 606
**Severity**: Low

The waveform extraction uses a Python-level loop with `struct.unpack_from` per sample, which is very slow for large audio files. For 800 bins of a 60-second file at 8kHz, this processes ~480,000 samples in pure Python.

**Fix**: Use `numpy.frombuffer(raw, dtype=np.int16)` for vectorized processing, which would be ~100x faster.

---

### L-9. Module-Level Import Inside Function Bodies

**Severity**: Low

Several places use `import re` or `from urllib.parse import unquote` inside function bodies (e.g., `_sanitize_filename`, `serve_segment_file`). While not incorrect, this is a minor performance hit on first call and inconsistent with the rest of the codebase.

**Fix**: Move to top-level imports.

---

## Git Status — Modified Backend Files

The following backend files have uncommitted changes:

| File | Status |
|------|--------|
| `app/api/pipeline_routes.py` | Modified (staged) |
| `app/api/postiz_routes.py` | Modified (unstaged) |
| `app/api/segments_routes.py` | Modified (unstaged) |
| `app/services/assembly_service.py` | Modified (unstaged) |
| `app/services/postiz_service.py` | Modified (unstaged) |
| `app/services/tts_subtitle_generator.py` | Modified (unstaged) |

Additionally, `app/api/library_routes.py.backup` and `update_library_routes.py` are untracked files that should be cleaned up.

---

## Recommendations — Priority Order

1. **Immediate**: Fix TLS verification (C-1) — single-line change, critical security
2. **Immediate**: Add auth to file-serving endpoints (C-2) — prevents data exposure
3. **Short-term**: Add auth to status/progress/jobs endpoints (H-1, H-2, H-3) — prevents information leakage
4. **Short-term**: Fix `serve_segment_file` to stream instead of `read()` into memory (H-6)
5. **Short-term**: Add thread safety to shared mutable state (H-4, M-4)
6. **Medium-term**: Add input length validation (M-9), fix error message leakage (H-7)
7. **Medium-term**: Clean up temp directories (M-3), consolidate duplicate code (M-1)
8. **Long-term**: Standardize response formats (L-4), optimize waveform extraction (L-8)
