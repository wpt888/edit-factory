# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining Gemini AI video analysis, ElevenLabs/Edge-TTS text-to-speech, Whisper AI caption generation, Supabase project/clip management, and Postiz social media publishing.

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
- `app/api/` - Route handlers: routes.py (video/TTS/jobs), library_routes.py (CRUD), segments_routes.py (manual selection), postiz_routes.py (publishing)
- `app/services/` - Business logic services (video_processor, gemini_analyzer, elevenlabs_tts, edge_tts_service, voice_detector, job_storage, cost_tracker, postiz_service)
- `frontend/src/app/` - Next.js App Router pages (librarie, usage, segments, statsai)
- `frontend/src/components/` - React components (Shadcn/UI)
- `frontend/src/lib/api.ts` - API client wrapper
- `CAPTIONS_AENEAS/` - Standalone Tkinter caption module with Whisper engine

### API Routes

All routes mounted under `/api/v1` prefix. Four routers:

| File | Prefix | Purpose |
|------|--------|---------|
| `routes.py` | `/api/v1` | Video processing, TTS, job status |
| `library_routes.py` | `/api/v1/library` | Project/clip CRUD, rendering, export |
| `segments_routes.py` | `/api/v1/segments` | Manual video segment selection |
| `postiz_routes.py` | `/api/v1/postiz` | Social media publishing via Postiz |

## Critical Architectural Patterns

### Authentication

- Backend uses **Supabase JWT tokens** verified in `app/api/auth.py`
- Auth is **opt-in per route** via `Depends(get_current_user)` — routes without this dependency are public
- **Development bypass**: When `auth_disabled=True` in settings, returns a hardcoded dev user without token validation
- Frontend uses Supabase Auth SDK via `AuthProvider` context — does NOT inject tokens into API calls automatically
- The `skipAuth` option exists in the API client but frontend relies on Supabase session management

### Background Job System

1. Upload endpoint creates job record in `JobStorage`, returns `job_id` immediately
2. Processing runs via `FastAPI.BackgroundTasks` (not Celery/Redis)
3. Client polls `GET /api/v1/jobs/{job_id}` for status updates
4. **JobStorage** (`app/services/job_storage.py`) uses dual persistence: Supabase primary → in-memory fallback

### Two-Phase Video Processing

1. **Raw clip generation**: Motion/variance analysis → segment scoring → selection
2. **Final rendering**: Add audio + subtitles → FFmpeg encode → output

These are separated so users can review/select clips between phases. Multi-variant generation supported (1-10 variants per upload).

### Graceful Degradation Hierarchy

Every external dependency has a fallback:
- **Gemini AI** → falls back to motion/variance scoring only
- **Supabase** → in-memory storage for jobs and costs
- **ElevenLabs TTS** → Edge TTS (free Microsoft voices)
- **Postiz / Redis** → optional, system works without them

### Service Instantiation

Services use singleton factory functions (not FastAPI Depends):
```python
processor = get_processor()
tracker = get_cost_tracker()
publisher = get_postiz_publisher()
```
`Depends()` is only used for authentication.

### Concurrency

Project-level threading locks in `library_routes.py` prevent race conditions during multi-variant processing:
```python
_project_locks: Dict[str, threading.Lock] = {}
```

### Frontend State Management

- No global state library — uses React `useState` with local component state
- Data fetched on mount via `useEffect`, filtered client-side
- Optimistic updates after mutations (`setClips(prev => ...)`)
- Library page does NOT poll jobs — it fetches final clips directly

### Progress Tracking

`_generation_progress` dict in `library_routes.py` is in-memory only — lost on server restart. Only used for real-time UI updates, not as source of truth.

## Key Technical Details

### Video Scoring

```python
combined_score = (motion * 0.6) + (variance * 0.3) + (brightness * 0.1)
```
Perceptual hashing (pHash) with Hamming distance threshold of 12 for duplicate detection.

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

Main tables:
- `projects`: id, name, description, status, target_duration, context_text
- `clips`: id, project_id, variant_index, raw_video_path, thumbnail_path, duration, is_selected, final_video_path, final_status
- `api_costs`: id, service, operation, cost, metadata (JSONB)
- `jobs`: id, job_type, status, progress, data (JSONB), created_at, updated_at

Supabase client is a lazy-initialized singleton via `get_supabase()` in library_routes.py.

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
FAL_API_KEY=...               # fal.ai TTS alternative
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
