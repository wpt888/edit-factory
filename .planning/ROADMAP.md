# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- ✅ **v4 Script-First Pipeline** - Phases 12-16 (shipped 2026-02-12)
- 🚧 **v5 Product Video Generator** - Phases 17-22 (in progress)

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

<details>
<summary>✅ v4 Script-First Pipeline (Phases 12-16) — SHIPPED 2026-02-12</summary>

### Phase 12: ElevenLabs TTS Upgrade
**Goal**: ElevenLabs flash v2.5 with character-level timestamps and 192kbps audio
**Plans**: 3 plans — Complete 2026-02-12

### Phase 13: TTS-Based Subtitles
**Goal**: SRT subtitles from ElevenLabs character timestamps without Whisper
**Plans**: 2 plans — Complete 2026-02-12

### Phase 14: AI Script Generation
**Goal**: Multiple TTS-ready script variants from user idea (Gemini + Claude)
**Plans**: 2 plans — Complete 2026-02-12

### Phase 15: Script-to-Video Assembly
**Goal**: Keyword matching + timeline building + segment assembly with TTS audio
**Plans**: 2 plans — Complete 2026-02-12

### Phase 16: Multi-Variant Pipeline
**Goal**: End-to-end 1 idea -> N videos pipeline with 4-step workflow
**Plans**: 2 plans — Complete 2026-02-12

Full details: `.planning/milestones/v4-ROADMAP.md`

</details>

### 🚧 v5 Product Video Generator (In Progress)

**Milestone Goal:** Generate product showcase videos automatically from Google Shopping XML feeds — single product or batch — with Ken Burns animation, text overlays, TTS voiceover, synced subtitles, template presets, and per-profile customization.

- [x] **Phase 17: Feed Foundation** - XML feed parsing, product DB tables, image download, Romanian diacritics pattern (completed 2026-02-20)
- [x] **Phase 18: Video Composition** - Ken Burns animation, text overlays, sale badge, CTA, duration control (completed 2026-02-20)
- [x] **Phase 19: Product Browser** - API routes, product browser UI with search and filters (completed 2026-02-20)
- [x] **Phase 20: Single Product E2E** - Generate endpoint + product video page + TTS + subtitles + library output (completed 2026-02-20)
- [ ] **Phase 21: Batch Generation** - Multi-select, batch queue, per-product progress and error isolation
- [ ] **Phase 22: Templates and Profile Customization** - 3 preset templates + per-profile colors, fonts, CTA

## Phase Details

### Phase 17: Feed Foundation
**Goal**: Users can add a Google Shopping XML feed URL and sync product data into a browsable database, with all encoding patterns for Romanian text and streaming parse established
**Depends on**: Nothing (builds on existing platform, no v5 dependencies)
**Requirements**: FEED-01, FEED-07, COMP-05
**Success Criteria** (what must be TRUE):
  1. User can enter a Google Shopping XML feed URL and trigger a sync that completes without memory spikes on a 10k-product feed
  2. Synced products are stored in Supabase `product_feeds` and `products` tables with title, price, sale_price, brand, product_type, image_link, and product_url fields populated
  3. Product images download in parallel to a local cache directory with fallback placeholder for missing images
  4. Romanian product names with diacritics (a, i, s, t with comma-below) render correctly in FFmpeg drawtext using the `textfile=` pattern — verified end-to-end with a real Nortia.ro product name
  5. HTML tags and entities in product descriptions are stripped by `clean_product_text()` before any field is stored or used
**Plans**: 2 plans

Plans:
- [ ] 17-01-PLAN.md — DB migrations (product_feeds, products tables) + feed_parser.py + feed_routes.py API
- [ ] 17-02-PLAN.md — image_fetcher.py (parallel downloads, placeholder) + textfile_helper.py (Romanian diacritics)

### Phase 18: Video Composition
**Goal**: The system can produce a complete product video clip from a product image using Ken Burns animation, text overlays, and configurable duration — verified against real Nortia.ro product images
**Depends on**: Phase 17 (product images, textfile= pattern)
**Requirements**: COMP-01, COMP-02, COMP-03, COMP-04, COMP-06
**Success Criteria** (what must be TRUE):
  1. A product image animates with Ken Burns zoom/pan motion for the full video duration — no static freeze frames
  2. Product name, price, and brand appear as text overlays on the video; sale_price renders alongside original price when present
  3. A sale badge overlay appears in a corner of the video when the product has a sale_price
  4. A CTA text overlay (e.g. "Comanda acum!") appears at a fixed position — text is configurable
  5. User can set video duration to 15, 30, 45, or 60 seconds and the output duration matches the selection
**Plans**: 2 plans

Plans:
- [ ] 18-01-PLAN.md — Core compositor: Ken Burns zoompan animation, simple-scale fallback, duration control, benchmark
- [ ] 18-02-PLAN.md — Text overlays (name, brand, price, sale price), sale badge, CTA, Romanian diacritics verification

### Phase 19: Product Browser
**Goal**: Users can browse, search, and filter synced products in a paginated UI and select products for video generation
**Depends on**: Phase 17 (products table populated)
**Requirements**: FEED-02, FEED-03, FEED-04, FEED-05, FEED-06
**Success Criteria** (what must be TRUE):
  1. User can see synced products in a card grid showing product image, title, price, sale badge, and brand — paginated at 50 products per page
  2. User can type in a search box and the grid filters to products whose title contains the search text
  3. User can toggle an "On Sale" filter and see only products where sale_price is less than price
  4. User can select a category from a dropdown and see only products in that product_type
  5. User can select a brand from a dropdown and see only products from that brand
**Plans**: 2 plans

Plans:
- [ ] 19-01-PLAN.md — Backend: product_routes.py with filtered product listing (search/on_sale/category/brand params) + filter options endpoint
- [ ] 19-02-PLAN.md — Frontend: /products page with feed selector, filter bar, paginated product card grid, navbar link

### Phase 20: Single Product End-to-End
**Goal**: User can select one product, configure voiceover and TTS provider, generate a video, and find it in the library — the full atomic workflow working end-to-end
**Depends on**: Phase 18 (compositor), Phase 19 (routes + product browser)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04, BATCH-01, BATCH-05, OUT-01, OUT-02, OUT-03, OUT-04
**Success Criteria** (what must be TRUE):
  1. User can trigger single product video generation from the product browser and see a progress indicator update in real time via job polling
  2. Quick mode generates voiceover audio from a template string (title + price + CTA) using the selected TTS provider without requiring AI generation
  3. Elaborate mode generates an AI voiceover script from the product description via Gemini or Claude and then synthesizes it with the selected TTS provider
  4. Generated video has synced subtitles derived from TTS timestamps — the same subtitle pipeline used in v4
  5. Generated video appears in the existing library page as a clip, uses the active encoding preset (TikTok/Reels/Shorts), -14 LUFS audio normalization, and any enabled video filters
**Plans**: 2 plans

Plans:
- [ ] 20-01-PLAN.md — Backend: product_generate_routes.py with POST /generate endpoint + full background task pipeline (TTS, subtitles, compositor, render_with_preset, library insert)
- [ ] 20-02-PLAN.md — Frontend: /product-video page with generation form, TTS/voiceover settings, progress polling + "Generate Video" button on product browser cards + E2E verification

### Phase 21: Batch Generation
**Goal**: Users can select multiple products, launch batch generation, and monitor per-product progress — with one product failure not affecting the rest
**Depends on**: Phase 20 (single product flow validated end-to-end)
**Requirements**: BATCH-02, BATCH-03, BATCH-04
**Success Criteria** (what must be TRUE):
  1. User can select multiple product cards in the product browser using checkboxes and trigger batch generation from a sticky action bar
  2. Batch UI shows a per-product progress card for each selected product — each card independently transitions through queued, downloading, rendering, done, and failed states
  3. If one product video fails (missing image, TTS error, FFmpeg error), the remaining products in the batch continue processing — the batch does not abort
  4. User can navigate away from the batch page and return to see current progress without losing state
**Plans**: 2 plans

Plans:
- [ ] 21-01-PLAN.md — Backend: BatchGenerateRequest + POST /batch-generate dispatch + sequential loop with per-product error isolation + GET /batch/{batch_id}/status polling endpoint
- [ ] 21-02-PLAN.md — Frontend: Multi-select checkboxes on product cards, sticky action bar, useBatchPolling hook, per-product progress grid page, retry-failed button

### Phase 22: Templates and Profile Customization
**Goal**: Users can choose from 3 named template presets and customize the template colors, font, and CTA text per profile — giving each store its own brand identity in generated videos
**Depends on**: Phase 20 (working generation pipeline)
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04
**Success Criteria** (what must be TRUE):
  1. User can select one of 3 named template presets (Product Spotlight, Sale Banner, Collection Showcase) and the generated video uses the overlay positions, animation direction, and text layout defined by that preset
  2. User can customize a template's primary color, accent color, font family, and CTA text — and the generated video reflects those choices
  3. Template customizations are saved per profile — switching profiles shows each store's own saved template settings
  4. All 3 templates define safe zones so text overlays do not overlap TikTok/Reels UI elements at the top and bottom of the frame
**Plans**: TBD

Plans:
- [ ] 22-01: 3 template preset Python dataclasses (Product Spotlight, Sale Banner, Collection Showcase) with overlay positions, animation config, safe zones + product_templates DB migration (optional, may use profile settings JSON)
- [ ] 22-02: Template customization UI in settings page — color pickers, font selector, CTA text field — saved per profile + template selector wired into generation flow

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v2 | 23/23 | Complete | 2026-02-04 |
| 7-11 | v3 | 12/12 | Complete | 2026-02-06 |
| 12-16 | v4 | 11/11 | Complete | 2026-02-12 |
| 17. Feed Foundation | 2/2 | Complete    | 2026-02-20 | - |
| 18. Video Composition | 2/2 | Complete    | 2026-02-20 | - |
| 19. Product Browser | 2/2 | Complete    | 2026-02-20 | - |
| 20. Single Product E2E | 2/2 | Complete    | 2026-02-20 | - |
| 21. Batch Generation | 1/2 | In Progress|  | - |
| 22. Templates + Customization | v5 | 0/2 | Not started | - |

---
*Last updated: 2026-02-20 after v5 Product Video Generator roadmap created*
