# Edit Factory v2

## What This Is

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining Gemini AI video analysis, TTS voice generation, Whisper AI captions, and Postiz social media publishing. The platform is used personally to create videos for two online stores, each with its own library and social media accounts.

## Core Value

One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.

## Requirements

### Validated

- ✓ Video upload and Gemini AI frame analysis — existing
- ✓ Motion/variance scoring for segment selection — existing
- ✓ ElevenLabs TTS voice generation (paid) — existing
- ✓ Edge TTS voice generation (free) — existing
- ✓ Whisper AI caption/subtitle generation — existing
- ✓ FFmpeg video rendering with audio + subtitles — existing
- ✓ Supabase project/clip management (library) — existing
- ✓ Postiz social media publishing — existing
- ✓ Job tracking with progress polling — existing
- ✓ Cost tracking for API usage — existing
- ✓ Multi-variant clip generation (1-10 per upload) — existing
- ✓ Voice muting with Silero VAD / Demucs vocal separation — existing
- ✓ Authentication via Supabase JWT (with dev bypass) — existing

### Active

- [ ] Start script — single .bat to launch backend + frontend + open browser
- [ ] Profile/workspace system — each store has its own library, settings, and Postiz account
- [ ] TTS provider selector in UI — clear choice between ElevenLabs (paid) and Edge TTS (free)
- [ ] Per-profile Postiz configuration — separate API keys/accounts per store
- [ ] Per-profile TTS voice presets — default voice settings saved per store

### Out of Scope

- Desktop app (Electron/Tauri) — unnecessary overhead for single-user, constant-upgrade workflow
- Mobile app — web-first, personal use
- Multi-user collaboration — single user, two store profiles
- Additional paid TTS providers — focus on free options, ElevenLabs already covers paid

## Context

- Used personally to create videos for two online stores (separate brands)
- Runs on Windows/WSL development machine
- Constant iteration — code changes frequently, deploy friction is the main pain point
- Existing codebase: FastAPI backend (Python), Next.js frontend (TypeScript), Supabase DB
- Edge TTS is already integrated as free fallback but not prominently surfaced in UI
- Postiz is currently configured with a single API key globally

## Constraints

- **Platform**: Windows/WSL — start script must work in this environment
- **Tech stack**: Keep existing FastAPI + Next.js — no rewrite
- **Database**: Supabase — profiles must work within existing schema
- **Budget**: Minimize paid API usage — prefer free TTS options

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Browser + start script over desktop app | Constant upgrades need zero build overhead; desktop app adds friction per iteration | — Pending |
| Profile system over separate deployments | Two stores share same codebase, just need isolated libraries and configs | — Pending |
| Edge TTS as primary free option | Already integrated, zero cost, decent quality | — Pending |

---
*Last updated: 2026-02-03 after initialization*
