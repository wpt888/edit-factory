# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-20)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** Phase 23: Feed Creation UI — Gap Closure (FEED-01)

## Current Position

Milestone: Gap Closure
Phase: 23 of 23+ (Feed Creation UI)
Plan: 1 of 1 in Phase 23 — COMPLETE
Status: Phase 23 Plan 01 COMPLETE — CreateFeedDialog component + products page wiring delivered
Last activity: 2026-02-21 — Phase 23 plan 01 executed (CreateFeedDialog, New Feed button, first-time CTA)

Progress: [██████████] 100% (phase 23) — Feed Creation UI gap closed

## Performance Metrics

**Velocity:**
- Total plans completed: 63 (50 prior + 2 phase 17 + 2 phase 18 + 2 phase 19 + 2 phase 20 + 2 phase 21 + 2 phase 22 + 1 phase 23)
- Total phases completed: 23
- Total execution time: ~2.7 hours (v2) + ~2 days (v3) + ~47 min (v4)

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 6 (17-22) | 12 | COMPLETE — 2026-02-21 |

**Phase 22 metrics:**
| Phase 22 P01 | 6 min | 2 tasks | 4 files |
| Phase 22 P02 | 5 min | 2 tasks | 2 files |

**Phase 23 metrics:**
| Phase 23 P01 | 3 min | 2 tasks | 3 files |

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
- [Phase 20]: Built _build_preset_dict() bridge to convert EncodingPreset to dict format for _render_with_preset compatibility
- [Phase 20]: compose_product_video and _render_with_preset wrapped in run_in_executor for async compatibility
- [Phase 20]: Product data passed as URL query params (not sessionStorage) — simpler, shareable, no hydration issues
- [Phase 20]: useSearchParams wrapped in Suspense boundary — required by Next.js App Router to avoid build errors
- [Phase 21-01]: Sequential batch loop over asyncio.gather — safer on WSL, avoids FFmpeg memory contention
- [Phase 21-01]: BatchGenerateRequest shares settings uniformly across all products — per-product customization explicitly out of scope
- [Phase 21]: Checkbox uses absolute top-2 left-2 z-10 positioning to overlay product image without disrupting card layout
- [Phase 21]: batch_id is in URL params only for navigate-away resilience — no sessionStorage needed
- [Phase 21]: useBatchPolling stops when batchStatus.status === completed (batch-level done signal from backend)
- [Phase 22]: VideoTemplate dataclass with 3 presets — layout/animation/colors as dataclass fields, not DB rows (same proven pattern as service-level config)
- [Phase 22]: Store template colors as CSS hex in DB (#FF0000), convert to FFmpeg 0xRRGGBB only at render time via _hex_to_ffmpeg_color helper
- [22-02]: CTA pre-fill uses functional setState (prev) => prev === default ? profileValue : prev — safe against race conditions with URL params
- [22-02]: Native HTML input[type=color] with Tailwind styling chosen for color pickers — no third-party color picker library needed
- [23-01]: CreateFeedDialog follows exact CreateProfileDialog pattern — no form element, Button onClick, same import set
- [23-01]: handleFeedCreated does optimistic prepend + auto-select before fetchFeeds refresh for snappy UX
- [23-01]: Both Add Your First Feed and New Feed buttons call setCreateFeedOpen(true) — single dialog serves both flows

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending (pre-v5):**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor

**v5 Phase 18 risk — RESOLVED (18-01):**
- zoompan benchmark completed: 2.3x slowdown. Zoompan is viable for batch.

**v5 Phase 21 backend — RESOLVED (21-01):**
- Per-product state model implemented as product_jobs list in batch JSONB record. Sequential loop with except Exception per product.

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 23-01-PLAN.md (CreateFeedDialog + products page wiring, FEED-01 gap closed)
Resume file: None

**Phase 23 COMPLETE.**
FEED-01 gap closed — CreateFeedDialog component + products page wiring delivered.

---
*Last updated: 2026-02-21 after Phase 23 plan 01 complete — CreateFeedDialog, New Feed button, first-time CTA, FEED-01 satisfied*
