# Technology Stack

**Analysis Date:** 2026-02-12

## Languages

**Primary:**
- Python 3.11 - Backend (FastAPI + video processing services)
- TypeScript 5 - Frontend (Next.js application)
- JavaScript - Build tooling

**Secondary:**
- SQL (PostgreSQL via Supabase)
- Bash - Development scripts

## Runtime

**Environment:**
- Python 3.11 (Docker target: `python:3.11-slim`)
- Node.js 20+ (inferred from Next.js 16 requirements)

**Package Manager:**
- pip - Python dependencies (`requirements.txt`)
- npm - JavaScript dependencies (`frontend/package.json`)
- Lockfile: `package-lock.json` present for frontend, `requirements.txt` pinned for backend

## Frameworks

**Core:**
- FastAPI 0.104.0+ - Web framework for REST API (`app/main.py`)
- Uvicorn 0.24.0+ - ASGI server for FastAPI
- Next.js 16.1.1 - React full-stack framework (`frontend/src/app/`)

**UI:**
- React 19.2.1 - JavaScript library for UI components
- Radix UI - Unstyled, accessible component library (all @radix-ui/* packages)
- Tailwind CSS 4 - Utility-first CSS framework
- Shadcn/UI - Pre-built Radix UI + Tailwind components

**Video Processing:**
- FFmpeg - Local binary at `ffmpeg/ffmpeg-master-latest-win64-gpl/bin/` (Windows) or system PATH
- OpenCV (cv2 via opencv-python-headless 4.8.0+) - Frame extraction and analysis
- PyDub 0.25.0+ - Audio manipulation

**Testing:**
- Playwright 1.57.0 - E2E browser testing (`frontend/tests/`, config: `frontend/playwright.config.ts`)

**Build/Dev:**
- TypeScript 5 - Static typing for frontend
- ESLint 9 - Linting (config: `frontend/eslint.config.mjs`)
- Tailwind CSS 4 - CSS compilation with PostCSS

## Key Dependencies

**Critical - AI & Analysis:**
- google-genai 0.2.0+ - Google Gemini Vision API for video analysis (`app/services/gemini_analyzer.py`)
- TTS 0.22.0+ - Coqui XTTS for voice cloning (supports 17 languages)
- openai-whisper 20231117+ - Speech-to-text transcription for captions

**Critical - TTS (Text-to-Speech):**
- elevenlabs (version unspecified in requirements) - ElevenLabs API client (`app/services/elevenlabs_tts.py`)
- edge-tts 6.1.0+ - Microsoft Edge TTS (free fallback)
- kokoro 0.9.4+ - Lightweight TTS alternative (requires espeak-ng system dependency)

**Critical - Voice Processing:**
- torch 2.0.0+ - PyTorch for ML inference (VAD, voice detection)
- torchaudio 2.0.0+ - PyTorch audio utilities
- librosa 0.10.0+ - Audio feature extraction

**Infrastructure - Databases:**
- supabase 2.0.0+ - PostgreSQL client for project/clip/cost management
- PyJWT 2.8.0+ - JWT token verification for auth

**Infrastructure - Video Analysis:**
- scenedetect[opencv] 0.6.0+ - Scene detection and keyframe extraction
- numpy 1.24.0+ - Numerical computing
- scipy 1.11.0+ - Scientific computing

**Infrastructure - External APIs:**
- httpx 0.25.0+ - Async HTTP client (used for ElevenLabs, Postiz)
- google-api-python-client 2.100.0+ - Google Drive integration
- google-auth-oauthlib 1.1.0+ - OAuth for Google Drive

**Infrastructure - Job Processing:**
- celery 5.3.0+ - Task queue (optional, declared but not required for core flow)
- redis 5.0.0+ - Cache/message broker (optional, declared but not required)

**Utilities:**
- python-dotenv 1.0.0+ - Environment variable loading (`.env` file)
- pydantic 2.5.0+ - Data validation and settings
- pydantic-settings 2.1.0+ - Configuration management
- tqdm 4.65.0+ - Progress bars
- srt 3.5.0+ - SRT subtitle parsing/generation
- aiofiles 23.0.0+ - Async file operations

**Frontend - API & Auth:**
- @supabase/supabase-js 2.89.0+ - Supabase client for auth and real-time
- @supabase/ssr 0.8.0+ - Supabase server-side rendering utilities

**Frontend - UI Utilities:**
- lucide-react 0.556.0 - Icon library
- sonner 2.0.7+ - Toast notifications
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 3.4.0 - Tailwind CSS conflict resolution
- class-variance-authority 0.7.1 - CSS class generation
- embla-carousel-react 8.6.0 - Carousel component
- react-resizable-panels 4.2.1 - Resizable panel layout

## Configuration

**Environment:**
- Loaded from `.env` file (see `.env.example`)
- Database connection: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`
- AI APIs: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- Optional services: `REDIS_URL`, `POSTIZ_API_URL`, `POSTIZ_API_KEY`, `GOOGLE_DRIVE_FOLDER_ID`
- Development: `AUTH_DISABLED=true` bypasses JWT validation

**Backend Configuration:**
- File: `app/config.py` - Pydantic Settings model
- Defines paths: `input_dir`, `output_dir`, `logs_dir`
- CORS origins: configurable from `ALLOWED_ORIGINS` env var

**Frontend Configuration:**
- TypeScript: `frontend/tsconfig.json` (ES2017 target, strict mode, path alias `@/*`)
- Next.js: `frontend/next.config.ts` (output: "standalone" for Docker, remote image patterns)
- Playwright: `frontend/playwright.config.ts` (base URL, screenshot/video retention, 60s timeout)
- ESLint: `frontend/eslint.config.mjs` (next core-web-vitals + typescript presets)

**Build:**
- Backend uses Python venv
- Frontend uses npm with lock file
- Docker multistage build: Python 3.11 slim with FFmpeg

## Platform Requirements

**Development:**
- Windows: Python 3.11, Node.js 20+, FFmpeg in local directory or PATH
- Linux/WSL: Python 3.11, Node.js 20+, FFmpeg via system package manager
- macOS: Python 3.11, Node.js 20+, FFmpeg via Homebrew

**Production:**
- Docker container: `python:3.11-slim` with system packages (ffmpeg, libsm6, libxext6, libgl1)
- Environment variables required: `SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
- Reverse proxy (nginx) recommended for frontend static files
- Port 8000: FastAPI backend
- Port 3000: Next.js frontend

---

*Stack analysis: 2026-02-12*
