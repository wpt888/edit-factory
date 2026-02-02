# Architecture

**Analysis Date:** 2026-02-03

## Pattern Overview

**Overall:** Layered client-server architecture with FastAPI backend and Next.js frontend, decoupled via REST API with Supabase as the persistent data store.

**Key Characteristics:**
- Clear separation between API layer (routes), business logic (services), and data persistence
- Asynchronous job processing with unified Supabase storage (fallback to in-memory)
- Multi-modal AI integration (Gemini Vision, ElevenLabs TTS, Whisper, Postiz)
- Video processing as the core domain, with content library and segment selection as secondary workflows
- Client-side state management via React hooks and localStorage, with server-side job tracking

## Layers

**API Layer (FastAPI Routes):**
- Purpose: HTTP endpoint handling, request/response mapping, authentication
- Location: `app/api/routes.py`, `app/api/library_routes.py`, `app/api/segments_routes.py`, `app/api/postiz_routes.py`, `app/api/auth.py`
- Contains: Route handlers with FastAPI decorators, Pydantic request/response models
- Depends on: Services layer, configuration, job storage
- Used by: Frontend (Next.js), external clients

**Services Layer (Business Logic):**
- Purpose: Core video processing algorithms, AI integrations, external service coordination
- Location: `app/services/` directory
- Contains:
  - Video analysis: `video_processor.py` (motion detection, variance scoring, pHash)
  - AI integrations: `gemini_analyzer.py`, `elevenlabs_tts.py`, `edge_tts_service.py`
  - Audio: `voice_detector.py`, `silence_remover.py`, `vocal_remover.py`
  - Data management: `job_storage.py`, `cost_tracker.py`
  - Platform integrations: `postiz_service.py`, `voice_cloning_service.py`
  - Utilities: `keyword_matcher.py`, `srt_validator.py`
- Depends on: Configuration, external APIs (Gemini, ElevenLabs, Supabase, Postiz)
- Used by: API routes

**Data/Configuration Layer:**
- Purpose: Settings management, environment configuration, model definitions
- Location: `app/config.py`, `app/models.py`
- Contains: Pydantic settings, Pydantic request/response schemas, job status enums
- Depends on: Environment variables
- Used by: All layers

**Frontend Layer (Next.js):**
- Purpose: User interface for video processing workflows
- Location: `frontend/src/` directory
- Contains: Pages (App Router), components (Shadcn/UI), API client library, hooks
- Depends on: Backend API (`/api/v1`), Supabase (client-side auth), localStorage
- Used by: End users via browser

**External Integrations:**
- Gemini Vision API (video/frame analysis)
- ElevenLabs TTS (text-to-speech with voice cloning)
- Supabase (database, authentication)
- Postiz (social media publishing)
- Whisper (caption generation)
- FFmpeg (video processing)

## Data Flow

**Video Processing Workflow:**

1. **Upload & Analysis**
   - User uploads video via `frontend/src/app/library/page.tsx`
   - Frontend calls `POST /api/v1/analyze` with video file
   - Backend (`app/api/routes.py`) saves video to `input/` directory
   - `VideoProcessorService` extracts frames, computes motion/variance scores
   - If Gemini enabled: `GeminiVideoAnalyzer` analyzes frames for content quality

2. **Job Tracking**
   - Job created via `JobStorage.create_job()` in `app/services/job_storage.py`
   - Attempt to persist to Supabase `jobs` table
   - If Supabase unavailable: fallback to in-memory `_memory_store`
   - Job status updates via `JobStorage.update_job()`
   - Frontend polls `GET /api/v1/jobs/{job_id}` for status

3. **Segment Selection & TTS**
   - Frontend receives video segments with scores
   - User selects segments via library UI or auto-selection
   - User provides script text for TTS
   - Frontend calls `POST /api/v1/library/{project_id}/render`
   - Backend assembles selected segments, calls TTS service
   - `ElevenLabsTTSService` or `EdgeTTSService` generates audio (with cost tracking)

4. **Video Rendering & Export**
   - `VideoProcessorService` combines segments + TTS audio + captions
   - Output video written to `output/` directory
   - Final video path stored in Supabase `clips` table
   - User downloads via `GET /api/v1/library/clips/{clip_id}/download`

5. **Social Publishing**
   - User initiates publish via library UI
   - Frontend calls `POST /api/v1/postiz/publish`
   - `PostizPublisher` uploads media and schedules post
   - Platforms: Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Bluesky, Threads

**State Management:**

- **Backend State:**
  - Persistent: Supabase tables (`projects`, `clips`, `api_costs`, `jobs`)
  - Temporary: In-memory progress tracking, job locks (`_project_locks`)
  - Local filesystem: Video files in `input/`, `output/`, temporary FFmpeg intermediate files

- **Frontend State:**
  - Client-side hooks: `useState` for UI state (tabs, selections, form fields)
  - localStorage: `editai_library_config` for user preferences and library configuration
  - No global state manager (Zustand, Redux, Context API not detected)
  - Real-time updates via polling, not WebSockets

## Key Abstractions

**VideoSegment (Dataclass):**
- Purpose: Represents a time-bounded portion of video with quality metrics
- Locations: `app/services/video_processor.py` (backend), `app/models.py` (API model)
- Properties: `start_time`, `end_time`, `motion_score`, `variance_score`, `combined_score`
- Used for: Scoring segments, filtering duplicates, rendering selection

**JobStorage:**
- Purpose: Unified persistent job tracking with fallback
- Location: `app/services/job_storage.py`
- Pattern: Singleton (lazy-initialized `_job_storage` global)
- Behavior: Attempts Supabase first, silently falls back to in-memory dict
- Methods: `create_job()`, `update_job()`, `get_job()`, `get_all_jobs()`

**GeminiVideoAnalyzer:**
- Purpose: AI-powered frame analysis for intelligent segment ranking
- Location: `app/services/gemini_analyzer.py`
- Pattern: Optional integration (graceful degradation if API key missing)
- Output: `AnalyzedSegment` with score, description, highlights, tags

**PostizPublisher:**
- Purpose: Social media platform abstraction
- Location: `app/services/postiz_service.py`
- Pattern: HTTP client wrapper with dataclasses
- Supports: Multi-platform scheduling (Instagram, TikTok, YouTube, etc.)

**CostTracker:**
- Purpose: Track API spending across ElevenLabs and Gemini
- Location: `app/services/cost_tracker.py`
- Pattern: Singleton with Supabase persistence and JSON backup
- Pricing: ElevenLabs $0.22/1k chars, Gemini $0.02/image

## Entry Points

**Backend Entry:**
- Location: `app/main.py`
- Startup: Initializes FastAPI app, registers routers, configures CORS, creates directories
- Entry command: `python run.py` or `uvicorn app.main:app --reload`
- Router registration:
  - `/api/v1` → `app/api/routes.py` (video analysis, costs, usage)
  - `/api/v1/library` → `app/api/library_routes.py` (projects, clips, rendering)
  - `/api/v1/segments` → `app/api/segments_routes.py` (segment selection workflow)
  - `/api/v1/postiz` → `app/api/postiz_routes.py` (social publishing)

**Frontend Entry:**
- Location: `frontend/src/app/layout.tsx` (root layout), `frontend/src/app/page.tsx` (home)
- Pages accessible:
  - `/library` → Library/workflow interface
  - `/segments` → Manual segment selection
  - `/login`, `/signup` → Authentication
  - `/usage` → Cost tracking dashboard
  - `/statsai` → AI analytics
  - Marketing pages: `/`, `/functionalitati`, `/preturi`, `/contact`

**Middleware & Startup:**
- CORS configured via environment variable `ALLOWED_ORIGINS`
- FFmpeg PATH auto-configured at startup from `ffmpeg/ffmpeg-master-latest-win64-gpl/bin`
- Database directories created if missing: `input/`, `output/`, `logs/`

## Error Handling

**Strategy:** HTTP exceptions with status codes, try-catch with fallback to in-memory storage

**Patterns:**

1. **External API Failures:**
   - Gemini unavailable: Skip AI analysis, use motion/variance scores only
   - Supabase unavailable: Fall back to in-memory storage (JobStorage, CostTracker)
   - ElevenLabs/Edge TTS failure: Return error message to frontend
   - Postiz API error: Return error in response, no automatic retry

2. **File Operation Errors:**
   - FFmpeg missing: Detected at startup, logged as warning
   - File not found: `HTTPException(status_code=404)`
   - Permission denied: `HTTPException(status_code=403)`

3. **Validation Errors:**
   - Pydantic validation: Automatic 422 response
   - JWT token invalid: `HTTPException(status_code=401)`
   - Missing auth: Return 401 or allow if `auth_disabled=True`

4. **Race Conditions:**
   - Project-level locks via `get_project_lock()` in `app/api/library_routes.py`
   - Meta-lock `_locks_lock` protects lock dictionary access
   - Prevents concurrent rendering of same project

## Cross-Cutting Concerns

**Logging:** Python `logging` module configured at app startup, loggers per module

**Validation:** Pydantic models for all API inputs/outputs, custom validators in service layer

**Authentication:**
- Via `app/api/auth.py`: JWT token verification against Supabase secret
- Can be disabled with `AUTH_DISABLED=true` for local development
- `get_current_user()` dependency injected into protected routes
- Token audience: "authenticated"

**Cost Tracking:**
- Automatic logging for ElevenLabs TTS (characters) and Gemini Vision (frames/tokens)
- Stored in Supabase `api_costs` table + local JSON backup
- Endpoint: `GET /api/v1/costs` returns summary with daily totals

**Progress Tracking:**
- In-memory dict `_generation_progress` in library routes
- Polled by frontend via `GET /api/v1/library/projects/{project_id}/progress`
- Shows percentage, current step, estimated remaining time

---

*Architecture analysis: 2026-02-03*
