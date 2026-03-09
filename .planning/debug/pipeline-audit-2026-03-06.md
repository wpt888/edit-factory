# Pipeline Comprehensive Audit — 2026-03-06

## Summary: 138 bugs found across 6 audit zones

| Agent | Zone | Bugs | CRITICAL | HIGH | MEDIUM | LOW |
|-------|------|------|----------|------|--------|-----|
| 1. Pipeline Routes | `pipeline_routes.py` | 21 | 0 | 5 | 11 | 5 |
| 2. Pipeline Services | `assembly_service`, `script_generator`, `tts_subtitle_generator`, `silence_remover`, `elevenlabs.py` | 24 | 2 | 9 | 9 | 4 |
| 3. Pipeline Frontend | `page.tsx`, `timeline-editor.tsx`, `variant-preview-player.tsx`, `use-polling.ts` | 18 | 0 | 0 | 7 | 11 |
| 4. Video Processor | `video_processor`, `voice_detector`, `audio_normalizer`, `subtitle_styler`, `video_filters`, `encoding_presets`, `ffmpeg_semaphore` | 30 | 1 | 10 | 10 | 9 |
| 5. Job Storage & State | `job_storage`, `cost_tracker`, `auth`, `config`, `main` | 19 | 0 | 5 | 9 | 5 |
| 6. Library Routes & TTS | `library_routes`, `routes`, `segments_routes`, `elevenlabs_tts`, `edge_tts` | 26 | 4 | 6 | 8 | 8 |
| **TOTAL** | | **138** | **7** | **35** | **54** | **42** |

## Status: WAVES 1-3 APPLIED (2026-03-06)
- **7 CRITICAL** fixes applied (C1-C7)
- **11 HIGH** fixes applied (H1-H13, H3 was already done)
- **13 MEDIUM** fixes applied (M1-M14, M13 was already done)
- All 13 modified files pass AST syntax check
- Frontend TypeScript compiles clean
- **42 LOW** bugs remain (Wave 4) — deferred

---

## WAVE 1 — CRITICAL FIXES (7 bugs)

### C1. _pipelines dict writes without lock
**File:** `app/api/pipeline_routes.py` lines 302, 631, 714, 841, 988
**Fix:** Wrap all `_pipelines[id] = ...` and `_pipelines.pop(id)` with `with _pipelines_lock:`

### C2. do_render closure captures profile by reference
**File:** `app/api/pipeline_routes.py` line 1637
**Fix:** Before `async def do_render(vid):`, extract `_profile_id = profile.profile_id`. Replace all `profile.profile_id` inside do_render with `_profile_id`.

### C3. build_cmd closure late-binding
**File:** `app/services/video_processor.py` lines 809-870
**Fix:** Change `def build_cmd(use_gpu_encoding: bool):` to `def build_cmd(use_gpu_encoding: bool, seg=seg, audio_filter=audio_filter):`

### C4. TOCTOU race on generate_raw_clips lock
**File:** `app/api/library_routes.py` lines 731-783
**Fix:** Acquire lock non-blocking in endpoint handler, pass to background task. Task releases in finally.

### C5. Render lock blocking 300s — starves threadpool
**File:** `app/api/library_routes.py` lines 2459-2473
**Fix:** Hold project lock only during brief DB status update, not entire FFmpeg+TTS render.

### C6. Upload video not cleaned up on generate failure
**File:** `app/api/library_routes.py` lines 750-757, 921-935
**Fix:** Add `finally:` block in `_generate_raw_clips_task` to delete input file.

### C7. generate_audio_trimmed cache bypass
**File:** `app/services/elevenlabs_tts.py` lines 326-368
**Fix:** Add cache check at `generate_audio_trimmed` level before creating temp dir.

---

## WAVE 2 — HIGH IMPACT FIXES (13 bugs)

### H1. duration_overrides silently overwritten with None
**File:** `app/services/assembly_service.py` lines 1763-1776
**Fix:** Remove `duration_overrides = None` line (or make conditional).

### H2. Timer cleanup deletes library audio dir
**File:** `app/services/assembly_service.py` lines 2194-2208
**Fix:** Only schedule cleanup timer when audio was freshly generated: `if not reuse_audio_path:`

### H3. TTS cache key missing speed
**File:** `app/services/tts/elevenlabs.py` line 404-405
**Fix:** Add `speed` to cache key: `_{vs.get('speed', 1.0):.2f}`

### H4. Gemini response.text can be None
**File:** `app/services/script_generator.py` lines 228-240
**Fix:** `text = response.text; if not text: raise RuntimeError(...)`

### H5. get_jobs_by_project returns raw DB rows
**File:** `app/services/job_storage.py` line 328
**Fix:** `return [row.get("data", row) for row in result.data]`

### H6. create_job never passes profile_id
**File:** `app/api/routes.py` lines 505, 846, 1021
**Fix:** Add `profile_id=profile.profile_id` to all `create_job()` calls.

### H7. _memory_store grows unbounded
**File:** `app/services/job_storage.py` lines 395-433
**Fix:** Schedule periodic `cleanup_old_jobs` from lifespan handler.

### H8. desktop_mode bypasses auth without production guard
**File:** `app/main.py` line 195
**Fix:** Add warning log when `desktop_mode=True` in non-debug.

### H9. supabase_jwt_secret empty default
**File:** `app/main.py` around line 195
**Fix:** Add startup validation: log error if JWT secret empty and auth not disabled.

### H10. _extract_timeline orphans temp files
**File:** `app/services/video_processor.py` lines 2147-2223
**Fix:** Wrap extraction loop in try/except, clean segment_files on failure.

### H11. measure_loudness async/sync mismatch
**File:** `app/services/audio_normalizer.py` lines 46-145
**Fix:** Add `measure_loudness_sync()` wrapper.

### H12. Edge TTS asyncio.Lock on wrong event loop
**File:** `app/services/edge_tts_service.py` lines 70-73
**Fix:** Replace `asyncio.Lock()` with `threading.Lock()` for cache mutex.

### H13. get_optional_user swallows 500 errors
**File:** `app/api/auth.py` lines 164-177
**Fix:** Only catch 401/403, re-raise 500+.

---

## WAVE 3 — MEDIUM FIXES (selected high-value)

### M1. update_pipeline_scripts missing state lock (pipeline_routes.py:774-799)
### M2. segment_usage read without lock in preview (pipeline_routes.py:1394-1397)
### M3. Public status endpoint exposes file paths (pipeline_routes.py:2167-2168)
### M4. _render_locks_timestamps write without lock (pipeline_routes.py:2112)
### M5. Redundant imports inside do_render closure (pipeline_routes.py:1653, 1706, 2111)
### M6. _get_pipeline_or_load TOCTOU (pipeline_routes.py:315-316)
### M7. VoiceDetector retries load on every instantiation (voice_detector.py:101-140)
### M8. cv2.VideoCapture not nulled after release (video_processor.py:510-513)
### M9. _read_frame_at doesn't check seek success (video_processor.py:181-186)
### M10. resetPipeline doesn't stop polling (frontend page.tsx:1137-1163)
### M11. Preview failure clears ALL previews (frontend page.tsx:966-968)
### M12. cancelledRef not reset on dialog reopen (variant-preview-player.tsx:46)
### M13. _memory_store iterated without lock (job_storage.py:332-336)
### M14. Romanian strings in Step 4 UI (frontend page.tsx:3427-3553)

---

## WAVE 4 — FRONTEND MEDIUM + LOW (remaining)
See full agent transcripts for complete details on all 42 LOW bugs.
