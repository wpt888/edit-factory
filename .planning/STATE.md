# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-04)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 7 - Platform Export Presets (v3 milestone start)

## Current Position

Phase: 7 of 11 (Platform Export Presets)
Plan: 3 of 3 in current phase
Status: Phase complete
Last activity: 2026-02-04 — Completed 07-03-PLAN.md

Progress: [██████████████░░░░░░] 70% (26/37 total plans across all milestones)

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
- Last 5 plans: 05-04 (3m), 05-05 (verify), 06-01 (4m), 07-01 (3m), 07-02 (6m)
- Trend: Stable (3-6 minute execution for straightforward plans)

**v3 milestone progress:**
- 07-01: 3 min (encoding presets service)
- 07-02: 6 min (render pipeline integration)
- 07-03: 5 min (platform selector UI)

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

**v3 milestone decisions:**
- -14 LUFS for audio normalization (social media platform standard: YouTube, Instagram, TikTok)
- Platform presets over manual encoding (users shouldn't configure technical settings)
- hqdn3d over nlmeans for denoising (nlmeans is 10-30x slower, hqdn3d sufficient for social video)
- CRF 18 for Reels/YouTube Shorts, CRF 20 for TikTok/Generic (quality vs file size tradeoff per platform)
- 60-frame GOP size for 2-second keyframe intervals (seek accuracy and platform compatibility)
- Database preset names map to platform keys via lookup dictionary (TikTok -> tiktok, Instagram Reels -> reels)
- Preserve database audio_bitrate override if higher than EncodingPreset default (quality preference)
- Platform selector positioned above render buttons for visibility (07-03)
- Show platform icons for visual recognition (Instagram, YouTube, Video/Film icons) (07-03)

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
- Phase 9 (Video Enhancement Filters): Filter parameter tuning needs empirical testing on diverse content (hqdn3d 1.5-3, unsharp 0.3-0.6 ranges require validation)
- Phase 10 (Segment Scoring): Scoring algorithm weights need A/B testing with platform performance data (proposed 40/20/20/15/5 split unvalidated)

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 07-03-PLAN.md (Phase 07 complete)
Resume file: None

**Next step:** Run `/gsd:plan-phase 8` to begin Audio Normalization phase

**v3 Milestone Summary:**
- Total phases: 5 (Phases 7-11)
- Total requirements: 15
- Coverage: 100%
- Phase 7: Platform Export Presets (ENC-01 to ENC-04)
- Phase 8: Audio Normalization (AUD-01 to AUD-02)
- Phase 9: Video Enhancement Filters (FLT-01 to FLT-04)
- Phase 10: Segment Scoring Enhancement (SCR-01 to SCR-02)
- Phase 11: Subtitle Enhancement (SUB-01 to SUB-03)
