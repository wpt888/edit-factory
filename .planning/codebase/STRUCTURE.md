# Codebase Structure

**Analysis Date:** 2026-02-03

## Directory Layout

```
edit_factory/
├── app/                          # FastAPI backend application
│   ├── main.py                   # FastAPI app initialization, router registration
│   ├── config.py                 # Pydantic settings from environment variables
│   ├── models.py                 # Pydantic request/response models
│   ├── api/                      # HTTP route handlers
│   │   ├── __init__.py
│   │   ├── routes.py             # Core endpoints: video analysis, costs, usage, health
│   │   ├── library_routes.py     # Project/clip CRUD, rendering, export workflow
│   │   ├── segments_routes.py    # Manual video segment selection system
│   │   ├── postiz_routes.py      # Social media publishing integration
│   │   └── auth.py               # JWT verification, user extraction, auth dependencies
│   └── services/                 # Business logic and external integrations
│       ├── __init__.py
│       ├── video_processor.py    # Core: motion detection, variance, perceptual hashing
│       ├── gemini_analyzer.py    # Gemini Vision API integration for frame analysis
│       ├── elevenlabs_tts.py     # Premium TTS with voice cloning
│       ├── edge_tts_service.py   # Microsoft Edge TTS fallback
│       ├── voice_detector.py     # Silero VAD for speech detection
│       ├── voice_cloning_service.py  # Voice cloning setup and management
│       ├── silence_remover.py    # Audio silence removal and compression
│       ├── vocal_remover.py      # Demucs-based vocal/music separation
│       ├── job_storage.py        # Persistent job tracking (Supabase + in-memory fallback)
│       ├── cost_tracker.py       # API cost logging (ElevenLabs, Gemini)
│       ├── postiz_service.py     # Postiz social media platform abstraction
│       ├── keyword_matcher.py    # Clip search and filtering
│       └── srt_validator.py      # SRT subtitle format validation
│
├── frontend/                     # Next.js application (React 19, Tailwind v4)
│   ├── public/                   # Static assets (favicon, images)
│   ├── src/
│   │   ├── app/                  # Next.js App Router pages
│   │   │   ├── layout.tsx        # Root layout with fonts, providers, navbar
│   │   │   ├── page.tsx          # Home/landing page
│   │   │   ├── globals.css       # Global styles and Tailwind config
│   │   │   ├── library/
│   │   │   │   └── page.tsx      # Main library interface (projects, clips, rendering)
│   │   │   ├── librarie/         # Romanian version of library (deprecated?)
│   │   │   │   └── page.tsx
│   │   │   ├── segments/
│   │   │   │   └── page.tsx      # Manual segment selection interface
│   │   │   ├── usage/
│   │   │   │   └── page.tsx      # Cost tracking and API usage dashboard
│   │   │   ├── statsai/
│   │   │   │   └── page.tsx      # AI analytics dashboard
│   │   │   ├── auth/
│   │   │   │   └── callback/     # OAuth callback handler
│   │   │   │       └── route.ts
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── signup/
│   │   │   │   └── page.tsx
│   │   │   ├── functionalitati/  # Features page (Romanian)
│   │   │   │   └── page.tsx
│   │   │   ├── preturi/          # Pricing page
│   │   │   │   └── page.tsx
│   │   │   ├── contact/          # Contact form page
│   │   │   │   └── page.tsx
│   │   │   ├── cum-functioneaza/ # How it works (Romanian)
│   │   │   │   └── page.tsx
│   │   │   └── testimoniale/     # Testimonials
│   │   │       └── page.tsx
│   │   ├── components/           # Reusable React components
│   │   │   ├── navbar.tsx        # Top navigation bar
│   │   │   ├── auth-provider.tsx # Authentication context/provider
│   │   │   ├── editor-layout.tsx # Layout wrapper for editor pages
│   │   │   ├── navbar-wrapper.tsx
│   │   │   ├── video-segment-player.tsx      # Video playback with segment markers
│   │   │   ├── simple-segment-popup.tsx      # Segment selection popup
│   │   │   ├── segment-marker-popup.tsx      # Segment marker UI
│   │   │   ├── video-processing/            # Video workflow components
│   │   │   │   ├── subtitle-editor.tsx      # SRT/VTT editing interface
│   │   │   │   ├── tts-panel.tsx            # TTS generation controls
│   │   │   │   ├── progress-tracker.tsx     # Job progress display
│   │   │   │   ├── variant-triage.tsx       # Variant selection UI
│   │   │   │   └── secondary-videos-form.tsx
│   │   │   └── ui/                          # Shadcn/UI primitives
│   │   │       ├── button.tsx, card.tsx, input.tsx, etc.
│   │   │       ├── dropdown-menu.tsx (newly added)
│   │   │       ├── dialog.tsx, popover.tsx, etc.
│   │   │       └── ... (20+ UI components)
│   │   ├── hooks/                # Custom React hooks
│   │   ├── lib/                  # Utilities and API client
│   │   │   ├── api.ts            # API fetch wrapper (apiFetch, apiGet, apiPost, etc.)
│   │   │   └── supabase/         # Supabase client initialization
│   │   └── types/                # TypeScript type definitions
│   ├── tests/                    # Playwright end-to-end tests
│   │   ├── debug-page-structure.spec.ts
│   │   ├── test-delete-click.spec.ts
│   │   ├── test-delete-hover.spec.ts
│   │   ├── test-multi-select.spec.ts
│   │   ├── test-toast-and-postiz.spec.ts
│   │   ├── test-toast-only.spec.ts
│   │   ├── verify-librarie-delete.spec.ts
│   │   └── (more test files)
│   ├── screenshots/              # Playwright test screenshots and artifacts
│   ├── playwright.config.ts      # Playwright test configuration
│   ├── playwright-report/        # Test execution reports
│   ├── next.config.js            # Next.js build configuration
│   ├── tsconfig.json             # TypeScript configuration
│   ├── tailwind.config.ts        # Tailwind CSS configuration
│   ├── package.json              # Dependencies: next, react, shadcn, playwright, etc.
│   └── package-lock.json
│
├── CAPTIONS_AENEAS/              # Standalone caption generation module
│   ├── caption_ui.py             # Tkinter GUI for caption editing
│   ├── dynamic_captions.py       # Whisper transcription engine
│   ├── caption_preview.py        # Preview tool
│   ├── text_correction.py        # Grammar correction
│   └── .venv/                    # Python virtual environment
│
├── Tmux-Orchestrator/            # Development orchestration (tmux helper)
│   ├── Examples/
│   ├── briefings/
│   └── (utility scripts)
│
├── scripts/                      # Utility scripts (if present)
├── input/                        # Video input directory (created at startup)
├── output/                       # Processed video output directory (created at startup)
├── logs/                         # Application logs (created at startup)
├── ffmpeg/                       # Bundled FFmpeg binary
│   └── ffmpeg-master-latest-win64-gpl/
│       ├── bin/                  # ffmpeg.exe, ffprobe.exe
│       ├── doc/
│       └── presets/
│
├── run.py                        # Server launcher (auto-configures FFmpeg PATH)
├── requirements.txt              # Python dependencies
├── .env.example                  # Environment variable template
├── .env                          # Environment configuration (gitignored)
├── CLAUDE.md                     # Project instructions and guidelines
└── README.md                     # Project documentation
```

## Directory Purposes

**app/ (Backend Root):**
- Purpose: FastAPI application code and services
- Contains: Python files for API routes, business logic, configuration
- Key dependency: Services layer (video_processor, TTS, AI integrations)

**app/api/:**
- Purpose: HTTP request/response handling and routing
- Contains: FastAPI route handlers for video processing, library management, segments, publishing
- Responsibilities: Parse requests, call services, return responses, handle errors
- Auth: `app/api/auth.py` provides JWT verification and user extraction
- Naming: `*_routes.py` for grouped endpoints

**app/services/:**
- Purpose: Business logic, algorithms, external API integrations
- Contains: Video analysis, AI services, data persistence, cost tracking
- No direct HTTP handling; called by API routes
- Pattern: Services are singletons or lazy-initialized globals
- Examples:
  - `VideoProcessorService`: Motion/variance scoring, pHash duplicate detection
  - `GeminiVideoAnalyzer`: Frame analysis (optional, fails gracefully if no API key)
  - `ElevenLabsTTSService`: Premium text-to-speech with voice cloning
  - `JobStorage`: Persistent job tracking with Supabase fallback
  - `CostTracker`: API cost aggregation and logging

**frontend/src/app/:**
- Purpose: Next.js App Router pages (filesystem-based routing)
- Contains: Page components (.tsx files), one per route
- Routing: `/library` → `library/page.tsx`, `/segments` → `segments/page.tsx`
- Pattern: Pages use "use client" for client-side state and interactivity

**frontend/src/components/:**
- Purpose: Reusable React components
- Contains: UI primitives (Shadcn), business components (video player, editors)
- Subdirectory `ui/`: Base components from Shadcn library
- Subdirectory `video-processing/`: Domain-specific components for video workflows
- Naming: PascalCase component files (e.g., `VideoSegmentPlayer.tsx`)

**frontend/src/lib/:**
- Purpose: Utilities and shared logic
- Contains: API client (`api.ts`), Supabase initialization, type helpers
- `api.ts` exports: `apiFetch()`, `apiGet()`, `apiPost()`, `apiPatch()`, `apiPut()`, `apiDelete()`

**frontend/tests/:**
- Purpose: Playwright end-to-end tests
- Contains: Test specifications for visual functionality
- Naming: `test-*.spec.ts` or `*.spec.ts`
- Screenshot validation: Tests capture screenshots to `frontend/screenshots/`

## Key File Locations

**Entry Points:**
- Backend: `/mnt/c/OBSID SRL/n8n/edit_factory/run.py` (launcher) → `app/main.py`
- Frontend: `frontend/src/app/layout.tsx` (root layout) and `page.tsx` (home)
- Captions tool: `CAPTIONS_AENEAS/caption_ui.py`

**Configuration:**
- Backend settings: `app/config.py` (loads from `.env`)
- TypeScript config: `frontend/tsconfig.json`
- Tailwind config: `frontend/tailwind.config.ts`
- Playwright config: `frontend/playwright.config.ts`
- Next.js config: `frontend/next.config.js`

**Core Logic:**
- Video analysis: `app/services/video_processor.py` (motion/variance/pHash)
- AI integration: `app/services/gemini_analyzer.py` (frame ranking)
- TTS: `app/services/elevenlabs_tts.py` (voice cloning) or `edge_tts_service.py` (fallback)
- Job tracking: `app/services/job_storage.py` (Supabase + in-memory)
- Social publishing: `app/services/postiz_service.py` (multi-platform scheduling)

**API Endpoints:**
- Video processing: `app/api/routes.py` → `/api/v1/analyze`, `/api/v1/jobs`, `/api/v1/costs`
- Library workflow: `app/api/library_routes.py` → `/api/v1/library/projects`, `/api/v1/library/clips`
- Segments: `app/api/segments_routes.py` → `/api/v1/segments/source-videos`
- Publishing: `app/api/postiz_routes.py` → `/api/v1/postiz/publish`

**Frontend API Client:**
- `frontend/src/lib/api.ts` exports HTTP utilities
- Used throughout components for data fetching
- Base URL: `process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"`

**Testing:**
- Test files location: `frontend/tests/`
- Screenshots location: `frontend/screenshots/`
- Test runner config: `frontend/playwright.config.ts`

## Naming Conventions

**Files:**
- API routes: `*_routes.py` (e.g., `library_routes.py`, `segments_routes.py`)
- Services: `*_service.py` or `*_analyzer.py` (e.g., `video_processor.py`, `gemini_analyzer.py`)
- Frontend components: PascalCase (e.g., `VideoSegmentPlayer.tsx`)
- Pages: `page.tsx` (Next.js convention)
- Tests: `*.spec.ts` (Playwright convention)

**Directories:**
- Backend services: lowercase with underscore (`app/services/`)
- Frontend components: lowercase with hyphen (`components/video-processing/`)
- Pages: lowercase (e.g., `library/`, `segments/`)
- UI library: `ui/` subdirectory in components

**Python:**
- Classes: PascalCase (e.g., `VideoProcessorService`, `GeminiVideoAnalyzer`)
- Functions: snake_case (e.g., `get_processor()`, `compute_phash()`)
- Constants: UPPER_SNAKE_CASE (e.g., `ELEVENLABS_COST_PER_CHAR`)
- Model fields: snake_case (Pydantic convention)

**TypeScript/React:**
- Components: PascalCase (e.g., `VideoSegmentPlayer`)
- Functions: camelCase (e.g., `apiFetch()`, `useVideoPlayer()`)
- Constants: UPPER_SNAKE_CASE or camelCase depending on scope
- Interfaces/types: PascalCase

## Where to Add New Code

**New Video Processing Feature:**
- Algorithm logic: `app/services/video_processor.py` (add new method to `VideoProcessorService`)
- API endpoint: `app/api/routes.py` (add `@router.post()` handler)
- Model: `app/models.py` (add request/response Pydantic models)
- Tests: `frontend/tests/test-feature.spec.ts` with Playwright

**New Library/Project Management Feature:**
- Business logic: `app/services/` (new file if complex, else extend existing)
- Routes: `app/api/library_routes.py` (add endpoints under `/api/v1/library`)
- Frontend page: `frontend/src/app/library/page.tsx` or new subdirectory
- UI components: `frontend/src/components/` (reusable), organize by domain
- Tests: `frontend/tests/test-library-*.spec.ts`

**New External Integration:**
- Service wrapper: `app/services/{service_name}_service.py`
  - Example: `postiz_service.py`, `elevenlabs_tts.py`
- Configuration: Add env vars to `app/config.py`
- API endpoint: `app/api/{service}_routes.py` (new router) or existing route file
- Error handling: Implement graceful degradation (fallback or disabled feature)

**New UI Component:**
- Location: `frontend/src/components/`
- If reusable primitive: `frontend/src/components/ui/{component}.tsx`
- If domain-specific: `frontend/src/components/{domain}/{component}.tsx`
- Use Shadcn/UI components as base when possible
- TypeScript: Define prop interfaces

**Utilities:**
- Shared logic: `frontend/src/lib/` (utilities and helpers)
- API layer: `frontend/src/lib/api.ts` (extend with new endpoints)
- Type definitions: `frontend/src/types/` (create if new domain types needed)

## Special Directories

**input/ and output/:**
- Purpose: Video file storage
- Generated: Yes (created at app startup)
- Committed: No (should be in `.gitignore`)
- Lifecycle: Input videos uploaded by users, outputs rendered videos

**logs/:**
- Purpose: Application log files
- Generated: Yes (created at app startup)
- Committed: No (should be in `.gitignore`)
- Contains: Python logging output from FastAPI server

**.env:**
- Purpose: Environment variable configuration
- Generated: No (copy from `.env.example`)
- Committed: No (should be in `.gitignore`)
- Required vars: `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`

**frontend/.next/:**
- Purpose: Next.js build artifacts and cache
- Generated: Yes (created by `npm run build` or `npm run dev`)
- Committed: No (should be in `.gitignore`)
- Contains: Compiled chunks, static assets, server code

**frontend/screenshots/ and playwright-report/:**
- Purpose: Test artifacts
- Generated: Yes (created by `npx playwright test`)
- Committed: No (test outputs, can be regenerated)
- Screenshots: Visual proof of feature functionality

**CAPTIONS_AENEAS/.venv/:**
- Purpose: Isolated Python environment for captions tool
- Generated: Yes (created by `python -m venv .venv`)
- Committed: No (should be in `.gitignore`)
- Usage: Separate from backend, can be independently deployed

---

*Structure analysis: 2026-02-03*
