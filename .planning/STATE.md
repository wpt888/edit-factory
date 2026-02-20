# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v5 Product Video Generator — Phase 18: Video Composition (in progress)

## Current Position

Milestone: v5 Product Video Generator
Phase: 18 of 22 (Video Composition) — in progress
Plan: 2 of 3 in Phase 18 — plan 18-02 complete
Status: Phase 18 in progress — 18-01 (core compositor + benchmark) done; 18-02 (text overlays, sale badge, CTA) done; 18-03 pending
Last activity: 2026-02-20 — Phase 18-02 complete: full text overlay system, sale badge, CTA, filter_complex path for on-sale products

Progress: [█░░░░░░░░░] 10% (v5) — 4 milestones shipped prior

## Performance Metrics

**Velocity:**
- Total plans completed: 50 (across v2/v3/v4)
- Total phases completed: 16
- Total execution time: ~2.7 hours (v2) + ~2 days (v3) + ~47 min (v4)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 6 (17-22) | TBD | In progress |
| Phase 18-video-composition P01 | 35 | 2 tasks | 2 files |
| Phase 18-video-composition P02 | 3 | 2 tasks | 1 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [17-02]: textfile= (not text=) is canonical for all product text in FFmpeg — prevents diacritic corruption
- [17-02]: Semaphore(5) concurrency cap for parallel image downloads (tunable via CONCURRENT_DOWNLOADS)
- [17-02]: Gray placeholder via FFmpeg lavfi on download failure — no Pillow dependency
- [17-01]: 2-pass HTML stripping in clean_product_text — strip, unescape, strip again (handles entity-encoded tags)
- [17-01]: Image download failure is non-fatal in sync task — products already upserted even if images fail
- [17-01]: Concurrent sync prevention: 409 Conflict if feed sync_status='syncing' when POST /sync called
- [v5 roadmap]: lxml iterparse with element clearing required for 10k-product feed (no full-tree load)
- [v5 roadmap]: Ken Burns (zoompan) performance benchmark required in Phase 18 before batch is built
- [v5 roadmap]: Single product E2E (Phase 20) must be validated before batch (Phase 21) is started
- [v5 roadmap]: Edge TTS is the default for batch; ElevenLabs reserved for elaborate mode with explicit opt-in
- [18-01]: zoompan benchmark on WSL dev machine (Ubuntu 24.04, Intel x86-64): simple_scale=6.5s, zoompan=14.7s, 2.3x slowdown for 30s portrait video at 1080x1920. Decision: zoompan IS viable for batch — 2.3x is far below the 18x concern threshold. Phase 21 batch WILL use zoompan by default; simple-scale kept as `use_zoompan=False` fallback option only.
- [Phase 18-01]: zoompan benchmark: 2.3x slowdown (6.5s vs 14.7s for 30s video) — batch will use zoompan by default in Phase 21
- [Phase 18-02]: filter_complex used only when is_on_sale=True (badge needs second input); -vf for regular products
- [Phase 18-02]: Sale price in yellow; original in muted gray (y=1720) — no strikethrough per research recommendation
- [Phase 18-02]: Badge cached at config.output_dir — skipped if exists, safe for batch

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending (pre-v5):**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor

**v5 Phase 18 risk — RESOLVED (18-01):**
- zoompan benchmark completed: 6.5s simple-scale vs 14.7s zoompan for 30s portrait video (2.3x slowdown). Risk resolved — zoompan is viable for batch. Phase 21 will use zoompan by default.

**v5 Phase 21 design requirement:**
- Per-product state model (BatchJob/ProductJobState) has no direct precedent in existing codebase — must be designed before any render loop code is written in Phase 21-01

## Session Continuity

Last session: 2026-02-20
Stopped at: Completed 18-02-PLAN.md — text overlays, sale badge, CTA, filter_complex path for on-sale products
Resume file: None

**Next step:** Execute Phase 18, Plan 03 (API endpoint for product video composition)

---
*Last updated: 2026-02-20 after Phase 18-02 complete (text overlays, sale badge, CTA done; all COMP requirements met)*
