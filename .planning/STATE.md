# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-23)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v7 Product Image Overlays — Phase 32: Association Data Layer

## Current Position

Milestone: v7 Product Image Overlays
Phase: 32 — Association Data Layer
Plan: 01 complete (2 plans done)
Status: Phase 32 in progress — Plan 01 shipped association data layer foundation
Last activity: 2026-02-23 — Phase 32 Plan 01 completed (migration + images endpoint)

```
v7 Progress: [          ] 0% — 0/6 phases complete
```

## Performance Metrics

**Velocity:**
- Total plans completed: 76 (across v2-v7)
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
- [Phase 32]: catalog_product_id stored as plain UUID without FK (cross-schema FK to uf.products_catalog avoided)
- [Phase 32]: get_catalog_product_images() uses SECURITY DEFINER + GRANT EXECUTE for PostgREST anon/authenticated compatibility

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

**v7 migration 019** (`segment_product_associations`) was applied in Phase 32 Plan 01.

## Session Continuity

Last session: 2026-02-23
Stopped at: Completed 32-01-PLAN.md (association data layer foundation)
Resume file: None
Next action: Execute Phase 32 Plan 02 (association CRUD routes)

---
*Last updated: 2026-02-23 after Phase 32 Plan 01 completed*
