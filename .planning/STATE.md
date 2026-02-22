# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Automated video production from any input — an idea, a product feed, or a collection — get social-media-ready videos at scale.
**Current focus:** Phase 31 Final Polish — Backend tech debt closure and v6 audit gap fixes

## Current Position

Milestone: v6 Production Hardening (Final Polish)
Phase: 31 of 31 (Final Polish)
Plan: 02 complete
Status: Complete (2/2 plans complete)
Last activity: 2026-02-22 — Completed Phase 31 Plan 02 (apiGetWithRetry in usage/page.tsx + apiFetch in usePolling)

Progress: [██████████] 100% (2/2 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 70 (across v2-v6)
- Total phases completed: 27
- Total milestones shipped: 5

**By Milestone:**

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v2 Profile System | 6 (1-6) | 23 | Shipped 2026-02-04 |
| v3 Video Quality | 5 (7-11) | 12 | Shipped 2026-02-06 |
| v4 Script-First | 5 (12-16) | 11 | Shipped 2026-02-12 |
| v5 Product Video | 7 (17-23) | 13 | Shipped 2026-02-21 |
| v6 Hardening | 6 (24-29) | — | In progress |
| Phase 30-frontend-error-handling-adoption P01 | 7 | 2 tasks | 5 files |
| Phase 30-frontend-error-handling-adoption P04 | 10 | 1 tasks | 1 files |
| Phase 31-final-polish P01 | 12 | 2 tasks | 7 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v6 Roadmap: Phase 24 (backend stability) is prerequisite — phases 25, 26, 28 can run in parallel after it completes
- v6 Roadmap: Phase 27 (frontend refactoring) depends on Phase 26 (resilience patterns in place first)
- 24-01: In-memory dict is primary progress source; Supabase is durability layer — all DB calls try/except so DB outage never blocks generation
- 24-01: 409 Conflict returned at endpoint level (not inside background task) via is_project_locked() non-blocking check
- 24-01: editai_generation_progress uses TEXT PK for project_id to match backend string UUID usage
- 24-02: Created app/api/validators.py as shared module for validate_upload_size() rather than duplicating in each route
- 24-02: generate_audio_trimmed and process_video_with_tts made async to propagate async generate_audio change
- 24-02: json.JSONDecodeError now raises HTTPException 400 at both subtitle_settings parse sites in routes.py
- 25-01: slowapi default_limits=['60/minute'] on Limiter applies globally without per-route decorators; SlowAPIMiddleware added before CORSMiddleware (FastAPI reverse order)
- 25-01: MAX_TTS_CHARS=5000 defined once in validators.py — all route files import rather than redefine; validate_tts_text_length() validates, strips, and returns text for downstream use
- 25-02: sanitize_srt_text placed at module level in srt_validator.py (not in SRTValidator class) so it can be imported without instantiation
- 25-02: ElevenLabs new service uses _call_elevenlabs_api_new module-level helper (tenacity handles 429/500-504); 402 key failover remains in _post_with_failover for future use
- 25-02: Cache-Control: public, max-age=3600 added to all 4 media file/stream endpoints
- 25-02: Gemini retry uses synchronous @retry (Gemini SDK is sync, not async)
- [Phase 26-01]: ApiError re-exported from api.ts so callers only need one import path
- [Phase 26-01]: apiGetWithRetry added as new export to preserve backward compatibility of apiGet
- [Phase 26-01]: AbortSignal.timeout() used instead of manual setTimeout + AbortController for cleaner timeout handling
- 26-02: usePolling designed as a single-endpoint primitive; library dual-endpoint polling uses usePolling for progress + manual fetch for project status in onData
- 26-02: pollClipStatus in library/page.tsx kept as setInterval — hooks cannot be called inside regular functions; deferred to Phase 27
- 26-02: Pipeline setInterval bug fixed — variantStatuses in dependency array caused interval restart on every poll; usePolling avoids this
- 27-01: ClipStatusPoller is an invisible React component (returns null) wrapping usePolling — rendered conditionally per rendering clip ID, auto-cleans on unmount
- 27-01: renderingClipIds string[] array replaces the old pollClipStatus function — supports multiple simultaneous clip renders naturally
- 27-01: PostizPublishModal owns its own state (integrations, caption, schedule) and resets via useEffect on open prop change
- 27-01: SegmentSelectionModal owns its own modal-specific state (sourceVideos, modalSegments) while projectSegments lives in page.tsx
- 28-01: All backend modules import get_supabase from app.db — no local redefinitions; app.db is the single source of truth for Supabase client initialization
- 28-01: [MUTE DEBUG] logger.info lines deleted entirely (not downgraded) — they were temporary debug artifacts not intended for long-term use
- [Phase 29-testing-and-observability]: 29-01: pyproject.toml testpaths=["tests"] + pythonpath=["."] — app.* imports resolve without sys.path hacks
- [Phase 29-testing-and-observability]: 29-01: mock_settings patches app.config.get_settings at module level so no .env or Supabase connection needed during tests
- [Phase 29-testing-and-observability]: 29-01: force _supabase=None after init to guarantee in-memory fallback path even if env vars are present
- [Phase 29-testing-and-observability]: 29-02: python-json-logger with rename_fields produces timestamp/level/logger keys — matches aggregator conventions
- [Phase 29-testing-and-observability]: 29-02: setup_logging() replaces logging.basicConfig at app startup — all loggers inherit JSON root handler
- [Phase 30-02]: auth-provider.tsx, error-boundary.tsx, global-error.tsx intentionally skipped — infrastructure logging not suitable for UI toasts
- [Phase 30-02]: use-job-polling and use-batch-polling retain retry logic after handleApiError — polling resilience preserved
- [Phase 30-02]: FE-02 gap closure complete — all 13 target files use handleApiError() in every catch block
- [Phase 30-01]: handleApiError replaces console.error in all catch blocks; alert() split by semantic intent into toast.success/warning/error
- [Phase 30-03]: blob download calls (librarie downloadFile, tts-library fetchAudioBlob/downloadFile) kept as apiGet — binary fetches are not retry candidates
- [Phase 30-03]: ErrorBoundary wraps 3 logical sections in library/page.tsx (ClipGallery, ClipEditorPanel, SegmentSelectionModal) — granular isolation not page-wide
- [Phase 30-03]: segments/page.tsx console.error calls (12) were deferred to Plan 04 (now fixed in 30-04)
- [Phase 30-04]: Dead else-branch removed from handleDeleteSegment — apiDelete throws ApiError on non-2xx, so else branch was unreachable dead code
- [Phase 30-04]: handleUpload raw fetch() kept for FormData multipart POST — only console.error replaced with handleApiError per plan
- [Phase 31-01]: cost_tracker, job_storage, tts_library_service now use get_supabase() from app.db singleton — no local create_client calls
- [Phase 31-01]: All 6 inline MAX_TTS_CHARS comparisons replaced with validate_tts_text_length() helper across 3 route files
- [Phase 31-01]: Background task validation in process_tts_job uses validate_tts_text_length() — HTTPException caught by outer except Exception handler marking job as failed
- [Phase 31-02]: librarie/page.tsx blob download (downloadFile) correctly stays as apiGet per 30-03 convention — binary fetches are not retry candidates
- [Phase 31-02]: apiFetch in usePolling removes both raw fetch() and local API_URL — timeout, profile-header injection, and non-2xx throwing now handled by centralized client
- [Phase 31-02]: if (!response.ok) guard removed from usePolling — apiFetch already throws ApiError on non-2xx, making the guard dead code

### Pending Todos

None.

### Blockers/Concerns

**Database migrations pending:**
- Migration 007 (v3 encoding presets) requires manual application via Supabase SQL Editor
- Migration 009 (v4 TTS timestamps) requires manual application via Supabase SQL Editor
- Migration 017 (editai_generation_progress) requires manual application via Supabase SQL Editor

## Session Continuity

Last session: 2026-02-22
Stopped at: Completed 31-02-PLAN.md (apiGetWithRetry in usage/page.tsx + apiFetch in usePolling — Phase 31 fully complete)
Resume file: None

---
*Last updated: 2026-02-22 after Phase 31-02 complete (2/2 plans done — Phase 31 Final Polish complete)*
