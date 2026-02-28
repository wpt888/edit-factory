# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- ✅ **v4 Script-First Pipeline** - Phases 12-16 (shipped 2026-02-12)
- ✅ **v5 Product Video Generator** - Phases 17-23 (shipped 2026-02-21)
- ✅ **v6 Production Hardening** - Phases 24-31 (shipped 2026-02-22)
- ✅ **v7 Product Image Overlays** - Phases 32-35 (partial, shipped 2026-02-24, phases 36-37 deferred)
- ✅ **v8 Pipeline UX Overhaul** - Phases 38-42 (shipped 2026-02-24)
- 🚧 **v9 Assembly Pipeline Fix + Overlays** - Phases 43-46 (in progress)

## Phases

<details>
<summary>✅ v2 Profile System (Phases 1-6) - SHIPPED 2026-02-04</summary>

- [x] Phase 1: Database Foundation (1 plan)
- [x] Phase 2: Backend Profile Context (5 plans)
- [x] Phase 3: Frontend Profile UI (3 plans)
- [x] Phase 4: TTS Provider Selection (8 plans)
- [x] Phase 5: Per-Profile Postiz (5 plans)
- [x] Phase 6: Developer Experience (1 plan)

Full details: `.planning/milestones/v2-ROADMAP.md`

</details>

<details>
<summary>✅ v3 Video Quality Enhancement (Phases 7-11) - SHIPPED 2026-02-06</summary>

- [x] Phase 7: Platform Export Presets (3 plans)
- [x] Phase 8: Audio Normalization (2 plans)
- [x] Phase 9: Video Enhancement Filters (3 plans)
- [x] Phase 10: Segment Scoring Enhancement (1 plan)
- [x] Phase 11: Subtitle Enhancement (3 plans)

Full details: `.planning/milestones/v3-ROADMAP.md`

</details>

<details>
<summary>✅ v4 Script-First Pipeline (Phases 12-16) — SHIPPED 2026-02-12</summary>

- [x] Phase 12: ElevenLabs TTS Upgrade (3 plans)
- [x] Phase 13: TTS-Based Subtitles (2 plans)
- [x] Phase 14: AI Script Generation (2 plans)
- [x] Phase 15: Script-to-Video Assembly (2 plans)
- [x] Phase 16: Multi-Variant Pipeline (2 plans)

Full details: `.planning/milestones/v4-ROADMAP.md`

</details>

<details>
<summary>✅ v5 Product Video Generator (Phases 17-23) — SHIPPED 2026-02-21</summary>

- [x] Phase 17: Feed Foundation (2 plans) — completed 2026-02-20
- [x] Phase 18: Video Composition (2 plans) — completed 2026-02-20
- [x] Phase 19: Product Browser (2 plans) — completed 2026-02-20
- [x] Phase 20: Single Product E2E (2 plans) — completed 2026-02-20
- [x] Phase 21: Batch Generation (2 plans) — completed 2026-02-20
- [x] Phase 22: Templates + Customization (2 plans) — completed 2026-02-21
- [x] Phase 23: Feed Creation UI — Gap Closure (1 plan) — completed 2026-02-21

Full details: `.planning/milestones/v5-ROADMAP.md`

</details>

<details>
<summary>✅ v6 Production Hardening (Phases 24-31) — SHIPPED 2026-02-22</summary>

- [x] Phase 24: Backend Stability (2 plans) — completed 2026-02-22
- [x] Phase 25: Rate Limiting & Security (2 plans) — completed 2026-02-22
- [x] Phase 26: Frontend Resilience (2 plans) — completed 2026-02-22
- [x] Phase 27: Frontend Refactoring (1 plan) — completed 2026-02-22
- [x] Phase 28: Code Quality (1 plan) — completed 2026-02-22
- [x] Phase 29: Testing & Observability (2 plans) — completed 2026-02-22
- [x] Phase 30: Frontend Error Handling Adoption (4 plans) — completed 2026-02-22
- [x] Phase 31: Final Polish (2 plans) — completed 2026-02-22

Full details: `.planning/milestones/v6-ROADMAP.md`

</details>

<details>
<summary>✅ v7 Product Image Overlays (Phases 32-35) — SHIPPED 2026-02-24 (partial)</summary>

- [x] Phase 32: Association Data Layer (2 plans) — completed 2026-02-23
- [x] Phase 33: Product and Image Picker Components (1 plan) — completed 2026-02-23
- [x] Phase 34: Page Integration (2 plans) — completed 2026-02-23
- [x] Phase 35: PiP Overlay Controls (2 plans) — completed 2026-02-23
- [ ] Phase 36: Interstitial Slide Controls — deferred (covered in Phase 45)
- [ ] Phase 37: Render Integration — deferred (covered in Phase 46)

Full details: `.planning/milestones/v7-ROADMAP.md`

</details>

<details>
<summary>✅ v8 Pipeline UX Overhaul (Phases 38-42) — SHIPPED 2026-02-24</summary>

- [x] Phase 38: Bug Fixes + Source Selection Backend (2 plans) — completed 2026-02-24
- [x] Phase 39: Source Selection Frontend (1 plan) — completed 2026-02-24
- [x] Phase 40: Video Preview Player (1 plan) — completed 2026-02-24
- [x] Phase 41: Timeline Editor (3 plans) — completed 2026-02-24
- [x] Phase 42: Available Segments Integration Fix (1 plan) — completed 2026-02-24

Full details: `.planning/milestones/v8-ROADMAP.md`

</details>

### 🚧 v9 Assembly Pipeline Fix + Overlays (In Progress)

**Milestone Goal:** Fix critical assembly pipeline bugs (segment repetition, missing subtitles) and complete deferred v7 overlay rendering (interstitial slides + PiP via FFmpeg).

- [x] **Phase 43: Assembly Diversity Fix** - Exhaust all segments before repeating and prevent same-source time-range adjacency (completed 2026-02-28)
- [x] **Phase 44: Subtitle Data Flow Fix** - Persist SRT content from Step 2 through Step 3 render and eliminate zero-duration entries (completed 2026-02-28)
- [x] **Phase 45: Interstitial Slide Controls** - User can insert and configure interstitial product slides between segments (completed 2026-02-28)
- [ ] **Phase 46: Overlay FFmpeg Render Integration** - PiP overlays and interstitial slides rendered into final video via FFmpeg

## Phase Details

### Phase 43: Assembly Diversity Fix
**Goal**: Video segments never repeat until all available segments have been used, and segments from the same source video do not appear consecutively when they cover overlapping time ranges
**Depends on**: Nothing (independent backend fix)
**Requirements**: ASMB-01, ASMB-02, ASMB-03
**Success Criteria** (what must be TRUE):
  1. A generated video that uses fewer segments than the available pool does not show the same clip twice
  2. Consecutive segments from the same source video do not come from overlapping time ranges
  3. The merge step preserves the diversity established by the round-robin cycle rather than collapsing it to one representative per group
  4. After exhausting all unique segments, reuse begins from the segment least recently used
**Plans**: 1 plan

Plans:
- [ ] 43-01-PLAN.md — Rewrite merge logic to preserve segment diversity + add overlapping-time-range adjacency prevention

### Phase 44: Subtitle Data Flow Fix
**Goal**: Subtitles generated at Step 2 are reused verbatim at Step 3 render with no timing drift, no invisible zero-duration entries, and no cutoff at the end of the video
**Depends on**: Nothing (independent backend fix)
**Requirements**: SUBS-01, SUBS-02, SUBS-03, SUBS-04
**Success Criteria** (what must be TRUE):
  1. Playing a rendered pipeline video shows subtitles that match the voiceover with no timing shift from Step 2 preview
  2. Every subtitle entry is visible on screen for at least a minimum perceptible duration
  3. The final video file is at least as long as the TTS audio track so no subtitle is cut off before display
  4. Step 3 render does not call ElevenLabs a second time when TTS audio already exists in cache
**Plans**: 2 plans

Plans:
- [ ] 44-01-PLAN.md — Persist SRT content in tts_previews cache for render reuse
- [ ] 44-02-PLAN.md — Enforce minimum subtitle duration and video-audio duration alignment

### Phase 45: Interstitial Slide Controls
**Goal**: Users can insert product image slides between video segments with configurable duration and Ken Burns animation, visible in the timeline before render
**Depends on**: Phase 43, Phase 44 (assembly fixes should be complete before new overlay controls)
**Requirements**: OVRL-01, OVRL-02, OVRL-03
**Success Criteria** (what must be TRUE):
  1. User can click a control between segments on the timeline to insert a product image slide
  2. User can set the duration of each interstitial slide independently
  3. The interstitial slide entry shows the selected product image in the timeline UI
  4. Ken Burns zoom/pan animation is configured for interstitial slides (settings persist to render)
**Plans**: 1 plan

Plans:
- [ ] 45-01-PLAN.md — InterstitialSlide type, timeline UI insertion/config controls, pipeline state wiring, render payload

### Phase 46: Overlay FFmpeg Render Integration
**Goal**: Final rendered video includes PiP product image overlays on configured segments and interstitial product image slides between segments, both with Ken Burns animation applied via FFmpeg
**Depends on**: Phase 45
**Requirements**: OVRL-04, OVRL-05, OVRL-06
**Success Criteria** (what must be TRUE):
  1. Rendered video shows product image as picture-in-picture overlay on segments where PiP is enabled, at the configured position and size
  2. Rendered video contains interstitial product slides at the configured timestamps between segments
  3. Product images in both PiP overlays and interstitial slides exhibit Ken Burns zoom/pan motion in the final video
  4. Render does not fail when a segment has no product association (PiP is skipped gracefully)
**Plans**: TBD

Plans:
- [ ] 46-01: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v2 | 23/23 | Complete | 2026-02-04 |
| 7-11 | v3 | 12/12 | Complete | 2026-02-06 |
| 12-16 | v4 | 11/11 | Complete | 2026-02-12 |
| 17-23 | v5 | 13/13 | Complete | 2026-02-21 |
| 24-31 | v6 | 16/16 | Complete | 2026-02-22 |
| 32-35 | v7 | 7/7 | Complete (4/6 phases) | 2026-02-23 |
| 36-37 | v7 | 0/3 | Deferred (absorbed into v9) | - |
| 38-42 | v8 | 8/8 | Complete | 2026-02-24 |
| 43. Assembly Diversity Fix | 1/1 | Complete    | 2026-02-28 | - |
| 44. Subtitle Data Flow Fix | 2/2 | Complete    | 2026-02-28 | - |
| 45. Interstitial Slide Controls | 1/1 | Complete   | 2026-02-28 | - |
| 46. Overlay FFmpeg Render Integration | v9 | 0/? | Not started | - |

---
*Last updated: 2026-02-28 after v9 roadmap creation*
