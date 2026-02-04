# Project Research Summary

**Project:** Edit Factory - Video Quality Enhancement Milestone v3
**Domain:** Social Media Video Processing (FFmpeg-based)
**Researched:** 2026-02-04
**Confidence:** HIGH

## Executive Summary

This milestone enhances Edit Factory's existing FFmpeg-based video processing pipeline with professional-grade encoding optimizations, audio normalization, and perceptual quality scoring. Research confirms that the current baseline (CRF 23, fast preset, 128k audio, basic subtitles) is functional but leaves significant quality improvement on the table. Professional tools in 2026 differentiate through platform-specific presets, loudness normalization to -14 LUFS, enhanced video filters, and perceptual quality metrics.

The recommended approach leverages Edit Factory's existing GPU-accelerated FFmpeg architecture while adding: (1) platform-specific export presets for TikTok/Reels/YouTube Shorts with capped CRF encoding, (2) two-pass audio loudnorm targeting -14 LUFS for social media, (3) smart video enhancement filters (denoise/sharpen/color correction) applied selectively based on content analysis, and (4) improved segment scoring with blur detection and contrast analysis. These enhancements can be implemented incrementally without breaking existing functionality.

The primary risks are **performance regression** from filter chains destroying GPU acceleration, **audio quality issues** from skipping two-pass normalization, and **platform rejection** from CRF/bitrate configuration errors. All three risks require careful architectural decisions in the foundation phase before implementation. The existing codebase already handles GPU/CPU filter separation correctly (line 680-684 in video_processor.py), providing a solid starting point. Critical success factor: maintain backward compatibility while introducing quality enhancements as opt-in features with smart defaults.

## Key Findings

### Recommended Stack

Edit Factory's existing FFmpeg (libx264/h264_nvenc) + OpenCV stack requires minimal additions. The core enhancement is **configuration-driven encoding presets** rather than new dependencies. Only two new libraries are recommended: `scikit-image>=0.22.0` for advanced image quality analysis (blur/contrast detection) and optionally `ffmpeg-normalize>=1.28.0` as a CLI wrapper for audio loudnorm (though direct FFmpeg implementation is preferred for control).

**Core technologies:**
- **FFmpeg libx264/h264_nvenc** (existing): Universal H.264 codec support — CRF 20-23 range for social media, capped with maxrate for platform compatibility
- **FFmpeg loudnorm filter** (new): EBU R128 audio normalization — two-pass processing targeting -14 LUFS for TikTok/Reels/YouTube Shorts
- **FFmpeg quality filters** (new): hqdn3d (denoise), unsharp (sharpen), eq (color correction) — CPU-based filters applied in correct order to avoid GPU pipeline breakage
- **scikit-image** (new): Advanced quality metrics — `is_low_contrast()` and exposure analysis for segment scoring enhancement
- **OpenCV Laplacian variance** (existing): Blur detection — lightweight perceptual quality metric (threshold: <100 = blurry, >500 = sharp)

**Platform-specific encoding (2026 standards):**
- Instagram Reels/TikTok: 1080x1920, CRF 23, maxrate 4000k, 192k audio, GOP 60 (2sec keyframes)
- YouTube Shorts: 1080x1920, CRF 21, maxrate 12000k, 192k audio, GOP 60
- All platforms: -14 LUFS loudness, yuv420p pixel format, H.264 high profile level 4.0

**Dependencies to add:**
```
scikit-image>=0.22.0          # Quality analysis (blur, contrast)
ffmpeg-normalize>=1.28.0      # Optional CLI wrapper (use direct FFmpeg preferred)
```

### Expected Features

Professional video quality enhancement in 2026 has clear table stakes vs differentiators. Edit Factory already meets baseline expectations (1080x1920 format, subtitle customization, batch processing) but is missing critical professional features.

**Must have (table stakes):**
- **Platform-specific export presets** — TikTok, Instagram Reels, YouTube Shorts have different optimal bitrates and platform algorithms favor different encoding parameters
- **Audio loudness normalization** — Social platforms normalize to -14 LUFS; unnormalized audio sounds inconsistent and platforms auto-adjust badly
- **Professional encoding settings** — CRF 18-22 with slower presets produce visibly better quality after platform re-compression (current CRF 23 is acceptable but not optimal)
- **High-quality audio encoding** — 192k AAC minimum for professional sound (current 128k is functional but below pro standard)

**Should have (competitive differentiators):**
- **Video enhancement filters** — Denoise, sharpen, color correction improve user-generated phone footage quality (especially valuable for low-light content)
- **Enhanced subtitle styling** — Shadow, glow, adaptive sizing bring Edit Factory closer to CapCut-style animated captions
- **Perceptual quality scoring** — Blur detection and contrast analysis improve segment selection beyond motion-only scoring
- **Platform-specific quality warnings** — Alert users when encoding settings may cause poor results after Instagram/TikTok compression (unique opportunity)

**Defer (v2+):**
- **Perceptual quality metrics (VMAF/SSIM)** — Objective quality measurement valuable but requires complex FFmpeg build with libvmaf
- **AI-enhanced subtitle effects** — CapCut-style word highlighting with animations (high complexity, requires word-level timing from TTS)
- **Audio enhancement suite** — Noise reduction, EQ, compression for voice clarity (overlaps with existing TTS quality)
- **Multi-pass encoding** — Two-pass bitrate encoding for strict file size limits (social media works fine with capped CRF)

**Anti-features (explicitly avoid):**
- **Real-time preview rendering** — Complex infrastructure, adds latency, preview quality never matches final output (provide accurate time estimates instead)
- **Automatic video upscaling** — AI upscaling is compute-intensive and produces artifacts (use efficient FFmpeg scale only)
- **Advanced color grading** — Professional LUTs/curves/scopes way beyond scope for automated tool (stick to basic brightness/contrast/saturation)

### Architecture Approach

The research confirms that Edit Factory's existing architecture (subprocess-based FFmpeg with GPU acceleration fallback) is sound and follows industry best practices. The quality enhancement features integrate cleanly into the existing three-layer pattern: Frontend context (Next.js) → API layer (FastAPI) → Service layer (FFmpeg execution). The critical architectural constraint is preserving GPU/CPU filter separation to avoid performance destruction.

**Major components:**

1. **Platform Preset Manager** (new, app/config.py) — Provides encoding configuration dictionaries per platform (TikTok, Reels, YouTube Shorts) with CRF, maxrate, bufsize, audio bitrate, GOP size calculated from FPS. Replaces hardcoded encoding parameters with data-driven presets.

2. **Quality Filter Chain Builder** (new, video_processor.py) — Constructs FFmpeg filter strings in correct order: hwdownload (GPU→CPU) → denoise (hqdn3d) → sharpen (unsharp) → color correction (eq) → subtitles. Enforces CPU-before-GPU separation to maintain hardware acceleration benefits.

3. **Audio Normalization Service** (new, video_processor.py) — Two-pass loudnorm implementation: (1) analyze audio to get measured_I/LRA/TP values, (2) apply linear normalization with measured parameters. Operates on concatenated segments, not per-segment, for consistent loudness.

4. **Enhanced Segment Scorer** (enhanced, video_processor.py) — Extends existing VideoSegment dataclass with blur_score (Laplacian variance) and contrast_score (std deviation). Updated combined_score formula: motion 40% + variance 20% + blur 20% + contrast 15% + brightness balance 5% (reduced motion weight from 60% to account for aesthetic quality).

5. **FFmpeg Subprocess Manager** (enhanced, video_processor.py) — Stream FFmpeg output to temp files instead of memory buffering for long operations (>30sec) to prevent memory leaks. Add garbage collection triggers every 10 segments in batch processing.

**Critical pattern preservation:**
- Existing code CORRECTLY avoids hwaccel when adding subtitles (lines 944-965) because subtitles filter is CPU-only — this pattern must be preserved and documented
- GPU filter chains require explicit hwdownload/hwupload_cuda calls (lines 680-684) — quality filters must follow this pattern
- Segment-based processing with project-level threading locks prevents race conditions — maintain this for quality-enhanced variants

### Critical Pitfalls

Research identified five critical pitfalls that will cause rewrites or major issues if not addressed architecturally in Phase 1.

1. **Filter Chain Order Destroys Performance** — Incorrect ordering forces multiple CPU↔GPU transfers, causing 3-10x processing time increase. **Prevention:** Group filters by execution domain (GPU vs CPU), apply order decode → GPU filters → hwdownload → CPU filters (denoise/sharpen) → subtitles (last) → encode. Test that GPU encoding still works after filter additions.

2. **Audio Normalization Requires Two-Pass (But Developers Skip It)** — Single-pass loudnorm causes dynamic volume fluctuations that sound jarring with TTS. **Prevention:** Always use two-pass: analyze to get measured parameters, then apply linear normalization. Normalize AFTER segment concatenation (not per-segment) for consistency across variants.

3. **CRF vs Bitrate Confusion Breaks Platform Compatibility** — Using both CRF and bitrate constraints simultaneously produces suboptimal results or platform rejection. **Prevention:** Use "capped CRF" strategy: `-crf 23 -maxrate 4000k -bufsize 8000k` provides quality priority with safety ceiling. Never mix CRF with `-b:v` bitrate target.

4. **Denoising Destroys Processing Time Budget** — nlmeans denoise filter can increase processing from 2 minutes to 30+ minutes per video. **Prevention:** Use fast hqdn3d filter by default (10-15% overhead), only offer nlmeans as opt-in "High Quality Mode". Apply denoising selectively based on noise level analysis, not to all content.

5. **Subtitle Rendering Breaks GPU Pipeline** — Subtitles filter is CPU-only and disables GPU acceleration if mixed with GPU filters. **Prevention:** Preserve Edit Factory's existing pattern of applying subtitles separately without hwaccel (current implementation is CORRECT). Subtitles must be the final processing step after all quality filters.

## Implications for Roadmap

Based on research findings, the milestone naturally divides into three phases: (1) encoding foundation with platform presets and audio normalization, (2) quality enhancement filters with smart application logic, and (3) perceptual scoring improvements. This ordering follows dependency chains from ARCHITECTURE.md and avoids critical pitfalls from PITFALLS.md.

### Phase 1: Professional Encoding Foundation
**Rationale:** Platform presets and audio normalization are table stakes for professional output (FEATURES.md) and have minimal implementation complexity while delivering immediate quality improvements. These foundational changes establish encoding patterns that Phase 2 quality filters will build upon.

**Delivers:**
- Platform-specific export presets (TikTok, Reels, YouTube Shorts) with correct CRF/maxrate/GOP settings
- Two-pass audio loudnorm targeting -14 LUFS for social media
- Encoding configuration system in app/config.py
- Updated video_processor.py encoding methods with preset support

**Addresses:**
- Table stakes: Platform-specific export presets, audio loudness normalization, professional encoding settings
- Missing features: 192k audio bitrate, adaptive GOP size based on FPS

**Avoids:**
- Pitfall #3: CRF vs bitrate confusion (implements capped CRF strategy)
- Pitfall #8: Missing platform keyframe intervals (calculates GOP from FPS)

**Stack elements:**
- FFmpeg loudnorm filter (two-pass)
- Platform preset configuration dictionaries
- No new dependencies required

**Implementation complexity:** LOW (parameter tuning + config additions)
**Research needs:** SKIP — platform specs well-documented, FFmpeg loudnorm official docs sufficient

### Phase 2: Quality Enhancement Filters
**Rationale:** After encoding foundation is solid, add optional quality filters (denoise/sharpen/color) that enhance user-generated content. These must be implemented with smart defaults to avoid pitfall #4 (performance destruction). Depends on Phase 1 establishing correct filter chain architecture.

**Delivers:**
- Filter chain builder with correct CPU/GPU separation
- Smart denoise filter selection based on noise level analysis (hqdn3d default, nlmeans opt-in)
- Conservative sharpening presets (unsharp 0.3-0.6 range to avoid halos)
- Basic color correction (brightness/contrast/saturation adjustments)
- Streaming FFmpeg output to prevent memory leaks

**Addresses:**
- Differentiator: Video enhancement filters improve phone footage quality
- Performance: Memory leak prevention for long operations

**Avoids:**
- Pitfall #1: Filter chain order destroys performance (enforces correct ordering)
- Pitfall #4: Denoising destroys processing time (smart filter selection)
- Pitfall #6: Sharpening creates halos (conservative defaults)
- Pitfall #9: FFmpeg subprocess memory leaks (streaming output)

**Stack elements:**
- FFmpeg filters: hqdn3d, unsharp, eq
- Noise level estimation (OpenCV)
- Subprocess streaming output pattern

**Implementation complexity:** MEDIUM (filter chain logic + performance testing)
**Research needs:** MODERATE — filter parameter tuning requires testing on sample content, performance benchmarking needed

### Phase 3: Perceptual Quality Scoring
**Rationale:** Improve segment selection algorithm to consider aesthetic quality beyond just motion. This builds on existing scoring system and integrates with Gemini AI analysis already present in codebase. Least critical for launch but high user-facing value.

**Delivers:**
- Enhanced VideoSegment dataclass with blur_score and contrast_score fields
- Blur detection using OpenCV Laplacian variance (threshold-based filtering)
- Contrast analysis using std deviation (low-contrast segment rejection)
- Updated scoring formula balancing motion/variance/quality/aesthetics
- Integration with existing Gemini AI scoring

**Addresses:**
- Differentiator: Perceptual quality metrics improve selection accuracy
- Feature gap: Current motion-only scoring doesn't match platform aesthetics

**Avoids:**
- Pitfall #7: Scoring weights don't match platform aesthetics (balances motion with quality)

**Stack elements:**
- scikit-image for advanced quality metrics
- OpenCV Laplacian variance (existing)
- Enhanced scoring algorithm

**Implementation complexity:** MEDIUM (scoring algorithm changes + validation)
**Research needs:** MODERATE — scoring weight tuning requires A/B testing with real content, platform aesthetic research ongoing

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Encoding presets must be established before adding filters because filter chains depend on knowing target platform constraints (GOP size, bitrate caps affect filter selection)
- **Phase 2 before Phase 3:** Quality filters improve segment appearance, which then gets scored by Phase 3's enhanced algorithm (logical dependency)
- **Phase 3 deferrable:** Existing motion-based scoring is functional; quality scoring is enhancement not blocker
- **Subtitle improvements span phases:** Shadow/glow styling can be added in Phase 1 (low-hanging fruit), animated word highlighting deferred to v4+ (high complexity)

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** Filter parameter tuning needs empirical testing on diverse content (low-light, high-motion, static beauty shots). Current research provides starting values but production tuning requires real user content analysis.
- **Phase 3:** Scoring algorithm weights need A/B testing with platform performance data (which clips get better engagement). Academic research provides direction but Edit Factory-specific tuning needed.

Phases with standard patterns (skip research-phase):
- **Phase 1:** Platform encoding specs are well-documented (official Instagram/TikTok/YouTube docs), FFmpeg loudnorm is established standard with clear implementation guidance. Straightforward configuration task.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Official FFmpeg documentation + verified Python library compatibility. Platform specs from multiple 2026 sources cross-checked. Minimal new dependencies reduces risk. |
| Features | **HIGH** | Table stakes vs differentiators clear from competitive analysis (CapCut, Descript, Premiere). Anti-features well-established through industry pitfalls. Feature priority validated with user-facing value. |
| Architecture | **HIGH** | Existing Edit Factory patterns examined directly (video_processor.py lines verified). Proposed changes integrate cleanly without breaking existing functionality. GPU/CPU separation pattern already proven in codebase. |
| Pitfalls | **HIGH** | Critical pitfalls verified through official docs + CVE database + codebase inspection. Performance numbers from benchmarked sources. Current code already avoids most pitfalls (subtitle handling, GOP settings). |

**Overall confidence:** **HIGH**

Research based on official FFmpeg documentation, recent 2026 platform specifications, and direct codebase inspection. All recommendations preserve existing functionality while adding opt-in enhancements. No speculative technologies or unproven patterns.

### Gaps to Address

Minor gaps requiring validation during implementation:

- **Filter parameter optimal values:** Research provides starting values (hqdn3d 1.5-3, unsharp 0.3-0.6) but production values need tuning on Edit Factory's actual user content. **Mitigation:** Implement conservative defaults in Phase 2, expose as user-configurable presets for power users, collect metrics to tune in v3.1.

- **Platform specs change frequency:** Social media platforms update encoding requirements periodically. TikTok/Instagram specs researched from January 2026 sources may drift. **Mitigation:** Version presets in code with date/source comments, implement telemetry to detect platform rejection patterns, plan quarterly spec review.

- **Scoring algorithm aesthetic weights:** Proposed 40/20/20/15/5 split (motion/variance/blur/contrast/brightness) is research-based but not validated on Edit Factory's specific user base. **Mitigation:** Implement as configurable scoring profiles in Phase 3, A/B test with subset of users, validate with platform engagement metrics.

- **GPU filter acceleration:** Research confirms hqdn3d and unsharp are CPU-only, but Edit Factory uses h264_nvenc which may support some CUDA filters. **Mitigation:** Test GPU-accelerated equivalents (scale_cuda verified working in code), benchmark performance, document GPU vs CPU filter capabilities.

## Sources

### Primary (HIGH confidence)

**Official Documentation:**
- FFmpeg Official Filters Documentation (https://ffmpeg.org/ffmpeg-filters.html) — loudnorm, hqdn3d, unsharp, eq filter syntax and parameters
- FFmpeg CRF Guide (https://slhck.info/video/2017/02/24/crf-guide.html) — constant rate factor encoding best practices
- EBU R128 Standard — audio loudness normalization specification (-14 LUFS for social media)

**Edit Factory Codebase (Direct Inspection):**
- app/services/video_processor.py lines 506-542 — FFmpeg subprocess execution patterns
- app/services/video_processor.py lines 680-684 — GPU filter chain handling (hwdownload/hwupload_cuda)
- app/services/video_processor.py lines 944-965 — Subtitle rendering without hwaccel (correct pattern)
- app/services/video_processor.py lines 69-77 — Current segment scoring algorithm

**Platform Specifications (2026):**
- Master Your Shorts: Export Settings for Reels, TikTok & YouTube Shorts 2026 (https://aaapresets.com) — verified bitrate/CRF/GOP requirements
- Instagram Video Format Specs 2026 (https://socialrails.com) — resolution and encoding constraints
- LUFS Social Media Standards (https://starsoundstudios.com) — -14 LUFS target for all major platforms

### Secondary (MEDIUM confidence)

**FFmpeg Best Practices:**
- FFmpeg Compress Video Guide (https://cloudinary.com/guides/video-effects/ffmpeg-compress-video) — encoding optimization techniques
- FFmpeg for Instagram (https://dev.to/alfg/ffmpeg-for-instagram-35bi) — platform-specific settings
- Audio Loudness Normalization with FFmpeg (https://medium.com/@peter_forgacs) — two-pass loudnorm implementation

**Quality Analysis:**
- Blur Detection with OpenCV (https://pyimagesearch.com/2015/09/07/blur-detection-with-opencv/) — Laplacian variance threshold methodology
- Detecting Low Contrast Images (https://pyimagesearch.com/2021/01/25/detecting-low-contrast-images-with-opencv-scikit-image-and-python/) — scikit-image usage patterns
- Perceptual Video Quality Assessment Survey (https://arxiv.org/html/2402.03413v1) — academic foundation for scoring algorithms

**Performance and Pitfalls:**
- FFmpeg Memory Leak CVE-2025-25469 (https://hackers-arise.com) — recent vulnerability documentation
- Codec Wiki Denoise Filters (https://wiki.x266.mov/docs/filtering/denoise) — nlmeans vs hqdn3d performance comparison
- Python subprocess Issue 28165 (https://bugs.python.org/issue28165) — memory buffering problems

### Tertiary (LOW confidence)

**Competitive Analysis:**
- CapCut vs Descript Comparison 2026 (https://www.fahimai.com) — feature landscape understanding
- AI Video Editor Trends 2026 (https://metricool.com) — industry direction
- Best AI Video Enhancers 2026 (https://wavespeed.ai) — competitive differentiation

**Note:** Tertiary sources used for feature landscape context only. All technical implementation recommendations based on primary sources (official docs + codebase inspection).

---
*Research completed: 2026-02-04*
*Ready for roadmap: YES*
