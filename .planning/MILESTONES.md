# Project Milestones: Edit Factory
## v12 Desktop Product MVP (Shipped: 2026-03-09)

**Delivered:** Local-first desktop product with SQLite data layer replacing Supabase, encrypted API key vault for user-owned ElevenLabs/Gemini keys, simplified 3-step pipeline for non-technical users, Lemon Squeezy license validation with offline grace period, full auth flow (JWT injection, logout, password reset, route protection), Electron polish with macOS target, and complete English-only UI.

**Phases completed:** 64-79 (16 phases, 29 plans)

**Key accomplishments:**
- Repository pattern abstraction (106 methods) with SQLite + Supabase backends, activated in Electron desktop mode
- Encrypted API key vault (Fernet + machine-specific derivation) for local-first ElevenLabs/Gemini integration with Edge TTS fallback
- Simplified 3-step pipeline (Upload → Choose Style → Download) with 5 style presets and batch upload queue
- Auth flow: JWT token injection, logout button, forgot password, Next.js middleware route protection, Lemon Squeezy periodic revalidation with 72h offline grace
- Electron polish: real publish config, macOS dmg target, icon generation (ICO + ICNS), slim installer strategy, auto-updater
- Brand unification ("Edit Factory" everywhere) and complete Romanian→English cleanup across frontend and backend
- 6 caption visual presets, setup wizard with Free TTS preset and inline API key validation

**Stats:**
- 16 phases, 29 plans, 102 commits
- 28/28 v12 requirements satisfied
- 1 day (2026-03-09)

**Git range:** `feat(64-01)` → `docs(phase-79)`

**Tech debt carried forward:**
- 60 routes still use get_client() escape hatch (returns None in SQLite mode) — core CRUD migrated, advanced operations (render, segments, tags, trash) still need migration
- Gemini singleton refresh not called after API key save (requires backend restart)
- ~12 Romanian docstrings remain in backend Python files (non-user-visible)

**What's next:** TBD — `/gsd:new-milestone`

---


## v10 Desktop Launcher & Distribution (Shipped: 2026-03-01)

**Delivered:** Desktop product with Electron shell launcher, NSIS Windows installer bundling Python venv + FFmpeg + Node.js, first-run setup wizard, auto-update via electron-updater, Sentry crash reporting (opt-in), Lemon Squeezy license validation, and desktop mode config (%APPDATA%).

**Phases completed:** 47-54 (8 phases, 12 plans)

**Key accomplishments:**
- Electron shell launcher with system tray, backend health polling, graceful shutdown
- NSIS installer with 5 extraResources bundles (Python venv, FFmpeg, Node, Next.js standalone, frontend)
- Setup wizard with 3-step flow (Supabase, API keys, completion) and edit mode
- electron-updater with autoDownload + user-controlled install (Restart Now / Later)
- Sentry crash reporting with privacy-safe opt-in toggle and runtime enable/disable
- Lemon Squeezy license validation with 72-hour grace period for network errors
- Desktop mode foundation: APP_BASE_DIR, settings priority chain, desktop API routes

**Stats:**
- 8 phases, 12 plans
- 1 day (2026-03-01)
- 29/29 v10 requirements satisfied

**Git range:** `feat(47-01)` → `docs(phase-54)`

**What's next:** v11 Production Polish & Platform Hardening

---

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


## v7 Product Image Overlays (Shipped: 2026-02-24, partial)

**Delivered:** Product-to-segment association system with CRUD API, reusable picker dialogs, page integration on Segments and Pipeline pages, and PiP overlay configuration UI. Phases 36-37 (interstitial slides + render integration) deferred.

**Phases completed:** 32-35 (4/6 phases, 7 plans)

**Key accomplishments:**
- Segment-product association data layer with cross-schema SECURITY DEFINER functions, RLS, and batch CRUD API
- Reusable ProductPickerDialog and ImagePickerDialog Shadcn components with search, filter, and image toggle
- Product association controls wired into both Segments page and Pipeline page Step 3
- PiP overlay config UI (enable, position, size, animation) with PATCH endpoint and per-segment persistence

**Stats:**
- 4 phases, 7 plans
- 1 day (2026-02-23)
- 1 DB migration, 1 new router, 2 new components

**Git range:** `feat(32-01)` → `docs(35-02)`

### Known Gaps
- SLID-01: Interstitial product slides not implemented (Phase 36 deferred)
- SLID-02: Interstitial duration config not implemented (Phase 36 deferred)
- SLID-03: Ken Burns animation on interstitials not implemented (Phase 36 deferred)
- REND-01: PiP overlay rendering not implemented (Phase 37 deferred)
- REND-02: Interstitial slide rendering not implemented (Phase 37 deferred)
- REND-03: Product image animation in render not implemented (Phase 37 deferred)

**What's next:** Resume phases 36-37 in a future milestone

---


## v8 Pipeline UX Overhaul (Shipped: 2026-02-24)

**Delivered:** Complete pipeline UX overhaul — Step 4 render flicker fixed with library save, source video selection with segment counts, inline video preview player, visual timeline editor with drag/drop segment reorder and swap, duration adjustment, and match overrides render integration.

**Phases completed:** 38-42 (5 phases, 8 plans)

**Key accomplishments:**
- Step 4 render flicker eliminated via optimistic UI state; pipeline clips auto-saved to library
- Source video picker in Step 2 with segment counts, DB persistence, and scoped segment matching
- Inline HTML5 video preview player with FFmpeg-generated poster thumbnails on Step 4 cards
- Visual timeline editor: phrase-to-segment mapping, color-coded match status, manual segment assignment
- Drag/drop segment reorder and hover-reveal swap button using HTML5 native Drag API
- Duration adjustment controls (+/- buttons) with full match_overrides wired through render pipeline
- Gap closure: available_segments field added to PipelinePreviewResponse (TIME-03/TIME-04 fix)

**Stats:**
- 5 phases, 8 plans
- 1 day (2026-02-24)
- 13/13 v8 requirements satisfied
- 1 DB migration, 1 new component (TimelineEditor)

**Git range:** `feat(38-01)` → `docs(phase-42)`

**What's next:** TBD — `/gsd:new-milestone`

---


## v9 Assembly Pipeline Fix + Overlays (Shipped: 2026-02-28)

**Delivered:** Fixed critical assembly pipeline bugs (segment repetition, missing subtitles) and completed deferred v7 overlay rendering — interstitial product slides and PiP overlays rendered into final video via FFmpeg with Ken Burns animation.

**Phases completed:** 43-46 (4 phases, 6 plans, 12 tasks)

**Key accomplishments:**
- Diversity-preserving merge in assembly pipeline — all N segments used before any repetition, with overlapping-time-range adjacency prevention
- SRT content persistence in tts_previews cache — Step 3 render reuses Step 2 subtitles without redundant ElevenLabs API calls
- Minimum 100ms SRT duration floor + 0.5s video timeline safety margin — no invisible subtitles or cutoff at video end
- Interstitial slide controls — users can insert configurable product image slides between timeline segments with Ken Burns animation toggle
- Overlay FFmpeg render service — PiP overlays and interstitial slides rendered into final video with graceful degradation on failure
- Completes deferred v7 phases 36-37 (interstitial slides + render integration)

**Stats:**
- 25 files modified
- +3,969 / -123 lines (Python + TypeScript)
- 4 phases, 6 plans, 12 tasks, 25 commits
- 1 day (2026-02-28)
- 13/13 v9 requirements satisfied
- 1 new backend service (overlay_renderer.py)

**Git range:** `fix(43-01)` → `docs(phase-46)`

**Tech debt:**
- Dead code: pipeline_routes.py lines 1343-1351 (Phase 45 stub superseded by Phase 46)
- Type annotation mismatches in overlay_renderer.py (runtime-safe)
- Human visual verification deferred for PiP overlay positioning, interstitial insertion, and Ken Burns animation quality

**What's next:** TBD — `/gsd:new-milestone`

---

