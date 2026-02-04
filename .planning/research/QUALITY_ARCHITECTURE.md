# Architecture Patterns: Video Quality Enhancement Integration

**Domain:** Video quality enhancement for social media content
**Researched:** 2026-02-04
**Confidence:** HIGH

## Executive Summary

Video quality enhancement features should integrate with the existing FFmpeg-based pipeline through a **layered enhancement approach**: encoding settings at render time, filters during segment extraction, and audio processing during TTS phase. The architecture leverages existing patterns (preset system, service layer, settings storage) while adding new configuration surfaces at strategic points in the video processing workflow.

**Key principle:** Quality enhancement is not a single operation but rather a collection of optimizations applied at different stages of the pipeline, each with its own integration point.

## Recommended Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Quality Enhancement Layer                 │
│  ┌────────────────┬────────────────┬────────────────────┐   │
│  │ Encoding       │ Video Filters  │ Audio Processing   │   │
│  │ Settings       │ Enhancement    │ Normalization      │   │
│  └────────────────┴────────────────┴────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴──────────┐
                    │                    │
┌──────────────────▼──┐    ┌────────────▼─────────────┐
│   video_processor   │    │   library_routes         │
│   ├─ VideoEditor    │    │   ├─ _render_with_preset │
│   ├─ extract_segs   │    │   └─ render_clip         │
│   └─ add_subtitles  │    └──────────────────────────┘
└─────────────────────┘                 │
         │                              │
         └───────────────┬──────────────┘
                         ▼
              ┌────────────────────┐
              │    FFmpeg CLI      │
              │  ├─ Encoding opts  │
              │  ├─ Filter chains  │
              │  └─ Audio filters  │
              └────────────────────┘
```

### Integration Points

Quality enhancement integrates at **five strategic points** in the existing pipeline:

| Point | File | Function | Enhancement Type |
|-------|------|----------|------------------|
| 1. Segment extraction | `video_processor.py` | `VideoEditor.extract_segments()` | Video filters (sharpen, denoise, color) |
| 2. Audio generation | `elevenlabs_tts.py` | `generate_audio()` | Audio normalization (loudnorm filter) |
| 3. Audio mixing | `video_processor.py` | `VideoEditor.add_audio()` | Audio leveling, compression |
| 4. Subtitle rendering | `video_processor.py` | `VideoEditor.add_subtitles()` | Font rendering quality |
| 5. Final render | `library_routes.py` | `_render_with_preset()` | Encoding settings (CRF, bitrate, codec) |

## Component Architecture

### 1. Quality Settings Service

**Purpose:** Central configuration management for quality enhancement settings
**Location:** NEW FILE `app/services/quality_settings.py`
**Pattern:** Singleton factory with Pydantic models

**Responsibilities:**
- Load quality presets from configuration
- Merge preset + user overrides
- Generate FFmpeg filter strings
- Validate settings combinations

**Interface:**
```python
@dataclass
class VideoQualitySettings:
    # Encoding
    crf: int = 18
    preset: str = "slow"
    bitrate_max: str = "10M"

    # Filters
    sharpen_enabled: bool = False
    sharpen_strength: float = 1.0
    denoise_enabled: bool = False
    denoise_strength: int = 3

    # Color
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0

def get_quality_settings() -> QualitySettingsService:
    """Factory function returning singleton instance"""
```

### 2. Filter Builder

**Purpose:** Construct FFmpeg filter chains from settings
**Location:** NEW CLASS in `app/services/quality_settings.py`
**Pattern:** Builder pattern for complex filter strings

**Responsibilities:**
- Build video filter chains (vf)
- Build audio filter chains (af)
- Handle filter ordering and dependencies
- Escape special characters

**Interface:**
```python
class FFmpegFilterBuilder:
    def add_video_filter(self, name: str, params: dict) -> Self
    def add_audio_filter(self, name: str, params: dict) -> Self
    def build_video_chain(self) -> str
    def build_audio_chain(self) -> str
```

**Why separate builder?** Filter chains have complex syntax (`;` vs `,` separators, quoting rules, ordering constraints). Builder pattern isolates this complexity from business logic.

### 3. Enhanced Preset System

**Purpose:** Extend existing preset system with quality profiles
**Location:** MODIFY `app/api/library_routes.py` + Supabase schema
**Pattern:** Database-backed presets with quality tier inheritance

**Current schema:**
```sql
editai_export_presets (
    id, name, width, height, fps, video_bitrate,
    crf, audio_bitrate, is_default
)
```

**Enhanced schema:**
```sql
editai_export_presets (
    ... existing fields ...,
    quality_tier TEXT DEFAULT 'balanced',  -- 'fast', 'balanced', 'high', 'maximum'
    video_filters JSONB DEFAULT '{}',      -- {sharpen: {...}, denoise: {...}}
    audio_normalization JSONB DEFAULT '{}' -- {target_lufs: -16, ...}
)
```

**Migration path:** Add nullable columns, backfill with defaults, then set NOT NULL.

### 4. Profile Quality Preferences

**Purpose:** User-level quality defaults
**Location:** MODIFY `editai_profiles` table schema
**Pattern:** Profile-scoped settings that override system defaults

**Schema addition:**
```sql
editai_profiles (
    ... existing fields ...,
    default_quality_tier TEXT DEFAULT 'balanced',
    quality_preferences JSONB DEFAULT '{}'
)
```

**Why profile-scoped?** Different users have different needs:
- Agency user: Maximum quality for client deliverables
- Solo creator: Balanced quality for fast turnaround
- Bulk producer: Fast quality for volume content

### 5. Settings UI Components

**Purpose:** User interface for quality configuration
**Location:** NEW COMPONENTS in `frontend/src/components/quality/`
**Pattern:** Controlled components with live preview

**Components to create:**
```
quality/
├── quality-preset-selector.tsx     # Dropdown: Fast/Balanced/High/Maximum
├── video-filters-panel.tsx         # Sharpen, denoise, color controls
├── audio-normalization-panel.tsx   # LUFS target, dynamic range
├── encoding-settings-panel.tsx     # CRF, bitrate, codec selection
└── quality-preview.tsx             # Side-by-side comparison
```

**Integration surface:** Add to settings page as new card:
```tsx
// frontend/src/app/settings/page.tsx
<Card>
  <CardHeader>
    <CardTitle>Video Quality</CardTitle>
    <CardDescription>
      Configure encoding and enhancement settings
    </CardDescription>
  </CardHeader>
  <CardContent>
    <QualityPresetSelector />
    <VideoFiltersPanel />
    <EncodingSettingsPanel />
  </CardContent>
</Card>
```

## Data Flow Changes

### Current Flow (Simplified)

```
Upload → Analyze → Select Segments → Generate TTS →
Render (hardcoded preset) → Download
```

### Enhanced Flow

```
Upload → Analyze → Select Segments → Generate TTS →
Render (user quality preset + profile defaults + platform preset) →
Download
```

**Quality resolution cascade:**
1. Start with platform preset (Instagram/TikTok/YouTube)
2. Apply profile default quality tier
3. Apply user override (if provided in render request)
4. Merge into final FFmpeg command

### Quality Settings Resolution

```python
# Pseudo-code for quality settings resolution
def resolve_quality_settings(
    platform: str,           # 'instagram_reels', 'tiktok', etc.
    profile_id: str,
    user_overrides: dict = None
) -> VideoQualitySettings:
    # 1. Load platform preset
    preset = db.get_preset(platform)

    # 2. Load profile defaults
    profile = db.get_profile(profile_id)
    quality_tier = profile.default_quality_tier

    # 3. Apply quality tier adjustments
    settings = apply_quality_tier(preset, quality_tier)

    # 4. Merge user overrides
    if user_overrides:
        settings = merge_overrides(settings, user_overrides)

    return settings
```

## File Modification Plan

### Files to Modify

| File | Lines | Modification Type | Complexity |
|------|-------|-------------------|------------|
| `app/services/video_processor.py` | ~2040 | Add filter parameters to extract_segments, add_audio | Medium |
| `app/api/library_routes.py` | ~2450 | Add quality_settings param to render endpoints | Medium |
| `app/config.py` | ~68 | Add quality settings defaults | Low |
| `frontend/src/app/settings/page.tsx` | ~582 | Add quality settings UI | Medium-High |

### New Files to Create

| File | Purpose | Size Estimate |
|------|---------|---------------|
| `app/services/quality_settings.py` | Quality configuration service | ~400 lines |
| `frontend/src/components/quality/quality-preset-selector.tsx` | Preset dropdown | ~150 lines |
| `frontend/src/components/quality/video-filters-panel.tsx` | Filter controls | ~300 lines |
| `frontend/src/components/quality/encoding-settings-panel.tsx` | Encoding UI | ~250 lines |
| `frontend/src/components/quality/audio-normalization-panel.tsx` | Audio controls | ~200 lines |

**Total new code:** ~1,300 lines (5 new files)
**Total modifications:** ~500 lines across 4 files

### Supabase Migrations

```sql
-- Migration 1: Add quality columns to presets
ALTER TABLE editai_export_presets
  ADD COLUMN quality_tier TEXT DEFAULT 'balanced',
  ADD COLUMN video_filters JSONB DEFAULT '{}',
  ADD COLUMN audio_normalization JSONB DEFAULT '{}';

-- Migration 2: Add quality preferences to profiles
ALTER TABLE editai_profiles
  ADD COLUMN default_quality_tier TEXT DEFAULT 'balanced',
  ADD COLUMN quality_preferences JSONB DEFAULT '{}';

-- Migration 3: Backfill defaults
UPDATE editai_export_presets
SET
  quality_tier = 'balanced',
  video_filters = '{"sharpen_enabled": false, "denoise_enabled": false}',
  audio_normalization = '{"target_lufs": -16, "enabled": true}'
WHERE quality_tier IS NULL;
```

## FFmpeg Integration Patterns

### 1. Video Filter Chain Construction

**Current approach (hardcoded):**
```python
# video_processor.py line ~2344
filters.append(f"scale={preset['width']}:{preset['height']}")
filters.append(f"crop={preset['width']}:{preset['height']}")
```

**Enhanced approach (configurable):**
```python
def build_video_filters(
    preset: dict,
    quality: VideoQualitySettings,
    video_info: dict
) -> List[str]:
    filters = []

    # 1. Enhancement filters FIRST (before scaling)
    if quality.sharpen_enabled:
        filters.append(f"unsharp=5:5:{quality.sharpen_strength}")

    if quality.denoise_enabled:
        filters.append(f"hqdn3d={quality.denoise_strength}")

    if quality.brightness != 0 or quality.contrast != 1.0:
        filters.append(
            f"eq=brightness={quality.brightness}:"
            f"contrast={quality.contrast}:"
            f"saturation={quality.saturation}"
        )

    # 2. Scaling (after enhancement)
    filters.append(f"scale={preset['width']}:{preset['height']}:force_original_aspect_ratio=increase")
    filters.append(f"crop={preset['width']}:{preset['height']}")

    # 3. Frame rate (if specified)
    if preset.get('fps'):
        filters.append(f"fps={preset['fps']}")

    return filters
```

**Why this order?** Enhancement filters work better on original resolution, scaling should be last before crop.

### 2. Audio Normalization Integration

**Current approach (no normalization):**
```python
# elevenlabs_tts.py line ~196
"-c:a", "aac", "-b:a", "192k"
```

**Enhanced approach (2-pass loudnorm):**
```python
def normalize_audio(
    input_path: Path,
    output_path: Path,
    target_lufs: float = -16
) -> Path:
    """Apply EBU R128 loudness normalization"""

    # Pass 1: Analyze
    probe_cmd = [
        "ffmpeg", "-i", str(input_path),
        "-af", f"loudnorm=I={target_lufs}:print_format=json",
        "-f", "null", "-"
    ]
    result = subprocess.run(probe_cmd, capture_output=True, text=True)

    # Parse JSON from stderr
    loudness_data = extract_loudnorm_json(result.stderr)

    # Pass 2: Normalize with measured values
    normalize_cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-af",
        f"loudnorm=I={target_lufs}:"
        f"measured_I={loudness_data['input_i']}:"
        f"measured_LRA={loudness_data['input_lra']}:"
        f"measured_tp={loudness_data['input_tp']}:"
        f"measured_thresh={loudness_data['input_thresh']}:"
        f"offset={loudness_data['target_offset']}:"
        f"linear=true",
        "-ar", "48000",
        "-c:a", "aac", "-b:a", "192k",
        str(output_path)
    ]
    subprocess.run(normalize_cmd, check=True)

    return output_path
```

**Integration point:** Call before `add_audio()` in video_processor workflow.

### 3. Encoding Settings Application

**Current approach (preset-based):**
```python
# library_routes.py line ~2381-2388
"-c:v", preset.get("video_codec", "libx264"),
"-crf", str(preset.get("crf", 18)),
"-preset", "slow",
```

**Enhanced approach (quality-tier-aware):**
```python
def get_encoding_settings(
    quality_tier: str,
    platform: str
) -> dict:
    """Return encoding settings for quality tier"""

    QUALITY_TIERS = {
        'fast': {
            'crf': 23,
            'preset': 'veryfast',
            'profile': 'main',
            'level': '4.0'
        },
        'balanced': {
            'crf': 20,
            'preset': 'medium',
            'profile': 'high',
            'level': '4.1'
        },
        'high': {
            'crf': 18,
            'preset': 'slow',
            'profile': 'high',
            'level': '4.2'
        },
        'maximum': {
            'crf': 15,
            'preset': 'veryslow',
            'profile': 'high',
            'level': '4.2',
            'additional': ['-tune', 'film']
        }
    }

    settings = QUALITY_TIERS[quality_tier]

    # Platform-specific overrides
    if platform == 'instagram_reels':
        # Instagram recompresses aggressively, so higher CRF acceptable
        settings['crf'] = min(settings['crf'] + 2, 23)
    elif platform == 'youtube_shorts':
        # YouTube preserves quality better, use lower CRF
        settings['crf'] = max(settings['crf'] - 1, 15)

    return settings
```

### 4. Subtitle Rendering Optimization

**Current approach (basic ASS styling):**
```python
# video_processor.py line ~915-927
subtitle_style = (
    f"PlayResX={video_width},"
    f"PlayResY={video_height},"
    f"FontName={font_family},"
    f"FontSize={font_size},"
    ...
)
```

**Enhanced approach (quality-aware rendering):**
```python
def get_subtitle_style(
    video_width: int,
    video_height: int,
    quality_tier: str,
    subtitle_settings: dict
) -> str:
    """Build ASS style with quality optimizations"""

    # Base settings
    font_size = subtitle_settings['fontSize']
    outline_width = subtitle_settings['outlineWidth']

    # Quality tier adjustments
    if quality_tier == 'maximum':
        # Increase outline for better readability on high-res displays
        outline_width = min(outline_width + 1, 10)
        # Add shadow for depth
        shadow_depth = 2
    elif quality_tier == 'fast':
        # Reduce outline to speed up rendering
        outline_width = max(outline_width - 1, 1)
        shadow_depth = 0
    else:
        shadow_depth = 1

    return (
        f"PlayResX={video_width},"
        f"PlayResY={video_height},"
        f"FontName={subtitle_settings['fontFamily']},"
        f"FontSize={font_size},"
        f"PrimaryColour={subtitle_settings['textColor']},"
        f"OutlineColour={subtitle_settings['outlineColor']},"
        f"Outline={outline_width},"
        f"Shadow={shadow_depth},"
        ...
    )
```

## Segment Scoring Enhancements

### Current Scoring Algorithm

```python
# video_processor.py line ~69-77
@property
def combined_score(self) -> float:
    return (
        self.motion_score * 0.6 +
        self.variance_score * 0.3 +
        (1 - abs(self.avg_brightness - 0.5)) * 0.1
    )
```

**Limitations:**
- No consideration for visual quality (blur, noise)
- Brightness penalty is simplistic
- No color vibrancy assessment
- No composition analysis

### Enhanced Scoring (Future Integration)

**Location:** MODIFY `VideoSegment` class in `video_processor.py`
**Pattern:** Pluggable scoring metrics

```python
@dataclass
class VideoSegment:
    # Existing fields
    start_time: float
    end_time: float
    motion_score: float
    variance_score: float
    avg_brightness: float

    # NEW: Quality metrics
    sharpness_score: float = 0.5      # Laplacian variance
    color_vibrancy: float = 0.5       # HSV saturation
    composition_score: float = 0.5    # Rule of thirds, golden ratio
    face_presence: bool = False       # Face detection result

    @property
    def quality_score(self) -> float:
        """Visual quality independent of motion"""
        return (
            self.sharpness_score * 0.4 +
            self.color_vibrancy * 0.3 +
            self.composition_score * 0.3
        )

    @property
    def combined_score(self) -> float:
        """Enhanced scoring with quality factor"""
        base_score = (
            self.motion_score * 0.5 +      # Reduced from 0.6
            self.variance_score * 0.25 +    # Reduced from 0.3
            (1 - abs(self.avg_brightness - 0.5)) * 0.1
        )

        # Add quality bonus (15% weight)
        quality_bonus = self.quality_score * 0.15

        # Face presence bonus (5% if present)
        face_bonus = 0.05 if self.face_presence else 0.0

        return min(1.0, base_score + quality_bonus + face_bonus)
```

**Implementation approach:**
1. Add quality metrics as optional fields (backward compatible)
2. Compute during `analyze_full_video()` alongside motion/variance
3. Use OpenCV for sharpness (Laplacian), color analysis (HSV)
4. Face detection via OpenCV Haar cascades (fast) or dlib (accurate)

### Quality Metric Computation

```python
def _calculate_quality_metrics(
    self,
    frame: np.ndarray
) -> tuple[float, float, float]:
    """Compute sharpness, color vibrancy, composition"""

    # Sharpness via Laplacian variance
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    sharpness = np.var(laplacian) / 10000  # Normalize to 0-1
    sharpness = min(1.0, sharpness)

    # Color vibrancy via HSV saturation
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    saturation = np.mean(hsv[:, :, 1]) / 255.0

    # Composition: Rule of thirds intersection points
    h, w = frame.shape[:0]
    third_h, third_w = h // 3, w // 3

    # Sample brightness at rule-of-thirds intersections
    intersections = [
        (third_h, third_w), (third_h, 2*third_w),
        (2*third_h, third_w), (2*third_h, 2*third_w)
    ]

    # Good composition = higher variance at intersections
    intersection_brightness = [
        np.mean(gray[max(0, y-10):y+10, max(0, x-10):x+10])
        for y, x in intersections
    ]
    composition = np.std(intersection_brightness) / 128.0  # 0-1
    composition = min(1.0, composition)

    return sharpness, saturation, composition
```

**Performance impact:** +15-20% CPU time during analysis (minimal, one-time cost during upload).

## Platform-Specific Presets

### Current Presets (Basic)

```python
# Hardcoded in Supabase seed data
instagram_reels: 1080x1920, 30fps, 10M bitrate, CRF 18
tiktok: 1080x1920, 30fps, 10M bitrate, CRF 18
youtube_shorts: 1080x1920, 30fps, 10M bitrate, CRF 18
```

**Problem:** All platforms use identical settings despite different compression algorithms.

### Enhanced Presets (Platform-Optimized)

**Rationale:** Each platform has unique encoding pipelines that recompress uploaded videos.

| Platform | Their Encoder | Upload Strategy | Our Preset |
|----------|---------------|-----------------|------------|
| Instagram | Aggressive H.264 recompression | Higher CRF acceptable (they'll compress anyway) | CRF 20, preset medium |
| TikTok | Moderate H.264 | Balanced approach | CRF 18, preset slow |
| YouTube | VP9/AV1 (preserves quality) | Lower CRF for maximum source quality | CRF 16, preset slow |
| Facebook | Similar to Instagram | Higher CRF | CRF 20, preset medium |

**Implementation:**
```python
PLATFORM_OPTIMIZATION = {
    'instagram_reels': {
        'crf_offset': +2,  # 18 → 20 (they'll compress anyway)
        'preset': 'medium',
        'max_bitrate': '8M',  # Lower (they cap at 8Mbps)
        'audio_bitrate': '128k'  # Lower (they downmix)
    },
    'youtube_shorts': {
        'crf_offset': -2,  # 18 → 16 (preserve quality)
        'preset': 'slow',
        'max_bitrate': '15M',  # Higher (YouTube preserves)
        'audio_bitrate': '192k'
    },
    'tiktok': {
        'crf_offset': 0,  # 18 unchanged
        'preset': 'medium',
        'max_bitrate': '10M',
        'audio_bitrate': '128k'
    }
}
```

## Build Order & Dependencies

### Recommended Build Order

**Phase 1: Foundation (Backend)**
1. Create `quality_settings.py` service
2. Add database migrations (presets + profiles schema)
3. Modify `video_processor.py` to accept quality parameters
4. Test filter generation in isolation

**Phase 2: Integration (Backend)**
5. Modify `library_routes.py` render endpoints
6. Add quality resolution logic
7. Update preset seed data with quality tiers
8. Test end-to-end rendering with new settings

**Phase 3: Audio Enhancement**
9. Add audio normalization to `elevenlabs_tts.py`
10. Integrate loudnorm 2-pass workflow
11. Test TTS → normalization → video pipeline

**Phase 4: Frontend UI**
12. Create quality component stubs
13. Add settings page integration
14. Wire up API calls
15. Add live preview (if feasible)

**Phase 5: Advanced Scoring (Optional)**
16. Add quality metrics to `VideoSegment`
17. Implement sharpness/color/composition analysis
18. Update scoring weights
19. A/B test scoring improvements

**Dependencies:**
- Phase 2 depends on Phase 1 (quality service must exist)
- Phase 3 independent of Phase 1-2 (can be parallel)
- Phase 4 depends on Phase 2 (API must support quality params)
- Phase 5 independent of all others (pure algorithm improvement)

### Critical Path

```
Phase 1 (Foundation) → Phase 2 (Integration) → Phase 4 (UI)
```

Phase 3 (Audio) and Phase 5 (Scoring) are **optional enhancements** that can be deferred.

### Estimated Effort

| Phase | Backend | Frontend | Testing | Total |
|-------|---------|----------|---------|-------|
| 1. Foundation | 8h | 0h | 2h | 10h |
| 2. Integration | 6h | 0h | 3h | 9h |
| 3. Audio Enhancement | 4h | 0h | 2h | 6h |
| 4. Frontend UI | 2h | 12h | 4h | 18h |
| 5. Advanced Scoring | 8h | 0h | 3h | 11h |
| **Total** | **28h** | **12h** | **14h** | **54h** |

**MVP scope:** Phases 1-2-4 (37 hours) delivers encoding quality + basic filters + UI.
**Full scope:** All phases (54 hours) includes audio normalization + advanced scoring.

## Patterns to Follow

### 1. Graceful Degradation

**Principle:** If quality enhancement fails, fall back to basic encoding.

```python
def extract_segments_with_filters(
    video_path: Path,
    segments: List[VideoSegment],
    quality: VideoQualitySettings
) -> Path:
    """Extract with quality filters, fallback on error"""

    try:
        # Try with filters
        filters = build_video_filters(quality)
        return _extract_with_ffmpeg(video_path, segments, filters)
    except FFmpegError as e:
        logger.warning(f"Filter application failed: {e}, retrying without filters")
        # Fallback: extract without filters
        return _extract_with_ffmpeg(video_path, segments, filters=[])
```

### 2. Settings Validation

**Principle:** Validate settings before FFmpeg execution to prevent cryptic errors.

```python
def validate_quality_settings(settings: VideoQualitySettings) -> None:
    """Validate settings combinations"""

    # CRF range check
    if not (0 <= settings.crf <= 51):
        raise ValueError(f"CRF must be 0-51, got {settings.crf}")

    # Preset validity
    valid_presets = ['ultrafast', 'superfast', 'veryfast', 'faster',
                     'fast', 'medium', 'slow', 'slower', 'veryslow']
    if settings.preset not in valid_presets:
        raise ValueError(f"Invalid preset: {settings.preset}")

    # Filter strength ranges
    if settings.sharpen_enabled and not (0.0 <= settings.sharpen_strength <= 5.0):
        raise ValueError(f"Sharpen strength must be 0-5, got {settings.sharpen_strength}")
```

### 3. FFmpeg Command Logging

**Principle:** Log full FFmpeg commands for debugging, but sanitize output.

```python
def _run_ffmpeg(self, cmd: list, operation: str) -> subprocess.CompletedProcess:
    """Run FFmpeg with detailed logging"""

    # Log command (already exists)
    logger.debug(f"FFmpeg command ({operation}): {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        # NEW: Log filter-specific errors
        if "filter" in result.stderr.lower():
            logger.error(f"Filter error in {operation}: {result.stderr[:500]}")

        raise RuntimeError(f"FFmpeg {operation} failed")

    return result
```

### 4. Preset Inheritance

**Principle:** Platform presets inherit from base quality tiers.

```
Quality Tier (base) → Platform Preset (override) → User Settings (final)
```

```python
def merge_preset_with_tier(
    platform_preset: dict,
    quality_tier: str
) -> dict:
    """Merge platform preset with quality tier defaults"""

    tier_defaults = get_quality_tier_defaults(quality_tier)

    # Start with tier defaults
    merged = tier_defaults.copy()

    # Override with platform-specific settings
    merged.update(platform_preset)

    # Apply platform optimizations
    if 'crf_offset' in platform_preset:
        merged['crf'] += platform_preset['crf_offset']

    return merged
```

## Anti-Patterns to Avoid

### 1. Filter Order Independence Assumption

**Anti-pattern:**
```python
# WRONG: Assuming filter order doesn't matter
filters = ["scale=1080:1920", "unsharp=5:5:1", "crop=1080:1920"]
```

**Why wrong:** Sharpening after scaling amplifies scaling artifacts. Crop after sharpen wastes CPU.

**Correct approach:**
```python
# Enhance → Scale → Crop
filters = ["unsharp=5:5:1", "scale=1080:1920", "crop=1080:1920"]
```

### 2. Synchronous Audio Normalization

**Anti-pattern:**
```python
# WRONG: Blocking 2-pass normalization in request handler
audio_path = generate_tts(text)
normalized = normalize_audio_2pass(audio_path)  # Takes 10-30 seconds!
return {"audio_url": normalized}
```

**Why wrong:** Blocks request thread during FFmpeg processing, reduces throughput.

**Correct approach:**
```python
# Background task for normalization
background_tasks.add_task(normalize_and_attach_audio, audio_path, video_path)
return {"status": "processing", "job_id": job_id}
```

### 3. Hardcoded Platform Assumptions

**Anti-pattern:**
```python
# WRONG: Platform-specific logic scattered in code
if platform == "instagram":
    crf = 20
elif platform == "tiktok":
    crf = 18
elif platform == "youtube":
    crf = 16
```

**Why wrong:** Platform logic duplicated, hard to maintain, doesn't scale.

**Correct approach:**
```python
# Data-driven platform configuration
platform_settings = PLATFORM_OPTIMIZATION[platform]
crf = base_crf + platform_settings['crf_offset']
```

### 4. Silent Quality Degradation

**Anti-pattern:**
```python
# WRONG: Silently falling back to lower quality
try:
    render_with_high_quality()
except FFmpegError:
    render_with_low_quality()  # User doesn't know!
```

**Why wrong:** User expects high quality, gets low quality without notification.

**Correct approach:**
```python
try:
    return render_with_high_quality()
except FFmpegError as e:
    logger.warning(f"High quality failed: {e}, using balanced")
    # Store fallback info in result
    result = render_with_balanced_quality()
    result['quality_fallback'] = 'high_to_balanced'
    result['fallback_reason'] = str(e)
    return result
```

### 5. GPU Assumption Without Fallback

**Anti-pattern:**
```python
# WRONG: Assuming NVENC always available
encoder = "h264_nvenc"  # Fails on non-NVIDIA systems
```

**Why wrong:** Breaks on AMD, Intel, or systems without GPU.

**Correct approach:**
```python
# Existing pattern in video_processor.py (GOOD)
self.use_gpu = use_gpu and self._check_nvenc_available()
if self.use_gpu:
    self.video_codec = "h264_nvenc"
else:
    self.video_codec = "libx264"  # CPU fallback
```

## Performance Considerations

### Encoding Speed vs Quality Trade-offs

| Preset | Speed | Quality | Use Case |
|--------|-------|---------|----------|
| veryfast | 4x realtime | Good | Bulk processing, previews |
| medium | 1.5x realtime | Better | Production default |
| slow | 0.8x realtime | Best | Final deliverables |
| veryslow | 0.3x realtime | Slightly better | Overkill (diminishing returns) |

**Recommendation:** Default to `medium` for balanced speed/quality, offer `slow` for high-quality tier.

### Filter Performance Impact

| Filter | CPU Cost | GPU Support | Impact |
|--------|----------|-------------|--------|
| unsharp | Low (5-10%) | No | Negligible |
| hqdn3d | Medium (15-20%) | No | Moderate |
| eq (color) | Very low (1-3%) | No | Negligible |
| scale | Low-Medium (10-15%) | Yes (scale_cuda) | Negligible with GPU |
| subtitles | High (30-40%) | No | Significant |

**Optimization:** Use GPU scaling (`scale_cuda`) when available, skip heavy filters in 'fast' tier.

### Audio Normalization Cost

**2-pass loudnorm:** ~2-3x realtime processing (20s audio = 40-60s processing).

**Mitigation:**
- Run during TTS generation (parallel with other tasks)
- Cache normalized audio for reuse
- Skip normalization in 'fast' tier

## Testing Strategy

### Unit Tests

```python
# test_quality_settings.py
def test_filter_builder_video_chain():
    builder = FFmpegFilterBuilder()
    builder.add_video_filter("unsharp", {"luma": "5:5:1.0"})
    builder.add_video_filter("scale", {"w": 1080, "h": 1920})

    chain = builder.build_video_chain()
    assert chain == "unsharp=luma=5:5:1.0,scale=w=1080:h=1920"

def test_quality_tier_resolution():
    settings = resolve_quality_settings(
        platform="instagram_reels",
        quality_tier="high"
    )
    assert settings.crf == 18 + 2  # Instagram offset
    assert settings.preset == "slow"
```

### Integration Tests

```python
# test_video_rendering.py
@pytest.mark.integration
def test_render_with_quality_settings():
    """Test full render pipeline with quality settings"""
    video = test_video_path()
    settings = VideoQualitySettings(
        crf=20,
        sharpen_enabled=True,
        denoise_enabled=True
    )

    output = render_video(video, segments, settings)

    assert output.exists()
    assert get_video_bitrate(output) < 10_000_000  # < 10Mbps
    assert get_video_codec(output) == "h264"
```

### Visual Quality Tests

```python
# test_quality_metrics.py
@pytest.mark.slow
def test_sharpness_detection():
    """Test sharpness metric distinguishes blur"""
    sharp_frame = load_test_frame("sharp.png")
    blurry_frame = cv2.GaussianBlur(sharp_frame, (15, 15), 0)

    sharp_score = calculate_sharpness(sharp_frame)
    blur_score = calculate_sharpness(blurry_frame)

    assert sharp_score > blur_score * 2  # Sharp should score 2x higher
```

### Manual QA Checklist

**For each quality tier:**
- [ ] Render completes without errors
- [ ] Output file size is reasonable (not 10x expected)
- [ ] Visual inspection: no artifacts, correct colors
- [ ] Audio inspection: levels are consistent, no clipping
- [ ] Subtitles: readable, correct positioning
- [ ] Platform upload: accepted by Instagram/TikTok/YouTube
- [ ] Platform playback: smooth, no buffering issues

## Sources

**FFmpeg Quality Enhancement:**
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) - Comprehensive filter reference
- [FFmpeg: Enhance Video Quality](https://www.freddyho.com/2024/12/ffmpeg-enhance-video-quality.html) - Filter examples and best practices
- [Recommendations about FFmpeg filters to enhance video quality](https://forum.videohelp.com/threads/402021-Recommendations-about-FFmpeg-filters-to-enhance-video-quality-or-fixes) - Community wisdom on filter usage
- [How to Get the Best Quality With FFmpeg During Conversion](https://www.baeldung.com/linux/ffmpeg-best-quality-conversion) - CRF and preset optimization

**Audio Normalization:**
- [FFmpeg Loudnorm: Complete Guide to 2-Pass Audio Normalization in 2026](https://copyprogramming.com/howto/ffmpeg-loudnorm-2pass-in-single-line) - Two-pass normalization implementation
- [Audio Loudness Normalization With FFmpeg](https://medium.com/@peter_forgacs/audio-loudness-normalization-with-ffmpeg-1ce7f8567053) - EBU R128 standards
- [FFmpeg: Normalize Audio Loudness](https://www.freddyho.com/2024/12/ffmpeg-normalize-audio-loudness.html) - Loudnorm filter usage
- [GitHub - slhck/ffmpeg-normalize](https://github.com/slhck/ffmpeg-normalize) - Production-ready normalization tool

**Subtitle Rendering:**
- [How to Use FFMpeg to Add Subtitles to Videos](https://cloudinary.com/guides/video-effects/ffmpeg-subtitles) - Subtitle filters overview
- [How to Embed Subtitles into a Video Using FFmpeg](https://www.baeldung.com/linux/subtitles-ffmpeg) - ASS/SRT rendering techniques

**Social Media Specifications:**
- [2026 Social Media Video Sizes for Every Platform](https://socialbee.com/blog/social-media-video-sizes/) - Platform resolution requirements
- [Always Up-to-Date Guide to Social Media Video Specs](https://sproutsocial.com/insights/social-media-video-specs-guide/) - Bitrate and codec recommendations
- [Instagram Video Size & Format Specs 2026](https://socialrails.com/blog/instagram-video-size-format-specifications-guide) - Instagram-specific encoding guidelines
- [Best Video Format & Codec for Social Media](https://pixflow.net/blog/the-creators-cheat-sheet-best-video-formats-codecs-for-social-media/) - Cross-platform compatibility

**Video Analysis:**
- [Computer Vision Methods for Video Content Analysis](https://mklab.iti.gr/research/computer-vision-methods-for-video-content-analysis/) - Scene detection and motion analysis
- [Motion-Grounded Video Reasoning - CVPR 2025](https://openaccess.thecvf.com/content/CVPR2025/papers/Deng_Motion-Grounded_Video_Reasoning_Understanding_and_Perceiving_Motion_at_Pixel_Level_CVPR_2025_paper.pdf) - Advanced motion understanding techniques

---

**Architecture Research:** 2026-02-04
**Confidence:** HIGH (all integration points verified against existing codebase)
**Completeness:** Comprehensive (covers encoding, filtering, audio, scoring, UI, and testing)
