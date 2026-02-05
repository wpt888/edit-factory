---
phase: 09-video-enhancement-filters
plan: 02
subsystem: api
tags: [ffmpeg, video-filters, hqdn3d, unsharp, eq, render-pipeline]

# Dependency graph
requires:
  - phase: 09-video-enhancement-filters
    plan: 01
    provides: VideoFilters, DenoiseConfig, SharpenConfig, ColorConfig dataclasses
  - phase: 07-platform-export-presets
    provides: EncodingPreset with to_ffmpeg_params()
  - phase: 08-audio-normalization
    provides: Audio filter integration pattern in render pipeline
provides:
  - Render endpoint with 8 video filter parameters
  - Filter chain integration in _render_with_preset()
  - Filter order enforcement (denoise -> sharpen -> color)
affects: [09-03-filter-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Form parameter parsing for boolean strings from HTML forms"
    - "Filter insertion in FFmpeg -vf chain with locked order"
    - "chroma_amount=0.0 for unsharp to prevent color artifacts"

key-files:
  created: []
  modified:
    - app/api/library_routes.py

key-decisions:
  - "Filter parameters passed through background task (not stored in database)"
  - "Enhancement filters inserted after scale/crop, before subtitles"
  - "Filter order locked in code (user cannot reorder)"

patterns-established:
  - "Boolean Form parameters parsed with .lower() in ('true', '1', 'yes', 'on')"
  - "Filter conditionals only append when enabled (zero overhead when disabled)"
  - "logger.info() for each enabled filter for debugging"

# Metrics
duration: 2min
completed: 2026-02-05
---

# Phase 9 Plan 02: Render Integration Summary

**Video filter parameters added to render endpoint and integrated into _render_with_preset() with locked filter order (denoise->sharpen->color) after scale/crop, before subtitles**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-05T16:38:22Z
- **Completed:** 2026-02-05T16:40:33Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Render endpoint accepts 8 new filter parameters via Form data
- Boolean parameters parsed from HTML form strings
- Filter parameters propagated through _render_final_clip_task to _render_with_preset
- Enhancement filters inserted in correct position (after scale/crop, before subtitles)
- Filter order locked: denoise -> sharpen -> color (cannot sharpen noise)
- Chroma protected: unsharp uses chroma_amount=0.0 always
- No overhead when filters disabled (conditional filter append)
- Each enabled filter logged for debugging

## Task Commits

Each task was committed atomically:

1. **Task 1: Add filter parameters to render endpoint** - `06ac36d` (feat)
2. **Task 2: Integrate filters into _render_with_preset()** - `e63e0fe` (feat)

## Files Modified

- `app/api/library_routes.py`
  - Import: Added VideoFilters, DenoiseConfig, SharpenConfig, ColorConfig
  - render_final_clip(): Added 8 Form parameters for filters
  - render_final_clip(): Added boolean parsing for enable_* params
  - _render_final_clip_task(): Added 8 filter parameters
  - _render_with_preset(): Added 8 filter parameters to signature
  - _render_with_preset(): Inserted hqdn3d/unsharp/eq filters in -vf chain

## Filter Parameters Added

| Parameter | Type | Default | Purpose |
|-----------|------|---------|---------|
| enable_denoise | str->bool | false | Enable hqdn3d denoising |
| denoise_strength | float | 2.0 | luma_spatial value (0-10) |
| enable_sharpen | str->bool | false | Enable unsharp sharpening |
| sharpen_amount | float | 0.5 | luma_amount value (-2 to 5) |
| enable_color | str->bool | false | Enable eq color correction |
| brightness | float | 0.0 | Brightness adjustment (-1 to 1) |
| contrast | float | 1.0 | Contrast multiplier (0-3) |
| saturation | float | 1.0 | Saturation multiplier (0-3) |

## FFmpeg Filter Chain Order

1. scale (fill frame, force_original_aspect_ratio=increase)
2. crop (to exact preset dimensions)
3. **hqdn3d** (if enable_denoise=true) - denoise first
4. **unsharp** (if enable_sharpen=true) - sharpen cleaned signal
5. **eq** (if enable_color=true) - color adjust last
6. subtitles (if SRT content exists)

## Decisions Made

- Filter parameters NOT stored in database (passed per-render request)
- Auto-derive chroma/temporal from luma_spatial for hqdn3d (consistent with video_filters.py)
- Standard 5x5 kernel for unsharp (matrix_size=5)
- eq filter only includes non-default parameters (efficiency)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no database migration or configuration required. Filters are disabled by default.

## Next Phase Readiness

- Backend filter support complete
- Frontend can now call render endpoint with filter parameters
- Next plan (09-03) will add filter UI controls to the render dialog
- Filters ready for A/B testing with different content types

---
*Phase: 09-video-enhancement-filters*
*Completed: 2026-02-05*
