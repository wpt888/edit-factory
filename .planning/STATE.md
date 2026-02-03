# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 4 - TTS Provider Selection

## Current Position

Phase: 4 of 6 (TTS Provider Selection)
Plan: 4 of 7
Status: In progress
Last activity: 2026-02-03 — Completed 04-02-PLAN.md

Progress: [██████░░░░] 60%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: 7 min
- Total execution time: 1.93 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |
| 03-frontend-profile-ui | 3 | 6 min | 2 min |
| 04-tts-provider-selection | 4 | 9 min | 2.3 min |

**Recent Trend:**
- Last 5 plans: 03-03 (2m), 04-01 (3m), 04-04 (2m), 04-03 (2m), 04-02 (2m)
- Trend: Exceptional velocity continues - sub-3min average maintained

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
Stopped at: Completed 04-02-PLAN.md (ElevenLabs and Edge TTS Adapters)
Next action: Execute 04-05-PLAN.md (Voice Cloning) or 04-06-PLAN.md (TTS API Endpoints)
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

- 04-02: ElevenLabs and Edge TTS adapters ✅ (2 min)
  - Wrapped existing services with TTSService interface
  - Async HTTP for ElevenLabs (converted from sync)
  - Voice caching for Edge TTS (350+ voices)
  - Librosa duration calculation for both providers
  - Backward compatibility maintained (original services intact)
  - Cost tracking integrated (ElevenLabs $0.22/1k chars, Edge free)

- 04-03: Coqui XTTS service implementation ✅ (2 min)
  - Voice cloning from 6+ second audio samples
  - 17-language multilingual TTS support
  - GPU acceleration with CPU fallback
  - Lazy model loading (avoid 2GB startup cost)
  - Class-level model caching (singleton pattern)
  - Free local TTS alternative to ElevenLabs

- 04-04: Kokoro TTS service implementation ✅ (2 min)
  - Lightweight, fast, free local TTS engine
  - espeak-ng validation with clear error messages
  - 5 preset voices (American/British, Male/Female)
  - Lazy import pattern for optional dependencies
  - Zero-cost provider for cost-conscious workflows

**Provider Implementation Status:**
- 04-02: ElevenLabs adapter (premium API, $0.22/1k chars) ✅
- 04-02: Edge adapter (free Microsoft voices) ✅
- 04-03: Coqui adapter (local, voice cloning, GPU) ✅
- 04-04: Kokoro adapter (lightweight local engine) ✅

**Next Plan (04-05 or 04-06) Prerequisites:**
- ✅ TTSService interface defined
- ✅ Factory function ready with all 4 providers
- ✅ Voice cloning capability available (Coqui)
- ✅ Cost tracking integrated (ElevenLabs)
- ✅ Free alternatives available (Edge, Coqui, Kokoro)
- Ready for voice cloning API or TTS API routes
