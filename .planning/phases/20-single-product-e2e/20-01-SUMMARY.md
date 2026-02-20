---
phase: 20-single-product-e2e
plan: "01"
subsystem: product-video-generation
tags: [fastapi, tts, ffmpeg, compositor, product-video, background-tasks, supabase]
dependency_graph:
  requires:
    - app/services/product_video_compositor.py (Phase 18)
    - app/services/tts/factory.py (Phase 12)
    - app/services/tts/elevenlabs.py (Phase 12)
    - app/services/tts/edge.py (Phase 12)
    - app/services/tts_subtitle_generator.py (Phase 12)
    - app/services/job_storage.py
    - app/api/library_routes.py (_render_with_preset)
    - app/api/auth.py (get_profile_context)
  provides:
    - POST /api/v1/products/{product_id}/generate endpoint
    - _generate_product_video_task (6-stage pipeline)
  affects:
    - app/main.py (router registration)
    - editai_projects table (new rows inserted by pipeline)
    - editai_clips table (new rows inserted by pipeline)
tech_stack:
  added: []
  patterns:
    - BackgroundTasks (FastAPI) for async pipeline dispatch
    - run_in_executor for sync FFmpeg calls in async context
    - get_job_storage() singleton for job progress tracking
    - _render_with_preset import from library_routes (direct import of private function)
    - preset dict bridge: EncodingPreset -> dict for _render_with_preset compatibility
key_files:
  created:
    - app/api/product_generate_routes.py
  modified:
    - app/main.py
decisions:
  - id: "20-01-A"
    summary: "Implemented both Task 1 (endpoint) and Task 2 (background pipeline) in a single file creation since they are a single logical unit — endpoint file always contains its background task"
  - id: "20-01-B"
    summary: "Built _build_preset_dict() bridge helper to convert EncodingPreset object to the dict format _render_with_preset expects (name, width, height, fps, audio_bitrate, extra_flags)"
  - id: "20-01-C"
    summary: "compose_product_video and _render_with_preset wrapped in run_in_executor since they are synchronous FFmpeg subprocess calls inside an async task"
metrics:
  duration_minutes: 3
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  completed_date: "2026-02-21"
---

# Phase 20 Plan 01: Product Video Generation Backend Summary

**One-liner:** 6-stage backend pipeline — TTS (quick template or elaborate AI) + SRT subtitles (ElevenLabs only) + product compositor + _render_with_preset + library insert via POST /products/{product_id}/generate.

## What Was Built

### Task 1: POST endpoint + request model

`app/api/product_generate_routes.py`:
- `ProductGenerateRequest` pydantic model with 11 fields: `voiceover_mode`, `tts_provider`, `voice_id`, `ai_provider`, `duration_s`, `encoding_preset`, `voiceover_template`, `cta_text`, `enable_denoise`, `enable_sharpen`, `enable_color_correction`
- `POST /products/{product_id}/generate` endpoint that validates product exists, creates job, dispatches background task, returns `{"job_id": ..., "status": "pending"}` immediately
- `_build_preset_dict()` helper to bridge `EncodingPreset` -> dict format for `_render_with_preset`
- Router registered in `app/main.py` under `/api/v1` prefix

### Task 2: 6-stage background pipeline

`_generate_product_video_task` implements:

| Stage | Progress | Work |
|-------|----------|------|
| 1 Setup | 5% -> 10% | Fetch product, resolve/re-download image, create temp dir |
| 2 TTS Voiceover | 10% -> 40% | Quick template or elaborate ScriptGenerator AI, then ElevenLabs (with timestamps) or Edge TTS |
| 3 SRT Subtitles | 40% -> 50% | generate_srt_from_timestamps for ElevenLabs; None for Edge TTS |
| 4 Composition | 50% -> 70% | compose_product_video (Ken Burns + text overlays, silent MP4) |
| 5 Final Render | 70% -> 90% | _render_with_preset (audio mux + LUFS normalization + encoding preset + filters + subtitle burn) |
| 6 Library Insert | 90% -> 100% | editai_projects row + editai_clips row; job status = completed with clip_id/project_id in result |

## Success Criteria Met

- [x] POST /api/v1/products/{product_id}/generate returns job_id (TTS-01 backend, BATCH-01)
- [x] Quick mode builds voiceover from template without AI (TTS-01)
- [x] Elaborate mode uses ScriptGenerator.generate_scripts() (TTS-02)
- [x] TTS provider selection: edge and elevenlabs both supported (TTS-03)
- [x] ElevenLabs uses generate_audio_with_timestamps() for SRT; Edge TTS skips subtitles (TTS-04)
- [x] compositor + _render_with_preset used for final render (OUT-01, OUT-02, OUT-03)
- [x] editai_projects + editai_clips inserted after render (BATCH-05)
- [x] Job trackable via GET /api/v1/jobs/{job_id} (BATCH-01)

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written.

### Implementation Notes

**Preset dict bridge:** `_render_with_preset` expects a dict with `name`, `width`, `height`, `fps`, `audio_bitrate`, `extra_flags`. The product pipeline has no DB preset row, so `_build_preset_dict()` constructs the dict from the `EncodingPreset` object. Width/height hardcoded to 1080x1920 (portrait — matches compositor output).

**Sync in async:** Both `compose_product_video` and `_render_with_preset` are synchronous FFmpeg subprocess calls. Wrapped in `asyncio.get_event_loop().run_in_executor(None, lambda: ...)` to avoid blocking the event loop.

**Edge TTS voice:** Default Romanian voice `ro-RO-EmilNeural` used when `voice_id` is None (per plan note for Romanian product feeds).

## Self-Check: PASSED

- app/api/product_generate_routes.py: FOUND
- app/main.py: FOUND (modified)
- Commit 6d08e53: FOUND
