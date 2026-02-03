# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 4 - TTS Provider Selection

## Current Position

Phase: 4 of 6 (TTS Provider Selection)
Plan: 4 of 7
Status: In progress
Last activity: 2026-02-03 — Completed 04-04-PLAN.md

Progress: [█████░░░░░] 55%

## Performance Metrics

**Velocity:**
- Total plans completed: 11
- Average duration: 8 min
- Total execution time: 1.88 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 2 | 5 min | 2.5 min |

**Recent Trend:**
- Last 5 plans: 03-01 (2m), 03-02 (2m), 03-03 (2m), 04-01 (3m), 04-04 (2m)
- Trend: Exceptional velocity continues - sub-3min average for recent plans

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap creation: Six-phase structure following database → backend → frontend → TTS → Postiz → DX dependency chain
- Phase 4 flagged for research: TTS integration has complex installation requirements (Kokoro, Coqui, Piper system dependencies)
- **01-01**: Profile cascade delete - profiles.id → editai_projects.profile_id uses ON DELETE CASCADE (deleting profile deletes all projects)
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
- **03-01**: Two-phase hydration: localStorage first (instant UI) → API fetch (fresh data) for best UX
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
- **04-04**: Constructor espeak-ng validation for Kokoro TTS (fail fast with clear installation instructions)
- **04-04**: Lazy import for optional dependencies (graceful degradation if kokoro not installed)
- **04-04**: Preset voice configuration (5 hardcoded voices for Kokoro, no dynamic discovery)

### Pending Todos

None yet.

### Blockers/Concerns

**Phase 3 considerations:**
- React Context + localStorage hybrid pattern for profile state (from RESEARCH.md)
- SSR hydration: Only access localStorage in useEffect, show loading skeleton until hydrated
- API header injection: Modified api.ts auto-injects X-Profile-Id from localStorage
- Profile refetch: Library page must refetch when profile changes

**Phase 4 considerations:**
- Python version compatibility: If running Python 3.13+, venv downgrade to 3.11 required before Kokoro installation
- Coqui XTTS requires PyTorch (large dependency)
- Kokoro requires espeak-ng system dependency
- Voice cloning workflow needs 6-second sample validation

**Phase 5 considerations:**
- Verify Postiz service supports multiple API configurations (currently uses global singleton)

## Session Continuity

Last session: 2026-02-03
Stopped at: Completed 04-04-PLAN.md (Kokoro TTS Service)
Next action: Execute 04-05-PLAN.md (TTS API routes)
Resume file: None

**Phase 3 Complete Summary:**
- 03-01: ProfileProvider context + API header injection (foundation) ✅
- 03-02: ProfileSwitcher dropdown + CreateProfileDialog components ✅
- 03-03: Layout/Navbar/Library integration + visual verification checkpoint ✅

**Phase 3 Achievements:**
- Total duration: 6 minutes (2min per plan)
- Profile context available throughout application
- API calls automatically scoped to current profile
- Visual verification passed - user-approved functionality
- Foundation ready for Phase 4 TTS integration

**Phase 4 Progress (TTS Provider Selection):**
- 04-01: TTS service abstraction + database schema ✅ (3 min)
  - Abstract base class with 5 enforced methods
  - JSONB schema for flexible provider settings
  - Profile-scoped output directories established
  - Factory pattern ready for provider implementations

- 04-04: Kokoro TTS service implementation ✅ (2 min)
  - Lightweight, fast, free local TTS engine
  - espeak-ng validation with clear error messages
  - 5 preset voices (American/British, Male/Female)
  - Lazy import pattern for optional dependencies
  - Zero-cost provider for cost-conscious workflows

**Wave 2 Providers Status:**
- 04-02: ElevenLabs adapter (premium, voice cloning) - SKIPPED (noted in plan)
- 04-03: Coqui adapter (local, voice cloning, GPU) - SKIPPED (noted in plan)
- 04-04: Kokoro service ✅

**Next Plan (04-05) Prerequisites:**
- ✅ TTSService interface defined
- ✅ Factory function ready
- ✅ At least one TTS provider implemented (Kokoro)
- Ready to create unified TTS API routes
