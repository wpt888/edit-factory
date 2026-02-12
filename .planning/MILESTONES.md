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

