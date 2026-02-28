---
phase: 46-overlay-ffmpeg-render-integration
plan: 01
subsystem: api
tags: [ffmpeg, overlay, pip, kenburns, pipeline, render, fastapi, nextjs]

# Dependency graph
requires:
  - phase: 45-interstitial-slide-controls
    provides: "InterstitialSlide type, pipeline state wiring, backend interstitial_slides field"
  - phase: 44-assembly-pipeline-fix
    provides: "Stable assembly service with SRT fixes"
provides:
  - "overlay_renderer.py with generate_interstitial_clip and apply_pip_overlay FFmpeg functions"
  - "PipelineRenderRequest.pip_overlays field (segment_id -> image_url/position/size/animation)"
  - "Frontend pip_overlays payload built from product associations state"
affects: [46-02, assembly-service, pipeline-render]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "asyncio.to_thread for blocking FFmpeg subprocess in async context"
    - "Graceful degradation: overlay functions return None/original path on failure"
    - "4x pre-scale (W_LARGE) pattern for smooth Ken Burns zoompan (from product_video_compositor)"
    - "Per-segment pip_overlays dict (segment_id key) parallels interstitial_slides (variant_index key)"

key-files:
  created:
    - app/services/overlay_renderer.py
  modified:
    - app/api/pipeline_routes.py
    - frontend/src/app/pipeline/page.tsx

key-decisions:
  - "PiP size map: small=150x150, medium=200x200, large=280x280 pixels"
  - "PiP positions include vertical offsets for TikTok/Reels UI chrome (y=200 top, y=H-h-250 bottom)"
  - "Ken Burns for PiP: 2x pre-scale (not 4x) since PiP is small, zoompan then scale to pip size"
  - "Fade animation uses geq alpha channel expression for smooth 0.5s in/out"
  - "apply_pip_overlay returns original video_path on failure (never crashes render pipeline)"

patterns-established:
  - "overlay_renderer: graceful degradation pattern — functions always return safe fallback values"
  - "FFmpeg zoompan: 4x pre-scale for full-frame clips, 2x for small PiP overlays"

requirements-completed: [OVRL-04, OVRL-05, OVRL-06]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 46 Plan 01: Overlay FFmpeg Render Integration Summary

**FFmpeg overlay_renderer service with Ken Burns/static/fade PiP compositing and interstitial clip generation, wired through pipeline render payload**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T01:16:36Z
- **Completed:** 2026-02-28T01:19:57Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created `overlay_renderer.py` with two core async FFmpeg functions for PiP overlay compositing and interstitial clip generation
- Ken Burns animation supports all four directions (zoom-in, zoom-out, pan-left, pan-right) using the established 4x pre-scale pattern from product_video_compositor
- `PipelineRenderRequest` extended with `pip_overlays` field; backend logs receipt; frontend builds pip_overlays from product associations state and includes in render POST body

## Task Commits

Each task was committed atomically:

1. **Task 1: Create overlay_renderer.py service** - `d05e865` (feat)
2. **Task 2: Wire pip_overlays frontend to backend** - `b531cce` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `app/services/overlay_renderer.py` - New: generate_interstitial_clip, apply_pip_overlay, _download_image helpers with full animation support
- `app/api/pipeline_routes.py` - Added pip_overlays field to PipelineRenderRequest + logging
- `frontend/src/app/pipeline/page.tsx` - handleRender builds pip_overlays from associations and sends in POST body

## Decisions Made
- PiP size constants: small=150x150, medium=200x200, large=280x280 — chosen to be visible but not obstruct main content
- Position offsets: y=200 for top positions (below TikTok safe zone), y=H-h-250 for bottom (above interaction zone)
- Ken Burns for PiP uses 2x pre-scale (not 4x) since pip images are already small; maintains smooth motion without excessive memory
- Fade uses FFmpeg geq alpha expression for per-pixel smooth fade-in/out over 0.5s
- apply_pip_overlay returns original video_path on any failure so render pipeline always continues

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - both tasks completed cleanly on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- overlay_renderer.py is ready for Plan 02 to import and call during assembly rendering
- pip_overlays data flows from frontend through to backend request model
- Plan 02 needs to: (a) pass pip_overlays + interstitial_slides to assemble_and_render, (b) call apply_pip_overlay per segment during render, (c) call generate_interstitial_clip for interstitial slides

---
*Phase: 46-overlay-ffmpeg-render-integration*
*Completed: 2026-02-28*
