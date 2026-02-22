# Roadmap: Edit Factory

## Milestones

- ✅ **v1.0 MVP** - Phases 1-0 (video processing core, shipped ~2024)
- ✅ **v2 Profile System** - Phases 1-6 (profile isolation, TTS providers, shipped 2026-02-04)
- ✅ **v3 Video Quality Enhancement** - Phases 7-11 (encoding optimization, shipped 2026-02-06)
- ✅ **v4 Script-First Pipeline** - Phases 12-16 (shipped 2026-02-12)
- ✅ **v5 Product Video Generator** - Phases 17-23 (shipped 2026-02-21)
- 🚧 **v6 Production Hardening** - Phases 24-29 (in progress)

## Phases

<details>
<summary>✅ v2 Profile System (Phases 1-6) - SHIPPED 2026-02-04</summary>

- [x] Phase 1: Database Foundation (1 plan)
- [x] Phase 2: Backend Profile Context (5 plans)
- [x] Phase 3: Frontend Profile UI (3 plans)
- [x] Phase 4: TTS Provider Selection (8 plans)
- [x] Phase 5: Per-Profile Postiz (5 plans)
- [x] Phase 6: Developer Experience (1 plan)

Full details: `.planning/milestones/v2-ROADMAP.md`

</details>

<details>
<summary>✅ v3 Video Quality Enhancement (Phases 7-11) - SHIPPED 2026-02-06</summary>

- [x] Phase 7: Platform Export Presets (3 plans)
- [x] Phase 8: Audio Normalization (2 plans)
- [x] Phase 9: Video Enhancement Filters (3 plans)
- [x] Phase 10: Segment Scoring Enhancement (1 plan)
- [x] Phase 11: Subtitle Enhancement (3 plans)

Full details: `.planning/milestones/v3-ROADMAP.md`

</details>

<details>
<summary>✅ v4 Script-First Pipeline (Phases 12-16) — SHIPPED 2026-02-12</summary>

- [x] Phase 12: ElevenLabs TTS Upgrade (3 plans)
- [x] Phase 13: TTS-Based Subtitles (2 plans)
- [x] Phase 14: AI Script Generation (2 plans)
- [x] Phase 15: Script-to-Video Assembly (2 plans)
- [x] Phase 16: Multi-Variant Pipeline (2 plans)

Full details: `.planning/milestones/v4-ROADMAP.md`

</details>

<details>
<summary>✅ v5 Product Video Generator (Phases 17-23) — SHIPPED 2026-02-21</summary>

- [x] Phase 17: Feed Foundation (2 plans) — completed 2026-02-20
- [x] Phase 18: Video Composition (2 plans) — completed 2026-02-20
- [x] Phase 19: Product Browser (2 plans) — completed 2026-02-20
- [x] Phase 20: Single Product E2E (2 plans) — completed 2026-02-20
- [x] Phase 21: Batch Generation (2 plans) — completed 2026-02-20
- [x] Phase 22: Templates + Customization (2 plans) — completed 2026-02-21
- [x] Phase 23: Feed Creation UI — Gap Closure (1 plan) — completed 2026-02-21

Full details: `.planning/milestones/v5-ROADMAP.md`

</details>

### 🚧 v6 Production Hardening (In Progress)

**Milestone Goal:** Harden Edit Factory for production stability — fix memory leaks, add error handling, improve security, add tests, and clean up technical debt identified in comprehensive codebase audit.

- [ ] **Phase 24: Backend Stability** - Fix memory leaks, persist progress, validate uploads, async TTS client
- [ ] **Phase 25: Rate Limiting & Security** - slowapi middleware, XSS prevention, cache headers, retry logic
- [ ] **Phase 26: Frontend Resilience** - Error boundary, consistent error handling, API client hardening, empty states, polling hook
- [ ] **Phase 27: Frontend Refactoring** - Split library page, eliminate polling duplication
- [ ] **Phase 28: Code Quality** - Centralize Supabase client, remove debug logs
- [ ] **Phase 29: Testing & Observability** - pytest setup, unit tests, structured logging, data retention

## Phase Details

### Phase 24: Backend Stability
**Goal**: The backend handles errors, cleans up after itself, and validates all input before processing
**Depends on**: Nothing (first v6 phase)
**Requirements**: STAB-01, STAB-02, STAB-03, STAB-04, STAB-05, QUAL-02, QUAL-04
**Success Criteria** (what must be TRUE):
  1. Generation progress survives a server restart — jobs resumed show correct prior progress
  2. Project render locks are released after completion and never accumulate indefinitely
  3. A lock timeout returns a 409 Conflict response instead of silently continuing
  4. Uploading a file over the size limit returns 413 Payload Too Large immediately
  5. Sending malformed JSON in form params returns a 400 error (not a silent ignore or 500)
**Plans**: 2 plans

Plans:
- [ ] 24-01-PLAN.md — Persist generation progress to DB and fix lock lifecycle
- [ ] 24-02-PLAN.md — File upload validation, JSON parse error handling, async ElevenLabs TTS client

### Phase 25: Rate Limiting & Security
**Goal**: The backend enforces request limits, sanitizes user content, and secures HTTP responses
**Depends on**: Phase 24
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, STAB-06
**Success Criteria** (what must be TRUE):
  1. Exceeding the request rate limit returns a 429 Too Many Requests response
  2. SRT subtitle preview renders user content without executing injected scripts
  3. Stream endpoints return Cache-Control headers appropriate for media streaming
  4. TTS text length exceeding the limit is rejected at the endpoint before the background job starts
  5. External API calls (ElevenLabs, Gemini) automatically retry on transient failures with exponential backoff
**Plans**: TBD

Plans:
- [ ] 25-01: Rate limiting middleware (slowapi) and TTS length validation
- [ ] 25-02: XSS prevention in SRT preview, cache headers, retry logic with tenacity

### Phase 26: Frontend Resilience
**Goal**: The frontend handles errors gracefully and communicates clearly in every state
**Depends on**: Phase 24
**Requirements**: FE-01, FE-02, FE-03, FE-04, FE-05
**Success Criteria** (what must be TRUE):
  1. An unhandled React error shows a fallback UI instead of a white blank screen
  2. All API errors surface as a consistent error notification (no mix of toast/alert/silence)
  3. API requests time out after a defined period and failed requests retry automatically
  4. Every page shows an informative empty state when no data exists (no blank content areas)
  5. Polling-based job tracking uses a single shared hook across all pages
**Plans**: TBD

Plans:
- [ ] 26-01: Global error boundary and consistent error handling utility
- [ ] 26-02: API client hardening (timeout, retry, centralized error), empty states, polling hook

### Phase 27: Frontend Refactoring
**Goal**: The library page is decomposed into maintainable components with no duplicated polling logic
**Depends on**: Phase 26
**Requirements**: REF-01, REF-02
**Success Criteria** (what must be TRUE):
  1. library/page.tsx is split into 5-6 focused components each with a single responsibility
  2. Polling logic exists in exactly one place — the shared hook from Phase 26 — with no inline duplicates
**Plans**: TBD

Plans:
- [ ] 27-01: Split library/page.tsx and eliminate polling duplication

### Phase 28: Code Quality
**Goal**: The codebase has a single Supabase client and no debug noise in logs
**Depends on**: Phase 24
**Requirements**: QUAL-01, QUAL-03
**Success Criteria** (what must be TRUE):
  1. All backend modules import get_supabase() from one central db.py — no local redefinitions
  2. Log output contains no [MUTE DEBUG] lines or equivalent debug artifacts
**Plans**: TBD

Plans:
- [ ] 28-01: Centralize Supabase client in db.py and clean up debug logs

### Phase 29: Testing & Observability
**Goal**: The backend has a test harness for critical services and emits structured logs with a data retention policy
**Depends on**: Phase 24
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Running `pytest` from the project root executes the test suite without configuration errors
  2. Unit tests for job_storage, cost_tracker, and srt_validator pass with no failures
  3. Backend log output is valid JSON (structured logging) parseable by log aggregators
  4. A data retention command or scheduled task removes temp files and failed jobs older than the retention window
**Plans**: TBD

Plans:
- [ ] 29-01: pytest setup, unit tests for critical services
- [ ] 29-02: Structured JSON logging and data retention policy

## Progress

**Execution Order:** 24 → 25 → 26 → 27 → 28 → 29
(Phases 25, 26, 28 can run in parallel after Phase 24; 27 depends on 26; 29 depends on 24)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-6 | v2 | 23/23 | Complete | 2026-02-04 |
| 7-11 | v3 | 12/12 | Complete | 2026-02-06 |
| 12-16 | v4 | 11/11 | Complete | 2026-02-12 |
| 17-23 | v5 | 13/13 | Complete | 2026-02-21 |
| 24. Backend Stability | v6 | 0/2 | Not started | - |
| 25. Rate Limiting & Security | v6 | 0/2 | Not started | - |
| 26. Frontend Resilience | v6 | 0/2 | Not started | - |
| 27. Frontend Refactoring | v6 | 0/1 | Not started | - |
| 28. Code Quality | v6 | 0/1 | Not started | - |
| 29. Testing & Observability | v6 | 0/2 | Not started | - |

---
*Last updated: 2026-02-22 after v6 Production Hardening roadmap created*
