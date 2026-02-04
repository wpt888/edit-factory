# Technology Stack - Video Quality Enhancement

**Project:** Edit Factory - Video Quality Enhancement Milestone
**Researched:** 2026-02-04
**Confidence:** HIGH (FFmpeg official docs + 2026 social media standards)

## Executive Summary

This research covers FFmpeg-based video quality enhancements for social media platforms (TikTok, Instagram Reels, YouTube Shorts). All recommendations are based on current 2026 best practices verified through official FFmpeg documentation and recent industry sources.

**Key Finding:** Current setup (CRF 23, preset "fast", 128k audio) is adequate but not optimized for 2026 social media standards. Specific improvements needed for:

1. Platform-specific encoding (CRF/bitrate optimization)
2. Audio loudness normalization (EBU R128 / -14 LUFS for social)
3. Video filters (denoising, sharpening, color correction)
4. Enhanced subtitle styling (shadow, glow, adaptive sizing)
5. Quality-aware segment scoring (blur detection, contrast analysis)

---

## Core Technology Stack

### Video Encoding

| Component | Current | Recommended | Why |
|-----------|---------|-------------|-----|
| **Codec** | libx264 / h264_nvenc | libx264 (CPU) / h264_nvenc (GPU) | Universal compatibility, H.264 remains standard for social media in 2026 |
| **CRF (CPU)** | 23 | 22-23 (quality), 23-25 (balanced) | CRF 22-23 is optimal for social media quality/filesize balance |
| **Preset** | fast | fast (speed), medium (quality) | "fast" is good for production; "medium" for higher quality when time permits |
| **Profile** | Not specified | high | Better compression, supported by all modern devices |
| **Level** | Not specified | 4.0 | Ensures compatibility with mobile devices |
| **Keyframes** | -g 60 | -g 60 -keyint_min 60 -sc_threshold 0 | Fixed keyframe interval prevents platform recompression |

### Audio Encoding

| Component | Current | Recommended | Why |
|-----------|---------|-------------|-----|
| **Codec** | AAC | AAC (libfdk_aac if available) | AAC is universal standard |
| **Bitrate** | 128k | 128k-192k | 128k sufficient for voice, 192k for music |
| **Sample Rate** | 48000 | 48000 Hz | Industry standard for video |
| **Channels** | 2 (stereo) | 2 (stereo) | Stereo expected by platforms |
| **Loudness** | Not normalized | -14 LUFS (social media) | Critical for consistent volume across platforms |

---

## Platform-Specific Presets (2026 Standards)

### Instagram Reels & TikTok

**Resolution:** 1080x1920 (9:16 portrait)
**Frame Rate:** 30 fps (standard), 60 fps (optional for high-motion)
**Video Bitrate:** 3,500-4,500 kbps target
**Audio:** 128-192 kbps AAC

```bash
ffmpeg -i input.mp4 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 \
  -profile:v high \
  -level:v 4.0 \
  -crf 23 \
  -preset fast \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -bf 2 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -pix_fmt yuv420p \
  output.mp4
```

**GPU (NVENC) variant:**
```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -vf "scale_cuda=1080:1920:force_original_aspect_ratio=decrease" \
  -c:v h264_nvenc \
  -preset p4 \
  -cq 23 \
  -g 60 -bf 2 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -pix_fmt yuv420p \
  output.mp4
```

### YouTube Shorts

**Resolution:** 1080x1920 (9:16 portrait) or 2160x3840 (4K optional)
**Frame Rate:** 30 fps (standard), 60 fps (high-motion content)
**Video Bitrate:** 8,000-15,000 kbps for 1080p
**Audio:** 128-192 kbps AAC

```bash
# 1080p Shorts
ffmpeg -i input.mp4 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 \
  -profile:v high \
  -level:v 4.2 \
  -crf 21 \
  -preset medium \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -bf 2 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -pix_fmt yuv420p \
  output.mp4

# 4K Shorts (optional, for high-quality content)
ffmpeg -i input.mp4 \
  -vf "scale=2160:3840:force_original_aspect_ratio=decrease,pad=2160:3840:(ow-iw)/2:(oh-ih)/2" \
  -c:v libx264 \
  -profile:v high \
  -level:v 5.2 \
  -crf 20 \
  -preset slow \
  -g 120 -keyint_min 120 -sc_threshold 0 \
  -bf 2 \
  -c:a aac -b:a 192k -ar 48000 -ac 2 \
  -pix_fmt yuv420p \
  output_4k.mp4
```

---

## Video Quality Filters

### Denoising (hqdn3d)

Reduces noise/grain in video, especially useful for low-light footage.

**Syntax:**
```bash
-vf "hqdn3d=luma_spatial:chroma_spatial:luma_tmp:chroma_tmp"
```

**Recommended presets:**
- **Light:** `hqdn3d=1.5:1.5:6:6` - Subtle noise reduction
- **Medium:** `hqdn3d=3:3:6:6` - Standard noise reduction
- **Heavy:** `hqdn3d=5:5:10:10` - Aggressive (may soften detail)

**Parameters:**
- `luma_spatial` (0-10): Spatial noise reduction for brightness
- `chroma_spatial` (0-10): Spatial noise reduction for color
- `luma_tmp` (0-20): Temporal noise reduction for brightness (across frames)
- `chroma_tmp` (0-20): Temporal noise reduction for color

**Use case:** Apply BEFORE sharpening to avoid amplifying noise.

### Sharpening (unsharp)

Enhances edges and details.

**Syntax:**
```bash
-vf "unsharp=luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount"
```

**Recommended presets:**
- **Light:** `unsharp=5:5:0.5:5:5:0.0` - Subtle sharpening
- **Medium:** `unsharp=5:5:1.0:5:5:0.0` - Standard sharpening
- **Heavy:** `unsharp=7:7:1.5:7:7:0.5` - Strong sharpening (risk of artifacts)

**Simplified syntax (common):**
```bash
-vf "unsharp=5:5:1.0"  # Matrix size 5x5, strength 1.0
```

**Parameters:**
- `luma_msize_x/y` (3-23, odd): Matrix size for luma (larger = stronger)
- `luma_amount` (-2.0 to 5.0): Sharpening strength (negative = blur)
- `chroma_msize_x/y`: Matrix size for chroma
- `chroma_amount`: Chroma sharpening strength

**Use case:** Apply AFTER denoising for best results.

### Color Correction (eq)

Adjusts brightness, contrast, saturation, gamma.

**Syntax:**
```bash
-vf "eq=brightness:contrast:saturation:gamma"
```

**Examples:**
- **Brighten:** `eq=brightness=0.1` (+10% brightness)
- **Increase contrast:** `eq=contrast=1.2` (20% more contrast)
- **Boost saturation:** `eq=saturation=1.3` (30% more saturation)
- **Combined:** `eq=brightness=0.05:contrast=1.15:saturation=1.2`

**Parameters:**
- `brightness` (-1.0 to 1.0): Brightness adjustment (0 = no change)
- `contrast` (0.0 to 3.0): Contrast multiplier (1.0 = no change)
- `saturation` (0.0 to 3.0): Saturation multiplier (1.0 = no change)
- `gamma` (0.1 to 10.0): Gamma correction (1.0 = no change)

**Use case:** Correct exposure issues or create visual style.

### Filter Chaining

Combine multiple filters with commas (order matters):

```bash
# Denoise → Sharpen → Color correct
-vf "hqdn3d=3:3:6:6,unsharp=5:5:1.0,eq=brightness=0.05:contrast=1.15:saturation=1.2"
```

**Best practice order:**
1. Scale/crop (if needed)
2. Denoise (hqdn3d)
3. Sharpen (unsharp)
4. Color correction (eq)
5. Subtitles (if burning in)

---

## Audio Loudness Normalization

### EBU R128 Standard (loudnorm filter)

**Target levels for 2026:**
- **Broadcasting / YouTube:** -23 LUFS (EBU R128 standard)
- **Social Media (TikTok, Reels):** -14 LUFS (louder for mobile)
- **Podcasts:** -16 LUFS

**Two-pass loudnorm (most accurate):**

```bash
# Pass 1: Analyze
ffmpeg -i input.mp4 -af loudnorm=I=-14:LRA=7:TP=-2:print_format=json -f null -

# Expected JSON output with measured_I, measured_LRA, measured_TP, measured_thresh

# Pass 2: Normalize with measured values
ffmpeg -i input.mp4 \
  -af loudnorm=I=-14:LRA=7:TP=-2:measured_I=-18.5:measured_LRA=11.2:measured_TP=-3.5:measured_thresh=-28.5:offset=0.5:linear=true \
  -c:v copy -c:a aac -b:a 192k \
  output.mp4
```

**Single-pass loudnorm (faster, less accurate):**

```bash
ffmpeg -i input.mp4 \
  -af "loudnorm=I=-14:LRA=7:TP=-2" \
  -c:v copy -c:a aac -b:a 192k \
  output.mp4
```

**Parameters:**
- `I` (Integrated loudness target): -23 LUFS (broadcast), -14 LUFS (social)
- `LRA` (Loudness Range target): 7 LU (tight), 11 LU (moderate)
- `TP` (True Peak limit): -2 dBTP (prevents clipping on mobile devices)

**Python library:**
- `ffmpeg-normalize` (PyPI): Automated two-pass normalization wrapper
- Install: `pip install ffmpeg-normalize`
- Usage: `ffmpeg-normalize input.mp4 -c:a aac -b:a 192k -o output.mp4 -t -14`

---

## Enhanced Subtitle Styling

### Advanced ASS/SSA Styling

Current implementation uses `force_style` parameter. Enhanced options:

**Current (working):**
```bash
-vf "subtitles='input.srt':force_style='FontName=Arial,FontSize=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=100'"
```

**Enhanced with shadow/glow:**

```bash
# Shadow (drop shadow behind text)
force_style='FontName=Arial,FontSize=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=3,Alignment=2,MarginV=100,Bold=1'

# Glow (outline + background box)
force_style='FontName=Arial,FontSize=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00FFFF00,BackColour=&H80000000,Outline=2,BorderStyle=3,Shadow=0,Alignment=2,MarginV=100,Bold=1'

# Adaptive sizing with PlayResX/PlayResY
force_style='PlayResX=1080,PlayResY=1920,FontName=Arial,FontSize=48,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=100,Bold=1'
```

**Key ASS/SSA Parameters:**
- `FontSize` (16-200): Font size in pixels (scales with PlayResX/PlayResY)
- `Outline` (0-4): Outline width in pixels
- `Shadow` (0-4): Shadow depth in pixels (0 = no shadow, higher = deeper)
- `BorderStyle`:
  - `1`: Outline + drop shadow (standard)
  - `3`: Opaque box background
- `PrimaryColour`: Text color in `&H00BBGGRR` format (hex BGR)
- `OutlineColour`: Outline color
- `BackColour`: Background/shadow color (with alpha: `&HAA` prefix for transparency)
- `Alignment`: 1-9 (numpad layout: 1=bottom-left, 2=bottom-center, 8=top-center, etc.)
- `MarginV`: Vertical margin in pixels from edge
- `PlayResX/PlayResY`: Resolution reference (critical for portrait videos 1080x1920)

**Color format conversion (Python helper):**
```python
def hex_to_ass(hex_color: str) -> str:
    """Convert #RRGGBB to &H00BBGGRR"""
    hex_color = hex_color.lstrip('#')
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"&H00{b:02X}{g:02X}{r:02X}"

def hex_to_ass_with_alpha(hex_color: str, alpha: int = 0) -> str:
    """Convert #RRGGBB with alpha (0-255, 0=opaque, 255=transparent)"""
    hex_color = hex_color.lstrip('#')
    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"
```

---

## Video Quality Analysis (for improved segment scoring)

### Python Libraries

#### OpenCV (already installed)
**Current:** `opencv-python-headless>=4.8.0`
**Use:** Frame extraction, basic quality metrics

```python
import cv2
import numpy as np

# Blur detection (Laplacian variance method)
def detect_blur(frame: np.ndarray) -> float:
    """Returns blur score (higher = sharper, lower = blurrier)"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
    return laplacian_var

# Threshold: < 100 = blurry, > 500 = sharp

# Contrast detection
def detect_contrast(frame: np.ndarray) -> float:
    """Returns contrast score (0-1, higher = more contrast)"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    contrast = gray.std() / 255.0
    return contrast

# Threshold: < 0.15 = low contrast, > 0.3 = high contrast
```

#### scikit-image (NEW - recommended)
**Install:** `pip install scikit-image>=0.22.0`
**Use:** Advanced quality metrics

```python
from skimage import exposure

# Low contrast detection (built-in)
def is_low_contrast_image(frame: np.ndarray, fraction_threshold: float = 0.05) -> bool:
    """Built-in method from scikit-image"""
    from skimage.exposure import is_low_contrast
    return is_low_contrast(frame, fraction_threshold=fraction_threshold)
```

#### BRISQUE (NEW - optional)
**Install:** Already available via OpenCV: `cv2.quality.QualityBRISQUE_create()`
**Use:** No-reference image quality assessment (0-100, lower = better quality)

```python
import cv2

# BRISQUE quality scoring
def score_brisque(frame: np.ndarray, model_path: str, range_path: str) -> float:
    """Returns BRISQUE score (0-100, lower is better)"""
    brisque = cv2.quality.QualityBRISQUE_create(model_path, range_path)
    score = brisque.compute(frame)[0]
    return score

# Requires pre-trained model files (download from OpenCV contrib)
# Threshold: < 30 = good quality, > 50 = poor quality
```

### FFmpeg Quality Metrics (NEW - optional)

#### ffmpeg-quality-metrics (Python wrapper)
**Install:** `pip install ffmpeg-quality-metrics>=3.11.0`
**Use:** PSNR, SSIM, VMAF comparison between videos
**Latest:** v3.11.2 released January 20, 2026

```python
from ffmpeg_quality_metrics import FfmpegQualityMetrics

# Compare two videos
metrics = FfmpegQualityMetrics("reference.mp4", "processed.mp4")
results = metrics.calculate(["ssim", "psnr"])
# Returns per-frame and global statistics
```

**Use case:** Compare before/after quality when applying filters.

### Recommended Stack Additions

```txt
# Add to requirements.txt

# Video Quality Analysis
scikit-image>=0.22.0          # Low contrast detection, exposure analysis
ffmpeg-quality-metrics>=3.11.0 # PSNR, SSIM, VMAF (optional, for validation)
```

---

## Improved Segment Scoring Algorithm

### Current Scoring
```python
combined_score = (motion * 0.6) + (variance * 0.3) + (brightness * 0.1)
```

### Enhanced Scoring (Proposed)

```python
import cv2
import numpy as np
from dataclasses import dataclass

@dataclass
class EnhancedVideoSegment:
    start_time: float
    end_time: float
    motion_score: float       # 0-1 (existing)
    variance_score: float     # 0-1 (existing)
    avg_brightness: float     # 0-1 (existing)
    blur_score: float         # NEW: Laplacian variance (higher = sharper)
    contrast_score: float     # NEW: Std dev of luminance (0-1)

    @property
    def quality_score(self) -> float:
        """Enhanced quality scoring with blur and contrast"""
        # Normalize blur score (threshold-based)
        blur_normalized = min(self.blur_score / 500.0, 1.0)  # 500 = sharp threshold

        # Combined score prioritizes motion + sharpness + contrast
        return (
            self.motion_score * 0.40 +      # Motion (most important for engagement)
            self.variance_score * 0.20 +    # Scene variety
            blur_normalized * 0.20 +        # Sharpness (NEW)
            self.contrast_score * 0.15 +    # Contrast (NEW)
            (1 - abs(self.avg_brightness - 0.5)) * 0.05  # Brightness balance
        )

def analyze_frame_quality(frame: np.ndarray) -> tuple[float, float]:
    """Returns (blur_score, contrast_score)"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

    # Blur detection (Laplacian variance)
    blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()

    # Contrast detection (standard deviation)
    contrast_score = gray.std() / 255.0

    return blur_score, contrast_score
```

**Integration:**
- Sample 3-5 frames per segment
- Average blur_score and contrast_score
- Update `VideoSegment.combined_score` property to use enhanced scoring
- Filter out segments with `blur_score < 100` (too blurry)
- Filter out segments with `contrast_score < 0.15` (too flat)

---

## Two-Pass Encoding (Optional)

### When to Use
- Precise bitrate control required (file size limits)
- Highest quality at target bitrate
- Broadcasting / professional delivery

### When NOT to Use
- Social media uploads (CRF is faster and sufficient)
- Quick turnaround needed
- No strict bitrate requirements

### Single-Pass CRF (Recommended for Social Media)
```bash
# Current approach - KEEP THIS
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -preset fast output.mp4
```

**Advantages:**
- Faster (1x encoding pass)
- Variable bitrate optimizes per-scene
- Sufficient for TikTok/Reels/Shorts

### Two-Pass (Only if bitrate control needed)

```bash
# Pass 1: Analysis
ffmpeg -i input.mp4 -c:v libx264 -preset medium -b:v 4000k -pass 1 -an -f null /dev/null

# Pass 2: Encoding
ffmpeg -i input.mp4 -c:v libx264 -preset medium -b:v 4000k -pass 2 -c:a aac -b:a 192k output.mp4

# Cleanup
rm ffmpeg2pass-0.log ffmpeg2pass-0.log.mbtree
```

**Note:** Research shows two-pass encoding for x265 takes ~2x longer with "no meaningful overall quality difference" compared to single-pass. For x264 and social media, stick with CRF.

---

## Implementation Priority

### Phase 1: Critical (Immediate Impact)
1. **Audio loudness normalization** - Consistent volume across all videos
   - Add `ffmpeg-normalize` to requirements.txt OR implement two-pass loudnorm
   - Target: -14 LUFS for social media
2. **Platform-specific presets** - TikTok, Reels, YouTube Shorts
   - Add preset parameter to rendering functions
   - Map platform → CRF/bitrate/resolution
3. **Enhanced subtitle styling** - Shadow and adaptive sizing
   - Update `add_subtitles()` method with shadow parameter
   - Already has PlayResX/PlayResY support

### Phase 2: Quality Improvements (High Value)
4. **Video filters (denoise, sharpen, color)** - Visual enhancement
   - Add filter chain builder function
   - Expose as optional parameters in rendering
5. **Blur/contrast detection** - Better segment selection
   - Update `VideoSegment` dataclass with quality metrics
   - Integrate into `analyze_frame_quality()` sampling
   - Filter low-quality segments before selection

### Phase 3: Advanced (Nice to Have)
6. **VMAF quality validation** - Compare before/after
   - Optional post-processing validation
   - Log quality metrics for monitoring

---

## Configuration Recommendations

### Add to `app/config.py`:

```python
from enum import Enum

class Platform(str, Enum):
    TIKTOK = "tiktok"
    REELS = "reels"
    YOUTUBE_SHORTS = "youtube_shorts"
    GENERIC = "generic"

class VideoQualitySettings:
    """Platform-specific encoding settings"""

    PRESETS = {
        Platform.TIKTOK: {
            "resolution": (1080, 1920),
            "fps": 30,
            "crf": 23,
            "preset": "fast",
            "video_bitrate": "4000k",
            "audio_bitrate": "128k",
            "loudness_target": -14,  # LUFS
        },
        Platform.REELS: {
            "resolution": (1080, 1920),
            "fps": 30,
            "crf": 23,
            "preset": "fast",
            "video_bitrate": "4000k",
            "audio_bitrate": "128k",
            "loudness_target": -14,  # LUFS
        },
        Platform.YOUTUBE_SHORTS: {
            "resolution": (1080, 1920),
            "fps": 30,
            "crf": 21,  # Slightly higher quality
            "preset": "medium",
            "video_bitrate": "8000k",
            "audio_bitrate": "192k",
            "loudness_target": -14,  # LUFS (social standard, not -23)
        },
        Platform.GENERIC: {
            "resolution": (1080, 1920),
            "fps": 30,
            "crf": 23,
            "preset": "fast",
            "video_bitrate": "5000k",
            "audio_bitrate": "192k",
            "loudness_target": -14,  # LUFS
        }
    }

class VideoFilters:
    """Video filter presets"""

    DENOISE_PRESETS = {
        "light": "hqdn3d=1.5:1.5:6:6",
        "medium": "hqdn3d=3:3:6:6",
        "heavy": "hqdn3d=5:5:10:10",
    }

    SHARPEN_PRESETS = {
        "light": "unsharp=5:5:0.5",
        "medium": "unsharp=5:5:1.0",
        "heavy": "unsharp=7:7:1.5",
    }

    COLOR_PRESETS = {
        "brighten": "eq=brightness=0.1:contrast=1.1",
        "vibrant": "eq=contrast=1.15:saturation=1.2",
        "balanced": "eq=brightness=0.05:contrast=1.15:saturation=1.1",
    }
```

---

## Testing & Validation

### Quality Thresholds

```python
# Blur detection threshold
BLUR_THRESHOLD_MIN = 100.0  # Below this = reject segment (too blurry)
BLUR_THRESHOLD_GOOD = 500.0  # Above this = excellent sharpness

# Contrast detection threshold
CONTRAST_THRESHOLD_MIN = 0.15  # Below this = reject segment (too flat)
CONTRAST_THRESHOLD_GOOD = 0.30  # Above this = excellent contrast

# Brightness range
BRIGHTNESS_MIN = 0.08  # Below this = too dark (already implemented)
BRIGHTNESS_MAX = 0.95  # Above this = overexposed
```

### Validation Workflow

1. **Before enhancement:** Analyze sample segment with OpenCV
2. **Apply filters:** Denoise → Sharpen → Color correct
3. **After enhancement:** Re-analyze with SSIM/PSNR (optional)
4. **Log metrics:** Track quality improvements per filter preset
5. **User testing:** A/B test with real uploads to platforms

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Video Codec | H.264 (libx264) | H.265 (HEVC) | HEVC ~50% better compression but limited mobile support, licensing concerns |
| Video Codec | H.264 (libx264) | AV1 | AV1 best compression but extremely slow encoding without hardware acceleration |
| Audio Codec | AAC | Opus | Opus not universally supported in MP4 containers by social platforms |
| Loudness Std | -14 LUFS | -23 LUFS (EBU R128) | -23 LUFS is for broadcast TV; social media uses -14 LUFS for mobile listening |
| Encoding Mode | Single-pass CRF | Two-pass bitrate | Two-pass takes 2x longer with minimal quality benefit for social media |
| Quality Metrics | OpenCV Laplacian | BRISQUE | BRISQUE requires model files (330MB+), Laplacian is lightweight and sufficient |
| Python Library | scikit-image | PIL/Pillow | scikit-image has more advanced exposure/contrast tools optimized for analysis |

---

## Installation

### Current Dependencies (no changes needed)
```txt
opencv-python-headless>=4.8.0  # Already installed
numpy>=1.24.0                  # Already installed
scipy>=1.11.0                  # Already installed
```

### New Dependencies (Phase 1 - Critical)
```txt
# Audio loudness normalization (optional, CLI wrapper)
ffmpeg-normalize>=1.28.0

# Alternative: Implement loudnorm directly with subprocess (no new dependency)
```

### New Dependencies (Phase 2 - Quality Analysis)
```txt
# Advanced image quality analysis
scikit-image>=0.22.0

# Optional: Video quality metrics (SSIM, PSNR, VMAF)
ffmpeg-quality-metrics>=3.11.0
```

---

## Sources & References

**FFmpeg Encoding Best Practices:**
- [FFmpeg Compress Video Guide | Cloudinary](https://cloudinary.com/guides/video-effects/ffmpeg-compress-video)
- [FFmpeg for Instagram - DEV Community](https://dev.to/alfg/ffmpeg-for-instagram-35bi)
- [How To Optimize FFmpeg For Fast Video Encoding - Muvi](https://www.muvi.com/blogs/optimize-ffmpeg-for-fast-video-encoding/)
- [FFmpeg - Ultimate Guide | IMG.LY Blog](https://img.ly/blog/ultimate-guide-to-ffmpeg/)

**Platform-Specific Settings:**
- [Master Your Shorts: Export Settings for Reels, TikTok & YouTube 2026 | aaapresets](https://aaapresets.com/blogs/premiere-pro-blog-series-editing-tips-transitions-luts-guide/master-your-shorts-the-ultimate-guide-to-export-settings-for-instagram-reels-tiktok-youtube-shorts-in-2025-extended-edition)
- [CRF Guide (Constant Rate Factor) | slhck](https://slhck.info/video/2017/02/24/crf-guide.html)
- [Transcoding with FFmpeg: CRF vs Bitrate | FFmpeg Media](https://www.ffmpeg.media/articles/transcoding-crf-vs-bitrate-codecs-presets)

**Audio Loudness Normalization:**
- [LUFS: The Key to Consistent Audio in Streaming Era | MediaStream](https://www.mediastream.co/blog-es/lufs-the-key-to-consistent-audio-in-the-streaming-era)
- [Audio Loudness Normalization With FFmpeg | Peter Forgacs](https://medium.com/@peter_forgacs/audio-loudness-normalization-with-ffmpeg-1ce7f8567053)
- [ffmpeg-normalize · PyPI](https://pypi.org/project/ffmpeg-normalize/)
- [GitHub - slhck/ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize)

**Video Filters:**
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [FFmpeg: Enhance Video Quality | Freddy Ho](https://www.freddyho.com/2024/12/ffmpeg-enhance-video-quality.html)
- [FFmpeg Filters and Effects | videoscompress.com](https://www.videoscompress.com/blog/FFmpeg-Filters-and-Effects-Enhance-Your-Videos-with-Advanced-Techniques)

**Subtitle Styling:**
- [How to Add Subtitles to a Video with FFmpeg | Bannerbear](https://www.bannerbear.com/blog/how-to-add-subtitles-to-a-video-with-ffmpeg-5-different-styles/)
- [How to change the appearances of subtitles with FFmpeg | Abyssale](https://www.abyssale.com/blog/how-to-change-the-appearances-of-subtitles-with-ffmpeg)

**Video Quality Analysis:**
- [Blur detection with OpenCV | PyImageSearch](https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/)
- [Detecting low contrast images with OpenCV | PyImageSearch](https://pyimagesearch.com/2021/01/25/detecting-low-contrast-images-with-opencv-scikit-image-and-python/)
- [GitHub - slhck/ffmpeg-quality-metrics](https://github.com/slhck/ffmpeg-quality-metrics)
- [Image Quality Assessment: BRISQUE | LearnOpenCV](https://learnopencv.com/image-quality-assessment-brisque/)

**Two-Pass Encoding:**
- [FFMPEG Tutorial: 2-Pass & CRF in x264 & x265 | GitHub Gist](https://gist.github.com/hsab/7c9219c4d57e13a42e06bf1cab90cd44)
- [Two-Pass encoding with FFmpeg | Martin Riedl](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/)
- [Three Things to Know About 2-Pass x265 Encoding | Streaming Learning Center](https://streaminglearningcenter.com/encoding/three-things-to-know-about-2-pass-x265-encoding.html)

---

## Confidence Assessment

| Area | Level | Rationale |
|------|-------|-----------|
| FFmpeg flags & syntax | HIGH | Official FFmpeg documentation + multiple verified sources |
| Platform-specific settings (2026) | HIGH | Recent industry guides (2025-2026) with verified CRF/bitrate values |
| Audio loudness standards | HIGH | EBU R128 standard confirmed, -14 LUFS for social media verified |
| Filter syntax (hqdn3d, unsharp, eq) | HIGH | Official FFmpeg filter documentation |
| Python libraries (OpenCV, scikit-image) | HIGH | Established libraries with PyPI verification |
| Quality metrics (BRISQUE, VMAF) | MEDIUM | OpenCV contrib feature, requires model files |
| Two-pass encoding value | HIGH | Multiple sources confirm single-pass CRF sufficient for social media |

---

## Next Steps for Implementation

1. **Update requirements.txt** with new dependencies (Phase 2):
   ```txt
   scikit-image>=0.22.0
   ffmpeg-normalize>=1.28.0  # Optional
   ```

2. **Extend `VideoEditor` class** with:
   - Platform preset support
   - Filter chain builder method
   - Loudness normalization integration (add_audio method)

3. **Enhance `VideoSegment` scoring** with:
   - Add blur_score and contrast_score fields
   - Implement analyze_frame_quality() helper
   - Update combined_score formula

4. **Add configuration** in `config.py`:
   - Platform enum and presets dictionary
   - VideoFilters class with preset strings
   - Quality threshold constants

5. **Create utility functions**:
   - `build_filter_chain(denoise, sharpen, color)` → returns FFmpeg filter string
   - `normalize_audio_loudness(audio_path, target_lufs)` → returns normalized audio path
   - `analyze_segment_quality(video_path, start, end)` → returns quality metrics dict
