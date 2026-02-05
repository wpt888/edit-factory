---
phase: 08-audio-normalization
plan: 01
subsystem: media-processing
tags: [ffmpeg, audio, loudnorm, ebu-r128, pydantic]

# Dependency graph
requires:
  - phase: 07-platform-export-presets
    provides: EncodingPreset model with platform configurations
provides:
  - audio_normalizer.py service with two-pass loudness measurement and filter building
  - EncodingPreset extended with normalize_audio, target_lufs, target_tp, target_lra fields
  - All platform presets configured for -14 LUFS social media standard
affects: [08-02-render-integration, video-processing, encoding]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-pass-loudnorm, dataclass-measurement-results]

key-files:
  created: [app/services/audio_normalizer.py]
  modified: [app/services/encoding_presets.py]

key-decisions:
  - "-14 LUFS integrated loudness target for all social media platforms"
  - "-1.5 dBTP true peak limit to prevent clipping"
  - "7.0 LU loudness range for dynamic compression"
  - "Two-pass loudnorm workflow: measure first, then apply linear normalization"

patterns-established:
  - "LoudnormMeasurement dataclass pattern for structured FFmpeg JSON parsing"
  - "Service functions return Optional[T] for graceful failure handling"

# Metrics
duration: 3min
completed: 2026-02-05
---

# Phase 08 Plan 01: Audio Normalization Foundation Summary

**Two-pass EBU R128 loudness normalization service with FFmpeg loudnorm filter and -14 LUFS social media presets**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-05T08:25:38Z
- **Completed:** 2026-02-05T08:28:11Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created audio_normalizer.py service implementing two-pass EBU R128 loudness measurement
- Extended EncodingPreset model with audio normalization configuration fields
- Configured all 4 platform presets (TikTok, Reels, YouTube Shorts, Generic) with -14 LUFS targets

## Task Commits

Each task was committed atomically:

1. **Task 1: Create audio normalization service** - `92338b1` (feat)
2. **Task 2: Extend EncodingPreset with normalization fields** - `a80caf2` (feat)

## Files Created/Modified
- `app/services/audio_normalizer.py` - Two-pass loudness measurement and filter building (172 lines)
- `app/services/encoding_presets.py` - Added normalize_audio, target_lufs, target_tp, target_lra fields to EncodingPreset class and all preset instances

## Decisions Made
- **Two-pass workflow:** First pass measures current loudness, second pass applies linear normalization with measured parameters for precise gain adjustment
- **JSON parsing via regex:** FFmpeg loudnorm outputs JSON to stderr mixed with other output, regex extraction isolates the measurement block
- **Dataclass for measurements:** LoudnormMeasurement encapsulates all 5 required parameters (input_i, input_tp, input_lra, input_thresh, target_offset) with type safety
- **Pydantic Field validation:** target_lufs range -70 to -5, target_tp range -9 to 0, target_lra range 1 to 50 prevent invalid audio targets
- **-14 LUFS standard:** Aligns with YouTube (-14), Instagram (-14), and TikTok (-14) platform recommendations for optimal loudness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - straightforward service implementation with clear requirements.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Phase 08-02 (Render Integration):**
- audio_normalizer.py exports measure_loudness() and build_loudnorm_filter() ready for use
- EncodingPreset has normalize_audio flag to enable/disable normalization per preset
- All presets default to normalize_audio=True with -14 LUFS targets

**Technical notes:**
- measure_loudness() returns Optional[LoudnormMeasurement] - None indicates measurement failure (missing file, timeout, invalid output)
- build_loudnorm_filter() generates FFmpeg filter string with linear=true mode for second pass
- Filter string format: `loudnorm=I={lufs}:TP={tp}:LRA={lra}:measured_I=...:linear=true`
- Next plan should integrate these into library_routes.py render_final_video() pipeline

**No blockers** - service tested via import verification, ready for integration.

---
*Phase: 08-audio-normalization*
*Completed: 2026-02-05*
