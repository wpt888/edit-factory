# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Edit Factory is a video processing platform for social media content creators (reels, TikTok, YouTube Shorts). It automates video production by combining:
- **Gemini AI** video analysis and scene detection
- **ElevenLabs/Edge-TTS** text-to-speech with voice cloning
- **Whisper AI** caption generation
- **Supabase** project/clip library management
- **Postiz** social media publishing integration

## Development Commands

### Backend (FastAPI)

```bash
# Setup
python -m venv venv
source venv/bin/activate  # Linux/Mac (including WSL)
.\venv\Scripts\activate   # Windows CMD/PowerShell
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

### Captions Generator (Standalone Tkinter UI)

```bash
cd CAPTIONS_AENEAS
python caption_ui.py
# or Start_Simple.bat on Windows
```

## Architecture

```
edit_factory/
├── app/                          # FastAPI Backend
│   ├── main.py                   # Entry point
│   ├── config.py                 # Settings (pydantic-settings)
│   ├── models.py                 # Pydantic models
│   ├── api/
│   │   ├── routes.py             # Video/TTS/job endpoints
│   │   ├── library_routes.py     # Project/clip CRUD endpoints
│   │   ├── segments_routes.py    # Manual segment selection endpoints
│   │   └── postiz_routes.py      # Social media publishing endpoints
│   └── services/
│       ├── video_processor.py    # Core video analysis (motion, variance, phash)
│       ├── gemini_analyzer.py    # Gemini Vision API integration
│       ├── elevenlabs_tts.py     # Premium TTS with voice cloning
│       ├── edge_tts_service.py   # Microsoft TTS fallback
│       ├── voice_detector.py     # Silero VAD for voice detection
│       ├── silence_remover.py    # Audio silence removal
│       ├── cost_tracker.py       # ElevenLabs/Gemini cost logging
│       ├── keyword_matcher.py    # Clip search/filter
│       ├── job_storage.py        # Background job state management
│       ├── srt_validator.py      # SRT subtitle validation
│       └── postiz_service.py     # Postiz API integration
│
├── frontend/                     # Next.js App Router (React 19, Tailwind v4)
│   └── src/
│       ├── app/                  # Pages: library, usage, segments, statsai
│       └── components/           # React components (Shadcn/UI)
│
├── CAPTIONS_AENEAS/              # Standalone Caption Module
│   ├── caption_ui.py             # Tkinter GUI
│   ├── dynamic_captions.py       # Whisper transcription engine
│   ├── caption_preview.py        # Preview tool
│   └── text_correction.py        # Grammar correction
│
├── scripts/                      # Utility scripts
├── run.py                        # Server launcher (adds FFmpeg to PATH)
├── input/                        # Input videos
├── output/                       # Processed videos
└── ffmpeg/                       # Local FFmpeg binary
```

## Key Technical Details

### Video Scoring Algorithm

```python
combined_score = (motion * 0.6) + (variance * 0.3) + (brightness * 0.1)
```
- Perceptual hashing (pHash) with Hamming distance threshold of 12 for duplicate detection

### API Cost Tracking

- ElevenLabs: ~$0.22 per 1000 characters
- Gemini Vision: ~$0.02 per image analyzed
- Costs logged to Supabase `api_costs` table

### Caption Presets

- TikTok: 1 word per caption
- YouTube: 2 words per caption
- Standard: 3 words per caption
- Export formats: SRT, VTT, JSON, CSV

## Database Schema (Supabase)

Main tables:
- `projects`: id, name, description, status, target_duration, context_text
- `clips`: id, project_id, variant_index, raw_video_path, thumbnail_path, duration, is_selected, final_video_path, final_status
- `api_costs`: id, service, operation, cost, metadata (tracks ElevenLabs/Gemini costs)
- `jobs`: id, job_type, status, progress, data (JSONB), created_at, updated_at (background job tracking)

**Job Storage**: Uses Supabase for persistent job tracking with automatic fallback to in-memory storage if Supabase is unavailable (`app/services/job_storage.py`).

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
REDIS_URL=redis://localhost:6379/0
GOOGLE_DRIVE_FOLDER_ID=...
FAL_API_KEY=...              # fal.ai TTS alternative
POSTIZ_API_URL=...           # Social media publishing
POSTIZ_API_KEY=...
```

## FFmpeg

FFmpeg is expected at `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` or in system PATH. Both `run.py` and `app/main.py` auto-configure this path on startup. For WSL environments, ensure FFmpeg is accessible via the Windows path or install the Linux version.

## API Routes Structure

All routes are under `/api/v1` prefix. Route files in `app/api/`:

| File | Prefix | Purpose |
|------|--------|---------|
| `routes.py` | `/api/v1` | Video processing, TTS, job status endpoints |
| `library_routes.py` | `/api/v1/library` | Project/clip CRUD, rendering, export |
| `segments_routes.py` | `/api/v1/segments` | Manual video segment selection |
| `postiz_routes.py` | `/api/v1/postiz` | Social media publishing via Postiz |

## MANDATORY: Visual Testing with Playwright

**CRITICAL RULE**: After EVERY frontend UI implementation/modification, you MUST:

1. **Take a Playwright screenshot** to verify the changes visually work
2. **Show the screenshot to the user** for validation
3. **Never assume code changes work** - always verify with actual browser rendering

### Quick Playwright Test Template

```bash
cd frontend
npx playwright test tests/screenshot-workflow.spec.ts --reporter=list
```

### Screenshot Test Example

```typescript
import { test } from '@playwright/test';

test('Verify UI change', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Navigate to the feature you implemented
  // ...

  await page.screenshot({
    path: 'screenshots/verify-feature.png',
    fullPage: true
  });
});
```

### Why This Is Mandatory

- Code that compiles doesn't mean it renders correctly
- React state issues, CSS problems, and conditional rendering bugs are NOT caught by build
- Visual verification catches issues before user reports them
- Screenshots provide proof that implementation works

### Test Files Location

- `frontend/tests/` - All Playwright test files
- `frontend/screenshots/` - Visual verification screenshots
- `frontend/playwright.config.ts` - Playwright configuration

**DO NOT skip this step. If you implement UI changes without Playwright verification, you are likely introducing bugs that will need to be fixed later.**
