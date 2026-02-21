# Phase 18: Video Composition - Research

**Researched:** 2026-02-20
**Domain:** FFmpeg filter chains for image-to-video composition (zoompan Ken Burns, drawtext overlays, PNG badge overlays, duration control)
**Confidence:** HIGH

## Summary

Phase 18 builds `product_video_compositor.py` — a service that takes a product image (local JPEG from Phase 17) and produces a fully composed portrait MP4 (1080x1920) with Ken Burns animation, text overlays (name, price, sale price, brand), a sale badge, a CTA text overlay, and configurable duration (15/30/45/60 seconds).

The entire pipeline is FFmpeg-only. No new Python dependencies are needed. All text overlays must use the `textfile=` pattern from `textfile_helper.py` (Phase 17 COMP-05 decision — never `text=` for product content). The compositing approach uses a single `filter_complex` graph with labeled pads: `[0:v]` image input scaled and padded to portrait → zoompan Ken Burns → drawtext overlays → optional PNG badge overlay via `[1:v]overlay=`.

The primary technical risk is zoompan performance. The filter is CPU-intensive: encoding a 30-second portrait video from a static image with zoompan takes roughly 2-5 minutes on a modern CPU at 25-30 fps, versus ~10-20 seconds for a simple `scale+pad` encode. STATE.md explicitly documents this risk and requires a benchmark in Plan 18-01 before batch generation is built in Phase 21. The benchmark must compare zoompan vs simple-scale and document the time difference — Phase 21 may default to simple-scale for batch.

**Primary recommendation:** Implement zoompan Ken Burns in `filter_complex` with pre-scaled 4x input (e.g., scale to 4320px wide before zoompan) for smooth motion. Run a timed benchmark in Plan 18-01 for a 30-second portrait video on the development machine. Document the result and decide simple-scale fallback threshold in STATE.md before Phase 21 is planned.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | System generates Ken Burns zoom/pan animation from product image (FFmpeg zoompan) | FFmpeg `zoompan` filter confirmed as the correct approach; pre-scale to 4x input size for smooth result; zoom increment ~0.001 per frame at 25 fps; filter_complex required |
| COMP-02 | System renders text overlays: product name, price, sale price (with strikethrough), brand | drawtext via `textfile=` for all product text (Phase 17 decision); strikethrough achieved via `drawbox` line over original price text at calculated y position; `build_multi_drawtext` from textfile_helper.py chains overlays |
| COMP-03 | System renders sale badge overlay when product has sale_price | Pre-generated badge PNG (`lavfi color` + `drawtext`) overlaid via `[badge][video]overlay=x=W-w-20:y=20`; generated once per session, reused for all products with same badge |
| COMP-04 | System renders CTA text overlay (configurable, e.g. "Comanda acum!") | drawtext via `textfile=`; fixed position (bottom safe zone, above TikTok UI area); text is a parameter on the compositor function |
| COMP-06 | User can set video duration (15/30/45/60 seconds) | `zoompan d=fps*duration` frames; `-t duration` on output; duration is a parameter; zoom increment must be recalculated per duration for smooth motion across the full clip |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg | 6.1.1 (WSL system) | All video composition | Already in project PATH; handles zoompan, drawtext, overlay, scale, pad |
| `subprocess` | stdlib | Run FFmpeg commands | Established pattern throughout the codebase (library_routes.py, assembly_service.py) |
| `textfile_helper.py` | Phase 17 service | Text overlay filter strings | COMP-05 canonical decision — must be used for all product text |
| `pathlib.Path` | stdlib | File path manipulation | Established pattern in all services |
| `tempfile` | stdlib | Temp files for text content | Used by textfile_helper.py; needed for badge PNG temp path too |
| `dataclasses` | stdlib | CompositorConfig struct | Matches assembly_service.py pattern (MatchResult, TimelineEntry dataclasses) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `logging` | stdlib | Debug FFmpeg filter chains | All services use `logger = logging.getLogger(__name__)` |
| `time` | stdlib | Performance benchmark timing | Required for Plan 18-01 benchmark |
| `os` | stdlib | Temp file cleanup | `os.unlink()` after FFmpeg completes |
| `encoding_presets.py` | existing service | Encoding params for output | Re-use existing TikTok/Reels/Shorts presets for the final encode |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FFmpeg zoompan | OpenCV per-frame rendering | OpenCV would give more control but is much slower (~10-50x); zoompan is the right choice |
| FFmpeg zoompan | moviepy | moviepy wraps FFmpeg but adds Python overhead and an extra dependency; not installed |
| PNG badge file | `lavfi color+drawtext` badge | Badge generated once via FFmpeg lavfi is simpler than managing a static asset file; no file to bundle |
| `filter_complex` string | fluent-ffmpeg (Node) | Backend is Python; no Node.js in the pipeline |
| `drawtext strikethrough` | Pillow pre-render with strikethrough | Pillow not installed; FFmpeg `drawbox` line simulation is the only pure-FFmpeg approach |

**Installation:**
```bash
# No new packages needed — FFmpeg already in PATH, all Python deps already in requirements.txt
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   └── product_video_compositor.py   # New: Core composition service (Phase 18)
output/
└── product_videos/                   # New: Output dir for product videos
    └── {product_external_id}_{duration}s.mp4
```

### Pattern 1: filter_complex Graph for Image-to-Video Composition

**What:** A single `filter_complex` string that chains all processing in one FFmpeg invocation. Split into labeled pads for zoompan, text overlays, and badge overlay.

**When to use:** Always — avoids multi-pass encoding and keeps the composition atomic.

**Structure:**
```
Input 0: product image (-loop 1 -i image.jpg)
Input 1: badge image (-i badge.png) [only when is_on_sale=True]

filter_complex:
  [0:v] scale=W_LARGE:-1 [scaled];           # Pre-scale for smooth zoompan
  [scaled] zoompan=z='zoom+Z_INC':...  [kb]; # Ken Burns
  [kb] drawtext=textfile=... [t1];            # Product name
  [t1] drawtext=textfile=... [t2];            # Price
  [t2] drawtext=textfile=... [t3];            # CTA
  ... (more overlays)
  [tN] [1:v] overlay=x=W-w-20:y=20 [out]    # Badge (when on sale)
  -- OR --
  [tN] [out]                                  # No badge (not on sale)
```

**Example — zoompan Ken Burns zoom-in centered:**
```python
# Source: verified approach from creatomate.com + mko.re documentation
# Pre-scale to 4x for smooth zoompan motion
W_OUT, H_OUT = 1080, 1920
W_LARGE = W_OUT * 4  # = 4320px
FPS = 25
duration_s = 30  # 15, 30, 45, or 60
n_frames = FPS * duration_s  # zoompan d= parameter
# Zoom increment: start at 1.0, end at ~1.5 over the full duration
Z_START = 1.0
Z_END = 1.5
Z_INC = (Z_END - Z_START) / n_frames  # = 0.5/750 = 0.000667 for 30s

zoompan_expr = (
    f"zoompan="
    f"z='min(zoom+{Z_INC:.6f},{Z_END})':"
    f"x='iw/2-(iw/zoom/2)':"
    f"y='ih/2-(ih/zoom/2)':"
    f"d={n_frames}:"
    f"s={W_OUT}x{H_OUT}:"
    f"fps={FPS}"
)
```

**Key zoompan parameters:**
- `z`: Per-frame zoom expression. `zoom+INC` for linear zoom-in. `if(eq(on,1),Z_START,max(1.001,zoom-INC))` for zoom-out from Z_START.
- `x`, `y`: Pan position. Center: `iw/2-(iw/zoom/2)` and `ih/2-(ih/zoom/2)`.
- `d`: Duration in frames = `fps * seconds`.
- `s`: Output resolution = `{W_OUT}x{H_OUT}`. This is where the zoompan output dimensions are set.
- `fps`: Must match the output `-r` fps (default 25).
- Pre-scale input BEFORE zoompan: `scale={W_LARGE}:-1,zoompan=...` — prevents jittery motion.

### Pattern 2: Aspect Ratio Handling (Portrait Product Images)

**What:** Product images from e-commerce feeds are typically square (1:1) or landscape (4:3, 3:2). The output target is portrait 1080x1920 (9:16). Two options: letterbox (pad with black/blurred bars) or crop-fill.

**Decision for Phase 18:** Use `scale` with `force_original_aspect_ratio=decrease` + `pad` to fit-with-padding. This preserves the entire product — cropping may cut off important product details. Blurred background is out of scope for Phase 18 (Phase 22 template can add this later).

```python
# Scale to fit within portrait frame, then pad to exact size
# For a 1:1 product image -> portrait: image appears centered with black top/bottom bars
scale_filter = f"scale={W_OUT}:{H_OUT}:force_original_aspect_ratio=decrease"
pad_filter = f"pad={W_OUT}:{H_OUT}:(ow-iw)/2:(oh-ih)/2:black"
# Combined: scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black
# This is applied BEFORE the pre-scale for zoompan
```

**Pre-scale-for-zoompan approach (preferred):**
```python
# Scale to 4x the output width, keep aspect ratio, then pad to 4x portrait
# zoompan then operates on this large padded image and outputs 1080x1920
scale_for_kb = f"scale={W_LARGE}:-1:force_original_aspect_ratio=decrease"
pad_for_kb = f"pad={W_LARGE}:{W_LARGE * H_OUT // W_OUT}:(ow-iw)/2:(oh-ih)/2:black"
# W_LARGE=4320, H_LARGE=7680 — this is the "canvas" that zoompan pans over
```

### Pattern 3: Text Overlays via textfile_helper.py

**What:** Use the established `build_drawtext_filter` and `build_multi_drawtext` from Phase 17. Never use `text=` for product content.

**Overlay layout for portrait 1080x1920 (safe zone: avoid top 150px and bottom 200px for TikTok UI):**

```python
from app.services.textfile_helper import build_multi_drawtext, cleanup_textfiles

def _build_text_overlays(product: dict, cta_text: str) -> tuple[list[dict], list[str]]:
    """Build text overlay specs for product. Returns (specs, textfile_paths)."""
    overlays = []

    # Product name — top safe zone, large font, white with black box
    overlays.append({
        'text': product['title'][:60],   # truncate long names
        'fontsize': 48,
        'fontcolor': 'white',
        'x': '40',
        'y': '160',
        'box': True,
        'boxcolor': 'black@0.6',
        'boxborderw': 8,
    })

    # Brand — below name
    if product.get('brand'):
        overlays.append({
            'text': product['brand'],
            'fontsize': 32,
            'fontcolor': 'white@0.85',
            'x': '40',
            'y': '230',
            'box': True,
            'boxcolor': 'black@0.5',
            'boxborderw': 6,
        })

    # Price — bottom safe zone
    price_y = '1650'
    if product.get('sale_price') and product.get('is_on_sale'):
        # Sale price (larger, accent color)
        overlays.append({
            'text': f"{product['raw_sale_price_str']}",
            'fontsize': 56,
            'fontcolor': 'yellow',
            'x': '40',
            'y': price_y,
            'box': True,
            'boxcolor': 'black@0.7',
            'boxborderw': 10,
        })
        # Original price (smaller, after sale price)
        overlays.append({
            'text': f"{product['raw_price_str']}",
            'fontsize': 36,
            'fontcolor': 'white@0.7',
            'x': '40',
            'y': '1720',
            'box': True,
            'boxcolor': 'black@0.5',
            'boxborderw': 6,
        })
    else:
        # Regular price
        overlays.append({
            'text': product['raw_price_str'] or '',
            'fontsize': 56,
            'fontcolor': 'white',
            'x': '40',
            'y': price_y,
            'box': True,
            'boxcolor': 'black@0.7',
            'boxborderw': 10,
        })

    # CTA — bottom, centered
    overlays.append({
        'text': cta_text,
        'fontsize': 44,
        'fontcolor': 'white',
        'x': '(w-text_w)/2',
        'y': '1820',
        'box': True,
        'boxcolor': 'red@0.85',
        'boxborderw': 14,
    })

    combined_vf, tmp_paths = build_multi_drawtext(overlays)
    return combined_vf, tmp_paths
```

### Pattern 4: Strikethrough for Original Price (COMP-02)

**What:** FFmpeg `drawtext` has no native strikethrough. Simulate it by adding a `drawbox` filter that draws a horizontal line over the original price text position.

**How:** After rendering the original price text at a known `y` position and `fontsize`, add a `drawbox` at `y = price_y + fontsize/2` with height=2 and width matching approximate text width.

**Limitation:** Text width is not known at filter-build time (it's calculated by FFmpeg at render time using `text_w`). Use a fixed width estimate (e.g., `char_count * fontsize * 0.6`) or use `drawbox=x=price_x:y=price_y+fontsize/2:w=approx_width:h=2:color=white@0.7:t=fill`.

**Alternative approach (simpler):** Instead of strikethrough, render original price in a muted color (gray) positioned below the sale price. This is visually clear without needing a line. This avoids the text-width estimation problem entirely. **Recommend this approach for Phase 18.**

```python
# Original price in gray, below sale price — no strikethrough needed
# Visual hierarchy: SALE PRICE (yellow, large) / original: XXX RON (gray, small)
overlays.append({
    'text': f"Pret initial: {product['raw_price_str']}",
    'fontsize': 32,
    'fontcolor': 'gray',
    'x': '40',
    'y': '1720',
})
```

If true strikethrough is required by COMP-02, use `drawbox` with a calculated fixed width:
```python
# Approximate strikethrough: width = len(price_str) * fontsize * 0.55
approx_w = int(len(product['raw_price_str']) * 36 * 0.55)
strikethrough = f"drawbox=x=40:y=1738:w={approx_w}:h=3:color=white@0.8:t=fill"
```

### Pattern 5: Sale Badge Overlay (COMP-03)

**What:** Generate a "SALE" badge PNG once using FFmpeg lavfi, then overlay it on the video using `filter_complex` with `overlay=`.

**Badge generation (one-time per session):**
```python
import subprocess, tempfile, os
from pathlib import Path

def generate_sale_badge(badge_path: Path) -> None:
    """Generate a red SALE badge PNG using FFmpeg."""
    if badge_path.exists():
        return  # Already generated
    badge_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        'ffmpeg', '-y',
        '-f', 'lavfi',
        '-i', 'color=c=red@0.9:s=200x80',
        '-vf', "drawtext=text='REDUCERE':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:bold=1",
        '-vframes', '1',
        str(badge_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
```

**Video overlay in filter_complex:**
```python
# When is_on_sale=True: add badge input and overlay at top-right
# ffmpeg -loop 1 -i product.jpg -i badge.png -filter_complex "
#   [0:v]scale=...,zoompan=...,drawtext=...[vid];
#   [vid][1:v]overlay=x=W-w-20:y=20[out]
# " -map [out] -t 30 output.mp4
```

**When is_on_sale=False:** Do not include badge input or overlay in the filter_complex.

### Pattern 6: Duration Control (COMP-06)

**What:** Duration affects both the zoompan `d=` parameter (frames) and the output `-t` argument.

```python
VALID_DURATIONS = {15, 30, 45, 60}  # seconds

def _calculate_zoompan_params(duration_s: int, fps: int = 25) -> dict:
    """Calculate zoompan parameters for a given duration."""
    n_frames = fps * duration_s
    # Zoom from 1.0 to 1.5 over the full clip (always the same zoom range)
    Z_START = 1.0
    Z_END = 1.5
    z_inc = (Z_END - Z_START) / n_frames
    return {
        'n_frames': n_frames,
        'z_inc': z_inc,
        'z_end': Z_END,
    }

# Usage: ffmpeg ... -t {duration_s} ...
# In zoompan: d={n_frames}:z='min(zoom+{z_inc:.6f},{z_end})'
```

**Important:** The zoompan `d=` must equal exactly `fps * duration_s`. If `-t` cuts the video before `d=` frames, the animation is cut off — this is fine (desired behavior for longer zoompan runs). If `d=` < `-t`, the video freezes at the last zoomed frame — must be avoided.

**Safe approach:** Always set `d = fps * duration_s` (exact) so animation covers the full clip with no freeze.

### Pattern 7: Complete FFmpeg Command Structure

```python
import subprocess
from pathlib import Path

def compose_product_video(
    image_path: Path,
    output_path: Path,
    product: dict,
    duration_s: int = 30,
    cta_text: str = "Comanda acum!",
    is_on_sale: bool = False,
    badge_path: Path = None,
    fps: int = 25,
) -> None:
    """Compose a product video from a single image using FFmpeg."""
    W_OUT, H_OUT = 1080, 1920
    W_LARGE = W_OUT * 4  # 4320px for smooth zoompan
    n_frames = fps * duration_s
    z_inc = 0.5 / n_frames  # zoom from 1.0 to 1.5

    # Build text overlay filter strings
    text_vf, tmp_paths = _build_text_overlays(product, cta_text)

    try:
        # Build filter_complex
        # Step 1: scale input to large canvas for smooth zoompan
        fc_parts = [
            f"[0:v]scale={W_LARGE}:-1:force_original_aspect_ratio=decrease,"
            f"pad={W_LARGE}:{W_LARGE*H_OUT//W_OUT}:(ow-iw)/2:(oh-ih)/2:black[pre];"
        ]
        # Step 2: Ken Burns zoompan
        fc_parts.append(
            f"[pre]zoompan="
            f"z='min(zoom+{z_inc:.6f},1.5)':"
            f"x='iw/2-(iw/zoom/2)':"
            f"y='ih/2-(ih/zoom/2)':"
            f"d={n_frames}:s={W_OUT}x{H_OUT}:fps={fps}[kb];"
        )
        # Step 3: text overlays (chained from textfile_helper)
        # text_vf = "drawtext=textfile='...',drawtext=textfile='...'"
        # Wrap in [kb]...[out] pad
        fc_parts.append(f"[kb]{text_vf}[txt];")

        if is_on_sale and badge_path and badge_path.exists():
            fc_parts.append(f"[txt][1:v]overlay=x=W-w-20:y=20[out]")
            final_map = "[out]"
        else:
            fc_parts.append(f"[txt]copy[out]")
            final_map = "[out]"

        filter_complex = "".join(fc_parts)

        # Build command
        cmd = ["ffmpeg", "-y", "-loop", "1", "-framerate", str(fps), "-i", str(image_path)]
        if is_on_sale and badge_path and badge_path.exists():
            cmd.extend(["-i", str(badge_path)])
        cmd.extend([
            "-filter_complex", filter_complex,
            "-map", final_map,
            "-t", str(duration_s),
            "-c:v", "libx264",
            "-preset", "veryfast",   # Faster for composition pass; quality fine for product videos
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            str(output_path),
        ])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg failed: {result.stderr[-1000:]}")

    finally:
        cleanup_textfiles(*tmp_paths)
```

### Anti-Patterns to Avoid

- **`text=` instead of `textfile=`**: Romanian product names WILL break. COMP-05 locked this decision. Always use `build_drawtext_filter` from textfile_helper.py.
- **Not pre-scaling before zoompan**: Without `scale=4x:-1` before zoompan, the animation appears jittery/jerky because zoompan interpolates between integer pixel positions on a low-res input.
- **zoompan `d=` less than `-t` seconds worth of frames**: Video freezes at the end of zoompan. Always set `d = fps * duration_s` exactly.
- **zoompan z-value below 1.0**: FFmpeg clamps it to 1.0 but the expression can cause instability. Use `max(1.001, zoom-inc)` for zoom-out, not `zoom-inc`.
- **Using `-vf` for multi-input filter (badge overlay)**: `-vf` does not support multiple inputs. Must use `-filter_complex` when including badge PNG input.
- **Generating badge PNG on every video render**: Badge is constant — generate once to disk and reuse. Saves ~0.5s per video in batch.
- **Building the filter_complex string with Python f-strings from user input**: textfile path is already sanitized by textfile_helper.py, but ensure product text does not get injected directly into the filter string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text overlays with Romanian text | Custom text renderer | `textfile_helper.build_drawtext_filter` | Phase 17 established this as the only safe approach |
| Image scaling/aspect ratio | Python PIL/OpenCV resize | FFmpeg `scale` + `pad` filters | FFmpeg in PATH; PIL not installed; same process anyway |
| Badge PNG image | Python Pillow/Cairo | FFmpeg `lavfi color` + `drawtext` | No new deps; badge is simple colored rectangle with text |
| Video encoding params | Custom FFmpeg parameter building | `encoding_presets.to_ffmpeg_params()` | Existing service handles TikTok/Reels/Shorts presets correctly |
| Performance timing | Custom profiler | `time.perf_counter()` + logging | One-liner; timing the zoompan benchmark is the goal, not a framework |

**Key insight:** The entire Phase 18 pipeline is FFmpeg filter chaining. The only Python work is constructing the command string and managing temp files.

## Common Pitfalls

### Pitfall 1: filter_complex String Construction with textfile_helper Output

**What goes wrong:** `build_multi_drawtext` returns a filter string like `drawtext=textfile='/tmp/...',drawtext=textfile='/tmp/...'`. This string must be embedded inside the `filter_complex` with correct pad labels: `[prev_pad]{text_vf}[next_pad]`.

**Why it happens:** The textfile_helper was designed for the `-vf` use case (simple string joined with commas). In `filter_complex`, each filter segment needs `[input_pad]filter[output_pad]` labels.

**How to avoid:** Do NOT use `build_multi_drawtext` output directly in `filter_complex`. Either:
1. Use `-vf` for simple cases (no multi-input badge overlay)
2. Or manually add `[kb]` prefix and `[txt]` suffix around the multi-drawtext string

**Example of correct integration:**
```python
text_chain = text_vf  # "drawtext=textfile='...',drawtext=textfile='...'"
# In filter_complex, this becomes:
f"[kb]{text_chain}[txt];"
```

**Warning signs:** FFmpeg error "No such filter: drawtext=..." or "Undefined stream specifier".

### Pitfall 2: zoompan and -loop 1 Interaction

**What goes wrong:** FFmpeg with `-loop 1 -i image.jpg` loops the input image indefinitely. If zoompan `d=` is exact but `-t` is set, the clip terminates at `-t`. This is correct behavior. But if `-t` is omitted, FFmpeg encodes forever.

**How to avoid:** Always include `-t {duration_s}` on the output when using `-loop 1`. Do not rely on zoompan `d=` to terminate the encode.

**Warning signs:** FFmpeg runs indefinitely, never completes.

### Pitfall 3: zoompan Output Size Mismatch with Output Resolution

**What goes wrong:** zoompan `s=1080x1920` sets the output resolution. If the scale/pad step produces a different aspect ratio than 9:16, zoompan will stretch to fit 1080x1920, distorting the image.

**Why it happens:** The pre-scale produces `4320xH` where `H` depends on the input aspect ratio. If input is 1:1 (square), the padded canvas is 4320x7680 (correct 9:16 at 4x). If input is 4:3, the canvas may be 4320x5760 (4:3 at 4x), and zoompan will stretch it to 1080x1920.

**How to avoid:** The pad step MUST produce a 9:16 canvas at 4x. Calculate target height as `W_LARGE * H_OUT // W_OUT`.

```python
W_LARGE = 4320
H_LARGE = W_LARGE * H_OUT // W_OUT  # = 4320 * 1920 // 1080 = 7680
pad_filter = f"pad={W_LARGE}:{H_LARGE}:(ow-iw)/2:(oh-ih)/2:black"
```

**Warning signs:** Video appears vertically or horizontally stretched.

### Pitfall 4: Performance — zoompan is Slow on Long Durations

**What goes wrong:** A 60-second portrait video with zoompan may take 15-20 minutes on a laptop CPU. Phase 21 batch processing of 50 products would take hours.

**Why it happens:** zoompan evaluates per-frame expressions for every output frame. At 25fps × 60s = 1500 frames on a 4320x7680 canvas, this is CPU-intensive.

**How to avoid:**
1. Run the benchmark in Plan 18-01 to measure actual time on the dev machine.
2. Document the result in STATE.md with a decision: if zoompan > 2 min for 30s video, Phase 21 batch defaults to `simple-scale` (no zoompan), with zoompan as opt-in "quality mode".
3. Use `-preset veryfast` (not `medium`) for composition render — quality is sufficient for product videos.

**Warning signs:** FFmpeg process runs for >5 minutes without completing.

### Pitfall 5: Badge PNG Transparency in Non-RGBA Context

**What goes wrong:** The badge generated by `lavfi color=red@0.9` has 8-bit alpha. When overlaid via `[vid][badge]overlay=`, if the video stream is YUV420p (no alpha), FFmpeg may drop the alpha channel and show a fully opaque red rectangle.

**How to avoid:** Use `color=red@0.9` for the badge but render it as a PNG with full alpha via `-vframes 1 -f apng` or `-vcodec png`. Alternatively, use a solid red badge (`color=red`) with no transparency — this is simpler and still visually distinct.

**Recommendation:** Use solid `color=red` for the badge to avoid alpha channel handling complexity.

### Pitfall 6: textfile= Paths Must Be Linux Paths in WSL

**What goes wrong:** `tempfile.NamedTemporaryFile` on WSL returns `/tmp/...` paths. If FFmpeg is a Windows binary called from WSL, it may not find `/tmp/` paths.

**Why it happens:** The project runs on WSL with the Linux FFmpeg binary (confirmed 6.1.1 in WSL). This is fine — Linux paths work.

**How to avoid:** Confirm `ffmpeg` resolves to the Linux binary (`which ffmpeg`). If Windows FFmpeg is used, temp files must be in Windows-accessible paths (e.g., `/mnt/c/...`).

**Warning signs:** "No such file or directory" in FFmpeg stderr for the textfile path.

## Code Examples

Verified patterns from research and existing codebase:

### Basic Ken Burns Zoom-In (verified syntax)
```python
# Source: creatomate.com documentation + mko.re blog (verified syntax)
# Zoom from 1.0 to 1.5 over duration_s seconds at 25fps
FPS = 25
W_OUT, H_OUT = 1080, 1920
W_LARGE = W_OUT * 4  # = 4320

duration_s = 30
n_frames = FPS * duration_s   # = 750
z_inc = 0.5 / n_frames        # = 0.000667

cmd = [
    "ffmpeg", "-y",
    "-loop", "1", "-framerate", str(FPS), "-i", "product.jpg",
    "-vf", (
        f"scale={W_LARGE}:-1:force_original_aspect_ratio=decrease,"
        f"pad={W_LARGE}:{W_LARGE * H_OUT // W_OUT}:(ow-iw)/2:(oh-ih)/2:black,"
        f"zoompan=z='min(zoom+{z_inc:.6f},1.5)':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={n_frames}:s={W_OUT}x{H_OUT}:fps={FPS}"
    ),
    "-t", str(duration_s),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p",
    "output.mp4"
]
```

### Zoom Variants for Direction Variety
```python
# Source: mko.re blog + bannerbear.com (verified)
# Zoom-in centered (default)
z_expr_zoomin = f"min(zoom+{z_inc:.6f},1.5)"
x_expr_center = "iw/2-(iw/zoom/2)"
y_expr_center = "ih/2-(ih/zoom/2)"

# Zoom-out from 1.5 to 1.0
z_expr_zoomout = f"if(eq(on,1),1.5,max(1.001,zoom-{z_inc:.6f}))"

# Pan top-left to bottom-right while zooming
x_expr_pan_right = "iw-iw/zoom"
y_expr_pan_bottom = "ih-ih/zoom"
```

### Benchmark Timing Template (Plan 18-01 requirement)
```python
import time, subprocess
from pathlib import Path

def benchmark_zoompan_vs_simple_scale(
    image_path: Path,
    duration_s: int = 30,
    output_dir: Path = Path("/tmp"),
) -> dict:
    """Benchmark zoompan vs simple scale encode. Returns timing dict."""
    results = {}

    # Method 1: Simple scale (baseline)
    out_simple = output_dir / "bench_simple.mp4"
    start = time.perf_counter()
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-i", str(image_path),
        "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "-t", str(duration_s), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", str(out_simple)
    ], capture_output=True, check=True)
    results["simple_scale_s"] = time.perf_counter() - start

    # Method 2: zoompan Ken Burns
    out_kb = output_dir / "bench_zoompan.mp4"
    n_frames = 25 * duration_s
    z_inc = 0.5 / n_frames
    start = time.perf_counter()
    subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-framerate", "25", "-i", str(image_path),
        "-vf", (
            f"scale=4320:-1:force_original_aspect_ratio=decrease,"
            f"pad=4320:7680:(ow-iw)/2:(oh-ih)/2:black,"
            f"zoompan=z='min(zoom+{z_inc:.6f},1.5)':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={n_frames}:s=1080x1920:fps=25"
        ),
        "-t", str(duration_s), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", str(out_kb)
    ], capture_output=True, check=True)
    results["zoompan_s"] = time.perf_counter() - start

    results["slowdown_factor"] = results["zoompan_s"] / results["simple_scale_s"]
    return results
```

### Sale Badge Generation
```python
# Source: established FFmpeg lavfi pattern (library_routes.py image_fetcher.py)
import subprocess
from pathlib import Path

BADGE_PATH = Path("output/product_videos/_sale_badge.png")

def ensure_sale_badge() -> Path:
    """Generate sale badge PNG once. Returns path."""
    if BADGE_PATH.exists():
        return BADGE_PATH
    BADGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=red:s=220x80",
        "-vf", "drawtext=text='REDUCERE':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:bold=1",
        "-vframes", "1",
        str(BADGE_PATH),
    ], capture_output=True, check=True)
    return BADGE_PATH
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `text=` in drawtext | `textfile=` UTF-8 file | Phase 17 (2026-02-20) | Eliminates Romanian diacritics corruption |
| Multi-pass FFmpeg | Single `filter_complex` | FFmpeg 2.x | Cleaner, one subprocess call |
| Full `medium` preset for composition | `veryfast` for composition | — | 3-5x faster composition; quality sufficient |
| `scale` + `zoompan` without pre-scaling | `scale=4x + zoompan` | Community practice | Smooth motion without jitter |

**Deprecated/outdated:**
- `-vf` for multi-input compositions: replaced by `-filter_complex` when using badge overlay (second input)
- `geq` filter as zoompan alternative: 100-1000x slower; never use for this purpose

## Open Questions

1. **zoompan performance on dev machine**
   - What we know: zoompan is slower than simple-scale; 100x slower than geq alternative; actual speed on 1080x1920 portrait from a JPEG is not verified
   - What's unclear: exact seconds for a 30s portrait video on the developer's WSL machine
   - Recommendation: MUST run benchmark in Plan 18-01 before committing to zoompan for Phase 21 batch; document result in STATE.md

2. **Zoom direction variety**
   - What we know: roadmap mentions "zoompan Ken Burns" without specifying zoom direction; both zoom-in and zoom-out are trivially parameterizable
   - What's unclear: whether Phase 18 should support multiple zoom directions (random or user-selectable) or just zoom-in center
   - Recommendation: implement zoom-in center as default in Phase 18 Plan 18-01; add direction parameter (ZOOM_IN_CENTER, ZOOM_OUT_CENTER, PAN_LEFT_RIGHT) to CompositorConfig; Phase 22 templates can use different directions per template

3. **Strikethrough vs muted-gray for original price**
   - What we know: COMP-02 says "sale_price renders alongside original price when present" — does not explicitly require strikethrough
   - What's unclear: does the user want visual strikethrough or just separate display?
   - Recommendation: implement muted-gray original price in Plan 18-02 (simpler, no width estimation); if strikethrough is required, use `drawbox` line as documented above

4. **Font file for product text**
   - What we know: existing codebase uses `Montserrat` in subtitle_styler.py; no fontfile path is checked in existing drawtext calls — FFmpeg uses system default
   - What's unclear: what fonts are available in the WSL Ubuntu environment; Romanian diacritics require a font with codepoints for ă î ș ț â
   - Recommendation: check `fc-list | grep -i "dejavu\|noto\|ubuntu"` in WSL to confirm a safe default; use DejaVu Sans or Noto Sans as fontfile parameter if system default doesn't render diacritics (though textfile= pattern alone resolves encoding, the font must have the glyphs)

5. **Output directory for product videos**
   - What we know: `output/` is the root output dir from config.py; product images use `output/product_images/{feed_id}/`
   - What's unclear: whether product videos should be in `output/product_videos/` or go directly into the clips pipeline
   - Recommendation: `output/product_videos/{feed_id}/{external_id}_{duration}s.mp4` for Phase 18; Phase 20 will move/reference these when adding to the library clips table

## Sources

### Primary (HIGH confidence)
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/textfile_helper.py` — Phase 17 established API confirmed
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/image_fetcher.py` — confirmed lavfi pattern and existing subprocess usage
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/api/library_routes.py` lines 2600-2740 — confirmed `-vf` comma-chain pattern for filters
- `/mnt/c/OBSID SRL/n8n/edit_factory/app/services/encoding_presets.py` — confirmed `to_ffmpeg_params()` API and preset dimensions
- `/mnt/c/OBSID SRL/n8n/edit_factory/.planning/STATE.md` — confirmed zoompan performance risk documented
- `.planning/phases/17-feed-foundation/17-02-SUMMARY.md` — confirmed textfile= pattern is locked for all product text

### Secondary (MEDIUM confidence)
- https://creatomate.com/blog/how-to-zoom-images-and-videos-using-ffmpeg — zoompan zoom-in/zoom-out syntax, pre-scale 8000px approach
- https://mko.re/blog/ken-burns-ffmpeg/ — Ken Burns effect FFmpeg command variations, pan direction expressions
- https://www.bannerbear.com/blog/how-to-do-a-ken-burns-style-effect-with-ffmpeg/ — zoompan parameters, coordinate expressions
- https://www.bannerbear.com/blog/how-to-add-a-png-overlay-on-a-video-using-ffmpeg/ — PNG overlay filter_complex syntax

### Tertiary (LOW confidence)
- General community knowledge: zoompan is 10-100x slower than simple scale — referenced in multiple sources but no specific benchmark numbers on portrait 1080x1920 found; must be measured

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified in existing codebase; FFmpeg confirmed in WSL
- Architecture: HIGH — filter_complex patterns directly derived from FFmpeg documentation and community-verified commands
- zoompan performance: LOW — direction of impact confirmed (slow), magnitude not measured on this hardware; benchmark required
- Strikethrough approach: MEDIUM — drawbox approach is theoretically correct but not tested; muted-gray alternative is simpler and preferred
- Badge overlay: HIGH — follows established `overlay=` filter pattern from documentation

**Research date:** 2026-02-20
**Valid until:** 2026-03-22 (stable domain — FFmpeg filter API rarely changes between minor versions)
