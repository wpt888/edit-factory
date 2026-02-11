# Architecture

**Analysis Date:** 2026-02-12

## Pattern Overview

**Overall:** Event-driven microservices with background jobs + frontend-driven state management

**Key Characteristics:**
- **Layered separation**: FastAPI routers → services → external APIs
- **Job-based async processing**: Immediate response + background rendering via `FastAPI.BackgroundTasks`
- **Graceful degradation**: All external services have fallbacks (Gemini → motion scoring, ElevenLabs → Edge TTS, Supabase → memory)
- **Multi-tenancy with profiles**: Requests isolated by profile_id (extracted from X-Profile-Id header)
- **Dual-phase rendering**: Raw segment generation (with user review) → final clip rendering

## Layers

**API Layer (Routes):**
- Purpose: HTTP endpoint handlers, request validation, authentication
- Location: `app/api/` (routes.py, library_routes.py, segments_routes.py, postiz_routes.py, profile_routes.py, tts_routes.py)
- Contains: FastAPI routers with @router.get/@router.post decorators, ProfileContext extraction, error handling
- Depends on: Services layer, authentication (auth.py), Supabase, JobStorage
- Used by: Frontend (port 3000), external clients

**Service Layer (Business Logic):**
- Purpose: Core functionality for video processing, TTS, cost tracking, storage
- Location: `app/services/`
- Contains: VideoProcessorService, TTS implementations (ElevenLabsTTS, EdgeTTS), GeminiAnalyzer, CostTracker, JobStorage, VideoFilters, SubtitleStyler, AudioNormalizer, EncodingPresets, SilenceRemover, VoiceDetector
- Depends on: External APIs (Gemini, ElevenLabs, Edge, Supabase), FFmpeg, local files
- Used by: API layer via singleton factory functions like `get_processor()`, `get_cost_tracker()`, `get_elevenlabs_tts()`

**Storage Layer (Persistence):**
- Purpose: Dual persistence with fallback
- Location: `app/services/job_storage.py` (Supabase primary), in-memory fallback
- Contains: JobStorage class managing jobs table (id, job_type, status, progress, data JSONB, profile_id)
- Depends on: Supabase client
- Used by: Routes when tracking long-running jobs

**Frontend Layer (React/Next.js):**
- Purpose: User interface for video processing workflow
- Location: `frontend/src/`
- Contains: Next.js App Router pages, React components (Shadcn/UI), hooks, contexts, types, API client
- Depends on: API client (frontend/src/lib/api.ts), Supabase Auth SDK, localStorage
- Used by: End users

## Data Flow

**Video Upload & Raw Generation (Phase 1):**

1. User uploads video → `POST /library/projects/{project_id}/generate`
2. Request enters `library_routes.py` with video file, target_duration, number of variants
3. Route validates request, extracts profile_id from header, acquires project lock
4. Spawns background task via `BackgroundTasks.add_task()` → `_generate_raw_clips_task()`
5. Returns job_id immediately to frontend (non-blocking)
6. Background task:
   - Calls `VideoProcessorService.process_video()` to analyze frames
   - Scores segments via motion + variance (+ Gemini if available)
   - Generates `variants` raw clips (1-10 per request)
   - Stores clip records in Supabase `clips` table with `is_selected=true` (raw clips)
   - Updates job status to "completed" in JobStorage
7. Frontend polls `GET /library/projects/{project_id}/progress` or fetches clips directly

**Final Rendering (Phase 2):**

1. User reviews raw clips, adds TTS text, configures subtitle settings
2. User clicks "Render" → `POST /library/clips/{clip_id}/render`
3. Route validates clip content (TTS text, subtitle settings), acquires project lock
4. Spawns background task → `_render_final_clip_task()`
5. Returns immediately with task confirmation (non-blocking)
6. Background task:
   - Calls TTS service (ElevenLabs or Edge) to generate audio
   - Applies silence removal via `SilenceRemover`
   - Compares video duration vs audio duration:
     - Video < Audio: extend video by adding more segments
     - Video > Audio: trim video to match audio
   - Builds FFmpeg filter chain:
     - Video filters: denoise, sharpen, color correction (if enabled)
     - Audio filters: loudness normalization
     - Subtitle filter: overlay SRT with styling (color, font, position, shadow, glow)
   - Calls `_render_with_preset()` to execute FFmpeg encode
   - Stores final video path in Supabase `clips.final_video_path`
   - Tracks cost in `api_costs` table via CostTracker

**State Management (Frontend):**

- **Project list**: Fetched on page load, refreshed after project creation
- **Clip list**: Fetched after raw generation completes (frontend queries `GET /library/projects/{project_id}/clips`)
- **Clip content (TTS, subtitles)**: Stored per clip in Supabase `clips` table JSON fields
- **Progress tracking**: In-memory `_generation_progress` dict in library_routes.py (lost on restart, NOT source of truth)
- **localStorage**: Profile ID persistence, library page config (collapsible sections, UI state)

## Key Abstractions

**VideoProcessorService:**
- Purpose: Video analysis and segment detection
- Examples: `app/services/video_processor.py` (2112 lines)
- Pattern:
  - Frame-by-frame motion scoring (optical flow)
  - Perceptual hashing (pHash) with Hamming distance for duplicate detection (threshold: 12)
  - Optional Gemini AI frame analysis (fallback to motion + variance)
  - Returns `VideoSegment` dataclass with motion_score, variance_score, blur_score, contrast_score
  - Scoring formula: `(motion * 0.40) + (variance * 0.20) + (blur * 0.20) + (contrast * 0.15) + (brightness * 0.05)`

**TTS Factory Pattern:**
- Purpose: Abstraction over multiple TTS providers
- Examples: `app/services/tts/` (base.py, elevenlabs.py, edge.py, kokoro.py, coqui.py)
- Pattern:
  - `TTSProvider` base class with `synthesize()` method
  - Factory function `get_tts_provider()` selects provider based on config
  - Routes call generic TTS without knowing provider details
  - Fallback cascade: ElevenLabs → Edge TTS → Kokoro

**JobStorage with Fallback:**
- Purpose: Track long-running jobs with persistent storage
- Examples: `app/services/job_storage.py`
- Pattern:
  - Primary: Supabase `jobs` table (persists across restarts, indexed by job_id and profile_id)
  - Fallback: In-memory dict if Supabase unavailable
  - Methods: `create_job()`, `update_job()`, `get_job()`, `update_job_progress()`
  - Job data includes: job_type, status, progress percentage, data (JSONB), error message

**ProfileContext (Frontend):**
- Purpose: Client-side multi-tenancy with localStorage persistence
- Examples: `frontend/src/contexts/profile-context.tsx`
- Pattern:
  - React Context + localStorage hybrid
  - Hydration: localStorage first (instant UI) → API fetch (fresh data)
  - Auto-selects last-used or default profile
  - Profile ID injected into API requests via `X-Profile-Id` header
  - Storage keys: `editai_current_profile_id`, `editai_profiles`

**Subtitle Styling:**
- Purpose: Apply visual styling to SRT subtitles via FFmpeg filters
- Examples: `app/services/subtitle_styler.py`
- Pattern:
  - Accepts SubtitleSettings (font, color, position, shadow, glow, adaptive sizing)
  - Builds FFmpeg `subtitles` filter string with `fontfile`, `fontsize`, `boxcolor`, `borderw`, `shadowx`, etc.
  - Shadow effect via duplicate subtitle layer with offset + opacity
  - Glow effect via Gaussian blur on subtitle layer
  - Adaptive sizing adjusts fontSize based on video height

**Video Enhancement Filters:**
- Purpose: Apply video quality enhancement (denoise, sharpen, color)
- Examples: `app/services/video_filters.py`
- Pattern:
  - Modular DenoiseConfig, SharpenConfig, ColorConfig dataclasses
  - Builds FFmpeg filter chain: `[denoise][sharpen][color]format` (if enabled)
  - Applied during final rendering via `_render_with_preset()`
  - Supports brightness, contrast, saturation adjustments

## Entry Points

**Backend:**

**`app/main.py`:**
- Location: `app/main.py`
- Triggers: `python run.py` or `uvicorn app.main:app --port 8000 --reload`
- Responsibilities:
  - Initializes FastAPI app with title, description, version
  - Adds CORS middleware (ALLOWED_ORIGINS from environment)
  - Mounts routers with `/api/v1` prefix:
    - `routes.py` → `/api/v1` (video processing, costs, health)
    - `library_routes.py` → `/api/v1/library` (projects, clips, rendering)
    - `segments_routes.py` → `/api/v1/segments` (manual selection)
    - `postiz_routes.py` → `/api/v1/postiz` (social publishing)
    - `profile_routes.py` → `/api/v1/profiles` (multi-tenancy)
    - `tts_routes.py` → `/api/v1/tts` (TTS operations)
  - Mounts static files directory
  - Adds FFmpeg to PATH on startup if local binary exists

**`app/api/routes.py`:**
- Location: `app/api/routes.py` (1447 lines)
- Triggers: HTTP requests to `/api/v1/*`
- Responsibilities:
  - `GET /health` - Health check with FFmpeg/Redis availability
  - `POST /upload` - Video upload and initial processing
  - `GET /jobs/{job_id}` - Job status polling
  - `GET /costs` - Cost summary for profile
  - `POST /analyze` - Video analysis endpoint

**`app/api/library_routes.py`:**
- Location: `app/api/library_routes.py` (2587 lines, largest file)
- Triggers: HTTP requests to `/api/v1/library/*`
- Responsibilities:
  - Project CRUD: `POST /projects`, `GET /projects`, `PATCH /projects/{id}`, `DELETE /projects/{id}`
  - Raw clip generation: `POST /projects/{id}/generate` (spawns background task)
  - Clip management: select, delete, bulk operations
  - Clip content editing: TTS text, subtitle settings
  - Final rendering: `POST /clips/{id}/render` (spawns _render_final_clip_task)
  - Audio removal: `POST /clips/{id}/remove-audio`
  - File serving: `GET /files/{path}` for downloads

**Frontend:**

**`frontend/src/app/layout.tsx`:**
- Location: `frontend/src/app/layout.tsx`
- Triggers: Page load (Next.js App Router root layout)
- Responsibilities:
  - Wraps all pages with ProfileProvider, AuthProvider
  - Sets up Supabase auth context
  - Defines global fonts, styles, metadata
  - Establishes root layout structure

**`frontend/src/app/library/page.tsx`:**
- Location: `frontend/src/app/library/page.tsx` (primary workflow page, ~2000 lines)
- Triggers: User navigates to `/library`
- Responsibilities:
  - Project list display and creation dialog
  - Tab 1: "Generate Raw Clips" - Upload video, set target duration, generate variants
  - Tab 2: "Triage" - Review clips, select variants, configure audio/subtitles
  - Tab 3: "Render Finals" - Render with filters and styling
  - Tab 4: "Download" - Export final videos

**`frontend/src/app/segments/page.tsx`:**
- Location: `frontend/src/app/segments/page.tsx`
- Triggers: User navigates to `/segments`
- Responsibilities:
  - Manual video segment selection via timeline slider
  - Frame-by-frame viewer with scoring overlay
  - Custom clip creation from manual segments

**`frontend/src/app/page.tsx`:**
- Location: `frontend/src/app/page.tsx` (home/landing page)
- Triggers: User navigates to `/`
- Responsibilities:
  - Marketing landing page
  - Product features showcase
  - Call-to-action for app access

## Error Handling

**Strategy:** Graceful degradation with fallback services - system continues working even if services fail

**Patterns:**

**Gemini AI (Optional):**
- Try: Call Gemini API for frame analysis
- Catch: Log error as warning, fallback to motion + variance scoring only
- Result: Segment selection works but less intelligently; no user-visible error

**ElevenLabs TTS:**
- Try: Generate audio via ElevenLabs API with rate limiting
- Catch: Log error, fallback to Edge TTS (free Microsoft voices)
- Result: User gets voice output either way; quality may vary

**Supabase:**
- Try: Store job/clip/project data in Supabase table
- Catch: Log error, store in memory
- Result: Jobs tracked during session; data lost on restart but system continues operating

**FFmpeg:**
- Try: Use FFmpeg for video processing (must be in PATH or local directory)
- Catch: Log critical error, return HTTPException 500
- Result: Routes fail visibly; user sees "Video processing not available"

**JWT Auth:**
- Try: Verify Supabase JWT token from Authorization header
- Catch: HTTPException 401 (invalid token) or 500 (JWT_SECRET missing)
- Result: Unauthenticated requests blocked OR allowed if AUTH_DISABLED=true (dev mode)

**File Operations:**
- Try: Read/write video files to disk
- Catch: Log error, return HTTPException 400/500
- Result: Operations fail with descriptive error to frontend

## Cross-Cutting Concerns

**Logging:**
- Tool: Python `logging` module
- Pattern: `logger = logging.getLogger(__name__)` in each module, `logger.info/error/warning`
- Output: Stdout with format `%(asctime)s - %(name)s - %(levelname)s - %(message)s` (configured in main.py)
- Log levels: INFO for major events, WARNING for degradation, ERROR for failures

**Validation:**
- **Pydantic models at API boundary**: `ProjectCreate`, `ProjectResponse`, `ClipContent`, `SubtitleSettings` (frontend type interfaces)
- **Form data coercion**: HTML forms send strings, booleans parsed via `.lower() in ("true", "1", "yes", "on")`
- **File type validation**: MIME type checking for video uploads (video/mp4, video/mpeg, etc.)
- **Directory traversal protection**: File serving uses `{file_path:path}` with validation

**Authentication:**
- Supabase JWT verification in `app/api/auth.py` (verify_jwt_token function)
- `Depends(get_profile_context)` extracts user_id + profile_id from token
- `X-Profile-Id` header provides profile context (set by frontend from localStorage)
- `AUTH_DISABLED=true` setting bypasses token validation for local development

**Cost Tracking:**
- Service: `CostTracker` singleton in `app/services/cost_tracker.py`
- Logging: Dual destination - Supabase `api_costs` table + local JSON file (`logs/cost_log.json`)
- Tracked operations: ElevenLabs TTS characters, Gemini image analysis, etc.
- Per-profile isolation: Costs tagged with profile_id for multi-tenant billing

**Multi-tenancy (Profile Isolation):**
- Profile ID extracted from X-Profile-Id header (set by frontend from localStorage)
- Temp directories scoped: `temp/{profile_id}` prevents cross-profile file collisions
- Database queries filtered by profile_id in `WHERE` clauses
- Costs tracked per profile for accurate billing
- Supabase Row Level Security (RLS) policies enforce isolation (if configured)

**Concurrency:**
- Thread-safe project locks: `_project_locks` dict in library_routes.py prevents race conditions
- Lock acquired before multi-variant generation, released after completion
- Prevents simultaneous rendering of same project
- Separate lock for managing project locks: `_locks_lock` (meta-lock)

---

*Architecture analysis: 2026-02-12*
