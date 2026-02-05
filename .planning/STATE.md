# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 11 - Subtitle Enhancement (in progress)

## Current Position

Phase: 11 of 11 (Subtitle Enhancement) — COMPLETE
Plan: 3/3 complete
Status: Phase complete
Last activity: 2026-02-05 — Completed 11-03-PLAN.md (frontend controls)

Progress: [████████████████████] 100% (38/38 total plans across all milestones)

## Performance Metrics

**Velocity (v2 completed):**
- Total plans completed: 23 (21 from v2 + 2 verification plans)
- Average duration: 6.3 min per plan
- Total execution time: 2.7 hours

**By Phase (v2 only):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 8 | 35 min | 4.4 min |
| 05-per-profile-postiz | 5 | 16 min | 3.2 min |
| 06-developer-experience | 1 | 4 min | 4 min |

**Recent Trend:**
- Last 5 plans: 09-01 (2m), 09-02 (2m), 09-03 (3m), 09-verify, 10-01 (3m)
- Trend: Stable (2-3 minute execution for straightforward plans)

**v3 milestone progress:**
- 07-01: 3 min (encoding presets service)
- 07-02: 6 min (render pipeline integration)
- 07-03: 5 min (platform selector UI)
- 08-01: 3 min (audio normalization foundation)
- 08-02: 5 min (render integration with two-pass loudnorm)
- 09-01: 2 min (video filter configuration service)
- 09-02: 2 min (render endpoint filter integration)
- 09-03: 3 min (filter UI component + library integration)
- 10-01: 3 min (blur/contrast scoring for segment analysis)
- 11-01: 2 min (subtitle styling service with shadow/glow/adaptive sizing)
- 11-02: 2 min (render pipeline integration with subtitle enhancement params)
- 11-03: 3 min (frontend subtitle enhancement controls) ✓ COMPLETE

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

**v3 milestone decisions:**
- -14 LUFS for audio normalization (social media platform standard: YouTube, Instagram, TikTok)
- Two-pass loudnorm workflow for precise gain adjustment (08-01: measure first, apply linear normalization second)
- -1.5 dBTP true peak limit to prevent clipping (08-01)
- 7.0 LU loudness range for dynamic compression (08-01)
- Normalization only applies to real audio, skips silent audio/anullsrc (08-02: avoids wasted processing)
- Audio filters positioned between video filters and encoding params in FFmpeg command (08-02: proper command structure)
- Graceful degradation on normalization failure (08-02: render continues without normalization rather than failing)
- Platform presets over manual encoding (users shouldn't configure technical settings)
- hqdn3d over nlmeans for denoising (nlmeans is 10-30x slower, hqdn3d sufficient for social video)
- CRF 18 for Reels/YouTube Shorts, CRF 20 for TikTok/Generic (quality vs file size tradeoff per platform)
- 60-frame GOP size for 2-second keyframe intervals (seek accuracy and platform compatibility)
- Database preset names map to platform keys via lookup dictionary (TikTok -> tiktok, Instagram Reels -> reels)
- Preserve database audio_bitrate override if higher than EncodingPreset default (quality preference)
- Platform selector positioned above render buttons for visibility (07-03)
- Show platform icons for visual recognition (Instagram, YouTube, Video/Film icons) (07-03)
- stdlib dataclass over Pydantic for filter configs (09-01: simpler, no validation overhead for nested configs)
- chroma_amount locked at 0.0 in SharpenConfig (09-01: never sharpen chroma to prevent color artifacts)
- Conservative filter defaults: hqdn3d luma_spatial=2.0, unsharp luma_amount=0.5 (09-01: lower than FFmpeg defaults)
- Filter parameters passed per-render (not stored in database) (09-02: flexibility for A/B testing)
- Filter order locked: denoise -> sharpen -> color (09-02: prevent sharpening noise)
- Sliders only visible when checkbox enabled (09-03: reduces visual clutter)
- Conservative slider ranges to prevent over-processing (09-03)
- Filter controls positioned above platform selector in export panel (09-03)
- Laplacian variance for blur detection (10-01: industry standard, single-pass, fast)
- Sample 3 frames for blur/contrast scoring (10-01: <5% overhead, sufficient statistical sample)
- Conservative blur threshold 0.2 (10-01: rejects only severely blurry segments, Laplacian variance < 100)
- Contrast normalization at std dev 80 (10-01: maps well-contrasted scenes to 0.6-1.0)
- 5-factor scoring weights 40/20/20/15/5 (10-01: motion/variance/blur/contrast/brightness, no single factor dominates)
- Subtitle enhancement params passed per-render as Form fields (11-02: consistent with Phase 9 filter approach, not stored in DB)
- Boolean subtitle params use string parsing pattern (11-02: enable_glow/adaptive_sizing as strings, same as enable_denoise)
- Inject enhancement settings into subtitle_settings dict before render (11-02: allows build_subtitle_filter to receive complete settings)
- Subtitle enhancement controls follow checkbox+slider pattern (11-03: Shadow depth 1-4px, Glow blur 1-10, Auto-size checkbox)
- Position subtitle controls between subtitle tabs and video enhancement (11-03: logical flow from text → subtitle → video → platform)

**v2 milestone context (for reference):**
- Profile system over separate deployments (two stores share same codebase)
- Edge TTS as primary free option (already integrated, zero cost, decent quality)
- Browser + start script over desktop app (constant upgrades need zero build overhead)

### Pending Todos

None yet.

### Blockers/Concerns

**Database migration pending:**
- Migration 007 created but requires manual application
- Supabase Python client doesn't support raw SQL execution
- User must run SQL via Supabase SQL Editor or CLI (supabase db push)
- Until applied, database presets lack gop_size/keyint_min columns
- Application will work (falls back to EncodingPreset hardcoded values) but won't store keyframe params in DB

**Research flags for planning:**
- Phase 10 (Segment Scoring): Scoring algorithm weights (40/20/20/15/5) need A/B testing with platform performance data to validate effectiveness vs 3-factor baseline

## Session Continuity

Last session: 2026-02-05
Stopped at: Completed 11-03-PLAN.md (Frontend Controls)
Resume file: None

**Status:** v3 milestone COMPLETE - All planned features delivered.

**v3 Milestone Summary:**
- Total phases: 5 (Phases 7-11)
- Total plans: 13
- Total requirements: 15
- Coverage: 100%
- Phase 7: Platform Export Presets (ENC-01 to ENC-04) ✓
- Phase 8: Audio Normalization (AUD-01 to AUD-02) ✓
- Phase 9: Video Enhancement Filters (FLT-01 to FLT-04) ✓
- Phase 10: Segment Scoring Enhancement (SCR-01 to SCR-02) ✓
- Phase 11: Subtitle Enhancement (SUB-01 to SUB-03) ✓

**System Capabilities (v3):**
- Platform-specific encoding presets (TikTok, Instagram Reels, YouTube Shorts, Generic)
- Two-pass audio normalization to -14 LUFS with -1.5 dBTP true peak limiting
- Video enhancement filters (denoise with hqdn3d, sharpen with unsharp, color adjustment)
- 5-factor segment scoring (motion 40%, variance 20%, blur 20%, contrast 15%, brightness 5%)
- Subtitle styling (shadow depth 1-4px, glow/outline blur 1-10, adaptive text sizing)

**Production Status:** All features integrated end-to-end with graceful degradation and backward compatibility.
