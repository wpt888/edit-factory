# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- ✅ **v4 Script-First Pipeline** - Phases 12-16 (shipped 2026-02-12)
- ✅ **v5 Product Video Generator** - Phases 17-23 (shipped 2026-02-21)
- ✅ **v6 Production Hardening** - Phases 24-31 (shipped 2026-02-22)
- 🚧 **v7 Product Image Overlays** - Phases 32-37 (paused at 67%)
- 🚧 **v8 Pipeline UX Overhaul** - Phases 38-41 (in progress)

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

### 🚧 v7 Product Image Overlays (Paused)

**Milestone Goal:** Bridge catalog products with video segments — associate products to segments and render them as PiP overlays or interstitial slides, adding visual richness to generated videos.

- [x] **Phase 32: Association Data Layer** - DB migration + backend API for product-segment associations (completed 2026-02-23)
- [x] **Phase 33: Product and Image Picker Components** - Reusable product search dialog and image selector (completed 2026-02-23)
- [x] **Phase 34: Page Integration** - Wire pickers into Segments and Pipeline pages (completed 2026-02-23)
- [x] **Phase 35: PiP Overlay Controls** - PiP enable/position/size/animation config stored per segment (completed 2026-02-23)
- [ ] **Phase 36: Interstitial Slide Controls** - Interstitial enable/duration config stored per segment (paused)
- [ ] **Phase 37: Render Integration** - FFmpeg applies PiP overlays and interstitial slides in assembly (paused)

### 🚧 v8 Pipeline UX Overhaul (In Progress)

**Milestone Goal:** Fix pipeline Step 4 bugs, add source video selection to Step 3, inline video preview to Step 4, and a visual timeline editor to Step 3 — making the multi-variant pipeline workflow complete from script to published video.

- [x] **Phase 38: Bug Fixes + Source Selection Backend** - Fix Step 4 flicker and library save, add scoped segment matching API (completed 2026-02-24)
- [x] **Phase 39: Source Selection Frontend** - Step 3 UI for picking source videos with segment counts and DB persistence (completed 2026-02-24)
- [ ] **Phase 40: Video Preview Player** - Inline HTML5 player with auto-thumbnails on Step 4 variant cards
- [ ] **Phase 41: Timeline Editor** - Visual timeline in Step 3 with drag/drop reordering, segment swap, and duration adjustment

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
- [x] 32-01-PLAN.md — DB migration + catalog images endpoint
- [x] 32-02-PLAN.md — Association CRUD API routes

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
- [x] 33-01-PLAN.md — ProductPickerDialog and ImagePickerDialog components with catalog API integration

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
- [x] 34-01-PLAN.md — Segments page product association controls (UI-01)
- [x] 34-02-PLAN.md — Pipeline page product association controls (UI-02)

### Phase 35: PiP Overlay Controls
**Goal**: Users can configure PiP overlay settings (enabled, position, size, animation) on a per-segment basis, with choices stored in the database
**Depends on**: Phase 34
**Requirements**: OVRL-01, OVRL-02, OVRL-03, OVRL-04
**Success Criteria** (what must be TRUE):
  1. User can toggle PiP overlay on or off for any segment that has an associated product
  2. User can choose PiP position from four corners (top-left, top-right, bottom-left, bottom-right)
  3. User can choose PiP size from three levels (small, medium, large)
  4. User can choose PiP animation style (static, fade in/out, Ken Burns) and the choice is saved
**Plans**: 2 plans

Plans:
- [x] 35-01-PLAN.md — PATCH pip-config endpoint + PipConfig type + PipOverlayPanel component
- [x] 35-02-PLAN.md — Wire PipOverlayPanel into Segments and Pipeline pages + visual verification

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

### Phase 38: Bug Fixes + Source Selection Backend
**Goal**: Step 4 renders cleanly without empty state flicker, rendered clips are saved to the library, and the backend supports filtering segment matching to user-selected source videos
**Depends on**: Nothing (builds on existing pipeline backend)
**Requirements**: BUG-01, BUG-02, SRC-02
**Success Criteria** (what must be TRUE):
  1. Entering Step 4 shows render progress immediately without a flash of empty state
  2. After a pipeline render completes, the rendered clip appears in the Library page without manual intervention
  3. The segment matching API accepts a list of source video IDs and only matches against segments from those videos
**Plans**: TBD

**Plans:** 2/2 plans complete

Plans:
- [ ] 38-01-PLAN.md — Fix Step 4 empty state flash + library save for pipeline clips (BUG-01, BUG-02)
- [ ] 38-02-PLAN.md — Source-scoped segment matching API (SRC-02)

### Phase 39: Source Selection Frontend
**Goal**: Users can select one or more source videos in Step 3 before previewing, see segment counts per video, and have their selection persist across page reloads
**Depends on**: Phase 38
**Requirements**: SRC-01, SRC-03, SRC-04
**Success Criteria** (what must be TRUE):
  1. Step 3 shows a source video picker listing library projects with their segment counts
  2. User can select one or more projects as sources and proceed to preview using only those segments
  3. Selecting no sources is prevented — UI requires at least one source before advancing
  4. Closing and reopening the pipeline page restores the previously selected source videos
**Plans**: 1 plan

Plans:
- [ ] 39-01-PLAN.md — Source video picker UI + segment count display + DB persistence + preview/render wiring

### Phase 40: Video Preview Player
**Goal**: Users can watch rendered variant videos inline in Step 4 without downloading, with auto-generated thumbnails shown before playback begins
**Depends on**: Phase 38
**Requirements**: PREV-01, PREV-02
**Success Criteria** (what must be TRUE):
  1. Each rendered variant card in Step 4 shows an auto-generated thumbnail image
  2. User can press play on any variant card to watch the rendered video inline via an HTML5 player
  3. Video playback controls (play/pause, seek, volume) are accessible without leaving the pipeline page
**Plans**: TBD

Plans:
- [ ] 40-01: Backend thumbnail generation endpoint + frontend HTML5 inline player on variant cards

### Phase 41: Timeline Editor
**Goal**: Users see a visual timeline in Step 3 mapping SRT phrases to video segments, can reorder segments by dragging, swap segments from the source library, manually assign segments to unmatched phrases, and adjust segment durations
**Depends on**: Phase 39
**Requirements**: TIME-01, TIME-02, TIME-03, TIME-04, TIME-05
**Success Criteria** (what must be TRUE):
  1. Step 3 shows a visual timeline where each SRT phrase is displayed alongside its matched video segment
  2. Unmatched phrases are highlighted in a distinct color with a prompt to manually assign a segment
  3. User can drag a segment to a different position on the timeline and the reorder persists for rendering
  4. User can click a segment and swap it for a different clip from the selected source video(s)
  5. User can adjust a segment's duration on the timeline and the change is reflected in the render
**Plans**: TBD

Plans:
- [ ] 41-01: Timeline data model + visual timeline component (phrase-to-segment display + unmatched highlighting)
- [ ] 41-02: Drag/drop reorder + segment swap from source library
- [ ] 41-03: Duration adjustment controls + render integration

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v2 | 23/23 | Complete | 2026-02-04 |
| 7-11 | v3 | 12/12 | Complete | 2026-02-06 |
| 12-16 | v4 | 11/11 | Complete | 2026-02-12 |
| 17-23 | v5 | 13/13 | Complete | 2026-02-21 |
| 24-31 | v6 | 16/16 | Complete | 2026-02-22 |
| 32. Association Data Layer | v7 | 2/2 | Complete | 2026-02-23 |
| 33. Product and Image Picker Components | v7 | 1/1 | Complete | 2026-02-23 |
| 34. Page Integration | v7 | 2/2 | Complete | 2026-02-23 |
| 35. PiP Overlay Controls | v7 | 2/2 | Complete | 2026-02-23 |
| 36. Interstitial Slide Controls | v7 | 0/1 | Deferred (v7 paused) | - |
| 37. Render Integration | v7 | 0/2 | Deferred (v7 paused) | - |
| 38. Bug Fixes + Source Selection Backend | 2/2 | Complete    | 2026-02-24 | - |
| 39. Source Selection Frontend | 1/1 | Complete    | 2026-02-24 | - |
| 40. Video Preview Player | v8 | 0/1 | Not started | - |
| 41. Timeline Editor | v8 | 0/3 | Not started | - |

---
*Last updated: 2026-02-24 after v8 Pipeline UX Overhaul roadmap created*
