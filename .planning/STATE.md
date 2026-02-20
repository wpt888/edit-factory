# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** v5 Product Video Generator — Phase 17: Feed Foundation

## Current Position

Milestone: v5 Product Video Generator
Phase: 17 of 22 (Feed Foundation)
Plan: 2 of 2 in Phase 17
Status: Phase 17 complete
Last activity: 2026-02-20 — Phase 17-02 complete: image_fetcher + textfile_helper services built

Progress: [█░░░░░░░░░] 8% (v5) — 4 milestones shipped prior

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

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [17-02]: textfile= (not text=) is canonical for all product text in FFmpeg — prevents diacritic corruption
- [17-02]: Semaphore(5) concurrency cap for parallel image downloads (tunable via CONCURRENT_DOWNLOADS)
- [17-02]: Gray placeholder via FFmpeg lavfi on download failure — no Pillow dependency
- [v5 roadmap]: lxml iterparse with element clearing required for 10k-product feed (no full-tree load)
- [v5 roadmap]: Ken Burns (zoompan) performance benchmark required in Phase 18 before batch is built
- [v5 roadmap]: Single product E2E (Phase 20) must be validated before batch (Phase 21) is started
- [v5 roadmap]: Edge TTS is the default for batch; ElevenLabs reserved for elaborate mode with explicit opt-in

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending (pre-v5):**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor

**v5 Phase 18 risk:**
- zoompan Ken Burns is 10-100x slower than regular encoding — benchmark required in Phase 18-01 before batch is built; may need simple-scale fallback for batch default

**v5 Phase 21 design requirement:**
- Per-product state model (BatchJob/ProductJobState) has no direct precedent in existing codebase — must be designed before any render loop code is written in Phase 21-01

## Session Continuity

Last session: 2026-02-20
Stopped at: Completed 17-02-PLAN.md — image_fetcher.py + textfile_helper.py delivered; Phase 17 complete
Resume file: None

**Next step:** `/gsd:plan-phase 18`

---
*Last updated: 2026-02-20 after Phase 17-02 complete*
