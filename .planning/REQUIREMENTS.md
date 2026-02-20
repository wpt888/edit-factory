# Requirements: Edit Factory

**Defined:** 2026-02-20
**Core Value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.

## v5 Requirements

Requirements for v5 Product Video Generator. Each maps to roadmap phases.

### Feed & Data

- [ ] **FEED-01**: User can add a Google Shopping XML feed URL and sync product data
- [ ] **FEED-02**: User can browse synced products in a visual card grid with pagination
- [ ] **FEED-03**: User can search products by title (full-text search)
- [ ] **FEED-04**: User can filter products by on-sale status (sale_price < price)
- [ ] **FEED-05**: User can filter products by product category (from product_type field)
- [ ] **FEED-06**: User can filter products by brand
- [ ] **FEED-07**: Feed sync handles ~10k products efficiently (streaming XML parse, no memory spike)

### Video Composition

- [ ] **COMP-01**: System generates Ken Burns zoom/pan animation from product image (FFmpeg zoompan)
- [ ] **COMP-02**: System renders text overlays: product name, price, sale price (with strikethrough), brand
- [ ] **COMP-03**: System renders sale badge overlay when product has sale_price
- [ ] **COMP-04**: System renders CTA text overlay (configurable, e.g. "Comanda acum!")
- [ ] **COMP-05**: Text overlays handle Romanian diacritics correctly (UTF-8 textfile= pattern)
- [ ] **COMP-06**: User can set video duration (15/30/45/60 seconds)

### Voiceover & Subtitles

- [ ] **TTS-01**: Quick mode: system generates voiceover from template text (title + price + brand)
- [ ] **TTS-02**: Elaborate mode: AI generates engaging voiceover script from product description (Gemini/Claude)
- [ ] **TTS-03**: User can choose TTS provider (ElevenLabs or Edge TTS) — Edge TTS default for batch
- [ ] **TTS-04**: System generates synced subtitles from TTS timestamps (reuse v4 pipeline)

### Templates

- [ ] **TMPL-01**: System provides 3 preset templates: Product Spotlight, Sale Banner, Collection Showcase
- [ ] **TMPL-02**: User can customize template: colors (primary/accent), font, CTA text
- [ ] **TMPL-03**: Template customization is per-profile (two stores, two brand identities)
- [ ] **TMPL-04**: Templates define: overlay positions, animation direction, text layout, safe zones for TikTok/Reels

### Batch & Generation

- [ ] **BATCH-01**: User can generate a single product video and preview it
- [ ] **BATCH-02**: User can select multiple products and generate videos in batch
- [ ] **BATCH-03**: Batch generation has per-product error isolation (one failure doesn't kill the batch)
- [ ] **BATCH-04**: Batch UI shows per-product progress (not single progress bar)
- [ ] **BATCH-05**: Generated videos land in existing library (clips table) for review and publishing

### Output & Integration

- [ ] **OUT-01**: Rendered videos use existing encoding presets (TikTok, Reels, YouTube Shorts)
- [ ] **OUT-02**: Rendered videos use existing audio normalization (-14 LUFS)
- [ ] **OUT-03**: Rendered videos use existing video filters if enabled (denoise, sharpen, color)
- [ ] **OUT-04**: Product videos are publishable via existing Postiz integration

## Future Requirements

### Visual Source Expansion (v6+)
- **VIS-01**: Web scraping additional product images from product page URL
- **VIS-02**: Stock video backgrounds from Pexels/Pixabay API with product overlay
- **VIS-03**: AI-generated product visuals from description (fal.ai FLUX)
- **VIS-04**: Duplicate image detection via pHash before compositing

### Advanced Features (v6+)
- **ADV-01**: Multi-product collection video (3-5 products in one video)
- **ADV-02**: Multiple feed URL support per profile
- **ADV-03**: Scheduled feed re-sync (auto-refresh product data)
- **ADV-04**: Feed diff detection (new/updated/removed products)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Real-time video preview | FFmpeg render IS the render; static layout mockup sufficient |
| AI-generated product images | $0.04-0.08/image, quality inconsistent, product details often wrong |
| Shoppable video (tap-to-buy) | Platform-specific SDK per network, out of scope for FFmpeg |
| Background music auto-selection | Rights issues, most social video watched muted |
| 360-degree product spin | Requires multi-angle photos not in feeds |
| Per-video customization in batch | Defeats batch purpose; edit individually in library after |
| Manual product entry (CSV/form) | Feed is single source of truth |
| Auto-publish after batch | Bypasses human review; library is review layer |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FEED-01 | TBD | Pending |
| FEED-02 | TBD | Pending |
| FEED-03 | TBD | Pending |
| FEED-04 | TBD | Pending |
| FEED-05 | TBD | Pending |
| FEED-06 | TBD | Pending |
| FEED-07 | TBD | Pending |
| COMP-01 | TBD | Pending |
| COMP-02 | TBD | Pending |
| COMP-03 | TBD | Pending |
| COMP-04 | TBD | Pending |
| COMP-05 | TBD | Pending |
| COMP-06 | TBD | Pending |
| TTS-01 | TBD | Pending |
| TTS-02 | TBD | Pending |
| TTS-03 | TBD | Pending |
| TTS-04 | TBD | Pending |
| TMPL-01 | TBD | Pending |
| TMPL-02 | TBD | Pending |
| TMPL-03 | TBD | Pending |
| TMPL-04 | TBD | Pending |
| BATCH-01 | TBD | Pending |
| BATCH-02 | TBD | Pending |
| BATCH-03 | TBD | Pending |
| BATCH-04 | TBD | Pending |
| BATCH-05 | TBD | Pending |
| OUT-01 | TBD | Pending |
| OUT-02 | TBD | Pending |
| OUT-03 | TBD | Pending |
| OUT-04 | TBD | Pending |

**Coverage:**
- v5 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 (roadmap pending)

---
*Requirements defined: 2026-02-20*
*Last updated: 2026-02-20 after initial definition*
