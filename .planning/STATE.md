# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v7 Product Image Overlays — Phase 32: Association Data Layer

## Current Position

Milestone: v7 Product Image Overlays
Phase: 32 — Association Data Layer
Plan: Not started
Status: Roadmap created, ready to plan Phase 32
Last activity: 2026-02-23 — v7 roadmap created (6 phases, 18 requirements mapped)

```
v7 Progress: [          ] 0% — 0/6 phases complete
```

## Performance Metrics

**Velocity:**
- Total plans completed: 75 (across v2-v6)
- Total phases completed: 31
- Total milestones shipped: 6

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 7 (17-23) | 13 | Shipped 2026-02-21 |
| v6 Hardening | 8 (24-31) | 16 | Shipped 2026-02-22 |
| v7 Overlays | 6 (32-37) | TBD | In progress |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
v6 decisions archived to `.planning/milestones/v6-ROADMAP.md`.

### v7 Architecture Notes

- Existing foundation to build on: `v_catalog_products` view, `image_fetcher.py`, `segment_transforms.py` (per-segment visual config pattern), `product_video_compositor.py` (Ken Burns zoompan)
- New DB table needed: `segment_product_associations` (segment_id, product_id, selected_image_urls, pip_config JSONB, slide_config JSONB)
- PiP rendering: FFmpeg `overlay` filter with positioning arithmetic; position/size map to pixel offsets at render time
- Interstitial rendering: FFmpeg `concat` filter — insert generated image clip at segment boundary
- Frontend pattern: checkbox+slider pattern (v3 filters, v3 subtitles) for PiP toggle + controls
- Picker components (Phase 33) are shared by both Segments page (UI-01) and Pipeline page (UI-02)

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending (carry-over from v6):**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor
- Migration 017 (editai_generation_progress) requires manual application via Supabase SQL Editor

**v7 will add a new migration** (Phase 32) for `segment_product_associations` table.

## Session Continuity

Last session: 2026-02-23
Stopped at: v7 roadmap created
Resume file: None
Next action: `/gsd:plan-phase 32`

---
*Last updated: 2026-02-23 after v7 roadmap created*
