---
phase: 18-video-composition
plan: 01
subsystem: video-processing
tags: [ffmpeg, zoompan, ken-burns, product-video, composition, benchmark]

# Dependency graph
requires:
  - phase: 17-feed-foundation
    provides: textfile_helper.py with build_drawtext_filter/build_multi_drawtext for textfile= pattern

provides:
  - app/services/product_video_compositor.py with compose_product_video() and benchmark_zoompan()
  - Ken Burns zoompan animation (4x pre-scale) for portrait 1080x1920 video from product images
  - Duration control for 15/30/45/60 second output videos
  - Benchmark result: 2.3x zoompan slowdown — viable for batch in Phase 21

affects: [18-02, 18-03, 19-api, 20-e2e, 21-batch]

# Tech tracking
tech-stack:
  added: []  # No new Python dependencies — pure stdlib + FFmpeg subprocess
  patterns:
    - "-vf comma-chain (scale+pad -> zoompan -> drawtext) for single-input composition"
    - "4x pre-scale (W_LARGE=4320) before zoompan for smooth motion without jitter"
    - "time.perf_counter() timing around subprocess.run for FFmpeg benchmark"
    - "CompositorConfig dataclass for composition parameters"

key-files:
  created:
    - app/services/product_video_compositor.py
  modified:
    - .planning/STATE.md

key-decisions:
  - "zoompan benchmark on WSL dev machine: simple_scale=6.5s, zoompan=14.7s, 2.3x slowdown for 30s portrait video. Phase 21 batch WILL use zoompan by default."
  - "-vf (not -filter_complex) used for Plan 18-01 since there is only one input; Plan 18-02 will switch to -filter_complex for badge overlay second input"
  - "Plan 18-01 implements only product name overlay; full overlays (price, brand, CTA, badge) added in Plan 18-02 per plan scope"

patterns-established:
  - "Product video composition: -loop 1 -framerate FPS -i image -> -vf scale+pad+zoompan+drawtext -> -t duration -c:v libx264 -preset veryfast"
  - "All text in FFmpeg filters MUST use textfile= via build_multi_drawtext; never text= for product content"

requirements-completed: [COMP-01, COMP-06]

# Metrics
duration: 35min
completed: 2026-02-21
---

# Phase 18 Plan 01: Video Compositor + Ken Burns Benchmark Summary

**FFmpeg product video compositor with 4x-prescaled Ken Burns zoompan, 15/30/45/60s duration control, and benchmark proving zoompan is viable for batch at 2.3x slowdown on WSL dev machine**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-02-21T00:17:34Z
- **Completed:** 2026-02-21T00:52:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `app/services/product_video_compositor.py` with `compose_product_video()` and `benchmark_zoompan()` functions
- Validated both simple-scale and zoompan modes produce valid MP4 output from test images (15s, 30s, 45s, 60s all tested)
- Ran zoompan benchmark on dev machine: simple_scale=6.5s, zoompan=14.7s, 2.3x slowdown — far below the feared 10-100x; Phase 21 batch will use zoompan by default
- Resolved the "v5 Phase 18 risk" blocker in STATE.md with real benchmark data

## Task Commits

Each task was committed atomically:

1. **Task 1: Create product_video_compositor.py with Ken Burns animation and duration control** - `e1e6f7e` (feat)
2. **Task 2: Run zoompan benchmark and document results in STATE.md** - `55a420a` (chore)

## Files Created/Modified

- `app/services/product_video_compositor.py` — Core FFmpeg composition service: `CompositorConfig`, `compose_product_video()`, `benchmark_zoompan()`, `_calculate_zoompan_params()`, `_build_scale_pad_filter()`, `_build_zoompan_filter()`
- `.planning/STATE.md` — Added benchmark decision, resolved Phase 18 risk blocker, updated current position to Phase 18-01

## Decisions Made

- **Zoompan is viable for batch.** Benchmark on WSL dev machine (Intel x86-64, Ubuntu 24.04, FFmpeg 6.1.1): 6.5s simple-scale vs 14.7s zoompan for 30s portrait video at 25fps. 2.3x slowdown. Phase 21 batch defaults to zoompan (not simple-scale). `use_zoompan=False` is kept as a fallback option.
- **-vf used for Plan 18-01** (single input, no badge). Plan 18-02 will switch to -filter_complex when the badge PNG second input is added, per the research anti-pattern warning.
- **Plan 18-01 scope is limited to product name overlay.** Full price, brand, CTA, badge overlays are Plan 18-02 scope (as specified in the plan action).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. FFmpeg 6.1.1 (Linux system binary at `/usr/bin/ffmpeg`) handled all filter chains correctly. The `textfile=` pattern from `textfile_helper.py` integrated cleanly into the `-vf` chain.

## User Setup Required

None — no external service configuration required. FFmpeg is already in the WSL system PATH.

## Next Phase Readiness

- `compose_product_video()` is ready for use by Plan 18-02 (text overlays extension) and Plan 18-03 (API endpoint)
- Benchmark data resolves the Phase 21 batch design question: zoompan is the default
- Plan 18-02 can extend `_build_text_overlays_simple()` into full overlay function with price, brand, sale badge, CTA

---
*Phase: 18-video-composition*
*Completed: 2026-02-21*
