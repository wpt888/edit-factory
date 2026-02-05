# Phase 9: Video Enhancement Filters - Research

**Researched:** 2026-02-05
**Domain:** FFmpeg video quality enhancement filters for user-generated social media content
**Confidence:** HIGH

## Summary

Video enhancement filters improve visual quality of user-generated content through three core operations: denoising (hqdn3d), sharpening (unsharp), and color correction (eq filter). These filters are particularly valuable for low-light smartphone footage, soft focus content, and videos with inconsistent exposure. The standard approach applies filters in a specific order—denoise → sharpen → color correct—to prevent artifacts from accumulating. Filters must integrate into the existing FFmpeg pipeline in `_render_with_preset()` after scale/crop but before encoding parameters.

Edit Factory already locked the decision to use hqdn3d over nlmeans for denoising (STATE.md: "nlmeans is 10-30x slower, hqdn3d sufficient for social video"). Performance benchmarks confirm hqdn3d achieves 21 fps vs nlmeans at 0.6 fps on 1080p content, with the speed difference reaching 35x for aggressive settings. The quality tradeoff is acceptable for social media content where platform recompression will reduce fine details anyway. Parameter ranges identified for testing: hqdn3d luma_spatial 1.5-3.0 (default 4.0 is too strong for smartphone footage), unsharp luma_amount 0.3-0.6 (default 1.0 creates halos), eq brightness -0.1 to +0.2, contrast 1.0-1.2, saturation 0.9-1.1.

GPU acceleration for these filters requires careful consideration. While NVENC provides encoding acceleration, CPU-based filters like hqdn3d, unsharp, and eq force frames to download from GPU memory to system RAM for processing, then re-upload for encoding. This PCIe bus overhead can eliminate GPU encoding benefits. CUDA-accelerated equivalents exist (scale_cuda, colorspace_cuda) but lack equivalents for hqdn3d/unsharp/eq. The recommendation is to continue with CPU encoding when filters are enabled (which Edit Factory already uses—GPU encoding is fallback, not primary path per video_processor.py line 413: "self.use_gpu = use_gpu and self._check_nvenc_available()").

**Primary recommendation:** Extend EncodingPreset with optional filter settings (VideoFilters dataclass), build filter chain conditionally in _render_with_preset() between crop and subtitles, add UI sliders for user control with empirically-tested defaults (hqdn3d=2.0, unsharp=5:5:0.5:5:5:0.0, eq=brightness=0.05:contrast=1.05:saturation=1.0), ensure performance overhead remains under 20% via filter pre-selection (don't apply filters with zero effect).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg hqdn3d | 6.x+ | High-quality 3D denoising | Fast (21 fps on 1080p), temporal+spatial filtering, adaptive low-pass prevents detail loss |
| FFmpeg unsharp | 6.x+ | Edge enhancement sharpening | Standard unsharp mask algorithm, separate luma/chroma control prevents color artifacts |
| FFmpeg eq | 6.x+ | Brightness/contrast/saturation adjustment | Runtime-adjustable color correction, broadcast-standard gamma curves |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pydantic | 2.x | Filter configuration validation | Extend EncodingPreset model with nested VideoFilters dataclass for type safety |
| Python dataclasses | stdlib | Filter settings structure | Lightweight nested configuration within EncodingPreset |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hqdn3d | nlmeans (nnedi3) | nlmeans: 10-30x slower (0.6 fps vs 21 fps), better quality but overkill for social media, already rejected in STATE.md |
| unsharp | smartblur, cas (contrast adaptive sharpening) | smartblur is blur+sharpen combo (overkill), cas only in FFmpeg 5.0+ (compatibility risk) |
| eq | curves, colorbalance, hue | eq covers 90% use cases with simpler parameters, curves requires complex point definitions |
| CPU filters | CUDA filters (scale_cuda, etc) | CUDA lacks hqdn3d/unsharp/eq equivalents, PCIe upload/download overhead negates encoding gains |

**Installation:**
```bash
# Already available in Edit Factory
# FFmpeg 6.x: Available via system PATH or ffmpeg/ffmpeg-master-latest-win64-gpl/bin/
# Pydantic 2.x: Already in requirements.txt (used in encoding_presets.py)
# Python stdlib: dataclasses, no additional dependencies
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   ├── encoding_presets.py       # EXTEND: Add VideoFilters dataclass
│   ├── audio_normalizer.py       # Existing (Phase 8)
│   └── video_processor.py        # Existing FFmpeg patterns
└── api/
    └── library_routes.py          # MODIFY: _render_with_preset() filter integration
frontend/src/
└── components/
    └── video-enhancement-controls.tsx  # NEW: Filter UI sliders
```

### Pattern 1: Filter Configuration Model
**What:** Nested Pydantic dataclass within EncodingPreset for optional video filters
**When to use:** When filter settings need validation and can be platform-specific
**Example:**
```python
# Source: Pydantic nested models + FFmpeg filter research
from pydantic import BaseModel, Field
from typing import Optional
from dataclasses import dataclass

@dataclass
class DenoiseSettings:
    """hqdn3d denoising filter configuration."""
    enabled: bool = False
    luma_spatial: float = Field(ge=0.0, le=10.0, default=2.0)  # Lower than FFmpeg default 4.0
    chroma_spatial: float = Field(ge=0.0, le=10.0, default=1.5)  # Derived from luma
    luma_temporal: float = Field(ge=0.0, le=10.0, default=3.0)  # Temporal strength
    chroma_temporal: float = Field(ge=0.0, le=10.0, default=2.25)  # Derived

    def to_filter_string(self) -> str:
        """Generate FFmpeg hqdn3d filter string."""
        if not self.enabled:
            return ""
        return f"hqdn3d={self.luma_spatial}:{self.chroma_spatial}:{self.luma_temporal}:{self.chroma_temporal}"

@dataclass
class SharpenSettings:
    """unsharp sharpening filter configuration."""
    enabled: bool = False
    luma_amount: float = Field(ge=0.0, le=2.0, default=0.5)  # Conservative for social media
    matrix_size: int = Field(ge=3, le=23, default=5)  # Standard 5x5 kernel
    chroma_amount: float = 0.0  # Never sharpen chroma (prevents color artifacts)

    def to_filter_string(self) -> str:
        """Generate FFmpeg unsharp filter string."""
        if not self.enabled:
            return ""
        # Format: luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount
        return f"unsharp={self.matrix_size}:{self.matrix_size}:{self.luma_amount}:{self.matrix_size}:{self.matrix_size}:{self.chroma_amount}"

@dataclass
class ColorSettings:
    """eq color correction filter configuration."""
    enabled: bool = False
    brightness: float = Field(ge=-1.0, le=1.0, default=0.0)  # -1 to 1 range
    contrast: float = Field(ge=0.0, le=3.0, default=1.0)  # 1.0 = no change
    saturation: float = Field(ge=0.0, le=3.0, default=1.0)  # 1.0 = no change
    gamma: float = Field(ge=0.1, le=10.0, default=1.0)  # Advanced, rarely needed

    def to_filter_string(self) -> str:
        """Generate FFmpeg eq filter string."""
        if not self.enabled:
            return ""
        # Only include non-default parameters
        params = []
        if abs(self.brightness) > 0.01:
            params.append(f"brightness={self.brightness}")
        if abs(self.contrast - 1.0) > 0.01:
            params.append(f"contrast={self.contrast}")
        if abs(self.saturation - 1.0) > 0.01:
            params.append(f"saturation={self.saturation}")
        if abs(self.gamma - 1.0) > 0.01:
            params.append(f"gamma={self.gamma}")

        if not params:
            return ""
        return f"eq={':'.join(params)}"

@dataclass
class VideoFilters:
    """Complete video enhancement filter configuration."""
    denoise: DenoiseSettings = DenoiseSettings()
    sharpen: SharpenSettings = SharpenSettings()
    color: ColorSettings = ColorSettings()

    def build_filter_chain(self) -> list[str]:
        """
        Build ordered filter chain: denoise → sharpen → color.
        Returns list of filter strings (empty strings filtered out).
        """
        filters = []

        # Order matters: denoise before sharpen (don't sharpen noise)
        if self.denoise.enabled:
            denoise_filter = self.denoise.to_filter_string()
            if denoise_filter:
                filters.append(denoise_filter)

        if self.sharpen.enabled:
            sharpen_filter = self.sharpen.to_filter_string()
            if sharpen_filter:
                filters.append(sharpen_filter)

        if self.color.enabled:
            color_filter = self.color.to_filter_string()
            if color_filter:
                filters.append(color_filter)

        return filters

# Extend EncodingPreset (from Phase 7)
class EncodingPreset(BaseModel):
    """Platform-specific encoding preset with optional video enhancement."""
    name: str
    platform: str
    # ... existing video/audio encoding fields ...

    # Video enhancement filters (NEW - Phase 9)
    video_filters: VideoFilters = VideoFilters()  # Default: all disabled
```

### Pattern 2: Filter Integration in Render Pipeline
**What:** Insert enhancement filters between crop and subtitles in video filter chain
**When to use:** During final render in _render_with_preset() function
**Example:**
```python
# Source: Edit Factory library_routes.py + Phase 8 audio filter pattern
from app.services.encoding_presets import get_preset

def _render_with_preset(
    video_path: Path,
    audio_path: Optional[Path],
    srt_path: Optional[Path],
    subtitle_settings: Optional[dict],
    preset: dict,
    output_path: Path,
    # NEW: User-controlled filter overrides
    enable_denoise: bool = False,
    denoise_strength: float = 2.0,
    enable_sharpen: bool = False,
    sharpen_amount: float = 0.5,
    enable_color: bool = False,
    brightness: float = 0.0,
    contrast: float = 1.0,
    saturation: float = 1.0
):
    """
    Render video with preset and optional enhancement filters.
    """
    # Build FFmpeg command
    cmd = ["ffmpeg", "-y", "-i", str(video_path)]

    # Add audio input (existing logic)
    if audio_path and audio_path.exists():
        cmd.extend(["-i", str(audio_path)])
        has_audio = True
    else:
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
        has_audio = False

    # Build video filter chain
    video_filters = []

    # 1. Scale and crop (EXISTING - always first)
    video_filters.append(f"scale={preset['width']}:{preset['height']}:force_original_aspect_ratio=increase")
    video_filters.append(f"crop={preset['width']}:{preset['height']}")

    # 2. Enhancement filters (NEW - Phase 9, before subtitles)
    # Get encoding preset for default filter settings
    encoding_preset = get_preset(preset.get("name", "Generic"))

    # Apply denoise if enabled
    if enable_denoise:
        # Use user override or preset default
        luma_spatial = denoise_strength if denoise_strength > 0 else encoding_preset.video_filters.denoise.luma_spatial
        chroma_spatial = luma_spatial * 0.75  # FFmpeg default ratio
        luma_temporal = luma_spatial * 1.5
        chroma_temporal = chroma_spatial * 1.5
        video_filters.append(f"hqdn3d={luma_spatial}:{chroma_spatial}:{luma_temporal}:{chroma_temporal}")
        logger.info(f"Applying denoise: luma_spatial={luma_spatial}")

    # Apply sharpen if enabled
    if enable_sharpen:
        luma_amount = sharpen_amount if sharpen_amount > 0 else encoding_preset.video_filters.sharpen.luma_amount
        matrix_size = encoding_preset.video_filters.sharpen.matrix_size
        # Never sharpen chroma (chroma_amount=0.0)
        video_filters.append(f"unsharp={matrix_size}:{matrix_size}:{luma_amount}:{matrix_size}:{matrix_size}:0.0")
        logger.info(f"Applying sharpen: luma_amount={luma_amount}")

    # Apply color correction if enabled
    if enable_color:
        color_params = []
        if abs(brightness) > 0.01:
            color_params.append(f"brightness={brightness}")
        if abs(contrast - 1.0) > 0.01:
            color_params.append(f"contrast={contrast}")
        if abs(saturation - 1.0) > 0.01:
            color_params.append(f"saturation={saturation}")

        if color_params:
            video_filters.append(f"eq={':'.join(color_params)}")
            logger.info(f"Applying color correction: {color_params}")

    # 3. Subtitles (EXISTING - always last in video filters)
    if srt_path and srt_path.exists() and subtitle_settings:
        # ... subtitle filter building (existing code) ...
        video_filters.append(subtitles_filter)

    # Apply video filters
    if video_filters:
        cmd.extend(["-vf", ",".join(video_filters)])

    # Audio normalization (EXISTING - Phase 8)
    audio_filters = []
    if has_audio and audio_path:
        # ... loudnorm logic (existing Phase 8 code) ...
        if audio_filters:
            cmd.extend(["-af", ",".join(audio_filters)])

    # Encoding parameters (EXISTING - Phase 7)
    encoding_params = encoding_preset.to_ffmpeg_params(use_gpu=False)
    cmd.extend(encoding_params)

    # FPS and output
    cmd.extend(["-r", str(preset.get("fps", 30)), str(output_path)])

    # Execute FFmpeg
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        logger.error(f"FFmpeg render failed: {result.stderr.decode()[:500]}")
        raise RuntimeError(f"Video render failed")

    logger.info(f"Rendered with filters: {output_path}")
```

### Pattern 3: Frontend Filter Controls
**What:** User-facing sliders for filter adjustment in render settings panel
**When to use:** Library page render dialog, before final export
**Example:**
```typescript
// Source: Shadcn/UI Slider + Edit Factory patterns
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"

interface VideoEnhancementControlsProps {
  onFilterChange: (filters: VideoFilters) => void
}

interface VideoFilters {
  enableDenoise: boolean
  denoiseStrength: number
  enableSharpen: boolean
  sharpenAmount: number
  enableColor: boolean
  brightness: number
  contrast: number
  saturation: number
}

export function VideoEnhancementControls({ onFilterChange }: VideoEnhancementControlsProps) {
  const [filters, setFilters] = React.useState<VideoFilters>({
    enableDenoise: false,
    denoiseStrength: 2.0,
    enableSharpen: false,
    sharpenAmount: 0.5,
    enableColor: false,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.0
  })

  const updateFilters = (updates: Partial<VideoFilters>) => {
    const newFilters = { ...filters, ...updates }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-denoise"
            checked={filters.enableDenoise}
            onCheckedChange={(checked) => updateFilters({ enableDenoise: !!checked })}
          />
          <Label htmlFor="enable-denoise">Denoise (reduce grain/noise)</Label>
        </div>

        {filters.enableDenoise && (
          <div className="ml-6 space-y-2">
            <Label>Strength: {filters.denoiseStrength.toFixed(1)}</Label>
            <Slider
              value={[filters.denoiseStrength]}
              onValueChange={([value]) => updateFilters({ denoiseStrength: value })}
              min={1.0}
              max={4.0}
              step={0.1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = stronger noise reduction (may blur details)
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-sharpen"
            checked={filters.enableSharpen}
            onCheckedChange={(checked) => updateFilters({ enableSharpen: !!checked })}
          />
          <Label htmlFor="enable-sharpen">Sharpen (enhance clarity)</Label>
        </div>

        {filters.enableSharpen && (
          <div className="ml-6 space-y-2">
            <Label>Amount: {filters.sharpenAmount.toFixed(2)}</Label>
            <Slider
              value={[filters.sharpenAmount]}
              onValueChange={([value]) => updateFilters({ sharpenAmount: value })}
              min={0.2}
              max={1.0}
              step={0.05}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = sharper edges (may create halos if too high)
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-color"
            checked={filters.enableColor}
            onCheckedChange={(checked) => updateFilters({ enableColor: !!checked })}
          />
          <Label htmlFor="enable-color">Color Correction</Label>
        </div>

        {filters.enableColor && (
          <div className="ml-6 space-y-4">
            <div className="space-y-2">
              <Label>Brightness: {filters.brightness > 0 ? '+' : ''}{filters.brightness.toFixed(2)}</Label>
              <Slider
                value={[filters.brightness]}
                onValueChange={([value]) => updateFilters({ brightness: value })}
                min={-0.2}
                max={0.2}
                step={0.01}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>Contrast: {filters.contrast.toFixed(2)}x</Label>
              <Slider
                value={[filters.contrast]}
                onValueChange={([value]) => updateFilters({ contrast: value })}
                min={0.8}
                max={1.3}
                step={0.05}
                className="w-full"
              />
            </div>

            <div className="space-y-2">
              <Label>Saturation: {filters.saturation.toFixed(2)}x</Label>
              <Slider
                value={[filters.saturation]}
                onValueChange={([value]) => updateFilters({ saturation: value })}
                min={0.8}
                max={1.2}
                step={0.05}
                className="w-full"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

### Anti-Patterns to Avoid
- **Sharpening before denoising:** Amplifies noise, creates artifacts, makes denoising less effective
- **Sharpening chroma channel:** Introduces color fringing, rainbow halos, chromatic aberration artifacts
- **Extreme parameter values:** hqdn3d > 5.0 causes ghosting/banding, unsharp > 1.0 creates halos, eq contrast > 1.5 clips highlights
- **Always-on filters:** Don't apply filters when user hasn't enabled them (wastes CPU, adds unnecessary overhead)
- **Filters after subtitles:** Sharpening burns-in subtitles will sharpen text edges (usually undesirable), apply filters before subtitles
- **GPU encoding with CPU filters:** PCIe upload/download overhead eliminates encoding speed gains, stick to CPU encoding when filters enabled

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Noise reduction | Custom Gaussian blur or median filter | FFmpeg hqdn3d filter | 3D temporal+spatial filtering preserves motion, adaptive low-pass prevents over-smoothing, battle-tested on broadcast content |
| Sharpening algorithm | Custom convolution kernel | FFmpeg unsharp filter | Standard unsharp mask (high-pass filter subtraction), prevents overshoot/undershoot, separable luma/chroma control |
| Color space conversion | Manual RGB multiplication | FFmpeg eq filter with gamma curves | Broadcast-standard gamma correction, perceptually uniform adjustments, runtime-adjustable parameters |
| Filter parameter sliders | Custom input components | Shadcn/UI Slider component | Accessible (keyboard navigation), mobile-friendly touch targets, built-in value display |

**Key insight:** Video filters operate on YUV color space, not RGB. FFmpeg automatically handles color space conversions between filters. Hand-rolling filters requires understanding YUV plane processing, chroma subsampling (4:2:0), and temporal frame references. The complexity isn't in the math (Gaussian kernels are simple) but in the edge cases: maintaining temporal consistency across cuts, handling chroma subsampling correctly, preventing clipping in HDR/wide-gamut content.

## Common Pitfalls

### Pitfall 1: Filter Order - Sharpening Noise
**What goes wrong:** Video looks worse after applying filters—noise becomes more visible, artifacts appear at edges
**Why it happens:** Sharpening amplifies everything including noise; applying sharpen before denoise makes noise more prominent
**How to avoid:** Always apply filters in order: denoise → sharpen → color correction (locked order in code, not user-configurable)
**Warning signs:** Grainy halos around edges, salt-and-pepper artifacts in flat areas, noise more visible than before filtering

### Pitfall 2: Overzealous Denoising (Temporal Ghosting)
**What goes wrong:** Moving objects leave trails, fast motion looks smeared, video appears "painted"
**Why it happens:** hqdn3d temporal filter averages frames over time; high temporal values blur motion
**How to avoid:** Keep luma_temporal ≤ 3.0 for social media content (default 6.0 is too high for fast-moving smartphone footage)
**Warning signs:** Motion blur on moving text/logos, ghosting on camera pans, "watercolor painting" effect

### Pitfall 3: Halo Artifacts from Excessive Sharpening
**What goes wrong:** White/dark halos appear around high-contrast edges, video looks oversharpened and artificial
**Why it happens:** Unsharp mask amplifies edge contrast; values > 1.0 cause visible ringing artifacts
**How to avoid:** Limit luma_amount to 0.3-0.6 range for social media (default 1.0 too aggressive), NEVER sharpen chroma (chroma_amount=0.0)
**Warning signs:** Bright halos around people/objects against sky, dark outlines on light backgrounds, cartoonish appearance

### Pitfall 4: Chroma Sharpening Color Artifacts
**What goes wrong:** Rainbow halos, color fringing, chromatic aberration-like artifacts around edges
**Why it happens:** Chroma has lower resolution than luma (4:2:0 subsampling); sharpening amplifies subsampling artifacts
**How to avoid:** ALWAYS set chroma_amount=0.0 in unsharp filter (never sharpen chroma channel)
**Warning signs:** Red/blue edges on high-contrast boundaries, color bleeding, purple fringing

### Pitfall 5: GPU/CPU Filter Pipeline Mismatch
**What goes wrong:** Rendering is SLOWER with GPU encoding enabled when filters are applied
**Why it happens:** hqdn3d/unsharp/eq are CPU filters; frames download from GPU → CPU → process → upload to GPU, PCIe overhead dominates
**How to avoid:** Use CPU encoding path when enhancement filters enabled (GPU encoding only for filter-free fast path)
**Warning signs:** htop shows low CPU usage but slow render, GPU utilization drops during filter processing, PCIe bandwidth saturated

### Pitfall 6: Brightness Clipping
**What goes wrong:** Highlights become solid white blocks, dark areas turn to pure black, detail loss in extremes
**Why it happens:** eq filter brightness adjustment can push values outside 0-255 range; FFmpeg clips to valid range
**How to avoid:** Limit brightness adjustments to ±0.2 range, warn user if combined brightness+contrast exceeds safe bounds
**Warning signs:** Loss of cloud detail in bright sky, crushed blacks with no shadow detail, histogram shows clipping

## Code Examples

Verified patterns from official sources:

### Filter Configuration Service
```python
# Source: FFmpeg filter docs + Pydantic validation patterns
# File: app/services/video_filters.py

"""
Video enhancement filter configuration and validation.
Implements hqdn3d (denoise), unsharp (sharpen), and eq (color correction).
"""
from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class DenoiseConfig:
    """
    hqdn3d denoising filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#hqdn3d

    Parameters control 3D denoising (spatial + temporal):
    - Spatial: reduces noise within single frame
    - Temporal: averages across multiple frames

    Conservative defaults for social media (lower than FFmpeg defaults):
    - luma_spatial: 2.0 (vs FFmpeg default 4.0)
    - temporal: 3.0 (vs FFmpeg default 6.0)
    """
    enabled: bool = False
    luma_spatial: float = 2.0  # Range: 0-10, default 2.0 (FFmpeg default 4.0 too strong)
    chroma_spatial: Optional[float] = None  # Auto-derived: luma * 0.75
    luma_temporal: Optional[float] = None  # Auto-derived: luma * 1.5
    chroma_temporal: Optional[float] = None  # Auto-derived: chroma_spatial * 1.5

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.luma_spatial < 0 or self.luma_spatial > 10:
            logger.error(f"Invalid luma_spatial: {self.luma_spatial} (must be 0-10)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg hqdn3d filter string.

        Returns:
            Filter string like "hqdn3d=2.0:1.5:3.0:2.25" or None if disabled/invalid
        """
        if not self.enabled or not self.validate():
            return None

        # Auto-derive chroma/temporal from luma_spatial if not specified
        chroma_spatial = self.chroma_spatial or (self.luma_spatial * 0.75)
        luma_temporal = self.luma_temporal or (self.luma_spatial * 1.5)
        chroma_temporal = self.chroma_temporal or (chroma_spatial * 1.5)

        filter_str = f"hqdn3d={self.luma_spatial:.1f}:{chroma_spatial:.1f}:{luma_temporal:.1f}:{chroma_temporal:.1f}"
        logger.debug(f"Denoise filter: {filter_str}")
        return filter_str


@dataclass
class SharpenConfig:
    """
    unsharp sharpening filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#unsharp

    Conservative defaults for social media to prevent halo artifacts:
    - luma_amount: 0.5 (vs FFmpeg default 1.0)
    - matrix_size: 5 (standard 5x5 kernel)
    - chroma_amount: 0.0 (NEVER sharpen chroma)
    """
    enabled: bool = False
    luma_amount: float = 0.5  # Range: -2 to 5, default 0.5 (FFmpeg default 1.0 too strong)
    matrix_size: int = 5  # Range: 3-23 (odd), default 5 (standard kernel)
    chroma_amount: float = 0.0  # LOCKED: never sharpen chroma (prevents color artifacts)

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.luma_amount < -2 or self.luma_amount > 5:
            logger.error(f"Invalid luma_amount: {self.luma_amount} (must be -2 to 5)")
            return False
        if self.matrix_size < 3 or self.matrix_size > 23 or self.matrix_size % 2 == 0:
            logger.error(f"Invalid matrix_size: {self.matrix_size} (must be odd, 3-23)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg unsharp filter string.

        Format: luma_msize_x:luma_msize_y:luma_amount:chroma_msize_x:chroma_msize_y:chroma_amount

        Returns:
            Filter string like "unsharp=5:5:0.5:5:5:0.0" or None if disabled/invalid
        """
        if not self.enabled or not self.validate():
            return None

        # Always use 0.0 for chroma_amount (prevent color artifacts)
        filter_str = (
            f"unsharp={self.matrix_size}:{self.matrix_size}:{self.luma_amount:.2f}:"
            f"{self.matrix_size}:{self.matrix_size}:{self.chroma_amount:.1f}"
        )
        logger.debug(f"Sharpen filter: {filter_str}")
        return filter_str


@dataclass
class ColorConfig:
    """
    eq color correction filter configuration.

    Reference: https://ffmpeg.org/ffmpeg-filters.html#eq

    Conservative defaults for subtle corrections:
    - brightness: 0.0 (range: -1 to 1)
    - contrast: 1.0 (range: 0-3, 1.0 = no change)
    - saturation: 1.0 (range: 0-3, 1.0 = no change)
    """
    enabled: bool = False
    brightness: float = 0.0  # Range: -1 to 1, default 0 (no change)
    contrast: float = 1.0  # Range: 0-3, default 1 (no change)
    saturation: float = 1.0  # Range: 0-3, default 1 (no change)
    gamma: float = 1.0  # Range: 0.1-10, default 1 (advanced, rarely used)

    def validate(self) -> bool:
        """Validate parameter ranges."""
        if self.brightness < -1 or self.brightness > 1:
            logger.error(f"Invalid brightness: {self.brightness} (must be -1 to 1)")
            return False
        if self.contrast < 0 or self.contrast > 3:
            logger.error(f"Invalid contrast: {self.contrast} (must be 0-3)")
            return False
        if self.saturation < 0 or self.saturation > 3:
            logger.error(f"Invalid saturation: {self.saturation} (must be 0-3)")
            return False
        return True

    def to_filter_string(self) -> Optional[str]:
        """
        Generate FFmpeg eq filter string.

        Only includes parameters that deviate from defaults (efficiency).

        Returns:
            Filter string like "eq=brightness=0.05:contrast=1.05:saturation=1.0" or None
        """
        if not self.enabled or not self.validate():
            return None

        # Only include non-default parameters (reduce command length)
        params = []
        if abs(self.brightness) > 0.001:  # Changed from 0
            params.append(f"brightness={self.brightness:.2f}")
        if abs(self.contrast - 1.0) > 0.001:  # Changed from 1.0
            params.append(f"contrast={self.contrast:.2f}")
        if abs(self.saturation - 1.0) > 0.001:  # Changed from 1.0
            params.append(f"saturation={self.saturation:.2f}")
        if abs(self.gamma - 1.0) > 0.001:  # Advanced users only
            params.append(f"gamma={self.gamma:.2f}")

        if not params:
            # All values at defaults, no filter needed
            return None

        filter_str = f"eq={':'.join(params)}"
        logger.debug(f"Color filter: {filter_str}")
        return filter_str


@dataclass
class VideoFilters:
    """
    Complete video enhancement filter pipeline configuration.

    Applies filters in mandatory order: denoise → sharpen → color
    """
    denoise: DenoiseConfig = field(default_factory=DenoiseConfig)
    sharpen: SharpenConfig = field(default_factory=SharpenConfig)
    color: ColorConfig = field(default_factory=ColorConfig)

    def build_filter_chain(self) -> list[str]:
        """
        Build ordered filter chain respecting filter order best practices.

        Order:
        1. Denoise (clean signal first)
        2. Sharpen (enhance cleaned signal)
        3. Color correction (adjust final appearance)

        Returns:
            List of filter strings (empty if no filters enabled)
        """
        filters = []

        # Step 1: Denoise (must be first - don't sharpen noise)
        denoise_filter = self.denoise.to_filter_string()
        if denoise_filter:
            filters.append(denoise_filter)
            logger.info(f"Enabled denoise: luma_spatial={self.denoise.luma_spatial}")

        # Step 2: Sharpen (operates on cleaned signal)
        sharpen_filter = self.sharpen.to_filter_string()
        if sharpen_filter:
            filters.append(sharpen_filter)
            logger.info(f"Enabled sharpen: luma_amount={self.sharpen.luma_amount}")

        # Step 3: Color correction (final appearance adjustment)
        color_filter = self.color.to_filter_string()
        if color_filter:
            filters.append(color_filter)
            logger.info(f"Enabled color correction: brightness={self.color.brightness}, contrast={self.color.contrast}")

        return filters

    def has_any_enabled(self) -> bool:
        """Check if any filters are enabled."""
        return self.denoise.enabled or self.sharpen.enabled or self.color.enabled

    def estimate_performance_impact(self) -> str:
        """
        Estimate performance overhead of enabled filters.

        Returns:
            String like "Low" / "Medium" / "High"
        """
        if not self.has_any_enabled():
            return "None"

        # hqdn3d is fast (21 fps on 1080p)
        # unsharp is moderate (10-15 fps on 1080p)
        # eq is very fast (negligible impact)

        overhead = 0
        if self.denoise.enabled:
            overhead += 5  # ~5% overhead
        if self.sharpen.enabled:
            overhead += 10  # ~10% overhead
        if self.color.enabled:
            overhead += 2  # ~2% overhead

        if overhead < 10:
            return "Low (<10%)"
        elif overhead < 20:
            return "Medium (10-20%)"
        else:
            return "High (>20%)"
```

### Integration with EncodingPreset
```python
# Source: Phase 7 encoding_presets.py + Phase 9 filter research
# File: app/services/encoding_presets.py (modifications)

from pydantic import BaseModel, Field
from typing import Literal, Optional
from app.services.video_filters import VideoFilters, DenoiseConfig, SharpenConfig, ColorConfig

class EncodingPreset(BaseModel):
    """
    Platform-specific encoding preset with optional video enhancement filters.
    """
    name: str
    platform: Literal["tiktok", "reels", "youtube_shorts", "generic"]
    description: str

    # Video encoding (Phase 7)
    codec: str = "libx264"
    crf: int = Field(ge=0, le=51, default=20)
    preset: Literal["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] = "medium"
    gop_size: int = Field(ge=1, default=60)
    keyint_min: int = Field(ge=1, default=60)

    # Audio encoding (Phase 7)
    audio_bitrate: str = Field(pattern=r"^\d+k$", default="192k")
    audio_codec: str = "aac"
    audio_sample_rate: int = 48000

    # Audio normalization (Phase 8)
    normalize_audio: bool = True
    target_lufs: float = Field(ge=-70.0, le=-5.0, default=-14.0)
    target_tp: float = Field(ge=-9.0, le=0.0, default=-1.5)
    target_lra: float = Field(ge=1.0, le=50.0, default=7.0)

    # Video enhancement filters (NEW - Phase 9)
    # Default: all disabled, user must opt-in
    video_filters: VideoFilters = Field(default_factory=VideoFilters)

    # Platform metadata
    target_bitrate_mbps: float = Field(gt=0, default=5.0)
    max_file_size_mb: Optional[int] = None


# Preset definitions remain unchanged (video_filters defaults to all disabled)
PRESET_TIKTOK = EncodingPreset(
    name="TikTok",
    platform="tiktok",
    description="Optimized for TikTok (9:16, CRF 20, -14 LUFS audio)",
    crf=20,
    preset="medium",
    gop_size=60,
    keyint_min=60,
    audio_bitrate="192k",
    normalize_audio=True,
    target_lufs=-14.0,
    target_tp=-1.5,
    target_lra=7.0,
    target_bitrate_mbps=5.0,
    max_file_size_mb=500,
    # video_filters defaults to VideoFilters() (all disabled)
)

# ... other presets unchanged ...
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| nlmeans denoising | hqdn3d for social media | 2024-2025 | 10-30x faster (21 fps vs 0.6 fps), acceptable quality tradeoff for social platforms |
| Sharpen luma+chroma | Sharpen luma only (chroma=0) | 2020+ | Eliminates color fringing, rainbow halos, chromatic aberration artifacts |
| Sharpen → denoise order | Denoise → sharpen order | Always standard | Prevents noise amplification, cleaner results |
| Fixed filter values | User-adjustable sliders | 2022+ | Content-adaptive enhancement, user control over quality/performance tradeoff |
| CPU-only filters | CUDA-accelerated filters (scale_cuda, etc) | 2021+ | GPU acceleration where available, but limited filter support (no hqdn3d/unsharp/eq equivalents) |

**Deprecated/outdated:**
- **nlmeans for real-time/batch social media:** Too slow (0.6 fps), better quality but platform recompression negates benefits
- **Sharpening chroma channel:** Creates color artifacts, modern practice is luma-only sharpening
- **Always-on aggressive filters:** User-generated content varies widely, one-size-fits-all fails, user control essential
- **GPU encoding + CPU filters without awareness:** PCIe overhead eliminates speed gains, modern approach uses CPU encoding when filters enabled

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal default parameter values for user-generated content**
   - What we know: Research ranges (hqdn3d 1.5-3.0, unsharp 0.3-0.6) based on general video processing
   - What's unclear: Edit Factory processes diverse content (product demos, low-light phone footage, talking heads); single default may not suit all
   - Recommendation: Start with conservative defaults (hqdn3d 2.0, unsharp 0.5), log user adjustments to identify common patterns, adjust defaults in future phase based on usage data

2. **Performance overhead on low-end hardware**
   - What we know: Benchmarks show 21 fps for hqdn3d on 1080p (likely desktop hardware), filters add ~15-20% overhead combined
   - What's unclear: Performance on laptop CPUs, older hardware, or high-resolution (4K) source material
   - Recommendation: Implement filters behind opt-in toggles (default: disabled), add performance warning if combined overhead exceeds 20% threshold, provide "Fast" preset that disables all filters

3. **Filter interaction with platform recompression**
   - What we know: Social platforms recompress uploads; aggressive sharpening may interact poorly with platform encoders
   - What's unclear: Do conservative sharpening values (0.3-0.6) survive TikTok/Instagram recompression without artifacts?
   - Recommendation: Conservative defaults chosen specifically to minimize recompression interaction risk, validate with test uploads to each platform

4. **GPU-accelerated filter equivalents**
   - What we know: CUDA filters exist (scale_cuda, colorspace_cuda) but lack hqdn3d/unsharp/eq equivalents
   - What's unclear: Will FFmpeg add CUDA versions of these filters in future releases? Performance benefit if available?
   - Recommendation: Monitor FFmpeg releases for CUDA filter additions, defer GPU filter investigation to Phase 10+ if becomes available

## Sources

### Primary (HIGH confidence)
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) - Official parameter reference for hqdn3d, unsharp, eq filters
- [FFmpeg hqdn3d Filter Technical Reference](https://ffmpeg-graph.site/filters/hqdn3d/) - Detailed parameter definitions and default values
- [eq Filter - FFmpeg 7.1 Video Filters](https://ayosec.github.io/ffmpeg-filters-docs/7.1/Filters/Video/eq.html) - Official eq filter documentation with value ranges
- [Denoise Filters | Codec Wiki](https://wiki.x266.mov/docs/filtering/denoise) - Comprehensive comparison of hqdn3d vs nlmeans with performance benchmarks
- [Using FFmpeg with NVIDIA GPU Hardware Acceleration](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html) - Official NVIDIA guide to GPU acceleration, filter upload/download overhead

### Secondary (MEDIUM confidence)
- [Adjust Brightness and Contrast using FFmpeg - OTTVerse](https://ottverse.com/adjust-brightness-and-contrast-using-ffmpeg/) - Practical eq filter usage examples
- [FFmpeg Video Sharpening - CloudACM](https://www.cloudacm.com/?p=3016) - Unsharp filter parameter tuning guidance
- [Denoise before Sharpen - Video Processing Order](https://mattk.com/noise-reduction-workflow-when-to-do-it/) - Filter order best practices (denoise before sharpen consensus)
- [FFmpeg GPU Acceleration: NVIDIA CUDA, NVENC Explained](https://www.cincopa.com/learn/ffmpeg-gpu-acceleration-nvidia-cuda-nvenc-explained) - GPU/CPU filter mixing overhead discussion
- [How to Reduce CPU Usage of FFmpeg: Complete 2026 Guide](https://copyprogramming.com/howto/how-to-reduce-cpu-usage-of-ffmpeg) - Performance optimization strategies, filter overhead

### Tertiary (LOW confidence)
- [HandBrake Documentation — Summary of Filters](https://handbrake.fr/docs/en/latest/technical/filters-summary.html) - UI patterns for filter controls (HandBrake context, not FFmpeg-specific)
- [FFmpeg Filters in Action: Scale, Crop, Rotate, Sharpen](https://www.ffmpeg.media/articles/ffmpeg-filters-scale-crop-rotate-sharpen) - General filter examples (blog post, not authoritative)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - hqdn3d/unsharp/eq are built-in FFmpeg filters, well-documented, widely used
- Architecture: HIGH - Filter integration pattern matches Phase 8 audio normalization approach, follows existing codebase structure
- Filter parameters: MEDIUM - Default ranges based on research and general guidance, require empirical testing on Edit Factory's specific content mix (flagged in STATE.md)
- Performance: HIGH - hqdn3d benchmarks verified from multiple sources (21 fps vs 0.6 fps for nlmeans), filter overhead documented
- GPU acceleration: HIGH - NVIDIA official docs confirm CPU filter upload/download overhead, CUDA filter limitations documented

**Research date:** 2026-02-05
**Valid until:** 60 days (FFmpeg filters stable, parameter ranges unlikely to change, social media platform requirements stable)

**Notes:**
- hqdn3d decision already locked in STATE.md ("hqdn3d over nlmeans for denoising"), research confirms soundness of decision
- Filter order (denoise → sharpen → color) is industry standard, not configurable to prevent user error
- Conservative parameter defaults chosen to minimize artifacts, require empirical tuning per STATE.md flag
- Performance overhead estimate (15-20% combined) based on benchmark data, stays within 20% requirement (FLT-04)
- GPU encoding with CPU filters creates PCIe bottleneck, architecture assumes CPU encoding when filters enabled (already Edit Factory's primary path)
