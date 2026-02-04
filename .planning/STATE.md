# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 5 - Per-Profile Postiz (in progress)

## Current Position

Phase: 5 of 6 (Per-Profile Postiz)
Plan: 3 of 5 (Cost Quota and Dashboard API)
Status: In progress
Last activity: 2026-02-04 - Completed 05-03-PLAN.md

Progress: [███████████████████░] 92%

## Performance Metrics

**Velocity:**
- Total plans completed: 19
- Average duration: 6.8 min
- Total execution time: 2.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 8 | 35 min | 4.4 min |
| 05-per-profile-postiz | 3 | 13 min | 4.3 min |

**Recent Trend:**
- Last 5 plans: 04-08 (5m), 05-01 (3m), 05-02 (7m), 05-03 (3m)
- Trend: Backend-only plans consistently faster than frontend UI work

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
- **05-02**: Store postiz under tts_settings (reuses existing JSONB column, no schema change)
- **05-02**: Show/hide API key toggle (security UX - default masked, optional reveal)
- **05-02**: Test uses /postiz/status (existing backend endpoint for validation)
- **05-02**: Single Save button (saves both TTS and Postiz settings at once)
- **05-03**: HTTP 402 (Payment Required) for quota exceeded - distinct from 403 (auth) and 400 (validation)
- **05-03**: Quota check uses calendar month (1st to end of month) for predictable billing cycles
- **05-03**: Dashboard endpoint supports time_range query parameter (7d/30d/90d/all)
- **05-03**: quota_remaining: null when quota is 0 (unlimited) - frontend can detect unlimited vs exhausted

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 5 considerations (resolved in 05-01):**
- ~~Verify Postiz service supports multiple API configurations (currently uses global singleton)~~ RESOLVED: Refactored to profile-aware factory
- ~~Per-profile Postiz credentials storage in profiles.tts_settings JSONB or new column~~ RESOLVED: Using tts_settings.postiz

**Remaining Phase 5 work:**
- ~~Frontend Postiz settings UI (05-02)~~ COMPLETE
- ~~Cost quota and dashboard API (05-03)~~ COMPLETE
- Frontend quota UI display (05-04)
- Final verification (05-05)

## Session Continuity

Last session: 2026-02-04
Stopped at: Completed 05-03-PLAN.md (Cost Quota and Dashboard API)
Next action: Execute 05-04-PLAN.md (Frontend Quota UI)
Resume file: None

**Phase 5 Progress:**
- 05-01: Backend profile-aware Postiz factory (3 min) - COMPLETE
- 05-02: Frontend Postiz configuration UI (7 min) - COMPLETE
- 05-03: Cost quota and dashboard API (3 min) - COMPLETE
- 05-04: Frontend quota UI - PENDING
- 05-05: Final verification - PENDING

**05-03 Achievements:**
- CostTracker.get_monthly_costs() calculates calendar month costs
- CostTracker.check_quota() provides exceeded/current/quota tuple
- TTS /generate returns HTTP 402 when quota exceeded
- Dashboard endpoint returns project/clip counts and cost breakdown
- Time range filtering (7d/30d/90d/all) for dashboard stats

**Ready for 05-04: Frontend Quota UI**
- Backend quota enforcement working
- Dashboard API provides all needed stats
- Frontend needs to display quota status and handle 402 errors
