# Edit Factory

## What This Is

Edit Factory is a video production platform for social media content (reels, TikTok, YouTube Shorts). Three workflows: (1) Upload-first — upload video, AI analyzes frames, selects best segments, adds TTS voiceover and subtitles. (2) Script-first — AI generates voiceover scripts from ideas, TTS creates audio with timestamps, system matches video segments to narration. (3) Product-first — parse product feeds (Google Shopping XML), auto-generate product showcase videos with Ken Burns animation, text overlays, TTS voiceover, synced subtitles, and template presets. Supports batch processing, multi-variant generation, and per-profile customization. Used personally for two online stores (Nortia.ro + second brand), each with isolated libraries and social media accounts.

## Core Value

Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos with AI-generated voiceover, perfectly synced subtitles, and matched visuals, ready to publish at scale.

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
- ✓ Platform export presets (TikTok, Reels, YouTube Shorts) — v3
- ✓ Professional encoding (CRF 18-20, medium preset, keyframe controls) — v3
- ✓ Audio 192k bitrate — v3
- ✓ Two-pass audio normalization (-14 LUFS) — v3
- ✓ Denoising filter (hqdn3d) — v3
- ✓ Sharpening filter (unsharp) — v3
- ✓ Color correction (brightness, contrast, saturation) — v3
- ✓ Blur detection scoring (Laplacian variance) — v3
- ✓ Subtitle shadow effects — v3
- ✓ Subtitle glow/outline — v3
- ✓ Adaptive subtitle sizing — v3
- ✓ ElevenLabs flash v2.5 with 192kbps audio and character timestamps — v4
- ✓ TTS-based subtitle generation from timestamps (no Whisper) — v4
- ✓ AI script generation (Gemini + Claude Max, keyword-aware) — v4
- ✓ Script-to-segment matching and video assembly — v4
- ✓ Multi-variant pipeline (1 idea → N videos) — v4
- ✓ Google Shopping XML feed parsing and product data sync — v5
- ✓ Product browser UI with search, filters, and pagination — v5
- ✓ Ken Burns zoom/pan animation on product images — v5
- ✓ Text overlays (name, price, brand, CTA, sale badge) — v5
- ✓ Romanian diacritics via FFmpeg textfile= pattern — v5
- ✓ Quick mode TTS voiceover from template text — v5
- ✓ Elaborate mode AI-generated voiceover scripts — v5
- ✓ TTS provider selection for product videos (Edge/ElevenLabs) — v5
- ✓ Synced subtitles from TTS timestamps — v5
- ✓ Configurable video duration (15-60s) — v5
- ✓ Single product video generation with progress — v5
- ✓ Batch generation with per-product error isolation — v5
- ✓ Per-product progress tracking in batch UI — v5
- ✓ 3 template presets (Spotlight, Sale Banner, Collection) — v5
- ✓ Per-profile template customization (colors, font, CTA) — v5
- ✓ Generated videos use existing encoding presets and filters — v5
- ✓ Feed creation dialog on products page — v5

### Active

(None — planning next milestone)

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
- Per-video customization in batch — defeats batch purpose; edit individually after
- Manual product entry (CSV/form) — feed is single source of truth
- Auto-publish after batch — bypasses human review; library is review layer

## Context

- Used personally to create videos for two online stores (separate brands)
- Runs on Windows/WSL development machine
- Constant iteration — code changes frequently
- Tech stack: FastAPI backend (Python), Next.js frontend (TypeScript), Supabase DB, FFmpeg
- ~35,000 LOC across Python + TypeScript
- v5 shipped: Product feed-based video generation (Google Shopping XML → product videos with templates, batch processing)
- Nortia.ro feed: ~9,987 products, Google Shopping XML format
- 5 milestones shipped: v1 (MVP), v2 (Profiles), v3 (Video Quality), v4 (Script-First), v5 (Product Videos)
- 23 phases, 59 plans executed across all milestones
- 13 backend services, 9 frontend pages, 13+ API routers
- DB migrations: 014 total (007/009 pending manual application)
- ElevenLabs Starter plan: 100k credits/month, flash v2.5 default
- Tech debt: In-memory state dicts, no job cancellation, safe_zone fields unused, unreachable dead code in batch

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
| -14 LUFS for audio normalization | Social media platform standard | ✓ Good |
| Platform presets over manual encoding | Users shouldn't configure technical settings | ✓ Good |
| hqdn3d over nlmeans for denoising | nlmeans is 10-30x slower | ✓ Good |
| Two-pass loudnorm workflow | Measure first, apply linear normalization second | ✓ Good |
| stdlib dataclass over Pydantic for configs | Simpler, no validation overhead | ✓ Good |
| Filter order: denoise -> sharpen -> color | Prevent sharpening noise artifacts | ✓ Good |
| Checkbox+slider UI pattern | Reduces visual clutter | ✓ Good |
| Laplacian variance for blur detection | Industry standard, single-pass, fast | ✓ Good |
| Subtitle params per-render (not DB) | Flexibility for A/B testing | ✓ Good |
| eleven_flash_v2_5 as default model | 50% cheaper, 32 languages, 75ms latency | ✓ Good |
| TTS timestamps over Whisper for subtitles | Perfect sync, no extra processing | ✓ Good |
| Gemini + Claude Max for script generation | Two AI providers, user chooses | ✓ Good |
| Script-first over video-first workflow | Script drives segment selection | ✓ Good |
| Google Shopping XML for product data | Standard format, already have Nortia.ro feed | ✓ Good |
| FFmpeg for product video (not Remotion) | Already have FFmpeg pipeline, no Node.js render | ✓ Good |
| lxml iterparse for feed parsing | Memory-safe 10k product parsing, no full-tree load | ✓ Good |
| textfile= pattern for Romanian diacritics | Prevents UTF-8 corruption in FFmpeg drawtext | ✓ Good |
| zoompan for Ken Burns animation | 2.3x slower than simple scale but viable for batch | ✓ Good |
| Sequential batch over asyncio.gather | Safer on WSL, avoids FFmpeg memory contention | ✓ Good |
| VideoTemplate as Python dataclass | Same proven pattern as service-level config | ✓ Good |
| CSS hex colors in DB, FFmpeg conversion at render | Clean storage, conversion is trivial | ✓ Good |
| In-memory state for pipeline/assembly | Consistent with patterns, acceptable for single-user | ⚠️ Tech debt |

---
*Last updated: 2026-02-21 after v5 Product Video Generator milestone shipped*
