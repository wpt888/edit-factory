# Technology Stack

**Analysis Date:** 2026-02-12

## Languages

**Primary:**
- Python 3.11 - FastAPI backend, video processing, AI services
- TypeScript 5 - Next.js frontend, React components, Playwright tests
- JavaScript - Next.js build tooling, package management

**Secondary:**
- Shell/Bash - Development scripts (start-dev.sh, deploy-local.sh)
- SQL - Supabase migrations (migrations/*.sql)

## Runtime

**Environment:**
- Python 3.11 (Docker base: `python:3.11-slim`)
- Node.js (via npm, version managed by frontend lock file)

**Package Manager:**
- pip (Python dependencies)
- npm (JavaScript/TypeScript dependencies)
- Lockfile: `requirements.txt` (pinned versions), `frontend/package-lock.json`

## Frameworks

**Backend Core:**
- FastAPI 0.104.0+ - Web framework, async HTTP API, automatic OpenAPI docs at /docs
- Uvicorn 0.24.0+ - ASGI application server
- python-multipart 0.0.6+ - Form data parsing

**Frontend Core:**
- Next.js 16.1.1 - App Router (pages in `frontend/src/app/`), React framework
- React 19.2.1 - UI components
- React DOM 19.2.1 - DOM rendering

**UI Components:**
- Radix UI - Headless component library (`@radix-ui/*`)
- Shadcn/UI - Component wrapper over Radix UI (`frontend/src/components/ui/`)
- Tailwind CSS 4 - Utility-first CSS framework
- Tailwind Merge 3.4.0 - Class merging utility
- Sonner 2.0.7 - Toast notifications
- Lucide React 0.556.0 - SVG icon library

**Testing:**
- Playwright 1.57.0 - E2E browser testing, config at `frontend/playwright.config.ts`
- ESLint 9 - JavaScript/TypeScript linting
- TypeScript 5 - Type checking

**Build/Dev:**
- Tailwind PostCSS 4 - CSS processing
- Lightning CSS - Optional, faster CSS compilation (linux variants)

## Key Dependencies

**Critical AI/ML:**
- google-genai 0.2.0+ - Google Gemini video analysis and script generation
- anthropic 0.40.0+ - Claude API for script refinement and content generation
- openai-whisper 20231117+ - Speech-to-text for caption generation

**Critical TTS (Multiple Options):**
- edge-tts 6.1.0+ - Free Microsoft Edge TTS (fallback, no cost)
- elevenlabs-sdk - ElevenLabs premium TTS (async HTTP via httpx)
- TTS 0.22.0+ - Coqui XTTS for voice cloning (requires PyTorch)
- kokoro 0.9.4+ - Fast lightweight TTS (requires espeak-ng system dependency)

**Critical Media Processing:**
- scenedetect 0.6.0+ - Scene detection for video analysis (requires OpenCV)
- opencv-python-headless 4.8.0+ - Computer vision without GUI
- numpy 1.24.0+ - Numerical arrays for frame processing
- scipy 1.11.0+ - Scientific computing (signal analysis, filtering)
- pydub 0.25.0+ - Audio manipulation
- librosa 0.10.0+ - Audio feature extraction
- soundfile 0.12.1+ - WAV/audio file I/O

**Critical Voice Processing:**
- torch 2.0.0+ - PyTorch (required by XTTS, Silero VAD, Whisper)
- torchaudio 2.0.0+ - Audio processing with PyTorch
- silero-vad (via torch) - Voice activity detection

**Critical Database:**
- supabase 2.0.0+ - PostgreSQL database client, JWT validation
- PyJWT 2.8.0+ - JWT token encoding/decoding for Supabase auth

**Infrastructure/APIs:**
- httpx 0.25.0+ - Async HTTP client (ElevenLabs, Postiz, fal.ai)
- aiofiles 23.0.0+ - Async file I/O
- google-api-python-client 2.100.0+ - Google Drive integration
- google-auth-oauthlib 1.1.0+ - OAuth for Google services

**Job Queue/Caching:**
- celery 5.3.0+ - Distributed task queue (optional, for background jobs)
- redis 5.0.0+ - In-memory data store for job queue and caching
- (Note: FastAPI.BackgroundTasks is primary, Celery optional)

**Utilities:**
- python-dotenv 1.0.0+ - .env file parsing
- pydantic 2.5.0+ - Data validation
- pydantic-settings 2.1.0+ - Settings management from environment
- tqdm 4.65.0+ - Progress bars
- srt 3.5.0+ - SRT subtitle file parsing/writing
- class-variance-authority 0.7.1 - CSS class variants (frontend)
- clsx 2.1.1 - Conditional CSS classes (frontend)
- embla-carousel-react 8.6.0 - Carousel component

## Configuration

**Environment:**
- Backend: `.env` file with variables loaded via `app/config.py` using pydantic-settings
- Frontend: Environment variables available at build time (Next.js convention)
- Config class: `app/config.py` - Settings dataclass with defaults

**Key Environment Variables:**
```
SUPABASE_URL           # Required - PostgreSQL database URL
SUPABASE_KEY           # Required - Anon client key
SUPABASE_JWT_SECRET    # Required - JWT validation secret
GEMINI_API_KEY         # Required - Google Gemini
ELEVENLABS_API_KEY     # Required - ElevenLabs TTS (if using)
ELEVENLABS_VOICE_ID    # Required - ElevenLabs voice ID
ANTHROPIC_API_KEY      # Optional - Claude for script enhancement
REDIS_URL              # Optional - Redis connection (redis://localhost:6379/0)
POSTIZ_API_URL         # Optional - Social media publishing
POSTIZ_API_KEY         # Optional - Postiz authentication
AUTH_DISABLED          # Optional - Set true for dev auth bypass
ALLOWED_ORIGINS        # CORS config (comma-separated)
```

**Build Configuration:**
- `frontend/tsconfig.json` - TypeScript compilation
- `frontend/playwright.config.ts` - E2E test configuration
- `.eslintrc` - ESLint rules (if present)
- `Dockerfile` - Multi-stage Python image
- `docker-compose.yml` - Not present (services run independently)

## Platform Requirements

**Development:**
- Python 3.11+ with venv support
- Node.js 16+ (npm comes with it)
- FFmpeg binary or system installation (auto-detected from `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` or PATH)
- System dependencies for audio: `espeak-ng` (for Kokoro TTS)
- Optional: NVIDIA CUDA toolkit for GPU acceleration (PyTorch CUDA variants)

**Production:**
- Docker (Dockerfile provided for containerized deployment)
- PostgreSQL database (via Supabase)
- Redis (optional, for Celery job queue)
- 2+ GB RAM minimum (video processing + ML models consume significant memory)
- Deployment target: Linux container, AWS/GCP/Azure/Supabase Postgres

**Deployment Tested:**
- Local WSL2 (Windows Subsystem for Linux)
- Docker containerization
- Supabase cloud database

---

*Stack analysis: 2026-02-12*
