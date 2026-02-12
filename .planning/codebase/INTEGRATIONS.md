# External Integrations

**Analysis Date:** 2026-02-12

## APIs & External Services

**AI & Content Generation:**
- Google Gemini - Video analysis, script generation
  - SDK/Client: `google-genai` package
  - Auth: `GEMINI_API_KEY` environment variable
  - Model: `gemini-2.5-flash` (configurable via `GEMINI_MODEL` in `app/config.py`)
  - Service class: `app/services/gemini_analyzer.py` (video analysis)
  - Implementation: Frame extraction → batch Gemini requests → segment scoring (0-100)

- Anthropic Claude - Script refinement, alternative script generation
  - SDK/Client: `anthropic` package
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Service class: `app/services/script_generator.py`
  - Used for: AI script enhancement when Gemini not available

**Text-to-Speech (Multiple Options):**
- ElevenLabs TTS - Premium voice synthesis
  - SDK/Client: HTTP via `httpx` (no official SDK installed)
  - Auth: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`
  - Endpoint: `https://api.elevenlabs.io/v1`
  - Service class: `app/services/elevenlabs_tts.py`
  - Model: `eleven_flash_v2_5` (configurable via `ELEVENLABS_MODEL`)
  - Voice settings: Stability 0.57, Similarity 0.75, Style 0.22, Speaker Boost enabled
  - Cost: ~$0.22 per 1000 characters
  - Used by: Subtitle generation, voiceover generation

- Microsoft Edge TTS - Free alternative
  - SDK/Client: `edge-tts` package
  - Auth: None required (100% free)
  - Service class: `app/services/tts/edge.py` (implements TTSService interface)
  - Voices: Multiple languages including en-US, ro-RO, etc.
  - Cost: $0.00 (free fallback)
  - Used by: Fallback when ElevenLabs unavailable

- Coqui XTTS - Voice cloning
  - SDK/Client: `TTS` package (0.22.0+)
  - Auth: None (open source)
  - Requires: PyTorch (transitive dependency)
  - Service class: Integrated in `app/services/voice_cloning_service.py`
  - 17+ language support via librosa

- Kokoro TTS - Fast lightweight TTS
  - SDK/Client: `kokoro` package (0.9.4+)
  - Auth: None
  - Requires: `espeak-ng` system dependency (apt/brew)
  - Alternative TTS option for speed-optimized workflows

**Speech Recognition:**
- OpenAI Whisper - Speech-to-text for subtitle generation
  - SDK/Client: `openai-whisper` package (20231117+)
  - Auth: None (open source)
  - Used by: `app/services/` for caption/SRT generation
  - No API key required, model downloads on first use

**Social Media Publishing:**
- Postiz - Multi-platform social media publishing
  - SDK/Client: HTTP via `httpx`
  - Auth: `POSTIZ_API_URL`, `POSTIZ_API_KEY`
  - Endpoint: Configured via `postiz_api_url` setting
  - Service class: `app/services/postiz_service.py`
  - Platforms: Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Bluesky, Threads
  - Operations: Get integrations, upload media, create posts, schedule content
  - Status: Optional - system works without it

**Alternative TTS Provider:**
- fal.ai - Optional TTS alternative
  - SDK/Client: HTTP client
  - Auth: `FAL_API_KEY`
  - Status: Optional, not currently integrated
  - Configured in: `app/config.py`

**File Sharing:**
- Google Drive - Optional file export/backup
  - SDK/Client: `google-api-python-client`
  - Auth: `google-auth-oauthlib` with service account
  - Credentials: `GOOGLE_CREDENTIALS_PATH` (service account JSON)
  - Folder: `GOOGLE_DRIVE_FOLDER_ID`
  - Status: Optional

## Data Storage

**Databases:**
- PostgreSQL (via Supabase)
  - Provider: Supabase managed PostgreSQL
  - Connection: `supabase_url` in config.py
  - Auth: `supabase_key` (anon client key)
  - Client: `supabase` Python package (2.0.0+)
  - Tables: `projects`, `clips`, `api_costs`, `jobs`, `profiles`, `segments`
  - Lazy-initialized singleton via functions like `get_supabase()` in `app/api/library_routes.py`

**File Storage:**
- Local filesystem only
  - Input: `./input/` directory (configurable via `INPUT_DIR`)
  - Output: `./output/` directory (configurable via `OUTPUT_DIR`)
  - Logs: `./logs/` directory with JSON cost tracking
  - Temp: `./temp/` for FFmpeg concat files
  - In Docker: Volumes mounted at `/app/input`, `/app/output`, `/app/logs`

**Caching:**
- Redis - Optional job queue and caching
  - Connection: `REDIS_URL=redis://localhost:6379/0`
  - Used by: Celery task queue (optional)
  - Status: Optional - FastAPI BackgroundTasks primary, Celery optional

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (PostgreSQL authentication layer)
  - Implementation: Supabase JWT tokens verified server-side
  - JWT Secret: `SUPABASE_JWT_SECRET` - used to verify token signature
  - Flow: Frontend obtains JWT from Supabase → sends in Authorization header → backend verifies via `app/api/auth.py`
  - Token verification: `verify_jwt_token()` function validates HS256 signature, audience "authenticated", expiration
  - User extraction: `get_current_user()` dependency extracts user_id from JWT `sub` claim
  - Development bypass: `AUTH_DISABLED=true` in settings skips verification, returns hardcoded dev user
  - Service role: `supabase_service_role_key` for admin operations (separate from anon key)
  - Profile context: Multi-tenant via `get_profile_context()` - validates X-Profile-Id header ownership

## Monitoring & Observability

**Error Tracking:**
- None detected - standard logging used instead

**Logs:**
- Standard Python logging configured in `app/main.py`
- Format: `%(asctime)s - %(name)s - %(levelname)s - %(message)s`
- Levels: INFO for startup, WARNING for auth bypass, ERROR for critical failures
- Cost tracking: Dual persistence at `logs/cost_log.json` and Supabase `api_costs` table
- Services log via `logger = logging.getLogger(__name__)` module pattern

## CI/CD & Deployment

**Hosting:**
- Self-hosted or cloud provider via Docker
- Production domain: `https://editai.obsid.ro` (configured in `ALLOWED_ORIGINS`)

**CI Pipeline:**
- None detected - no GitHub Actions, GitLab CI, or Jenkins config found
- Manual deployment via Docker Compose or cloud deployment

**Containerization:**
- Dockerfile: `Dockerfile` - multi-stage Python 3.11 build
  - Base image: `python:3.11-slim`
  - System deps: ffmpeg, libsm6, libxext6, libgl1
  - Virtual env: `/opt/venv`
  - Entry: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  - Health check: HTTP GET to localhost:8000 (retries 3x, 30s interval)

## Environment Configuration

**Required env vars for production:**
- `SUPABASE_URL` - PostgreSQL database URL
- `SUPABASE_KEY` - Anon client key for API access
- `SUPABASE_JWT_SECRET` - JWT secret for token validation
- `GEMINI_API_KEY` - Google Gemini API key
- `ELEVENLABS_API_KEY` - ElevenLabs API key
- `ELEVENLABS_VOICE_ID` - ElevenLabs voice ID (e.g., "21m00Tcm4TlvDq8ikWAM")

**Optional env vars:**
- `ANTHROPIC_API_KEY` - Claude API (for enhanced scripts)
- `SUPABASE_SERVICE_ROLE_KEY` - Admin operations
- `REDIS_URL` - Redis connection string
- `POSTIZ_API_URL` - Postiz endpoint
- `POSTIZ_API_KEY` - Postiz authentication
- `GOOGLE_DRIVE_FOLDER_ID` - Drive export location
- `GOOGLE_CREDENTIALS_PATH` - Service account JSON path
- `FAL_API_KEY` - fal.ai TTS alternative
- `ALLOWED_ORIGINS` - CORS origins (comma-separated)
- `AUTH_DISABLED` - Dev auth bypass (never in production)

**Secrets location:**
- Backend: `.env` file in project root (git-ignored)
- Frontend: Next.js build-time environment variables
- Production: Environment variables injected via container orchestration (Docker, Kubernetes)
- Never committed to git

## Webhooks & Callbacks

**Incoming:**
- Postiz job callback webhooks - Optional integration for async media upload status

**Outgoing:**
- Supabase realtime subscriptions - Optional for live updates (not currently used)
- No explicit webhook registrations detected in current codebase

## API Rate Limits & Quotas

**Gemini API:**
- Rate limits: Per-project quotas (check Google Cloud Console)
- Billing: Pay-per-request based on image tokens + input tokens

**ElevenLabs:**
- Monthly character quota based on subscription tier
- Cost tracking: Logged per operation in `api_costs` table

**Supabase:**
- PostgreSQL connection limits: Depends on plan
- Auth: JWT tokens issued by Supabase

---

*Integration audit: 2026-02-12*
