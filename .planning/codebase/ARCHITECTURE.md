# Architecture

**Analysis Date:** 2026-02-12

## Pattern Overview

**Overall:** Layered microservices with clear separation between API routes, business services, and external integrations. Multi-tenant design with profile-scoped isolation.

**Key Characteristics:**
- FastAPI backend (Python) + Next.js frontend (TypeScript)
- Service-oriented architecture with singleton factory functions for instantiation
- Background task processing via FastAPI BackgroundTasks (not Celery/Redis)
- Graceful degradation hierarchy for all external dependencies
- Multi-tenant design with profile-based context propagation
- Lazy initialization pattern for Supabase clients and AI service providers

## Layers

**Presentation Layer (Frontend):**
- Purpose: User interface for video editing, script generation, and pipeline management
- Location: `frontend/src/app/` and `frontend/src/components/`
- Contains: Next.js pages, React components (Shadcn/UI), hooks, and type definitions
- Depends on: API client in `frontend/src/lib/api.ts`, Supabase Auth SDK for authentication
- Used by: End users via browser

**API Routes Layer:**
- Purpose: HTTP endpoint handlers, request validation, and response formatting
- Location: `app/api/*.py` (7 route modules + auth module)
- Contains:
  - `routes.py` - Core video processing, TTS, job status
  - `library_routes.py` - Project/clip CRUD, rendering, export
  - `segments_routes.py` - Manual video segment selection
  - `postiz_routes.py` - Social media publishing
  - `profile_routes.py` - User profile management
  - `script_routes.py` - AI script generation
  - `assembly_routes.py` - Script-to-video assembly
  - `pipeline_routes.py` - Multi-variant orchestration
  - `tts_routes.py` - Text-to-speech operations
  - `auth.py` - JWT verification, profile context extraction
- Depends on: Services layer, authentication middleware, job storage
- Used by: Frontend via HTTP `/api/v1/*` endpoints

**Services Layer:**
- Purpose: Business logic and orchestration of external dependencies
- Location: `app/services/` (40+ service files)
- Core services:
  - `video_processor.py` - Video analysis, segmentation, motion/variance scoring
  - `script_generator.py` - AI script generation (Gemini/Claude)
  - `assembly_service.py` - Script-to-video pipeline orchestration
  - `tts_subtitle_generator.py` - TTS audio + SRT subtitle generation
  - `job_storage.py` - Persistent job tracking (Supabase primary, in-memory fallback)
  - `cost_tracker.py` - API cost logging (Supabase + local JSON)
  - `subtitle_styler.py` - FFmpeg subtitle rendering with effects
  - `video_filters.py` - Video enhancement (denoise, sharpen, color)
  - `audio_normalizer.py` - Loudness measurement and LUFS normalization
  - `encoding_presets.py` - FFmpeg preset configurations
  - `gemini_analyzer.py` - Gemini AI video analysis (optional, graceful fallback)
  - `postiz_service.py` - Social media publishing integration
  - `voice_detector.py`, `vocal_remover.py`, `silence_remover.py` - Audio processing
  - TTS abstraction layer in `tts/` - Factory pattern with multiple providers (ElevenLabs, Edge, Coqui, Kokoro)
- Depends on: External APIs (Gemini, ElevenLabs, Anthropic, Supabase), FFmpeg, Python audio libraries
- Used by: API routes via service factory functions

**Data Storage Layer:**
- Purpose: Persistent data management and job state
- Location: Supabase (primary), in-memory fallback in `job_storage.py`
- Contains: Projects, clips, jobs, profiles, costs, segments (database tables)
- Lazy initialization pattern in each router module

**Configuration Layer:**
- Purpose: Environment-based settings and path management
- Location: `app/config.py`
- Contains: Settings class with environment variable loading, directory creation

**Application Entry Point:**
- Purpose: FastAPI app initialization and middleware setup
- Location: `app/main.py`
- Responsibilities: Router registration, CORS configuration, static file mounting, startup events

## Data Flow

**Video Processing Upload Flow:**
```
Frontend (Upload Form)
  → apiPost("/library/projects/:id/upload")
    → routes.library_routes.upload_video_to_project
      → VideoProcessorService.process_video (background task)
        → FFmpeg video analysis (motion, variance, brightness)
        → Gemini AI scoring (optional, fallback to motion/variance)
        → Database: INSERT clips with segment metadata
        → Frontend polls: GET /library/projects/:id/clips
```

**Script-to-Video Pipeline Flow:**
```
Frontend (Pipeline Page)
  → apiPost("/pipeline/generate", { idea, context, variant_count, provider })
    → pipeline_routes.generate_scripts (background task)
      → ScriptGenerator.generate_scripts (Gemini or Claude)
        → Database: STORE scripts for preview
  → Frontend displays generated scripts
  → User selects variants and clicks "Render"
  → apiPost("/pipeline/render", { variant_indices, preset, subtitle_settings })
    → AssemblyService.assemble_and_render (background task per variant)
      → TTS: TtsSubtitleGenerator.generate_tts_and_subtitles
      → Silence removal: SilenceRemover
      → SRT generation: Auto-match keywords
      → Rendering: library_routes._render_final_clip_task
      → Database: UPDATE clips with final_video_path
```

**Profile Context Propagation:**
```
Frontend localStorage: editai_current_profile_id
  → HTTP Header: X-Profile-Id
    → auth.py: get_profile_context()
      → ProfileContext(profile_id, user_id)
        → Scoped to routes via Depends(get_profile_context)
        → Passed to services for data isolation
```

**State Management:**
- Jobs: Supabase `jobs` table with in-memory fallback in `JobStorage`
- Projects/Clips: Supabase `projects`, `clips` tables
- Profiles: Supabase `profiles` table
- Progress: In-memory `_generation_progress` dict (lost on restart, UI-only)
- Project Locks: In-memory `_project_locks` threading dict (prevent race conditions)

## Key Abstractions

**VideoProcessorService:**
- Purpose: Core video analysis with motion/variance scoring and Gemini AI integration
- Examples: `app/services/video_processor.py`
- Pattern: Singleton factory `get_processor(profile_id)` with profile-scoped temp directory
- Key methods: `process_video()`, `score_segments()`, `detect_duplicates()`

**ScriptGenerator:**
- Purpose: AI script generation with multiple provider support
- Examples: `app/services/script_generator.py`
- Pattern: Dual API support (Gemini/Claude), keyword awareness for matching
- Key methods: `generate_scripts(idea, context, keywords, variant_count, provider)`

**AssemblyService:**
- Purpose: End-to-end script-to-video orchestration
- Examples: `app/services/assembly_service.py`
- Pattern: Bridges script generation → TTS → SRT → segment matching → rendering
- Key methods: `assemble_and_render(script, segments, settings)`

**TTS Factory Pattern:**
- Purpose: Pluggable text-to-speech providers
- Location: `app/services/tts/` with `base.py` (abstract), `factory.py` (factory), provider files
- Implementations: ElevenLabs, Edge (Microsoft), Coqui, Kokoro
- Pattern: `TtsFactory.create(provider_name)` returns instance with unified interface

**JobStorage:**
- Purpose: Persistent job tracking with graceful degradation
- Pattern: Supabase primary, falls back to in-memory dict if unavailable
- Key methods: `create_job()`, `get_job()`, `update_job()`, `delete_job()`

**ProfileContext:**
- Purpose: Multi-tenant request context propagation
- Pattern: Dataclass with `profile_id` and `user_id`, extracted from JWT + headers
- Usage: `Depends(get_profile_context)` in route handlers for automatic injection

## Entry Points

**Backend Entry Point:**
- Location: `app/main.py`
- Triggers: `uvicorn app.main:app` or `python run.py`
- Responsibilities: FastAPI app setup, 8 router registrations, CORS middleware, static files

**Frontend Entry Point:**
- Location: `frontend/src/app/layout.tsx`
- Triggers: Next.js server startup
- Responsibilities: Global layout, ProfileProvider context, NavBar, Toaster

**API Endpoints (all prefixed with `/api/v1`):**
- Video Processing: POST `/upload`, GET `/jobs/{job_id}`, GET `/costs`
- Library: POST `/library/projects`, GET `/library/projects`, POST `/library/projects/{id}/clips`
- Segments: GET `/segments`, POST `/segments/{id}/select`
- Scripts: POST `/scripts/generate`
- Assembly: POST `/assembly/preview`, POST `/assembly/render`
- Pipeline: POST `/pipeline/generate`, POST `/pipeline/render`
- Profiles: GET `/profiles`, POST `/profiles`, PUT `/profiles/{id}`
- Publishing: POST `/postiz/publish`

## Error Handling

**Strategy:** Graceful degradation with informative error responses

**Patterns:**
- Gemini AI optional: Falls back to motion/variance scoring only
- Supabase optional: JobStorage uses in-memory dict if DB unavailable
- ElevenLabs optional: Falls back to Edge TTS (free Microsoft voices)
- Postiz optional: System fully functional without social publishing
- All services use try/except with logging, return partial results rather than failing

**HTTP Status Codes:**
- 200: Success
- 400: Invalid request (bad parameters)
- 401: Authentication required
- 403: Forbidden (wrong profile ownership)
- 404: Not found (profile, project, clip)
- 503: Service unavailable (Supabase down, auth misconfigured)
- 500: Internal server error (unexpected exception)

## Cross-Cutting Concerns

**Logging:**
- Pattern: `logging.getLogger(__name__)` in each module
- Format: `%(asctime)s - %(name)s - %(levelname)s - %(message)s`
- Profile context: `[Profile {profile_id}]` prefix in log messages for multi-tenant tracking

**Validation:**
- Request: Pydantic BaseModel for all POST/PUT payloads (auto-validated by FastAPI)
- Form data: String parsing for HTML form booleans: `.lower() in ("true", "1", "yes", "on")`
- File uploads: MIME type checking in video/audio endpoints

**Authentication:**
- JWT verification in `auth.py` via Supabase tokens
- Optional per-route: Routes without `Depends(get_current_user)` are public
- Development bypass: `AUTH_DISABLED=true` in settings for local development

**Multi-Tenancy:**
- Profile isolation: Every resource scoped to profile_id
- Temp directories: Scoped per profile to prevent cross-project collisions
- Context propagation: X-Profile-Id header → ProfileContext → service layer

**Concurrency:**
- Project-level locks in `library_routes.py`: `_project_locks[project_id]` prevents race conditions
- Background tasks via `BackgroundTasks` (not async/await on request path)
- Threading locks for project-level multi-variant processing

---

*Architecture analysis: 2026-02-12*
