# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v5 Product Video Generator — Phase 19: Product Browser

## Current Position

Milestone: v5 Product Video Generator
Phase: 19 of 22 (Product Browser) — complete
Plan: 2 of 2 in Phase 19
Status: Phase 19 complete — product browser backend + frontend delivered (FEED-02 through FEED-06)
Last activity: 2026-02-21 — Phase 19 plan 02 executed (products page frontend)

Progress: [███░░░░░░░] 30% (v5) — 4 milestones shipped prior, phase 19 complete

## Performance Metrics

**Velocity:**
- Total plans completed: 55 (50 prior + 2 phase 17 + 2 phase 18 + 1 phase 19)
- Total phases completed: 18 (phase 19 in progress)
- Total execution time: ~2.7 hours (v2) + ~2 days (v3) + ~47 min (v4)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 6 (17-22) | TBD | In progress |
| v5 P19 plan 01 (product-browser backend) | 8min | 1 task | 3 files |
| v5 P19 plan 02 (product-browser frontend) | 5min | 1 task | 4 files |

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
- [v5 roadmap]: Single product E2E (Phase 20) must be validated before batch (Phase 21) is started
- [v5 roadmap]: Edge TTS is the default for batch; ElevenLabs reserved for elaborate mode with explicit opt-in
- [18-01]: zoompan benchmark on WSL dev machine: simple_scale=6.5s, zoompan=14.7s, 2.3x slowdown for 30s portrait video. Decision: zoompan IS viable for batch — Phase 21 will use zoompan by default; simple-scale kept as fallback.
- [18-02]: filter_complex used only when is_on_sale=True (badge needs second input); -vf for regular products
- [18-02]: Sale price in yellow; original in muted gray — no strikethrough per research recommendation
- [18-02]: Badge cached at config.output_dir — skipped if exists, safe for batch
- [Phase 19-01]: product_routes.py as separate router (not feed_routes.py inline) for clean separation of feed CRUD/sync vs product listing
- [Phase 19-01]: Filtered total uses count='exact' Supabase query; unfiltered uses stored product_count to avoid unnecessary DB round-trips
- [Phase 19-02]: Plain img tag with onError fallback used for product images — avoids Next.js Image allowlist issues with multiple CDN domains
- [Phase 19-02]: Filter state resets on feed change to prevent stale category/brand values carrying over between feeds

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending (pre-v5):**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor

**v5 Phase 18 risk — RESOLVED (18-01):**
- zoompan benchmark completed: 2.3x slowdown. Zoompan is viable for batch.

**v5 Phase 21 design requirement:**
- Per-product state model (BatchJob/ProductJobState) has no direct precedent in existing codebase — must be designed before any render loop code is written in Phase 21-01

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 19-02-PLAN.md (product browser frontend) — Phase 19 complete
Resume file: None

**Next step:** Execute Phase 20 (single-product video generation)

---
*Last updated: 2026-02-21 after Phase 19 plan 02 complete — Phase 19 done*
