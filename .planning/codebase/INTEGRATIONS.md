# External Integrations

**Analysis Date:** 2026-02-03

## APIs & External Services

**AI & Content Analysis:**

- **Google Gemini 2.5 Flash** - AI vision model for video scene detection, content analysis
  - SDK/Client: `google-genai` package
  - Implementation: `app/services/gemini_analyzer.py`
  - Config env vars: `GEMINI_API_KEY`, `GEMINI_MODEL`
  - Usage: Analyzes video frames to find best moments for reels/shorts, generates content scores (0-100)
  - Pricing: ~$0.02 per image analyzed
  - Cost tracking: `app/services/cost_tracker.py`

- **OpenAI Whisper** - Speech-to-text transcription
  - SDK/Client: `openai-whisper` package
  - Implementation: Audio processing service (likely `app/services/`)
  - Usage: Generate captions and subtitles (SRT/VTT format)
  - Supports: Multiple languages, tone detection

- **Microsoft Edge TTS** - Free text-to-speech (fallback)
  - SDK/Client: `edge-tts` package
  - Implementation: `app/services/edge_tts_service.py`
  - Languages: Romanian, English, Spanish, French, German, Italian, etc.
  - Voices: Multiple per language
  - No API key required (uses Microsoft Edge service)

- **ElevenLabs TTS** - Premium voice-over generation with voice cloning
  - SDK/Client: HTTP via `httpx` + manual API calls
  - Implementation: `app/services/elevenlabs_tts.py`
  - Config env vars: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`
  - Model: `eleven_multilingual_v2` (multilingual support)
  - Voice settings: Stability (0.57), Similarity (0.75), Style (0.22), Speaker Boost enabled
  - Pricing: ~$0.22 per 1000 characters
  - Cost tracking: `app/services/cost_tracker.py`
  - Endpoint: `https://api.elevenlabs.io/v1`

**Social Media Publishing:**

- **Postiz** - Multi-platform social media publishing
  - SDK/Client: HTTP via `httpx`
  - Implementation: `app/services/postiz_service.py`, `app/api/postiz_routes.py`
  - Config env vars: `POSTIZ_API_URL`, `POSTIZ_API_KEY`
  - Supported platforms: Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Bluesky, Threads
  - Features:
    - Upload videos/media
    - Create posts with captions
    - Schedule posts for future dates
    - List connected social media integrations
  - API endpoints: `/integrations`, `/upload`, `/post`
  - Authentication: Bearer token in Authorization header

**Cloud Storage & Database:**

- **Supabase PostgreSQL** - Project/clip management, job storage, cost tracking
  - SDK/Client: `supabase` package (Python), `@supabase/supabase-js` (JavaScript), `@supabase/ssr` (Next.js)
  - Config env vars: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
  - Implementation:
    - Backend: `app/api/library_routes.py`, `app/services/cost_tracker.py`, `app/services/job_storage.py`
    - Frontend: `frontend/src/lib/supabase/client.ts`, `frontend/src/lib/supabase/server.ts`
  - Tables:
    - `projects` - Video projects (id, name, description, status, target_duration, context_text)
    - `clips` - Video clips/variants (id, project_id, variant_index, raw_video_path, thumbnail_path, duration, is_selected, final_video_path, final_status)
    - `api_costs` - Cost tracking (id, service, operation, cost, metadata)
    - `jobs` - Background job state (id, job_type, status, progress, data (JSONB), created_at, updated_at)
  - Features: Real-time subscriptions, JWT auth, RLS policies
  - Fallback: In-memory storage if Supabase unavailable (`app/services/job_storage.py`)

**Cloud Services (Optional):**

- **Google Drive** - Optional video storage and integration
  - SDK/Client: `google-api-python-client`, `google-auth-oauthlib`
  - Config env vars: `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_CREDENTIALS_PATH`
  - Status: Optional, not required for core functionality

- **Fal.ai** - Alternative TTS provider
  - Config env vars: `FAL_API_KEY`
  - Status: Optional, ElevenLabs/Edge-TTS preferred

## Data Storage

**Databases:**

- **Supabase PostgreSQL** (primary)
  - Connection: `SUPABASE_URL`, `SUPABASE_KEY`
  - ORM/Client: `supabase-py` (Python), `@supabase/supabase-js` (JavaScript)
  - Stores: Projects, clips, costs, job state, user auth
  - RLS: Row-level security via Supabase policies

**File Storage:**

- **Local filesystem** (primary)
  - Input directory: `./input/` (configured via `INPUT_DIR`)
  - Output directory: `./output/` (configured via `OUTPUT_DIR`)
  - Paths auto-created by `app/config.py::Settings.ensure_dirs()`
  - Frontend can request files via API endpoints (`/library/export`, etc.)

- **Supabase Storage** (if configured)
  - Optional for clip thumbnails and videos
  - Not explicitly referenced in core code

**Caching:**

- **Redis** (optional)
  - Connection: `REDIS_URL` (default: `redis://localhost:6379/0`)
  - Purpose: Celery task queue broker
  - Status: Optional, can run without it
  - Health check: `app/api/routes.py` includes Redis availability check

## Authentication & Identity

**Auth Provider:**

- **Supabase Auth** (custom)
  - Implementation:
    - Backend: JWT verification (`app/api/auth.py::verify_jwt_token`, `app/api/auth.py::get_current_user`)
    - Frontend: OAuth callback flow (`frontend/src/app/auth/callback/route.ts`), session management (`frontend/src/components/auth-provider.tsx`)
  - Flow:
    1. User signs up/login via frontend
    2. Supabase returns JWT token
    3. Frontend stores token (Supabase SDK manages)
    4. Each API request includes Bearer token
    5. Backend verifies JWT using `SUPABASE_JWT_SECRET`
  - Token verification algorithm: HS256
  - Audience: `"authenticated"`
  - Config env vars: `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
  - Disabled mode: `auth_disabled: true` in config (development only)

**Routes:**

- `frontend/src/app/login/page.tsx` - Email/password sign in
- `frontend/src/app/signup/page.tsx` - Account creation
- `frontend/src/app/auth/callback/route.ts` - OAuth callback handler
- `frontend/src/components/auth-provider.tsx` - Global auth state management

## Monitoring & Observability

**Error Tracking:**

- Not detected - No explicit error tracking service (Sentry, DataDog, etc.)
- Backend: Logs to stdout via `logging` module
- Cost tracking fallback: Local JSON file if Supabase unavailable

**Logs:**

- **Python logging** (backend)
  - Format: `'%(asctime)s - %(name)s - %(levelname)s - %(message)s'`
  - Level: `INFO` by default
  - Output: Console/stdout
  - Cost log: `./logs/cost_log.json` (JSON format)

- **Browser console** (frontend)
  - React development warnings/errors
  - Playwright test logs stored with trace artifacts

**Job Status Tracking:**

- In-memory progress tracking: `app/api/library_routes.py` (_generation_progress dict)
- Persistent: Supabase `jobs` table or in-memory fallback

## CI/CD & Deployment

**Hosting:**

- Frontend: Docker container (Next.js standalone output)
- Backend: Docker container or direct Python/Uvicorn
- Production URL: `https://editai.obsid.ro`
- CORS origins: Configured via `ALLOWED_ORIGINS` env var

**CI Pipeline:**

- Not detected - No GitHub Actions, GitLab CI, or similar
- Local development uses `npm run dev` and `python run.py`
- Frontend: ESLint for linting, Playwright for E2E testing
- Playwright tests: `frontend/tests/*.spec.ts`

**Build:**

- Backend: `run.py` sets up FFmpeg PATH, launches Uvicorn
- Frontend: `npm run build` creates standalone Next.js output in `.next/`
- Docker deployment: Likely uses Dockerfile (not shown in exploration)

## Environment Configuration

**Required env vars (Backend):**

1. `GEMINI_API_KEY` - Google AI Studio or Google Cloud Console
2. `ELEVENLABS_API_KEY` - ElevenLabs dashboard
3. `ELEVENLABS_VOICE_ID` - ElevenLabs voice selection
4. `SUPABASE_URL` - Supabase project URL
5. `SUPABASE_KEY` - Supabase anon key
6. `SUPABASE_JWT_SECRET` - Supabase Dashboard > Settings > API > JWT Secret

**Required env vars (Frontend):**

1. `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key

**Secrets location:**

- Development: `.env` file (ignored by Git via `.gitignore`)
- Production: Environment variable injection (Docker, K8s, host env)
- Configuration example: `.env.example` checked in
- Frontend example: `frontend/.env.local.example`

## Webhooks & Callbacks

**Incoming:**

- `frontend/src/app/auth/callback/route.ts` - OAuth callback from Supabase
  - Triggered after user clicks email confirmation or OAuth provider redirect
  - Exchanges code for session via `supabase.auth.exchangeCodeForSession(code)`

**Outgoing:**

- Not detected - No explicit webhook sending to external services
- Postiz integration uses REST API calls, not webhooks
- Supabase real-time subscriptions (if used) are pull-based via SDK

## API Rate Limiting & Quotas

**Gemini:**
- Rate limit: Default Google Cloud quotas apply
- Per-request: Limited by batch size (max_frames_per_batch: 30)

**ElevenLabs:**
- Rate limit: API key quotas
- Characters tracked in `cost_tracker.py` for billing

**Postiz:**
- Rate limit: Postiz API quotas (undocumented)

---

*Integration audit: 2026-02-03*
