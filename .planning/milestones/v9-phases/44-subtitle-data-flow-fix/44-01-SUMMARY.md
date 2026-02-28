---
phase: 44-subtitle-data-flow-fix
plan: 01
subsystem: api
tags: [pipeline, tts, subtitles, srt, elevenlabs, caching]

# Dependency graph
requires:
  - phase: 43-assembly-diversity-fix
    provides: stable assembly service that preview_matches returns correct srt_content from
provides:
  - SRT content persisted in tts_previews cache after preview_variant completes
  - Step 3 render reuses cached SRT instead of regenerating via ElevenLabs
affects: [pipeline_routes, assembly_service, render flow, subtitle bake-in]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tts_previews cache extended: srt_content field stored alongside audio_path so render can reuse without re-calling ElevenLabs"

key-files:
  created: []
  modified:
    - app/api/pipeline_routes.py

key-decisions:
  - "Store srt_content into tts_previews immediately after preview_variant stores preview_data — single _db_save_pipeline write covers both"
  - "Backfill audio_path/duration/script_hash when tts_previews entry didn't exist (covers case where Step 2 standalone TTS was skipped)"
  - "No change needed to generate_variant_tts endpoint — standalone TTS doesn't produce SRT; preview_variant always enriches the cache"

patterns-established:
  - "tts_previews[variant_index] is the canonical TTS+SRT cache entry — all three fields (audio_path, audio_duration, srt_content) should be present after preview"

requirements-completed: [SUBS-01, SUBS-02]

# Metrics
duration: 8min
completed: 2026-02-28
---

# Phase 44 Plan 01: Subtitle Data Flow Fix Summary

**SRT content now persisted in tts_previews cache after preview_variant so Step 3 render reuses cached subtitles without a redundant ElevenLabs API call**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-28T00:21:00Z
- **Completed:** 2026-02-28T00:29:30Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added 12 lines of code in `preview_variant` to persist `srt_content` (and backfill audio metadata) into `tts_previews[variant_index]` before the `_db_save_pipeline` call
- Render path at line 1349 (`reuse_srt_content = existing_tts.get("srt_content")`) now retrieves actual SRT string instead of `None`
- `assemble_and_render` receives `reuse_srt_content` and skips ElevenLabs subtitle regeneration, eliminating timing drift between preview and render subtitles

## Task Commits

Each task was committed atomically:

1. **Task 1: Persist srt_content into tts_previews at preview_variant** - `9f7fb6e` (fix)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `app/api/pipeline_routes.py` - Added srt_content persistence into tts_previews cache inside preview_variant endpoint (lines 1130-1143)

## Decisions Made

- Store `srt_content` unconditionally on every `preview_variant` call — the SRT is freshly generated each time so overwriting stale data is always correct
- Backfill `audio_path`/`audio_duration`/`script_hash` only when the entry lacks `audio_path` — avoids overwriting richer data from the Step 2 standalone TTS endpoint
- No change to `generate_variant_tts` endpoint — it only produces audio, not SRT; the preview step will enrich the cache when it runs

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 44 plan 01 complete; tts_previews now carries `srt_content` for all variants that have been previewed
- Phase 44 plan 02 (if any) can proceed — the render path reads `reuse_srt_content` correctly
- Phase 45 (interstitial controls) can proceed once Phase 44 is fully complete

---
*Phase: 44-subtitle-data-flow-fix*
*Completed: 2026-02-28*
