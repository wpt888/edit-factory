# External Integrations

**Analysis Date:** 2026-02-12

## APIs & External Services

**AI & Content Analysis:**
- Google Gemini 2.5 Flash - Video frame analysis for clip scoring
  - SDK/Client: `google-genai`
  - Auth: `GEMINI_API_KEY` environment variable
  - Used in: `app/services/gemini_analyzer.py`
  - Purpose: Analyzes video frames to identify engaging segments, generates descriptions and tags

**Text-to-Speech:**
- ElevenLabs - Primary TTS provider
  - SDK/Client: HTTP client (`httpx`, base URL: `https://api.elevenlabs.io/v1`)
  - Auth: `ELEVENLABS_API_KEY` header (`xi-api-key`)
  - Config: `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` (default: `eleven_multilingual_v2`)
  - Used in: `app/services/elevenlabs_tts.py`
  - Purpose: High-quality voice-over generation with configurable voice settings (stability, similarity boost, style)

- Microsoft Edge TTS - Fallback TTS (free)
  - SDK/Client: `edge-tts` package
  - Auth: None (public API)
  - Used in: `app/services/edge_tts_service.py`
  - Purpose: Free fallback when ElevenLabs is unavailable or API quota exceeded

- Coqui XTTS - Voice cloning TTS
  - SDK/Client: `TTS` package (PyTorch-based)
  - Auth: None (local inference)
  - Used in: `app/services/voice_cloning_service.py`
  - Purpose: Clone voice from audio samples (17 languages supported)

- Kokoro - Lightweight TTS
  - SDK/Client: `kokoro` package
  - Auth: None (local inference)
  - System dependency: `espeak-ng` (for phoneme synthesis)
  - Purpose: Fast, low-resource TTS alternative

**Speech Recognition:**
- OpenAI Whisper - Speech-to-text transcription
  - SDK/Client: `openai-whisper` package
  - Auth: None (local inference, model downloaded on first use)
  - Purpose: Generate SRT subtitles from video audio

**Social Media Publishing:**
- Postiz - Multi-platform social media scheduler
  - SDK/Client: HTTP client (`httpx`)
  - Auth: `POSTIZ_API_KEY` header, base URL: `POSTIZ_API_URL` env var
  - Used in: `app/services/postiz_service.py`, `app/api/postiz_routes.py`
  - Purpose: Upload videos and schedule posts to Instagram, TikTok, YouTube, Facebook, LinkedIn, X, Bluesky, Threads
  - Data structure: Supports integrations list, media upload, publish scheduling

**Cloud Storage:**
- Google Drive (optional integration)
  - SDK/Client: `google-api-python-client`, `google-auth-oauthlib`
  - Auth: `GOOGLE_DRIVE_FOLDER_ID` config, OAuth credentials file
  - Purpose: Upload final videos to Google Drive folder

## Data Storage

**Databases:**
- Supabase (PostgreSQL-compatible)
  - Connection: `SUPABASE_URL`, `SUPABASE_KEY` environment variables
  - Client: `supabase` Python package (v2.0.0+)
  - Authentication: JWT tokens for user isolation, service role key for admin operations
  - Used in: `app/api/library_routes.py` (lazy singleton `get_supabase()`)
  - Tables: `editai_projects`, `editai_clips`, `editai_clip_content`, `editai_project_segments`, `api_costs`, `jobs`
  - Row-Level Security (RLS): Enforced via policies checking `auth.uid()` and `auth.jwt()` role

**File Storage:**
- Local filesystem only
  - Input: `./input/` (configurable via `INPUT_DIR` env var)
  - Output: `./output/` (configurable via `OUTPUT_DIR` env var)
  - Temporary: System temp directory or configured `temp_dir`
  - Logs: `./logs/` (configurable via `LOGS_DIR` env var)
  - Cost tracking: `logs/cost_log.json`

**Caching:**
- Redis (optional)
  - Connection: `REDIS_URL` environment variable (default: `redis://localhost:6379/0`)
  - Purpose: Optional message broker for Celery, used in `app/api/routes.py` health check
  - Status: Optional - system works without Redis

## Authentication & Identity

**Auth Provider:**
- Supabase Auth (native PostgreSQL auth system)
  - Implementation: JWT tokens in `Authorization: Bearer` header
  - Verification: `app/api/auth.py` - `get_current_user()` dependency validates JWT against `SUPABASE_JWT_SECRET`
  - Profile-based multi-tenancy: User can have multiple profiles (profiles table with `tts_settings` JSONB)
  - Frontend uses: `@supabase/supabase-js` AuthProvider context
  - Development bypass: `AUTH_DISABLED=true` in settings returns hardcoded dev user

**Cross-origin requests:**
- CORS configured in `app/main.py`
- Allowed origins: configurable via `ALLOWED_ORIGINS` env var (default: `http://localhost:3000,http://localhost:3001,https://editai.obsid.ro`)
- Allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- Custom headers: `Authorization`, `Content-Type`, `X-Profile-Id`, `X-Requested-With`

## Monitoring & Observability

**Error Tracking:**
- Not configured - errors logged to Python `logging` module

**Logs:**
- Python logging to console and `logs/` directory
- Log format: `%(asctime)s - %(name)s - %(levelname)s - %(message)s`
- Cost tracking: Dual logging to Supabase `api_costs` table + local `logs/cost_log.json` file

**Cost Tracking:**
- Supabase: `api_costs` table (service, operation, cost, metadata JSONB)
- Local: `logs/cost_log.json` (fallback when Supabase unavailable)
- Services tracked:
  - ElevenLabs: ~$0.22 per 1000 characters
  - Gemini Vision: ~$0.02 per image analyzed

## CI/CD & Deployment

**Hosting:**
- Local development: Windows/Linux/macOS with Python 3.11 + Node.js 20+
- Docker: Python 3.11 slim with FFmpeg, deployable to any container runtime
- Frontend: Static files via Next.js standalone output or mounted in reverse proxy

**CI Pipeline:**
- Not configured (no GitHub Actions, GitLab CI, etc. detected)

## Environment Configuration

**Required env vars:**
```
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key

# Google Gemini
GEMINI_API_KEY=your-gemini-key

# ElevenLabs TTS
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=your-voice-id
```

**Optional env vars:**
```
# Development
AUTH_DISABLED=true              # Skip JWT validation
SUPABASE_JWT_SECRET=...         # For production JWT verification
SUPABASE_SERVICE_ROLE_KEY=...   # Admin operations

# External services
REDIS_URL=redis://localhost:6379/0
POSTIZ_API_URL=...              # Postiz base URL
POSTIZ_API_KEY=...              # Postiz API key
GOOGLE_DRIVE_FOLDER_ID=...      # Google Drive upload folder
FAL_API_KEY=...                 # fal.ai TTS alternative

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://example.com
```

**Secrets location:**
- Local dev: `.env` file (ignored by git)
- Production: Environment variables or secret management service (e.g., AWS Secrets Manager, Supabase Vault)

## Webhooks & Callbacks

**Incoming:**
- None detected (API is REST-only, no webhook receivers)

**Outgoing:**
- Postiz publishes videos to external platforms (Instagram, TikTok, YouTube, etc.)
- No outgoing webhooks to third-party services detected

## Frontend API Client

**HTTP Transport:**
- Fetch API via `frontend/src/lib/api.ts` custom wrapper
- Base URL: `NEXT_PUBLIC_API_URL` env var or `http://localhost:8000/api/v1`
- Functions: `apiFetch()`, `apiGet()`, `apiPost()`, `apiPatch()`, `apiPut()`, `apiDelete()`
- Auto-injects `X-Profile-Id` header from localStorage
- No automatic token injection (relies on Supabase session management)

**Supabase Frontend Client:**
- Location: `frontend/src/lib/supabase/client.ts`
- Uses `@supabase/ssr` for server-side rendering compatibility
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Provides auth context and real-time subscriptions

## Background Job System

**Job Processing:**
- FastAPI BackgroundTasks (not Celery/Redis-based, though optional)
- Job storage: Dual persistence via Supabase (primary) + in-memory fallback
- Client polls `GET /api/v1/jobs/{job_id}` for status updates
- Progress tracking: In-memory `_generation_progress` dict (lost on server restart)

---

*Integration audit: 2026-02-12*
