# Roadmap: Edit Factory

## Milestones

- **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, in progress)

## Phases

<details>
<summary>v2 Profile System (Phases 1-6) - SHIPPED 2026-02-04</summary>

### Phase 1: Database Foundation
**Goal**: Establish profile-based data isolation at database level with Supabase RLS
**Depends on**: Nothing (first phase)
**Requirements**: PROF-01, PROF-04, PROF-07
**Success Criteria** (what must be TRUE):
  1. Profiles table exists with RLS policies enabled
  2. All existing tables have profile_id foreign key column
  3. Default profile created and all existing data assigned to it
  4. User can query their profile's data via RLS without seeing other profiles
  5. Database queries filtered by profile_id complete in under 50ms (indexed)
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — SQL migrations: profiles table, profile_id columns, data backfill, RLS policy update

### Phase 2: Backend Profile Context
**Goal**: Retrofit API layer and service methods to inject profile context
**Depends on**: Phase 1
**Requirements**: PROF-01, PROF-05
**Success Criteria** (what must be TRUE):
  1. Profile CRUD API endpoints exist (create, read, update, delete profiles)
  2. All library/segments/postiz routes require X-Profile-Id header and validate ownership
  3. JobStorage, CostTracker, PostizPublisher accept profile_id parameter in all methods
  4. Background tasks preserve profile context (no data leakage across profiles)
  5. FFmpeg temp directories scoped by profile_id to prevent file collisions
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
**Success Criteria** (what must be TRUE):
  1. User can create new profile with name and description
  2. User can switch between profiles via dropdown in navbar
  3. Active profile name always visible in navbar
  4. Library page shows only current profile's projects and clips
  5. Last-used profile auto-selected on login (no blank screen)
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — ProfileProvider context + API header injection (foundation)
- [x] 03-02-PLAN.md — ProfileSwitcher dropdown + CreateProfileDialog components
- [x] 03-03-PLAN.md — Layout/Navbar/Library integration + visual verification

### Phase 4: TTS Provider Selection
**Goal**: Integrate free TTS alternatives and provide clear provider choice in UI
**Depends on**: Phase 1 (profile settings table)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04, TTS-05, TTS-06
**Success Criteria** (what must be TRUE):
  1. User can select TTS provider from UI (ElevenLabs, Edge TTS, Coqui XTTS, Kokoro)
  2. Cost displayed inline next to each provider option (e.g., "$0.22" vs "Free")
  3. Coqui XTTS generates audio with voice cloning from 6-second sample
  4. Kokoro TTS generates audio with preset voices
  5. User can save default voice settings per profile (persists across sessions)
  6. Voice cloning workflow allows user to upload sample and create cloned voice
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
**Success Criteria** (what must be TRUE):
  1. User can configure Postiz API credentials per profile (URL + key)
  2. Publishing from Profile A uses Profile A's Postiz account
  3. Publishing from Profile B uses Profile B's Postiz account (no cross-posting)
  4. Cost quota enforcement prevents TTS calls when profile quota exceeded
  5. Profile activity dashboard shows video count and API costs per profile
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
**Success Criteria** (what must be TRUE):
  1. User runs start-dev.bat (Windows) and backend + frontend launch simultaneously
  2. User runs start-dev.sh (WSL/Linux) and backend + frontend launch simultaneously
  3. Start script activates venv automatically
  4. Start script checks port availability and reports conflicts
  5. Browser opens to http://localhost:3000 after services ready
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — Development start scripts for Windows and WSL/Linux

</details>

### v3 Video Quality Enhancement (In Progress)

**Milestone Goal:** Professional-grade video output with platform-optimized encoding, audio normalization, and enhanced visual quality

#### Phase 7: Platform Export Presets
**Goal**: Professional encoding with platform-specific presets for TikTok, Reels, YouTube Shorts
**Depends on**: Nothing (first phase of v3)
**Requirements**: ENC-01, ENC-02, ENC-03, ENC-04
**Success Criteria** (what must be TRUE):
  1. User can select export platform (TikTok, Instagram Reels, YouTube Shorts) before rendering
  2. System applies platform-specific encoding (correct CRF, maxrate, GOP, audio bitrate)
  3. Exported video passes platform validation (no upload rejection for encoding issues)
  4. Audio encoded at 192k bitrate (upgraded from 128k)
  5. Encoding preset configuration is data-driven (new presets can be added without code changes)
**Plans**: 3 plans

Plans:
- [x] 07-01-PLAN.md — Encoding presets service: Pydantic model + platform preset definitions
- [x] 07-02-PLAN.md — Integration: keyframe controls in render pipeline + database preset updates
- [x] 07-03-PLAN.md — Frontend: Platform selector dropdown in library export UI

**Manual UAT Note**: Success criterion 3 (platform validation) requires manual testing by uploading to actual platforms. This is documented in 07-02-PLAN.md.

#### Phase 8: Audio Normalization
**Goal**: Consistent audio loudness at -14 LUFS for social media standards
**Depends on**: Phase 7 (encoding foundation must be in place)
**Requirements**: AUD-01, AUD-02
**Success Criteria** (what must be TRUE):
  1. All exported videos have audio normalized to -14 LUFS (matches Instagram/TikTok/YouTube)
  2. Audio has true peak limiting at -1.5 dBTP (no clipping or distortion)
  3. Two-pass normalization used (analyze, then apply with measured parameters)
  4. Loudness normalization applies to concatenated segments (consistent across multi-variant clips)
  5. User hears consistent volume across different videos (no jarring volume changes)
**Plans**: 2 plans

Plans:
- [ ] 08-01-PLAN.md — Audio normalizer service + EncodingPreset normalization fields
- [ ] 08-02-PLAN.md — Render pipeline integration + visual verification

#### Phase 9: Video Enhancement Filters
**Goal**: Optional quality filters (denoise, sharpen, color correction) for user-generated content
**Depends on**: Phase 7 (filter chain must respect encoding architecture)
**Requirements**: FLT-01, FLT-02, FLT-03, FLT-04
**Success Criteria** (what must be TRUE):
  1. User can enable denoising filter for low-light footage (reduces grain/noise)
  2. User can enable sharpening filter for soft footage (improves clarity without halos)
  3. User can adjust color correction (brightness, contrast, saturation sliders)
  4. Filters applied in correct order (denoise -> sharpen -> color correct) without breaking GPU acceleration
  5. Filter processing adds less than 20% overhead (vs no-filter baseline)
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

#### Phase 10: Segment Scoring Enhancement
**Goal**: Improved segment selection with blur detection and contrast analysis
**Depends on**: Nothing (independent scoring enhancement, can run parallel to Phase 7-9)
**Requirements**: SCR-01, SCR-02
**Success Criteria** (what must be TRUE):
  1. System calculates blur score using Laplacian variance for each segment
  2. Blurry segments penalized in combined scoring (threshold: variance < 100 = reject)
  3. Segment scoring balances motion, variance, blur, contrast, brightness (no single factor dominates)
  4. Selected segments visibly sharper and more aesthetically pleasing than motion-only selection
  5. Scoring runs without significant performance impact (< 5% overhead vs current)
**Plans**: TBD

Plans:
- [ ] 10-01: TBD

#### Phase 11: Subtitle Enhancement
**Goal**: Professional subtitle styling with shadow, glow, and adaptive sizing
**Depends on**: Phase 7 (subtitle rendering must respect encoding pipeline)
**Requirements**: SUB-01, SUB-02, SUB-03
**Success Criteria** (what must be TRUE):
  1. User can enable shadow effects on subtitles with configurable depth (improves visibility)
  2. User can enable glow/outline effects on subtitle text (high-contrast backgrounds)
  3. System automatically adjusts font size based on text length (long text = smaller font)
  4. Subtitles remain readable on all background types (dark, bright, busy)
  5. Subtitle rendering preserves existing CPU-only pattern (no GPU pipeline breakage)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Database Foundation | v2 | 1/1 | Complete | 2026-02-03 |
| 2. Backend Profile Context | v2 | 5/5 | Complete | 2026-02-03 |
| 3. Frontend Profile UI | v2 | 3/3 | Complete | 2026-02-03 |
| 4. TTS Provider Selection | v2 | 8/8 | Complete | 2026-02-04 |
| 5. Per-Profile Postiz | v2 | 5/5 | Complete | 2026-02-04 |
| 6. Developer Experience | v2 | 1/1 | Complete | 2026-02-04 |
| 7. Platform Export Presets | v3 | 3/3 | Complete | 2026-02-04 |
| 8. Audio Normalization | v3 | 0/2 | Not started | - |
| 9. Video Enhancement Filters | v3 | 0/? | Not started | - |
| 10. Segment Scoring Enhancement | v3 | 0/? | Not started | - |
| 11. Subtitle Enhancement | v3 | 0/? | Not started | - |
