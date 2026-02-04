# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 5 - Per-Profile Postiz (in progress)

## Current Position

Phase: 5 of 6 (Per-Profile Postiz)
Plan: 1 of 5 (Backend Profile-Aware Postiz Factory)
Status: In progress
Last activity: 2026-02-04 - Completed 05-01-PLAN.md

Progress: [█████████████████░░░] 86%

## Performance Metrics

**Velocity:**
- Total plans completed: 17
- Average duration: 7.2 min
- Total execution time: 2.3 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 8 | 35 min | 4.4 min |
| 05-per-profile-postiz | 1 | 3 min | 3 min |

**Recent Trend:**
- Last 5 plans: 04-06 (19m), 04-07 (<1m), 04-08 (5m), 05-01 (3m)
- Trend: 05-01 was pure backend refactoring (no UI), quick execution

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
- **05-01**: Profile-aware Postiz factory with instance caching (Dict keyed by profile_id)
- **05-01**: Database credential lookup from profiles.tts_settings.postiz JSONB
- **05-01**: Environment variable fallback if profile has no Postiz config
- **05-01**: ValueError for missing credentials (routes return 400 with helpful message)
- **05-01**: PATCH endpoint added to profile_routes.py for tts_settings updates
- **05-01**: Cache invalidation via reset_postiz_publisher(profile_id) on settings change

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 5 considerations (resolved in 05-01):**
- ~~Verify Postiz service supports multiple API configurations (currently uses global singleton)~~ RESOLVED: Refactored to profile-aware factory
- ~~Per-profile Postiz credentials storage in profiles.tts_settings JSONB or new column~~ RESOLVED: Using tts_settings.postiz

**Remaining Phase 5 work:**
- Frontend Postiz settings UI (05-02)
- Frontend credential validation UI (05-03)
- Cost quota enforcement (05-04)
- Profile activity dashboard (05-05)

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 05-01-PLAN.md (Backend Profile-Aware Postiz Factory)
Next action: Execute 05-02-PLAN.md (Frontend Postiz Settings UI)
Resume file: None

**Phase 5 Progress:**
- 05-01: Backend profile-aware Postiz factory (3 min) - COMPLETE
- 05-02: Frontend Postiz settings UI - PENDING
- 05-03: Frontend credential validation - PENDING
- 05-04: Cost quota enforcement - PENDING
- 05-05: Profile activity dashboard - PENDING

**05-01 Achievements:**
- Postiz service refactored from singleton to profile-aware factory
- Instance caching with Dict[str, PostizPublisher]
- Database lookup from profiles.tts_settings.postiz
- Environment variable fallback for backward compatibility
- Cache invalidation on profile settings change
- All 6 Postiz route endpoints updated to pass profile_id
- PATCH endpoint added to profile_routes.py

**Ready for 05-02: Frontend Postiz Settings UI**
- Backend accepts Postiz credentials via PATCH /profiles/{id}
- Settings page needs new section for Postiz configuration
- Form fields: api_url, api_key, enabled toggle
