# Codebase Concerns

**Analysis Date:** 2026-02-12

## Tech Debt

### 1. Broad Exception Handlers with Silent Failures

**Issue:** Multiple catch-all `except Exception:` blocks swallow errors with `pass` statements, making debugging difficult.

**Files:**
- `app/api/library_routes.py` (lines 187, 320, 2135-2136, 2172-2173)
- `app/api/routes.py` (lines 220-221, 231-232, 1349-1350)

**Impact:** Failures in file path resolution, rendering operations, and background tasks silently fail without logging. Users see no feedback; servers experience silent data loss.

**Fix approach:** Log all exceptions with context (file path, operation type, user/profile ID). Replace `pass` with at least `logger.warning()`. For critical operations, convert to explicit error responses instead of silent failures.

---

### 2. In-Memory Progress Tracking Lost on Server Restart

**Issue:** `_generation_progress` dictionary in `app/api/library_routes.py` (lines 50-67) is ephemeral—server restart clears all progress state.

**Files:** `app/api/library_routes.py` (lines 50-67, 52-58, 311)

**Impact:**
- Long-running jobs (multi-variant generation) show "Unknown progress" after restart
- Users cannot resume interrupted operations
- Progress tracking is unreliable for frontend real-time updates

**Fix approach:** Move progress tracking to Supabase `jobs` table or Redis with TTL. Only in-memory fallback if database unavailable. Implement progress persistence for recovery.

---

### 3. Unbounded Dictionary Growth - Project Locks

**Issue:** `_project_locks` dictionary in `app/api/library_routes.py` (lines 33-47) grows indefinitely; locks are created but never cleaned up systematically.

**Files:** `app/api/library_routes.py` (lines 33-47)

**Impact:**
- Memory leak over time as projects accumulate
- Lock cleanup only happens via explicit call to `cleanup_project_lock()`, not automatically
- No automatic cleanup after rendering completes

**Fix approach:** Implement automatic lock cleanup via context manager or decorator pattern. Add cleanup trigger after each render task completes. Consider weak references or expiring locks after configurable timeout (e.g., 24 hours).

---

### 4. Multiple Global Supabase Client Instances

**Issue:** Every API module (`auth.py`, `library_routes.py`, `assembly_routes.py`, `pipeline_routes.py`, etc.) instantiates its own `_supabase_client` singleton.

**Files:**
- `app/api/auth.py` (line 190-203)
- `app/api/library_routes.py` (line 70-86)
- `app/api/assembly_routes.py`
- `app/api/pipeline_routes.py`
- `app/api/profile_routes.py`
- `app/api/script_routes.py`
- `app/api/segments_routes.py`
- `app/services/assembly_service.py`

**Impact:**
- Code duplication and maintenance burden
- Each module silently falls back to memory on connection failure
- Connection pooling not optimized
- Inconsistent error handling across modules

**Fix approach:** Centralize Supabase client in single service module (`app/services/supabase_client.py`). All modules import from single point. Implement connection retry with exponential backoff.

---

### 5. No Timeout on Large File Operations

**Issue:** File downloads, video rendering, and FFmpeg encoding have no explicit timeout constraints.

**Files:**
- `app/api/library_routes.py` (download endpoint)
- `app/services/video_processor.py` (FFmpeg encoding)

**Impact:**
- Large video files (>500MB) can hang indefinitely
- No resource cleanup on timeout
- Connection threads leak
- Frontend polling becomes unreliable

**Fix approach:** Add `timeout` parameter to subprocess calls (FFmpeg). Implement request-level timeout for file downloads (e.g., 30min max). Add cleanup logic to kill orphaned processes.

---

## Known Bugs

### 1. File Path Traversal Vulnerability - Incomplete Validation

**Symptoms:** Path validation in `app/api/library_routes.py` (lines 166-199) uses exception-based control flow, making it fragile.

**Files:** `app/api/library_routes.py` (lines 166-199)

**Trigger:**
```
GET /api/v1/library/download?file_path=../../../etc/passwd
```
The validation checks if path resolves within allowed directories, but exception handling is implicit.

**Workaround:** Currently works due to stringent checks, but refactoring at risk. Use `pathlib.Path.relative_to()` explicitly instead of try-except pattern.

---

### 2. Backend Progress Polls Return Stale Data After Crashes

**Symptoms:** After backend crash/restart, polling `/api/v1/jobs/{job_id}` returns "Queued" indefinitely even though job was completed before restart.

**Files:**
- `app/api/library_routes.py` (progress tracking)
- `app/api/routes.py` (job status endpoints)

**Trigger:**
1. Start video rendering (job created)
2. Backend crashes mid-render
3. Resume app
4. Poll job status → gets stale in-memory state or "not found"

**Workaround:** Force page refresh to re-fetch clips from database. Job data is in Supabase; only progress indicator is lost.

---

### 3. TTS Subtitle Generator Missing Fallback for Edge Cases

**Symptoms:** SRT file generation fails silently if timestamps are malformed or out-of-order.

**Files:** `app/services/tts_subtitle_generator.py`

**Trigger:** Non-standard audio timing or concurrent edits to timestamps

**Workaround:** Manually validate SRT file, regenerate subtitles via UI

---

## Security Considerations

### 1. Auth Disabled in Development Mode Too Permissive

**Risk:** `AUTH_DISABLED=true` accepts any profile_id without validation. Dev mode tries to pick random profile from DB (line 225-239 in `app/api/auth.py`), creating confusion in multi-tenant scenarios.

**Files:** `app/api/auth.py` (lines 110-240)

**Current mitigation:** Warning logs printed. Only intended for local development.

**Recommendations:**
- Add explicit startup warning if auth disabled
- Reject requests with explicit `X-Profile-Id` header in auth_disabled mode (force auto-selection)
- Never ship production config with `AUTH_DISABLED=true`

---

### 2. No Rate Limiting on Video Upload Endpoints

**Risk:** Attackers can spam `/api/v1/upload` with large files causing disk exhaustion and DoS.

**Files:** `app/api/routes.py` (upload endpoint)

**Current mitigation:** None. Relies on infrastructure-level limits (nginx/load balancer).

**Recommendations:**
- Implement per-user upload quota (e.g., 10GB/month)
- Add file size limit validation (e.g., max 5GB per video)
- Implement exponential backoff for repeated failures
- Monitor disk usage and fail gracefully when quota exceeded

---

### 3. JWT Secret Not Validated at Startup

**Risk:** If `SUPABASE_JWT_SECRET` is missing but routes require auth, error only surfaces at first auth request, not at startup.

**Files:** `app/api/auth.py` (line 51-56)

**Current mitigation:** Runtime error check in `verify_jwt_token()`

**Recommendations:**
- Add startup validation in `app/main.py` to check critical env vars before accepting requests
- Fail fast with clear error message

---

## Performance Bottlenecks

### 1. Unindexed Database Queries on Large Tables

**Issue:** Queries on `editai_projects` and `clips` tables may lack proper indexes if profile_id not indexed.

**Files:** `app/api/library_routes.py` (project/clip queries)

**Problem:**
- `SELECT * FROM clips WHERE profile_id = ?` without index scans full table
- With thousands of clips, response time degrades

**Improvement path:**
- Add index: `CREATE INDEX idx_clips_profile_id ON clips(profile_id)`
- Add index: `CREATE INDEX idx_projects_profile_id ON editai_projects(profile_id)`
- Verify via `EXPLAIN ANALYZE` in Supabase dashboard

---

### 2. Full Video Re-encoding on Preset Change

**Issue:** Changing encoding preset requires complete video re-render (5-15min per variant).

**Files:** `app/api/library_routes.py` (render flow)

**Problem:** No intermediate cache of raw unencoded video. All variants regenerated from source.

**Improvement path:**
- Store intermediate video format (ProRes/DNxHD) before final encode
- Cache FFmpeg filter graph output
- Support preset-agnostic rendering: output once, encode multiple times to different presets in parallel

---

### 3. Synchronous FFmpeg Encoding Blocks Job Handler

**Issue:** FFmpeg subprocess calls are synchronous, blocking FastAPI background task thread.

**Files:** `app/services/video_processor.py`

**Problem:**
- Only one video can encode at a time (single background task worker)
- Multi-variant requests serialize instead of parallel

**Improvement path:**
- Use `subprocess.Popen()` with async polling instead of blocking `subprocess.run()`
- Implement concurrent task pool for parallel encoding
- Monitor CPU/memory to throttle concurrent jobs

---

## Fragile Areas

### 1. Library Page Component - Monolithic 3000+ Line React Component

**Files:** `frontend/src/app/library/page.tsx` (3111 lines)

**Why fragile:**
- Single component manages: project list, upload UI, clip display, subtitle editor, rendering dialog, filter controls, export settings
- Local state scattered across dozens of `useState` hooks
- No component composition/separation
- Difficult to test individual features
- Refactoring any feature risks breaking others

**Safe modification:**
- Extract rendering dialog to separate component with own state
- Extract subtitle editor to custom hook
- Use React Context for shared state (active project, clips list)
- Add integration tests for critical workflows before refactoring

**Test coverage:** No unit tests for this page; only E2E Playwright tests

---

### 2. Video Processor Service - Complex Scoring Algorithm

**Files:** `app/services/video_processor.py` (2112 lines)

**Why fragile:**
- Scoring combines 5 metrics (motion, variance, blur, contrast, brightness) with hardcoded weights (40%, 20%, 20%, 15%, 5%)
- No validation that weights sum to 100%
- Changes to weights break existing project clips' relevance ordering
- Gemini AI integration is optional fallback, creating two code paths

**Safe modification:**
- Externalize weights to config/database (allow per-profile tuning)
- Add unit tests for scoring with known frame sequences
- Version the scoring algorithm (score_v1, score_v2) to track changes
- Add validation: `assert sum(weights) == 1.0`

**Test coverage:** No unit tests; relies on manual video upload testing

---

### 3. Profile Multi-Tenancy - Shared Global Services

**Files:**
- `app/services/cost_tracker.py`
- `app/services/job_storage.py`
- `app/services/video_processor.py`

**Why fragile:**
- Services are singletons but need profile-scoped behavior
- Cost tracking filters by profile_id in memory (inefficient, non-deterministic)
- Temporary directories scoped to profile but services still global
- No explicit test for profile isolation

**Safe modification:**
- Implement request-scoped services via FastAPI dependency injection
- Pass profile_id to all service methods (already done in some places, inconsistent)
- Add integration test: two profiles uploading simultaneously, verify costs/jobs isolated

**Test coverage:** No tests for multi-profile scenarios

---

## Scaling Limits

### 1. In-Memory Job Storage Unbounded

**Current capacity:** All jobs in `_job_storage._memory_store` live until process restart or deletion

**Limit:** With 1000+ daily jobs, memory growth = 1KB per job x 1000 = 1MB/day, but no cleanup mechanism

**Scaling path:**
- Migrate to Redis with TTL (keep last 30 days)
- Implement job archival: move old jobs to separate table
- Add automatic cleanup: `cleanup_old_jobs(days=7)` via scheduler

---

### 2. Video Rendering Queue Not Prioritized

**Current capacity:** Single FastAPI background task executor. Processing jobs enqueue synchronously.

**Limit:** With 5+ concurrent uploads on same server, later jobs timeout waiting

**Scaling path:**
- Use Redis Queue (RQ) or Celery for distributed task queue
- Implement job priority: expedited (0-5min), standard (10-30min), batch (60min+)
- Scale workers horizontally: multiple encoding servers

---

### 3. FFmpeg Resource Exhaustion

**Current capacity:** No limit on concurrent FFmpeg processes. Encoding uses 1-2 CPU cores, unbounded memory for large videos (>1GB).

**Limit:** 4 concurrent encodes on 4-core machine = 100% CPU, OOM risk

**Scaling path:**
- Implement resource quota: max 2 concurrent FFmpeg processes
- Monitor memory usage, fail gracefully if encoding would exceed 80% RAM
- Implement adaptive quality: reduce resolution/bitrate for large videos on low-memory systems

---

## Dependencies at Risk

### 1. ElevenLabs TTS API - Single Point of Failure

**Risk:** ElevenLabs outage blocks subtitle generation. Edge TTS fallback exists but produces lower quality.

**Files:** `app/services/elevenlabs_tts.py`, fallback in `app/services/edge_tts_service.py`

**Current mitigation:** Automatic fallback to Edge TTS (free Microsoft voices)

**Migration plan:**
- Already implemented dual-TTS architecture
- Config allows switching: `TTS_PROVIDER=elevenlabs|edge`
- Test failover: set `ELEVENLABS_API_KEY=""` to force Edge TTS

---

### 2. Gemini Vision API Dependency

**Risk:** Gemini API changes model availability or pricing. Currently uses `gemini-2.5-flash`.

**Files:** `app/services/gemini_analyzer.py`

**Current mitigation:** Graceful degradation—falls back to motion/variance scoring if Gemini unavailable

**Migration plan:**
- Monitor Gemini deprecation notices (typically 6-month notice)
- Already parameterized: `gemini_model` in config
- Test fallback: set `GEMINI_API_KEY=""` to verify non-AI workflow

---

### 3. Supabase Dependency - Schema Assumptions

**Risk:** Breaking schema changes (drop column, rename table) would require migration. No schema versioning.

**Files:** All files using Supabase queries

**Current mitigation:** Manual migration files in `supabase/migrations/`

**Migration plan:**
- Document schema contract in code comments
- Add migration validation: test script checks expected columns exist before connecting
- Version migrations with timestamp prefix (already done: `001_`, `002_`, etc.)

---

## Missing Critical Features

### 1. No User-Facing Error Messages

**Problem:** Backend returns 500 errors with generic `str(e)` messages. Frontend shows "Something went wrong" without actionable details.

**Impact:** Users cannot troubleshoot failures (e.g., "File too large" vs "Gemini API overloaded")

**Blocks:** User support, error recovery UX

---

### 2. No Job Cancellation Endpoint

**Problem:** Once rendering starts, no way to stop it. FFmpeg process runs to completion or timeout.

**Impact:** Users cannot cancel long-running operations; wastes compute resources

**Blocks:** User-initiated cleanup, cost control

---

### 3. No Batch Operations

**Problem:** Multi-variant rendering is sequential. Users cannot bulk-delete clips, bulk-export, or bulk-apply settings.

**Impact:** 10 clips x 2 minutes per delete = 20 minutes of clicking. No bulk UX.

**Blocks:** Production workflows

---

## Test Coverage Gaps

### 1. No Unit Tests for Video Processor Scoring

**What's not tested:**
- Scoring algorithm with known frame sequences
- Motion detection edge cases (static, fast motion, mixed)
- Variance calculation correctness
- Weight combination formula

**Files:** `app/services/video_processor.py`

**Risk:** Changes to scoring break clip relevance without detection. Manual testing insufficient for edge cases.

**Priority:** High - affects core recommendation algorithm

---

### 2. No Integration Tests for Multi-Profile Isolation

**What's not tested:**
- Two profiles uploading simultaneously
- Cost tracking per-profile correctness
- Clip list filtered by profile_id
- Job storage isolates profiles

**Files:** `app/api/library_routes.py`, `app/services/job_storage.py`, `app/services/cost_tracker.py`

**Risk:** Profile data leakage in multi-tenant scenarios. Silent cost calculation errors.

**Priority:** Critical - security-relevant

---

### 3. No Tests for Graceful Degradation

**What's not tested:**
- Gemini API disabled → falls back to motion/variance
- Supabase unavailable → in-memory storage works
- ElevenLabs unavailable → Edge TTS works
- Redis unavailable → system continues (if applicable)

**Files:** All service modules

**Risk:** Fallback code untested, may fail catastrophically when used

**Priority:** High - reliability-critical

---

### 4. No Playwright Tests for New Pipeline/Assembly Pages

**What's not tested:**
- Pipeline page renders correctly
- Assembly page handles video generation
- Script generation integrates with UI
- Multi-variant selection workflow

**Files:**
- `frontend/src/app/pipeline/page.tsx`
- `frontend/src/app/assembly/page.tsx`
- `frontend/tests/` (no tests for these pages)

**Risk:** New features untested, regressions undetected

**Priority:** Medium - but critical before shipping

---

## Recommendations Summary

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| Broad exception handlers | Medium | Low | High |
| Progress tracking loss on restart | High | Medium | High |
| Unbounded lock growth | Medium | Low | Medium |
| Multiple Supabase clients | Medium | Medium | Medium |
| No FFmpeg timeout | High | Low | High |
| File path validation fragile | High | Low | High |
| No rate limiting | High | Medium | High |
| Unindexed database queries | Medium | Low | Medium |
| 3000+ line library page | Medium | High | Medium |
| No job cancellation | Medium | Medium | Medium |
| No multi-profile tests | High | Medium | High |
| No graceful degradation tests | High | Medium | High |

---

*Concerns audit: 2026-02-12*
