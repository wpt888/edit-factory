# Phase 2: Backend Profile Context - Context

**Gathered:** 2026-02-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Retrofit the FastAPI backend to be profile-aware. This includes profile CRUD endpoints, header-based profile selection on all routes, service layer modifications to accept profile_id, and background task isolation.

**Not in scope:** Frontend profile UI (Phase 3), TTS provider selection (Phase 4), Postiz per-profile config (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Header Validation Strategy
- **Missing header:** Auto-select user's default profile (no 400 error)
- **Invalid/foreign profile:** Claude decides HTTP response (403 vs 404)
- **Validation layer:** Claude decides (middleware vs per-route dependency)
- **Public routes:** Claude decides if profile context applies

### Profile CRUD Behavior
- **Max profiles:** Unlimited per user
- **Delete behavior:** CASCADE — sterge tot (proiecte + clipuri)
- **Default profile protection:** Nu se poate sterge profilul default (trebuie sa existe mereu cel putin unul)
- **Required fields:** Claude decides (likely just name, description optional)

### Service Layer Injection
- **Injection pattern:** Claude decides (method param vs context object)
- **Refactoring scope:** Claude decides (minimal vs complete)
- **FFmpeg temp dirs:** Claude decides structure (per-profile vs per-project)
- **No-context operations:** Claude decides per-case

### Background Task Isolation
- **Context preservation:** Claude decides (job data JSONB vs closure)
- **Retry mechanism:** Claude decides based on existing job system
- **Logging:** Include profile_id in all logs (easy filtering per store)
- **Legacy jobs:** Migrate to default profile (not ignore)

### Claude's Discretion
- HTTP error codes for validation failures
- Validation layer architecture (middleware vs dependency)
- Service injection pattern choice
- FFmpeg directory structure
- Retry mechanism design
- Required fields for profile creation

</decisions>

<specifics>
## Specific Ideas

- Log-urile trebuie sa contina profile_id pentru a putea filtra probleme per magazin
- Job-urile vechi fara profile_id se asociaza cu default profile (nu se ignora)
- Profilul default e protejat — nu se poate sterge, altfel user-ul ramane fara profil

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-backend-profile-context*
*Context gathered: 2026-02-03*
