# Project Milestones: Edit Factory

## v3 Video Quality Enhancement (Shipped: 2026-02-06)

**Delivered:** Professional-grade video output with platform-optimized encoding, audio normalization, video filters, improved segment scoring, and enhanced subtitle rendering.

**Phases completed:** 7-11 (13 plans total)

**Key accomplishments:**
- Platform-specific export presets for TikTok, Instagram Reels, YouTube Shorts with CRF 18-20 encoding
- Two-pass audio loudness normalization to -14 LUFS with -1.5 dBTP true peak limiting
- Video enhancement filters (hqdn3d denoise, unsharp sharpen, color correction) with checkbox+slider UI
- 5-factor segment scoring with Laplacian blur detection and contrast analysis
- Professional subtitle styling with shadow depth, glow/outline effects, and adaptive font sizing
- 4 new backend services (encoding_presets, audio_normalizer, video_filters, subtitle_styler)

**Stats:**
- 11 files created/modified
- 1,690 lines added (Python + TypeScript)
- 5 phases, 13 plans
- 2 days from start to ship (2026-02-05 to 2026-02-06)

**Git range:** `feat(07-01)` → `docs(11)`

**What's next:** TBD — project feature-complete for current needs

---

## v2 Profile System (Shipped: 2026-02-04)

**Delivered:** Multi-profile workspace system with isolated libraries, 4 TTS providers, per-profile Postiz publishing, and single-command dev scripts.

**Phases completed:** 1-6 (23 plans total)

**Key accomplishments:**
- Profile/workspace system with Supabase RLS isolation
- TTS provider selector (ElevenLabs, Edge TTS, Coqui XTTS, Kokoro)
- Per-profile Postiz social media publishing configuration
- Cost quota enforcement per profile
- Start scripts for Windows and WSL/Linux

**Stats:**
- 6 phases, 23 plans
- 2.7 hours total execution time
- Shipped 2026-02-04

**Git range:** `feat(01-01)` → `docs(06)`

**What's next:** v3 Video Quality Enhancement

---

## v4 Script-First Pipeline (Shipped: 2026-02-12)

**Delivered:** Script-first video production pipeline transforming Edit Factory from video-first to idea-first workflow with AI-generated scripts, ElevenLabs TTS with character-level timestamps, auto-generated subtitles, keyword-matched visuals, and multi-variant generation.

**Phases completed:** 12-16 (11 plans total)

**Key accomplishments:**
- ElevenLabs TTS upgrade to flash v2.5 with 192kbps audio, character-level timestamps, and 50% cost reduction
- TTS-based subtitle generation from timestamps (characters -> words -> phrases -> SRT, no Whisper needed)
- Dual-provider AI script generation (Gemini + Claude Max) with keyword-aware, TTS-safe output
- Script-to-video assembly engine with keyword matching, timeline building, and silence removal
- Multi-variant pipeline: 1 idea -> N unique videos with 4-step workflow (input, scripts, preview, render)
- 3 new frontend pages (Pipeline, Scripts, Assembly) and 9 new API endpoints across 3 routers

**Stats:**
- 47 files modified
- ~9,300 lines added (Python + TypeScript)
- 5 phases, 11 plans, ~14 tasks
- 1 day (2026-02-12)
- 4 new backend services, 3 new pages, 1 DB migration

**Git range:** `feat(12-01)` -> `docs(phase-16)`

**Tech debt:** 9 non-blocking items (in-memory state, no job cancellation, exact keyword matching only)

**What's next:** TBD — `/gsd:new-milestone`

---


## v5 Product Video Generator (Shipped: 2026-02-21)

**Delivered:** Automated product video generation from Google Shopping XML feeds — streaming feed parsing, Ken Burns animation compositor, product browser with filters, single/batch generation with TTS voiceover and synced subtitles, 3 template presets with per-profile customization.

**Phases completed:** 17-23 (7 phases, 13 plans)

**Key accomplishments:**
- Google Shopping XML feed pipeline with streaming lxml parser for 10k products, parallel image downloads, Romanian diacritics textfile= pattern
- Product video compositor with Ken Burns zoompan animation, text overlays (name, price, brand, CTA), sale badge, configurable duration (15-60s)
- Product browser UI with paginated card grid, search, on-sale toggle, category/brand filter dropdowns
- Single product E2E flow: generate button, quick/elaborate TTS voiceover modes, synced subtitles, library output with encoding presets
- Batch generation with multi-select checkboxes, sequential processing with per-product error isolation, per-product progress tracking
- Template system: 3 presets (Product Spotlight, Sale Banner, Collection Showcase) with per-profile color/font/CTA customization
- Feed creation dialog: inline on products page with first-time CTA, closing FEED-01 gap

**Stats:**
- 22 files created/modified (code only)
- +5,028 / -227 lines (Python + TypeScript)
- 7 phases, 13 plans, 30 requirements
- 2 days (2026-02-20 → 2026-02-21)
- 5 new backend services, 3 new frontend pages, 4 DB migrations

**Git range:** `feat(17-02)` → `feat(23-01)`

**Tech debt:**
- TMPL-04: safe_zone_top/safe_zone_bottom fields on VideoTemplate unused — y-positions manually respect safe zones
- Dead code: _finalize_batch 'completed_with_errors' branch unreachable
- Human verification pending: subtitle sync, filter quality, platform upload acceptance

**What's next:** TBD — `/gsd:new-milestone`

---


## v6 Production Hardening (Shipped: 2026-02-22)

**Delivered:** Production-hardened Edit Factory with backend stability fixes, rate limiting, frontend resilience, component refactoring, unit tests, structured logging, and consistent error handling across all pages.

**Phases completed:** 24-31 (8 phases, 16 plans)

**Key accomplishments:**
- Backend stability: generation progress persists to Supabase (survives restart), project lock lifecycle fixed, upload size validation, async ElevenLabs TTS client
- Rate limiting & security: slowapi middleware (60 req/min), XSS prevention in SRT preview, Cache-Control headers, tenacity retry on ElevenLabs/Gemini
- Frontend resilience: global React ErrorBoundary with fallback UI, centralized API client with timeout/retry (apiGetWithRetry), shared usePolling hook, empty states on all pages
- Frontend refactoring: library/page.tsx split into ClipGallery, ClipEditorPanel, PostizPublishModal, SegmentSelectionModal, ClipStatusPoller
- Code quality: single get_supabase() in db.py used everywhere, debug log noise eliminated, validate_tts_text_length() helper across all TTS routes
- Testing & observability: pytest harness with conftest fixtures, unit tests for job_storage/cost_tracker/srt_validator, structured JSON logging (python-json-logger), data retention cleanup CLI
- Consistent error handling: handleApiError() in every frontend catch block, zero console.error/alert patterns, apiGetWithRetry for all data-fetch GETs, apiFetch in usePolling

**Stats:**
- 109 files modified
- +11,331 / -3,400 lines (Python + TypeScript)
- 8 phases, 16 plans, 47 commits
- 1 day (2026-02-22)
- 25/25 v6 requirements satisfied

**Git range:** `feat(24-01)` → `docs(31-02)`

**Tech debt resolved:**
- Memory leak in project locks (cleanup never called) — fixed
- In-memory generation progress (lost on restart) — persisted to DB
- Scattered Supabase client initialization — centralized in db.py
- Mixed error handling patterns (toast/alert/silence) — unified via handleApiError + sonner toasts
- No tests — pytest harness with unit test suite

**What's next:** TBD — `/gsd:new-milestone`

---

