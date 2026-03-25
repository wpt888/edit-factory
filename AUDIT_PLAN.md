# Edit Factory - Pipeline Audit & Remediation Plan

**Date:** 2026-03-26
**Scope:** Full pipeline audit (upload → processing → TTS → render → publish)
**Agents used:** 10 parallel code-explorer agents
**Total issues found:** ~200+ unique issues

---

## PHASE 0: EMERGENCY FIXES (Do Immediately)

### P0-1: Credentiale live commise in repo
- **File:** `frontend/.env.local` - contine JWT anon key real si URL Supabase
- **Fix:** Add `frontend/.env.local` to `.gitignore`, remove from git history, rotate the exposed key
- **Severity:** CRITICAL / Security

### P0-2: Auth bypass in production cu DESKTOP_MODE
- **File:** `app/main.py:231-232`
- **Bug:** `AUTH_DISABLED=true` + `DESKTOP_MODE=true` + `DEBUG=false` bypasses auth on non-localhost
- **Fix:** Guard should reject `AUTH_DISABLED=true` in non-debug mode regardless of `desktop_mode`

### P0-3: CORS middleware ordering - 429 responses missing CORS headers
- **File:** `app/main.py:307-321`
- **Bug:** Starlette reverses middleware insertion order; CORS added before SlowAPI means SlowAPI is outermost
- **Fix:** Swap CORS and SlowAPI middleware registration order (CORS must be added AFTER SlowAPI)

### P0-4: Segment file endpoint has no authentication
- **File:** `app/api/segments_routes.py:2309-2371`
- **Bug:** `GET /files/{file_path:path}` has no `Depends(get_profile_context)`
- **Fix:** Add auth dependency

### P0-5: Segment ownership not validated on project assignment
- **File:** `app/api/segments_routes.py:2236-2242`
- **Bug:** Any user can assign other users' segments to their project
- **Fix:** Batch ownership check against `editai_segments` filtered by `profile_id`

---

## PHASE 1: DATA INTEGRITY & STUCK STATES (High Priority)

### P1-1: Projects stuck in "generating" when DB unavailable
- **Files:** `library_routes.py:904-909`, `library_routes.py:1336-1349`, `library_routes.py:2711-2716`
- **Bug:** Background tasks return early without updating project/clip status when Supabase is down
- **Fix:** Implement local status update fallback; ensure `finally` blocks always attempt status recovery
- **Affects:** All 3 background task types (raw clips, segments, render)

### P1-2: `_generate_raw_clips_task` ignores cancellation
- **File:** `library_routes.py:875-1055`
- **Bug:** No `is_project_cancelled()` checks; cancelled projects get overwritten to "ready_for_triage"
- **Fix:** Add cancellation checks inside the variant generation loop (same pattern as `_generate_from_segments_task`)

### P1-3: Render succeeds but file deleted on Supabase update failure
- **File:** `library_routes.py:3078-3088, 3135-3140`
- **Bug:** If DB update after successful render raises, `render_succeeded` stays False, finally block deletes output
- **Fix:** Set `render_succeeded = True` before DB update; separate file cleanup from DB error handling

### P1-4: Startup recovery marks ALL processing jobs/clips as failed (no age threshold)
- **Files:** `main.py:85-151`, `main.py:247-262`
- **Bug:** `_recover_stuck_projects_sync` and `_recover_stuck_clips_sync` have no `updated_at` cutoff
- **Fix:** Add 10-minute age threshold (same pattern as `cleanup_stale_jobs`)

### P1-5: `update_job` TOCTOU race - concurrent updates overwrite each other
- **File:** `job_storage.py:179-202`
- **Bug:** When job not in memory, two concurrent callers both fetch from Supabase and last-write-wins
- **Fix:** Hold lock for entire fetch-modify-write cycle, not just the memory read

### P1-6: Concurrent renders write to same output file
- **File:** `library_routes.py:2614-2633`
- **Bug:** Lock released immediately after DB status update; two renders can run for same project
- **Fix:** Hold lock for full render duration OR add clip-level lock/status check preventing duplicate renders

### P1-7: Double-sanitization of cached SRT doubles-escapes backslashes
- **File:** `library_routes.py:3006-3018`
- **Bug:** `sanitize_srt_full()` runs twice on cached content (once at generation, once at retrieval)
- **Fix:** Skip sanitization when loading from cache, or mark cached content as already sanitized

### P1-8: `_get_video_duration` returns 0.0 silently on failure
- **File:** `library_routes.py:3271-3285`
- **Bug:** Returns 0.0 with no log; causes wrong video sync decisions (always tries to extend)
- **Fix:** Log warning and raise a descriptive error or return None to trigger distinct error path

### P1-9: Return value of `_trim_video_to_duration` ignored
- **File:** `library_routes.py:2954-2956`
- **Bug:** FFmpeg failure returns False but render proceeds with non-existent file
- **Fix:** Check return value and handle failure before proceeding

### P1-10: `CANCELLED` missing from `JobStatus` enum
- **File:** `models.py:10-14`
- **Bug:** `hasattr(JobStatus, 'CANCELLED')` always False; cancelled jobs stored as bare string
- **Fix:** Add `CANCELLED = "cancelled"` to enum

---

## PHASE 2: TTS & AUDIO PIPELINE FIXES

### P2-1: `generate_audio_with_timestamps` missing character limit check
- **File:** `app/services/tts/elevenlabs.py:358-510`
- **Bug:** Primary render TTS path has no `ELEVENLABS_MAX_CHARS` guard
- **Fix:** Add `if len(text) > ELEVENLABS_MAX_CHARS: raise ValueError(...)` at method start

### P2-2: TTS cache never hits due to key mismatch
- **File:** `app/services/tts/elevenlabs.py:403-407`
- **Bug:** Cache key uses `"provider": "elevenlabs_ts"` but lookup uses `provider_dir="elevenlabs"`
- **Fix:** Align cache key provider name with provider_dir

### P2-3: Inconsistent cost rates ($0.22 vs $0.24 per 1000 chars)
- **Files:** `cost_tracker.py:17`, `tts/elevenlabs.py:120`, `tts_routes.py:82`, `routes.py:136`
- **Fix:** Define single `ELEVENLABS_COST_PER_1K_CHARS` constant; use everywhere

### P2-4: Edge TTS fallback uses hardcoded voice, ignores user selection
- **File:** `library_routes.py:2879-2883`
- **Fix:** Pass `content_data["tts_voice_id"]` or mapped equivalent to Edge TTS

### P2-5: `PUT /clips/{id}/content` stores unvalidated TTS text length
- **File:** `library_routes.py:2421-2448`
- **Fix:** Call `validate_tts_text_length()` before storing

### P2-6: Raw datetime objects in TTS job (not `.isoformat()`)
- **File:** `routes.py:897, 922, 1155, 1188`
- **Fix:** Use `.isoformat()` consistently in all `updated_at` assignments

### P2-7: `asyncio.Lock` created in wrong event loop context
- **File:** `edge_tts_service.py:97-101`
- **Fix:** Create async lock lazily on first use within the running event loop

---

## PHASE 3: VIDEO PROCESSING & SCORING FIXES

### P3-1: `_gemini_to_video_segments` references non-existent `self.fps`
- **File:** `video_processor.py:1401-1414`
- **Bug:** `hasattr(self, 'fps')` always False on `VideoProcessorService`; visual hashes always None
- **Fix:** Open a `VideoAnalyzer` inside the method to compute frame hashes

### P3-2: `process_video_smart` loses hashes/blur/contrast on dict roundtrip
- **File:** `video_processor.py:1494-1504`
- **Bug:** `to_dict()` excludes key fields; reconstruction hardcodes defaults; disables all dedup
- **Fix:** Include all scoring fields in `to_dict()` and reconstruction

### P3-3: `cleanup_temp("*")` deletes files from concurrent jobs
- **File:** `video_processor.py:1299-1302`
- **Bug:** Shared `temp_dir` per profile; wildcard delete affects other in-progress jobs
- **Fix:** Use job-specific temp subdirectories

### P3-4: `_select_variant_segments` drops low-motion Gemini segments
- **File:** `video_processor.py:1722-1724`
- **Bug:** Motion floor of 0.015 silently rejects calm scenes Gemini selected
- **Fix:** Skip motion threshold when segments come from Gemini analysis

### P3-5: Variance score permanently near-zero due to /255.0 normalization
- **File:** `video_processor.py:396-408`
- **Fix:** Use appropriate normalization constant (e.g., /80.0 to match motion) or recalibrate

### P3-6: `add_audio` lossy double-encode (should use `-c:v copy`)
- **File:** `video_processor.py:1067-1101`
- **Fix:** Use `-c:v copy` when only adding audio track; skip re-encode

### P3-7: CLAUDE.md scoring formula outdated (3-term vs actual 5-term)
- **File:** `CLAUDE.md:169`
- **Fix:** Update documentation to reflect actual 5-term formula

---

## PHASE 4: RENDERING PIPELINE FIXES

### P4-1: `_use_gpu` / `encoding_params` potential UnboundLocalError
- **File:** `library_routes.py:3878, 3913, 4054`
- **Fix:** Initialize `_use_gpu = False` and `encoding_params = []` at function scope

### P4-2: Inconsistent `platform_map` dicts in `_render_with_preset`
- **File:** `library_routes.py:3829-3843 vs 3887-3893`
- **Fix:** Extract single `PLATFORM_MAP` constant; use in both places

### P4-3: SRT validator never called during render
- **File:** `library_routes.py:2987-3023`
- **Fix:** Call `validate_and_fix()` before writing SRT to disk for FFmpeg

### P4-4: Bulk render skips `is_project_locked` check
- **File:** `library_routes.py:3200-3239`
- **Fix:** Add same lock check as single-clip render endpoint

### P4-5: `measure_loudness` spawns FFmpeg outside semaphore
- **File:** `library_routes.py:3851`
- **Fix:** Wrap in `acquire_prep_slot()` or account for it in semaphore budget

### P4-6: `cleanup_orphaned_temp_files` never scheduled
- **File:** `library_routes.py:3609-3662`
- **Fix:** Add to startup lifespan or periodic background task

### P4-7: Progress not tracked during individual clip renders
- **File:** `library_routes.py:2672-3145`
- **Fix:** Call `update_generation_progress()` at key render milestones

---

## PHASE 5: DATABASE & CONSISTENCY FIXES

### P5-1: Export presets endpoint leaks all presets to all users
- **File:** `library_routes.py:2529`
- **Fix:** Use `repo.list_export_presets(profile_id)` instead of raw query

### P5-2: `editai_clip_content` queries lack profile_id protection
- **File:** `library_routes.py:2408, 2452, 2503`
- **Fix:** Add join verification against `editai_clips` to confirm ownership

### P5-3: Bulk select fires N individual DB round trips
- **File:** `library_routes.py:2113-2123`
- **Fix:** Single `IN` query + single `UPDATE ... IN (...)`

### P5-4: Project deletion not atomic - partial failure orphans records
- **File:** `library_routes.py:731-771`
- **Fix:** Reverse deletion order (project last) or use Supabase RPC for atomic cascade

### P5-5: `list_jobs` returns raw JSONB `data` without status normalization
- **File:** `job_storage.py:252`
- **Fix:** Apply same merge logic as `get_job` (merge top-level `status`, `id`, `progress`)

### P5-6: `count=True` (boolean) passed where `count="exact"` (string) expected
- **File:** `library_routes.py:575`, `repositories/models.py:66`
- **Fix:** Pass `count="exact"` and type the field as `Optional[Literal["exact", "planned", "estimated"]]`

### P5-7: Postiz bulk publish never writes publication records
- **File:** `postiz_routes.py:863-941`
- **Fix:** Add DB record creation for each successfully published clip

### P5-8: `postiz_status = "sent"` set on upload, not on actual publish
- **File:** `postiz_routes.py:279-285`
- **Fix:** Use `"uploaded"` for upload step, `"sent"` only after actual publish

---

## PHASE 6: CONCURRENCY & THREAD SAFETY

### P6-1: Blocking sync calls on event loop thread
- **Files:** `library_routes.py:2254` (`_delete_clip_files`), `library_routes.py:1854` (`_sync_orphan_clips`), `library_routes.py:3255` (`_get_video_info`)
- **Fix:** Wrap all sync file I/O and FFmpeg calls in `asyncio.to_thread()`

### P6-2: `_project_locks` grows unbounded; cleanup threshold too aggressive
- **File:** `library_routes.py:139`
- **Fix:** Increase threshold; add periodic cleanup outside hot path

### P6-3: `VideoAnalyzer.close()` doesn't acquire `_cap_lock`
- **File:** `video_processor.py:622-626`
- **Fix:** Acquire lock before `cap.release()`

### P6-4: `tts_cache.cache_store` not thread-safe for concurrent writes
- **File:** `tts_cache.py:128-149`
- **Fix:** Use atomic write pattern (write to temp + rename)

### P6-5: `_extend_video_with_segments` spawns multiple FFmpeg without semaphore
- **File:** `library_routes.py:3438-3606`
- **Fix:** Account for multiple subprocess spawns within single prep slot

---

## PHASE 7: FRONTEND-BACKEND CONTRACT

### P7-1: "Delete Clip" UI says "permanently delete" but is soft-delete
- **File:** `frontend/src/app/librarie/page.tsx:553`
- **Fix:** Change confirmation text to "Move to Trash" or call permanent delete endpoint

### P7-2: No 401 redirect on segments/usage pages
- **Files:** `segments/page.tsx`, `usage/page.tsx`
- **Fix:** Add `if (error instanceof ApiError && error.status === 401) router.push('/login')` pattern

### P7-3: `has_audio` state never confirmed by backend
- **File:** `librarie/page.tsx:534`
- **Fix:** Clear `tts_audio_path` in `editai_clip_content` when removing audio

### P7-4: No concurrent fetch guard on profile switch
- **File:** `librarie/page.tsx:396-407`
- **Fix:** Add abort controller or loading guard to prevent double-fetch

### P7-5: CORS locked to hardcoded origins
- **File:** `app/config.py:84`
- **Fix:** Document `ALLOWED_ORIGINS` env var in `.env.example`; remove production URL from default

---

## PHASE 8: CONFIGURATION & STARTUP

### P8-1: Silent `.env` load failure
- **File:** `app/config.py:123-150`
- **Fix:** Raise error (not just warning) if `.env` file exists but DotEnvSettingsSource import fails

### P8-2: Missing JWT secret is log-only, not startup failure
- **File:** `app/main.py:233-234`
- **Fix:** Raise `RuntimeError` when `auth_disabled=False` and `supabase_jwt_secret` is empty

### P8-3: Double uvicorn logging (missing `propagate=False`)
- **File:** `app/logging_config.py:31-34`
- **Fix:** Add `uv_logger.propagate = False` after setting handlers

### P8-4: `run.py` hardcodes "v1.0.0" instead of using `get_version()`
- **File:** `run.py:14`
- **Fix:** Import and use `APP_VERSION` from config

### P8-5: `start-dev.bat` ready-check loops never break early
- **File:** `start-dev.bat:189-219`
- **Fix:** Add `goto` after setting `READY=1`

### P8-6: `start-dev.sh` venv name `venv_linux` contradicts CLAUDE.md docs
- **File:** `start-dev.sh:21`, `CLAUDE.md`
- **Fix:** Align naming - either update script or docs

### P8-7: Hardcoded operational constants need env var overrides
- **Targets:** `MAX_CONCURRENT_RENDERS`, `MAX_CONCURRENT_PREP`, `SEMAPHORE_ACQUIRE_TIMEOUT`, `MIN_FREE_DISK_BYTES`, trash expiry, stale job age, thread pool size
- **Fix:** Add corresponding fields to `Settings` class

---

## PHASE 9: ERROR HANDLING HARDENING

### P9-1: Background task exceptions logged without stack traces
- **Files:** `library_routes.py:1033, 1719, 3108`
- **Fix:** Add `exc_info=True` to all `logger.error()` in background task except blocks

### P9-2: Audio/SRT file saves have no try/except (orphans video file on failure)
- **File:** `routes.py:448-460`
- **Fix:** Wrap all file saves in try/finally with cleanup of previously saved files

### P9-3: `_get_video_info` returns hardcoded 0 duration causing zero-length clips
- **File:** `library_routes.py:3265-3268`
- **Fix:** Raise error or return None; handle upstream

### P9-4: Postiz service has zero retry logic
- **File:** `postiz_service.py`
- **Fix:** Add `@retry` with exponential backoff for transient HTTP errors

### P9-5: `BaseException` subtypes bypass project status update
- **File:** `library_routes.py:923-1055`
- **Fix:** Move `status = "failed"` update to `finally` block, not just `except Exception`

### P9-6: File saves orphan partial files on disk-full errors
- **File:** `routes.py:448-460`, `library_routes.py:2831`
- **Fix:** Use `try/finally` cleanup for all temp file writes

---

## Implementation Priority Matrix

```
EMERGENCY (Phase 0):  5 items  - Do TODAY
HIGH (Phases 1-2):   17 items  - This week
MEDIUM (Phases 3-5): 21 items  - Next 2 weeks
LOWER (Phases 6-9):  30 items  - Next month
```

## Execution Notes

1. **Phase 0** items are security-critical and should be fixed before any other work
2. **Phase 1** items cause user-visible data loss or stuck states in production
3. Each phase is independently deployable
4. Test after each phase - run Playwright tests + manual pipeline walkthrough
5. The most impactful single fix is P1-6 (concurrent render protection) which can corrupt output files
6. The TTS cache fix (P2-2) will immediately reduce API costs by enabling cache hits
