# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-03)

**Core value:** One-click video production workflow: upload a product video, get a social-media-ready clip with voiceover and captions, publish to the right store's social accounts.
**Current focus:** Phase 3 - Frontend Profile UI

## Current Position

Phase: 3 of 6 (Frontend Profile UI)
Plan: 0 of 3
Status: Ready for execution
Last activity: 2026-02-03 — Phase 3 planning complete

Progress: [███░░░░░░░] 30%

## Performance Metrics

**Velocity:**
- Total plans completed: 6
- Average duration: 15 min
- Total execution time: 1.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-database-foundation | 1 | 30 min | 30 min |
| 02-backend-profile-context | 5 | 60 min | 12 min |

**Recent Trend:**
- Last 5 plans: 02-01 (2m), 02-02 (3m), 02-03 (8m), 02-04 (5m), 02-05 (5m)
- Trend: Excellent velocity on backend integration tasks

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

Last session: 2026-02-03 (phase planning)
Stopped at: Phase 3 planning complete
Next action: Execute Phase 3 with `/gsd:execute-phase 3`
Resume file: None

**Phase 3 Planning Summary:**
- 03-01: ProfileProvider context + API header injection (foundation)
- 03-02: ProfileSwitcher dropdown + CreateProfileDialog components
- 03-03: Layout/Navbar/Library integration + visual verification checkpoint

**Wave Structure:**
- Wave 1: 03-01 (foundation)
- Wave 2: 03-02 (UI components)
- Wave 3: 03-03 (integration + checkpoint)
