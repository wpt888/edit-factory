# Technology Stack

**Analysis Date:** 2026-02-03

## Languages

**Primary:**
- Python 3.12 - FastAPI backend (video processing, AI integrations)
- TypeScript 5.x - Next.js frontend (React 19 UI, SSR)
- JavaScript/Node.js v24.12.0 - Frontend build and testing

**Secondary:**
- SRT/VTT - Caption/subtitle formats
- JSON - Configuration and data interchange

## Runtime

**Environment:**
- Python 3.12.3 - Backend execution
- Node.js v24.12.0 - Frontend/build tooling
- FFmpeg (local binary or system PATH) - Video processing

**Package Manager:**
- pip - Python dependencies
- npm - Node.js dependencies (including Playwright test runner)
- Lockfile: `frontend/package-lock.json` (present)

## Frameworks

**Core:**
- FastAPI 0.104.0+ - Web framework for REST API (`app/main.py`)
- Uvicorn 0.24.0+ - ASGI server (with hot reload support)
- Next.js 16.1.1 - React meta-framework with App Router (`frontend/src/app`)
- React 19.2.1 - UI component library

**Testing:**
- Playwright 1.57.0+ - E2E/visual testing (`frontend/tests/`, `frontend/playwright.config.ts`)
- Pytest - Implied but not in requirements (API testing patterns)

**Build/Dev:**
- Tailwind CSS 4 - Utility-first CSS framework (`frontend/postcss.config.mjs`)
- TypeScript 5.x - Type checking for frontend
- ESLint 9 - Code linting (Next.js config)
- PostCSS 4 - CSS processing with `@tailwindcss/postcss`

## Key Dependencies

**Critical:**

- `google-genai` 0.2.0+ - Gemini Vision API for video scene detection and analysis (`app/services/gemini_analyzer.py`)
- `httpx` 0.25.0+ - Async HTTP client for API calls (ElevenLabs, Postiz)
- `supabase` 2.0.0+ - PostgreSQL database and auth (`app/api/library_routes.py`, `app/services/cost_tracker.py`, `app/services/job_storage.py`)
- `PyJWT` 2.8.0+ - JWT token verification for Supabase auth (`app/api/auth.py`)

**Video Processing:**

- `opencv-python-headless` 4.8.0+ - Computer vision (frame extraction, hashing)
- `scenedetect[opencv]` 0.6.0+ - Scene cut detection
- `numpy` 1.24.0+ - Numerical arrays for video processing
- `scipy` 1.11.0+ - Scientific computing (variance, brightness analysis)

**Audio & Speech:**

- `openai-whisper` 20231117+ - Speech-to-text (caption generation) (`app/services/`)
- `edge-tts` 6.1.0+ - Microsoft Edge TTS (free, fallback TTS) (`app/services/edge_tts_service.py`)
- `torch` 2.0.0+ - PyTorch for Silero VAD
- `torchaudio` 2.0.0+ - Audio processing with PyTorch
- `aiofiles` 23.0.0+ - Async file I/O

**Background Jobs:**

- `celery` 5.3.0+ - Distributed task queue (referenced in requirements)
- `redis` 5.0.0+ - In-memory cache/broker for Celery (`app/config.py` redis_url config)

**Frontend UI:**

- `@supabase/supabase-js` 2.89.0+ - Client-side Supabase auth and DB access
- `@supabase/ssr` 0.8.0+ - Server-side rendering helpers for Supabase
- Radix UI components - Accessible component library (@radix-ui/react-*)
- `sonner` 2.0.7+ - Toast notifications
- `lucide-react` 0.556.0+ - Icon library
- `embla-carousel-react` 8.6.0+ - Carousel component
- `react-resizable-panels` 4.2.1+ - Draggable panel layout
- Shadcn/UI - Component collection (Tailwind + Radix UI)
- `clsx` 2.1.1 - Class name utility
- `tailwind-merge` 3.4.0 - Merge Tailwind classes
- `class-variance-authority` 0.7.1 - CSS-in-JS variants

**Optional/Optional Dependencies:**

- `google-api-python-client` 2.100.0+ - Google Drive integration (optional)
- `google-auth-oauthlib` 1.1.0+ - OAuth for Google Drive (optional)
- `python-multipart` 0.0.6+ - Form data parsing (file uploads)
- `python-dotenv` 1.0.0+ - Environment variable loading
- `tqdm` 4.65.0+ - Progress bars
- `pydantic` 2.5.0+ - Data validation
- `pydantic-settings` 2.1.0+ - Environment configuration
- Lightning CSS `lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl` 1.30.2+ - Optional CSS compiler

## Configuration

**Environment:**

**Backend (`.env` at project root):**
- `GEMINI_API_KEY` - Google Gemini API key (required)
- `ELEVENLABS_API_KEY` - ElevenLabs TTS API key (required)
- `ELEVENLABS_VOICE_ID` - ElevenLabs voice ID (required)
- `SUPABASE_URL` - Supabase project URL (required)
- `SUPABASE_KEY` - Supabase anon key (required)
- `SUPABASE_JWT_SECRET` - JWT secret for token verification (required for auth)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin operations (optional)
- `ALLOWED_ORIGINS` - CORS allowed origins (default: `http://localhost:3000,http://localhost:3001,https://editai.obsid.ro`)
- `HOST` - Server host (default: `0.0.0.0`)
- `PORT` - Server port (default: `8000`)
- `DEBUG` - Debug mode (default: `true`)
- `INPUT_DIR` - Input video directory (default: `./input`)
- `OUTPUT_DIR` - Output video directory (default: `./output`)
- `LOGS_DIR` - Logs directory (default: `./logs`)
- `REDIS_URL` - Redis connection URL (optional, default: `redis://localhost:6379/0`)
- `GEMINI_MODEL` - Gemini model name (default: `gemini-2.5-flash`)
- `ELEVENLABS_MODEL` - ElevenLabs model (default: `eleven_multilingual_v2`)
- `POSTIZ_API_URL` - Postiz API endpoint (optional)
- `POSTIZ_API_KEY` - Postiz API key (optional)
- `FAL_API_KEY` - Fal.ai TTS alternative (optional)
- `GOOGLE_DRIVE_FOLDER_ID` - Google Drive folder for uploads (optional)
- `GOOGLE_CREDENTIALS_PATH` - Path to Google service account JSON (optional)

**Frontend (`.env.local` in `frontend/`):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (required)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key (required)
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: `http://localhost:8000/api/v1`)

**Build Configuration:**

- `app/config.py` - Pydantic Settings configuration (FastAPI)
- `frontend/tsconfig.json` - TypeScript compiler configuration
- `frontend/next.config.ts` - Next.js build config (standalone output for Docker)
- `frontend/eslint.config.mjs` - ESLint rules
- `frontend/postcss.config.mjs` - PostCSS plugins (Tailwind CSS)
- `frontend/playwright.config.ts` - Playwright test configuration

## Platform Requirements

**Development:**

- Python 3.12+
- Node.js 18+ (v24.12.0 recommended)
- FFmpeg binary (auto-configured from `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` or system PATH)
- Redis (optional, for Celery queue)
- Virtual environment (`python -m venv`)

**Production:**

- Docker container deployment (Next.js configured with `output: "standalone"`)
- Python 3.12 runtime
- Node.js 18+ for Next.js runtime
- FFmpeg binary or Docker image with FFmpeg
- Supabase PostgreSQL database
- API keys for Gemini, ElevenLabs
- HTTPS/SSL (custom domain: `editai.obsid.ro`)

---

*Stack analysis: 2026-02-03*
