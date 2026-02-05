# Roadmap: Edit Factory

## Milestones

- **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)

## Phases

<details>
<summary>v2 Profile System (Phases 1-6) - SHIPPED 2026-02-04</summary>

### Phase 1: Database Foundation
**Goal**: Establish profile-based data isolation at database level with Supabase RLS
**Depends on**: Nothing (first phase)
**Requirements**: PROF-01, PROF-04, PROF-07
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — SQL migrations: profiles table, profile_id columns, data backfill, RLS policy update

### Phase 2: Backend Profile Context
**Goal**: Retrofit API layer and service methods to inject profile context
**Depends on**: Phase 1
**Requirements**: PROF-01, PROF-05
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — Profile CRUD API + get_profile_context auth dependency
- [x] 02-02-PLAN.md — Service layer updates (JobStorage, CostTracker, PostizPublisher)
- [x] 02-03-PLAN.md — library_routes.py profile context injection
- [x] 02-04-PLAN.md — segments/postiz/main routes profile context injection
- [x] 02-05-PLAN.md — FFmpeg temp directory profile scoping

### Phase 3: Frontend Profile UI
**Goal**: Enable users to create, switch, and manage profiles from UI
**Depends on**: Phase 2
**Requirements**: PROF-02, PROF-03, PROF-06
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — ProfileProvider context + API header injection (foundation)
- [x] 03-02-PLAN.md — ProfileSwitcher dropdown + CreateProfileDialog components
- [x] 03-03-PLAN.md — Layout/Navbar/Library integration + visual verification

### Phase 4: TTS Provider Selection
**Goal**: Integrate free TTS alternatives and provide clear provider choice in UI
**Depends on**: Phase 1 (profile settings table)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04, TTS-05, TTS-06
**Plans**: 8 plans

Plans:
- [x] 04-01-PLAN.md — TTS foundation: database migration + service abstraction layer
- [x] 04-02-PLAN.md — Refactor ElevenLabs and Edge TTS to new interface
- [x] 04-03-PLAN.md — Coqui XTTS integration with voice cloning
- [x] 04-04-PLAN.md — Kokoro TTS integration with preset voices
- [x] 04-05-PLAN.md — TTS API routes (/providers, /voices, /generate, /clone-voice)
- [x] 04-06-PLAN.md — Frontend TTS UI: provider selector, voice cloning, settings page
- [x] 04-07-PLAN.md — Visual verification checkpoint
- [x] 04-08-PLAN.md — Gap closure: Fix 6 API bugs blocking goal achievement

### Phase 5: Per-Profile Postiz
**Goal**: Enable separate publishing configuration per store profile
**Depends on**: Phase 2, Phase 3
**Requirements**: PROF-05
**Plans**: 5 plans

Plans:
- [x] 05-01-PLAN.md — Backend: Profile-aware Postiz service factory with cache invalidation
- [x] 05-02-PLAN.md — Frontend: Postiz configuration section in Settings page
- [x] 05-03-PLAN.md — Backend: Quota enforcement and profile dashboard API
- [x] 05-04-PLAN.md — Frontend: Profile activity dashboard and quota configuration
- [x] 05-05-PLAN.md — Visual verification checkpoint

### Phase 6: Developer Experience
**Goal**: Single-command launch script for backend + frontend + browser
**Depends on**: Nothing (independent of profile system)
**Requirements**: DX-01, DX-02
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — Development start scripts for Windows and WSL/Linux

</details>

<details>
<summary>v3 Video Quality Enhancement (Phases 7-11) - SHIPPED 2026-02-06</summary>

### Phase 7: Platform Export Presets
**Goal**: Professional encoding with platform-specific presets for TikTok, Reels, YouTube Shorts
**Plans**: 3 plans — Complete 2026-02-04

### Phase 8: Audio Normalization
**Goal**: Consistent audio loudness at -14 LUFS for social media standards
**Plans**: 2 plans — Complete 2026-02-05

### Phase 9: Video Enhancement Filters
**Goal**: Optional quality filters (denoise, sharpen, color correction) for user-generated content
**Plans**: 3 plans — Complete 2026-02-05

### Phase 10: Segment Scoring Enhancement
**Goal**: Improved segment selection with blur detection and contrast analysis
**Plans**: 1 plan — Complete 2026-02-05

### Phase 11: Subtitle Enhancement
**Goal**: Professional subtitle styling with shadow, glow, and adaptive sizing
**Plans**: 3 plans — Complete 2026-02-06

Full details: `.planning/milestones/v3-ROADMAP.md`

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Database Foundation | v2 | 1/1 | Complete | 2026-02-03 |
| 2. Backend Profile Context | v2 | 5/5 | Complete | 2026-02-03 |
| 3. Frontend Profile UI | v2 | 3/3 | Complete | 2026-02-03 |
| 4. TTS Provider Selection | v2 | 8/8 | Complete | 2026-02-04 |
| 5. Per-Profile Postiz | v2 | 5/5 | Complete | 2026-02-04 |
| 6. Developer Experience | v2 | 1/1 | Complete | 2026-02-04 |
| 7. Platform Export Presets | v3 | 3/3 | Complete | 2026-02-04 |
| 8. Audio Normalization | v3 | 2/2 | Complete | 2026-02-05 |
| 9. Video Enhancement Filters | v3 | 3/3 | Complete | 2026-02-05 |
| 10. Segment Scoring Enhancement | v3 | 1/1 | Complete | 2026-02-05 |
| 11. Subtitle Enhancement | v3 | 3/3 | Complete | 2026-02-06 |
