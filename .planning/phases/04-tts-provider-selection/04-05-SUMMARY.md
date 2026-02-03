---
phase: 04-tts-provider-selection
plan: 05
subsystem: api
tags: [fastapi, tts, rest-api, background-jobs, voice-cloning]

# Dependency graph
requires:
  - phase: 04-01
    provides: TTS service abstraction with factory pattern
  - phase: 04-02
    provides: ElevenLabs and Edge TTS adapters
  - phase: 04-03
    provides: Coqui XTTS with voice cloning
  - phase: 04-04
    provides: Kokoro TTS lightweight engine
provides:
  - REST API endpoints for TTS operations
  - Provider listing with cost and availability info
  - Voice listing per provider
  - Background job pattern for TTS generation
  - Voice cloning API with validation
affects: [04-06-frontend-tts-ui, 05-postiz-profile-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Background job pattern for async TTS generation"
    - "Provider availability checks in endpoint responses"
    - "Audio validation with librosa for voice cloning"
    - "Profile-scoped temp directories for voice samples"

key-files:
  created:
    - app/api/tts_routes.py
  modified:
    - app/main.py

key-decisions:
  - "Public /providers endpoint (no auth required for discovery)"
  - "Background job pattern for /generate (async processing with job_id polling)"
  - "6-second minimum for voice cloning samples (XTTS v2 quality threshold)"
  - "10MB max file size for voice samples (balance quality vs upload time)"
  - "Cost logging only for providers with non-zero costs (ElevenLabs $0.22/1k chars)"

patterns-established:
  - "Provider metadata function with runtime availability checks"
  - "Form data for TTS generation (text, provider, voice_id, language)"
  - "UploadFile + Form pattern for voice cloning with audio sample"
  - "Librosa duration validation before processing"

# Metrics
duration: 2min
completed: 2026-02-03
---

# Phase 04 Plan 05: TTS Provider Selection Summary

**REST API exposing TTS providers, voices, generation jobs, and voice cloning with profile-scoped storage**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-03T22:41:32Z
- **Completed:** 2026-02-03T22:43:22Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Four TTS endpoints operational: /providers, /voices, /generate, /clone-voice
- Provider availability dynamically checked (elevenlabs API key, espeak-ng installation)
- Background job pattern for TTS generation with estimated time response
- Voice cloning with audio validation (MIME type, file size, duration)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create TTS API routes** - `fbe3f8a` (feat)
   - /providers endpoint (public, no auth)
   - /voices endpoint (profile-scoped)
   - /generate endpoint (background job)
   - /clone-voice endpoint (audio validation)

2. **Task 2: Mount TTS router in main.py** - `4a728bc` (feat)
   - Import tts_routes module
   - Mount at /api/v1/tts prefix

## Files Created/Modified
- `app/api/tts_routes.py` - TTS REST API with 4 endpoints (providers, voices, generate, clone-voice)
- `app/main.py` - Mounted tts_routes.router at /api/v1 prefix

## Decisions Made

**1. Public /providers endpoint**
- No authentication required for provider discovery
- Allows frontend to show available providers before login
- Rationale: Public metadata, no sensitive data exposed

**2. Background job pattern for /generate**
- Returns job_id immediately, client polls for completion
- Consistent with existing video processing pattern
- Estimated time calculation based on text length

**3. 6-second minimum for voice cloning**
- Validation using librosa before processing
- XTTS v2 quality threshold from Coqui documentation
- User-friendly error message with specific requirement

**4. 10MB max file size for voice samples**
- Balance between audio quality and upload time
- Adequate for 6-30 second samples at reasonable bitrates
- Validation before temp file creation

**5. Cost logging only for non-zero costs**
- Only ElevenLabs triggers cost_tracker logging
- Reduces database noise for free providers (Edge, Coqui, Kokoro)
- Profile-scoped cost attribution

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation followed existing patterns from routes.py, library_routes.py, and TTS service implementations.

## User Setup Required

None - no external service configuration required. TTS providers configured via existing environment variables (ELEVENLABS_API_KEY from Phase 04-02).

## Next Phase Readiness

**Ready for 04-06 (Frontend TTS UI):**
- ✅ /api/v1/tts/providers returns cost and availability
- ✅ /api/v1/tts/voices returns provider-specific voices
- ✅ /api/v1/tts/generate creates background job with job_id
- ✅ /api/v1/tts/clone-voice validates and processes audio samples
- ✅ Profile context injected in all authenticated endpoints
- ✅ Background job pattern compatible with existing polling hooks

**Ready for 04-07 (Provider Preference Storage):**
- ✅ Profile-scoped TTS settings ready for database persistence
- ✅ Provider selection pattern established via form parameters

**No blockers.** All TTS API endpoints functional. Frontend can now implement TTS UI components with provider selection, voice listing, and audio generation.

---
*Phase: 04-tts-provider-selection*
*Completed: 2026-02-03*
