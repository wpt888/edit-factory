# Codebase Structure

**Analysis Date:** 2026-02-12

## Directory Layout

```
edit_factory/
├── app/                          # FastAPI backend application
│   ├── main.py                   # Entry point: app initialization, router mounting
│   ├── config.py                 # Pydantic Settings: environment, paths, credentials
│   ├── models.py                 # Pydantic data models: JobStatus, VideoSegment, JobResponse
│   ├── api/                      # API route handlers (FastAPI routers)
│   │   ├── auth.py               # JWT verification, ProfileContext extraction
│   │   ├── routes.py             # Main routes: upload, analyze, costs, health (1447 lines)
│   │   ├── library_routes.py     # Library workflow: projects, clips, rendering (2587 lines)
│   │   ├── segments_routes.py    # Manual segment selection endpoints
│   │   ├── postiz_routes.py      # Social media publishing integration
│   │   ├── profile_routes.py     # Multi-tenancy profile endpoints
│   │   └── tts_routes.py         # TTS-specific endpoints
│   └── services/                 # Business logic services
│       ├── video_processor.py    # Video analysis, frame scoring, segment detection (2112 lines)
│       ├── gemini_analyzer.py    # Gemini Vision API integration for frame analysis
│       ├── job_storage.py        # Job tracking with Supabase primary + memory fallback
│       ├── cost_tracker.py       # API cost logging (Supabase + JSON)
│       ├── elevenlabs_tts.py     # ElevenLabs TTS provider
│       ├── edge_tts_service.py   # Microsoft Edge TTS provider (free fallback)
│       ├── voice_detector.py     # Voice/speech detection in audio
│       ├── voice_cloning_service.py # Voice cloning capabilities
│       ├── subtitle_styler.py    # FFmpeg subtitle filter builder with styling
│       ├── video_filters.py      # Video enhancement: denoise, sharpen, color
│       ├── audio_normalizer.py   # Audio loudness measurement and normalization
│       ├── encoding_presets.py   # Export presets (Instagram, TikTok, YouTube, etc.)
│       ├── srt_validator.py      # SRT subtitle validation
│       ├── silence_remover.py    # Remove silence from audio
│       ├── keyword_matcher.py    # Keyword extraction for segment analysis
│       ├── vocal_remover.py      # Vocal/instrument separation
│       ├── tts/                  # TTS provider implementations
│       │   ├── base.py           # TTSProvider abstract base class
│       │   ├── elevenlabs.py     # ElevenLabs implementation
│       │   ├── edge.py           # Edge TTS implementation
│       │   ├── kokoro.py         # Kokoro TTS implementation
│       │   ├── coqui.py          # Coqui XTTS implementation
│       │   └── factory.py        # Factory function: get_tts_provider()
│       └── __init__.py           # Service exports
│
├── frontend/                     # Next.js React frontend application
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages
│   │   │   ├── layout.tsx        # Root layout: AuthProvider, ProfileProvider, styles
│   │   │   ├── page.tsx          # Home/landing page (~2000 lines)
│   │   │   ├── library/page.tsx  # Main workflow: projects, clips, rendering
│   │   │   ├── segments/page.tsx # Manual segment selection UI
│   │   │   ├── settings/page.tsx # User settings
│   │   │   ├── usage/page.tsx    # Usage/cost dashboard
│   │   │   ├── auth/             # Auth pages (login, signup)
│   │   │   └── [other pages]     # Static pages (pricing, features, contact, etc.)
│   │   ├── components/           # React components (Shadcn/UI + custom)
│   │   │   ├── auth-provider.tsx # Supabase auth context wrapper
│   │   │   ├── profile-switcher.tsx # Multi-profile selector
│   │   │   ├── navbar.tsx        # Navigation bar
│   │   │   ├── subtitle-enhancement-controls.tsx # Phase 11: subtitle styling UI
│   │   │   ├── video-enhancement-controls.tsx # Phase 9: video filter UI
│   │   │   ├── video-processing/ # Video processing sub-components
│   │   │   │   ├── variant-triage.tsx # Clip selection UI
│   │   │   │   ├── subtitle-editor.tsx # SRT editor
│   │   │   │   ├── tts-panel.tsx # TTS configuration
│   │   │   │   ├── progress-tracker.tsx # Job progress display
│   │   │   │   └── secondary-videos-form.tsx # Additional video input
│   │   │   ├── ui/               # Shadcn/UI components (button, dialog, tabs, etc.)
│   │   │   └── tts/              # TTS-specific components
│   │   ├── contexts/             # React Context providers
│   │   │   └── profile-context.tsx # Multi-tenancy context + localStorage
│   │   ├── hooks/                # Custom React hooks
│   │   │   └── use-job-polling.ts # Poll job status until completion
│   │   ├── lib/                  # Utilities and API client
│   │   │   ├── api.ts            # API client wrapper (apiFetch, apiPost, apiGet, etc.)
│   │   │   ├── supabase/         # Supabase integration
│   │   │   └── utils.ts          # General utilities
│   │   ├── types/                # TypeScript interfaces
│   │   │   └── video-processing.ts # VideoInfo, Clip, Project, SubtitleSettings, etc.
│   │   ├── globals.css           # Global Tailwind styles
│   │   └── proxy.ts              # Proxy configuration (if needed)
│   ├── public/                   # Static assets
│   ├── tests/                    # Playwright E2E tests
│   │   ├── library.spec.ts       # Library page tests
│   │   ├── segments.spec.ts      # Segments page tests
│   │   └── [other tests]         # Feature-specific test files
│   ├── playwright.config.ts      # Playwright configuration
│   ├── tsconfig.json             # TypeScript configuration
│   ├── next.config.ts            # Next.js configuration
│   ├── eslint.config.mjs         # ESLint configuration
│   └── package.json              # Frontend dependencies

├── supabase/                     # Database migrations and config
│   └── migrations/               # Database schema migrations (SQL)
│       ├── 001_init_projects.sql # Projects table
│       ├── 002_init_clips.sql    # Clips table
│       ├── 003_init_jobs.sql     # Jobs table
│       ├── 004_init_costs.sql    # API costs table
│       └── [other migrations]    # Additional schema changes

├── CAPTIONS_AENEAS/              # Standalone caption UI (Tkinter)
│   └── caption_ui.py             # Standalone caption generator

├── scripts/                      # Development and utility scripts
│   ├── start-dev.bat             # Windows development startup
│   └── start-dev.sh              # Linux/WSL development startup

├── temp/                         # Temporary files (gitignored)
│   ├── {profile_id}/             # Profile-scoped temp directory
│   └── ...                       # FFmpeg intermediate files, extracts

├── output/                       # Final video outputs (gitignored)
│   ├── project_{id}/             # Per-project output folder
│   ├── tts/                      # TTS audio files
│   └── thumbnails/               # Generated thumbnails

├── input/                        # Upload staging directory (gitignored)
│   └── ...                       # Uploaded videos pending processing

├── logs/                         # Application logs (gitignored)
│   ├── cost_log.json             # Cost tracking JSON log
│   └── ...                       # Uvicorn/application logs

├── ffmpeg/                       # FFmpeg binary (Windows, optional)
│   └── ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe

├── requirements.txt              # Python backend dependencies
├── .env.example                  # Environment variables template
├── .mcp.json                     # Claude MCP configuration
├── CLAUDE.md                     # Claude instructions (this file)
├── run.py                        # Backend entry point
└── .planning/                    # GSD planning documents
    └── codebase/                 # Codebase analysis documents
        ├── ARCHITECTURE.md       # Architecture patterns and data flow
        ├── STRUCTURE.md          # Directory layout and file locations
        ├── CONVENTIONS.md        # Coding conventions and patterns
        ├── TESTING.md            # Testing setup and patterns
        ├── STACK.md              # Technology stack details
        ├── INTEGRATIONS.md       # External service integrations
        └── CONCERNS.md           # Technical debt and issues
```

## Directory Purposes

**`app/`:**
- Purpose: FastAPI backend application
- Contains: Route handlers, services, configuration, data models
- Key files: `main.py` (entry), `config.py` (settings)

**`app/api/`:**
- Purpose: HTTP endpoint handlers organized by domain
- Contains: 6 router files, auth module
- Entry via `main.py` mounting all routers with `/api/v1` prefix

**`app/services/`:**
- Purpose: Business logic and external service integrations
- Contains: 23 service files implementing video processing, TTS, storage, etc.
- Pattern: Singleton factory functions (not FastAPI Depends) for instantiation

**`frontend/src/app/`:**
- Purpose: Next.js App Router pages and layouts
- Contains: 13 page directories, root layout.tsx
- Key pages: `library/page.tsx` (main workflow), `page.tsx` (home)

**`frontend/src/components/`:**
- Purpose: Reusable React components
- Contains: Shadcn/UI components, custom components, video processing sub-components
- Usage: Composed into pages

**`frontend/src/contexts/`:**
- Purpose: React Context for global state
- Contains: ProfileProvider for multi-tenancy + localStorage
- Pattern: Context + useContext hook for consumption

**`frontend/src/lib/`:**
- Purpose: Shared utilities and integration clients
- Contains: API client wrapper, Supabase integration
- Key file: `api.ts` (all HTTP requests flow through here)

**`frontend/src/types/`:**
- Purpose: TypeScript type definitions
- Contains: All shared interfaces (Project, Clip, SubtitleSettings, etc.)
- Key file: `video-processing.ts` (domain types)

**`supabase/migrations/`:**
- Purpose: Database schema versioning
- Contains: SQL migration files numbered sequentially
- Applied: Run `supabase db push` to apply

**`temp/`:**
- Purpose: Profile-scoped temporary file storage
- Contains: FFmpeg intermediates, frame extracts, audio files
- Cleanup: Managed by routes.py cleanup tasks (not automatic)

**`output/`:**
- Purpose: Final rendered video outputs
- Contains: Per-project folders, thumbnails, TTS audio files
- Served via: `GET /library/files/{file_path}` endpoint

## Key File Locations

**Entry Points:**
- Backend: `app/main.py` (FastAPI app initialization)
- Frontend: `frontend/src/app/layout.tsx` (root layout)
- Backend start: `run.py` (uvicorn wrapper with FFmpeg PATH setup)
- Frontend start: `frontend/package.json` → `npm run dev`

**Configuration:**
- Backend: `app/config.py` (Pydantic Settings from .env)
- Frontend: `frontend/tsconfig.json`, `frontend/next.config.ts`
- Build: `requirements.txt` (backend), `frontend/package.json` (frontend)

**Core Logic:**
- Video analysis: `app/services/video_processor.py` (frame scoring, segment detection)
- Rendering: `app/api/library_routes.py` (final_render_task, _render_with_preset)
- TTS: `app/services/tts/` (provider abstraction and implementations)
- API client: `frontend/src/lib/api.ts` (all HTTP requests)

**Testing:**
- Playwright tests: `frontend/tests/` (*.spec.ts files)
- Config: `frontend/playwright.config.ts`
- Screenshot storage: `frontend/screenshots/`

## Naming Conventions

**Files:**
- Backend modules: `snake_case.py` (e.g., `video_processor.py`, `elevenlabs_tts.py`)
- Frontend components: `PascalCase.tsx` (e.g., `VideoEnhancementControls.tsx`)
- Pages: `page.tsx` (Next.js convention)
- Hooks: `camelCase.ts` with `use-` prefix (e.g., `use-job-polling.ts`)

**Directories:**
- Backend packages: `snake_case/` (e.g., `app/services/`, `app/api/`)
- Frontend pages: `kebab-case/` (e.g., `library/`, `segments/`, `auth/`)
- Feature directories: `kebab-case/` with index export (e.g., `tts/`, `video-processing/`)

**Variables & Functions:**
- Python: `snake_case` for functions/variables, `PascalCase` for classes
- TypeScript: `camelCase` for functions/variables, `PascalCase` for types/components/classes

**Constants:**
- Python: `UPPER_SNAKE_CASE` for module-level constants
- TypeScript: `UPPER_SNAKE_CASE` for constants, `PascalCase` for type/interface names

## Where to Add New Code

**New Video Processing Feature:**
- Primary code: `app/services/video_*.py` (create new service if needed)
- API integration: Add endpoint to `app/api/library_routes.py` or `app/api/routes.py`
- Frontend: Create component in `frontend/src/components/` or sub-directory
- Types: Add types to `frontend/src/types/video-processing.ts`
- Example: To add a new filter:
  1. Implement in `app/services/video_filters.py`
  2. Add UI control in `frontend/src/components/video-enhancement-controls.tsx`
  3. Pass parameters through `POST /library/clips/{id}/render`
  4. Apply in `_render_final_clip_task()` FFmpeg chain

**New Backend Service:**
- Location: `app/services/{service_name}.py`
- Pattern: Create class with methods, export singleton factory function `get_{service_name}()`
- Integration: Import and call from `app/api/` routes
- Example: `app/services/elevenlabs_tts.py` → `from app.services.elevenlabs_tts import get_elevenlabs_tts`

**New API Endpoint:**
- Location: Choose router based on domain:
  - Library workflow: `app/api/library_routes.py`
  - Video processing: `app/api/routes.py`
  - Segments: `app/api/segments_routes.py`
  - Publishing: `app/api/postiz_routes.py`
  - Profiles: `app/api/profile_routes.py`
- Pattern: Define route handler with `@router.get/post/patch` decorator
- Auth: Add `Depends(get_profile_context)` for multi-tenant isolation
- Example: See `@router.post("/projects", response_model=ProjectResponse)` in library_routes.py

**New Frontend Page:**
- Location: `frontend/src/app/{page_name}/page.tsx`
- Pattern: Create directory, add `page.tsx`, optionally add `layout.tsx`
- Entry: Next.js App Router automatically routes `/app/{page_name}` → page.tsx
- Example: `/library` served by `frontend/src/app/library/page.tsx`

**New Frontend Component:**
- Location: `frontend/src/components/{component_name}.tsx` or sub-directory
- Pattern: Export React component, use Shadcn/UI for styling
- Usage: Import and compose into pages
- Example: VideoEnhancementControls in `frontend/src/components/video-enhancement-controls.tsx`

**Shared Utilities:**
- Frontend: `frontend/src/lib/` (api.ts for HTTP, utils.ts for helpers)
- Backend: `app/services/` (domain-specific), or add utility module if needed
- Types: `frontend/src/types/video-processing.ts`

## Special Directories

**`temp/`:**
- Purpose: Profile-scoped temporary storage
- Structure: `temp/{profile_id}/` for each profile
- Generated: Yes (created by routes.py)
- Committed: No (gitignored)
- Cleanup: Manual via delete endpoints or periodic batch jobs

**`output/`:**
- Purpose: Final video and asset output
- Structure: `output/project_{project_id}/`, `output/tts/`, `output/thumbnails/`
- Generated: Yes (by rendering tasks)
- Committed: No (gitignored)
- Served via: `GET /library/files/{file_path}` with directory traversal protection

**`logs/`:**
- Purpose: Application logging
- Structure: `cost_log.json` (cost tracking), stdout (uvicorn logs)
- Generated: Yes (by services and middleware)
- Committed: No (gitignored)
- Retention: Manual cleanup or rotation policy

**`.next/`:**
- Purpose: Next.js build cache and development server state
- Generated: Yes (by `npm run dev` or `npm run build`)
- Committed: No (gitignored)
- Note: Lock file at `.next/dev/lock` can block restarts, delete if stuck

**`node_modules/`:**
- Purpose: npm package dependencies
- Generated: Yes (by `npm install`)
- Committed: No (gitignored)
- Install: Run `npm install` from `frontend/` directory

**`venv/`, `venv_linux/`:**
- Purpose: Python virtual environment
- Generated: Yes (by `python -m venv`)
- Committed: No (gitignored)
- Activation: `source venv/bin/activate` (Linux/WSL), `venv\Scripts\activate` (Windows)

---

*Structure analysis: 2026-02-12*
