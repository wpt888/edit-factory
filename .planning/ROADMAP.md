# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- 🚧 **v4 Script-First Pipeline** - Phases 12-16 (in progress)

## Phases

<details>
<summary>✅ v2 Profile System (Phases 1-6) - SHIPPED 2026-02-04</summary>

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
<summary>✅ v3 Video Quality Enhancement (Phases 7-11) - SHIPPED 2026-02-06</summary>

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

## 🚧 v4 Script-First Pipeline (In Progress)

**Milestone Goal:** Transform Edit Factory from video-first to script-first production with AI-generated scripts, ElevenLabs TTS with character-level timestamps, TTS-based subtitles, keyword-based segment matching, and multi-variant video generation from a single idea.

### Phase 12: ElevenLabs TTS Upgrade
**Goal**: Integrate ElevenLabs flash v2.5 with character-level timestamps and 192kbps audio quality
**Depends on**: Nothing (foundation for v4)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04
**Success Criteria** (what must be TRUE):
  1. System generates TTS audio using eleven_flash_v2_5 model at 192kbps quality
  2. Character-level timestamps are retrieved from ElevenLabs /with-timestamps endpoint
  3. User can select between ElevenLabs models (flash v2.5, v3, multilingual v2) per render
  4. TTS timestamp data is persisted and available for downstream subtitle generation
**Plans**: TBD

Plans:
- [ ] 12-01: TBD

### Phase 13: TTS-Based Subtitles
**Goal**: Generate SRT subtitles from ElevenLabs character timestamps without Whisper
**Depends on**: Phase 12 (requires TTS timestamps)
**Requirements**: SUB-01, SUB-02, SUB-03
**Success Criteria** (what must be TRUE):
  1. System generates SRT subtitle files from ElevenLabs character-level timestamps
  2. Character timestamps are grouped into word-level and phrase-level subtitle entries with natural timing
  3. Generated subtitles use existing v3 styling (shadow, glow, adaptive sizing) without modification
  4. Subtitle sync is visually perfect when tested with generated TTS audio
**Plans**: TBD

Plans:
- [ ] 13-01: TBD

### Phase 14: AI Script Generation
**Goal**: Generate multiple TTS-ready script variants from user idea and product context
**Depends on**: Nothing (independent feature, uses existing segment keyword system)
**Requirements**: SCRIPT-01, SCRIPT-02, SCRIPT-03, SCRIPT-04, SCRIPT-05
**Success Criteria** (what must be TRUE):
  1. User provides idea/context and receives N script variants (1-10) generated by AI
  2. AI receives available segment keywords and writes keyword-aware scripts for matching
  3. Generated scripts follow TTS-safe template (plain text, proper punctuation, no emojis/stage directions)
  4. User can choose between Gemini and Claude Max as AI provider per generation request
  5. User can review and edit generated scripts before proceeding to TTS generation
**Plans**: TBD

Plans:
- [ ] 14-01: TBD

### Phase 15: Script-to-Video Assembly
**Goal**: Match subtitle keywords to video segments and assemble final videos with TTS audio
**Depends on**: Phase 12 (TTS timestamps), Phase 13 (TTS-based subtitles), Phase 14 (scripts)
**Requirements**: ASM-01, ASM-02, ASM-03, ASM-04
**Success Criteria** (what must be TRUE):
  1. System matches subtitle keywords against segment library keywords and selects relevant video segments
  2. Selected segments are arranged on timeline to match voiceover timing and subtitle cues
  3. Final video is rendered with matched segments, TTS audio, and subtitles using existing v3 quality settings
  4. Silence removal is applied to TTS audio before assembly using existing functionality
  5. User can preview segment matching results before final render
**Plans**: TBD

Plans:
- [ ] 15-01: TBD

### Phase 16: Multi-Variant Pipeline
**Goal**: Orchestrate end-to-end script-to-video pipeline for N variants from single idea
**Depends on**: Phase 14 (script generation), Phase 15 (assembly)
**Requirements**: PIPE-01, PIPE-02, PIPE-03
**Success Criteria** (what must be TRUE):
  1. User requests N variants (1-10) from a single idea/context input
  2. Each variant gets a unique AI-generated script, unique TTS voiceover, and unique segment arrangement
  3. User can preview all variants (script + thumbnail) before triggering final renders
  4. Multi-variant generation completes with job progress tracking for all N videos
**Plans**: TBD

Plans:
- [ ] 16-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 12 → 13 → 14 → 15 → 16

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
| 12. ElevenLabs TTS Upgrade | v4 | 0/0 | Not started | - |
| 13. TTS-Based Subtitles | v4 | 0/0 | Not started | - |
| 14. AI Script Generation | v4 | 0/0 | Not started | - |
| 15. Script-to-Video Assembly | v4 | 0/0 | Not started | - |
| 16. Multi-Variant Pipeline | v4 | 0/0 | Not started | - |

---
*Last updated: 2026-02-12 after v4 roadmap creation*
