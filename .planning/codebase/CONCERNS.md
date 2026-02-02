# Codebase Concerns

**Analysis Date:** 2026-02-03

## Tech Debt

**Overly Broad Exception Handling:**
- Issue: 109 instances of bare `except Exception:` clauses that swallow all errors without differentiation
- Files: `app/api/library_routes.py` (primary), `app/services/video_processor.py`, `app/api/routes.py`, `app/api/segments_routes.py`, `app/services/*.py`
- Impact: Difficult to debug failures, mask programming errors, swallow timeout/memory errors equally
- Fix approach: Categorize exceptions by type (httpx.TimeoutException, FileNotFoundError, etc.) and handle specifically; use logging with full traceback

**Global State Management via Bare Globals:**
- Issue: Multiple singleton patterns using bare `global` keywords for cache/singletons (job storage, cost tracker, Postiz publisher, Supabase clients)
- Files: `app/services/job_storage.py` (lines 234-243), `app/services/cost_tracker.py` (lines 269-282), `app/api/library_routes.py` (lines 68-80), `app/api/segments_routes.py` (lines 28), `app/services/postiz_service.py` (lines 287-295)
- Impact: Race conditions in concurrent requests, difficult to test, state leaks between requests, hard to reset state
- Fix approach: Migrate to FastAPI dependency injection (Depends), use context managers, or thread-safe factory functions

**Project Locking with Threading Locks:**
- Issue: In-memory project locks in `app/api/library_routes.py` (lines 27-41) will not work in multi-worker setups
- Files: `app/api/library_routes.py`
- Impact: Race conditions when running with multiple Uvicorn workers or Gunicorn; locks only prevent races within single process
- Fix approach: Use database-level locks via Supabase (SELECT FOR UPDATE), Redis locking, or move to async mutex per project

**In-Memory Progress Tracking:**
- Issue: Generation progress stored in `_generation_progress` dict in `app/api/library_routes.py` (lines 44-61)
- Files: `app/api/library_routes.py`
- Impact: Progress lost on restart, not accessible across workers, no persistence
- Fix approach: Store in Supabase or Redis with TTL

**Fallback Pattern Fragility:**
- Issue: JobStorage and CostTracker fall back to in-memory storage when Supabase unavailable (job_storage.py, cost_tracker.py)
- Files: `app/services/job_storage.py`, `app/services/cost_tracker.py`
- Impact: No warning when fallback occurs, data lost on restart, inconsistent state between multiple services
- Fix approach: Add explicit monitoring/alerting, implement retry logic with exponential backoff, ensure Supabase connection is established at startup (fail fast)

**Manual Supabase Client Initialization:**
- Issue: Supabase clients initialized in multiple routes and services with copy-paste code (get_supabase() in library_routes.py, segments_routes.py)
- Files: `app/api/library_routes.py` (lines 66-80), `app/api/segments_routes.py` (similar pattern)
- Impact: Inconsistent initialization, duplicate connection handling logic, versioning mismatches
- Fix approach: Create single `app/services/supabase_client.py` with shared initialization

---

## Known Bugs

**Supabase Error on Missing JWT Secret:**
- Symptoms: `verify_jwt_token()` in `app/api/auth.py` (line 43-48) returns 500 error if JWT_SECRET not configured instead of failing gracefully
- Files: `app/api/auth.py` (lines 43-48)
- Trigger: Running with `auth_disabled=False` but no `SUPABASE_JWT_SECRET` in env
- Workaround: Always set `auth_disabled=True` for development or configure JWT_SECRET

**Cost Tracker Bare Except:**
- Symptoms: `_load_log()` in `app/services/cost_tracker.py` (line 72) catches all exceptions silently including JSON decode errors
- Files: `app/services/cost_tracker.py` (line 72)
- Trigger: Corrupted cost_log.json file
- Workaround: Manually delete cost_log.json to reset

**Demucs Vocal Removal Hanging:**
- Symptoms: `vocal_remover.py` subprocess calls can hang indefinitely if Demucs model downloads or gets stuck
- Files: `app/services/vocal_remover.py` (lines 87-91)
- Trigger: First run with new Demucs model, network issues during download
- Workaround: Set subprocess timeout or pre-download models

---

## Security Considerations

**JWT Token Verification Missing Expiry Check:**
- Risk: If token validation skipped, expired tokens accepted
- Files: `app/api/auth.py` (line 50-57)
- Current mitigation: PyJWT checks expiry, but `auth_disabled` flag bypasses all auth
- Recommendations: Never ship with `auth_disabled=True` in production; implement token refresh logic; add token blacklist for logout

**Development Mode Auth Bypass:**
- Risk: `auth_disabled` flag in config allows unauthenticated access to all endpoints
- Files: `app/config.py` (line 52), `app/api/auth.py` (lines 102-108)
- Current mitigation: Warning log message
- Recommendations: Enforce auth_disabled=False in production via environment validation; restrict to localhost only; add rate limiting

**File Path Traversal in File Serving:**
- Risk: `/library/files/{file_path:path}` endpoint sanitizes paths but uses resolve() which is not bulletproof
- Files: `app/api/library_routes.py` (lines 139-179)
- Current mitigation: Checks against allowed directories
- Recommendations: Use pathlib.Path validation more strictly; reject paths with `..` explicitly; validate file ownership

**API Key Exposure:**
- Risk: ElevenLabs and Gemini keys passed in environment variables, cost tracker logs operation details
- Files: `app/services/elevenlabs_tts.py`, `app/services/gemini_analyzer.py`, `app/services/cost_tracker.py` (lines 119-121)
- Current mitigation: Keys not logged directly
- Recommendations: Add secret masking to logs; use Key Management Service (KMS); rotate keys regularly; never log full API responses

**Subprocess Command Injection Risk:**
- Risk: FFmpeg/Demucs commands built with string concatenation, though no shell=True used
- Files: `app/services/video_processor.py`, `app/services/vocal_remover.py`, `app/services/voice_detector.py`
- Current mitigation: subprocess.run without shell=True prevents injection
- Recommendations: Validate all file paths before passing to subprocess; use pathlib for path operations; consider sandboxing FFmpeg

---

## Performance Bottlenecks

**Large File Operations Without Streaming:**
- Problem: Video uploads/downloads handled in memory or with large buffer reads
- Files: `app/services/postiz_service.py` (line 149-150: open entire file into memory), `app/api/library_routes.py` (line 179: FileResponse should handle streaming)
- Cause: FileResponse is streaming but upload_video reads entire file
- Improvement path: Use chunked uploads for large files, implement progress callbacks, add multipart upload support

**Gemini API Batch Processing Inefficient:**
- Problem: Frames sent to Gemini in batches of 30, causing many API calls for long videos
- Files: `app/services/gemini_analyzer.py` (lines 46, max_frames_per_batch=30)
- Cause: API limits and design choice
- Improvement path: Increase batch size if API allows; implement frame deduplication; cache similar frames

**Video Processing Single-Threaded:**
- Problem: `VideoProcessorService` processes videos sequentially despite heavy I/O
- Files: `app/services/video_processor.py`
- Cause: OpenCV operations are CPU-bound but I/O to disk/network not parallelized
- Improvement path: Use asyncio for I/O-bound operations, multiprocessing for frame extraction, queue-based job system

**Cost Tracker JSON I/O on Every Log:**
- Problem: Cost log written to disk synchronously on every API call
- Files: `app/services/cost_tracker.py` (line 77, _save_log on every entry)
- Cause: Immediate persistence, no batching
- Improvement path: Batch writes, use async file operations, or defer to periodic flush

**Frontend Component Re-renders:**
- Problem: Library page uses inline functions in map() causing component re-creation on every render
- Files: `frontend/src/app/librarie/page.tsx` (large component with useState and useCallback)
- Cause: No memoization, inline event handlers, missing keys in lists
- Improvement path: Split into smaller components, use React.memo(), extract event handlers outside render

---

## Fragile Areas

**Video Processing Pipeline:**
- Files: `app/services/video_processor.py` (2039 lines), `app/api/routes.py`, `app/api/library_routes.py`
- Why fragile: Complex state machine with multiple services (TTS, voice detection, silence removal, Gemini), many fallback paths, error recovery undefined
- Safe modification: Add comprehensive logging at each step; create test fixtures for different video formats; document expected outputs at each stage
- Test coverage: Minimal integration tests, no end-to-end test for full pipeline

**Library Routes Monolith:**
- Files: `app/api/library_routes.py` (2299 lines)
- Why fragile: Single file handles projects, clips, exports, rendering, deletion, publishing; intertwined concerns
- Safe modification: Extract concerns into separate files (project_routes.py, clip_routes.py, export_routes.py); create service layer; add validation models
- Test coverage: No unit tests found

**Database Schema Synchronization:**
- Files: `app/services/job_storage.py`, `app/services/cost_tracker.py`, Supabase schema
- Why fragile: Schema defined in Supabase UI, no migrations, schema drift not detected
- Safe modification: Use Supabase migrations, document all tables in README, validate schema at startup
- Test coverage: Untested

**Authentication Dependency Injection:**
- Files: `app/api/auth.py` (Depends(security)), many routes using Depends(get_current_user)
- Why fragile: auth_disabled flag globally disables auth; optional user dependency not enforced at route level
- Safe modification: Remove auth_disabled flag in production; create protected/unprotected route groups; add type hints for optional vs required auth
- Test coverage: No unit tests for auth logic

---

## Scaling Limits

**In-Memory State (Project Locks, Progress):**
- Current capacity: Single process, ~100 concurrent projects
- Limit: Breaks when scaling to multiple workers
- Scaling path: Move locks/progress to Supabase or Redis

**Supabase Fallback Memory Store:**
- Current capacity: JobStorage._memory_store holds all jobs in RAM
- Limit: OOM after ~10,000 jobs (rough estimate)
- Scaling path: Implement job cleanup (cleanup_old_jobs exists but not triggered), use pagination, archive old jobs

**FFmpeg Parallel Processing:**
- Current capacity: Single-threaded, 1 video at a time
- Limit: Bottleneck on compute-heavy operations (vocal removal, silence detection)
- Scaling path: Implement job queue (Celery configured but not used), add worker pool, use container orchestration

**API Cost Tracking:**
- Current capacity: JSON file writes on every operation
- Limit: Disk I/O bottleneck at ~100 requests/sec
- Scaling path: Use Supabase exclusively, batch writes, async logging

**Frontend File Download:**
- Current capacity: Single file served via FileResponse
- Limit: Large videos (>500MB) may timeout or exhaust memory
- Scaling path: Implement resumable downloads, chunked transfer encoding, CDN caching

---

## Dependencies at Risk

**OpenAI Whisper (Large Model Download):**
- Risk: ~1.5GB model auto-downloaded on first use, network failure blocks execution
- Impact: First run takes 10+ minutes, no retry logic
- Migration plan: Pre-download models to Docker image, use smaller `base` model by default, cache in shared volume

**PyTorch/Silero VAD (GPU Optional):**
- Risk: Large dependency (2GB+), optional but imported unconditionally
- Impact: Increases Docker image size, memory footprint on CPU-only systems
- Migration plan: Make conditional import, lazy loading, separate GPU container

**Google Genai SDK Versioning:**
- Risk: `google-genai>=0.2.0` allows major version changes with breaking changes
- Impact: API changes not caught until runtime
- Migration plan: Pin to exact version (e.g., `google-genai==0.3.0`), test upgrades in CI before merging

**Supabase Client Versioning:**
- Risk: `supabase>=2.0.0` similar version constraint, breaking changes possible
- Impact: Connection failures, schema mismatches
- Migration plan: Pin to exact version, maintain compatibility layer for schema changes

**FFmpeg Binary:**
- Risk: Local FFmpeg at `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` may not exist
- Impact: Video processing fails with unclear error
- Migration plan: Make system FFmpeg fallback primary, bundle as Docker layer, validate at startup

---

## Missing Critical Features

**No API Rate Limiting:**
- Problem: Cost tracking exists but no rate limits on expensive operations (Gemini, ElevenLabs)
- Blocks: Can run out of API budget without notice
- Fix: Implement token bucket or sliding window rate limiter per user/endpoint

**No Request Validation:**
- Problem: Pydantic models defined but not used consistently
- Blocks: Invalid inputs reach business logic without validation
- Fix: Add request body validation, file size checks, duration limits

**No Graceful Error Recovery:**
- Problem: On video processing failure, state left inconsistent
- Blocks: Manual cleanup required, retries not possible
- Fix: Implement state machine with defined transitions, automatic retry with backoff

**No Audit Logging:**
- Problem: No record of who published what, when deletions occurred
- Blocks: Cannot investigate data loss or track user actions
- Fix: Add audit table, log all mutations, implement retention policy

**No Background Job Monitoring:**
- Problem: Celery configured but not used, jobs stored in Supabase with manual polling
- Blocks: No visibility into job progress, no recovery mechanism
- Fix: Implement WebSocket progress updates, use job queue with monitoring dashboard

---

## Test Coverage Gaps

**Backend Unit Tests Missing:**
- What's not tested: Cost tracker, job storage, video processor scoring algorithm, Gemini analyzer frame extraction
- Files: `app/services/*.py` (no test files found)
- Risk: Business logic changes break without notice
- Priority: High

**API Integration Tests Missing:**
- What's not tested: Project creation → clip upload → export workflow, error cases
- Files: `app/api/*.py`
- Risk: E2E failures caught by users, not CI
- Priority: High

**Auth Flow Tests Missing:**
- What's not tested: JWT verification, expired tokens, missing JWT_SECRET, auth_disabled behavior
- Files: `app/api/auth.py`
- Risk: Auth bypass or lockout in production
- Priority: Critical

**Database Schema Tests Missing:**
- What's not tested: Supabase table structure, migrations, cascading deletes
- Files: None (schema only in Supabase UI)
- Risk: Data integrity issues, orphaned records
- Priority: High

**Frontend Component Tests Incomplete:**
- What's not tested: Most component logic (only E2E/Playwright tests exist)
- Files: `frontend/src/app/librarie/page.tsx` and others have no unit tests
- Risk: UI bugs, state management issues not caught
- Priority: Medium

**Video Processing Edge Cases:**
- What's not tested: Corrupt videos, non-standard formats, very long/short videos, silent videos, videos without audio
- Files: `app/services/video_processor.py`, `app/services/voice_detector.py`
- Risk: Silent failures, incomplete processing
- Priority: Medium

---

*Concerns audit: 2026-02-03*
