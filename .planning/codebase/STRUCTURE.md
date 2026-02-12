# Codebase Structure

**Analysis Date:** 2026-02-12

## Directory Layout

```
edit_factory/
├── app/                           # FastAPI backend
│   ├── main.py                    # FastAPI app initialization
│   ├── config.py                  # Settings and environment config
│   ├── models.py                  # Pydantic data models
│   ├── api/                       # Route handlers (8 modules)
│   │   ├── auth.py                # JWT verification, profile context
│   │   ├── routes.py              # Core video processing, costs, jobs
│   │   ├── library_routes.py      # Project/clip CRUD, rendering
│   │   ├── segments_routes.py     # Manual segment selection
│   │   ├── postiz_routes.py       # Social media publishing
│   │   ├── profile_routes.py      # User profiles
│   │   ├── script_routes.py       # Script generation
│   │   ├── assembly_routes.py     # Assembly endpoints
│   │   ├── pipeline_routes.py     # Multi-variant pipeline
│   │   ├── tts_routes.py          # TTS operations
│   │   └── __init__.py
│   └── services/                  # Business logic (40+ modules)
│       ├── video_processor.py     # Video analysis, scoring
│       ├── script_generator.py    # AI script generation
│       ├── assembly_service.py    # Script-to-video orchestration
│       ├── job_storage.py         # Job persistence layer
│       ├── cost_tracker.py        # API cost tracking
│       ├── gemini_analyzer.py     # Gemini AI analysis (optional)
│       ├── postiz_service.py      # Social publishing
│       ├── tts_subtitle_generator.py # TTS + SRT generation
│       ├── subtitle_styler.py     # Subtitle rendering with FFmpeg
│       ├── video_filters.py       # Denoise, sharpen, color
│       ├── audio_normalizer.py    # Loudness normalization
│       ├── encoding_presets.py    # FFmpeg encoding configs
│       ├── voice_detector.py      # Voice/silence detection
│       ├── vocal_remover.py       # Audio background removal
│       ├── silence_remover.py     # Silence trimming
│       ├── srt_validator.py       # SRT format validation
│       ├── keyword_matcher.py     # Script-to-segment matching
│       ├── edge_tts_service.py    # Microsoft Edge TTS
│       ├── elevenlabs_tts.py      # ElevenLabs TTS (legacy)
│       ├── tts_cache.py           # TTS audio caching
│       ├── voice_cloning_service.py # Voice cloning
│       ├── tts/                   # TTS factory pattern
│       │   ├── base.py            # Abstract TTS provider
│       │   ├── factory.py         # TTS factory
│       │   ├── elevenlabs.py      # ElevenLabs provider
│       │   ├── edge.py            # Edge TTS provider
│       │   ├── coqui.py           # Coqui provider
│       │   ├── kokoro.py          # Kokoro provider
│       │   └── __init__.py
│       └── __init__.py
├── frontend/                      # Next.js frontend
│   ├── package.json               # Dependencies
│   ├── playwright.config.ts       # E2E test config
│   ├── next.config.js             # Next.js config
│   ├── src/
│   │   ├── app/                   # Next.js App Router pages
│   │   │   ├── layout.tsx         # Root layout with providers
│   │   │   ├── page.tsx           # Home page
│   │   │   ├── library/page.tsx   # Library (legacy)
│   │   │   ├── librarie/page.tsx  # Library (main)
│   │   │   ├── pipeline/page.tsx  # Multi-variant pipeline
│   │   │   ├── scripts/page.tsx   # AI script generation
│   │   │   ├── assembly/page.tsx  # Assembly preview/render
│   │   │   ├── segments/page.tsx  # Segment selection
│   │   │   ├── usage/page.tsx     # Cost tracking
│   │   │   ├── settings/page.tsx  # User settings
│   │   │   ├── login/page.tsx     # Auth login
│   │   │   ├── signup/page.tsx    # Auth signup
│   │   │   ├── auth/callback/route.ts # OAuth callback
│   │   │   ├── contact/page.tsx   # Contact form
│   │   │   ├── cum-functioneaza/page.tsx # How it works
│   │   │   ├── functionalitati/page.tsx  # Features
│   │   │   ├── preturi/page.tsx   # Pricing
│   │   │   ├── testimoniale/page.tsx # Testimonials
│   │   │   ├── statsai/page.tsx   # Stats dashboard
│   │   │   └── globals.css        # Global styles
│   │   ├── components/            # React components
│   │   │   ├── navbar.tsx         # Navigation bar
│   │   │   ├── navbar-wrapper.tsx # Nav wrapper
│   │   │   ├── auth-provider.tsx  # Supabase auth provider
│   │   │   ├── profile-switcher.tsx # Profile selector
│   │   │   ├── create-profile-dialog.tsx # Profile creation modal
│   │   │   ├── editor-layout.tsx  # Editor container
│   │   │   ├── video-segment-player.tsx # Video preview
│   │   │   ├── segment-marker-popup.tsx # Segment UI
│   │   │   ├── simple-segment-popup.tsx # Simplified segment UI
│   │   │   ├── video-enhancement-controls.tsx # Video filters UI
│   │   │   ├── subtitle-enhancement-controls.tsx # Subtitle UI
│   │   │   ├── video-processing/  # Video processing components
│   │   │   ├── tts/               # TTS UI components
│   │   │   └── ui/                # Shadcn/UI base components
│   │   ├── contexts/              # React context providers
│   │   │   ├── profile-context.tsx # Multi-profile state
│   │   │   └── other contexts
│   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── use-job-polling.ts # Job status polling
│   │   │   └── other hooks
│   │   ├── lib/                   # Utilities
│   │   │   ├── api.ts             # HTTP client wrapper
│   │   │   └── other utilities
│   │   ├── types/                 # TypeScript types
│   │   │   ├── video-processing.ts # Video-related types
│   │   │   └── other types
│   │   └── proxy.ts               # API proxy config
│   └── tests/                     # Playwright E2E tests
│       ├── test-*.spec.ts         # Test files
│       ├── verify-*.spec.ts       # Verification tests
│       └── debug-*.spec.ts        # Debug utilities
├── CAPTIONS_AENEAS/               # Standalone caption generator (Tkinter)
│   ├── caption_ui.py              # Main UI
│   └── .venv/                     # Isolated Python env
├── supabase/                      # Supabase migrations
│   └── migrations/                # SQL migration files
├── ffmpeg/                        # FFmpeg binaries (Windows)
│   └── ffmpeg-master-latest-win64-gpl/bin/
├── scripts/                       # Utility scripts
├── static/                        # Static assets
├── input/                         # Input video directory
├── output/                        # Output video directory
├── temp/                          # Temporary files (profile-scoped)
├── logs/                          # Application logs
├── requirements.txt               # Python dependencies
├── package.json                   # Frontend root dependencies
├── .env.example                   # Environment template
├── run.py                         # Backend startup script
├── start-dev.sh/.bat              # Start both backend + frontend
└── CLAUDE.md                      # Project guidance for Claude
```

## Directory Purposes

**app/ - FastAPI Backend:**
- Purpose: Server-side application logic, API endpoints, service orchestration
- Contains: Route handlers, business services, configuration
- Key files: `main.py` (entry), `config.py` (settings), `models.py` (types)

**app/api/ - Route Handlers:**
- Purpose: HTTP endpoint definitions and request/response handling
- Contains: 9 separate router modules for different functional areas
- Key files: `auth.py` (JWT + profile context), `library_routes.py` (main CRUD)

**app/services/ - Business Logic:**
- Purpose: Core functionality implementation, external API integration
- Contains: Video processing, AI script generation, assembly, audio processing
- Pattern: Service classes with factory functions for singleton instantiation

**app/services/tts/ - Text-to-Speech Abstraction:**
- Purpose: Pluggable TTS provider support
- Pattern: Factory pattern with unified interface across providers
- Implementations: ElevenLabs, Edge (Microsoft), Coqui, Kokoro

**frontend/src/app/ - Next.js Pages:**
- Purpose: Public-facing user interface pages
- Pattern: File-based routing (Next.js App Router)
- Key pages: `librarie/page.tsx` (main editor), `pipeline/page.tsx` (workflow)

**frontend/src/components/ - React Components:**
- Purpose: Reusable UI components for pages
- Pattern: Component tree with prop-based composition
- Key files: `navbar.tsx` (navigation), `ui/` (Shadcn base components)

**frontend/src/contexts/ - React Context Providers:**
- Purpose: Global state management (Supabase auth, profile selection)
- Key files: `profile-context.tsx` (multi-tenant profile state)

**frontend/src/lib/ - Utilities:**
- Purpose: Helper functions and API client
- Key file: `api.ts` (HTTP wrapper with profile ID injection)

**frontend/src/types/ - TypeScript Definitions:**
- Purpose: Shared type definitions across components
- Key file: `video-processing.ts` (video processing types)

**frontend/tests/ - End-to-End Tests:**
- Purpose: Playwright browser automation tests
- Pattern: Visual verification of UI changes
- Run: `npm run test` or `npm run test:ui`

**CAPTIONS_AENEAS/ - Standalone Caption Module:**
- Purpose: Separate Tkinter app for caption generation with Whisper
- Pattern: Isolated Python environment with dedicated dependencies
- Run: `python caption_ui.py`

**supabase/ - Database Migrations:**
- Purpose: Version-controlled database schema changes
- Contains: SQL migration files
- Pattern: Numbered sequentially (001_*, 002_*, etc.)

## Key File Locations

**Entry Points:**
- `app/main.py`: Backend FastAPI application
- `frontend/src/app/layout.tsx`: Frontend root layout
- `run.py`: Development server launcher for backend
- `start-dev.sh` (WSL/Linux): Launch both services

**Configuration:**
- `app/config.py`: Environment settings and path management
- `frontend/next.config.js`: Next.js build configuration
- `frontend/tsconfig.json`: TypeScript configuration
- `.env.example`: Environment variable template

**Core Logic:**
- `app/services/video_processor.py`: Video analysis and scoring
- `app/services/script_generator.py`: AI script generation
- `app/services/assembly_service.py`: Script-to-video orchestration
- `frontend/src/lib/api.ts`: HTTP client with profile injection

**Testing:**
- `frontend/tests/`: Playwright test files (*.spec.ts)
- `frontend/playwright.config.ts`: Test configuration
- `app/` - No unit tests checked in (manual QA via Playwright)

**Authentication:**
- `app/api/auth.py`: JWT verification and profile context
- `frontend/src/components/auth-provider.tsx`: Supabase Auth UI
- `frontend/src/contexts/profile-context.tsx`: Profile state management

## Naming Conventions

**Files:**
- Python: `snake_case.py` (e.g., `video_processor.py`)
- TypeScript: `kebab-case.tsx` or `kebab-case.ts` (e.g., `profile-context.tsx`)
- Components: PascalCase exports (e.g., `export function NavBar`)
- Pages: Lowercase directory, `page.tsx` (e.g., `frontend/src/app/librarie/page.tsx`)

**Directories:**
- Python packages: `lowercase` (e.g., `app/services/`)
- Frontend features: `lowercase` (e.g., `frontend/src/app/librarie/`)
- Components subdirs: `kebab-case` (e.g., `components/video-processing/`)

**Functions & Variables:**
- Python: `snake_case` functions, `UPPER_CASE` constants
- TypeScript: `camelCase` functions, `PascalCase` types/classes
- Props: `camelCase`

**API Routes:**
- Pattern: `/api/v1/{resource}/{action}`
- Examples: `/api/v1/library/projects`, `/api/v1/pipeline/generate`
- HTTP Methods: POST (create), GET (read), PUT (update), DELETE (remove)

**Environment Variables:**
- Pattern: `UPPER_SNAKE_CASE`
- Examples: `GEMINI_API_KEY`, `SUPABASE_URL`, `AUTH_DISABLED`

## Where to Add New Code

**New Video Processing Feature:**
- Implementation: `app/services/[feature_name].py`
- Register: Import and use in `app/api/routes.py` or relevant router
- Tests: `frontend/tests/[feature].spec.ts` (Playwright)

**New Frontend Page:**
- Page: `frontend/src/app/[feature]/page.tsx`
- Components: `frontend/src/components/[feature]/component-name.tsx`
- Hooks: `frontend/src/hooks/use-feature.ts`
- Types: Add to `frontend/src/types/video-processing.ts`

**New API Route:**
- Router file: `app/api/[feature]_routes.py`
- Register: Add `app.include_router(router, prefix="/api/v1")` in `app/main.py`
- Authentication: Add `Depends(get_profile_context)` to protected endpoints
- Profile context: Store profile_id in service calls for multi-tenant isolation

**New Service Integration:**
- Service file: `app/services/[external_service].py`
- Factory function: `def get_[service]() -> ServiceClass:` for singleton
- Error handling: Try/except with graceful fallback (no hard failures)
- Testing: Add Playwright integration test if user-facing

**New Database Table:**
- Migration: `supabase/migrations/XXX_[description].sql`
- Schema: Add table with UUID primary key, profile_id foreign key
- Queries: Use `get_supabase()` lazy client in services
- Multi-tenancy: Always scope queries to profile_id

## Special Directories

**temp/ - Profile-Scoped Temporary Files:**
- Purpose: Working directory for video processing per profile
- Generated: Yes (created at runtime)
- Committed: No (.gitignore)
- Pattern: `temp/{profile_id}/` to prevent cross-profile collisions

**input/ - Source Videos:**
- Purpose: User-uploaded video files
- Generated: Yes (uploaded by users)
- Committed: No (.gitignore)

**output/ - Rendered Videos:**
- Purpose: Final processed videos available for download
- Generated: Yes (by render endpoints)
- Committed: No (.gitignore)

**logs/ - Application Logs:**
- Purpose: Server and processing logs
- Generated: Yes (at runtime)
- Committed: No (.gitignore)
- Key files: `cost_log.json` (API costs)

**static/ - Static Assets:**
- Purpose: Images, icons, public files served by FastAPI
- Committed: Yes (in version control)
- Mount point: `/static` in `app/main.py`

**frontend/.next/ - Next.js Build Cache:**
- Purpose: Compiled frontend assets
- Generated: Yes (by `npm run build`)
- Committed: No (.gitignore)
- Note: `frontend/.next/dev/lock` can block dev server restarts - delete if stuck

**supabase/migrations/ - Database Versioning:**
- Purpose: Track database schema changes
- Committed: Yes (in version control)
- Pattern: Sequential numbering (001_init.sql, 002_add_profiles.sql, etc.)

---

*Structure analysis: 2026-02-12*
