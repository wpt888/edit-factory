# Full Backend Audit — 104 Bugs Found
## Date: 2026-02-26

---

# CRITICAL BUGS (11)

## CRIT-01: API keys ElevenLabs stored in plaintext
- **File**: `app/services/elevenlabs_account_manager.py:292-296`
- **Description**: Column named `api_key_encrypted` but stores raw API key: `"api_key_encrypted": api_key`. No encryption anywhere.
- **Impact**: DB breach exposes all customer API keys in cleartext.
- **Fix**: Implement Fernet symmetric encryption before storing, decrypt on read.

## CRIT-02: VideoCapture file handle leak on exception
- **File**: `app/services/video_processor.py:117-128`
- **Description**: `VideoAnalyzer.__init__` opens `cv2.VideoCapture` but no context manager. If analysis methods raise before `close()`, handle leaks. `analyze_video_with_gemini` (line 1162) calls `close()` outside `finally`.
- **Impact**: Accumulated open file handles → "too many open files" → server crash.
- **Fix**: Make VideoAnalyzer a context manager (`__enter__`/`__exit__`), use try/finally everywhere.

## CRIT-03: EdgeTTS sync methods deadlock in async context
- **File**: `app/services/edge_tts_service.py:102-108, 161-169`
- **Description**: `_sync` methods call `loop.run_until_complete()` inside running event loop → RuntimeError. Fallthrough to `asyncio.run()` also fails.
- **Impact**: Edge TTS fallback completely broken when called from async routes. ElevenLabs failure = no TTS at all.
- **Fix**: Use `asyncio.get_event_loop().create_task()` or always use `await` from async code paths.

## CRIT-04: CostTracker JSON file corruption
- **File**: `app/services/cost_tracker.py:65-76, 175-185`
- **Description**: `_log_lock` is threading.Lock but no file-level locking. Multiple workers do concurrent read-modify-write on `cost_log.json`.
- **Impact**: Corrupted JSON → all local cost tracking fails, historical data lost.
- **Fix**: Use `fcntl.flock` for file-level locking, or switch to append-only JSONL.

## CRIT-05: Postiz instance cache grows unbounded
- **File**: `app/services/postiz_service.py:316-374`
- **Description**: `_postiz_instances` dict caches per profile_id. Expired entries only removed on re-access. Many profiles = permanent memory growth.
- **Impact**: Slow memory leak holding httpx clients and credentials.
- **Fix**: Add LRU cache with maxsize or periodic cleanup.

## CRIT-06: Missing Supabase None checks across 4 files
- **Files**: `app/api/product_routes.py:44-52,97-105`, `app/api/catalog_routes.py:36-38,77-78,129-130,165-166`, `app/api/association_routes.py:109,165,213,259,310,359`, `app/api/product_generate_routes.py:129,194,505`
- **Description**: `get_supabase()` can return None. These endpoints call `supabase.table(...)` without None check → AttributeError.
- **Impact**: Every request to these ~15 endpoints returns raw 500 with Python traceback when DB is down.
- **Fix**: Add `if not supabase: raise HTTPException(503, "Database not available")`.

## CRIT-07: Blocking subprocess.run() in async handlers
- **Files**: `app/api/routes.py:241,306`, `app/api/segments_routes.py:129-204,343`, `app/api/library_routes.py:2387-2696`, `app/api/pipeline_routes.py:1421-1701`
- **Description**: `subprocess.run()` blocks the async event loop. Used in health_check, get_video_info, thumbnail generation, duration probing.
- **Impact**: Single slow ffprobe blocks entire server. Health check can hang 30s.
- **Fix**: Use `asyncio.to_thread(subprocess.run, ...)` or `asyncio.create_subprocess_exec()`.

## CRIT-08: asyncio.get_event_loop() deprecated
- **File**: `app/api/product_generate_routes.py:602,719`
- **Description**: Deprecated since Python 3.10, will error in future versions.
- **Impact**: Product video generation broken on Python 3.12+.
- **Fix**: Replace with `await asyncio.to_thread(...)`.

## CRIT-09: Race condition in set-default-profile (non-atomic)
- **File**: `app/api/profile_routes.py:406-416`
- **Description**: Two-step: unset all defaults → set new default. Crash between steps = zero defaults. Concurrent requests = multiple defaults.
- **Impact**: Broken profile selection, all requests fail with "no default profile".
- **Fix**: Reverse order (set new first, then unset old) or use DB stored procedure.

## CRIT-10: Race condition in pipeline library project creation
- **File**: `app/api/pipeline_routes.py:1386-1412`
- **Description**: In-memory lock only works single-process. TOCTOU race at DB level.
- **Impact**: Duplicate library projects, clips scattered.
- **Fix**: DB unique constraint on `(profile_id, name)` or upsert with on_conflict.

## CRIT-11: No error handling on clip inserts during generation
- **File**: `app/api/library_routes.py:713-724`
- **Description**: Clip insert has no try/except. One failure aborts entire loop, project stuck in "generating" forever.
- **Impact**: Project permanently stuck, requires manual DB fix.
- **Fix**: Wrap each insert in try/except, continue on failure.

---

# HIGH BUGS (26)

## HIGH-01: get_cost_tracker() singleton not thread-safe
- **File**: `app/services/cost_tracker.py:369-379`
- **Fix**: Add threading lock like get_job_storage().

## HIGH-02: get_script_generator() singleton not thread-safe
- **File**: `app/services/script_generator.py:346-365`
- **Fix**: Add threading lock.

## HIGH-03: get_assembly_service() singleton not thread-safe
- **File**: `app/services/assembly_service.py:1237-1244`
- **Fix**: Add threading lock.

## HIGH-04: ElevenLabs account manager singleton no thread-safety
- **File**: `app/services/elevenlabs_account_manager.py:20-26`
- **Fix**: Add threading lock.

## HIGH-05: _download_one returns None path for non-image content
- **File**: `app/services/image_fetcher.py:102`
- **Impact**: Product video composition crashes with FileNotFoundError.
- **Fix**: Filter None values from result dict.

## HIGH-06: Assembly temp directories never cleaned on success
- **File**: `app/services/assembly_service.py:828-1043`
- **Impact**: Disk space exhaustion. Each assembly = hundreds of MB temp files.
- **Fix**: Add `shutil.rmtree(temp_dir, ignore_errors=True)` in finally block.

## HIGH-07: Subtitle glow color parsing bug
- **File**: `app/services/subtitle_styler.py:78`
- **Description**: Non-standard outline colors (like "black") produce garbage ASS color strings.
- **Fix**: Validate &H prefix format before processing.

## HIGH-08: No timeout on subprocess.run — silence_remover
- **File**: `app/services/silence_remover.py:99,116,221,265,380`
- **Fix**: Add timeout=300.

## HIGH-09: No timeout on subprocess.run — voice_detector
- **File**: `app/services/voice_detector.py:99,116,333`
- **Fix**: Add timeout=120.

## HIGH-10: No timeout on subprocess.run — video_processor
- **File**: `app/services/video_processor.py:595`
- **Fix**: Add timeout=600.

## HIGH-11: TTS cache grows unbounded on disk
- **File**: `app/services/tts_cache.py`
- **Impact**: Disk exhaustion over weeks.
- **Fix**: Add max cache size with LRU eviction.

## HIGH-12: ElevenLabsTTS creates new instance every call
- **File**: `app/services/elevenlabs_tts.py:424-426`
- **Fix**: Cache singleton like other services.

## HIGH-13: _generation_progress dict grows unbounded
- **File**: `app/api/library_routes.py`
- **Fix**: Add eviction like _MAX_*_ENTRIES pattern.

## HIGH-14: _cancelled_projects set grows unbounded
- **File**: `app/api/library_routes.py`
- **Fix**: Clean entries after acknowledgment or time-based.

## HIGH-15: set_default_profile race condition (duplicate of CRIT-09 from DB audit perspective)
- **File**: `app/api/profile_routes.py:406-416`

## HIGH-16: download_result and delete_job lack authentication
- **File**: `app/api/routes.py:588-608, 1012-1031`
- **Impact**: Anyone who knows job_id can download videos or delete jobs.
- **Fix**: Add Depends(get_profile_context) and verify ownership.

## HIGH-17: list_jobs returns ALL jobs across all profiles
- **File**: `app/api/routes.py:571-585`
- **Impact**: Privacy violation — any user sees all jobs.
- **Fix**: Filter by profile_id.

## HIGH-18: Synchronous httpx.Client in async background task
- **File**: `app/api/feed_routes.py:74-81`
- **Impact**: Event loop blocked up to 60s during feed sync.
- **Fix**: Replace with httpx.AsyncClient.

## HIGH-19: File serving hardcodes media_type="video/mp4"
- **File**: `app/api/routes.py:1002,1008`
- **Impact**: Thumbnails, audio, SRT files served with wrong MIME type.
- **Fix**: Use mimetypes.guess_type().

## HIGH-20: .single() throws on empty result — many call sites
- **Files**: library_routes.py (17 locations), feed_routes.py, profile_routes.py, association_routes.py
- **Impact**: 500 instead of 404 when record not found.
- **Fix**: Use .maybe_single() or catch APIError specifically.

## HIGH-21: N+1 query in bulk-publish validation
- **File**: `app/api/postiz_routes.py:448-468`
- **Fix**: Use .in_("id", clip_ids) single query.

## HIGH-22: N+1 query in TTS library list_tts_assets
- **File**: `app/api/tts_library_routes.py:126-141`
- **Fix**: Use SQL join or limit+select.

## HIGH-23: cost_tracker.get_all_entries() no pagination
- **File**: `app/services/cost_tracker.py:283-302`
- **Fix**: Add default limit parameter.

## HIGH-24: Cost summary fetches ALL rows client-side
- **File**: `app/services/cost_tracker.py:198-250`
- **Fix**: Use Postgres aggregate SUM/GROUP BY.

## HIGH-25: auth_disabled has no production guard
- **File**: `app/config.py:59`, `app/api/auth.py:110-116`
- **Impact**: Full auth bypass if AUTH_DISABLED=true in production.
- **Fix**: Log CRITICAL warning or refuse to start when debug=False.

## HIGH-26: Supabase get_supabase() can return None in background task error handlers
- **File**: `app/api/library_routes.py:744-747`
- **Impact**: Projects stuck in "generating" after Supabase outage.

---

# MEDIUM BUGS (33)

## MED-01: Gemini multi-batch frame index confusion
- **File**: `app/services/gemini_analyzer.py:280-289`

## MED-02: ElevenLabs comment/code mismatch (128kbps vs 192kbps)
- **File**: `app/services/elevenlabs_tts.py:121-122`

## MED-03: Assembly _parse_srt fails on 2-line SRT entries
- **File**: `app/services/assembly_service.py:210-229`

## MED-04: product_video_compositor zoompan frame 0 jump
- **File**: `app/services/product_video_compositor.py:490-493`

## MED-05: Atom feed parser namespace mismatch
- **File**: `app/services/feed_parser.py:131-137`

## MED-06: image_fetcher creates new httpx.AsyncClient per image
- **File**: `app/services/image_fetcher.py:90-96`

## MED-07: Placeholder returned even when FFmpeg fails
- **File**: `app/services/image_fetcher.py:148-172`

## MED-08: textfile_helper path escaping insufficient for Windows
- **File**: `app/services/textfile_helper.py:85`

## MED-09: Assembly FFmpeg -ss before -i with stream_loop
- **File**: `app/services/assembly_service.py:710-719`

## MED-10: GPU fallback only triggers on specific error strings
- **File**: `app/services/video_processor.py:810-816`

## MED-11: keyword_matcher O(n*m*k) with no limit
- **File**: `app/services/keyword_matcher.py:140-194`

## MED-12: srt_validator strips legitimate SRT formatting tags
- **File**: `app/services/srt_validator.py:11-23`

## MED-13: cost_tracker _get_summary_from_local KeyError on malformed entries
- **File**: `app/services/cost_tracker.py:262`

## MED-14: Timezone naive vs aware in cleanup.py (Python 3.12+ crash)
- **File**: `app/cleanup.py:57-58`

## MED-15: No global exception handler (stack traces leak)
- **File**: `app/main.py`

## MED-16: SlowAPI 429 responses bypass CORS headers (middleware order)
- **File**: `app/main.py:120-134`

## MED-17: No server-level request body size limit (OOM possible)
- **File**: `app/main.py`, `run.py`

## MED-18: Missing profile_id filter on clip content updates
- **File**: `app/api/library_routes.py:2003-2006`

## MED-19: Delete project returns success even when nothing deleted
- **File**: `app/api/library_routes.py:536-537`

## MED-20: Orphaned clip_content records on project CASCADE delete
- **File**: `app/api/library_routes.py:528-536`

## MED-21: _update_project_counts fetches all clips to count client-side
- **File**: `app/api/library_routes.py:2465-2486`

## MED-22: Feed sync updates without profile_id check
- **File**: `app/api/feed_routes.py:109-114`

## MED-23: cleanup_old_jobs deletes ALL jobs (including active)
- **File**: `app/services/job_storage.py:267-268`

## MED-24: datetime.utcnow() deprecated in profile_routes.py
- **File**: `app/api/profile_routes.py:123,221,278,408,414,608,691`

## MED-25: Path traversal protection inconsistency
- **File**: `app/api/routes.py:976-991`

## MED-26: Status endpoints expose error details publicly
- **Files**: `app/api/assembly_routes.py:400`, `pipeline_routes.py:1513`, `postiz_routes.py:504`

## MED-27: _project_locks cleanup race condition
- **File**: `app/api/library_routes.py`

## MED-28: Large in_() query in TTS library
- **File**: `app/api/tts_library_routes.py:128-145`

## MED-29: Postiz eviction sorts by UUID not by time
- **File**: `app/api/postiz_routes.py:84-89`

## MED-30: Inconsistent .single() error handling
- **Files**: catalog_routes.py:170, product_generate_routes.py:511

## MED-31: Pipeline render_jobs_lock created per-request (useless)
- **File**: `app/api/pipeline_routes.py:1245`

## MED-32: _get_summary_from_supabase fetches all rows client-side
- **File**: `app/services/cost_tracker.py:198-250`

## MED-33: Inconsistent table naming (editai_projects vs jobs)
- **File**: `app/main.py:57`

---

# LOW BUGS (34)

## LOW-01: edge_tts voices_cache shared across instances
## LOW-02: VideoSegment type hint Optional missing
## LOW-03: _parse_scripts may return more scripts than requested
## LOW-04: GPU -bf 2 incompatible with some NVENC
## LOW-05: audio_normalizer JSON extraction may find wrong object
## LOW-06: postiz is_postiz_configured bypasses cache
## LOW-07: elevenlabs_account_manager del KeyError
## LOW-08: Duplicate FFmpeg PATH prepend
## LOW-09: Hardcoded Windows-only FFmpeg path
## LOW-10: httpx.Client never closed on shutdown
## LOW-11: lru_cache prevents .env reload
## LOW-12: Rate limit headers not exposed via CORS
## LOW-13: Redundant get_settings() call
## LOW-14: No pagination on list_projects
## LOW-15: No pagination on list_all_clips
## LOW-16: No pagination on segments listing
## LOW-17: Redundant get_supabase() calls
## LOW-18: Missing .execute() result verification
## LOW-19: in_() with potentially empty list
## LOW-20: Pipeline JSON key type conversion fragile
## LOW-21: Plaintext API keys naming (api_key_encrypted)
## LOW-22: delete_feed doesn't clean product image files
## LOW-23: bulk_delete_clips N+1 queries
## LOW-24: TTS library bulk_delete large in_()
## LOW-25: upload_source_video reads entire file to memory
## LOW-26: Missing upload size validation on segments
## LOW-27: Voice cloning temp file name injection
## LOW-28: get_batch_status doesn't verify profile ownership
## LOW-29: Hardcoded MIME validation for voice cloning
## LOW-30: TTS audio serving path inconsistency
## LOW-31: _extend_video default profile_id="default"
## LOW-32: Pipeline render lock scoped to request
## LOW-33: cost_tracker unbounded api_costs select (dup HIGH-24)
## LOW-34: Missing fire-and-forget DB result checks
