# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining Gemini AI script generation, ElevenLabs/Edge-TTS text-to-speech, keyword-based segment matching, FFmpeg video assembly, Supabase persistence, and Postiz social media publishing.

## Related but Separate Project: blipost.com (social-scheduler)

`C:\obSID SRL\n8n\social-scheduler` is a **different codebase for a different product**. They share a brand name and nothing else — don't assume shared code, database, auth, or conventions between them. Check which directory you're in before applying a pattern learned in one to the other.

- **This repo (edit_factory)** — Electron desktop app + FastAPI backend + Next.js frontend, described above. Internal/personal tool for producing video content. Data lives in **Supabase** (`editai_*` tables), auth via **Supabase Auth**, publishing via a self-hosted **Postiz** instance. The UI was reskinned and renamed from "Edit Factory" to "Blipost" branding on 2026-07-06 — the name change is cosmetic, the stack described in this file is unaffected.
- **`../social-scheduler` ("blipost", blipost.com)** — an unrelated, from-scratch SaaS clone of Postiz/Blotato: Next.js + Drizzle ORM + **plain self-hosted PostgreSQL** (not Supabase) + **Auth.js/NextAuth** (own credentials+bcrypt auth, not Supabase Auth) + Cloudflare R2 storage + Stripe billing, plus its own AI clipping pipeline (long video → Whisper transcription → AI highlight detection → FFmpeg reframe to 9:16 → burned-in karaoke captions → scheduled multi-platform publish). Built end-to-end via an autonomous task loop tracked in its own `docs/PROGRESS.md`; as of 2026-07-06 all 35 tasks across phases 0-9 are marked DONE ("BUILD COMPLETE"), with mocked/stubbed integrations (Stripe, R2, OpenAI, real platform connectors) pending real API credentials. Its own architecture/build spec lives in `docs/build-spec.md` there — refer to that repo's docs, not this file, when working on it.

## Development Commands

### Quick Start (Recommended)

```bash
# Windows
start-dev.bat

# WSL/Linux
./start-dev.sh

# Stop all services
start-dev.bat stop  # Windows
./start-dev.sh stop # WSL/Linux
```

This launches backend (FastAPI :8000) + frontend (Next.js :3000) + opens browser automatically.

### Backend (FastAPI)

```bash
# Setup
python -m venv venv
source venv/bin/activate  # Linux/Mac (including WSL)
pip install -r requirements.txt

# Run server (auto-configures FFmpeg path)
python run.py

# Or direct uvicorn
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs at http://localhost:8000/docs (all endpoints prefixed with `/api/v1`)

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev        # Development at http://localhost:3000
npm run build      # Production build
npm run lint       # ESLint
npm run test       # All Playwright tests
npm run test:ui    # Playwright UI mode
npm run test:headed # Playwright with visible browser

# Run single test file
npx playwright test tests/library.spec.ts

# Run tests matching pattern
npx playwright test -g "library page"
```

### Captions Generator (Standalone)

```bash
cd CAPTIONS_AENEAS
python caption_ui.py
```

## Architecture

### High-Level Flow

```
Frontend (Next.js, port 3000)
  → apiPost/apiGet (frontend/src/lib/api.ts)
    → HTTP to /api/v1/* endpoints
      → FastAPI routers (app/api/*.py)
        → Services (app/services/*.py)
          → Supabase / FFmpeg / External APIs
```

### Key Directories

- `app/` - FastAPI backend (main.py entry point, config.py settings)
- `app/api/` - Route handlers (17 routers, all mounted under `/api/v1`)
- `app/services/` - Business logic services (singleton factory pattern)
- `app/repositories/` - Data access layer (Supabase primary, SQLite fallback)
- `frontend/src/app/` - Next.js App Router pages
- `frontend/src/components/` - React components (Shadcn/UI)
- `frontend/src/lib/api.ts` - API client wrapper
- `CAPTIONS_AENEAS/` - Standalone Tkinter caption module with Whisper engine

### API Routes

All routes mounted under `/api/v1` prefix. Core routers:

| File | Prefix | Purpose |
|------|--------|---------|
| `pipeline_routes.py` | `/pipeline` | **Main workflow** — multi-variant script→preview→render pipeline |
| `library_routes.py` | `/library` | Project/clip CRUD, legacy rendering, export |
| `assembly_routes.py` | `/assembly` | Script-to-video assembly service |
| `routes.py` | `/` | Video processing, TTS, job status |
| `segments_routes.py` | `/segments` | Manual video segment selection |
| `tts_routes.py` | `/tts` | TTS generation and voice management |
| `tts_library_routes.py` | `/tts-library` | Reusable TTS audio library |
| `profile_routes.py` | `/profiles` | User profile management |
| `elevenlabs_accounts_routes.py` | `/elevenlabs-accounts` | Multi-account ElevenLabs management |
| `schedule_routes.py` | `/schedule` | Smart content scheduling |
| `postiz_routes.py` | `/postiz` | Social media publishing via Postiz |
| `product_routes.py` | `/feeds` | Product feed management |
| `product_generate_routes.py` | `/products` | Product video generation |
| `catalog_routes.py` | `/catalog` | Product catalog |
| `association_routes.py` | `/associations` | Product-segment associations |
| `feed_routes.py` | `/feeds` | RSS/content feed parsing |
| `image_generate_routes.py` | `/image-gen` | AI image generation (fal.ai) |

### Multi-Variant Pipeline (Core Workflow)

The pipeline (`pipeline_routes.py` + `frontend/src/app/pipeline/page.tsx`) is the primary user-facing workflow. It runs in 4 steps:

1. **Step 1 — Script Generation**: User provides an idea/context → Gemini generates N script variants → stored in pipeline state
2. **Step 2 — TTS Generation**: Each script variant gets TTS audio (ElevenLabs or Edge-TTS) → SRT subtitles generated via Whisper timing
3. **Step 3 — Preview & Match**: SRT phrases matched to video segments by keyword → user reviews/edits timeline → can regenerate TTS per variant
4. **Step 4 — Render**: Selected variants rendered via FFmpeg → segments assembled with audio, subtitles, transitions

Pipeline state is held in-memory (`_pipelines` dict in `pipeline_routes.py`) with Supabase persistence. Each pipeline has: scripts, tts_previews, previews, render results.

**Preview caching**: Render-preview uses a fingerprint-based cache (segment IDs + merge groups + TTS mtime + interstitial slides). When TTS is regenerated, the audio file mtime changes, invalidating the cache.

### Repository Pattern (Data Access)

Database access goes through `app/repositories/`:
- `DataRepository` (ABC in `base.py`) defines the interface
- `SupabaseRepository` is the primary implementation
- `SQLiteRepository` is the fallback
- `get_repository()` factory in `factory.py` returns the active repo

Tables are prefixed with `editai_` in Supabase (e.g., `editai_segments`, `editai_pipelines`).

## Critical Architectural Patterns

### Authentication

- Backend uses **Supabase JWT tokens** verified in `app/api/auth.py`
- Auth is **opt-in per route** via `Depends(get_profile_context)` which returns a `ProfileContext` (profile_id + user_id)
- `X-Profile-Id` header selects which profile to operate under (multi-profile support)
- **Development bypass**: When `auth_disabled=True` in settings, returns a hardcoded dev user without token validation
- Frontend uses Supabase Auth SDK via `AuthProvider` context

### Background Job System

1. Upload endpoint creates job record in `JobStorage`, returns `job_id` immediately
2. Processing runs via `FastAPI.BackgroundTasks` (not Celery/Redis)
3. Client polls `GET /api/v1/jobs/{job_id}` for status updates
4. **JobStorage** (`app/services/job_storage.py`) uses dual persistence: Supabase primary → in-memory fallback

### FFmpeg Concurrency Control

Global FFmpeg concurrency is managed via `app/services/ffmpeg_semaphore.py`:
- `acquire_render_slot()` — for full renders (limited concurrent FFmpeg processes)
- `acquire_preview_slot()` — for preview renders (separate limit)
- `safe_ffmpeg_run()` — wraps subprocess calls with timeout and error handling
- `is_nvenc_available()` — detects GPU encoding support

Per-pipeline preview locks (`_preview_locks` in `pipeline_routes.py`) prevent concurrent preview renders for the same variant.

### Graceful Degradation Hierarchy

Every external dependency has a fallback:
- **Gemini AI** → falls back to motion/variance scoring only
- **Supabase** → SQLite repository fallback
- **ElevenLabs TTS** → Edge TTS (free Microsoft voices)
- **Postiz / Redis** → optional, system works without them

### Service Instantiation

Services use singleton factory functions (not FastAPI Depends):
```python
processor = get_processor()
tracker = get_cost_tracker()
assembly = get_assembly_service()
script_gen = get_script_generator()
```
`Depends()` is only used for authentication (`get_profile_context`).

### Frontend State Management

- No global state library — uses React `useState` with local component state
- Pipeline page (`frontend/src/app/pipeline/page.tsx`) is the largest component (~4500 lines), managing all 4 steps
- Data fetched on mount via `useEffect`, filtered client-side
- Optimistic updates after mutations (`setPreviews(prev => ...)`)
- `audioRef` + blob URLs for inline audio playback; `VariantPreviewPlayer` dialog for video preview

### Progress Tracking

`_generation_progress` dicts in route files are in-memory only — lost on server restart. Only used for real-time UI updates, not as source of truth.

## Key Technical Details

### Video Scoring

```python
combined_score = (motion * 0.40) + (variance * 0.20) + (blur * 0.20) + (contrast * 0.15) + (brightness_term * 0.05)
```
Where `brightness_term = 1 - 2 * abs(avg_brightness - 0.5)` (peaks at 0.5, penalizes extremes).
Perceptual hashing (pHash) with Hamming distance threshold of 8 for duplicate detection.

### Form Data Type Coercion

HTML forms send strings, so boolean parameters use string parsing:
```python
generate_audio: str = Form(default="true")
generate_audio_bool = generate_audio.lower() in ("true", "1", "yes", "on")
```

### Cost Tracking

- ElevenLabs: ~$0.22 per 1000 characters
- Gemini Vision: ~$0.02 per image analyzed
- Dual logging: Supabase `api_costs` table + local `logs/cost_log.json`

### FFmpeg

Expected at `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` or in system PATH. Both `run.py` and `app/main.py` auto-add this to PATH on startup. For WSL, ensure FFmpeg is accessible via Windows path or install Linux version.

## Database Schema (Supabase)

Main tables (prefixed `editai_` in newer tables):
- `projects`: id, name, description, status, target_duration, context_text
- `clips`: id, project_id, variant_index, raw_video_path, thumbnail_path, duration, is_selected, final_video_path, final_status
- `editai_segments`: id, source_video_id, keywords, start_time, end_time, usage_count
- `editai_pipelines`: id, profile_id, status, scripts, tts_previews, previews
- `api_costs`: id, service, operation, cost, metadata (JSONB)
- `jobs`: id, job_type, status, progress, data (JSONB), created_at, updated_at

Data access via `get_repository()` factory (returns SupabaseRepository or SQLiteRepository).

## Environment Variables

Copy `.env.example` to `.env` and configure:

**Required:**
```
GEMINI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
SUPABASE_URL=...
SUPABASE_KEY=...
```

**Optional:**
```
SUPABASE_JWT_SECRET=...       # For JWT auth validation
AUTH_DISABLED=true             # Skip auth in development
REDIS_URL=redis://localhost:6379/0
GOOGLE_DRIVE_FOLDER_ID=...
FAL_API_KEY=...               # fal.ai TTS alternative / image generation
POSTIZ_API_URL=...            # Social media publishing
POSTIZ_API_KEY=...
```

## MANDATORY: Visual Testing with Playwright

**CRITICAL RULE**: After EVERY frontend UI implementation/modification, you MUST:

1. **Take a Playwright screenshot** to verify the changes visually work
2. **Show the screenshot to the user** for validation
3. **Never assume code changes work** - always verify with actual browser rendering

### Screenshot Test Example

```typescript
import { test } from '@playwright/test';

test('Verify UI change', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/verify-feature.png', fullPage: true });
});
```

Run with: `cd frontend && npx playwright test tests/screenshot-workflow.spec.ts --reporter=list`

Test files in `frontend/tests/`, screenshots in `frontend/screenshots/`, config in `frontend/playwright.config.ts`.
