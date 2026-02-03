# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 5 - Per-Profile Postiz (next)

## Current Position

Phase: 4 of 6 (TTS Provider Selection)
Plan: 8 of 8 (Phase Complete)
Status: Phase complete
Last activity: 2026-02-03 — Completed 04-08-PLAN.md (Gap Closure - 6 API Bug Fixes)

Progress: [████████████████░░░░] 85%

## Performance Metrics

**Velocity:**
- Total plans completed: 16
- Average duration: 7.4 min
- Total execution time: 2.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 8 | 35 min | 4.4 min |

**Recent Trend:**
- Last 5 plans: 04-04 (2m), 04-05 (2m), 04-06 (19m), 04-07 (<1m), 04-08 (5m)
- Trend: 04-08 was gap closure (6 API bug fixes discovered in verification)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap creation: Six-phase structure following database -> backend -> frontend -> TTS -> Postiz -> DX dependency chain
- Phase 4 flagged for research: TTS integration has complex installation requirements (Kokoro, Coqui, Piper system dependencies)
- **01-01**: Profile cascade delete - profiles.id -> editai_projects.profile_id uses ON DELETE CASCADE (deleting profile deletes all projects)
- **01-01**: jobs and api_costs have nullable profile_id with SET NULL on delete (preserve records even if profile deleted)
- **01-01**: Manual migration application - migrations applied via Supabase Dashboard SQL Editor (not CLI) for control over timing
- **02-01**: Missing X-Profile-Id header auto-selects default profile (no 400 error for convenience)
- **02-01**: Missing default profile returns 503 with actionable message (data inconsistency requires support intervention)
- **02-01**: Profile validation returns 404 for not found, 403 for foreign ownership (standard REST semantics)
- **02-01**: Default profile protection - cannot delete until another is set as default (ensures at least one default always exists)
- **02-02**: profile_id as Optional parameter (None = all profiles) for backward compatibility
- **02-02**: Store profile_id in both table column and JSONB data field for job_storage fallback
- **02-02**: Phase 2 only adds logging to Postiz - full per-profile credentials deferred to Phase 5
- **02-02**: Filter costs by profile_id in details dict for local JSON fallback
- **02-03**: Helper function pattern - verify_project_ownership() centralizes ownership checks across routes
- **02-03**: Explicit background task parameters - profile_id passed explicitly rather than extracted from data
- **02-03**: Profile-scoped temp directories - temp/{profile_id}/ prevents file collisions
- **03-01**: Global header injection in apiFetch over hook pattern (simpler DX, acceptable coupling for core feature)
- **03-01**: Two-phase hydration: localStorage first (instant UI) -> API fetch (fresh data) for best UX
- **03-01**: Auto-selection cascade: stored ID > default profile > first profile (respects user choice, graceful fallback)
- **03-01**: Memoize context value to prevent unnecessary re-renders when functions recreated
- **03-02**: Character count display (50 char limit) provides immediate user feedback on profile name validation
- **03-02**: Inline skeleton div for loading state instead of dedicated component (simpler, fewer imports)
- **03-02**: Default profile badge displayed in dropdown for quick identification
- **03-03**: ProfileProvider wraps NavBar and children, but NOT Toaster (toasts work outside context)
- **03-03**: Library page waits for both profileLoading AND currentProfile before fetching clips
- **03-03**: Empty state provides clear guidance pointing user to navbar dropdown for profile creation
- **03-03**: Combined loading state: if (profileLoading || loading) for dual-phase initialization
- **04-01**: TTS abstraction layer uses abstract base class with factory pattern for pluggable providers
- **04-01**: JSONB tts_settings column allows flexible per-provider configuration without schema changes
- **04-01**: Profile-scoped TTS directories output/tts/{profile_id}/{provider}/ prevent file collisions
- **04-01**: Optional clone_voice() method with NotImplementedError default for graceful degradation
- **04-02**: Async HTTP wrapper for ElevenLabs (convert sync httpx.Client to async for unified interface)
- **04-02**: Voice caching for Edge TTS (350+ voices cached after first list_voices call)
- **04-02**: Librosa for audio duration calculation (consistent across providers without FFmpeg probing)
- **04-02**: Preserve original services intact (video_processor.py still uses elevenlabs_tts.py directly)
- **04-03**: Lazy import CoquiTTSService in factory to avoid PyTorch loading at startup (large dependency)
- **04-03**: Class-level model cache shared across CoquiTTSService instances (XTTS v2 model ~2GB)
- **04-03**: Automatic GPU/CPU fallback with torch.cuda.is_available() check for broad compatibility
- **04-03**: Require minimum 6 seconds for voice cloning samples (XTTS v2 quality threshold)
- **04-04**: Constructor espeak-ng validation for Kokoro TTS (fail fast with clear installation instructions)
- **04-04**: Lazy import for optional dependencies (graceful degradation if kokoro not installed)
- **04-04**: Preset voice configuration (5 hardcoded voices for Kokoro, no dynamic discovery)
- **04-05**: Public /providers endpoint (no auth required for discovery, allows frontend to show options before login)
- **04-05**: Background job pattern for /generate (async processing with job_id polling, consistent with video workflow)
- **04-05**: 6-second minimum for voice cloning with librosa validation (XTTS v2 quality threshold enforced at API layer)
- **04-05**: 10MB max file size for voice samples (balance between audio quality and upload time)
- **04-05**: Cost logging only for non-zero costs (reduces database noise for free providers)
- **04-06**: Card-based provider selection instead of simple radio list (better UX for displaying provider details)
- **04-06**: Client-side audio validation using Audio element (immediate feedback, prevents unnecessary uploads)
- **04-06**: Alert-based notifications instead of toast (toast hook not available, consistent with library page)
- **04-06**: Settings page profile-aware (each profile can have different TTS provider/voice preferences)
- **04-07**: Verification-only plan pattern for user acceptance testing (no code changes)
- **04-08**: Gap closure plan pattern: verification reveals bugs, dedicated plan fixes them atomically

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 5 considerations:**
- Verify Postiz service supports multiple API configurations (currently uses global singleton)
- Per-profile Postiz credentials storage in profiles.tts_settings JSONB or new column

## Session Continuity

Last session: 2026-02-04
Stopped at: Phase 4 complete - verification passed (6/6 must-haves)
Next action: Plan Phase 5 (Per-Profile Postiz)
Resume file: None

**Phase 4 Complete Summary:**
- 04-01: TTS service abstraction + database schema (3 min)
- 04-02: ElevenLabs and Edge TTS adapters (2 min)
- 04-03: Coqui XTTS service implementation (2 min)
- 04-04: Kokoro TTS service implementation (2 min)
- 04-05: TTS API routes (2 min)
- 04-06: Frontend TTS UI components (19 min)
- 04-07: Visual verification checkpoint (<1 min, user approved)
- 04-08: Gap closure - 6 API bug fixes (5 min)

**Phase 4 Achievements:**
- Total duration: ~35 minutes (8 plans)
- TTS service abstraction with factory pattern
- 4 providers: ElevenLabs, Edge TTS, Coqui XTTS, Kokoro
- Voice cloning capability (Coqui)
- REST API for all TTS operations
- Settings page with provider selector and voice cloning UI
- Visual verification passed - user-approved functionality
- Gap closure: 6 API bugs fixed (navbar link, voice_id, generate_audio, duration_seconds, audio_file, voice_name)

**All Phase 4 Requirements Met:**
- TTS-01: User can select TTS provider from UI
- TTS-02: Cost displayed inline next to each provider option
- TTS-03: Coqui XTTS generates audio with voice cloning
- TTS-04: Kokoro TTS generates audio with preset voices
- TTS-05: User can save default voice settings per profile
- TTS-06: Voice cloning workflow allows sample upload

**Ready for Phase 5: Per-Profile Postiz**
- Enable separate publishing configuration per store profile
- Per-profile Postiz API credentials
- Cost quota enforcement per profile
- Profile activity dashboard
