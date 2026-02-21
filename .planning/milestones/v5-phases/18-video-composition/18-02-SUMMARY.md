---
phase: 18-video-composition
plan: 02
subsystem: video-processing
tags: [ffmpeg, text-overlays, sale-badge, filter_complex, diacritics, cta, product-video]

# Dependency graph
requires:
  - phase: 18-01
    provides: product_video_compositor.py with compose_product_video() and CompositorConfig

provides:
  - app/services/product_video_compositor.py with full text overlay system (name, brand, price, sale, CTA)
  - ensure_sale_badge() generating red REDUCERE badge PNG via FFmpeg lavfi (cached)
  - filter_complex code path for badge overlay (second input) when product is on sale
  - -vf code path (single input, no badge) for regular products

affects: [18-03, 19-api, 20-e2e, 21-batch]

# Tech tracking
tech-stack:
  added: []  # No new Python dependencies — pure stdlib + FFmpeg subprocess
  patterns:
    - "filter_complex with [0:v]chain[vid];[vid][1:v]overlay for badge second input"
    - "ensure_sale_badge() with FFmpeg lavfi color=c=red:s=220x80 + drawtext for badge generation"
    - "is_on_sale detection: sale_price exists AND sale_price < price AND sale_price > 0"
    - "output_dir field on CompositorConfig for badge storage location"
    - "Dual code path in compose_product_video: -filter_complex (on-sale) vs -vf (regular)"

key-files:
  created: []
  modified:
    - app/services/product_video_compositor.py

key-decisions:
  - "filter_complex used only when is_on_sale=True (badge needs second input); -vf for regular products avoids overhead"
  - "Sale price shown in yellow (y=1650), original price in muted gray (y=1720) — no strikethrough per research recommendation"
  - "Badge dir is config.output_dir (output/product_videos/) to keep badge co-located with output videos"
  - "ensure_sale_badge() caches badge PNG — skip generation if file exists"

patterns-established:
  - "compose_product_video() API unchanged: same signature, behavior extended for sale products"
  - "All product text in FFmpeg filters uses textfile= via build_multi_drawtext — verified no bare text= usage"

requirements-completed: [COMP-02, COMP-03, COMP-04]

# Metrics
duration: 3min
completed: 2026-02-20
---

# Phase 18 Plan 02: Text Overlays, Sale Badge, CTA Summary

**Full text overlay system (product name, brand, price/sale, CTA) and red REDUCERE sale badge PNG overlay via filter_complex, with all text using the textfile= pattern for Romanian diacritic safety**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-02-20T22:05:15Z
- **Completed:** 2026-02-20T22:08:45Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Extended `_build_text_overlays_simple` into `_build_text_overlays(product, cta_text)` returning `(is_on_sale, combined_vf, tmp_paths)`
- Added `ensure_sale_badge(badge_dir)` generating a cached red 220x80 REDUCERE badge PNG via FFmpeg lavfi
- Added `output_dir: Path` field to `CompositorConfig` (default `output/product_videos/`)
- Updated `compose_product_video()` with dual code path: `-filter_complex` when `is_on_sale=True` (badge PNG = second input), `-vf` for regular products
- Sale display: yellow sale price (y=1650) + muted gray original price (y=1720, "Pret initial: ...")
- CTA overlay: centered horizontally, red@0.85 box, y=1820
- All 4 test categories verified: Romanian diacritics, duration control (15/30/45/60s exact), Ken Burns zoompan, custom CTA text

## Task Commits

Each task was committed atomically:

1. **Task 1: Add full text overlays, sale badge, CTA and filter_complex path** — `ac2b991` (feat)
2. **Task 2: Comprehensive verification** — no new commit (code from Task 1 passed all tests; no changes needed)

## Files Created/Modified

- `app/services/product_video_compositor.py` — Extended with: `_build_text_overlays()`, `ensure_sale_badge()`, `output_dir` in `CompositorConfig`, dual compose path (`-filter_complex` vs `-vf`)

## Test Results

| Test | Result |
|------|--------|
| Sale product (filter_complex + badge) | PASS — 76,070 byte MP4 |
| Regular product (-vf, no badge) | PASS — 58,275 byte MP4 |
| Badge PNG generated and cached | PASS — output/product_videos/_sale_badge.png |
| Romanian diacritics (15s sale video) | PASS — 77,294 byte MP4 |
| Duration 15s | PASS — actual 15.00s |
| Duration 30s | PASS — actual 30.00s |
| Duration 45s | PASS — actual 45.00s |
| Duration 60s | PASS — actual 60.00s |
| Ken Burns zoompan 15s | PASS — 208,054 byte MP4 |
| Custom CTA text | PASS — 62,966 byte MP4 |
| textfile= compliance (no bare text=) | PASS — 5 textfile= overlays, 0 bare text= |

## Decisions Made

- **Dual code path in compose_product_video.** Use `-filter_complex` only when `is_on_sale=True` because badge PNG requires a second FFmpeg input (which only works with filter_complex). Regular products stay on simpler `-vf` path for less overhead.
- **Sale price in yellow; original in muted gray (no strikethrough).** Per research recommendation (Phase 18 RESEARCH.md), FFmpeg drawtext has no strikethrough support. Muted gray at smaller fontsize achieves the visual "original price" hierarchy.
- **Badge cached at config.output_dir.** Co-located with output videos. Skipped if already exists — safe for batch processing.

## Deviations from Plan

None — plan executed exactly as written.

## Requirements Completed

- **COMP-01:** Ken Burns zoom/pan animation — verified in Task 2 zoompan test (208KB 15s video)
- **COMP-02:** Product name, price, sale price, brand display correctly — verified in Task 1 + Task 2
- **COMP-03:** Sale badge overlay appears for on-sale products — verified in Task 1
- **COMP-04:** CTA text overlay is configurable and renders correctly — verified in Task 2
- **COMP-06:** Duration control produces correct-length videos — verified in Task 2 (exact 0.00s diff for all durations)

## Next Phase Readiness

- `compose_product_video()` is complete and ready for Plan 18-03 (API endpoint)
- Badge PNG is cached — batch processing in Phase 21 will reuse it
- All COMP requirements verified; Phase 18 can proceed to API layer

## Self-Check: PASSED

- app/services/product_video_compositor.py: FOUND
- .planning/phases/18-video-composition/18-02-SUMMARY.md: FOUND
- commit ac2b991: FOUND

---
*Phase: 18-video-composition*
*Completed: 2026-02-20*
