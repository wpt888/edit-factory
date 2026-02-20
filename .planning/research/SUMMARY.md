# Project Research Summary

**Project:** v5 Product Video Generator — Edit Factory
**Domain:** E-commerce product feed to social media video generation
**Researched:** 2026-02-20
**Confidence:** HIGH

## Executive Summary

The v5 milestone adds a product-feed-driven video generation workflow to an existing, mature platform. The architectural approach is conservative and correct: the new feature integrates at three well-defined seams rather than building a parallel stack. Most of the render infrastructure — ElevenLabs/Edge TTS, subtitle generation, audio normalization, encoding presets, job tracking — is reused without modification. New code is concentrated in three focused areas: parsing Google Shopping XML feeds (lxml), image preparation and download (Pillow, httpx), and a new FFmpeg image-to-video compositor using zoompan Ken Burns effects, drawtext overlays, and xfade transitions. The data path is: feed URL → XML parse → products DB table → user selection → template choice → TTS voiceover → image composition → FFmpeg render → clip in existing library.

The recommended MVP is deliberately narrow: feed parsing, a product browser UI, single-product video generation with Ken Burns + text overlays, and a sale banner template preset. This core workflow must be stable before batch processing is added. Batch generation is a thin layer on top of a working single-product flow — if single-product is reliable, batch is a queue wrapper; if single-product has bugs, batch multiplies those bugs by N. Competitors charge $39–$299/month for equivalent functionality; this system's only variable cost is ElevenLabs TTS for elaborate-mode voiceovers (~300 credits per 100-word script).

The two categories of risk that can derail v5 are encoding correctness issues (Romanian diacritics in FFmpeg drawtext will corrupt product names silently, font path resolution on WSL is error-prone, and aspect ratio handling for mixed-orientation product images requires explicit planning) and performance traps at batch scale (zoompan Ken Burns is 10-100x slower than regular encoding, synchronous image downloads block the render pipeline, and a 9,987-product feed loaded naively into memory creates OOM pressure). Both categories are avoidable with well-documented patterns that must be established in Phase 1.

## Key Findings

### Recommended Stack

The stack adds four new Python libraries to the existing platform, all with HIGH confidence. `lxml` (6.0.2) for streaming XML feed parsing with namespace support — the Nortia.ro feed has ~9,987 products and must be parsed with iterparse + element clearing to avoid 200-500 MB memory spikes. `Pillow` (12.1.1) for static image preparation — resizing, format conversion (WebP to JPEG), and letterboxing before FFmpeg handles animation. `beautifulsoup4` (4.14.3) paired with the already-installed `httpx` for optional product image scraping from product page URLs. `fal-client` (0.13.1) for optional AI image generation via FLUX.1, using the `FAL_API_KEY` already in `.env.example`. All FFmpeg composition (Ken Burns, text overlays, crossfade transitions) is implemented via subprocess calls to the existing FFmpeg binary — no new video library is needed.

**Core technologies:**
- `lxml` 6.0.2: Google Shopping XML feed parsing with namespace support — 2-10x faster than stdlib, full iterparse streaming
- `Pillow` 12.1.1: Image resize, format conversion, letterboxing before FFmpeg input — WebP/AVIF support critical for e-commerce feeds
- `beautifulsoup4` 4.14.3: Optional HTML scraping for extra product images — paired with existing `httpx`, no new HTTP library
- `fal-client` 0.13.1: Optional FLUX.1 AI image generation — FAL_API_KEY already in env; feature-flagged, explicit opt-in only
- FFmpeg `zoompan` filter: Ken Burns animation on product images — CPU-intensive, requires benchmarking and pre-scaling
- FFmpeg `drawtext` + `textfile=`: Product name, price, CTA text overlays — textfile mode required for Romanian diacritics
- Pexels API via `httpx`: Free stock video backgrounds — no new dependency, 200 req/hour free tier
- Python dataclasses: Video template system — matches existing `encoding_presets.py` pattern, not Jinja2

**New database tables:** `product_feeds`, `products`, `product_templates` (optional in v5) — 3 new migration files extending existing Supabase schema.

### Expected Features

**Must have (table stakes — v5 core):**
- Google Shopping XML feed ingestion from URL — entry point for all automation
- Product browser UI with search, on-sale filter, category filter — 9,987 products require pagination + filter
- Ken Burns zoom/pan on product images — minimum visual motion standard for social video
- Text overlays: product name, price, sale price (conditional), CTA — non-negotiable for product ads
- Sale banner template preset — highest commercial value; validates the entire concept
- Quick-mode TTS voiceover from template string (title + price + CTA) — wires to existing ElevenLabs/Edge TTS
- Single product → single video → library output — core atomic workflow

**Should have (add after v5 core validated):**
- Batch generation (select N products → N videos) — queue wrapper over single-product flow; most impactful for campaign scale
- AI-generated voiceover scripts (elaborate mode) — existing `script_generator` (Gemini/Claude) needs only a product-aware prompt
- Template presets (Product Spotlight, Sale Banner, Collection) — 3 named Python dataclass configs
- Per-profile template customization (colors, fonts, CTA text) — integrates with existing profile system
- Auto-filter shortcuts for on-sale / category selection

**Defer (v6+):**
- Multi-product collection video — different narrative architecture, higher complexity
- Web scraping for extra product images — fragile, adds 2-10s per product; validate single-image quality first
- Stock video backgrounds — different FFmpeg filter graph architecture, separate milestone
- AI image generation in batch mode — cost risk ($0.04-0.08/image), strict per-product opt-in required

**Anti-features to avoid:**
- Real-time video preview before render (FFmpeg render IS the preview at this scale)
- Automatic social publishing after batch (bypasses human review; Postiz already handles manual publishing)
- Background music (music rights, complicates audio normalization)
- Per-video customization UI inside batch (defeats batch purpose; defeats scale)

### Architecture Approach

The new system integrates as a single new router (`product_routes.py`) alongside existing routers, three new services (`feed_parser`, `image_fetcher`, `product_video_compositor`), two new frontend pages (`/products`, `/product-video`), and three new database migrations. The `product_video_compositor` is the architectural core — it builds FFmpeg filterchains for image-based video (scale+pad → zoompan → xfade → drawtext → ass subtitles) while calling the same `encoding_presets`, `audio_normalizer`, `subtitle_styler`, and `tts_subtitle_generator` services used by the existing script-first pipeline. Rendered videos are stored as rows in the existing `editai_clips` table and appear automatically in the `/library` page with no changes to library_routes.

**Major components:**
1. `feed_parser.py` — Google Shopping XML iterparse, namespace handling, product normalization, Supabase upsert
2. `image_fetcher.py` — Parallel image downloads (ThreadPoolExecutor, max 5 workers), disk cache, optional page scraping, fallback placeholder generation
3. `product_video_compositor.py` — FFmpeg filterchain builder: scale+pad (aspect ratio), zoompan (Ken Burns), xfade (transitions), drawtext via textfile (overlays), audio + subtitle integration, encoding preset application
4. `product_routes.py` — Thin router: feed CRUD, product listing with pagination/filters, job dispatch, polling endpoint
5. `/products` page — Feed config panel, filter bar, paginated product grid, batch selection with sticky action bar
6. `/product-video` page — Template selector (3 preset cards), settings panel, generation trigger, progress polling via existing `useJobPolling` hook

### Critical Pitfalls

1. **Romanian diacritics silently corrupted in FFmpeg drawtext** — Use `textfile=` (not inline `text=`) for all text overlays; bundle a Noto Sans or DejaVu Sans font with Romanian comma-below support; install `fonts-noto` in WSL. Establish this pattern in Phase 1 before any text overlay is built.

2. **XML feed loaded entirely into memory** — Use `lxml.etree.iterparse()` with explicit `elem.clear()` + parent removal after each item. A 10k-product feed becomes 200-500 MB as a Python object tree, creating OOM pressure during concurrent FFmpeg renders. Establish streaming pattern in Phase 1.

3. **Ken Burns (zoompan) is 10-100x slower than regular encoding** — Benchmark zoompan against a simple `scale+crop` alternative before committing as default. Pre-scale images to exact output resolution before zoompan. Set `-threads 0`. Offer a "simple" mode for batch speed. Address in Phase 2 before batch is built.

4. **Product images have unpredictable aspect ratios** — Feed images are mostly 1:1 square but include landscape and portrait variants. Use `scale=W:H:force_original_aspect_ratio=decrease` + `pad=W:H:(ow-iw)/2:(oh-ih)/2` to preserve ratio with letterbox. Test with real Nortia.ro feed images in Phase 2.

5. **Batch job errors kill the entire batch** — Design per-product state tracking (`ProductJobState` dataclass with `pending/downloading/rendering/done/failed` statuses) from the start of Phase 3. Wrap each product render in try/except and continue on failure — never re-raise inside the batch loop.

6. **HTML tags in feed descriptions break TTS** — Product descriptions frequently contain `<br/>`, `<p>`, `&amp;`, `&nbsp;`. Always run `clean_product_text()` (html.unescape + BeautifulSoup get_text + whitespace normalization + 500-char truncation) on all text fields at parse time, not at use time.

7. **WSL font path resolution breaks drawtext** — Use Linux font paths (`/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`) not Windows paths (`C:\Windows\Fonts\`). Windows paths in drawtext require colon escaping that conflicts with FFmpeg filter option syntax. Install `fonts-noto` in WSL explicitly.

## Implications for Roadmap

Based on research, the build order is strictly dependency-driven. The feed parser is a hard prerequisite for everything. The single-product video flow must be validated before batch is built. Text overlay correctness (diacritics, escaping) must be established before any template work. Architecture research provides an explicit 6-phase build sequence.

### Phase 1: Foundation — Feed Parser and Data Pipeline

**Rationale:** Feed parsing gates the entire feature. Database tables must exist before routes, routes before frontend. Text normalization and encoding correctness must be established first — retrofitting these after the compositor is built is painful. Per research, this phase must address Pitfalls 1 (diacritics/textfile), 2 (streaming XML), 6 (HTML in descriptions), 7 (product text sanitization), 9 (missing image fallback), 12 (WSL font path), and 13 (XML namespace parsing).

**Delivers:** Working Google Shopping XML parser with streaming iterparse; `product_feeds` + `products` Supabase tables (migrations 013, 014); `clean_product_text()` normalization utility; parallel image downloader with fallback placeholder; font resolution utility for WSL; confirmed `textfile=` pattern for drawtext.

**Addresses:** XML feed ingestion (table stakes P1); image download infrastructure; product data normalization.

**Avoids:** Memory spikes from full XML load; corrupted Romanian text in rendered videos; silent empty field parsing from namespace mishandling.

**Research flag:** Standard patterns — skip research-phase. lxml iterparse, parallel httpx downloads, and Pillow image prep are all well-documented with HIGH-confidence sources.

### Phase 2: Image-to-Video Compositor

**Rationale:** The core new technical work. Must be validated as a standalone component before it is called from routes or a batch. Ken Burns performance must be benchmarked here before batch multiplies the cost. Aspect ratio handling must be tested with real Nortia.ro feed images. Text overlay escaping for Romanian characters and % signs must be verified. Addresses Pitfalls 3 (image download timing), 4 (zoompan performance), 5 (aspect ratio), 10 (price % escaping).

**Delivers:** `product_video_compositor.py` service with Ken Burns filterchain, drawtext via textfile, xfade transitions, audio + subtitle integration, encoding preset application; `image_fetcher.py` with pre-download phase separated from render phase; Ken Burns vs simple-scale performance benchmark result; confirmed aspect ratio handling with real Nortia.ro feed images.

**Uses:** lxml (feed data), Pillow (image prep), FFmpeg zoompan/drawtext/xfade, existing `encoding_presets`, `audio_normalizer`, `subtitle_styler`, `tts_subtitle_generator`, ElevenLabs/Edge TTS.

**Implements:** `product_video_compositor.py` — the new architectural core.

**Avoids:** zoompan performance trap at batch scale; aspect ratio distortion on square e-commerce images; % character corruption in overlay text.

**Research flag:** Needs careful testing during execution — FFmpeg zoompan parameter tuning requires iteration against real images. Benchmark results will determine if simple-scale must be offered as batch fallback.

### Phase 3: Product API Routes and Product Browser UI

**Rationale:** With the compositor working, routes are straightforward thin wrappers following established patterns (BackgroundTask + immediate job_id return, lazy Supabase singleton, profile-scoped queries). The product browser UI is a net-new page but follows the same apiGet/apiPost pattern as existing pages. Feed sync must run as a BackgroundTask — a 10k-product feed can take 5-30 seconds.

**Delivers:** `product_routes.py` with /feeds/sync (BackgroundTask), /products (paginated + filtered), /generate, /generate/{job_id}; `/products` frontend page with feed config panel, filter bar (search, on-sale toggle, category dropdown), paginated product grid (50/page), batch selection sticky action bar.

**Addresses:** Product browser UI with search and filter (table stakes P1); job tracking (existing infrastructure reused); feed CRUD.

**Avoids:** Blocking feed sync in request handler; showing all 9,987 products in a single scrollable list.

**Research flag:** Standard patterns — existing router pattern (assembly_routes.py, pipeline_routes.py) is the direct template. No research-phase needed.

### Phase 4: Single Product Video Generator UI and End-to-End Flow

**Rationale:** Connect the compositor (Phase 2) to the routes (Phase 3) through a generation UI. This is the first end-to-end test: feed → browse → select → configure → generate → library. The `/product-video` page reuses the existing `useJobPolling` hook from the Pipeline page. This phase validates the full workflow before batch is introduced and constitutes the MVP milestone.

**Delivers:** `/product-video` frontend page with template selector (3 preset cards), settings panel (duration 15-60s, voiceover mode quick/ai, TTS provider), generation trigger, progress polling; quick-mode TTS voiceover wired to existing ElevenLabs/Edge TTS factory; single product → library clip confirmed working end-to-end.

**Addresses:** Ken Burns on product image (P1); text overlays (P1); sale banner template preset (P1); quick-mode voiceover (P1); single product → library output (P1). This delivers the MVP.

**Avoids:** Batch before single works; auto-publishing after generation; per-video customization UI in generation flow.

**Research flag:** Standard patterns — useJobPolling hook and template selector are directly modeled on existing Pipeline page. No research-phase needed.

### Phase 5: Batch Generation

**Rationale:** Batch is only safe to build after Phase 4 validates the single-product flow end-to-end. Batch is architecturally a sequential loop over single-product generation with per-product state tracking. The per-product state model (ProductJobState dataclass) must be designed before any batch rendering code is written. Addresses Pitfall 8 (batch error isolation).

**Delivers:** Batch job dispatch with per-product state tracking; progress grid UI (each product card shows queued/processing/done/failed); "Retry failed" button for partial batch recovery; estimated time + ElevenLabs credit preview before batch confirm; background processing with navigation freedom.

**Addresses:** Batch generation (P2 — add after single-product validated); most impactful for campaign scale.

**Avoids:** Batch error isolation failure (per-product try/except, never re-raise); all-or-nothing progress display; AI image generation default-on in batch (explicit opt-in only, Pitfall 11).

**Research flag:** The per-product state model is new territory — the existing single-job pattern does not directly apply. Plan the BatchJob/ProductJobState data structures before writing any render loop code.

### Phase 6: Template System and Profile Customization

**Rationale:** Template presets and per-profile customization build on a working generation pipeline. Templates are Python dataclasses following the `encoding_presets` pattern — no new infrastructure. Profile customization extends the existing profile system. These are polish features that improve consistency across campaigns.

**Delivers:** 3 named template presets as Python dataclasses (Product Spotlight, Sale Banner, Collection); per-profile settings (primary/accent color, font family, CTA text); optional `product_templates` Supabase table (migration 015); AI-generated voiceover scripts via existing `script_generator` in elaborate mode with a product-aware prompt.

**Addresses:** Template presets (P2); per-profile customization (P2); AI voiceover scripts (P2).

**Avoids:** Too many templates (Creatify's 370+ causes choice paralysis — 3 presets is the correct number per UX research).

**Research flag:** Standard patterns — mirrors encoding_presets.py dataclass approach exactly. No research-phase needed.

### Phase Ordering Rationale

- Feed parser is a hard prerequisite for every subsequent phase — it cannot be skipped or deferred.
- Text encoding correctness (diacritics, textfile=, font path) must be established in Phase 1 because the compositor in Phase 2 inherits those foundations. Fixing encoding after the compositor is built means re-testing every code path.
- The compositor (Phase 2) is isolated from the API layer (Phase 3) deliberately — this allows benchmarking and testing the FFmpeg filterchain without needing a working frontend.
- Single-product end-to-end (Phase 4) before batch (Phase 5) is a hard rule from feature research: "Batch is single-product × N with a queue wrapper. Ship and validate single first."
- Template system (Phase 6) is deliberately last — it enhances a working pipeline rather than enabling it.

### Research Flags

Phases needing careful testing or iteration during execution:
- **Phase 2 (compositor):** FFmpeg zoompan parameter tuning requires real Nortia.ro feed images. Benchmark Ken Burns vs simple-scale before finalizing — if zoompan takes >30s per clip, offer simple-scale as batch default.
- **Phase 5 (batch):** Per-product state model has no direct precedent in existing codebase. Design the BatchJob/ProductJobState data structures before writing any render loop code.

Phases with standard, well-established patterns (no research-phase needed):
- **Phase 1:** lxml iterparse, parallel httpx downloads, Pillow image prep — all HIGH-confidence, well-documented.
- **Phase 3:** Follows existing router pattern (assembly_routes.py, pipeline_routes.py) directly.
- **Phase 4:** Follows existing Pipeline page + useJobPolling pattern directly.
- **Phase 6:** Follows existing encoding_presets.py dataclass pattern directly.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All 4 new library versions verified on PyPI 2026-02-20; FFmpeg techniques confirmed with official docs and multiple community sources |
| Features | HIGH (core), MEDIUM (visual sources), LOW (AI image gen) | Core feature set confirmed by competitor analysis and feature dependency mapping; web scraping reliability is site-specific; AI image generation cost and quality under load not tested |
| Architecture | HIGH | Integration points verified by direct codebase inspection; existing migration patterns confirmed; FFmpeg filterchain patterns are MEDIUM (require parameter tuning with real images) |
| Pitfalls | HIGH (FFmpeg/XML), MEDIUM (web scraping, AI costs) | FFmpeg escaping pitfalls confirmed from official docs; Romanian-specific issues confirmed from multiple sources; web scraping site behavior is speculative until tested against Nortia.ro |

**Overall confidence:** HIGH for core MVP scope (Phases 1-4); MEDIUM for batch and template phases (Phases 5-6); LOW for optional features (web scraping, AI image generation).

### Gaps to Address

- **Nortia.ro feed structure:** Architecture research recommends testing against the actual feed file before finalizing the parser. Field availability, custom Google Shopping extensions, and character encoding in Romanian feed data may differ from the spec. Obtain the actual feed URL and validate during Phase 1 implementation.
- **Ken Burns performance on target hardware:** Exact render times for zoompan at 1080x1920 on the development machine are unknown. PITFALLS.md notes 30-90s per clip is typical on a dev machine. Benchmark in Phase 2 and set user expectations accordingly — or provide simple-scale as batch default.
- **Nortia.ro scraping viability:** PITFALLS.md flags Cloudflare protection as a risk for Romanian e-commerce sites. Web scraping is a v6+ feature but its viability should be confirmed early so it is not over-planned.
- **ElevenLabs credit budget at batch scale:** With 100k credits/month and 40-160 credits per product video (quick mode template text), batch processing at scale approaches the budget ceiling. Quick-mode voiceovers should default to Edge TTS (free) for batch; ElevenLabs reserved for elaborate mode with explicit opt-in.

## Sources

### Primary (HIGH confidence)
- Existing codebase (`app/main.py`, all router files, all service files) — read directly 2026-02-20
- Existing DB migrations (001 through 012) — schema patterns verified directly
- [lxml performance benchmarks](https://lxml.de/performance.html) — iterparse vs ElementTree
- [lxml PyPI](https://pypi.org/project/lxml/) — version 6.0.2 verified
- [Pillow PyPI](https://pypi.org/project/pillow/) — version 12.1.1 verified
- [beautifulsoup4 PyPI](https://pypi.org/project/beautifulsoup4/) — version 4.14.3 verified
- [fal-client PyPI](https://pypi.org/project/fal-client/) — version 0.13.1 verified 2026-02-20
- [FFmpeg drawtext filter docs](https://ffmpeg.org/ffmpeg-filters.html) — textfile option, escaping rules
- [Google Shopping XML feed specification](https://support.google.com/merchants/answer/7052112) — field names and namespaces
- [Pexels API documentation](https://www.pexels.com/api/documentation/) — free tier confirmed

### Secondary (MEDIUM confidence)
- [Bannerbear Ken Burns FFmpeg guide](https://www.bannerbear.com/blog/how-to-do-a-ken-burns-style-effect-with-ffmpeg/) — zoompan technique and parameters
- [OTTVerse drawtext guide](https://ottverse.com/ffmpeg-drawtext-filter-dynamic-overlays-timecode-scrolling-text-credits/) — multi-layer text overlays
- [Mux FFmpeg concat guide](https://www.mux.com/articles/create-a-video-slideshow-with-images-using-ffmpeg) — slideshow concat patterns
- [Creatomate slideshow guide](https://creatomate.com/blog/how-to-create-a-slideshow-from-images-using-ffmpeg) — aspect ratio handling
- [FFmpeg drawtext escaping levels](https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/drawing_texts/drawtext.html) — four-level escaping documentation
- [NemoVideo batch UX patterns](https://www.nemovideo.com/blog/batch-video-generator-scale-output) — batch video workflow UX
- [Eleken bulk action UX guidelines](https://www.eleken.co/blog-posts/bulk-actions-ux) — bulk selection and wizard UX
- [Tolstoy ecommerce video at scale](https://www.gotolstoy.com/blog/product-videos-for-ecommerce) — batch-at-scale patterns

### Tertiary (LOW confidence — needs validation)
- [fal.ai FLUX.2 announcement](https://blog.fal.ai/flux-2-is-now-available-on-fal/) — FLUX model availability; pricing under load untested
- [Cloudflare bypass options](https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping) — Nortia.ro scraping viability not confirmed
- [Google Shopping feed data quality issues](https://feedarmy.com/kb/common-google-shopping-errors-problems-mistakes/) — description HTML contamination patterns

---
*Research completed: 2026-02-20*
*Ready for roadmap: yes*
