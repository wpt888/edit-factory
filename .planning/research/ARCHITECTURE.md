# Architecture: Product Feed Video Generation

**Domain:** Product showcase video generation from e-commerce feeds
**Researched:** 2026-02-20
**Confidence:** HIGH (existing codebase examined directly; integration points verified)

---

## Executive Summary

The v5 milestone adds a product-feed-driven video generation workflow to an existing script-first platform. The architecture integrates at three well-defined seams: (1) a new `product_routes.py` router sitting alongside the existing pipeline/assembly/library routers, (2) three new services (`feed_parser`, `product_video_compositor`, `image_fetcher`) that plug into existing render infrastructure, and (3) two new frontend pages (`/products` browser, `/product-video` generator) that follow the established pattern of the Pipeline page. The full data flow is: Feed URL → XML parse → product DB table → user selection → template selection → script/voiceover gen → TTS audio → image composition → FFmpeg render → clip stored in existing library → publishable via existing Postiz integration.

Critically, most of the render stack is **reused without modification**: `encoding_presets`, `audio_normalizer`, `subtitle_styler`, `video_filters`, `tts_subtitle_generator`, `elevenlabs_tts/edge_tts`, and the `assembly_service` FFmpeg render logic. New code is concentrated in feed parsing, image handling, and the composition step that turns product images into video frames.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                               │
│                                                                          │
│  /products          /product-video        /library (existing)            │
│  [Feed Browser]     [Video Generator]     [Clip Manager]                 │
│       │                    │                     │                       │
│   apiGet/apiPost       apiGet/apiPost        apiGet/apiPost              │
└──────────────┬─────────────────┬────────────────────────────────────────┘
               │                 │
               ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        FASTAPI ROUTERS                                   │
│                                                                          │
│  [NEW] product_routes.py     [EXISTING]                                  │
│  /api/v1/products/           pipeline_routes.py   library_routes.py      │
│  - POST /feeds/sync          assembly_routes.py   script_routes.py       │
│  - GET  /feeds               postiz_routes.py     tts_routes.py          │
│  - GET  /products            segments_routes.py   profile_routes.py      │
│  - POST /generate                                                        │
│  - GET  /generate/{job_id}                                               │
└──────────────┬─────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           SERVICES LAYER                                 │
│                                                                          │
│  [NEW]                         [REUSED AS-IS]                            │
│  feed_parser.py                script_generator.py (AI voiceover text)  │
│  image_fetcher.py              elevenlabs_tts / edge_tts (audio)         │
│  product_video_compositor.py   tts_subtitle_generator.py (SRT)          │
│                                audio_normalizer.py                      │
│                                subtitle_styler.py                       │
│                                video_filters.py                         │
│                                encoding_presets.py                      │
│                                job_storage.py                           │
│                                cost_tracker.py                          │
└──────────────┬─────────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      EXTERNAL + STORAGE                                  │
│                                                                          │
│  Supabase DB              FFmpeg              External APIs              │
│  - product_feeds          (composition        - Google Shopping XML      │
│  - products               + encoding)         - Product page scraping    │
│  - product_templates                          - ElevenLabs TTS           │
│  - editai_projects (existing)                 - Gemini/Claude AI         │
│  - editai_clips    (existing)                                            │
│  - jobs            (existing)                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | New vs Existing | Communicates With |
|-----------|---------------|-----------------|-------------------|
| `product_routes.py` | Feed CRUD, product listing, job dispatch | **NEW** | `feed_parser`, `product_video_compositor`, `job_storage`, Supabase |
| `feed_parser.py` | Fetch + parse Google Shopping XML, normalize product data | **NEW** | `product_routes`, Supabase products table |
| `image_fetcher.py` | Download product images, optional page scraping, cache to disk | **NEW** | `product_video_compositor` |
| `product_video_compositor.py` | Build FFmpeg filterchain for image-based composition (Ken Burns, text overlay, transitions), call render pipeline | **NEW** | `encoding_presets`, `audio_normalizer`, `subtitle_styler`, `video_filters`, `elevenlabs_tts/edge_tts`, `tts_subtitle_generator` |
| `script_generator.py` | Generate product voiceover scripts from description (elaborate mode) | **REUSED** | `product_video_compositor` (via AI script path) |
| `encoding_presets.py` | Platform encoding parameters | **REUSED** | `product_video_compositor` |
| `audio_normalizer.py` | -14 LUFS normalization | **REUSED** | `product_video_compositor` |
| `subtitle_styler.py` | ASS subtitle style parameters | **REUSED** | `product_video_compositor` |
| `video_filters.py` | Denoise/sharpen/color filters | **REUSED** | `product_video_compositor` |
| `tts_subtitle_generator.py` | ElevenLabs timestamps → SRT | **REUSED** | `product_video_compositor` |
| `elevenlabs_tts` / `edge_tts` | TTS audio synthesis | **REUSED** | `product_video_compositor` |
| `job_storage.py` | Background job state tracking | **REUSED** | `product_routes` |
| `cost_tracker.py` | API cost logging | **REUSED** | `product_video_compositor` |
| `/products` page | Feed config + product browser UI | **NEW** | `product_routes` REST |
| `/product-video` page | Template selection + generation UI | **NEW** | `product_routes` REST |
| `/library` page | View/publish rendered product videos | **REUSED** | `library_routes` (clips stored there already) |

---

## Data Flow: Feed URL to Rendered MP4

```
1. FEED SYNC
   User enters Google Shopping XML URL in /products page
   → POST /api/v1/products/feeds/sync
     → feed_parser.py fetches XML (httpx async, streaming for large feeds)
     → Parses <item> elements: title, description, g:image_link,
       g:price, g:sale_price, g:brand, g:product_type, g:id, link
     → Upserts normalized rows to products table
       (keyed on g:id, profile_id scoped)
     → Returns { feed_id, product_count, synced_at }

2. PRODUCT BROWSE
   GET /api/v1/products?feed_id=X&on_sale=true&category=shoes&q=text
   → Returns paginated product list from DB
   → Frontend renders grid with image, name, price, sale_price badge

3. PRODUCT SELECTION + TEMPLATE CHOICE
   User selects 1-N products, chooses template preset
   (Product Spotlight / Sale Banner / Collection)
   User sets: duration (15-60s), voiceover mode (quick/ai), TTS provider

4. JOB DISPATCH
   POST /api/v1/products/generate
   {
     product_ids: ["pid1", "pid2"],
     template: "product_spotlight",
     duration_sec: 30,
     voiceover_mode: "ai",     // "quick" | "ai"
     tts_provider: "elevenlabs",
     variant_count: 1,
     platform: "reels"
   }
   → product_routes creates job record in job_storage (job_id returned immediately)
   → FastAPI BackgroundTasks starts _generate_product_video_task(job_id, ...)

5. BACKGROUND GENERATION TASK
   _generate_product_video_task runs in background:

   5a. SCRIPT GENERATION
       quick mode: build script from template text + product.title + price/sale fields
       ai mode:    script_generator.generate_scripts(idea=product.description, ...)
                   → Gemini or Claude API call

   5b. TTS AUDIO
       ElevenLabsTTSService.generate_audio_with_timestamps(script_text)
       or EdgeTTSService.generate_audio(script_text)
       → Returns: audio_path, duration, timestamps_dict

   5c. SRT SUBTITLES
       tts_subtitle_generator.generate_srt_from_timestamps(timestamps_dict)
       → Returns: srt_content string

   5d. IMAGE PREPARATION
       image_fetcher.download_images(product.image_link, product.link)
       → Downloads primary image (g:image_link)
       → Optionally scrapes extra images from product.link page
       → Returns: list of local image paths

   5e. VIDEO COMPOSITION
       product_video_compositor.build_product_video(
           images, audio_path, srt_content, duration_sec, template, preset
       )
       This calls FFmpeg with:
       - Input: images as video streams (loop each image for its segment duration)
       - Ken Burns: zoompan filter per image (slow zoom in/out per template config)
       - Text overlays: drawtext filter for product name, price, sale_price
       - Transitions: xfade filter between image segments
       - Audio: -i audio_path mapped to output
       - Subtitles: ass filter with srt_content written to temp .srt file
       - Encoding: encoding_presets.get_preset(platform).to_ffmpeg_params()
       - Audio normalization: audio_normalizer.measure_loudness + build_loudnorm_filter
       - Video filters: video_filters filterchain (denoise/sharpen/color if enabled)
       → Returns: output_video_path

   5f. STORE AS CLIP
       Upsert row in editai_clips table with:
       - project_id: auto-created product project (or user-specified project)
       - final_video_path: output_video_path
       - final_status: "completed"
       - metadata: { product_id, template, voiceover_mode } in JSONB

   5g. UPDATE JOB
       job_storage.update_job(job_id, status="completed", data={clip_id, ...})

6. POLLING
   Frontend polls GET /api/v1/products/generate/{job_id} every 2s
   → Returns { status, progress, clip_id } when done
   → Redirects to /library or shows preview

7. LIBRARY
   Rendered product video appears in /library page
   → Same Postiz publishing flow as any other clip
```

---

## New Files to Create

### Backend

```
app/api/
└── product_routes.py          # NEW: All /products/* endpoints

app/services/
├── feed_parser.py             # NEW: Google Shopping XML → normalized products
├── image_fetcher.py           # NEW: Image download + optional web scraping
└── product_video_compositor.py # NEW: FFmpeg composition for image-based video
```

### Database Migrations

```
supabase/migrations/
├── 013_create_product_feeds.sql      # NEW: product_feeds table
├── 014_create_products.sql           # NEW: products table (profile-scoped)
└── 015_create_product_templates.sql  # NEW: product_templates table (optional)
```

### Frontend

```
frontend/src/app/
├── products/
│   └── page.tsx               # NEW: Feed config + product browser
└── product-video/
    └── page.tsx               # NEW: Template selection + generation + polling
```

---

## Database Schema: New Tables

### product_feeds

```sql
CREATE TABLE product_feeds (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,               -- "Nortia.ro feed"
    url TEXT NOT NULL,                -- Full XML feed URL
    last_synced_at TIMESTAMPTZ,
    product_count INTEGER DEFAULT 0,
    sync_status TEXT DEFAULT 'pending', -- 'pending' | 'syncing' | 'ready' | 'error'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_product_feeds_profile ON product_feeds(profile_id);
```

### products

```sql
CREATE TABLE products (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    feed_id UUID REFERENCES product_feeds(id) ON DELETE CASCADE NOT NULL,
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    -- Google Shopping fields
    external_id TEXT NOT NULL,        -- g:id from XML
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    link TEXT,                        -- Product page URL
    price NUMERIC(10,2),
    sale_price NUMERIC(10,2),
    brand TEXT,
    product_type TEXT,                -- Category path
    availability TEXT,                -- 'in stock' | 'out of stock'
    condition TEXT DEFAULT 'new',
    -- Additional images (scraped or extra)
    extra_image_urls JSONB DEFAULT '[]',
    -- Metadata
    raw_data JSONB DEFAULT '{}',      -- Full original XML item (for future fields)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(feed_id, external_id)      -- Upsert key
);
CREATE INDEX idx_products_feed ON products(feed_id);
CREATE INDEX idx_products_profile ON products(profile_id);
CREATE INDEX idx_products_on_sale ON products(profile_id) WHERE sale_price IS NOT NULL;
CREATE INDEX idx_products_type ON products(profile_id, product_type);
```

### product_templates (optional in v5, can use hardcoded presets initially)

```sql
CREATE TABLE product_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,        -- 'product_spotlight' | 'sale_banner' | 'collection'
    description TEXT,
    config JSONB NOT NULL,            -- Template params (ken_burns, text_positions, etc.)
    is_builtin BOOLEAN DEFAULT true,  -- System templates vs user-created
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Reuse Map: What Gets Reused vs What Is New

### Reused Without Modification

| Service | How It Gets Called |
|---------|-------------------|
| `encoding_presets.get_preset(platform)` | product_video_compositor passes platform param to get FFmpeg params |
| `audio_normalizer.measure_loudness` + `build_loudnorm_filter` | Same two-pass loudnorm workflow applied to TTS audio |
| `subtitle_styler.build_subtitle_filter` | ASS subtitle filter applied to composition output |
| `video_filters.VideoFilters.to_filter_string` | Optional denoise/sharpen/color on final composite |
| `tts_subtitle_generator.generate_srt_from_timestamps` | ElevenLabs timestamps → SRT, identical to assembly workflow |
| `tts/elevenlabs.ElevenLabsTTSService.generate_audio_with_timestamps` | TTS audio generation with timestamps |
| `tts/edge.EdgeTTSService.generate_audio` | Free TTS fallback |
| `tts/factory.get_tts_service` | Provider selection by profile |
| `job_storage.JobStorage` | Background job tracking (same polling pattern as Pipeline) |
| `cost_tracker` | Log ElevenLabs + Gemini API costs |
| `script_generator.ScriptGenerator.generate_scripts` | AI voiceover in elaborate mode |
| `silence_remover.SilenceRemover` | Trim TTS audio silence (same as assembly_service uses) |

### Reused With Adaptation

| Component | What Changes |
|-----------|-------------|
| `assembly_service.py` render logic | Extract the FFmpeg concat + audio + subtitle logic into a shared internal function that both assembly and product compositor call. OR product_video_compositor duplicates the pattern — simpler, less coupling. Recommend duplication for v5, refactor later. |
| `editai_projects` / `editai_clips` tables | Product videos stored as clips. Auto-create a project per product or per batch. Existing clip CRUD (library_routes) handles display and publishing without changes. |
| `/library` page | No change needed. Clips appear automatically because they are stored in editai_clips. |

### New (No Existing Equivalent)

| Component | Why New |
|-----------|---------|
| `feed_parser.py` | Google Shopping XML parsing is domain-specific. Uses `lxml` or stdlib `xml.etree.ElementTree`. No existing XML parser in codebase. |
| `image_fetcher.py` | HTTP image download + disk caching + optional scraping. No image fetch utility exists. Use `httpx` (already available via supabase-py deps) or `requests`. |
| `product_video_compositor.py` | FFmpeg filterchain for image-to-video is distinct from segment-concat workflow. Needs: `loop` input, `zoompan` (Ken Burns), `xfade` transitions, `drawtext` overlays. No existing compositor for this mode. |
| `product_routes.py` | New endpoint namespace for feed/product/generate endpoints. |
| `/products` page | New product browser UI. |
| `/product-video` page | New template + generate UI. |
| `013_create_product_feeds.sql` etc | New DB tables. |

---

## FFmpeg Composition Pattern for Image-Based Video

This is the technical core of the new work. The `product_video_compositor.py` must produce a valid FFmpeg command that:

1. Takes N image inputs (one per product image or scene)
2. Loops each image for its allocated duration
3. Applies Ken Burns (zoompan filter) per segment
4. Applies xfade transitions between segments
5. Composes with TTS audio and subtitle ASS filter
6. Applies encoding preset params

Example FFmpeg filterchain for a 2-image product video:

```
ffmpeg
  -loop 1 -t 15 -i product_img_1.jpg
  -loop 1 -t 15 -i product_img_2.jpg
  -i tts_audio.mp3
  -filter_complex "
    [0:v]scale=1080:1920:force_original_aspect_ratio=increase,
          crop=1080:1920,
          zoompan=z='min(zoom+0.0015,1.5)':d=450:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920[v0];
    [1:v]scale=1080:1920:force_original_aspect_ratio=increase,
          crop=1080:1920,
          zoompan=z='max(zoom-0.0015,1.0)':d=450:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920[v1];
    [v0][v1]xfade=transition=fade:duration=0.5:offset=14.5[vmerged];
    [vmerged]drawtext=text='Product Name':fontsize=60:x=(w-text_w)/2:y=h*0.7[vtxt];
    [vtxt]ass=/tmp/subtitles.ass[vfinal]
  "
  -map [vfinal] -map 2:a
  -c:v libx264 -crf 20 -preset medium
  -c:a aac -b:a 192k
  output.mp4
```

The `zoompan` filter parameters are template-configurable (zoom in vs zoom out, speed, direction). Text overlay positions and sizes are template-configurable. Xfade transition type is template-configurable.

**Important constraint:** `zoompan` is CPU-intensive on 1080x1920 portrait video. For a 30-second video with 2-3 images, expect 30-90 seconds of processing on a typical dev machine. This is acceptable (existing assembly render takes similar time).

---

## Frontend Page Architecture

### /products Page Structure

```
ProductsPage
├── FeedConfigPanel
│   ├── FeedUrlInput
│   ├── SyncButton → POST /products/feeds/sync (shows progress)
│   └── FeedStatus (last synced, product count)
├── ProductFilterBar
│   ├── SearchInput
│   ├── OnSaleFilter (checkbox)
│   ├── CategoryFilter (select, from product_type values)
│   └── SortSelect
├── ProductGrid
│   └── ProductCard[] (image, name, price/sale, select checkbox)
└── SelectionActionBar (shown when products selected)
    ├── SelectedCount
    └── GenerateVideoButton → navigates to /product-video?products=id1,id2
```

### /product-video Page Structure

```
ProductVideoPage
├── SelectedProductsSummary (from query params)
├── TemplateSelector
│   └── TemplateCard[] (Product Spotlight / Sale Banner / Collection)
├── SettingsPanel
│   ├── DurationSlider (15-60s)
│   ├── VoiceoverModeToggle (quick/ai)
│   ├── TTSProviderSelector (reuse existing provider-selector component)
│   ├── AIProviderSelector (gemini/claude, only visible when ai mode)
│   └── VariantCountSelect (1-3, batch mode only)
├── GenerateButton → POST /products/generate → returns job_id
└── ProgressPanel (same useJobPolling hook as Pipeline page)
    └── on complete: link to /library
```

---

## Architectural Patterns to Follow

### Pattern 1: Background Task with Immediate Job ID Return

**What:** Endpoint creates job record, starts BackgroundTask, returns job_id immediately.
**When:** All product video generation endpoints. Processing takes 10-120 seconds.
**Established by:** library_routes.py, assembly_routes.py, pipeline_routes.py

```python
@router.post("/generate")
async def generate_product_video(
    request: ProductVideoRequest,
    background_tasks: BackgroundTasks,
    profile: ProfileContext = Depends(get_profile_context)
):
    job_id = str(uuid.uuid4())
    _product_jobs[job_id] = {"status": "queued", "progress": 0}
    background_tasks.add_task(
        _generate_product_video_task,
        job_id, request, profile.profile_id
    )
    return {"job_id": job_id}
```

### Pattern 2: In-Memory Job Progress Dict

**What:** Module-level dict `_product_jobs: Dict[str, dict]` for progress tracking.
**When:** All v5 product video generation jobs.
**Established by:** `_assembly_jobs` in assembly_routes.py, `_pipelines` in pipeline_routes.py, `_generation_progress` in library_routes.py

Note: This is acknowledged tech debt (lost on restart), consistent with existing approach for this single-user personal-use tool.

### Pattern 3: Lazy Supabase Client Singleton

**What:** Module-level `_supabase_client = None` with `get_supabase()` factory.
**When:** All new routes and services needing DB access.
**Established by:** Every existing router (copy the same 15-line pattern).

### Pattern 4: Profile-Scoped All DB Operations

**What:** Every DB query includes `.eq("profile_id", profile.profile_id)`.
**When:** All feed, product, and generation operations.
**Established by:** library_routes.py, assembly_routes.py

### Pattern 5: Form String → Bool Coercion (for multipart endpoints)

**What:** `generate_audio: str = Form(default="true")` + `.lower() in ("true", "1", "yes")`.
**When:** Any product endpoint accepting multipart form data.
**Established by:** routes.py video upload endpoint.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Blocking Feed Sync in Request Handler

**What:** Fetching and parsing a 9,987-product XML feed synchronously in the request.
**Why bad:** A 10k-product feed can be several MB and take 5-30 seconds. The HTTP request will timeout in production. Even in development, the frontend will appear frozen.
**Instead:** Run feed sync as a BackgroundTask. Return a `sync_job_id` immediately. Poll for completion. For v5 this is less critical (personal use, no timeout) but the pattern should be consistent.

### Anti-Pattern 2: Storing Images in Supabase Storage

**What:** Uploading all product images to Supabase Storage before rendering.
**Why bad:** Unnecessary latency, storage costs, and complexity for a local-use tool. Product images are downloaded just-in-time, used for rendering, then the rendered MP4 is the only artifact that needs persistence.
**Instead:** Download images to `temp/{profile_id}/product_{id}/` directory before rendering. Clean up after job completes. Only the final MP4 path is stored in the DB.

### Anti-Pattern 3: Single Monolithic FFmpeg Command for Multi-Product Batch

**What:** Attempting one FFmpeg command that generates all N videos in a batch.
**Why bad:** One failure aborts all. Progress is all-or-nothing. Complex to build.
**Instead:** Generate each product video independently and sequentially (or in a small async pool). Track progress per video. The batch job aggregates individual job results.

### Anti-Pattern 4: Creating a New Render Stack Separate from Existing

**What:** Building a fully independent image-to-video pipeline that ignores existing `encoding_presets`, `audio_normalizer`, `subtitle_styler`.
**Why bad:** Duplicates quality settings, creates divergence between script-first and product-first output quality. Two places to update when encoding params change.
**Instead:** `product_video_compositor.py` explicitly calls `get_preset(platform)`, `measure_loudness`, `build_loudnorm_filter`, and `build_subtitle_filter` from their respective services. New code is only the image composition filterchain (zoompan, xfade, drawtext).

### Anti-Pattern 5: Hardcoding Template Logic in the Route Handler

**What:** Template rendering logic (Ken Burns params, text positions) inside the route function.
**Why bad:** Routes should be thin. Makes templates impossible to unit test. Couples transport to business logic.
**Instead:** `product_video_compositor.py` owns all composition logic. `product_routes.py` only handles request/response, job creation, and task dispatch.

---

## Build Order and Dependencies

Phase order is driven by hard dependencies: DB must exist before routes use it, routes must exist before frontend calls them.

```
Phase 1: Database Foundation
  013_create_product_feeds.sql
  014_create_products.sql
  (015_create_product_templates.sql — optional, can use hardcoded presets)
  → Enables: all subsequent phases

Phase 2: Feed Parser Service
  app/services/feed_parser.py
  → Parses Google Shopping XML, upserts to products table
  → Enables: Phase 3 (routes need parser), Phase 4 (compositor needs product data)

Phase 3: Product API Routes (feed sync + product listing only)
  app/api/product_routes.py (partial: /feeds/sync + /products endpoints)
  → Enables: Phase 5 (frontend can browse products)

Phase 4: Image Fetcher + Video Compositor
  app/services/image_fetcher.py
  app/services/product_video_compositor.py
  → Enables: Phase 3 completion (generate endpoint), Phase 6 (end-to-end testing)

Phase 5: Frontend Product Browser
  frontend/src/app/products/page.tsx
  → Depends on: Phase 3 (feed sync + listing endpoints)
  → Enables: UX validation before video generation is built

Phase 6: Product Video Generator Route + Frontend
  app/api/product_routes.py (complete: /generate + /generate/{job_id})
  frontend/src/app/product-video/page.tsx
  → Depends on: Phases 2-4 (all services must exist)
  → Enables: End-to-end product → video generation
```

---

## Integration Points Summary

| Boundary | Communication Method | Direction | Notes |
|----------|---------------------|-----------|-------|
| product_routes ↔ feed_parser | Direct function call | sync (or async) | Feed may be large; consider async httpx fetch |
| product_routes ↔ product_video_compositor | BackgroundTask function call | async background | Job ID returned immediately |
| product_video_compositor ↔ encoding_presets | Direct import, function call | sync | `get_preset(platform).to_ffmpeg_params()` |
| product_video_compositor ↔ audio_normalizer | Direct import, function call | sync | `measure_loudness()` then `build_loudnorm_filter()` |
| product_video_compositor ↔ subtitle_styler | Direct import, function call | sync | `build_subtitle_filter(config)` |
| product_video_compositor ↔ elevenlabs_tts / edge_tts | Direct import, async call | async | `generate_audio_with_timestamps()` |
| product_video_compositor ↔ tts_subtitle_generator | Direct import, function call | sync | `generate_srt_from_timestamps(timestamps)` |
| product_video_compositor ↔ script_generator | Direct import, method call | sync | Only in AI voiceover mode |
| product_video_compositor ↔ FFmpeg | subprocess.run | sync | Same as all existing render services |
| product_routes ↔ Supabase | supabase-py client | async | Same lazy-singleton pattern |
| product_video_compositor ↔ editai_clips | Supabase upsert | sync | Stores final clip in existing clips table |
| Frontend /products ↔ product_routes | REST HTTP via api.ts | async | apiGet/apiPost same as all existing pages |
| Frontend /product-video ↔ product_routes | REST HTTP via api.ts + useJobPolling | async | Polling same as Pipeline page pattern |
| product jobs ↔ /library page | editai_clips table | indirect | Clips appear in library automatically after generation |

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Integration points with existing codebase | HIGH | Examined all router files, services, main.py directly |
| DB schema for feeds/products | HIGH | Follows established migration patterns exactly |
| FFmpeg zoompan + xfade filterchain | MEDIUM | Patterns are documented; exact parameter tuning requires testing |
| Google Shopping XML field names | HIGH | Google Shopping spec is stable and well-documented |
| Image scraping from product pages | LOW | Site-specific, may require per-site rules, robots.txt compliance |
| Render performance (zoompan at 1080p) | MEDIUM | Known to be CPU-intensive; exact timing needs measurement |

---

## Sources

- Existing codebase: `app/main.py`, `app/api/assembly_routes.py`, `app/api/pipeline_routes.py`, `app/api/library_routes.py`, `app/services/assembly_service.py`, `app/services/encoding_presets.py`, `app/services/audio_normalizer.py`, `app/services/subtitle_styler.py`, `app/services/tts_subtitle_generator.py` — all read directly 2026-02-20
- Existing DB migrations: `001_add_auth_and_rls.sql` through `012_add_missing_columns_for_500_fixes.sql` — schema patterns verified
- FFmpeg zoompan filter: https://ffmpeg.org/ffmpeg-filters.html#zoompan (MEDIUM confidence — filter is stable but parameters require tuning)
- FFmpeg xfade filter: https://ffmpeg.org/ffmpeg-filters.html#xfade (MEDIUM confidence — stable API)
- Google Shopping XML feed specification: https://support.google.com/merchants/answer/7052112 (HIGH confidence — stable, well-documented)

---

*Architecture research for: v5 Product Feed Video Generation integration*
*Researched: 2026-02-20*
