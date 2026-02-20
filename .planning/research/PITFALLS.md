# Pitfalls Research

**Domain:** Adding product feed-based video generation to existing FFmpeg video platform
**Researched:** 2026-02-20
**Confidence:** HIGH (FFmpeg/XML pitfalls) / MEDIUM (web scraping, AI image generation)

---

## Critical Pitfalls

Mistakes that cause rewrites, major data loss, or system failures.

### Pitfall 1: Romanian Diacritics Corrupted in FFmpeg drawtext

**What goes wrong:**
Product names and descriptions containing Romanian diacritics (ă, â, î, ș, ț, Ș, Ț) are silently corrupted or cause FFmpeg to error out when passed directly as `text=` in a drawtext filter. The text either renders as boxes/question marks or the entire filter fails, producing a video with no overlay text.

**Why it happens:**
The FFmpeg drawtext filter has up to four levels of escaping:
1. The text value itself (backslash escaping)
2. The filter option string (colon-delimited)
3. The filtergraph description (comma-delimited)
4. The shell command line

UTF-8 diacritics survive level 1 but break at levels 2-4 when Python constructs the command as a list or string. Additionally, the font file must support the Unicode code points for these characters — Windows-bundled fonts often don't render Romanian ș/ț correctly (confusing them with ş/ţ, which use cedilla instead of comma-below).

**How to avoid:**
Write product text to a UTF-8 temp file and use `textfile=` instead of `text=`:
```python
import tempfile
import os

def write_text_file(text: str) -> str:
    """Write UTF-8 text to temp file for FFmpeg drawtext."""
    f = tempfile.NamedTemporaryFile(
        mode='w',
        encoding='utf-8',
        suffix='.txt',
        delete=False
    )
    f.write(text)
    f.flush()
    f.close()
    return f.name

# In FFmpeg filter string:
# BAD:  "drawtext=text='Produs ș special':fontsize=40"
# GOOD: "drawtext=textfile='/tmp/abc.txt':fontsize=40"
```

For the font, use a font that includes correct Romanian glyphs. Noto Sans, DejaVu Sans, and Liberation Sans support Romanian. Bundle a font with the application instead of relying on system fonts. On WSL, prefer Linux-side font paths over Windows `C:\Windows\Fonts\` paths — Windows path colons require escape hell even with forward slashes (`C\:/Windows/Fonts/Arial.ttf`).

**Warning signs:**
- Boxes or `?` characters in rendered text where diacritics should be
- FFmpeg error: `Option text not found` (colon in text broke option parsing)
- Text renders but ș renders as ş (wrong Unicode code point — font substitution)
- FFmpeg exits with code 1 on any product with diacritics but succeeds on ASCII-only names

**Phase to address:** Phase 1 (video composition foundation) — establish the textfile pattern before any text overlay is built.

---

### Pitfall 2: XML Feed Loaded Entirely Into Memory

**What goes wrong:**
The Nortia.ro feed has ~9,987 products. Using `xml.etree.ElementTree.parse()` or `lxml.etree.parse()` loads the entire XML document tree into memory at once. A 10k-product Google Shopping feed with descriptions and image URLs is typically 20-80 MB of XML, which after Python object overhead becomes 200-500 MB in memory. On a WSL development machine with limited RAM, this competes directly with FFmpeg processes for memory.

**Why it happens:**
The natural first instinct is to parse the entire file once and query it. Developers treat a 10k feed like a small config file. The problem isn't the parse itself — it's keeping the full element tree resident while also holding parsed product objects.

**How to avoid:**
Use `iterparse()` with explicit element clearing:
```python
from lxml import etree

def parse_feed_streaming(xml_path: str):
    """Stream-parse Google Shopping XML without loading full tree."""
    context = etree.iterparse(xml_path, events=('end',), tag='item')

    for event, elem in context:
        product = extract_product(elem)
        yield product

        # CRITICAL: clear element to free memory
        elem.clear()
        # Also eliminate the now-empty reference in the parent
        while elem.getprevious() is not None:
            del elem.getparent()[0]

    del context
```

For the product browser UI, parse into a lightweight index (id, title, price, image_url only) on first load, cache it. Do NOT keep parsed element trees in memory.

**Warning signs:**
- WSL memory usage spikes to >80% during feed parsing
- FFmpeg jobs fail with OOM errors after feed is loaded
- Python process using 300+ MB just for feed data
- Slow initial page load (>5s) for the product browser

**Phase to address:** Phase 1 (feed parsing) — the streaming pattern must be established from the start. Retrofitting this after building the product browser is painful.

---

### Pitfall 3: Image Download Blocks the Render Pipeline

**What goes wrong:**
Product videos need multiple images (feed image + scraped extras). Downloading them synchronously, one at a time, inside the video generation background task means a batch of 20 products waits for hundreds of HTTP requests sequentially. A single timeout (30s default) stalls the entire batch.

**Why it happens:**
The existing Edit Factory pattern runs everything inside a `BackgroundTasks` function sequentially. Adapting this pattern to image downloading without adding concurrency means 20 products × 3 images × (0.5-5s per image) = 30-300s just on downloads before FFmpeg starts.

**How to avoid:**
Pre-download all images for a batch before any FFmpeg rendering begins. Use `httpx` with async or `concurrent.futures.ThreadPoolExecutor` for parallel downloads with connection pooling:
```python
import httpx
from concurrent.futures import ThreadPoolExecutor, as_completed

def download_images_batch(urls: list[str], output_dir: Path,
                           max_workers: int = 5) -> dict[str, Path]:
    """Download images with timeout and retry. Returns url->path map."""
    results = {}

    def download_one(url: str) -> tuple[str, Path | None]:
        try:
            resp = httpx.get(url, timeout=10.0, follow_redirects=True)
            resp.raise_for_status()

            # Validate it's actually an image
            content_type = resp.headers.get('content-type', '')
            if 'image' not in content_type:
                return url, None

            ext = '.jpg'  # default
            if 'png' in content_type:
                ext = '.png'
            elif 'webp' in content_type:
                ext = '.webp'

            filename = hashlib.md5(url.encode()).hexdigest() + ext
            path = output_dir / filename
            path.write_bytes(resp.content)
            return url, path
        except Exception as e:
            logger.warning(f"Failed to download {url}: {e}")
            return url, None

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(download_one, url): url for url in urls}
        for future in as_completed(futures):
            url, path = future.result()
            results[url] = path

    return results
```

Cap `max_workers` at 5 to avoid triggering rate limits on CDNs. Use `httpx` instead of `requests` for connection pooling (avoid opening a new TCP connection per image).

**Warning signs:**
- Batch job "progress" stuck at 0% for 2+ minutes
- Logs show sequential download timestamps (each 1-3s apart)
- Single failed URL stops entire batch
- Memory grows unbounded (stream large images in chunks)

**Phase to address:** Phase 1 (product image pipeline) and Phase 3 (batch processing).

---

### Pitfall 4: FFmpeg zoompan Filter Makes Ken Burns Extremely Slow

**What goes wrong:**
The `zoompan` filter is the standard FFmpeg tool for Ken Burns effects. However, it is a frame-by-frame filter that processes every output frame individually, making it 10-100x slower than regular encoding. For a 9-second image clip at 30fps = 270 frames, zoompan can take 30-60 seconds on CPU.

**Why it happens:**
Developers assume Ken Burns is just "a few filter params" and test with one clip. It works but takes a minute. At batch scale (20+ products), this becomes 20-40 minutes of total Ken Burns processing before the actual video encode even runs.

**How to avoid:**
Two strategies:

**Option A: Pre-render Ken Burns to a short video, then reuse.** Render the Ken Burns clip once per image to a temp `.mp4`, then concatenate. This separates the slow step from the product video assembly.

**Option B: Use `scale2ref` + `zoompan` with reduced output frames.** If Ken Burns is not strictly required, use a simpler zoom with the `scale` filter and `-vf scale=iw*1.1:ih*1.1,crop=iw/1.1:ih/1.1` approach which is significantly faster.

The key pattern: if you must use `zoompan`, set the output duration explicitly with `-t` and use a reasonable zoom speed:
```python
# SLOW: zoompan on high-res image at 30fps for 9s
# Benchmark: ~45s encode time for 9s clip

# FASTER: Pre-scale the image to exact output resolution first
# then apply zoompan on the scaled image
filters = (
    f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
    f"crop={target_w}:{target_h},"
    f"zoompan=z='min(zoom+0.0005,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
    f":d={int(duration * fps)}:s={target_w}x{target_h}"
)
```

Set `-threads 0` to let FFmpeg use all CPU cores for zoompan — it does parallelize frame processing.

**Warning signs:**
- Single Ken Burns clip takes >30s to render
- Batch job progress is linear but total time is unacceptable
- `top` shows one FFmpeg process at 100% CPU single-threaded
- FFmpeg stderr shows thousands of "frame=X" lines slowly incrementing

**Phase to address:** Phase 2 (image-to-video composition) — benchmark before committing to zoompan defaults.

---

### Pitfall 5: Aspect Ratio Mismatch Stretches Product Images

**What goes wrong:**
Product feed images come in wildly varying aspect ratios: square (1:1 is most common for e-commerce), landscape (4:3, 16:9 for banner shots), and occasionally portrait (3:4). Target output is 9:16 portrait (1080×1920 for Reels/TikTok). Blindly scaling images to fill 1080×1920 distorts them. A square product image becomes 30% wider than it should be.

**Why it happens:**
`ffmpeg -i product.jpg -vf scale=1080:1920 output.mp4` scales without preserving aspect ratio. Developers test with images that happen to be near 9:16 and miss the general case.

**How to avoid:**
Use `scale` with `force_original_aspect_ratio=decrease` then `pad` to fill the remaining space:
```python
def build_image_scale_filter(target_w: int, target_h: int,
                              pad_color: str = "black") -> str:
    """
    Scale image to target dimensions preserving aspect ratio.
    Pads remaining space with pad_color.
    """
    return (
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
        f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:{pad_color}"
    )

# For product videos, consider blurred background instead of black bars:
def build_image_blur_background_filter(target_w: int, target_h: int) -> str:
    """
    Scale with blurred version of image as background (Instagram style).
    Requires split filter.
    """
    return (
        f"[0:v]split=2[bg][fg];"
        f"[bg]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
        f"crop={target_w}:{target_h},boxblur=20:5[bgblur];"
        f"[fg]scale={target_w}:{target_h}:force_original_aspect_ratio=decrease[fgscaled];"
        f"[bgblur][fgscaled]overlay=(W-w)/2:(H-h)/2"
    )
```

The blurred background approach is aesthetically better for product videos — popular on Instagram/TikTok. However, it adds FFmpeg filter complexity and processing time.

**Warning signs:**
- Product images appear stretched horizontally or vertically
- Circular logos become ellipses
- Text overlaid on images appears at wrong position (assumes different dimensions)
- Images with white backgrounds show black bars instead of brand-appropriate padding

**Phase to address:** Phase 2 (image-to-video composition) — must test with real Nortia.ro feed images, which are typically square e-commerce photos.

---

### Pitfall 6: Web Scraping for Extra Images Is Fragile and May Be Blocked

**What goes wrong:**
The v5 plan includes scraping product pages for additional images beyond the feed image. Romanian e-commerce sites (including WooCommerce-based stores) increasingly use Cloudflare. Python `requests` with default headers gets 403s. Even sites without Cloudflare may have JavaScript-rendered galleries that `requests` or `lxml` can't parse.

**Why it happens:**
Developers test scraping in a browser (where it works trivially) then use `requests.get()` expecting the same. The site serves a Cloudflare challenge page instead of the HTML.

**How to avoid:**
Design web scraping as **optional enrichment**, not a required step. The pipeline must work without it:

```python
async def get_extra_images(product_url: str,
                            fallback_images: list[str]) -> list[str]:
    """
    Attempt to scrape extra images from product page.
    Returns fallback_images if scraping fails for any reason.
    """
    try:
        # Attempt with reasonable timeout and real browser headers
        result = await scrape_product_images(product_url, timeout=8.0)
        if result:
            return result
    except Exception as e:
        logger.info(f"Scraping skipped for {product_url}: {e}")

    return fallback_images
```

For Nortia.ro specifically (which is the primary target), test the actual site structure once and build a site-specific parser rather than a generic scraper. WooCommerce product pages have consistent gallery HTML:
```python
# WooCommerce gallery image pattern
soup.select('.woocommerce-product-gallery__image img')
# or data attribute:
soup.select('[data-large_image]')
```

Use `httpx` with real browser `User-Agent` and `Accept` headers. If Cloudflare is present, `playwright` (headless Chromium) is the only reliable option — but adds a 2-5 second per-product overhead.

**Warning signs:**
- 403 responses from all product URLs
- Scraper returns no images for any product
- HTML response contains "Checking your browser" (Cloudflare challenge)
- Gallery div is present in HTML but images are `data-src` attributes (lazy-loaded, requires JS)

**Phase to address:** Phase 2 (visual sources) — implement scraping as a plugin with graceful fallback, not as a core requirement.

---

### Pitfall 7: Product Description HTML Not Stripped Before TTS

**What goes wrong:**
Google Shopping feed descriptions frequently contain raw HTML tags: `<br/>`, `<p>`, `<strong>`, `&nbsp;`, `&amp;`, `&lt;`, HTML entities. If passed directly to ElevenLabs or Edge TTS, the TTS engine either reads the tags aloud ("less than br slash greater than") or refuses to process the input.

**Why it happens:**
The feed description field is populated from the product's HTML description, and many store owners/systems include markup. Google Merchant Center technically requires plain text but doesn't strictly enforce it.

**How to avoid:**
Always sanitize descriptions before any text use (TTS, overlays, AI script generation):
```python
import html
import re
from bs4 import BeautifulSoup

def clean_product_text(raw: str) -> str:
    """
    Normalize product text from feed: strip HTML, decode entities,
    normalize whitespace.
    """
    if not raw:
        return ""

    # Decode HTML entities: &amp; -> &, &nbsp; -> space, etc.
    decoded = html.unescape(raw)

    # Strip HTML tags (use BeautifulSoup for robustness over regex)
    soup = BeautifulSoup(decoded, 'html.parser')
    text = soup.get_text(separator=' ')

    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    # Truncate for TTS (ElevenLabs flash_v2_5: 40k char limit)
    # For product videos, descriptions > 500 chars are too long anyway
    if len(text) > 500:
        # Cut at last sentence boundary before 500 chars
        truncated = text[:500]
        last_period = truncated.rfind('.')
        if last_period > 200:
            text = truncated[:last_period + 1]
        else:
            text = truncated.rstrip() + '...'

    return text
```

**Warning signs:**
- TTS audio contains "p", "br", "strong" spoken aloud
- ElevenLabs returns 422 (unprocessable content)
- Script generation AI outputs HTML tags in the generated script
- Text overlays show `&amp;` or `<br>` as literal characters

**Phase to address:** Phase 1 (feed parsing) — add `clean_product_text()` as a mandatory normalization step on all product text fields at parse time, not at use time.

---

### Pitfall 8: Batch Processing Uses BackgroundTasks Without Job-Level Error Isolation

**What goes wrong:**
The existing Edit Factory `BackgroundTasks` pattern runs one job per upload. For batch product video generation (20+ products), an unhandled exception in product #5 kills the entire batch function, leaving products 6-20 never started. There is no per-product failure tracking.

**Why it happens:**
The existing `_generation_progress` dict (in-memory, lost on restart) tracks a single job, not N sub-jobs. Adapting it naively for batch means one dict entry for the whole batch — no visibility into which individual products failed.

**How to avoid:**
Build batch jobs with per-product state tracking from the start:
```python
@dataclass
class ProductJobState:
    product_id: str
    status: str  # 'pending' | 'downloading' | 'rendering' | 'done' | 'failed'
    error: Optional[str] = None
    output_path: Optional[str] = None

class BatchJob:
    def __init__(self, job_id: str, product_ids: list[str]):
        self.job_id = job_id
        self.products: dict[str, ProductJobState] = {
            pid: ProductJobState(pid, 'pending')
            for pid in product_ids
        }

    @property
    def progress_pct(self) -> int:
        done = sum(1 for p in self.products.values()
                   if p.status in ('done', 'failed'))
        return int(done / len(self.products) * 100)

async def run_batch(job: BatchJob):
    for product_id, state in job.products.items():
        try:
            state.status = 'rendering'
            path = await render_product_video(product_id)
            state.status = 'done'
            state.output_path = str(path)
        except Exception as e:
            # ISOLATE: this product failed, continue with next
            state.status = 'failed'
            state.error = str(e)
            logger.error(f"Product {product_id} failed: {e}", exc_info=True)
            # Do NOT re-raise — let batch continue
```

**Warning signs:**
- Batch job shows "complete" but only 3 of 20 videos were generated
- No way to tell which products failed from the UI
- Re-running batch re-processes already-successful products
- Server restart loses all batch progress

**Phase to address:** Phase 3 (batch processing) — design the batch state model before implementing any batch rendering logic.

---

## Moderate Pitfalls

### Pitfall 9: Missing Images Silently Produce Black Frames

**What goes wrong:**
When a product image URL is broken (404, CDN gone, server timeout), the image download fails. If the pipeline proceeds with a `None` image path, FFmpeg either errors out (crashing the job) or produces a video with black frames in place of the product image, which looks completely broken.

**Why it happens:**
Error handling for downloads returns `None` on failure. The subsequent image-to-video composition doesn't check for `None` before calling FFmpeg, passing a non-existent file path.

**How to avoid:**
Implement a fallback image strategy — generate a solid color placeholder with the product name as text, or use the store's logo:
```python
def get_product_image_or_fallback(image_url: str,
                                   product_title: str,
                                   output_dir: Path) -> Path:
    """Returns downloaded image path, or generated placeholder."""
    downloaded = download_image_safe(image_url, output_dir)
    if downloaded and downloaded.exists():
        return downloaded

    # Generate placeholder with FFmpeg
    placeholder_path = output_dir / f"placeholder_{hash(product_title)}.jpg"
    if not placeholder_path.exists():
        subprocess.run([
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", "color=c=gray:s=1080x1080",
            "-frames:v", "1",
            str(placeholder_path)
        ], capture_output=True)

    return placeholder_path
```

**Warning signs:**
- Generated videos have 2-3 second black segments
- FFmpeg error: `No such file or directory` for image input
- Feed has products with `image_link` pointing to discontinued CDN URLs
- Batch partially fails with no clear indication of which products had broken images

**Phase to address:** Phase 1 (product image pipeline) — implement fallback before any composition work begins.

---

### Pitfall 10: Price Display — Currency Symbol and Formatting Breaks drawtext

**What goes wrong:**
Romanian product prices use the `lei` suffix or `RON` currency code, sometimes with the `%` character for discount display ("30% reducere"). The `%` character is special in FFmpeg drawtext — it initiates expression expansion. A product promotion text of "Reducere 30%" becomes either a rendered error or the `%` silently disappears.

**Why it happens:**
FFmpeg drawtext uses `%{...}` for dynamic text expansion (timecode, frame number, etc.). Any literal `%` must be escaped as `\%` (or `%%` depending on context). When this text comes from product data, developers forget to escape it.

**How to avoid:**
Escape all text content before writing to the drawtext textfile. The `%` sign is the primary concern; also escape backslashes:
```python
def escape_for_drawtext_file(text: str) -> str:
    """
    Escape text for FFmpeg drawtext textfile option.
    % is an expression prefix; \\ starts escape sequences.
    """
    # Escape backslashes first (must be first!)
    text = text.replace('\\', '\\\\')
    # Escape percent signs
    text = text.replace('%', '\\%')
    # Newlines in textfile are literal newlines — keep them if multiline
    return text
```

Note: when using `textfile=`, the escaping rules differ from inline `text=`. With a text file, only `\` and `%` need escaping within the file contents.

**Warning signs:**
- Discount percentages missing from rendered videos
- FFmpeg warning: "bad/incomplete expression"
- Product names with `&` (ampersand, common in store names) cause drawtext errors
- Prices with `.` (decimal point) work but prices with `,` (Romanian decimal format: `19,99 lei`) may need locale-aware formatting

**Phase to address:** Phase 2 (text overlay composition) — add escaping to the text-writing utility.

---

### Pitfall 11: AI Image Generation Cost Runs Away in Batch Mode

**What goes wrong:**
The v5 plan includes AI-generated extra visuals. At FLUX pricing (~$0.04-0.08 per image) and with batch generation of 20 products × 2 AI images each = 40 images = $1.60-3.20 per batch run. If a developer accidentally triggers a batch twice, or if the system retries on failure, costs multiply quickly. For 9,987 products if someone accidentally hits "generate all", that's ~$800-1,600 in one run.

**Why it happens:**
AI image generation is treated like any other pipeline step with retry logic. There's no cost gate or idempotency check.

**How to avoid:**
- Make AI image generation **explicitly opt-in per product**, not on by default for batch
- Implement idempotency: check if an AI image already exists for this product before generating
- Add a cost estimate preview before any AI generation batch starts
- Cap maximum AI images per batch run (e.g., 50 images max)
- Use the existing `cost_tracker` service to log and monitor AI image costs

```python
async def generate_ai_product_image(product_id: str,
                                     prompt: str,
                                     output_dir: Path) -> Optional[Path]:
    """Generate AI image with idempotency check."""
    # Check if already generated
    existing = output_dir / f"ai_{product_id}.jpg"
    if existing.exists():
        logger.info(f"AI image already exists for {product_id}, reusing")
        return existing

    # Log estimated cost before generation
    estimated_cost = 0.06  # USD, FLUX average
    cost_tracker.log_estimate("ai_image", estimated_cost,
                               {"product_id": product_id})

    # Generate
    image_bytes = await call_ai_image_api(prompt)
    existing.write_bytes(image_bytes)
    return existing
```

**Warning signs:**
- Cost log shows repeated AI generation for the same product IDs
- Batch job retries regenerating AI images that already succeeded
- No cost preview before batch generation starts
- AI generation happens even when feed image download succeeded

**Phase to address:** Phase 2 (visual sources) — implement idempotency and cost gating before any AI image API integration.

---

### Pitfall 12: FFmpeg Font Path on WSL Breaks with Windows Paths

**What goes wrong:**
The Edit Factory codebase runs on WSL. If a font file is specified using a Windows path (`C:\Windows\Fonts\Arial.ttf`), FFmpeg's drawtext filter will fail even after forward-slash conversion (`C:/Windows/Fonts/Arial.ttf`) because the colon still requires escaping in the filter string. The correct WSL approach is different from either Windows or pure Linux.

**Why it happens:**
WSL mounts the Windows filesystem at `/mnt/c/`. Developers see "it's Windows" and use Windows paths, but FFmpeg runs as a Linux process and expects Linux paths.

**How to avoid:**
Use Linux font paths in WSL, not Windows paths:
```python
import subprocess
from pathlib import Path

def get_font_path(font_name: str = "DejaVuSans") -> str:
    """
    Get Linux font path for use in FFmpeg drawtext.
    WSL: use /mnt/c/Windows/Fonts/ or install fonts in WSL.
    Returns path with no escaping needed in textfile mode.
    """
    # Prefer WSL-native fonts (install: apt install fonts-dejavu)
    wsl_font = Path(f"/usr/share/fonts/truetype/dejavu/{font_name}.ttf")
    if wsl_font.exists():
        return str(wsl_font)

    # Fall back to Windows fonts via WSL mount
    windows_font = Path(f"/mnt/c/Windows/Fonts/arial.ttf")
    if windows_font.exists():
        # Escape the colon for FFmpeg filter string usage
        # /mnt/c/... path has no colon — safe to use directly
        return str(windows_font)

    raise RuntimeError(f"Font not found: {font_name}")
```

Install `fonts-noto` or `fonts-dejavu` in WSL for clean Romanian support: `sudo apt install fonts-noto`. These include full Unicode coverage including Romanian comma-below variants (ș, ț).

**Warning signs:**
- FFmpeg drawtext works with hardcoded English text but fails with any product name
- Error: `Option fontfile not found` (colon in `C:` path parsed as option separator)
- Font renders but diacritics show as fallback glyphs (wrong font charset)
- Tests pass on dev machine but fail after WSL reinstall (font path changed)

**Phase to address:** Phase 1 (video composition foundation) — establish font resolution before any text overlay work.

---

### Pitfall 13: Feed Parsing Silently Ignores Namespace-Prefixed Tags

**What goes wrong:**
Google Shopping XML feeds use XML namespaces: `<g:price>`, `<g:brand>`, `<g:condition>`. When parsed with `ElementTree` without namespace awareness, these tags are returned as `{http://base.google.com/ns/1.0}price` — the namespace URI is prepended. Naive selectors like `elem.find('g:price')` return `None`, silently.

**Why it happens:**
Developers look at the raw XML, see `<g:price>`, and try to find elements by `g:price`. Python's ElementTree uses Clark notation for namespaces, not prefix notation.

**How to avoid:**
Define namespace map and use it consistently:
```python
GOOGLE_SHOPPING_NS = {
    'g': 'http://base.google.com/ns/1.0'
}

def extract_product(item_elem) -> dict:
    """Extract product fields handling Google Shopping namespaces."""
    def find_text(tag: str, ns_prefix: str = 'g') -> str:
        """Find text with namespace awareness."""
        # Try namespaced first
        ns_uri = GOOGLE_SHOPPING_NS.get(ns_prefix, '')
        elem = item_elem.find(f'{{{ns_uri}}}{tag}')
        if elem is None:
            # Try without namespace (some feeds omit it)
            elem = item_elem.find(tag)
        return (elem.text or '').strip() if elem is not None else ''

    return {
        'id': find_text('id'),
        'title': item_elem.findtext('title', '').strip(),  # No namespace
        'description': item_elem.findtext('description', '').strip(),
        'price': find_text('price'),
        'sale_price': find_text('sale_price'),
        'image_link': find_text('image_link'),
        'brand': find_text('brand'),
        'product_type': find_text('product_type'),
        'availability': find_text('availability'),
    }
```

Also test against the actual Nortia.ro feed before coding assumptions about field names — Romanian stores sometimes use custom Google Shopping extensions.

**Warning signs:**
- All product prices/brands return as empty strings
- Only `title`, `description`, `link` (non-namespaced fields) parse correctly
- Product count is correct but most fields are blank
- `elem.find('g:price')` returns `None` consistently

**Phase to address:** Phase 1 (feed parsing) — test against real feed file during implementation.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store all downloaded images in a flat directory | Simplest code | 9,987+ images in one directory causes filesystem slowdown on some systems | Use per-product subdirectories from the start |
| Use `text=` inline in drawtext for simple ASCII-only products | Fewer temp files | Romanian products break; inconsistent behavior based on product name | Never — always use `textfile=` |
| Single in-memory dict for batch job state | Matches existing patterns | Lost on server restart, no recovery possible | Only for single-product generation; batch needs persistence |
| Download images at render time (not pre-downloaded) | Simpler pipeline | Render job times are unpredictable; timeout failures hard to diagnose | Never for batch mode |
| `xml.etree.ElementTree.parse()` for feed | stdlib, no dependencies | 200-500 MB memory spike, blocks async event loop | Only for testing with <100 products |
| AI images generated for every product in batch | Complete visuals | Cost unbounded, no idempotency | Never without explicit per-product opt-in + cost estimate |
| Hardcode `max_workers=10` for image downloads | Faster downloads | CDN rate limits trigger 429s, all downloads fail together | Set to 3-5; use exponential backoff |

---

## Integration Gotchas

Common mistakes when connecting to the existing Edit Factory pipeline.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Existing TTS pipeline | Pass raw feed description to `generate_tts_audio()` | Strip HTML, decode entities, truncate to 500 chars via `clean_product_text()` before TTS |
| Existing `assembly_service.py` | Try to reuse assembly service for product videos | Build a separate `product_video_service.py` — assembly service is built around script-segment matching, incompatible with image-based composition |
| Existing `library_routes.py` render endpoint | Add product video generation to existing render flow | Add a new `product_routes.py` router; product videos have fundamentally different inputs (images, not video segments) |
| Existing `job_storage.py` | Track batch of 20 product jobs as single job | Add batch job concept to job storage or create `product_batch_storage.py` with per-product sub-states |
| Existing subtitle system (`force_style` / ASS) | Apply subtitle system to text overlays in product videos | Text overlays in product videos use `drawtext` (static overlays), not `subtitles` (timed captions) — different tools, different escaping |
| Existing `cost_tracker.py` | Forget to log AI image generation costs | Hook `cost_tracker.log_cost()` for every AI image API call, same as existing ElevenLabs logging |
| Existing ElevenLabs credits (100k/month) | Generate full voiceover for all 9,987 products | Product videos use short template text (20-80 chars typical) = ~40-160 credits per product. 100k credits / 40 chars = 2,500 products max per month. Use Edge TTS as default for batch. |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous image downloads inside render job | Single product: fine. Batch of 20: 2-5 minute delay before rendering starts | Pre-download phase before render phase | >5 products |
| Loading full 10k feed into memory for browser UI | First page load takes 5-10 seconds; WSL memory pressure during rendering | Parse to lightweight index (id/title/price/image only), cache as JSON | Feed > 1,000 products |
| One FFmpeg process per product image (Ken Burns) | Single product: 10-30s. Batch of 20: 3-10 minutes | Benchmark Ken Burns vs simpler scale filter; offer both options | >5 products in batch |
| No image cache — re-download same images each batch run | Same product video regenerated twice = 2x download time | Content-addressed cache keyed by MD5 of URL | After 2nd run of same products |
| Unlimited `asyncio.gather()` for product rendering | Fine for 3 products; crashes with OOM for 20 | Use semaphore to limit concurrent FFmpeg processes to 2-3 | >5 concurrent renders |
| Full product descriptions in AI script prompt | Works with 200-char descriptions; fails with 2000-char descriptions (token limits, slow) | Truncate descriptions to 300 chars before AI prompt | Products with very long descriptions |

---

## Security Mistakes

Domain-specific security issues for product feed processing.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Pass raw product URL to web scraper without validation | SSRF — attacker modifies feed to point to internal URLs (localhost:8000, AWS metadata endpoint) | Validate URLs are http/https and hostname is external before scraping |
| Store downloaded product images in web-accessible directory without path sanitization | Path traversal if product ID or filename contains `../` | Use `uuid` or content hash as filename, never use product data in file paths |
| Pass raw product title to shell command without escaping | Command injection if title contains backticks or `$()` | Always use `subprocess` with list args (not shell=True); use textfile for FFmpeg text |
| Log full API responses containing product descriptions | Sensitive pricing data in logs | Log summary only (product count, status) not full product data |

---

## UX Pitfalls

Common user experience mistakes for the product browser and video generation UI.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Show all 9,987 products in a single scrollable list | Browser freezes; unusable for product selection | Paginate (50 per page) with search/filter; virtual scrolling if needed |
| Start batch render without showing estimated time and cost | User doesn't know if it will take 5 minutes or 2 hours | Show "~X minutes, ~Y ElevenLabs credits" estimate before confirming batch |
| No way to see which products in a batch failed | User re-runs entire batch to fix one failure | Per-product status in batch progress UI (table with status icons) |
| Trigger AI image generation for every product in batch by default | Surprise API cost; slow batch | Make AI images explicitly opt-in; show cost estimate per product |
| Show raw feed description text in product browser | HTML tags visible; messy UI | Always display cleaned text (strip HTML) in product browser |
| No preview before batch commit | Wasted rendering for wrong template settings | Single-product preview mode before launching batch |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Feed parser:** Test against the actual Nortia.ro XML file (not a mock) — namespace handling, encoding, field availability may differ from spec
- [ ] **Romanian text rendering:** Test with products containing all diacritics: ă â î ș ț (comma-below variants, not cedilla variants) — verify at font level
- [ ] **Image downloads:** Test with broken URLs, redirects (CDN URL shorteners), HTTPS-only servers, and very large images (some feeds include unoptimized 5MB+ images)
- [ ] **Aspect ratio handling:** Test with portrait, landscape, and square product images — verify all three look correct in the 9:16 output
- [ ] **Ken Burns performance:** Benchmark with 5 and 20 products — total render time must be acceptable before committing to zoompan
- [ ] **Batch failure isolation:** Deliberately break one product (point to non-existent image) in a 5-product batch — verify other 4 complete successfully
- [ ] **ElevenLabs credit consumption:** Calculate credits for one full batch run against real product descriptions — verify it stays within 100k/month budget
- [ ] **Price formatting:** Test products with sale prices (both price fields present) and without — verify display logic handles both cases
- [ ] **XML namespace parsing:** Test `g:price`, `g:brand`, etc. parse correctly — log a warning if namespaced fields return empty for >10% of products

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| diacritics corrupted in rendered videos | HIGH — re-render all affected videos | Switch to `textfile=` pattern; regenerate using cached downloaded images (no re-download needed) |
| Batch job crashed mid-run with no per-product state | MEDIUM — re-run batch | Add per-product state tracking; implement "resume batch" feature that skips already-completed products |
| AI image costs unexpectedly high | LOW — no data loss | Add `--dry-run` flag to estimate cost before generation; implement idempotency cache |
| Feed XML namespace mismatch = empty product data | MEDIUM | Add validation step after parsing: log warning if >10% of products have empty price/brand; halt if >50% empty |
| Ken Burns too slow for batch | MEDIUM | Add configurable option: `ken_burns: bool = False` for batch mode, simple scale/crop for speed |
| Aspect ratio mismatch = stretched images in production | HIGH — re-render | Detect during image download (PIL `Image.size` check) and store aspect ratio; fix scale filter |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Romanian diacritics in drawtext (#1) | Phase 1: Feed parsing + image pipeline | Render a test clip with "Produs ș.r.l. Ță special" as title overlay |
| XML loaded into memory (#2) | Phase 1: Feed parsing | Measure Python process memory while parsing full Nortia.ro feed |
| Image download blocks rendering (#3) | Phase 1: Image pipeline + Phase 3: Batch | Time a 10-product batch from request to first rendered video |
| Ken Burns too slow (#4) | Phase 2: Image-to-video composition | Benchmark Ken Burns vs simple scale on 5 images; document time per image |
| Aspect ratio mismatch (#5) | Phase 2: Image-to-video composition | Test with portrait, landscape, square images from real feed |
| Web scraping fragile (#6) | Phase 2: Visual sources | Test against Nortia.ro product pages; verify fallback works when scraping fails |
| HTML in product descriptions (#7) | Phase 1: Feed parsing | Parse 10 real products and verify `clean_product_text()` output has no HTML |
| Batch error isolation (#8) | Phase 3: Batch processing | Inject one failing product into a 5-product batch; verify others complete |
| Missing image fallback (#9) | Phase 1: Image pipeline | Test with broken image URL; verify placeholder renders without FFmpeg error |
| Price % escaping (#10) | Phase 2: Text overlay composition | Test with `"Reducere 30%"` in overlay text; verify `%` displays correctly |
| AI image cost control (#11) | Phase 2: Visual sources | Verify cost estimate shown before batch; verify idempotency for re-runs |
| WSL font path (#12) | Phase 1: Video composition foundation | Test drawtext with WSL Linux font path vs Windows path |
| XML namespace parsing (#13) | Phase 1: Feed parsing | Verify `g:price`, `g:brand` parse correctly from real Nortia.ro feed |

---

## Sources

**HIGH Confidence (official documentation + direct FFmpeg behavior):**
- [FFmpeg drawtext filter documentation](https://ffmpeg.org/ffmpeg-filters.html) — textfile option, escaping rules
- [FFmpeg drawtext escaping levels](https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/drawing_texts/drawtext.html) — four-level escaping documented
- [lxml iterparse performance](https://lxml.de/performance.html) — iterparse vs DOM trade-offs
- [Parsing large XML efficiently in Python](https://pranavk.me/python/parsing-xml-efficiently-with-python/) — iterparse patterns

**MEDIUM Confidence (multiple community sources, verified patterns):**
- [Ken Burns effect with FFmpeg](https://mko.re/blog/ken-burns-ffmpeg/) — zoompan filter performance characteristics
- [FFmpeg image aspect ratio handling](https://creatomate.com/blog/how-to-create-a-slideshow-from-images-using-ffmpeg) — scale + pad approach
- [Python requests retry strategies](https://oxylabs.io/blog/python-requests-retry) — batch download error handling
- [Cloudflare anti-bot bypass options](https://scrapfly.io/blog/posts/how-to-bypass-cloudflare-anti-scraping) — web scraping reliability
- [Google Shopping feed data quality issues](https://feedarmy.com/kb/common-google-shopping-errors-problems-mistakes/) — common feed problems
- [FFmpeg drawtext font path Windows](https://forum.videohelp.com/threads/382414-ffmpeg-drawtext-not-working) — Windows path escaping issues

**Edit Factory Codebase (direct inspection):**
- `app/services/assembly_service.py` — existing pipeline patterns to preserve or avoid
- `app/services/subtitle_styler.py` — ASS subtitle approach (different from drawtext)
- `app/api/library_routes.py` — existing BackgroundTasks pattern and job storage
- `PROJECT.md` — confirmed: Nortia.ro feed = ~9,987 products, ElevenLabs 100k credits/month

---
*Pitfalls research for: Product feed video generation (v5) added to Edit Factory*
*Researched: 2026-02-20*
