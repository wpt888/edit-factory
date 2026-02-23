# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- ✅ **v4 Script-First Pipeline** - Phases 12-16 (shipped 2026-02-12)
- ✅ **v5 Product Video Generator** - Phases 17-23 (shipped 2026-02-21)
- ✅ **v6 Production Hardening** - Phases 24-31 (shipped 2026-02-22)
- 🚧 **v7 Product Image Overlays** - Phases 32-37 (in progress)

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

### 🚧 v7 Product Image Overlays (In Progress)

**Milestone Goal:** Bridge catalog products with video segments — associate products to segments and render them as PiP overlays or interstitial slides, adding visual richness to generated videos.

- [x] **Phase 32: Association Data Layer** - DB migration + backend API for product-segment associations (completed 2026-02-23)
- [x] **Phase 33: Product and Image Picker Components** - Reusable product search dialog and image selector (completed 2026-02-23)
- [ ] **Phase 34: Page Integration** - Wire pickers into Segments and Pipeline pages
- [ ] **Phase 35: PiP Overlay Controls** - PiP enable/position/size/animation config stored per segment
- [ ] **Phase 36: Interstitial Slide Controls** - Interstitial enable/duration config stored per segment
- [ ] **Phase 37: Render Integration** - FFmpeg applies PiP overlays and interstitial slides in assembly

## Phase Details

### Phase 32: Association Data Layer
**Goal**: Users can associate a catalog product with any video segment and select which images to use, with data persisted to the database
**Depends on**: Nothing (first v7 phase — builds on existing catalog + segments DB)
**Requirements**: ASSOC-01, ASSOC-02, ASSOC-03, ASSOC-04
**Success Criteria** (what must be TRUE):
  1. A segment can have a product associated with it (stored in DB, survives page refresh)
  2. A product association can be removed from a segment, returning it to unassociated state
  3. The associated product's thumbnail and name are retrievable per segment
  4. One or more product gallery images can be selected for use on a segment (selection persisted)
**Plans**: 2 plans

Plans:
- [ ] 32-01-PLAN.md — DB migration + catalog images endpoint
- [ ] 32-02-PLAN.md — Association CRUD API routes

### Phase 33: Product and Image Picker Components
**Goal**: Reusable dialog components exist for searching catalog products and selecting product images, ready to embed in any page
**Depends on**: Phase 32
**Requirements**: UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. User can open a product picker dialog that shows catalog products with search and filter
  2. Selecting a product in the dialog commits the association and closes the dialog
  3. User can open an image picker that displays all gallery images for the associated product
  4. User can toggle individual images on/off in the image picker and save the selection
**Plans**: 1 plan

Plans:
- [ ] 33-01-PLAN.md — ProductPickerDialog and ImagePickerDialog components with catalog API integration

### Phase 34: Page Integration
**Goal**: Segments page and Pipeline page each display product association controls inline per segment, using the picker components from Phase 33
**Depends on**: Phase 33
**Requirements**: UI-01, UI-02
**Success Criteria** (what must be TRUE):
  1. Each segment row on the Segments page shows the associated product (or "No product") with a button to open the picker
  2. Each matched segment on the Pipeline page shows the same association control inline
  3. Associating a product on either page immediately reflects the change without a full page reload
**Plans**: 2 plans

Plans:
- [ ] 34-01-PLAN.md — Segments page product association controls (UI-01)
- [ ] 34-02-PLAN.md — Pipeline page product association controls (UI-02)

### Phase 35: PiP Overlay Controls
**Goal**: Users can configure PiP overlay settings (enabled, position, size, animation) on a per-segment basis, with choices stored in the database
**Depends on**: Phase 34
**Requirements**: OVRL-01, OVRL-02, OVRL-03, OVRL-04
**Success Criteria** (what must be TRUE):
  1. User can toggle PiP overlay on or off for any segment that has an associated product
  2. User can choose PiP position from four corners (top-left, top-right, bottom-left, bottom-right)
  3. User can choose PiP size from three levels (small, medium, large)
  4. User can choose PiP animation style (static, fade in/out, Ken Burns) and the choice is saved
**Plans**: TBD

Plans:
- [ ] 35-01: PiP overlay config UI controls + backend storage for overlay settings

### Phase 36: Interstitial Slide Controls
**Goal**: Users can configure an interstitial product slide for any segment boundary, choosing to enable it and set its duration
**Depends on**: Phase 34
**Requirements**: SLID-01, SLID-02, SLID-03
**Success Criteria** (what must be TRUE):
  1. User can enable an interstitial slide to appear before a segment (stored per segment)
  2. User can set the interstitial duration between 0.5s and 5s with the choice persisted
  3. The interstitial configuration records that it will display the product image full-screen with Ken Burns animation
**Plans**: TBD

Plans:
- [ ] 36-01: Interstitial slide config UI controls + backend storage for slide settings

### Phase 37: Render Integration
**Goal**: The assembly/render pipeline reads PiP and interstitial configurations and produces final videos with product image overlays and interstitial slides applied via FFmpeg
**Depends on**: Phase 35, Phase 36
**Requirements**: REND-01, REND-02, REND-03
**Success Criteria** (what must be TRUE):
  1. Rendering a video with PiP-enabled segments produces a video where the product image appears overlaid at the configured position and size
  2. Rendering a video with interstitial-enabled segments inserts a full-screen product image slide at each configured segment boundary
  3. The rendered product image uses the selected gallery images and applies the chosen animation style (static, fade, Ken Burns)
**Plans**: TBD

Plans:
- [ ] 37-01: Assembly pipeline PiP overlay compositor (FFmpeg overlay filter)
- [ ] 37-02: Assembly pipeline interstitial slide insertion (FFmpeg concat with Ken Burns)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v2 | 23/23 | Complete | 2026-02-04 |
| 7-11 | v3 | 12/12 | Complete | 2026-02-06 |
| 12-16 | v4 | 11/11 | Complete | 2026-02-12 |
| 17-23 | v5 | 13/13 | Complete | 2026-02-21 |
| 24-31 | v6 | 16/16 | Complete | 2026-02-22 |
| 32. Association Data Layer | 2/2 | Complete    | 2026-02-23 | - |
| 33. Product and Image Picker Components | 1/1 | Complete    | 2026-02-23 | - |
| 34. Page Integration | v7 | 0/1 | Not started | - |
| 35. PiP Overlay Controls | v7 | 0/1 | Not started | - |
| 36. Interstitial Slide Controls | v7 | 0/1 | Not started | - |
| 37. Render Integration | v7 | 0/2 | Not started | - |

---
*Last updated: 2026-02-23 after v7 Product Image Overlays roadmap created*
