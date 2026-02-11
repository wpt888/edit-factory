# Codebase Concerns

**Analysis Date:** 2026-02-12

## Tech Debt

**Large Monolithic Route Files:**
- Issue: `app/api/library_routes.py` contains 2,587 lines with mixed concerns (CRUD, rendering, progress tracking, file management). Similar overloading in `app/api/routes.py` (1,447 lines).
- Files: `app/api/library_routes.py`, `app/api/routes.py`, `app/api/segments_routes.py` (1,085 lines)
- Impact: Difficult to test, high cognitive load, increased risk of bugs during maintenance, unclear separation of concerns
- Fix approach: Refactor into smaller services by concern (e.g., separate rendering service, progress tracking service, file cleanup service). Consider moving rendering logic to `app/services/render_pipeline.py`.

**In-Memory State Without Persistence on Restart:**
- Issue: Progress tracking (`_generation_progress` dict), project locks (`_project_locks`), and publish progress (`_publish_progress`) stored in module-level globals in `app/api/library_routes.py` and `app/api/postiz_routes.py`. Lost on server restart.
- Files: `app/api/library_routes.py` (lines 49, 32-33), `app/api/postiz_routes.py` (line 72)
- Impact: Long-running jobs lose progress state; clients see progress reset if server restarts mid-task. Users may re-submit jobs thinking they failed.
- Fix approach: Migrate progress tracking to Supabase `jobs` table with real-time polling. Lock management could use Redis or distributed locking via database. Phase this change after stabilizing current job storage pattern.

**Global Singleton Initialization Pattern:**
- Issue: Supabase clients initialized lazily in multiple places (`app/api/library_routes.py`, `app/api/auth.py`, `app/api/profile_routes.py`, `app/services/job_storage.py`) with duplicated null-check and init logic.
- Files: `app/api/library_routes.py` (lines 69-85), `app/api/auth.py` (lines 190-203), `app/api/profile_routes.py` (lines 20-41), `app/services/job_storage.py` (lines 24-38)
- Impact: Scattered initialization makes it hard to ensure Supabase is ready before use; harder to mock for testing; initialization errors not centralized.
- Fix approach: Create `app/services/database.py` with single `get_supabase()` factory. Replace all local get_supabase implementations with calls to this central factory.

**Inline TTS Service Selection Logic:**
- Issue: TTS provider selection (ElevenLabs vs Edge vs Coqui vs Kokoro) embedded as string matching in route handlers instead of unified service factory.
- Files: `app/api/routes.py`, `app/api/tts_routes.py` - provider selection logic scattered
- Impact: Adding new TTS provider requires changes in multiple places; provider fallback logic unclear; testing difficult.
- Fix approach: Consolidate all TTS provider selection in `app/services/tts/factory.py`. All routes should call `get_tts_service(provider_name)` instead of direct service instantiation.

## Known Bugs

**Background Task Lock Leak on Non-Blocking Acquisition Failure:**
- Symptoms: If `get_project_lock(project_id).acquire(blocking=False)` returns False in `_generate_from_segments_task` (line 853), function returns early without logging sufficient context. If a job acquisition fails silently, users see no feedback.
- Files: `app/api/library_routes.py` (lines 852-855)
- Trigger: Submit two clip generation requests for same project simultaneously
- Workaround: Wait and retry, or refresh page and resubmit
- Fix: Log detailed warning with timestamp and job_id; consider adding "locked" status to progress endpoint

**FFmpeg Command Construction Concatenation Safety:**
- Symptoms: FFmpeg concat filter using unsafe file list writes. While paths use `str()` conversion, there's no validation that file paths don't contain newlines or special concat syntax.
- Files: `app/api/library_routes.py` (line 1040: `f.write(f"file '{segment_output}'\n"`)
- Trigger: Video files with special characters in path (unlikely in production but possible)
- Workaround: Rename files to remove special characters before processing
- Fix: Escape/validate file paths in concat list; use FFmpeg's built-in path sanitization or generate absolute paths only

**Incomplete Error Context in Broad Exception Handlers:**
- Symptoms: Multiple `except Exception as e` blocks log only `str(e)` which may be truncated or lack traceback for complex errors.
- Files: `app/api/library_routes.py` (lines 159, 246, 267, 299, etc.), `app/api/routes.py` (lines 221, 232)
- Trigger: Complex failures during video processing
- Workaround: Check server logs with traceback
- Fix: Use `logger.exception()` instead of `logger.error()` to auto-include tracebacks. Consider structured logging with context (project_id, user_id, phase).

**Bare Exception Silencing in Helper Functions:**
- Symptoms: `_delete_clip_files()` and `_get_video_duration()` use bare `except Exception: pass` without logging (lines 2033, 2069-2070).
- Files: `app/api/library_routes.py` (lines 2020-2034, 2063-2070)
- Trigger: Filesystem errors, permission issues, or corrupted files
- Workaround: None - silent failures make debugging very difficult
- Fix: Replace `pass` with `logger.warning()` to surface issues. At minimum: `except Exception as e: logger.warning(f"_delete_clip_files failed: {e}")`

**Race Condition: Project Lock Cleanup Not Guaranteed:**
- Symptoms: If `_generate_from_segments_task()` crashes hard (OOM, segfault), `cleanup_project_lock()` at line 1131 may not execute, leaving lock in `_project_locks` dict forever.
- Files: `app/api/library_routes.py` (lines 1127-1132, particularly the finally block at 1127)
- Trigger: Out-of-memory during rendering or system crash
- Workaround: Restart backend server
- Fix: Use context manager pattern: `with acquire_lock(project_id):` to guarantee cleanup even on crash

## Security Considerations

**Supabase JWT Validation Disabled in Development:**
- Risk: When `auth_disabled=true` (intended for local dev), all authentication is bypassed. If `.env` with `auth_disabled=true` is accidentally deployed to production, entire system is open.
- Files: `app/config.py` (line 52), `app/api/auth.py` (lines 220-240)
- Current mitigation: Documentation in CLAUDE.md warns this is dev-only. Config defaults to `False`.
- Recommendations:
  - Add explicit environment variable validation at startup: fail fast if `auth_disabled=true` and `ENV=production`
  - Add warning log when server starts with `auth_disabled=true`
  - Consider moving `auth_disabled` to a separate config file NOT checked into git

**File Path Traversal Prevention Exists But Incomplete:**
- Risk: `_sanitize_filename()` (lines 242-255 in routes.py) prevents path traversal for uploaded file names, but raw segment file paths from database (`seg["file_path"]`) in `_generate_from_segments_task()` are used directly in FFmpeg commands without validation.
- Files: `app/api/routes.py` (lines 242-255), `app/api/library_routes.py` (lines 1023, 1046)
- Current mitigation: Database values assumed trusted (come from previous uploads), but no runtime validation
- Recommendations:
  - Add path validation in `_generate_from_segments_task()`: ensure all file paths are within expected `output_dir` or `input_dir`
  - Use `Path.resolve()` and `.is_relative_to()` to enforce sandbox
  - Validate before passing to FFmpeg: `if not Path(seg["file_path"]).resolve().is_relative_to(settings.base_dir): raise ValueError()`

**Profile ID Validation Is Opt-in Per Route:**
- Risk: Routes that don't use `Depends(get_profile_context)` have no profile isolation. Users could potentially access other users' data if they know the IDs.
- Files: `app/api/library_routes.py` - most endpoints properly validate, but some older endpoints might be missing checks
- Current mitigation: Most library routes check `profile.profile_id` in queries
- Recommendations:
  - Create a fixture/middleware that enforces profile context on all routes (or whitelelist public routes explicitly)
  - Add automated test: "GET /api/v1/library/projects with different profile ID should return 403"

**Subprocess Command Injection Not Fully Mitigated:**
- Risk: While FFmpeg commands use list-based invocation (safe from shell injection), custom filter expressions built as f-strings could be vulnerable if user input reaches them.
- Files: `app/api/library_routes.py` (lines 806-824 audio filter construction uses user-provided data)
- Current mitigation: Filter parameters come from preset config or form inputs, validated with type hints
- Recommendations:
  - Audit filter construction: ensure user inputs (e.g., voice detection thresholds, volume levels) are numeric and range-validated BEFORE building filter strings
  - Example: `shadow_depth: int = Form(default=0)` should validate `0 <= shadow_depth <= 10` not just at type level

**Secrets in Environment Variables Not Validated at Startup:**
- Risk: Missing critical env vars (GEMINI_API_KEY, SUPABASE_KEY) fail silently with graceful degradation. Code continues but features silently don't work, users see vague errors.
- Files: `app/config.py` (lines 36-46), `app/services/gemini_analyzer.py` (lines 22-31)
- Current mitigation: Graceful degradation by design (features work without APIs)
- Recommendations:
  - At server startup, validate which secrets are required vs optional
  - Log which features are disabled due to missing secrets
  - Add `/api/v1/health` endpoint that reports which critical features are unavailable

## Performance Bottlenecks

**Synchronous FFmpeg Calls in Background Tasks:**
- Problem: `subprocess.run()` calls for FFmpeg are synchronous and blocking. Multiple concurrent render tasks consume threads from FastAPI's default thread pool, potentially blocking other requests.
- Files: `app/api/library_routes.py` (lines 1035, 1052, multiple FFmpeg calls within `_render_final_clip_task` and `_generate_from_segments_task`)
- Cause: Each video processing step (extract segment, concat, add audio, add subtitles) runs sequentially via `subprocess.run()`. No parallelization within a single render.
- Improvement path:
  1. Short-term: Add max concurrency limit (e.g., only 2 concurrent renders) via semaphore or queue
  2. Medium-term: Move video processing to async subprocess with `asyncio.create_subprocess_exec()`
  3. Long-term: Use GPU acceleration (FFmpeg CUDA/HW encoding) for faster encoding

**Unnecessary Database Queries in Loops:**
- Problem: `_update_project_counts()` (line 2073) queries ALL clips for a project to count variants/selected/exported. Called after each clip modification. If project has 100 clips, this is 100+ queries per operation.
- Files: `app/api/library_routes.py` (lines 2073-2094)
- Cause: No denormalized counters; recalculated every time
- Improvement path:
  1. Add `variants_count`, `selected_count`, `exported_count` columns to `editai_projects` table (denormalized)
  2. Update counters incrementally when clip state changes instead of recalculating
  3. Add index on `(project_id, is_deleted)` for faster filtering

**Full-Page Clip Fetches Without Pagination:**
- Problem: Library page fetches all clips for a project without limit. If project has 1000 clips, request becomes very large, slow parsing/rendering.
- Files: `frontend/src/app/library/page.tsx` (likely fetches all via `/api/v1/library/projects/{id}/clips`), `app/api/library_routes.py` (lines 1154+ get clips endpoint)
- Cause: No pagination or lazy-loading implemented
- Improvement path:
  1. Implement cursor-based pagination: `GET /api/v1/library/clips?project_id=X&limit=50&offset=0`
  2. Frontend loads first 50, implements infinite scroll or "Load More"
  3. Add `order_by(created_at desc)` and `limit()` to database query

**Voice Detection Runs for Every Segment Generation:**
- Problem: If user generates 5 variants with `mute_source_voice=true`, voice detection runs 5 times on same source videos (lines 886-912).
- Files: `app/api/library_routes.py` (lines 883-912)
- Cause: Voice segments not cached; recomputed per request
- Improvement path:
  1. Cache voice detection results in database: `editai_voice_detections(video_id, voice_segments, detected_at)`
  2. Check cache before detecting; invalidate on video re-upload
  3. Only re-detect if cache is older than 7 days or user explicitly requests refresh

## Fragile Areas

**Video Rendering Pipeline Without Atomic Operations:**
- Files: `app/api/library_routes.py` (lines 1623-1932 `_render_final_clip_task`)
- Why fragile: Multi-step process (extract audio, generate SRT, apply filters, encode) with database updates after each step. If step 3 fails but step 2 committed, clip is left in inconsistent state (partial video + partial metadata).
- Safe modification: Wrap entire pipeline in a database transaction (if Supabase supports) or create a staging area and atomic rename at end. Use a "rendering" status that's only promoted to "completed" after ALL steps succeed.
- Test coverage: Need integration tests that inject failures at each step (e.g., mock FFmpeg to fail on audio extraction) and verify rollback behavior.

**Global Lock Management Without Expiration:**
- Files: `app/api/library_routes.py` (lines 32-46, 851-855, 1927-1931)
- Why fragile: `_project_locks` dict grows unbounded (new project creates new lock, never cleaned). After weeks of use, dict could have millions of stale locks. No TTL or cleanup.
- Safe modification: Implement lock cleanup: after `cleanup_project_lock()` is called, OR auto-expire locks older than 24h via a maintenance task.
- Test coverage: Test that lock is released after task completion (use mock background task).

**Concat File Paths Without Atomic Writes:**
- Files: `app/api/library_routes.py` (lines 983-1040, concat file written line-by-line)
- Why fragile: If process crashes mid-write, concat file is corrupted. Next FFmpeg command fails with unclear error.
- Safe modification: Write to temp file, then atomic rename: `Path(temp_concat).rename(concat_list_path)` after full write completes successfully.
- Test coverage: Test with very large segment lists (1000+) to ensure concat file is complete.

**Supabase Connection Fallback Logic Unclear:**
- Files: `app/services/job_storage.py` (lines 24-38, 63-86), `app/api/library_routes.py` (lines 71-85)
- Why fragile: If Supabase fails to initialize, code silently falls back to in-memory storage. Then if Supabase comes back online, data is inconsistent (jobs stored locally not in DB). No way to know which store was used.
- Safe modification: Log clearly which store is active (Supabase or memory). At startup, if Supabase is expected (by env var), FAIL FAST rather than silently degrading. Only allow memory fallback if Supabase is explicitly optional in config.
- Test coverage: Test both scenarios: with Supabase available and with Supabase unavailable (mocked exception).

## Scaling Limits

**In-Memory Progress Dict Unlimited Growth:**
- Current capacity: Limited by available RAM. Could grow to GB+ over days if many projects are tracked.
- Limit: On instance with 4GB RAM, could track ~100k projects before memory pressure
- Scaling path:
  1. Implement TTL: auto-expire progress entries after 24h of no updates
  2. Move to Redis: `SETEX project:progress:${projectId} 86400 {...}` (1-day TTL built-in)
  3. Switch to database: store in Supabase jobs table with indexed `project_id` for real-time polling

**Synchronous subprocess Limits Concurrent Renders:**
- Current capacity: If FastAPI has default 10-worker thread pool, ~2-3 concurrent video renders max (each uses ~3-4 threads)
- Limit: Beyond 50 concurrent user requests, render queue backs up
- Scaling path:
  1. Move rendering to async queue (Celery + Redis)
  2. Dedicated render worker processes (separate from API)
  3. Batch GPU renders on powerful compute instance

**Single FFmpeg Process Per Clip:**
- Current capacity: Each clip render is one FFmpeg invocation. No parallelization within clip (e.g., can't encode audio and video in parallel)
- Limit: 1080p 60fps video encode takes 30-60s per clip on typical CPU
- Scaling path:
  1. Use FFmpeg HW acceleration: `-hwaccel cuda` (requires GPU)
  2. Parallel segment extraction: submit all segment extracts concurrently, then concat (currently sequential)
  3. Profile to find slowest step and optimize

## Dependencies at Risk

**Deprecated OpenVoice Voice Cloning Service:**
- Risk: `app/services/voice_cloning_service.py` imports OpenVoice which may not be maintained. No fallback if OpenVoice breaks.
- Impact: Voice cloning feature silently fails if import breaks; no graceful degradation
- Migration plan:
  1. Evaluate ElevenLabs voice cloning API as replacement
  2. Create voice cloning provider abstraction (similar to TTS factory pattern)
  3. Move OpenVoice to optional, add try/except at import

**Coqui TTS Model Caching Unbounded:**
- Risk: `app/services/tts/coqui.py` has `_model_cache: Dict[str, 'TTS'] = {}` that grows unbounded. Models are large (100-500MB each). Multiple models loaded = multiple GB.
- Impact: Memory exhaustion if multiple voice IDs used across sessions
- Migration plan:
  1. Add `maxsize` parameter to cache (e.g., keep only 3 most-recent models)
  2. Implement LRU eviction
  3. Load models on-demand and unload after inference (slower but memory-safe)

**FFmpeg Version Compatibility:**
- Risk: Code uses specific FFmpeg flags (e.g., `-afftdn` for audio denoising, `concat demuxer`) that may not exist in all FFmpeg versions.
- Impact: If system FFmpeg is too old, rendering silently fails with "option not found" error
- Migration plan:
  1. At startup, probe FFmpeg version: `ffmpeg -version`, cache supported codecs/filters
  2. Warn if version is too old (e.g., < 4.4)
  3. Fallback to simpler filters if advanced filters unavailable

## Missing Critical Features

**No Request Deduplication for Duplicate Submits:**
- Problem: If frontend network hiccups and user clicks submit twice, two render tasks are queued. User gets two identical outputs; resources wasted.
- Files: No deduplication logic in `render_final_clip` endpoint (line 1623)
- Workaround: User manually deletes duplicate
- Improvement: Add idempotency key to requests (client generates UUID, includes in POST body). Server checks if key already processed in last hour; returns cached result.

**No Rate Limiting on Video Processing Endpoints:**
- Problem: Malicious actor could spam `/render` endpoints, consuming all server resources.
- Files: All rendering endpoints in `app/api/library_routes.py` lack rate limiting
- Workaround: Proxy-level rate limiting (nginx/CloudFlare)
- Improvement: Add per-user rate limit (e.g., 5 renders per hour per profile) via decorator on endpoints

**No Automatic Cleanup of Orphaned Files:**
- Problem: If render fails mid-way, temp files (`/temp/{profile_id}/*.mp4`) left behind accumulate over time.
- Files: Manual cleanup endpoint exists (`/maintenance/cleanup-temp` line 1611) but never called automatically
- Workaround: Manual call to cleanup endpoint or cron job outside app
- Improvement: Auto-run cleanup on server startup and hourly; add metrics tracking orphaned files

**No Render Output Compression/Optimization Options:**
- Problem: All renders use same preset. No option for lower-bitrate for mobile, higher-quality for archive.
- Files: `app/api/library_routes.py` line 1627 preset hardcoded per clip; presets in DB but limited customization
- Improvement: Add form options for bitrate, codec selection in render dialog

## Test Coverage Gaps

**Voice Muting Logic Not Covered:**
- What's not tested: Voice segment detection and overlap calculation (`_get_overlapping_voice_mutes`, voice detection accuracy)
- Files: `app/api/library_routes.py` (lines 993-1000, 883-912), `app/services/voice_detector.py`
- Risk: Mute filter could apply wrong intervals, cutting off speech or not muting properly. Users won't notice until they publish.
- Priority: High - affects output quality

**Concat File Generation Edge Cases:**
- What's not tested: Concat with very large segment lists (1000+), special characters in file paths, disk space exhaustion during temp file writes
- Files: `app/api/library_routes.py` (lines 983-1052)
- Risk: Unknown failure modes; could crash silently or produce corrupted output
- Priority: High - affects reliability

**Parallel Render Task Collision:**
- What's not tested: Two concurrent render requests for same clip should either queue or fail gracefully. Currently untested.
- Files: `app/api/library_routes.py` (lines 1623-1932), no test for concurrent access
- Risk: Race condition could produce corrupted output or silent failure
- Priority: High - affects correctness

**Profile Isolation Enforcement:**
- What's not tested: Authenticated user A should not be able to access/modify user B's profiles or clips via API
- Files: `app/api/auth.py` (profile validation), all library endpoints
- Risk: Security breach; user data leakage
- Priority: Critical - security issue

**FFmpeg Command Failures:**
- What's not tested: What happens if FFmpeg exits with error during extract/concat/encode? Current code logs but doesn't retry or provide user feedback.
- Files: `app/api/library_routes.py` (lines 1035-1038, 1052-1055, etc. - error handling is minimal)
- Risk: Silent failures; users see "processing" forever
- Priority: Medium - affects UX

---

*Concerns audit: 2026-02-12*
