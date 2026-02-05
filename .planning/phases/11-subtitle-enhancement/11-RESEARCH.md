# Phase 11: Subtitle Enhancement - Research

**Researched:** 2026-02-05
**Domain:** FFmpeg ASS subtitle styling and adaptive font sizing for social media video subtitles
**Confidence:** HIGH

## Summary

Subtitle enhancement for social media content requires three core capabilities: shadow effects for depth, glow/outline effects for contrast, and adaptive font sizing for text length. The standard approach uses FFmpeg's ASS (Advanced SubStation Alpha) subtitle format with `force_style` parameter to control Shadow, Outline, BorderStyle, and BackColour properties. These effects are particularly critical for short-form vertical video where subtitles compete with fast-moving backgrounds and variable lighting conditions.

Edit Factory already uses ASS subtitle styling via the `subtitles` filter with `force_style` parameter (library_routes.py line 2436-2444). The current implementation supports FontSize, Outline, and basic positioning but lacks shadow depth control, glow effects, and adaptive sizing. Research confirms ASS format supports Shadow (0-4 pixel offset), BorderStyle (1=outline, 3=box background), and BackColour (shadow color in &HBBGGRR format). Social media best practices recommend white text with 2-point stroke or soft shadow, font sizes 48-60px for mobile readability, and high contrast (4.5:1 ratio minimum per WCAG 2.1).

Adaptive font sizing prevents text overflow by reducing font size as character count increases. The standard formula uses linear interpolation: `fontSize = maxSize - ((maxSize - minSize) * (textLength - minLength) / (maxLength - minLength))`. For subtitle lines, character limits typically range from 32-42 characters per line with recommended size reduction starting at 40+ characters. This is implemented at render time by parsing SRT content, calculating character counts per line, and dynamically adjusting fontSize in force_style before FFmpeg encoding.

**Primary recommendation:** Extend SubtitleSettings with shadow_depth (0-4), enable_glow (boolean), glow_blur (0-10), and adaptive_sizing (boolean). Implement shadow via Shadow ASS parameter, glow via BackColour with alpha transparency, and adaptive sizing via SRT parsing in _render_with_preset(). Add frontend sliders for shadow/glow control following Phase 9's checkbox-shows-sliders pattern. Preserve CPU-only rendering pipeline (subtitles filter incompatible with GPU decode, already handled correctly in video_processor.py line 1014-1016).

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FFmpeg ASS subtitles filter | 6.x+ | Advanced subtitle styling with force_style | Industry standard for burned-in subtitles, supports Shadow/Outline/BorderStyle/BackColour parameters |
| Python srt library | 3.x | SRT subtitle parsing/manipulation | Lightweight (~200 lines), parses broken SRT files, supports timing/text manipulation for adaptive sizing |
| TypeScript/React useState | Built-in | Frontend subtitle settings state | Existing pattern in use-subtitle-settings.ts, localStorage persistence already implemented |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Pydantic | 2.x | SubtitleSettings validation | Extend existing SubtitleSettings type with shadow/glow parameters for type safety |
| Shadcn/UI Slider | Latest | Shadow depth / glow blur sliders | Consistent with Phase 9 filter controls, accessible, mobile-friendly |
| Python dataclasses | stdlib | ASS style configuration | Lightweight structure for building force_style string (similar to Phase 9 VideoFilters pattern) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ASS subtitles filter | drawtext filter | drawtext doesn't support SRT timing, requires manual text positioning per frame, ASS is subtitle-native |
| srt library | pysrt library | pysrt less maintained (last update 2016), srt actively maintained (2023+), both have similar API |
| Linear interpolation sizing | ML-based text analysis | Overkill for simple character count logic, adds complexity without value for subtitle use case |
| Runtime font sizing | Pre-sized SRT variants | SRT format doesn't support per-line font size, ASS format does but requires conversion complexity |

**Installation:**
```bash
# Backend (Python)
pip install srt  # For SRT parsing and adaptive font sizing

# Frontend (already available)
# Shadcn/UI Slider: Already in components/ui/slider.tsx
# TypeScript: Built-in Next.js toolchain
```

## Architecture Patterns

### Recommended Project Structure
```
app/
├── services/
│   ├── subtitle_styler.py        # NEW: ASS style builder with shadow/glow/adaptive sizing
│   └── video_processor.py        # EXISTING: add_subtitles() method (already has ASS force_style)
└── api/
    └── library_routes.py          # MODIFY: _render_with_preset() integrate subtitle_styler
frontend/src/
├── types/
│   └── video-processing.ts       # EXTEND: SubtitleSettings with shadow/glow/adaptive fields
├── hooks/
│   └── use-subtitle-settings.ts  # EXTEND: Add shadow/glow state management
└── components/
    └── subtitle-enhancement-controls.tsx  # NEW: Shadow/glow/adaptive UI sliders
```

### Pattern 1: ASS Style Builder with Shadow/Glow
**What:** Service class that builds FFmpeg force_style string with Shadow, BackColour, and BorderStyle parameters
**When to use:** During final render in _render_with_preset() when subtitle_settings provided
**Example:**
```python
# Source: FFmpeg ASS documentation + Phase 9 filter pattern
from dataclasses import dataclass
from typing import Optional

@dataclass
class SubtitleStyleConfig:
    """
    ASS subtitle style configuration for FFmpeg force_style parameter.

    Implements shadow depth, glow effects, and outline styling.
    Reference: https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/subtitle/ass.html
    """
    # Basic text properties (EXISTING - from current implementation)
    font_size: int = 48
    font_family: str = "Montserrat"
    primary_color: str = "&H00FFFFFF"  # ASS format: &H00BBGGRR
    outline_color: str = "&H00000000"
    outline_width: int = 3
    bold: int = 1
    alignment: int = 2  # Bottom-center
    margin_v: int = 50

    # Shadow effects (NEW - SUB-01)
    shadow_depth: int = 0  # 0-4 pixels, 0=disabled, 1-4=shadow offset
    shadow_color: str = "&H80000000"  # Semi-transparent black (alpha in AA position)

    # Glow effects (NEW - SUB-02)
    enable_glow: bool = False
    glow_blur: int = 0  # 0-10, simulated via BackColour with BorderStyle=1

    # BorderStyle controls outline vs background box
    border_style: int = 1  # 1=outline+shadow, 3=box background

    # Video resolution for PlayResX/PlayResY
    video_width: int = 1080
    video_height: int = 1920

    def to_force_style_string(self) -> str:
        """
        Generate FFmpeg force_style parameter string.

        ASS format fields:
        - PlayResX/PlayResY: Video resolution for correct positioning
        - FontName, FontSize, Bold: Text appearance
        - PrimaryColour, OutlineColour, BackColour: Colors in &H00BBGGRR format
        - Outline: Border thickness (0-4+)
        - Shadow: Drop shadow offset (0-4+)
        - BorderStyle: 1=outline+shadow, 3=box background
        - Alignment: 1-9 numpad layout (2=bottom-center, 8=top-center)
        - MarginV: Distance from edge in pixels

        Returns:
            Comma-separated force_style string
        """
        # Core style parameters (always present)
        style_parts = [
            f"PlayResX={self.video_width}",
            f"PlayResY={self.video_height}",
            f"FontName={self.font_family}",
            f"FontSize={self.font_size}",
            f"PrimaryColour={self.primary_color}",
            f"OutlineColour={self.outline_color}",
            f"Outline={self.outline_width}",
            f"Bold={self.bold}",
            f"Alignment={self.alignment}",
            f"MarginV={self.margin_v}",
        ]

        # Shadow configuration (SUB-01)
        if self.shadow_depth > 0:
            # Shadow parameter controls offset distance (0-4 pixels typical)
            # BackColour is used as shadow color when BorderStyle=1
            style_parts.append(f"Shadow={self.shadow_depth}")
            style_parts.append(f"BackColour={self.shadow_color}")
            style_parts.append(f"BorderStyle={self.border_style}")
        else:
            # No shadow, basic outline only
            style_parts.append("Shadow=0")
            style_parts.append(f"BorderStyle={self.border_style}")

        # Glow effect (SUB-02) - simulated via outline with semi-transparent color
        # NOTE: ASS doesn't have native "glow blur", but we can simulate with:
        # 1. Larger Outline value
        # 2. Semi-transparent OutlineColour (alpha channel)
        # 3. BackColour for shadow creates depth illusion
        if self.enable_glow and self.glow_blur > 0:
            # Increase outline width to simulate glow spread
            glow_outline = self.outline_width + self.glow_blur
            style_parts.append(f"Outline={glow_outline}")
            # Use semi-transparent outline color for glow effect
            # Format: &HAABBGGRR where AA is alpha (00=opaque, FF=transparent)
            # Default to semi-transparent white glow
            glow_color = f"&H80{self.outline_color[4:]}"  # Keep RGB, add 50% alpha
            style_parts.append(f"OutlineColour={glow_color}")

        return ",".join(style_parts)

    @staticmethod
    def from_dict(settings: dict, video_width: int, video_height: int) -> 'SubtitleStyleConfig':
        """
        Create SubtitleStyleConfig from frontend subtitle_settings dict.

        Args:
            settings: SubtitleSettings dict from frontend (fontSize, textColor, etc)
            video_width: Video resolution width for PlayResX
            video_height: Video resolution height for PlayResY

        Returns:
            SubtitleStyleConfig instance ready for to_force_style_string()
        """
        # Convert hex colors to ASS format (&H00BBGGRR)
        def hex_to_ass(hex_color: str) -> str:
            hex_color = hex_color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            return f"&H00{b:02X}{g:02X}{r:02X}"

        # Extract font family (remove CSS variable prefix if present)
        font_family = settings.get('fontFamily', 'Montserrat')
        if 'var(--' in font_family:
            parts = font_family.split(',')
            for part in parts:
                part = part.strip()
                if not part.startswith('var(') and part not in ['sans-serif', 'serif', 'monospace']:
                    font_family = part.strip("'\"")
                    break

        # Position Y to alignment and margin
        position_y = settings.get('positionY', 85)
        if position_y <= 20:
            alignment = 8  # top-center
            margin_v = int(position_y / 100 * video_height)
        else:
            alignment = 2  # bottom-center
            margin_v = int((100 - position_y) / 100 * video_height)
        margin_v = max(50, margin_v)

        return SubtitleStyleConfig(
            font_size=int(settings.get('fontSize', 48)),
            font_family=font_family,
            primary_color=hex_to_ass(settings.get('textColor', '#FFFFFF')),
            outline_color=hex_to_ass(settings.get('outlineColor', '#000000')),
            outline_width=int(settings.get('outlineWidth', 3)),
            alignment=alignment,
            margin_v=margin_v,
            # NEW: Shadow parameters (SUB-01)
            shadow_depth=int(settings.get('shadowDepth', 0)),  # 0-4
            shadow_color=hex_to_ass(settings.get('shadowColor', '#000000')),
            # NEW: Glow parameters (SUB-02)
            enable_glow=settings.get('enableGlow', False),
            glow_blur=int(settings.get('glowBlur', 0)),  # 0-10
            border_style=settings.get('borderStyle', 1),
            video_width=video_width,
            video_height=video_height,
        )
```

### Pattern 2: Adaptive Font Sizing via SRT Analysis
**What:** Parse SRT content, calculate character count per line, reduce font size for long text
**When to use:** In _render_with_preset() before building ASS force_style, if adaptive_sizing enabled
**Example:**
```python
# Source: Fluid font size formula + SRT parsing best practices
import srt
from typing import Tuple

def calculate_adaptive_font_size(
    srt_content: str,
    base_font_size: int = 48,
    min_font_size: int = 32,
    max_chars_threshold: int = 40,
    max_chars_limit: int = 60
) -> Tuple[int, int]:
    """
    Calculate adaptive font size based on longest subtitle line.

    Implements linear interpolation:
    fontSize = maxSize - ((maxSize - minSize) * (textLength - minLength) / (maxLength - minLength))

    Args:
        srt_content: SRT subtitle content to analyze
        base_font_size: Default font size for short text (default 48px)
        min_font_size: Minimum font size for very long text (default 32px)
        max_chars_threshold: Character count where size reduction starts (default 40)
        max_chars_limit: Character count at minimum font size (default 60)

    Returns:
        Tuple of (calculated_font_size, max_line_length) for debugging

    Example:
        Text with 50 chars (between 40-60):
        fontSize = 48 - ((48-32) * (50-40) / (60-40))
                 = 48 - (16 * 10 / 20)
                 = 48 - 8
                 = 40px
    """
    try:
        # Parse SRT content
        subtitles = list(srt.parse(srt_content))

        # Find longest line across all subtitles
        max_line_length = 0
        for subtitle in subtitles:
            # Split multi-line subtitles, check each line
            lines = subtitle.content.split('\n')
            for line in lines:
                # Strip HTML tags if present (some SRT files have <i>, <b>)
                clean_line = line.replace('<i>', '').replace('</i>', '')
                clean_line = clean_line.replace('<b>', '').replace('</b>', '')
                line_length = len(clean_line.strip())
                max_line_length = max(max_line_length, line_length)

        # Apply adaptive sizing if text exceeds threshold
        if max_line_length <= max_chars_threshold:
            # Short text, use base font size
            return base_font_size, max_line_length
        elif max_line_length >= max_chars_limit:
            # Very long text, use minimum font size
            return min_font_size, max_line_length
        else:
            # Interpolate between base and minimum
            # Formula: maxSize - ((maxSize - minSize) * (textLen - minLen) / (maxLen - minLen))
            font_size = base_font_size - (
                (base_font_size - min_font_size) *
                (max_line_length - max_chars_threshold) /
                (max_chars_limit - max_chars_threshold)
            )
            return int(font_size), max_line_length

    except Exception as e:
        # Parsing failed, return base font size
        logger.warning(f"SRT parsing failed for adaptive sizing: {e}")
        return base_font_size, 0

# Integration in _render_with_preset()
def _render_with_preset(
    video_path: Path,
    audio_path: Optional[Path],
    srt_path: Optional[Path],
    subtitle_settings: Optional[dict],
    preset: dict,
    output_path: Path,
    # ... other parameters ...
):
    """Render video with adaptive subtitle sizing."""

    # ... existing filter chain building ...

    # Add subtitles if available
    if srt_path and srt_path.exists() and subtitle_settings:
        # NEW: Apply adaptive font sizing (SUB-03)
        if subtitle_settings.get('adaptiveSizing', False):
            # Read SRT content
            srt_content = srt_path.read_text(encoding='utf-8')

            # Calculate adaptive font size
            base_size = subtitle_settings.get('fontSize', 48)
            adaptive_size, max_chars = calculate_adaptive_font_size(
                srt_content=srt_content,
                base_font_size=base_size,
                min_font_size=max(16, base_size - 16),  # Never go below 16px or base-16
                max_chars_threshold=40,
                max_chars_limit=60
            )

            # Override fontSize in settings
            subtitle_settings = {**subtitle_settings, 'fontSize': adaptive_size}
            logger.info(f"Adaptive sizing: {max_chars} chars → {adaptive_size}px (base: {base_size}px)")

        # Build ASS style config
        video_width = preset.get('width', 1080)
        video_height = preset.get('height', 1920)

        style_config = SubtitleStyleConfig.from_dict(
            settings=subtitle_settings,
            video_width=video_width,
            video_height=video_height
        )

        force_style = style_config.to_force_style_string()

        # Escape SRT path for FFmpeg
        srt_path_escaped = str(srt_path).replace('\\', '/').replace("'", "'\\''")
        srt_path_escaped = srt_path_escaped.replace(':', '\\:').replace('[', '\\[').replace(']', '\\]')

        # Add subtitles filter to filter chain
        video_filters.append(f"subtitles='{srt_path_escaped}':force_style='{force_style}'")

        logger.info(f"Subtitle style: {force_style[:100]}...")

    # ... rest of render logic ...
```

### Pattern 3: Frontend Subtitle Enhancement Controls
**What:** User-facing sliders for shadow depth, glow blur, and adaptive sizing toggle
**When to use:** Library page render dialog, integrated with existing subtitle settings
**Example:**
```typescript
// Source: Shadcn/UI Slider + Phase 9 filter controls pattern
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { SubtitleSettings } from "@/types/video-processing"

interface SubtitleEnhancementControlsProps {
  settings: SubtitleSettings
  onSettingsChange: (updates: Partial<SubtitleSettings>) => void
}

export function SubtitleEnhancementControls({
  settings,
  onSettingsChange
}: SubtitleEnhancementControlsProps) {
  return (
    <div className="space-y-6">
      {/* Shadow Depth Control (SUB-01) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-shadow"
            checked={(settings.shadowDepth ?? 0) > 0}
            onCheckedChange={(checked) =>
              onSettingsChange({ shadowDepth: checked ? 2 : 0 })
            }
          />
          <Label htmlFor="enable-shadow">Shadow Effect (depth and contrast)</Label>
        </div>

        {(settings.shadowDepth ?? 0) > 0 && (
          <div className="ml-6 space-y-2">
            <Label>Depth: {settings.shadowDepth ?? 0}px</Label>
            <Slider
              value={[settings.shadowDepth ?? 0]}
              onValueChange={([value]) => onSettingsChange({ shadowDepth: value })}
              min={0}
              max={4}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = deeper shadow (improves readability on bright backgrounds)
            </p>
          </div>
        )}
      </div>

      {/* Glow Effect Control (SUB-02) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="enable-glow"
            checked={settings.enableGlow ?? false}
            onCheckedChange={(checked) =>
              onSettingsChange({ enableGlow: !!checked, glowBlur: checked ? 3 : 0 })
            }
          />
          <Label htmlFor="enable-glow">Glow/Outline Effect (high-contrast)</Label>
        </div>

        {settings.enableGlow && (
          <div className="ml-6 space-y-2">
            <Label>Blur: {settings.glowBlur ?? 0}</Label>
            <Slider
              value={[settings.glowBlur ?? 0]}
              onValueChange={([value]) => onSettingsChange({ glowBlur: value })}
              min={0}
              max={10}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Higher values = wider glow (best for busy/dark backgrounds)
            </p>
          </div>
        )}
      </div>

      {/* Adaptive Font Sizing (SUB-03) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="adaptive-sizing"
            checked={settings.adaptiveSizing ?? false}
            onCheckedChange={(checked) =>
              onSettingsChange({ adaptiveSizing: !!checked })
            }
          />
          <Label htmlFor="adaptive-sizing">Adaptive Font Sizing</Label>
        </div>

        {settings.adaptiveSizing && (
          <div className="ml-6">
            <p className="text-xs text-muted-foreground">
              Automatically reduces font size for long text (40+ characters)
              to prevent overflow. Base size: {settings.fontSize}px
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
```

### Pattern 4: Type Extensions for SubtitleSettings
**What:** Extend existing SubtitleSettings interface with shadow/glow/adaptive fields
**When to use:** In types/video-processing.ts to maintain type safety across frontend/backend
**Example:**
```typescript
// Source: Existing SubtitleSettings + Phase 11 enhancements
// File: frontend/src/types/video-processing.ts

export interface SubtitleSettings {
  // EXISTING fields (from current implementation)
  fontSize: number;
  fontFamily: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  positionY: number;
  position?: "top" | "center" | "bottom";
  marginV?: number;

  // NEW: Shadow effects (SUB-01)
  shadowDepth?: number;        // 0-4, default 0 (disabled)
  shadowColor?: string;         // Hex color, default "#000000"
  borderStyle?: number;         // 1=outline+shadow, 3=box, default 1

  // NEW: Glow effects (SUB-02)
  enableGlow?: boolean;         // Default false
  glowBlur?: number;            // 0-10, default 0 (disabled)

  // NEW: Adaptive sizing (SUB-03)
  adaptiveSizing?: boolean;     // Default false
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  // EXISTING defaults
  fontSize: 48,
  fontFamily: "var(--font-montserrat), Montserrat, sans-serif",
  textColor: "#FFFFFF",
  outlineColor: "#000000",
  outlineWidth: 3,
  positionY: 85,
  position: "bottom",
  marginV: 30,

  // NEW: Phase 11 defaults
  shadowDepth: 0,               // Disabled by default
  shadowColor: "#000000",
  borderStyle: 1,
  enableGlow: false,
  glowBlur: 0,
  adaptiveSizing: false,        // Opt-in feature
};
```

### Anti-Patterns to Avoid
- **Excessive shadow depth (>4px):** Creates blurry, hard-to-read text; ASS Shadow parameter beyond 4 often clips outside frame
- **Glow without outline:** Glow effect requires base outline; enabling glow should increase Outline value, not replace it
- **Per-word adaptive sizing:** SRT format doesn't support inline font size changes; adaptive sizing applies to entire subtitle track
- **Converting SRT to ASS permanently:** Keep source SRT format, apply ASS styling at render time via force_style (preserves editability)
- **Sharpening subtitles filter:** Video enhancement filters (Phase 9) should run BEFORE subtitles filter to avoid sharpening burned-in text
- **Alpha transparency in PrimaryColour:** Use OutlineColour/BackColour for transparency; PrimaryColour should be opaque for readability
- **Ignoring WCAG contrast:** Always maintain 4.5:1 contrast ratio minimum; shadow/outline should enhance contrast, not reduce it

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SRT parsing and timing | Custom regex parsers | Python `srt` library | Handles broken SRT files, timecode formats (HH:MM:SS,mmm), multi-line text, HTML tags |
| Font size calculation | Fixed breakpoints | Linear interpolation formula | Smooth scaling, no jarring jumps, formula proven in responsive typography |
| ASS color format | Manual hex manipulation | Hex-to-ASS conversion function | ASS uses &H00BBGGRR (reversed RGB), easy to get wrong, alpha channel in different position |
| Subtitle timing validation | Manual timestamp parsing | `srt` library validation | Detects overlaps, negative durations, out-of-order subtitles, invalid timecodes |
| Shadow/glow simulation | Custom image processing | ASS Shadow/Outline/BackColour | FFmpeg's libass renderer handles anti-aliasing, subpixel positioning, performance optimization |

**Key insight:** ASS subtitle rendering is handled by libass (library for SSA/ASS rendering) which FFmpeg uses internally. This library has 15+ years of optimization for text rendering, anti-aliasing, and performance on video frames. Hand-rolling shadow/glow effects would require:
1. Rendering text to image with alpha channel
2. Applying Gaussian blur for glow/shadow
3. Compositing multiple layers per frame
4. Synchronizing with video timecode
5. Handling edge cases (multi-line text, word wrapping, bidirectional text)

libass does all of this natively with GPU-optimized code paths. The complexity isn't in the visual effect (box shadow is trivial in CSS) but in applying it correctly across millions of video frames with perfect timing and minimal performance overhead.

## Common Pitfalls

### Pitfall 1: Shadow Color Clipping on Dark Backgrounds
**What goes wrong:** Dark shadow on dark video backgrounds becomes invisible, text loses depth
**Why it happens:** Default shadow color is black (&H00000000); doesn't work on black/dark backgrounds
**How to avoid:** Use semi-transparent shadow (alpha channel in &HAABBGGRR format) or detect background brightness to choose shadow color (light shadow for dark backgrounds, dark shadow for light backgrounds)
**Warning signs:** Subtitles readable on light scenes but disappear on dark scenes, shadow effect inconsistent across video

### Pitfall 2: Adaptive Sizing Breaking Multi-Line Layout
**What goes wrong:** Long subtitle text gets smaller font but wraps to many lines, becomes unreadable
**Why it happens:** Adaptive sizing reduces font size but doesn't adjust line wrapping; small text + many lines = poor UX
**How to avoid:** Set minimum font size floor (never below 32px for mobile), warn user if max_line_length > 60 characters, recommend splitting long subtitles
**Warning signs:** 3+ line subtitles with tiny text, user complaints about unreadable subtitles on mobile

### Pitfall 3: Glow Effect Performance Overhead
**What goes wrong:** Video rendering becomes very slow when glow enabled, users frustrated with export times
**Why it happens:** Glow simulation via increased Outline value requires more anti-aliasing work; libass processes larger text bounds per frame
**How to avoid:** Limit glow_blur to max 10, add performance warning in UI ("Glow effects may slow rendering"), test on typical video length (30-60s)
**Warning signs:** Render time doubles with glow enabled, CPU usage spikes during subtitle frames, user reports slow exports

### Pitfall 4: WCAG Contrast Violation with Glow
**What goes wrong:** Semi-transparent glow reduces effective contrast between text and outline, fails accessibility standards
**Why it happens:** Glow uses alpha transparency in OutlineColour; transparent colors have lower perceived contrast
**How to avoid:** Keep PrimaryColour (text) fully opaque, only apply transparency to OutlineColour if glow_blur >= 3, validate contrast ratio meets 4.5:1 minimum
**Warning signs:** Text looks "washed out" with glow, hard to read on certain backgrounds, accessibility tools flag contrast issues

### Pitfall 5: Shadow Depth Exceeding Video Bounds
**What goes wrong:** Text near screen edges has shadow clipped, looks asymmetric and broken
**Why it happens:** Shadow offset (Shadow=4) pushes text bounds outside video frame; FFmpeg clips rendering to frame size
**How to avoid:** Increase MarginV when shadow_depth > 2 to give shadow room (margin_v += shadow_depth * 2), warn user about edge positioning
**Warning signs:** Bottom-aligned subtitles have shadow cut off, top-aligned text shadow disappears at frame edge

### Pitfall 6: SRT Parsing Encoding Errors
**What goes wrong:** SRT file with non-UTF-8 encoding fails to parse, adaptive sizing doesn't work
**Why it happens:** User-uploaded SRT files may be ISO-8859-1, Windows-1252, or other encodings; Python default UTF-8 decoding fails
**How to avoid:** Try UTF-8 first, fallback to chardet library for encoding detection, log encoding issues for debugging
**Warning signs:** `UnicodeDecodeError` in logs, adaptive sizing returns base font size despite long text, foreign language subtitles fail

### Pitfall 7: Force_Style Escaping on Windows Paths
**What goes wrong:** FFmpeg command fails on Windows with syntax errors in subtitles filter
**Why it happens:** Windows paths with backslashes, colons, brackets need escaping; existing code handles this (library_routes.py line 2007-2012) but force_style string also needs escaping
**How to avoid:** Escape force_style commas as `\,` if any style values contain commas (e.g., font names), use single quotes around force_style parameter
**Warning signs:** FFmpeg error "Invalid filter syntax", Windows-specific failures, paths in error messages with unescaped characters

## Code Examples

Verified patterns from official sources:

### Complete Subtitle Style Builder Service
```python
# Source: FFmpeg ASS documentation + Edit Factory patterns
# File: app/services/subtitle_styler.py

"""
Subtitle style builder for FFmpeg ASS force_style parameter.
Implements shadow depth, glow effects, and adaptive font sizing.
"""
import logging
import srt
from dataclasses import dataclass
from typing import Optional, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class SubtitleStyleConfig:
    """
    ASS subtitle style configuration for FFmpeg force_style parameter.

    Reference: https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/subtitle/ass.html

    ASS Style Fields:
    - PlayResX/Y: Video resolution (required for correct positioning on portrait video)
    - FontName, FontSize, Bold: Text appearance
    - PrimaryColour: Text color (&H00BBGGRR format)
    - OutlineColour: Border color
    - BackColour: Shadow color (used with Shadow parameter)
    - Outline: Border thickness (0-10 typical)
    - Shadow: Drop shadow offset (0-4 typical)
    - BorderStyle: 1=outline+shadow, 3=box background
    - Alignment: 1-9 numpad (2=bottom-center, 8=top-center)
    - MarginV: Distance from edge in pixels
    """
    # Basic text properties
    font_size: int = 48
    font_family: str = "Montserrat"
    primary_color: str = "&H00FFFFFF"  # White text
    outline_color: str = "&H00000000"  # Black outline
    outline_width: int = 3
    bold: int = 1
    alignment: int = 2  # Bottom-center
    margin_v: int = 50

    # Shadow effects (SUB-01)
    shadow_depth: int = 0  # 0-4 pixels
    shadow_color: str = "&H80000000"  # Semi-transparent black

    # Glow effects (SUB-02)
    enable_glow: bool = False
    glow_blur: int = 0  # 0-10

    # Style controls
    border_style: int = 1  # 1=outline+shadow

    # Video resolution
    video_width: int = 1080
    video_height: int = 1920

    def to_force_style_string(self) -> str:
        """Generate FFmpeg force_style parameter string."""
        style_parts = [
            f"PlayResX={self.video_width}",
            f"PlayResY={self.video_height}",
            f"FontName={self.font_family}",
            f"FontSize={self.font_size}",
            f"PrimaryColour={self.primary_color}",
            f"Bold={self.bold}",
            f"Alignment={self.alignment}",
            f"MarginV={self.margin_v}",
        ]

        # Glow effect: increase outline width and use semi-transparent outline
        if self.enable_glow and self.glow_blur > 0:
            glow_outline = self.outline_width + self.glow_blur
            style_parts.append(f"Outline={glow_outline}")
            # Semi-transparent outline for glow (50% alpha)
            glow_color = f"&H80{self.outline_color[4:]}"
            style_parts.append(f"OutlineColour={glow_color}")
        else:
            style_parts.append(f"Outline={self.outline_width}")
            style_parts.append(f"OutlineColour={self.outline_color}")

        # Shadow configuration
        if self.shadow_depth > 0:
            style_parts.append(f"Shadow={self.shadow_depth}")
            style_parts.append(f"BackColour={self.shadow_color}")
            style_parts.append(f"BorderStyle={self.border_style}")
        else:
            style_parts.append("Shadow=0")
            style_parts.append(f"BorderStyle={self.border_style}")

        return ",".join(style_parts)

    @staticmethod
    def from_dict(settings: dict, video_width: int, video_height: int) -> 'SubtitleStyleConfig':
        """Create SubtitleStyleConfig from frontend subtitle_settings dict."""
        # Convert hex to ASS color format
        def hex_to_ass(hex_color: str) -> str:
            hex_color = hex_color.lstrip('#')
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
            return f"&H00{b:02X}{g:02X}{r:02X}"

        # Extract font family
        font_family = settings.get('fontFamily', 'Montserrat')
        if 'var(--' in font_family:
            parts = font_family.split(',')
            for part in parts:
                part = part.strip()
                if not part.startswith('var(') and part not in ['sans-serif', 'serif', 'monospace']:
                    font_family = part.strip("'\"")
                    break

        # Position to alignment and margin
        position_y = settings.get('positionY', 85)
        if position_y <= 20:
            alignment = 8
            margin_v = int(position_y / 100 * video_height)
        else:
            alignment = 2
            margin_v = int((100 - position_y) / 100 * video_height)

        # Add extra margin for shadow clearance
        shadow_depth = int(settings.get('shadowDepth', 0))
        if shadow_depth > 2:
            margin_v += shadow_depth * 2  # Prevent shadow clipping

        margin_v = max(50, margin_v)

        return SubtitleStyleConfig(
            font_size=int(settings.get('fontSize', 48)),
            font_family=font_family,
            primary_color=hex_to_ass(settings.get('textColor', '#FFFFFF')),
            outline_color=hex_to_ass(settings.get('outlineColor', '#000000')),
            outline_width=int(settings.get('outlineWidth', 3)),
            alignment=alignment,
            margin_v=margin_v,
            shadow_depth=shadow_depth,
            shadow_color=hex_to_ass(settings.get('shadowColor', '#000000')),
            enable_glow=settings.get('enableGlow', False),
            glow_blur=int(settings.get('glowBlur', 0)),
            border_style=settings.get('borderStyle', 1),
            video_width=video_width,
            video_height=video_height,
        )


def calculate_adaptive_font_size(
    srt_path: Path,
    base_font_size: int = 48,
    min_font_size: int = 32,
    max_chars_threshold: int = 40,
    max_chars_limit: int = 60
) -> Tuple[int, int]:
    """
    Calculate adaptive font size based on longest subtitle line.

    Implements linear interpolation formula:
    fontSize = maxSize - ((maxSize - minSize) * (textLength - minLength) / (maxLength - minLength))

    Args:
        srt_path: Path to SRT file
        base_font_size: Default font size for short text
        min_font_size: Minimum font size for very long text
        max_chars_threshold: Character count where size reduction starts
        max_chars_limit: Character count at minimum font size

    Returns:
        Tuple of (calculated_font_size, max_line_length)
    """
    try:
        # Read SRT with encoding fallback
        try:
            srt_content = srt_path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            # Fallback to latin-1 for non-UTF8 files
            srt_content = srt_path.read_text(encoding='latin-1')
            logger.warning(f"SRT file not UTF-8, using latin-1: {srt_path}")

        # Parse subtitles
        subtitles = list(srt.parse(srt_content))

        # Find longest line
        max_line_length = 0
        for subtitle in subtitles:
            lines = subtitle.content.split('\n')
            for line in lines:
                # Strip HTML tags
                clean_line = line.replace('<i>', '').replace('</i>', '')
                clean_line = clean_line.replace('<b>', '').replace('</b>', '')
                clean_line = clean_line.replace('<u>', '').replace('</u>', '')
                line_length = len(clean_line.strip())
                max_line_length = max(max_line_length, line_length)

        # Adaptive sizing logic
        if max_line_length <= max_chars_threshold:
            return base_font_size, max_line_length
        elif max_line_length >= max_chars_limit:
            return min_font_size, max_line_length
        else:
            # Linear interpolation
            font_size = base_font_size - (
                (base_font_size - min_font_size) *
                (max_line_length - max_chars_threshold) /
                (max_chars_limit - max_chars_threshold)
            )
            return int(font_size), max_line_length

    except Exception as e:
        logger.error(f"SRT parsing failed for adaptive sizing: {e}")
        return base_font_size, 0


def build_subtitle_filter(
    srt_path: Path,
    subtitle_settings: dict,
    video_width: int,
    video_height: int
) -> str:
    """
    Build complete FFmpeg subtitles filter with force_style.

    Args:
        srt_path: Path to SRT subtitle file
        subtitle_settings: Frontend SubtitleSettings dict
        video_width: Video resolution width
        video_height: Video resolution height

    Returns:
        FFmpeg filter string like:
        "subtitles='path.srt':force_style='FontName=Arial,FontSize=48,...'"
    """
    # Apply adaptive sizing if enabled
    settings = subtitle_settings.copy()
    if settings.get('adaptiveSizing', False):
        base_size = settings.get('fontSize', 48)
        adaptive_size, max_chars = calculate_adaptive_font_size(
            srt_path=srt_path,
            base_font_size=base_size,
            min_font_size=max(16, base_size - 16),
            max_chars_threshold=40,
            max_chars_limit=60
        )
        settings['fontSize'] = adaptive_size
        logger.info(f"Adaptive sizing: {max_chars} chars → {adaptive_size}px (base: {base_size}px)")

    # Build ASS style config
    style_config = SubtitleStyleConfig.from_dict(
        settings=settings,
        video_width=video_width,
        video_height=video_height
    )

    force_style = style_config.to_force_style_string()

    # Escape SRT path for FFmpeg (Windows compatibility)
    srt_path_escaped = str(srt_path).replace('\\', '/')
    srt_path_escaped = srt_path_escaped.replace("'", "'\\''")
    srt_path_escaped = srt_path_escaped.replace(':', '\\:')
    srt_path_escaped = srt_path_escaped.replace('[', '\\[')
    srt_path_escaped = srt_path_escaped.replace(']', '\\]')

    # Build filter
    filter_str = f"subtitles='{srt_path_escaped}':force_style='{force_style}'"

    logger.debug(f"Subtitle filter: {filter_str[:150]}...")
    return filter_str
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed font size for all text | Adaptive sizing based on character count | 2024-2025 | Prevents text overflow on mobile, maintains readability for long subtitles |
| Simple outline only | Shadow + outline + glow combinations | 2023+ | Improved readability on variable backgrounds, meets WCAG contrast standards |
| SRT format only | ASS styling via force_style on SRT | 2020+ | Keep SRT editability, apply advanced styling at render time, no format conversion needed |
| Manual shadow in video editing | FFmpeg libass Shadow parameter | Always standard | Hardware-accelerated rendering, perfect frame sync, 60fps+ performance |
| Per-platform subtitle sizes | Unified base size with adaptive scaling | 2025+ | Consistent UX across platforms, automatic optimization, less manual adjustment |

**Deprecated/outdated:**
- **Converting SRT to ASS format:** Loses editability, modern approach uses SRT with ASS styling via force_style
- **Fixed 48px font for all content:** Doesn't scale for long text, modern approach uses adaptive sizing
- **Pure white text without shadow/outline:** Fails on light backgrounds, modern approach requires outline minimum
- **Manual shadow in Premiere/After Effects:** Slow, non-parametric, modern approach uses FFmpeg libass for speed

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal shadow depth for different screen sizes**
   - What we know: Research recommends 1-4px shadow depth, social media best practices suggest 2-point stroke/shadow
   - What's unclear: Does shadow_depth=2 work equally well on phone (5.5") vs tablet (10") when viewing same 1080x1920 video?
   - Recommendation: Default shadow_depth=2 (conservative), allow user override 0-4, log user preferences to identify patterns

2. **Glow effect performance on long videos**
   - What we know: Glow increases Outline value which requires more anti-aliasing, potential slowdown
   - What's unclear: At what video length does glow_blur=10 become prohibitively slow? 30s? 60s? 5min?
   - Recommendation: Benchmark glow rendering on 30s/60s/120s videos, add performance warning if video > 60s and glow_blur > 5

3. **Adaptive sizing interaction with word wrapping**
   - What we know: Adaptive sizing reduces font size based on character count, but doesn't control line wrapping
   - What's unclear: If 60-char line wraps to 2 lines at 32px font, is it more readable than 1 line at 48px?
   - Recommendation: Start with simple character count approach, monitor user feedback, consider adding max_lines parameter in future if users report wrapping issues

4. **WCAG compliance with semi-transparent glow**
   - What we know: WCAG requires 4.5:1 contrast for normal text, glow uses alpha transparency which reduces effective contrast
   - What's unclear: Does semi-transparent glow (&H80FFFFFF) on semi-transparent outline still meet 4.5:1 when composited?
   - Recommendation: Conservative approach: only apply transparency to OutlineColour when glow_blur >= 3, keep PrimaryColour fully opaque, validate with accessibility tools

5. **SRT encoding auto-detection accuracy**
   - What we know: User-uploaded SRT files may be UTF-8, ISO-8859-1, Windows-1252, or other encodings
   - What's unclear: Does Python's chardet library accurately detect subtitle file encodings? False positives?
   - Recommendation: Try UTF-8 first (most common), fallback to latin-1 (covers Western European), log encoding errors for manual review, consider adding encoding parameter to upload API if issues arise

## Sources

### Primary (HIGH confidence)
- [FFmpeg ASS Subtitle Format Documentation](https://hhsprings.bitbucket.io/docs/programming/examples/ffmpeg/subtitle/ass.html) - Comprehensive ASS style parameters, Shadow/Outline/BorderStyle definitions
- [FFmpeg Subtitles Filter Official Docs](https://ffmpeg.org/ffmpeg-filters.html#subtitles) - force_style parameter usage, path escaping requirements
- [How to change subtitle appearances with FFmpeg](https://www.abyssale.com/blog/how-to-change-the-appearances-of-subtitles-with-ffmpeg) - BorderStyle/Shadow/Outline practical examples
- [Python srt Library - PyPI](https://pypi.org/project/srt/) - SRT parsing library documentation, API reference
- [WCAG 2.1 Color Contrast Standards](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html) - 4.5:1 contrast ratio requirements, text/background definitions

### Secondary (MEDIUM confidence)
- [Fluid Font Size by Character Count Formula](https://stevenwoodson.com/blog/fluid-font-size-by-character-count/) - Linear interpolation formula for adaptive sizing
- [Social Media Caption Styles Guide](https://www.kapwing.com/resources/social-media-captions-styles-a-complete-guide/) - TikTok/Reels/Shorts subtitle best practices
- [Instagram Reels Subtitle Best Practices 2026](https://www.opus.pro/blog/instagram-reels-caption-subtitle-best-practices) - Font sizes, contrast, shadow recommendations for mobile
- [FFmpeg Engineering Handbook - Subtitles](https://github.com/endcycles/ffmpeg-engineering-handbook/blob/main/docs/advanced/subtitles.md) - Advanced subtitle rendering techniques
- [How to Render Subtitles with FFmpeg](https://blog.usro.net/2024/12/how-to-render-subtitles-in-video-with-ffmpeg/) - Practical force_style examples, troubleshooting

### Tertiary (LOW confidence)
- [Best Ways to Add Subtitles to Shorts/TikTok/Reels 2025](https://swiftia.io/best-ways-to-add-subtitles-to-short-videos-tiktok-reels-shorts-in-2024/) - General subtitle styling trends (blog post)
- [OptiSub: Optimizing Video Subtitle Presentation](https://dl.acm.org/doi/10.1145/3706598.3714199) - Academic research on adaptive subtitles (CHI 2025 paper, complex ML approach)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - FFmpeg ASS subtitles filter well-documented, Python srt library actively maintained, patterns proven in codebase
- Architecture: HIGH - Follows Phase 9 filter controls pattern, integrates with existing subtitle_settings pipeline, SubtitleStyleConfig matches VideoFilters approach
- Adaptive sizing formula: MEDIUM - Linear interpolation formula proven in web typography, requires empirical testing for video subtitle thresholds (40/60 chars)
- Shadow/glow parameters: HIGH - ASS Shadow/Outline/BackColour documented in FFmpeg official docs, ranges verified (0-4 shadow, 0-10 outline typical)
- Performance: MEDIUM - Glow effect performance impact estimated, requires benchmarking on actual Edit Factory content (flagged in Open Questions)
- WCAG compliance: HIGH - 4.5:1 contrast standard official, semi-transparent glow compliance requires validation (flagged in Open Questions)

**Research date:** 2026-02-05
**Valid until:** 60 days (FFmpeg ASS format stable, subtitle rendering patterns mature, social media standards evolving slowly)

**Notes:**
- Edit Factory already uses ASS styling via force_style (library_routes.py), Phase 11 extends with shadow/glow/adaptive sizing
- CPU-only rendering already implemented correctly (video_processor.py line 1014-1016 comments explain subtitles filter incompatibility with GPU decode)
- Adaptive sizing is new capability, requires SRT parsing (add `srt` library to requirements.txt)
- Shadow/glow defaults should be conservative (shadow_depth=0, enable_glow=false) to avoid performance surprises
- Follow Phase 9 pattern: checkboxes enable features, sliders appear when checked (reduce visual clutter per STATE.md v3 decisions)
- Integration point: _render_with_preset() in library_routes.py (line 2360+), between video filters and subtitle addition
- Type safety: Extend SubtitleSettings in video-processing.ts, update DEFAULT_SUBTITLE_SETTINGS with Phase 11 fields
