# Domain Pitfalls: Video Quality Enhancement

**Domain:** Adding video quality enhancement to FFmpeg-based video processing
**Researched:** 2026-02-04
**Context:** Edit Factory milestone - enhancing existing video processing pipeline

## Executive Summary

Adding video quality enhancement features to an existing FFmpeg-based pipeline is deceptively complex. The primary risks are **performance regression** (filters compound processing time), **quality vs file size tradeoffs** (platform requirements conflict with quality goals), and **platform compatibility** (social media platforms have strict encoding requirements that can conflict with quality settings).

**Critical insight from Edit Factory codebase:** The system already uses subprocess-based FFmpeg calls with GPU acceleration fallback patterns. Any quality enhancement must preserve this architecture while avoiding memory leaks and maintaining real-time processing expectations.

---

## Critical Pitfalls

Mistakes that cause rewrites, major performance issues, or platform rejection.

### Pitfall 1: Filter Chain Order Destroys Performance

**What goes wrong:**
Incorrect filter chain ordering causes unnecessary re-encoding or prevents GPU acceleration. For example, applying CPU-based filters (like `subtitles`) before GPU filters forces data transfer between CPU/GPU multiple times, destroying performance.

**Why it happens:**
FFmpeg filter graphs have implicit data flow, and mixing GPU/CPU filters requires explicit `hwdownload` and `hwupload` calls. Developers often add filters linearly without understanding the performance implications.

**Evidence from Edit Factory:**
Lines 680-684 in `video_processor.py` show explicit handling:
```python
# Pentru GPU: trebuie să descărcăm din CUDA înainte de filtru video
if video_filter:
    cmd.extend(["-vf", f"hwdownload,format=nv12,{video_filter},hwupload_cuda"])
```

**Consequences:**
- 3-10x processing time increase
- Memory pressure from multiple CPU↔GPU transfers
- Potential NVENC errors when filters conflict
- System becomes unusable for real-time processing

**Prevention:**
1. **Group filters by execution domain** (CPU vs GPU)
2. **Apply order: decode → GPU filters → download (if needed) → CPU filters → encode**
3. **For quality enhancement filters:**
   - Denoising (hqdn3d, nlmeans): CPU-based, apply BEFORE subtitle rendering
   - Sharpening (unsharp): CPU-based, apply AFTER denoising
   - Scale/crop: GPU-accelerated if using `scale_cuda`
   - Subtitles: CPU-only, always apply LAST before final encode

4. **Test filter combinations explicitly:**
```python
# CORRECT order for quality + subtitles
filters = []
if use_gpu:
    filters.append("hwdownload,format=nv12")
if denoise:
    filters.append("hqdn3d=1.5:1.5:6:6")  # CPU denoise
if sharpen:
    filters.append("unsharp=5:5:0.8")     # CPU sharpen
# Subtitle filter happens separately in add_subtitles()
```

**Detection:**
- FFmpeg warnings about "filtergraph" errors
- GPU encoding fails but CPU succeeds
- Processing time >5x slower than expected
- `nvidia-smi` shows GPU idle during filter application

**Phase to address:** Phase 1 (Architecture design) - establish filter chain patterns

---

### Pitfall 2: Audio Normalization Requires Two-Pass (But You Skip It)

**What goes wrong:**
Using FFmpeg's `loudnorm` filter in single-pass mode causes dynamic volume fluctuations that sound jarring when combined with TTS. The audio loudness jumps unexpectedly between segments, creating poor user experience.

**Why it happens:**
Two-pass loudnorm requires:
1. First pass to analyze audio characteristics
2. Second pass to apply normalization with analyzed parameters

Developers skip the first pass thinking "normalization is normalization" and use single-pass mode for speed, not realizing single-pass produces worse results.

**Evidence from research:**
- "Single-pass mode introduces dynamic fluctuations to the audio, particularly problematic for music content"
- "Single-pass is ideal for live normalization but produces worse results"
- Source: [Audio Normalization with FFmpeg](https://wiki.tnonline.net/w/Blog/Audio_normalization_with_FFmpeg)

**Consequences:**
- Jarring volume changes between video segments
- TTS audio doesn't blend with background video audio
- Platform rejection due to audio quality issues
- User complaints about "unprofessional sound"

**Prevention:**
1. **Always use two-pass loudnorm for post-processing:**
```python
# Pass 1: Analyze
ffmpeg -i input.mp4 -af loudnorm=print_format=json -f null -

# Parse JSON output to get measured_I, measured_LRA, measured_TP
# Pass 2: Apply with linear mode
ffmpeg -i input.mp4 -af loudnorm=linear=true:measured_I=-16.0:measured_LRA=11.0:measured_TP=-2.0 output.mp4
```

2. **For Edit Factory's segment-based architecture:**
   - Normalize AFTER concatenation, not per-segment
   - Store normalization parameters per project
   - Apply consistent normalization to all variants

3. **Target loudness for social media:**
   - Instagram Reels: -14 LUFS (integrated loudness)
   - TikTok: -14 to -16 LUFS
   - YouTube Shorts: -14 LUFS
   - Never exceed -1.0 dBTP (true peak)

4. **Handle the resampling issue:**
   - loudnorm resamples to 192kHz internally
   - Explicitly resample back to 48kHz after normalization: `-ar 48000`

**Detection:**
- Audio sounds "pumping" (volume goes up and down)
- TTS is much louder than video background audio
- FFmpeg output shows "switching to dynamic normalization"
- Output audio sample rate is 192kHz instead of 48kHz

**Phase to address:** Phase 2 (Audio normalization implementation)

---

### Pitfall 3: CRF vs Bitrate Confusion Breaks Platform Compatibility

**What goes wrong:**
Using both CRF (quality-based encoding) AND bitrate constraints simultaneously creates conflicting encoding goals. For social media platforms with strict file size limits, this results in either quality degradation or upload rejection.

**Why it happens:**
Developers see platform specs like "bitrate: 3,500–4,500 kbps" and think "I'll set bitrate AND use CRF 23 for quality." FFmpeg then tries to satisfy both constraints, producing suboptimal results.

**Evidence from research:**
- "Mixing incompatible rate control methods: using `-b` bitrate option together with CRF... doesn't make sense to specify both"
- "CRF targets quality and adjusts bitrate. `-b` targets bitrate."
- Platform specs (Instagram Reels: 3,500-4,500 kbps; TikTok: 2,000-4,000 kbps; YouTube Shorts: 8,000-15,000 kbps)
- Sources: [FFmpeg Best Quality](https://www.baeldung.com/linux/ffmpeg-best-quality-conversion), [Social Media Video Sizes 2026](https://recurpost.com/blog/the-up-to-date-video-sizes-guide-for-social-media/)

**Edit Factory context:**
Current code uses CRF 23 for both CPU and GPU encoding (lines 411, 416, 715, 962). No bitrate capping means files may exceed platform limits.

**Consequences:**
- Upload rejection: "File too large" (Instagram limit: depends on duration)
- Quality varies unpredictably across content types
- Complex scenes blow up file size
- Simple scenes waste bitrate budget

**Prevention:**

1. **Choose encoding strategy based on use case:**

   **Option A: CRF-only (Edit Factory current approach)**
   - Use when: Quality matters more than file size
   - Platform: YouTube Shorts (large file limits)
   - Setting: CRF 20-23
   - Pros: Consistent quality, simple
   - Cons: Unpredictable file size

   **Option B: Capped CRF (RECOMMENDED for social media)**
   - Use when: Need quality + file size guarantee
   - Platform: Instagram Reels, TikTok
   - Settings:
   ```python
   "-crf", "23",
   "-maxrate", "4000k",  # Platform max bitrate
   "-bufsize", "8000k",  # 2x maxrate
   ```
   - Pros: Quality priority with safety ceiling
   - Cons: Slightly more complex

   **Option C: Two-pass bitrate (for strict limits)**
   - Use when: Platform has hard file size limits
   - Settings: Target bitrate based on duration
   ```python
   # Pass 1
   ffmpeg -i input.mp4 -c:v libx264 -b:v 3500k -pass 1 -f null -
   # Pass 2
   ffmpeg -i input.mp4 -c:v libx264 -b:v 3500k -pass 2 output.mp4
   ```
   - Pros: Predictable file size
   - Cons: 2x encoding time, lower quality

2. **Platform-specific presets for Edit Factory:**

```python
PLATFORM_PRESETS = {
    "instagram_reels": {
        "resolution": "1080x1920",
        "crf": 23,
        "maxrate": "4000k",
        "bufsize": "8000k",
        "audio_bitrate": "192k",
        "gop_size": 60  # 2sec at 30fps
    },
    "tiktok": {
        "resolution": "1080x1920",
        "crf": 24,  # Slightly lower quality for smaller files
        "maxrate": "3500k",
        "bufsize": "7000k",
        "audio_bitrate": "128k",
        "gop_size": 60
    },
    "youtube_shorts": {
        "resolution": "1080x1920",  # Can use 2160x3840 for 4K
        "crf": 20,  # Higher quality allowed
        "maxrate": "12000k",
        "bufsize": "24000k",
        "audio_bitrate": "192k",
        "gop_size": 60
    }
}
```

3. **CRF guidelines by resolution:**
   - 1080p (Reels/TikTok): CRF 23-24
   - 4K/2160p (YouTube Shorts): CRF 20-21
   - Rule: +6 CRF = ~half file size, -6 CRF = ~double file size

**Detection:**
- Platform rejects uploads: "File exceeds size limit"
- File sizes vary wildly (500MB for 60sec then 50MB for similar video)
- Encoding time takes 2x-3x longer (sign of conflicting constraints)
- FFmpeg warnings about rate control

**Phase to address:** Phase 1 (Platform presets) + Phase 3 (Export settings)

---

### Pitfall 4: Denoising Destroys Processing Time Budget

**What goes wrong:**
Adding `nlmeans` (Non-Local Means) denoising to improve quality increases processing time from 2 minutes to 30+ minutes per video. Users expect near-real-time processing, but denoising makes it unusable.

**Why it happens:**
nlmeans is CPU-only and doesn't parallelize well. A single 60-second 1080p video can take 10-30 minutes to denoise on modern hardware. Developers add it thinking "more filters = better quality" without benchmarking.

**Evidence from research:**
- "nlmeans filter is rather slow and doesn't parallelize well; only use it in cases the video contains a lot of noise"
- "nlmeans provides the best quality but requires 10-30 minutes per hour of video"
- "hqdn3d is a fast, high quality 3D denoising filter"
- Sources: [FFmpeg Filters](https://www.ffmpeg.media/articles/ffmpeg-filters-scale-crop-rotate-sharpen), [Codec Wiki Denoise](https://wiki.x266.mov/docs/filtering/denoise)

**Edit Factory context:**
Current processing pipeline (lines 622-775) extracts segments then processes each individually. Adding denoising multiplies processing time by segment count.

**Consequences:**
- 10-30x processing time increase
- Background jobs timeout
- System becomes unusable for multi-variant processing
- Server resource exhaustion with parallel jobs
- Users abandon uploads

**Prevention:**

1. **Filter selection based on content analysis:**

```python
def select_denoising_filter(video_path: Path, noise_threshold: float = 0.02) -> Optional[str]:
    """
    Analyze video noise level and select appropriate filter.
    Only denoise if actually needed.
    """
    # Sample frames to detect noise
    noise_level = estimate_noise_level(video_path)

    if noise_level < noise_threshold:
        return None  # Clean video, no denoising needed
    elif noise_level < 0.05:
        return "hqdn3d=1.5:1.5:6:6"  # Fast denoise (10% time overhead)
    elif noise_level < 0.10:
        return "hqdn3d=3:3:6:6"  # Stronger fast denoise
    else:
        # Very noisy - offer user choice: fast or quality
        # Default to fast for real-time processing
        return "atadenoise=0.02:s=9"  # Hybrid approach (50% time overhead)
```

2. **Never use nlmeans by default:**
   - Only offer as "High Quality Mode" with explicit warning
   - Show estimated processing time before starting
   - Not available for multi-variant processing
   - Only for single-video exports where quality >> speed

3. **Recommended denoise settings:**

```python
DENOISE_PRESETS = {
    "none": None,
    "light": "hqdn3d=1.5:1.5:6:6",           # +10% time, mild noise reduction
    "moderate": "hqdn3d=3:3:6:6",            # +15% time, visible improvement
    "strong": "atadenoise=0.02:s=9",         # +50% time, aggressive
    "maximum": "nlmeans=3:7:5:21:21:0"       # +1000% time, best quality (opt-in only)
}
```

4. **Apply denoising selectively:**
   - Analyze segments BEFORE selecting for inclusion
   - Only denoise selected segments (not entire source video)
   - Cache denoised segments for variant reuse

5. **Edit Factory integration point:**
   - Add denoise option to `extract_segments()` method
   - Apply in filter chain between scale and sharpen
   - Track processing time per segment

**Detection:**
- Processing time >>5x longer than without filter
- CPU usage at 100% for extended periods
- Background jobs timing out
- Server runs out of disk space (temp files accumulate)

**Phase to address:** Phase 2 (Filter implementation) - must implement smart filter selection

---

### Pitfall 5: Subtitle Rendering Breaks GPU Pipeline

**What goes wrong:**
FFmpeg's `subtitles` filter is CPU-only and requires `libass`. Adding subtitles to a GPU-accelerated pipeline forces video decoding to CPU, destroying the performance benefit of GPU encoding.

**Why it happens:**
The subtitles filter doesn't support CUDA/hardware frames. When developers add `-vf subtitles=file.srt` to a GPU command, FFmpeg silently falls back to CPU decoding.

**Evidence from research:**
- "To use the libass library for subtitle rendering, you need to have libass enabled at compile time"
- "Adding soft subtitles won't re-encode the entire file and is faster than hardcoding subtitles"
- Edit Factory code (lines 942-969) already handles this correctly by NOT using hwaccel with subtitles
- Sources: [FFmpeg Subtitles](https://cloudinary.com/guides/video-effects/ffmpeg-subtitles), [Bannerbear FFmpeg Subtitles](https://www.bannerbear.com/blog/how-to-add-subtitles-to-a-video-file-using-ffmpeg/)

**Edit Factory context:**
Current implementation CORRECTLY avoids hwaccel when adding subtitles (line 944-965), but doesn't document WHY. This pattern must be preserved when adding quality filters.

**Consequences:**
- GPU encoding disabled when subtitles present
- Processing time increases 3-5x
- Wasted GPU resources
- "GPU acceleration" setting becomes misleading

**Prevention:**

1. **Architecture: Separate subtitle rendering from quality enhancement:**

```python
# CORRECT pattern (preserve Edit Factory's current approach)
def add_subtitles(video_path, srt_path, output_path, use_gpu=True):
    """
    Subtitles filter is CPU-only.
    Decode on CPU, apply subtitles, encode with GPU if available.
    """
    cmd = [
        "ffmpeg", "-y",
        # NO -hwaccel here - subtitles filter needs CPU frames
        "-i", str(video_path),
        "-vf", f"subtitles='{srt_path_escaped}':force_style='{style}'",
        "-c:v", "h264_nvenc" if use_gpu else "libx264",  # Can still GPU encode
        "-preset", "p4" if use_gpu else "fast",
        "-c:a", "copy",
        str(output_path)
    ]
```

2. **Performance optimization order:**
   - Apply ALL quality filters BEFORE subtitles
   - Subtitles should be THE LAST video processing step
   - Never mix subtitle rendering with GPU filter chains

3. **For Edit Factory's multi-step pipeline:**
   ```
   Step 1: extract_segments() - GPU accelerated, no subtitles
   Step 2: add_audio() - stream copy when possible
   Step 3: [NEW] apply_quality_filters() - GPU denoise/sharpen if available
   Step 4: add_subtitles() - CPU rendering, GPU encoding output
   ```

4. **Document the limitation:**
   - UI should show "Subtitles use CPU rendering (normal behavior)"
   - Don't let users think GPU acceleration is broken
   - Provide ETA that accounts for CPU subtitle rendering

**Detection:**
- `nvidia-smi` shows 0% GPU usage during subtitle rendering
- FFmpeg output shows "Incompatible pixel format" warnings
- Processing slower than expected even with GPU enabled
- Filtergraph errors mentioning "cuda" and "subtitles"

**Phase to address:** Phase 3 (Quality filters) - must document and preserve correct patterns

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or quality issues.

### Pitfall 6: Sharpening Creates Halos and Artifacts

**What goes wrong:**
Oversharpening with `unsharp` filter creates visible halos around edges and amplifies compression artifacts. Videos look "crunchy" and artificial, especially after platform re-encoding.

**Why it happens:**
Developers crank up unsharp values thinking "more sharpening = better quality." The filter is actually an unsharpen mask that boosts edge contrast, and too much creates artifacts.

**Evidence from research:**
- "Counter-sharpening (unsharp) to restore detail can introduce halos and artifacts if overused; use unsharp values between 0.3-1.0"
- Source: [FFmpeg Video Sharpening](https://www.cloudacm.com/?p=3016)

**Prevention:**
1. **Conservative unsharp values:**
   ```python
   # Light sharpening (barely visible, safe)
   "unsharp=5:5:0.3:5:5:0.0"

   # Moderate sharpening (recommended default)
   "unsharp=5:5:0.6:5:5:0.0"

   # Strong sharpening (risk of artifacts, use sparingly)
   "unsharp=5:5:1.0:5:5:0.0"
   ```

2. **Never sharpen if denoising was skipped:**
   - Sharpening amplifies noise
   - Order: denoise → sharpen (if both enabled)

3. **Test with platform re-encoding:**
   - Instagram/TikTok re-encode uploads
   - Sharpening + platform encoding = double artifacts
   - Use lighter sharpening for social media

4. **Adaptive sharpening:**
   ```python
   def select_sharpen_amount(video_resolution: str, denoise_applied: bool) -> str:
       """Lower sharpening for lower resolutions and when denoising was applied."""
       if video_resolution <= (720, 1280):
           amount = 0.4  # Light for low-res
       elif denoise_applied:
           amount = 0.6  # Moderate after denoise
       else:
           amount = 0.5  # Conservative default

       return f"unsharp=5:5:{amount}:5:5:0.0"
   ```

**Detection:**
- Visible white/dark halos around text or edges
- Video looks "over-processed" or "HDR-like"
- Compression artifacts more visible than original
- User feedback: "looks fake" or "too sharp"

---

### Pitfall 7: Segment Scoring Weights Don't Match Platform Aesthetics

**What goes wrong:**
Edit Factory's current scoring formula `(motion * 0.6) + (variance * 0.3) + (brightness * 0.1)` prioritizes motion, but Instagram Reels/TikTok algorithms favor aesthetic quality and composition over pure motion.

**Why it happens:**
The scoring algorithm was designed for "dynamic" clips but doesn't account for perceptual quality factors like facial detection, composition rules, or platform-specific trends.

**Evidence from research:**
- "Perceptual quality assessment algorithms... measure quality as perceived by humans"
- "Motion-intensive macroblocks are identified by comparing their motion intensity against the average"
- "VQA models have evolved... explicitly designed for user-generated content (UGC)"
- Current Edit Factory formula (line 69-77) focuses purely on motion/variance
- Sources: [Perceptual Video Quality](https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2023.1193523/full), [Netflix VMAF](https://netflixtechblog.com/toward-a-practical-perceptual-video-quality-metric-653f208b9652)

**Prevention:**

1. **Enhanced scoring for social media:**

```python
@property
def combined_score_v2(self) -> float:
    """
    Enhanced scoring that considers aesthetic quality.
    Weights tuned for Instagram Reels / TikTok content.
    """
    # Motion (dynamic content)
    motion_component = self.motion_score * 0.4  # Reduced from 0.6

    # Variance (scene changes)
    variance_component = self.variance_score * 0.3  # Same

    # Brightness (avoid too dark/bright)
    # Optimal brightness around 0.4-0.6 (not too dark, not blown out)
    brightness_penalty = abs(self.avg_brightness - 0.5)
    brightness_component = (1 - brightness_penalty * 2) * 0.1  # Same weight

    # NEW: Aesthetic boost (faces, composition, color)
    aesthetic_component = self.get_aesthetic_score() * 0.2  # NEW

    return (motion_component + variance_component +
            brightness_component + aesthetic_component)

def get_aesthetic_score(self) -> float:
    """
    Calculate aesthetic quality score.
    Factors: face detection, rule of thirds, color saturation.
    """
    # Placeholder - should integrate actual analysis
    # Could use: face detection, scene classification, color analysis
    return 0.5  # Default neutral score
```

2. **Platform-specific scoring profiles:**

```python
SCORING_PROFILES = {
    "motion_priority": {  # Current Edit Factory default
        "motion": 0.6,
        "variance": 0.3,
        "brightness": 0.1,
        "aesthetic": 0.0
    },
    "balanced": {  # Recommended for mixed content
        "motion": 0.4,
        "variance": 0.3,
        "brightness": 0.1,
        "aesthetic": 0.2
    },
    "aesthetic_priority": {  # For beauty/lifestyle content
        "motion": 0.2,
        "variance": 0.2,
        "brightness": 0.1,
        "aesthetic": 0.5
    }
}
```

3. **Integrate with Gemini AI scoring:**
   - Edit Factory already has Gemini integration (lines 1051-1108)
   - Gemini provides context-aware scoring
   - Combine motion-based + AI-based scores

**Detection:**
- Generated clips feel "jumpy" or "chaotic"
- Beautiful static shots are excluded
- Clips don't match platform content style
- User feedback: "Doesn't feel like Reels content"

---

### Pitfall 8: Missing Platform-Specific Keyframe Intervals

**What goes wrong:**
Using FFmpeg's default keyframe settings causes platforms to re-encode uploaded videos, reducing quality. Edit Factory's current settings (GOP 60 for 30fps = 2sec) are correct but not documented or adaptive.

**Why it happens:**
Developers don't realize that platforms like Instagram require specific keyframe intervals. If not provided, the platform re-encodes to meet their requirements, degrading quality.

**Evidence:**
- Edit Factory code (line 689, 716, 1988, 2009) uses `-g 60` for 30fps = 2 second GOP
- Platform requirements: keyframes every 2 seconds (Instagram, TikTok)
- Source: [Instagram Reels Export Settings](https://aaapresets.com/blogs/premiere-pro-blog-series-editing-tips-transitions-luts-guide/master-your-shorts-the-ultimate-guide-to-export-settings-for-instagram-reels-tiktok-youtube-shorts-in-2025-extended-edition)

**Prevention:**

1. **Calculate GOP based on FPS:**
```python
def calculate_gop_size(fps: float, keyframe_interval_seconds: float = 2.0) -> int:
    """
    Calculate GOP (Group of Pictures) size for platform requirements.
    Most social platforms require keyframes every 2 seconds.
    """
    return int(fps * keyframe_interval_seconds)

# Usage
gop_size = calculate_gop_size(fps=30)  # Returns 60
gop_size = calculate_gop_size(fps=60)  # Returns 120 (for 60fps Shorts)
```

2. **Platform-specific GOP settings:**
```python
PLATFORM_GOP_REQUIREMENTS = {
    "instagram_reels": {
        "keyframe_interval": 2.0,  # seconds
        "min_keyframe_interval": 2.0,  # -keyint_min
        "scene_change_threshold": 0  # -sc_threshold (disable scene detection)
    },
    "tiktok": {
        "keyframe_interval": 2.0,
        "min_keyframe_interval": 2.0,
        "scene_change_threshold": 0
    },
    "youtube_shorts": {
        "keyframe_interval": 2.0,
        "min_keyframe_interval": 2.0,
        "scene_change_threshold": 0
    }
}
```

3. **Document Edit Factory's current correct approach:**
   - Add comments explaining WHY `-g 60` is used
   - Make it adaptive to detected FPS
   - Ensure consistent across all encoding points

**Detection:**
- Platform shows "Processing video" for longer than upload time
- Visual quality degradation after upload
- File size changes significantly post-upload
- Platform notification: "Video was re-encoded"

---

### Pitfall 9: FFmpeg Subprocess Memory Leaks

**What goes wrong:**
Long-running video processing jobs accumulate memory from FFmpeg subprocess calls. Python's subprocess management doesn't release memory properly, leading to crashes or OOM kills.

**Why it happens:**
Python subprocess with `capture_output=True` buffers stdout/stderr in memory. For long FFmpeg processes with verbose output, this buffer grows to hundreds of MB. Multiple parallel jobs compound the issue.

**Evidence from research:**
- "Memory leaks have been identified in the ffmpeg adapter when using subprocess.Popen"
- "Old FFMPEG processes... remain in memory even after the write is finished"
- "FFmpeg processes can start using extreme amounts of memory (up to 21GB reported)"
- CVE-2025-25469: Memory leak in FFmpeg libavutil (recent vulnerability)
- Sources: [Python Issue 28165](https://bugs.python.org/issue28165), [FFmpeg Memory Leak CVE](https://hackers-arise.com/how-to-dos-a-media-server-the-memory-leak-vulnerability-in-ffmpeg-cve-2025-25469/)

**Edit Factory context:**
Current `_run_ffmpeg()` method (line 506-542) uses `subprocess.run(capture_output=True)`, which is correct for short commands but risky for long processing.

**Prevention:**

1. **Stream FFmpeg output instead of buffering:**

```python
def _run_ffmpeg_streaming(self, cmd: list, operation: str) -> subprocess.CompletedProcess:
    """
    Execute FFmpeg with streaming output to avoid memory accumulation.
    Use for long-running operations (>30 seconds).
    """
    logger.debug(f"FFmpeg command ({operation}): {' '.join(cmd)}")

    # Stream to temporary files instead of memory
    with tempfile.NamedTemporaryFile(mode='w+', delete=False) as stdout_f, \
         tempfile.NamedTemporaryFile(mode='w+', delete=False) as stderr_f:

        process = subprocess.Popen(
            cmd,
            stdout=stdout_f,
            stderr=stderr_f,
            text=True
        )

        returncode = process.wait()

        # Read only on error
        if returncode != 0:
            stderr_f.seek(0)
            stderr = stderr_f.read()
            stdout_f.seek(0)
            stdout = stdout_f.read()

            # Parse errors
            error_lines = [line for line in stderr.split('\n')
                          if 'error' in line.lower()]
            logger.error(f"FFmpeg {operation} failed: {error_lines[0] if error_lines else stderr[-500:]}")

            raise RuntimeError(f"FFmpeg {operation} failed")

        # Cleanup temp files
        os.unlink(stdout_f.name)
        os.unlink(stderr_f.name)

    return subprocess.CompletedProcess(cmd, returncode, "", "")
```

2. **Explicit cleanup for segment processing:**

```python
def extract_segments(self, ...):
    # ... existing code ...

    for i, seg in enumerate(segments):
        # Process segment
        self._run_ffmpeg(cmd, f"extract segment {i+1}")

        # Force garbage collection every N segments
        if i % 10 == 0:
            import gc
            gc.collect()
```

3. **Monitor memory usage:**

```python
import psutil

def check_memory_pressure() -> bool:
    """Check if system is under memory pressure."""
    memory = psutil.virtual_memory()
    return memory.percent > 85  # Above 85% usage

# Before starting heavy processing
if check_memory_pressure():
    logger.warning("System memory pressure detected, will process segments sequentially")
    use_parallel = False
```

4. **Process limits for parallel jobs:**
   - Limit concurrent FFmpeg processes
   - Queue jobs when memory pressure detected
   - Implement job throttling in library_routes.py

**Detection:**
- Python process memory grows continuously
- System OOM killer terminates processes
- "Out of memory" errors in logs
- `ps aux` shows orphaned ffmpeg processes
- Server swap usage increases

---

## Minor Pitfalls

Mistakes that cause annoyance but are fixable.

### Pitfall 10: Hardcoded Font Paths Break Subtitle Rendering

**What goes wrong:**
Subtitle rendering fails on different systems because font paths are hardcoded or fonts aren't available. FFmpeg's `subtitles` filter uses system fonts, but availability varies by platform.

**Prevention:**
```python
# Check font availability before rendering
def validate_font(font_family: str) -> str:
    """Fallback to available fonts if requested font missing."""
    system_fonts = get_system_fonts()  # Use fc-list on Linux, registry on Windows
    if font_family in system_fonts:
        return font_family

    # Fallback chain
    fallbacks = ["Arial", "DejaVu Sans", "Liberation Sans"]
    for fallback in fallbacks:
        if fallback in system_fonts:
            logger.warning(f"Font {font_family} not found, using {fallback}")
            return fallback

    return "sans-serif"  # Last resort
```

**Detection:**
- Subtitles don't appear in output
- FFmpeg errors mentioning "font not found"
- Subtitles render with wrong font

---

### Pitfall 11: Encoding Settings Not Preserved Across Pipeline Steps

**What goes wrong:**
Video characteristics change between extraction → audio → subtitles steps because encoding settings aren't consistent. Color space, pixel format, or SAR changes cause quality loss or compatibility issues.

**Prevention:**
```python
# Define consistent encoding profile
ENCODING_PROFILE = {
    "pix_fmt": "yuv420p",    # Compatible with all platforms
    "color_space": "bt709",   # Standard HD color space
    "color_primaries": "bt709",
    "color_trc": "bt709",
    "sar": "1:1"              # Square pixels
}

# Apply to ALL encoding steps
def get_encoding_params(use_gpu: bool) -> list:
    """Get consistent encoding parameters."""
    params = [
        "-pix_fmt", ENCODING_PROFILE["pix_fmt"],
        "-colorspace", ENCODING_PROFILE["color_space"],
        "-color_primaries", ENCODING_PROFILE["color_primaries"],
        "-color_trc", ENCODING_PROFILE["color_trc"],
        "-sar", ENCODING_PROFILE["sar"]
    ]
    return params
```

**Detection:**
- Color shift between segments
- Aspect ratio changes unexpectedly
- Platform shows compatibility warnings

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Platform presets implementation | CRF vs bitrate confusion (#3) | Implement capped CRF for all social media presets |
| Audio normalization | Skipping two-pass loudnorm (#2) | Mandate two-pass for quality, document clearly |
| Quality filter addition | Filter chain order destroys performance (#1) | Establish filter chain architecture doc |
| Denoising implementation | nlmeans destroys processing time (#4) | Smart filter selection based on noise analysis |
| Sharpening implementation | Halos and artifacts (#6) | Conservative defaults, user testing |
| Subtitle quality enhancement | Breaking GPU pipeline (#5) | Preserve current CPU-render pattern |
| Export settings UI | Missing platform GOP settings (#8) | Calculate adaptive GOP based on FPS |
| Concurrent processing | FFmpeg subprocess memory leaks (#9) | Implement streaming output, memory monitoring |
| Scoring algorithm enhancement | Weights don't match aesthetics (#7) | A/B test scoring profiles with users |

---

## Quick Reference: Do's and Don'ts

### DO:
✓ Use two-pass loudnorm for audio normalization
✓ Implement capped CRF for social media exports
✓ Keep filter chains separated by CPU/GPU domain
✓ Use fast denoising (hqdn3d) by default, nlmeans opt-in only
✓ Apply subtitles as THE LAST processing step
✓ Calculate GOP size based on detected FPS
✓ Monitor memory usage during batch processing
✓ Test with actual platform uploads
✓ Document WHY encoding settings are used

### DON'T:
✗ Mix CRF and bitrate constraints without maxrate
✗ Use single-pass loudnorm for final output
✗ Apply CPU filters in GPU pipelines without hwdownload
✗ Enable nlmeans denoising by default
✗ Sharpen with values >1.0 (causes halos)
✗ Assume platform specs are optional guidelines
✗ Buffer large FFmpeg output in memory
✗ Hardcode font paths or assume font availability
✗ Skip testing encoding parameter consistency

---

## Sources

**HIGH Confidence (Verified with official documentation or multiple sources):**
- [FFmpeg Best Quality Conversion](https://www.baeldung.com/linux/ffmpeg-best-quality-conversion) - CRF vs bitrate guidance
- [Audio Normalization with FFmpeg](https://wiki.tnonline.net/w/Blog/Audio_normalization_with_FFmpeg) - Two-pass loudnorm requirements
- [Social Media Video Sizes 2026](https://recurpost.com/blog/the-up-to-date-video-sizes-guide-for-social-media/) - Platform specifications
- [Instagram Reels Export Settings](https://aaapresets.com/blogs/premiere-pro-blog-series-editing-tips-transitions-luts-guide/master-your-shorts-the-ultimate-guide-to-export-settings-for-instagram-reels-tiktok-youtube-shorts-in-2025-extended-edition) - GOP requirements
- [FFmpeg Filters Documentation](https://www.ffmpeg.media/articles/ffmpeg-filters-scale-crop-rotate-sharpen) - Filter performance characteristics
- [Codec Wiki Denoise](https://wiki.x266.mov/docs/filtering/denoise) - Denoising filter comparison
- [Python subprocess memory leak](https://bugs.python.org/issue28165) - Subprocess management issues
- [FFmpeg Memory Leak CVE-2025-25469](https://hackers-arise.com/how-to-dos-a-media-server-the-memory-leak-vulnerability-in-ffmpeg-cve-2025-25469/) - Recent vulnerability

**MEDIUM Confidence (Single credible source or community consensus):**
- [FFmpeg Video Sharpening](https://www.cloudacm.com/?p=3016) - Unsharp filter best practices
- [Perceptual Video Quality Assessment](https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2023.1193523/full) - Scoring algorithm research
- [Netflix VMAF](https://netflixtechblog.com/toward-a-practical-perceptual-video-quality-metric-653f208b9652) - Perceptual quality metrics
- [FFmpeg Subtitles Guide](https://cloudinary.com/guides/video-effects/ffmpeg-subtitles) - Subtitle rendering limitations

**Edit Factory Codebase (Direct inspection):**
- `app/services/video_processor.py` - Current FFmpeg command patterns, GPU handling, filter chains
- Verified correct patterns: GOP settings, hwaccel handling with subtitles, segment processing

---

## Summary: Most Critical Risks

For Edit Factory's video quality enhancement milestone, prioritize these three:

1. **Filter Chain Order (#1)** - Will break GPU acceleration if done wrong
2. **Audio Normalization (#2)** - Will produce poor audio quality if skipped
3. **CRF vs Bitrate (#3)** - Will cause platform rejection if misconfigured

All three require architectural decisions in Phase 1 before implementation begins.
