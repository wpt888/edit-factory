# Edit Factory

## What This Is

Edit Factory is a script-first video production platform for social media content (reels, TikTok, YouTube Shorts). Given an idea and product context, AI generates multiple voiceover scripts, ElevenLabs creates TTS audio with precise timestamps, the system matches keyword-tagged video segments to the narration, and assembles complete videos with synced subtitles. Supports multi-variant generation (one idea → N unique videos). Used personally for two online stores, each with isolated libraries and social media accounts.

## Core Value

Script-first video production: describe an idea, get multiple social-media-ready videos with AI-generated voiceover, perfectly synced subtitles, and keyword-matched visuals — ready to publish.

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

### Active

(No active requirements — start `/gsd:new-milestone` to define next milestone)

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
- Tech stack: FastAPI backend (Python), Next.js frontend (TypeScript), Supabase DB, FFmpeg
- ~30,000 LOC across Python + TypeScript
- v4 shipped: Script-first pipeline with AI scripts, TTS timestamps, auto-subtitles, segment matching, multi-variant generation
- v3 baseline: CRF 18-20, preset medium, 192k audio, -14 LUFS normalization, video filters, enhanced subtitles
- 8 backend services: encoding_presets, audio_normalizer, video_filters, subtitle_styler, script_generator, assembly_service, tts_subtitle_generator, pipeline_routes
- 6 frontend pages: Library, Pipeline, Scripts, Assembly, Segments, Usage/Stats
- 9 API endpoints across 3 new routers (script, assembly, pipeline) + existing 4 routers
- ElevenLabs Starter plan: 100k credits/month, flash v2.5 default at 0.5 credits/char
- DB migrations: 009 (TTS timestamps) pending manual application
- Tech debt: In-memory state dicts (pipeline, assembly, generation), no job cancellation, exact keyword matching only

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
| -14 LUFS for audio normalization | Social media platform standard (YouTube, Instagram, TikTok) | ✓ Good |
| Platform presets over manual encoding | Users shouldn't configure technical settings | ✓ Good |
| hqdn3d over nlmeans for denoising | nlmeans is 10-30x slower, hqdn3d sufficient for social video | ✓ Good |
| Two-pass loudnorm workflow | Measure first, apply linear normalization second for precision | ✓ Good |
| stdlib dataclass over Pydantic for filters | Simpler, no validation overhead for nested configs | ✓ Good |
| Filter order: denoise -> sharpen -> color | Prevent sharpening noise artifacts | ✓ Good |
| Checkbox+slider UI pattern | Reduces visual clutter, sliders only visible when enabled | ✓ Good |
| Laplacian variance for blur detection | Industry standard, single-pass, fast | ✓ Good |
| 5-factor scoring weights 40/20/20/15/5 | Balanced scoring, no single factor dominates | — Pending A/B testing |
| Subtitle params per-render (not DB) | Flexibility for A/B testing, consistent with filter approach | ✓ Good |

| eleven_flash_v2_5 as default model | 50% cheaper (0.5 credits/char), 32 languages, 75ms latency, 40k char limit | ✓ Good |
| TTS timestamps over Whisper for subtitles | Perfect sync with voiceover, no extra processing step | ✓ Good |
| Gemini + Claude Max for script generation | Two AI providers, user chooses per project | ✓ Good |
| Script-first over video-first workflow | Script drives segment selection and assembly | ✓ Good |
| Keyword substring matching for segments | Exact word=1.0, substring=0.7 confidence scoring | ✓ Good |
| In-memory state for pipeline/assembly | Consistent with existing patterns, acceptable for single-user | ⚠️ Tech debt |
| Preview-before-render workflow | Avoids expensive render until user confirms matches | ✓ Good |
| Manual SRT generation (no external lib) | Zero dependencies for timestamp-to-SRT conversion | ✓ Good |

---
*Last updated: 2026-02-12 after v4 Script-First Pipeline milestone shipped*
