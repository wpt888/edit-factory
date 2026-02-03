# Roadmap: Edit Factory v2

## Overview

This roadmap transforms Edit Factory from a single-library video production tool into a profile-isolated platform supporting multiple online stores. The journey establishes database-level tenant isolation, retrofits API and service layers with profile context, builds profile management UI, integrates free TTS alternatives, and completes per-profile publishing configuration. The result is one-click video production with clear store separation and cost-effective voice options.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4, 5, 6): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Database Foundation** - Profile tables with RLS and migration
- [x] **Phase 2: Backend Profile Context** - API endpoints and service layer isolation
- [x] **Phase 3: Frontend Profile UI** - Profile switcher and context propagation
- [ ] **Phase 4: TTS Provider Selection** - Free TTS integration and voice presets
- [ ] **Phase 5: Per-Profile Postiz** - Publishing configuration per store
- [ ] **Phase 6: Developer Experience** - Start script and deployment automation

## Phase Details

### Phase 1: Database Foundation
**Goal**: Establish profile-based data isolation at database level with Supabase RLS
**Depends on**: Nothing (first phase)
**Requirements**: PROF-01, PROF-04, PROF-07
**Success Criteria** (what must be TRUE):
  1. Profiles table exists with RLS policies enabled
  2. All existing tables have profile_id foreign key column
  3. Default profile created and all existing data assigned to it
  4. User can query their profile's data via RLS without seeing other profiles
  5. Database queries filtered by profile_id complete in under 50ms (indexed)
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md — SQL migrations: profiles table, profile_id columns, data backfill, RLS policy update

### Phase 2: Backend Profile Context
**Goal**: Retrofit API layer and service methods to inject profile context
**Depends on**: Phase 1
**Requirements**: PROF-01, PROF-05
**Success Criteria** (what must be TRUE):
  1. Profile CRUD API endpoints exist (create, read, update, delete profiles)
  2. All library/segments/postiz routes require X-Profile-Id header and validate ownership
  3. JobStorage, CostTracker, PostizPublisher accept profile_id parameter in all methods
  4. Background tasks preserve profile context (no data leakage across profiles)
  5. FFmpeg temp directories scoped by profile_id to prevent file collisions
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — Profile CRUD API + get_profile_context auth dependency
- [x] 02-02-PLAN.md — Service layer updates (JobStorage, CostTracker, PostizPublisher)
- [x] 02-03-PLAN.md — library_routes.py profile context injection
- [x] 02-04-PLAN.md — segments/postiz/main routes profile context injection
- [x] 02-05-PLAN.md — FFmpeg temp directory profile scoping

### Phase 3: Frontend Profile UI
**Goal**: Enable users to create, switch, and manage profiles from UI
**Depends on**: Phase 2
**Requirements**: PROF-02, PROF-03, PROF-06
**Success Criteria** (what must be TRUE):
  1. User can create new profile with name and description
  2. User can switch between profiles via dropdown in navbar
  3. Active profile name always visible in navbar
  4. Library page shows only current profile's projects and clips
  5. Last-used profile auto-selected on login (no blank screen)
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — ProfileProvider context + API header injection (foundation)
- [x] 03-02-PLAN.md — ProfileSwitcher dropdown + CreateProfileDialog components
- [x] 03-03-PLAN.md — Layout/Navbar/Library integration + visual verification

### Phase 4: TTS Provider Selection
**Goal**: Integrate free TTS alternatives and provide clear provider choice in UI
**Depends on**: Phase 1 (profile settings table)
**Requirements**: TTS-01, TTS-02, TTS-03, TTS-04, TTS-05, TTS-06
**Success Criteria** (what must be TRUE):
  1. User can select TTS provider from UI (ElevenLabs, Edge TTS, Coqui XTTS, Kokoro)
  2. Cost displayed inline next to each provider option (e.g., "$0.22" vs "Free")
  3. Coqui XTTS generates audio with voice cloning from 6-second sample
  4. Kokoro TTS generates audio with preset voices
  5. User can save default voice settings per profile (persists across sessions)
  6. Voice cloning workflow allows user to upload sample and create cloned voice
**Plans**: 7 plans

Plans:
- [ ] 04-01-PLAN.md — TTS foundation: database migration + service abstraction layer
- [ ] 04-02-PLAN.md — Refactor ElevenLabs and Edge TTS to new interface
- [ ] 04-03-PLAN.md — Coqui XTTS integration with voice cloning
- [ ] 04-04-PLAN.md — Kokoro TTS integration with preset voices
- [ ] 04-05-PLAN.md — TTS API routes (/providers, /voices, /generate, /clone-voice)
- [ ] 04-06-PLAN.md — Frontend TTS UI: provider selector, voice cloning, settings page
- [ ] 04-07-PLAN.md — Visual verification checkpoint

### Phase 5: Per-Profile Postiz
**Goal**: Enable separate publishing configuration per store profile
**Depends on**: Phase 2, Phase 3
**Requirements**: PROF-05
**Success Criteria** (what must be TRUE):
  1. User can configure Postiz API credentials per profile (URL + key)
  2. Publishing from Profile A uses Profile A's Postiz account
  3. Publishing from Profile B uses Profile B's Postiz account (no cross-posting)
  4. Cost quota enforcement prevents TTS calls when profile quota exceeded
  5. Profile activity dashboard shows video count and API costs per profile
**Plans**: TBD

Plans:
- [ ] 05-01: TBD

### Phase 6: Developer Experience
**Goal**: Single-command launch script for backend + frontend + browser
**Depends on**: Nothing (independent of profile system)
**Requirements**: DX-01, DX-02
**Success Criteria** (what must be TRUE):
  1. User runs start-dev.bat (Windows) and backend + frontend launch simultaneously
  2. User runs start-dev.sh (WSL/Linux) and backend + frontend launch simultaneously
  3. Start script activates venv automatically
  4. Start script checks port availability and reports conflicts
  5. Browser opens to http://localhost:3000 after services ready
**Plans**: TBD

Plans:
- [ ] 06-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Database Foundation | 1/1 | ✓ Complete | 2026-02-03 |
| 2. Backend Profile Context | 5/5 | ✓ Complete | 2026-02-03 |
| 3. Frontend Profile UI | 3/3 | ✓ Complete | 2026-02-03 |
| 4. TTS Provider Selection | 0/7 | Planned | - |
| 5. Per-Profile Postiz | 0/TBD | Not started | - |
| 6. Developer Experience | 0/TBD | Not started | - |
