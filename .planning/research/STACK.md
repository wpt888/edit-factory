# Stack Research — v5 Product Video Generator

**Domain:** Product feed video generation (Google Shopping XML → social video)
**Researched:** 2026-02-20
**Confidence:** HIGH (PyPI verified versions, FFmpeg official docs, multiple sources)

> **Scope:** NEW additions only. The existing stack (FastAPI, Next.js, Supabase, FFmpeg,
> OpenCV, httpx, ElevenLabs, Edge TTS, Gemini, Claude, Whisper) is already validated.
> Do not re-install or re-research existing capabilities.

---

## What Already Exists (Do Not Re-Add)

| Capability | Library | Notes |
|------------|---------|-------|
| HTTP requests (sync + async) | `httpx>=0.25.0` | In requirements.txt — use for image downloads |
| AI text generation | `anthropic`, `google-genai` | Already integrated in script_generator |
| TTS audio | ElevenLabs, Edge TTS | Already integrated |
| FFmpeg subprocess | Used throughout assembly_service | Call via subprocess.run |
| Image quality | `opencv-python-headless` | Already installed |
| Async file I/O | `aiofiles` | Already installed |
| Config/env | `python-dotenv`, `pydantic-settings` | Already in use |

---

## New Dependencies Required

### 1. XML Parsing — `lxml` 6.0.2

**Install:** `pip install "lxml>=6.0.0"`

Google Shopping feeds are large XML files (~10k products, multi-MB). `lxml` is the right
choice over stdlib `xml.etree.ElementTree` for three reasons:

- **Speed:** 2-10x faster on large files. lxml parsed a 95MB XML in 0.35s vs 2+ seconds
  for ElementTree (measured benchmark from lxml.de/performance.html).
- **Memory-efficient streaming:** `lxml.etree.iterparse()` processes feeds element-by-element
  without loading the full document into memory. Critical for 9,987-product feeds.
- **XPath support:** Google Shopping uses XML namespaces (`g:` prefix for Shopping
  attributes). lxml's full XPath 1.0 support handles namespace-qualified queries cleanly.
  ElementTree's namespace handling is verbose and error-prone.

Do NOT use `feedparser` — it targets Atom/RSS feeds, not Google Shopping XML format.
Do NOT use stdlib `xml.etree.ElementTree` — no streaming iterparse with namespace support.

```python
# Usage pattern for Google Shopping feed
from lxml import etree

NS = {
    'g': 'http://base.google.com/ns/1.0',
    'c': 'http://base.google.com/cns/1.0'
}

def stream_products(feed_path: str):
    for event, elem in etree.iterparse(feed_path, events=('end',), tag='item'):
        yield {
            'id': elem.findtext('g:id', namespaces=NS),
            'title': elem.findtext('title'),
            'description': elem.findtext('description'),
            'image_link': elem.findtext('g:image_link', namespaces=NS),
            'price': elem.findtext('g:price', namespaces=NS),
            'sale_price': elem.findtext('g:sale_price', namespaces=NS),
            'brand': elem.findtext('g:brand', namespaces=NS),
            'product_type': elem.findtext('g:product_type', namespaces=NS),
            'link': elem.findtext('link'),
        }
        elem.clear()  # Free memory after processing each item
```

**Confidence:** HIGH — lxml.de performance benchmarks + PyPI version 6.0.2 verified.

---

### 2. Image Processing — `Pillow` 12.1.1

**Install:** `pip install "Pillow>=12.0.0"`

Pillow handles all static image operations before handing off to FFmpeg:

- Resize/pad product images to target resolution (1080x1920 or square crop)
- Convert formats (WebP → JPEG for FFmpeg compatibility on Windows/WSL)
- Composite multiple product images into a collage frame
- Generate solid-color background frames for text overlays
- Normalize image dimensions before FFmpeg input (prevents zoompan coordinate errors)

**Why not OpenCV for this?** OpenCV is already installed and handles frame analysis, but
Pillow's file format support (WebP, AVIF, animated GIF extraction) and Pillow's `ImageDraw`
for compositing are cleaner for static image prep. Ken Burns animation itself is done
entirely in FFmpeg — Pillow only prepares the source images.

```python
# Resize + letterbox to 1:1 square for product spotlight
from PIL import Image

def prepare_product_image(src_path: str, out_path: str, size=(1080, 1080)):
    img = Image.open(src_path).convert('RGB')
    img.thumbnail(size, Image.LANCZOS)
    background = Image.new('RGB', size, (255, 255, 255))
    offset = ((size[0] - img.width) // 2, (size[1] - img.height) // 2)
    background.paste(img, offset)
    background.save(out_path, 'JPEG', quality=95)
```

**Confidence:** HIGH — PyPI version 12.1.1 confirmed, stable API.

---

### 3. Web Scraping — `beautifulsoup4` 4.14.3 (no new HTTP library needed)

**Install:** `pip install "beautifulsoup4>=4.14.0"`

`httpx` is already in requirements. Use `httpx` for fetching + `BeautifulSoup` for
parsing HTML to extract additional product images from product page URLs.

**Why BeautifulSoup, not Playwright?** Nortia.ro product pages are standard e-commerce
HTML — product images are in `<img>` tags, not dynamically loaded via JS. Playwright
adds a full browser runtime (100MB+ install, Chromium binary) for zero benefit on
static product pages. If a product page turns out to need JS rendering, fall back to
skipping that product's scrape rather than adding Playwright.

**Why not Scrapy?** Overkill — this is single-URL image extraction, not a crawling
pipeline. The existing `httpx` async client handles concurrency fine.

```python
import httpx
from bs4 import BeautifulSoup

async def scrape_product_images(product_url: str, client: httpx.AsyncClient) -> list[str]:
    """Extract image URLs from a product page. Returns empty list on failure."""
    try:
        resp = await client.get(product_url, timeout=10.0, follow_redirects=True)
        soup = BeautifulSoup(resp.text, 'html.parser')
        # Product images typically in gallery containers or og:image meta
        og_image = soup.find('meta', property='og:image')
        if og_image:
            return [og_image['content']]
        imgs = soup.select('.product-gallery img, .product-images img, [data-zoom-image]')
        return [img.get('src') or img.get('data-src') for img in imgs if img.get('src') or img.get('data-src')]
    except Exception:
        return []
```

**Parser note:** Pass `'html.parser'` (stdlib) to BeautifulSoup — avoids needing `lxml`
as an HTML parser (lxml is used for XML parsing only, different code path).

**Confidence:** HIGH — PyPI version 4.14.3 verified, httpx already installed.

---

### 4. AI Image Generation — `fal-client` 0.13.1

**Install:** `pip install "fal-client>=0.13.0"`

`FAL_API_KEY` is already in `.env.example` (listed as optional). fal-client is the
official Python SDK for fal.ai. Use FLUX.1 [dev] for product visuals from text
descriptions — it produces photorealistic product-style imagery and handles text in
images better than SD 1.5/2.x.

**Why fal-client over Replicate SDK?** fal.ai wins on latency (fastest inference for
FLUX models), and `FAL_API_KEY` is already in the existing config — zero new credential
setup. Replicate would require a new API key.

**Why not Stability AI SDK directly?** fal.ai hosts the same models (FLUX, SDXL) with
faster cold starts and simpler Python SDK.

**This is optional/feature-flagged.** AI image generation is listed as a feature but
requires API credits. Add a `USE_AI_IMAGE_GENERATION` flag in settings.

```python
import fal_client

async def generate_product_visual(prompt: str) -> str:
    """Returns local path to downloaded generated image. Returns None if unavailable."""
    result = await fal_client.run_async(
        "fal-ai/flux/dev",
        arguments={
            "prompt": prompt,
            "image_size": "square_hd",   # 1024x1024
            "num_inference_steps": 28,
            "guidance_scale": 3.5,
        }
    )
    image_url = result["images"][0]["url"]
    # Download and cache locally via httpx (already available)
    return image_url
```

**Confidence:** MEDIUM — PyPI version 0.13.1 verified (released 2026-02-20), FLUX
model availability confirmed on fal.ai, but pricing/quota behavior under load not tested.

---

## FFmpeg Techniques for Product Video Composition

These require NO new Python libraries — all implemented via subprocess calls to the
existing FFmpeg binary.

### Technique 1: Ken Burns Effect (zoompan filter)

Animate a static product image as if a camera is slowly zooming in.

```bash
# Zoom in from 100% to 120% over 5 seconds at 30fps (150 frames)
ffmpeg -loop 1 -i product.jpg -vf \
  "scale=8000:-1,zoompan=z='zoom+0.0007':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1080x1920" \
  -t 5 -c:v libx264 -pix_fmt yuv420p output_kenburns.mp4
```

**Key parameters:**
- `scale=8000:-1` — upscale first so zoompan has pixels to work with (prevents blur)
- `z='zoom+0.0007'` — zoom expression per frame; 0.0007 × 150 frames = ~10% zoom
- `d=150` — duration in frames (fps × seconds)
- `s=1080x1920` — output size (portrait for Reels/TikTok)

**Zoom out variant (more dramatic for sale items):**
```bash
z='if(eq(on,1),1.5,max(1.001,pzoom-0.004))'  # Start at 150%, zoom out to 100%
```

**Pan + zoom (product detail reveal):**
```bash
z='zoom+0.0007':x='iw/2-(iw/zoom/2)+20*on/d':y='ih/2-(ih/zoom/2)'
```

### Technique 2: Text Overlay with drawtext

Product title, price, and brand over video. Requires FFmpeg built with `--enable-libfreetype`.

```bash
ffmpeg -i kenburns.mp4 -vf \
  "drawtext=text='${TITLE}':fontfile='/path/to/font.ttf':fontsize=60:fontcolor=white:\
   x=(w-text_w)/2:y=h*0.75:box=1:boxcolor=black@0.5:boxborderw=15" \
  -c:v libx264 -pix_fmt yuv420p output_text.mp4
```

**Multi-layer text (title + price stacked):**
```bash
-vf "drawtext=text='${TITLE}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=h*0.72:\
     box=1:boxcolor=black@0.6:boxborderw=12,\
     drawtext=text='${PRICE}':fontsize=64:fontcolor=yellow:x=(w-text_w)/2:y=h*0.82:\
     box=1:boxcolor=black@0.6:boxborderw=12"
```

**Note on text escaping:** Product titles contain special characters. Escape colons,
apostrophes, and backslashes in Python before passing to FFmpeg:
```python
def escape_drawtext(text: str) -> str:
    return text.replace('\\', '\\\\').replace("'", "\\'").replace(':', '\\:')
```

### Technique 3: Multi-Image Concat (slideshow)

For collection videos (multiple products), concat individual clips:

```bash
# Create file list
echo "file 'clip1.mp4'" > concat_list.txt
echo "file 'clip2.mp4'" >> concat_list.txt
echo "file 'clip3.mp4'" >> concat_list.txt

# Concatenate
ffmpeg -f concat -safe 0 -i concat_list.txt -c copy output_collection.mp4
```

**With crossfade transition (filter_complex approach):**
```bash
ffmpeg -i clip1.mp4 -i clip2.mp4 -filter_complex \
  "[0][1]xfade=transition=fade:duration=0.5:offset=4.5[out]" \
  -map "[out]" -c:v libx264 output_fade.mp4
```

### Technique 4: Product Image + Stock Video Background Overlay

Place product image (with alpha/transparent background) over a looping stock video:

```bash
ffmpeg -i stock_background.mp4 -i product_transparent.png \
  -filter_complex \
  "[1]scale=600:-1[product];\
   [0][product]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2" \
  -c:v libx264 -pix_fmt yuv420p output_overlay.mp4
```

**Scale product to percentage of frame:**
```bash
[1]scale=iw*0.6:-1[product]   # Product image = 60% of frame width
```

### Technique 5: Image-to-Video (still with audio)

For simple templates: pad image to target duration, add TTS audio:

```bash
ffmpeg -loop 1 -i product.jpg -i voiceover.mp3 \
  -c:v libx264 -tune stillimage -c:a aac -b:a 192k \
  -pix_fmt yuv420p -shortest output.mp4
```

`-tune stillimage` optimizes H.264 encoding for static content (faster, smaller file).

---

## Template System Pattern

Use Python dataclasses (not Jinja2) for video composition templates. The existing
codebase uses stdlib dataclasses for filter configs — keep that pattern consistent.

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class TemplateType(str, Enum):
    PRODUCT_SPOTLIGHT = "product_spotlight"  # Single product, Ken Burns + text
    SALE_BANNER = "sale_banner"              # Sale price prominent, zoom-out effect
    COLLECTION = "collection"               # Multi-product concat

@dataclass
class VideoTemplate:
    type: TemplateType
    duration_seconds: int = 15             # 15-60s
    fps: int = 30
    width: int = 1080
    height: int = 1920
    background_color: str = "#000000"
    font_path: Optional[str] = None        # Falls back to system default
    title_font_size: int = 52
    price_font_size: int = 64
    show_brand: bool = True
    show_original_price: bool = True       # Strike-through for sale items
    ken_burns_zoom_start: float = 1.0      # 1.0 = no zoom
    ken_burns_zoom_end: float = 1.15       # 1.15 = 15% zoom in
    transition_type: str = "fade"          # fade, slide, none
    transition_duration: float = 0.5
```

**Why not Jinja2?** Jinja2 is a string template engine for text/HTML output — not suited
for FFmpeg filter graph construction. Python dataclasses + string formatting produce
the FFmpeg filter strings directly without an intermediate template language.

---

## Stock Video Source: Pexels API

Use the Pexels API for free stock video backgrounds (no new Python library needed —
use `httpx` which is already installed).

**API key:** Free, register at pexels.com/api. Store as `PEXELS_API_KEY` in `.env`.

**Rate limits:** 200 requests/hour, 20,000/month — sufficient for a personal-use tool.

**Search and download pattern:**
```python
async def search_stock_video(query: str, client: httpx.AsyncClient, api_key: str) -> str:
    """Returns URL of first matching video (portrait orientation preferred)."""
    resp = await client.get(
        "https://api.pexels.com/videos/search",
        params={"query": query, "orientation": "portrait", "per_page": 5},
        headers={"Authorization": api_key}
    )
    videos = resp.json().get("videos", [])
    if not videos:
        return None
    # Prefer HD portrait video files
    for video_file in videos[0]["video_files"]:
        if video_file["height"] >= 1920 and video_file["width"] == 1080:
            return video_file["link"]
    return videos[0]["video_files"][0]["link"]
```

**Confidence:** MEDIUM — Pexels API is free and documented, but portrait video
availability varies by search query. Cache downloaded backgrounds locally (by query hash)
to avoid repeated downloads.

---

## Recommended Database Additions (Supabase)

New tables needed — no new Python library, extends existing `supabase>=2.0.0` client:

```sql
-- Product feed cache
CREATE TABLE product_feeds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT,                          -- Remote feed URL (for refresh)
    file_path TEXT,                    -- Local cached copy
    product_count INTEGER,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Video templates
CREATE TABLE video_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,                -- product_spotlight, sale_banner, collection
    config JSONB NOT NULL,             -- Serialized VideoTemplate dataclass
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Product video jobs
CREATE TABLE product_videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id TEXT NOT NULL,
    feed_id UUID REFERENCES product_feeds(id),
    product_ids TEXT[] NOT NULL,       -- Array of product IDs from feed
    template_id UUID REFERENCES video_templates(id),
    job_id TEXT,                       -- Link to existing jobs table
    output_path TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Installation

```bash
# Add to requirements.txt

# XML parsing (Google Shopping feeds)
lxml>=6.0.0

# Image preparation (resize, format conversion, compositing)
Pillow>=12.0.0

# HTML parsing for product image scraping
beautifulsoup4>=4.14.0

# AI image generation (optional, requires FAL_API_KEY)
fal-client>=0.13.0
```

Full command:
```bash
pip install "lxml>=6.0.0" "Pillow>=12.0.0" "beautifulsoup4>=4.14.0" "fal-client>=0.13.0"
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| XML parsing | `lxml` | stdlib `xml.etree` | No streaming iterparse with namespace support; 2-10x slower on large files |
| XML parsing | `lxml` | `feedparser` | feedparser targets Atom/RSS; no Google Shopping namespace support |
| Scraping | `httpx` + `beautifulsoup4` | `playwright` | Playwright needs full browser runtime for static HTML pages — overkill |
| Scraping | `httpx` + `beautifulsoup4` | `scrapy` | Scrapy is a crawling framework — wrong abstraction for single-URL image extraction |
| Image prep | `Pillow` | `opencv-python-headless` | OpenCV already present but Pillow's format support (WebP, AVIF) and ImageDraw are better for static prep |
| AI images | `fal-client` | `replicate` | `FAL_API_KEY` already in .env.example; fal wins on FLUX latency |
| Templates | Python dataclasses | Jinja2 | Jinja2 is a text/HTML template engine; dataclasses integrate with existing pattern in codebase |
| Video comp | FFmpeg subprocess | `moviepy` | moviepy is a Python wrapper over FFmpeg with API overhead; existing codebase calls FFmpeg directly |
| Stock video | Pexels API (httpx) | `pexels-api-py` wrapper | Adds a dependency for a 3-endpoint API; `httpx` handles it with 10 lines |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `moviepy` | Wraps FFmpeg with Python overhead, slower than direct subprocess, complex filter graphs become opaque | FFmpeg subprocess (existing pattern) |
| `feedparser` | Designed for RSS/Atom — lacks Google Shopping `g:` namespace support | `lxml.etree.iterparse` |
| `playwright` (Python) | 150MB+ install, browser binary, complex async lifecycle — unnecessary for static HTML scraping | `httpx` + `beautifulsoup4` |
| `Pillow` for Ken Burns | Pillow cannot produce video — it creates static images only | FFmpeg `zoompan` filter |
| `pexels-api-py` | Stale PyPI package (last update 2022), adds a dependency for trivial REST calls | `httpx` with direct API calls |
| `xml.etree.ElementTree` | No full namespace XPath; memory-loads full document; 2-10x slower | `lxml` |

---

## Integration Points with Existing Pipeline

| New Feature | Hooks Into | Notes |
|-------------|-----------|-------|
| Feed parsing | New `product_feed_service.py` | Stand-alone, no existing service dependency |
| Image download | `httpx` (existing) | Use existing `AsyncClient` from `assembly_service` pattern |
| Ken Burns render | `assembly_service.py` — new `render_product_video()` method | Reuse FFmpeg subprocess pattern from `_render_with_preset()` |
| Text overlay | Extend FFmpeg filter chain in `assembly_service.py` | Add `build_drawtext_filter()` next to `build_filter_chain()` |
| TTS voiceover | `tts/factory.py` (existing) | No change — same factory returns ElevenLabs/Edge TTS |
| Subtitles | `tts_subtitle_generator.py` (existing) | No change — same timestamp-to-SRT logic |
| Job tracking | `job_storage.py` (existing) | Use same `create_job()` / `update_job()` pattern |
| Template config | New `product_templates.py` dataclass module | Separate from existing `encoding_presets.py` |
| Product video DB | Supabase (existing client) | 3 new migration files (feeds, templates, product_videos) |

---

## Version Compatibility

| Package | Version | Python Compat | Notes |
|---------|---------|---------------|-------|
| `lxml` | 6.0.2 | Python 3.8+ | WSL Linux wheels available on PyPI |
| `Pillow` | 12.1.1 | Python 3.9+ | WebP support built-in since Pillow 9.x |
| `beautifulsoup4` | 4.14.3 | Python 3.7+ | Requires `lxml` or `html.parser` for parsing |
| `fal-client` | 0.13.1 | Python 3.8+ | Async API; use `asyncio.run()` or FastAPI async routes |

---

## Sources

- [lxml performance benchmarks](https://lxml.de/performance.html) — iterparse vs ElementTree, HIGH confidence
- [lxml PyPI — version 6.0.2](https://pypi.org/project/lxml/) — version verified
- [Pillow PyPI — version 12.1.1](https://pypi.org/project/pillow/) — version verified
- [beautifulsoup4 PyPI — version 4.14.3](https://pypi.org/project/beautifulsoup4/) — version verified
- [fal-client PyPI — version 0.13.1](https://pypi.org/project/fal-client/) — version verified 2026-02-20
- [FFmpeg Ken Burns zoompan — Bannerbear](https://www.bannerbear.com/blog/how-to-do-a-ken-burns-style-effect-with-ffmpeg/) — MEDIUM confidence (technique verified, expression syntax confirmed)
- [FFmpeg drawtext filter — OTTVerse](https://ottverse.com/ffmpeg-drawtext-filter-dynamic-overlays-timecode-scrolling-text-credits/) — HIGH confidence
- [FFmpeg concat filter — Mux](https://www.mux.com/articles/create-a-video-slideshow-with-images-using-ffmpeg) — HIGH confidence
- [Pexels API documentation](https://www.pexels.com/api/documentation/) — HIGH confidence, free tier confirmed
- [Scraping comparison 2025 — ScrapingBee](https://www.scrapingbee.com/blog/best-python-web-scraping-libraries/) — MEDIUM confidence
- [fal.ai FLUX.2 announcement](https://blog.fal.ai/flux-2-is-now-available-on-fal/) — MEDIUM confidence

---

*Stack research for: v5 Product Video Generator — new dependencies only*
*Researched: 2026-02-20*
