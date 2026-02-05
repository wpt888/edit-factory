---
phase: 08-audio-normalization
plan: 02
subsystem: media-processing
tags: [ffmpeg, audio, loudnorm, video-rendering, pipeline]

# Dependency graph
requires:
  - phase: 08-01
    provides: audio_normalizer service with measure_loudness and build_loudnorm_filter
  - phase: 07-platform-export-presets
    provides: EncodingPreset with normalize_audio flag and LUFS targets
provides:
  - _render_with_preset() with integrated two-pass audio normalization
  - Automatic -14 LUFS loudness for all rendered videos with audio
  - Graceful degradation when normalization measurement fails
affects: [video-export, platform-rendering, audio-quality]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-pass-audio-pipeline, conditional-audio-filtering, graceful-audio-fallback]

key-files:
  created: []
  modified: [app/api/library_routes.py]

key-decisions:
  - "Normalization only applies to real audio (has_audio=True and audio_path exists), skips silent audio (anullsrc)"
  - "Audio filters applied between video filters and encoding parameters in FFmpeg command"
  - "Measurement failure logs warning but continues render without normalization"

patterns-established:
  - "Audio filter list pattern: build filters conditionally, join with comma for -af parameter"
  - "Graceful audio degradation: log failure, continue with original audio rather than fail render"

# Metrics
duration: 5min
completed: 2026-02-05
---

# Phase 08 Plan 02: Render Integration Summary

**Two-pass audio normalization integrated into _render_with_preset() pipeline for consistent -14 LUFS loudness across all video exports**

## Performance

- **Duration:** 5 min (estimated from checkpoint approval flow)
- **Started:** 2026-02-05T11:37:00Z (estimated)
- **Completed:** 2026-02-05T11:42:57Z
- **Tasks:** 2 (1 implementation + 1 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Integrated audio_normalizer service into video render pipeline (_render_with_preset function)
- Two-pass loudnorm workflow: measure → build filter → apply during FFmpeg encoding
- Graceful degradation: render continues without normalization if measurement fails
- Conditional application: only normalizes real audio, skips silent audio tracks

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate audio normalization into render pipeline** - `3654b52` (feat)
2. **Task 2: Human verification checkpoint** - User approved (checkpoint, no commit)

## Files Created/Modified
- `app/api/library_routes.py` - Added audio normalization to _render_with_preset():
  - Import measure_loudness and build_loudnorm_filter from audio_normalizer service
  - Two-pass normalization: measure loudness → build linear filter → apply to FFmpeg command
  - Audio filters section positioned between video filters and encoding parameters
  - Conditional logic: only normalize when has_audio=True and audio_path exists (not anullsrc silent audio)
  - Graceful error handling: logs warning on measurement failure, continues render without normalization

## Decisions Made

**Audio filter placement:** Positioned audio_filters section after video filters (`-vf`) but before FPS/encoding params to ensure proper FFmpeg command structure.

**Silent audio handling:** Explicitly check `has_audio and audio_path` before attempting normalization to avoid processing anullsrc (generated silent audio), which would waste processing time.

**Graceful degradation:** On measurement failure, log warning and continue render without normalization rather than failing the entire export. Users get video output even if normalization encounters issues.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - integration followed clear plan specification with existing service ready to use.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 09 (Video Enhancement Filters):**
- Audio normalization pipeline complete and user-verified
- All platform presets (TikTok, Reels, YouTube Shorts, Generic) export with -14 LUFS loudness
- Render pipeline accepts additional audio filters (ready for future enhancements like EQ, compression)

**Audio normalization verified:**
- Logs show "Performing two-pass audio normalization (target: -14.0 LUFS)"
- Logs show "Audio normalization: X.X LUFS -> -14.0 LUFS" with measured input levels
- Videos without audio skip normalization (no wasted processing)
- Failure cases degrade gracefully (user confirmed via testing)

**Technical notes:**
- Audio filters use `-af` parameter with comma-joined filter list
- loudnorm filter uses linear=true mode with measured parameters from first pass
- encoding_presets.py already prevents 192kHz upsampling via `-ar 48000` in to_ffmpeg_params()

**Phase 08 (Audio Normalization) completion:**
- Plan 08-01: Audio normalization foundation service ✓
- Plan 08-02: Render pipeline integration ✓
- Plan 08-03: TBD (if additional audio features needed, otherwise phase complete)

**No blockers** - audio normalization working end-to-end in production render pipeline.

---
*Phase: 08-audio-normalization*
*Completed: 2026-02-05*
