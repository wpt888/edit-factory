# Feature Research

**Domain:** Product video generation from e-commerce product feeds
**Researched:** 2026-02-20
**Confidence:** HIGH (core features and UX patterns), MEDIUM (visual source features), LOW (AI visual generation)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Product feed ingestion (XML/URL) | Without feed import, nothing is automated — it is the entry point | MEDIUM | Google Shopping XML (`xml.etree.ElementTree` or `lxml`); standard fields: id, title, description, image_link, link, price, sale_price, brand, product_type; Nortia.ro feed has ~9,987 products |
| Product browser with search and filter | ~10k products are unusable without browsing; this is the product selection UX | MEDIUM | Filter by: on-sale (sale_price exists), category/product_type, brand; full-text search on title; visual card grid not data table; virtual scroll or pagination required |
| Ken Burns zoom/pan on product image | Static image videos look cheap and unfinished; motion is minimum viable engagement | MEDIUM | FFmpeg `zoompan` filter handles this natively (confirmed feasible); parameterize zoom direction and speed; ~4-6s per image at 30fps; slow zoom in or out |
| Text overlays: product name, price, CTA | Price and product name are non-negotiable for product ads; without them it is not a product video | MEDIUM | FFmpeg `drawtext` filter; multiple layers with position, font, color, size; safe zone margins for TikTok/Reels (150px each side); CTA text configurable per template |
| Sale badge / sale price overlay | Conditional overlay when sale_price < price; highest-converting element in e-commerce ads | LOW | Conditional on feed data; show original price with strikethrough + sale price highlighted; "SALE" badge with background box; drawtext with box=1 parameter |
| TTS voiceover from product data (quick mode) | Video without audio converts poorly on social; every product video tool includes voiceover | LOW | Feed fields (title + price + sale_price + brand) → template string → existing TTS pipeline; wire product data to existing ElevenLabs/Edge service; no new TTS work needed |
| Auto-generated subtitles | Platform requirement; 85% of social video watched with sound off | LOW | Already built in v4 — TTS timestamp → SRT pipeline; no new work needed; just wire product TTS output to existing subtitle generator |
| Video duration control (15–60s) | Platform-specific requirements; TikTok ad specs vs Reels differ | LOW | Target duration drives TTS script length (word count); configurable 15/30/45/60s presets; existing target_duration field in library projects |
| Platform export presets (9:16 vertical) | TikTok/Reels/Shorts are primary targets; wrong aspect ratio = automatic rejection | LOW | Already built in v3 — encoding_presets service handles aspect ratio and encoding; just pass through to existing preset system |
| Job tracking with progress feedback | Batch jobs feel broken without feedback; single long job needs progress too | LOW | Already built — existing JobStorage + polling system; just needs product-specific job types |
| Output clips to existing library | Videos must be discoverable and manageable alongside other content | LOW | Already built — clips + projects schema in Supabase; product videos are just another clip type |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valued.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Batch generation (select N products → generate N videos) | 50 videos for 50 products in one action; competitors (Creatify, Predis) charge $39–$299/mo; zero marginal cost here | HIGH | Queue-based; per-product job tracking; UI shows batch progress grid (not single progress bar); most impactful feature for campaign scale; build on existing JobStorage |
| AI-generated voiceover scripts (elaborate mode) | Generic price+name templates produce boring copy; AI generates varied, engaging scripts from description | MEDIUM | Existing script_generator (Gemini + Claude Max) already accepts text input; needs product-aware prompt; toggle between quick mode and elaborate mode; ElevenLabs flash v2.5 at 0.5 credits/char — ~100 word script = ~600 chars = 300 credits |
| Auto-filter: on-sale products | Campaign trigger — sale products most likely to need video; one-click selection of all on-sale items | LOW | Filter condition: `sale_price` field present AND `sale_price` < `price`; "Select all on sale" shortcut in product browser |
| Auto-filter: product categories | Run batch for a single category (shoes, bags, accessories) without manual selection | LOW | `product_type` field in Google Shopping XML; extract unique categories from feed → populate filter dropdown; preserves multi-category feeds |
| Template presets (Product Spotlight, Sale Banner, Collection) | Named presets reduce configuration decisions; visual consistency across campaign | MEDIUM | Store template config as Python dataclass or JSON: overlay positions, colors, font, animation direction, CTA text; 3 starter presets; consistent with existing encoding_presets pattern |
| Per-profile template customization (colors, fonts, CTA text) | Two stores (Nortia.ro + second brand) have different brand identities | MEDIUM | Profile-scoped template settings; primary/accent color, font family, CTA text, logo image path; integrate into existing profile system (profile already stores TTS voice, Postiz config) |
| Multi-product collection video | Showcase 3–5 products in one video for gift guides, category highlights | HIGH | Sequence multiple product segments with per-product intro card; total runtime = sum of segments; different narrative logic — intro script covers all products; requires product ordering UI |
| Web scraping extra product images | Single feed image not enough for engaging video; scrape 2–3 more images from product page URL | HIGH | `requests` + `BeautifulSoup` targeting `og:image`, gallery images; async pre-fetch and cache per product; fragile against site layout changes; adds 2–10s per product |
| Stock video backgrounds | Product-only videos can feel flat; background motion adds energy and professionalism | HIGH | Free stock APIs: Pexels (free tier, 200 req/hour), Pixabay (free, 100 req/min); category keyword → search query; download + cache; composite product image overlay on top; different FFmpeg filter graph than Ken Burns approach |
| Duplicate image detection before video | Feed may contain repeated images causing duplicate frames | LOW | Existing pHash perceptual hashing already in codebase (used for segment dedup); apply to product image set before compositing |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time video preview before render | "See what it will look like" | FFmpeg render IS the render; lightweight previews never match final; complex infrastructure (Remotion/Canvas); already documented in PROJECT.md out-of-scope | Show static layout mockup with overlay positions labeled; first render is inexpensive enough to be the preview |
| AI-generated product images (DALL-E / Stable Diffusion / Luma AI) | "Generate lifestyle shots from product description" | $0.04–0.08 per image, high volume cost; product details often inaccurate in AI generations; adds 10–30s per video; quality inconsistent | Use existing product images with Ken Burns; scrape extra images from product URL; stock video backgrounds as visual complement |
| Shoppable video (tap-to-buy overlay) | Seen in Creatify, Google Demand Gen Ads | Platform-specific SDK required per network (TikTok, Instagram, YouTube); this is a publishing-layer feature, not a composition feature; out of scope for FFmpeg rendering | Add product URL to social media post text in Postiz publishing step |
| Background music auto-selection | "AI matches music to product mood" | Music rights issues with licensed tracks; royalty-free APIs require integration and attribution; most social video is watched muted anyway; complicates audio normalization | Keep audio-only-if-voiceover approach; product voiceover is the audio track |
| 360-degree product spin video | "Generate product rotation from single image" | Requires AI image-to-3D pipeline or multi-angle photos (not in feeds); technically complex, high failure rate from single image; no tool does this reliably yet | Ken Burns zoom gives perceived motion and dynamism without needing multi-angle input |
| Per-video customization UI in batch | "Let me tweak each video before generating" | Defeats the purpose of batch processing; creates serial bottleneck; transforms 10-minute batch into 2-hour manual process | Configure template at batch-start; allow post-generation editing of individual clips in existing library |
| Manual product entry (CSV or form) | "I want to add products not in the feed" | Duplicates feed parser work; creates data sync issues between manual entries and feed data; two sources of truth | Use feed as single source of truth; if needed, provide template XML for one-off imports |
| Automatic social media posting after batch | "Generate and publish in one step" | Bypasses human review of generated content; bad videos get published automatically; existing Postiz integration already handles publishing with manual approval | Keep generation and publishing as separate steps; library is the review layer |

## Feature Dependencies

```
[Google Shopping XML Feed Parsing]
    └──required by──> [Product Browser UI]
    └──required by──> [Single Product Video Generation]
    └──required by──> [Batch Generation]
    └──required by──> [Auto-filter: On Sale / Category]
    └──required by──> [Sale Badge Overlay] (conditional on sale_price field)
    └──required by──> [Web Scraping Extra Images] (uses feed link field)

[Single Product Video Generation]
    ├──requires──> [Feed Parsing] (product data source)
    ├──requires──> [Ken Burns on product image] (visual source)
    ├──requires──> [Text Overlays] (name, price, CTA)
    ├──requires──> [TTS Pipeline] (already built — voiceover)
    ├──requires──> [Subtitle Pipeline] (already built — TTS timestamps)
    └──produces──> [Clip in Library] (existing library management)

[Batch Generation]
    └──requires──> [Single Product Video Generation] (must be stable and tested first)
    └──requires──> [Product Browser UI] (multi-select)
    └──requires──> [Job Queue] (existing JobStorage)

[Sale Badge Overlay]
    └──requires──> [Feed Parsing] (sale_price field)
    └──requires──> [Text Overlays] (drawtext with box)
    └──enhances──> [Single Product Video Generation]

[AI Voiceover Scripts (elaborate mode)]
    └──requires──> [Feed Parsing] (description + title)
    └──requires──> [Script Generator] (already built — Gemini/Claude)
    └──enhances──> [Single Product Video Generation] (replaces quick mode template)

[Template Presets]
    └──requires──> [Text Overlays] (overlay config parameterized)
    └──requires──> [Ken Burns] (animation config parameterized)
    └──integrates with──> [Profile System] (already built — per-profile settings)
    └──enhances──> [All video generation features]

[Multi-Product Collection Video]
    └──requires──> [Single Product Video Generation] (working reliably)
    └──requires──> [Product Browser UI] (multi-select with ordering)
    └──different architecture from──> [Single product] (sequence logic, intro script)

[Web Scraping Extra Images]
    └──requires──> [Feed Parsing] (link field for product URL)
    └──enhances──> [Ken Burns on product image] (more source frames)
    └──conflicts with──> [Fast Batch Generation] (adds 2-10s per product)

[Stock Video Backgrounds]
    └──requires──> [Text Overlays] (product image composited over background)
    └──conflicts with──> [Ken Burns-only workflow] (different FFmpeg filter graph)
    └──requires separate template type from──> [Product Spotlight preset]

[Per-Profile Template Customization]
    └──integrates with──> [Profile System] (already built)
    └──requires──> [Template Presets] (customizes existing presets)
```

### Dependency Notes

- **Feed parsing gates everything:** No product data = no product video. Must be Phase 1, Day 1.
- **Single product before batch:** Batch is single-product × N with a queue wrapper. Ship and validate single first; batch is a thin layer on top.
- **Web scraping conflicts with batch speed:** Scraping adds 2–10s per product page. For a 50-product batch, that is 100–500 seconds of scraping alone. Implement as optional async pre-fetch job that runs before batch, not inline.
- **Stock backgrounds vs Ken Burns:** These are different FFmpeg filter graph architectures. Ken Burns: `scale → zoompan → fade → drawtext`. Stock background: `[bg_video][product_img]overlay → drawtext`. Implement as separate template type, not an option in the same template.
- **Template presets follow existing pattern:** encoding_presets in v3 used Python dataclasses. Template presets should follow the same pattern — not a database table, a service module with named configs.

## MVP Definition

### Launch With (v5 core)

Minimum to generate the first useful product video from the Nortia.ro feed.

- [ ] Google Shopping XML feed parsing — without this, nothing works
- [ ] Product browser UI with search, on-sale filter, category filter — 9,987 products require it
- [ ] Ken Burns zoom/pan on feed image — minimum visual motion
- [ ] Text overlays: product name, price, sale price (conditional), CTA — table stakes for product video
- [ ] Sale banner template preset — highest commercial value; validates the whole concept
- [ ] Quick-mode voiceover from template (title + price + CTA) — fastest path to audio
- [ ] Single product → single video → library output — core atomic workflow

### Add After Validation (v5.x)

Add after single-product flow is tested and producing real videos for Nortia.ro.

- [ ] Batch generation — trigger: single product works reliably; adds scale
- [ ] AI-generated voiceover scripts (elaborate mode) — trigger: quick mode templates feel too generic in practice
- [ ] Template presets (3 named: Spotlight, Sale Banner, Collection) — trigger: brand consistency needed across campaigns
- [ ] Per-profile template customization (colors, fonts, CTA text) — trigger: second store brand differs from Nortia.ro

### Future Consideration (v6+)

Defer until v5 core is producing regular videos.

- [ ] Multi-product collection video — requires reliable single product; different narrative logic; higher complexity
- [ ] Web scraping extra product images — fragile, adds latency, complex error handling; validate single-image quality first
- [ ] Stock video backgrounds — different composition architecture; separate milestone
- [ ] Auto-filter: new in stock / recently added — requires feed version comparison / timestamp tracking

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| XML feed parsing | HIGH | MEDIUM | P1 |
| Product browser UI (search + filter) | HIGH | MEDIUM | P1 |
| Ken Burns on product image | HIGH | LOW | P1 |
| Text overlays (name, price, CTA) | HIGH | MEDIUM | P1 |
| Sale banner (conditional overlay) | HIGH | LOW | P1 |
| Quick-mode TTS voiceover | HIGH | LOW | P1 |
| Single product → library output | HIGH | LOW | P1 |
| Batch generation | HIGH | HIGH | P2 |
| AI voiceover scripts (elaborate mode) | MEDIUM | LOW | P2 |
| Template presets (3 named configs) | MEDIUM | MEDIUM | P2 |
| Per-profile template customization | MEDIUM | MEDIUM | P2 |
| Auto-filter: on sale / category | MEDIUM | LOW | P2 |
| Multi-product collection video | MEDIUM | HIGH | P3 |
| Web scraping extra images | MEDIUM | HIGH | P3 |
| Stock video backgrounds | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v5 launch — core milestone
- P2: Should have — add after single-product flow validated
- P3: Nice to have — future milestone

## Competitor Feature Analysis

| Feature | Creatify | Predis.ai | Creatomate | Our Approach |
|---------|----------|-----------|------------|--------------|
| Feed ingestion | URL scraping (no XML) | Catalog import (CSV/API) | JSON/CSV via REST API | Google Shopping XML directly; standard format already used for Merchant Center |
| Template system | 370+ templates (too many; choice paralysis) | Auto-generated per format | JSON-defined via API | 3 named presets as Python dataclasses; profile-scoped customization |
| Batch generation | Yes, on paid tiers ($79–$299/mo) | Yes, multi-format | Yes, via API automation | Queue-based using existing JobStorage; zero incremental cost |
| Voiceover | AI avatars + TTS | Text-to-speech | Not built-in | Existing ElevenLabs/Edge TTS — already integrated |
| Subtitles | Auto-generated | Auto-generated | Optional add-on | Existing TTS-timestamp → SRT pipeline — already built in v4 |
| Ken Burns / motion | Basic pan/zoom | Not prominent | Not built-in | FFmpeg zoompan filter — native, no new dependency |
| Price / sale overlays | Sale badge variants | Auto-detected from feed | Custom via JSON template | Conditional drawtext: sale_price present → sale badge; programmatic |
| Social publishing | Not built-in (export only) | Built-in scheduler | Not built-in | Existing Postiz integration — already wired |
| Cost | $39–$299/month | $27–$249/month | $49+/month + per-render fees | Zero marginal cost per video (uses existing APIs); only ElevenLabs chars for elaborate mode |

**Key competitive insight:** Competitors charge high monthly fees or per-render API costs. This system uses existing FFmpeg infrastructure at zero marginal cost. The only variable cost is ElevenLabs TTS for elaborate-mode scripts — at flash v2.5 rate of 0.5 credits/char, a 100-word script (~600 chars) costs 300 credits. With 100k credits/month on the Starter plan, that is ~333 elaborate-mode videos per month before hitting the limit. Quick-mode template voiceover is still free via Edge TTS.

## UX Patterns for Product Video Generation

### Feed Browsing (Product Browser Page)

**Visual grid, not data table.** Product cards with thumbnail, title, truncated price, sale badge. Users need to visually scan products, not parse rows of data.

**Sticky filter bar** at top of page: search input (debounced, searches title), on-sale toggle (most common campaign use case), category dropdown (product_type values from feed), brand dropdown.

**Batch selection UX pattern:** Checkbox on each card; sticky action bar at bottom appears when items are selected showing count ("14 products selected") and primary CTA ("Generate Videos"). "Select all on sale" shortcut. "Clear selection" button.

**Quick preview on hover:** Full title, price both original and sale, description snippet in a tooltip or expanded card.

**Pagination** over infinite scroll for batch workflows — users need to know where they are in a 9,987-item list; page numbers help with "I reviewed page 1-3" mental model.

### Template Selection

**Preset cards with visual thumbnail previews**, not a dropdown. Users need to see what they are selecting before committing to a batch. Three preset cards is the right number — more causes choice paralysis (confirmed by Creatify's 370+ template UX as anti-pattern).

**Last-used template is default** — users run campaigns and typically use the same template for a full campaign run.

**Template config summary** below the selected preset: "Sale price badge: ON | Font: [profile font] | Duration: 30s | CTA: [profile CTA text]" — shows what will be used without opening an editor.

### Batch Processing Workflow (Wizard Pattern)

Industry standard wizard confirmed by research: Select products → Choose template → Configure options → Review → Generate.

**Review step before generation** is critical: show "12 products × 30s each × estimated ElevenLabs cost: 3,600 credits" summary. User confirms before compute starts.

**Progress grid during generation:** Each product card shows status (queued / processing / done / error). Not a single progress bar — users want to know which specific products are done and which failed.

**Partial batch failures are expected:** Bad image URL, TTS character limit exceeded, feed data missing required field. Show error inline per product card. Provide "Retry failed" button for the batch.

**Background processing with navigation freedom:** User can navigate away; jobs persist in JobStorage. Batch progress visible from anywhere via existing polling mechanism.

### Single Product Video Editing

**Inline voiceover text editing** before rendering — quick-mode template text is editable in place. User can see the exact script before committing TTS credits.

**Duration selector** as discrete steps (15s / 30s / 45s / 60s), not a continuous slider. Maps to TTS script word count targets; discrete steps simplify rendering logic.

**Template override per video:** Change template for this one video without changing the profile default. Needed for one-off custom videos alongside batch campaigns.

## Sources

- [Creatify product video generator features](https://creatify.ai/features/product-video) — feature set and template volume
- [Predis.ai multi-format generator](https://predis.ai/resources/best-ai-ad-generators/) — competitive feature set
- [Creatomate video API review](https://www.plainlyvideos.com/blog/creatomate-review) — template/batch architecture patterns
- [NemoVideo batch video generator](https://www.nemovideo.com/blog/batch-video-generator-scale-output) — batch UX and workflow patterns
- [Eleken bulk action UX guidelines](https://www.eleken.co/blog-posts/bulk-actions-ux) — bulk selection and wizard UX
- [Bannerbear Ken Burns FFmpeg guide](https://www.bannerbear.com/blog/how-to-do-a-ken-burns-style-effect-with-ffmpeg/) — FFmpeg zoompan feasibility confirmed
- [Creatomate FFmpeg slideshow guide](https://creatomate.com/blog/how-to-create-a-slideshow-from-images-using-ffmpeg) — multi-image composition patterns
- [Google Demand Gen product feeds 2025](https://blog.google/products/ads-commerce/new-demand-gen-features-2025/) — industry direction; Asset Studio auto-generates videos from product feeds
- [Mintly best AI generators for ecommerce 2025](https://usemintly.com/blog/best-ai-video-generators-for-ecommerce-in-2025-ranked) — market landscape
- [Text overlay CTR impact study](https://overlaytext.com/blog/text-overlay-marketing-business-graphics) — validates text overlays as table stakes
- [Ecommerce product video at scale (Tolstoy)](https://www.gotolstoy.com/blog/product-videos-for-ecommerce) — batch-at-scale patterns and shoppable video anti-feature
- [Top ecommerce video mistakes (Pippit)](https://www.pippit.ai/resource/the-top-5-mistakes-to-avoid-during-ecommerce-video-editing) — pitfall research

---
*Feature research for: Product video generation from e-commerce product feeds (v5 milestone)*
*Researched: 2026-02-20*
