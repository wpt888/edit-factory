# Edit Factory v3

## What This Is

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining Gemini AI video analysis, TTS voice generation, Whisper AI captions, and Postiz social media publishing. The platform is used personally to create videos for two online stores, each with its own library and social media accounts.

## Core Value

One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.

## Current Milestone: v3 Video Quality Enhancement

**Goal:** Professional-grade video output with platform-optimized encoding, audio normalization, and enhanced visual quality.

**Target features:**
- Platform-specific export presets (TikTok, Reels, YouTube Shorts)
- Professional encoding settings (CRF 18-20, slower presets, keyframes)
- Audio loudness normalization (-14 LUFS)
- Video enhancement filters (denoise, sharpen, color correction)
- Improved segment scoring with blur detection
- Enhanced subtitle rendering (shadow, glow, adaptive sizing)

## Requirements

### Validated

- ✓ Video upload and Gemini AI frame analysis — v1
- ✓ Motion/variance scoring for segment selection — v1
- ✓ ElevenLabs TTS voice generation (paid) — v1
- ✓ Edge TTS voice generation (free) — v1
- ✓ Whisper AI caption/subtitle generation — v1
- ✓ FFmpeg video rendering with audio + subtitles — v1
- ✓ Supabase project/clip management (library) — v1
- ✓ Postiz social media publishing — v1
- ✓ Job tracking with progress polling — v1
- ✓ Cost tracking for API usage — v1
- ✓ Multi-variant clip generation (1-10 per upload) — v1
- ✓ Voice muting with Silero VAD / Demucs vocal separation — v1
- ✓ Authentication via Supabase JWT (with dev bypass) — v1
- ✓ Profile/workspace system with isolated libraries — v2
- ✓ TTS provider selector (ElevenLabs, Edge, Coqui, Kokoro) — v2
- ✓ Per-profile Postiz configuration — v2
- ✓ Per-profile TTS voice presets — v2
- ✓ Start script for Windows/WSL — v2

### Active

- [ ] Platform export presets — TikTok, Reels, YouTube Shorts with optimized encoding
- [ ] Professional encoding — CRF 18-20, preset medium/slow, keyframe controls
- [ ] Audio 192k bitrate — upgrade from 128k to professional standard
- [ ] Two-pass audio normalization — -14 LUFS for social media consistency
- [ ] Denoising filter — hqdn3d for low-light footage
- [ ] Sharpening filter — unsharp for soft footage
- [ ] Color correction — brightness, contrast, saturation adjustment
- [ ] Blur detection scoring — Laplacian variance for segment quality
- [ ] Subtitle shadow effects — shadow depth for visibility
- [ ] Subtitle glow/outline — glow effect around text
- [ ] Adaptive subtitle sizing — font size based on text length

### Out of Scope

- Desktop app (Electron/Tauri) — unnecessary overhead for single-user workflow
- Mobile app — web-first, personal use
- Multi-user collaboration — single user, two store profiles
- AI video upscaling — compute-intensive with artifacts, 1080p is sufficient
- Real-time preview rendering — complex infrastructure, preview never matches final
- Video stabilization — compute-heavy, phone footage already stabilized
- VMAF/perceptual quality metrics — requires FFmpeg rebuild, defer to future
- Audio enhancement suite (noise reduction, EQ) — overlaps with TTS quality
- Lossless export — massive files, platforms compress anyway

## Context

- Used personally to create videos for two online stores (separate brands)
- Runs on Windows/WSL development machine
- Constant iteration — code changes frequently
- Existing codebase: FastAPI backend (Python), Next.js frontend (TypeScript), Supabase DB
- Current baseline: CRF 23, preset "fast", 128k audio, basic subtitles
- Target: Professional encoding matching CapCut/Descript output quality

## Constraints

- **Platform**: Windows/WSL — must work in this environment
- **Tech stack**: Keep existing FastAPI + Next.js + FFmpeg
- **Database**: Supabase — new settings must fit existing schema
- **Processing time**: Slower presets acceptable but should not 10x processing time
- **Dependencies**: Prefer FFmpeg built-in filters over external libraries

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Browser + start script over desktop app | Constant upgrades need zero build overhead | ✓ Good |
| Profile system over separate deployments | Two stores share same codebase | ✓ Good |
| Edge TTS as primary free option | Already integrated, zero cost, decent quality | ✓ Good |
| -14 LUFS for audio normalization | Social media platform standard (YouTube, Instagram, TikTok) | — Pending |
| Platform presets over manual encoding | Users shouldn't configure technical settings | — Pending |
| hqdn3d over nlmeans for denoising | nlmeans is 10-30x slower, hqdn3d is sufficient for social video | — Pending |

---
*Last updated: 2026-02-04 after milestone v3 initialization*
