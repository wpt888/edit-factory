# Project Research Summary

**Project:** Edit Factory - Profile/Workspace Isolation & Free TTS Integration
**Domain:** Multi-tenant video production platform with social media publishing
**Researched:** 2026-02-03
**Confidence:** HIGH

## Executive Summary

Edit Factory requires profile/workspace isolation to prevent accidental cross-posting between different stores (e.g., Store A's product video published to Store B's social accounts). Research shows this is a critical pattern in social media management tools, where agency/multi-client isolation is table stakes. The recommended approach uses Supabase Row-Level Security (RLS) with a `profile_id` foreign key pattern, avoiding over-engineering (separate databases per tenant) while maintaining defense-in-depth security at the database layer.

The project also needs cost-effective TTS alternatives to ElevenLabs (~$0.22/1000 chars). Research identified Kokoro TTS (82M params, Apache 2.0) as the optimal free alternative, with quality comparable to larger models while maintaining CPU-friendly inference. A tiered provider system (Kokoro default → Piper for fast preview → Coqui for premium quality → Edge TTS fallback) provides flexibility without sacrificing performance.

Key risks include data leakage across profiles (prevented by RLS policies + explicit application-level filtering), background task context loss (mitigated by explicitly passing profile_id to all background tasks), and migration failures (avoided through multi-step nullable → backfill → non-null pattern). The architecture retrofit requires careful attention to singleton services, in-memory caches, and file path isolation, all of which currently lack tenant scoping.

## Key Findings

### Recommended Stack

Research confirms that Supabase RLS is production-ready for multi-tenant isolation, with verified implementations handling 10,000+ tenants. For Edit Factory's 2-profile use case, shared tables with `profile_id` foreign keys provides optimal performance (<1ms overhead with proper indexing) without infrastructure complexity.

**Core technologies:**
- **Supabase RLS:** Database-level isolation via Row-Level Security policies — proven pattern for multi-tenancy, zero additional infrastructure, defense-in-depth security where users literally cannot access other profiles' data even with API compromise
- **app_metadata for tenant identification:** Store workspace_id in immutable server-side metadata — accessible in RLS policies via auth.jwt(), eliminates extra SELECT queries, cannot be tampered with by users
- **Kokoro TTS (>=0.9.4):** Primary free TTS engine — 82M parameters, Apache 2.0 license, quality comparable to larger models, runs on modest CPU hardware, actively maintained in 2026
- **Piper TTS (1.4.0):** Fast preview mode — Raspberry Pi optimized, 3-5x realtime on CPU, lower quality but excellent speed/resource tradeoff for draft renders
- **Coqui TTS (0.27.5):** Premium quality option — 1100+ pre-trained voices, neural TTS with natural prosody, best quality but most resource-intensive (use for final renders)
- **concurrently (9.2.1):** Cross-platform dev launcher — run FastAPI + Next.js simultaneously, 8.6M weekly downloads, works on Windows/WSL/Linux/Mac

**Critical version requirement:** Python 3.11 recommended (Kokoro doesn't support Python 3.13+ yet, Coqui requires 3.10+, FastAPI supports 3.8+)

### Expected Features

Research from social media management tools (Statusbrew, Agorapulse, Planable) and multi-store e-commerce platforms reveals clear feature expectations for profile isolation.

**Must have (table stakes):**
- **Profile Switcher UI** — Industry standard in all social media tools, dropdown/menu in navbar, persistent across all pages
- **Per-Profile Library Isolation** — Prevents accidental cross-posting (critical error in agency tools), database scoping with RLS
- **Per-Profile Settings Storage** — Each store needs own API keys (Postiz, TTS), JSONB column or separate table
- **Visual Profile Indicator** — User must always know active profile, profile name + icon/color in navbar
- **TTS Provider Selection** — Users expect choice between free/paid, radio buttons for Edge TTS (free) vs ElevenLabs (paid)
- **Per-Profile Postiz Config** — Each store publishes to different social accounts, store API URL + key per profile

**Should have (competitive):**
- **Profile Creation Wizard** — Smooth onboarding for new stores, 3-step flow: Name → TTS defaults → Postiz credentials
- **TTS Voice Preview** — Test voice before generating full video, "Play sample" with 1-2 sentence test
- **TTS Cost Comparison Widget** — Show real-time cost: "ElevenLabs: $0.22 vs Edge TTS: $0.00", uses existing cost_tracker
- **Profile-Specific Context Text** — Default AI analysis prompts per store (product categories differ), pre-fills upload form
- **Cross-Profile Asset Copying** — Reuse successful scripts between stores, "Copy project to [Profile]" action

**Defer (v2+):**
- Team collaboration / Multi-user (unnecessary for 2-profile personal tool)
- Profile permissions / RBAC (meaningless when one person manages both)
- Advanced profile hierarchy (flat structure sufficient)
- Profile-specific UI themes (visual customization adds no value)
- Cross-profile publishing (defeats purpose of isolation)

### Architecture Approach

Multi-tenant isolation requires three-layer profile context propagation: Frontend (ProfileProvider React Context) → API (profile middleware with validation) → Database (RLS policies). The key architectural decision is using shared tables with `profile_id` foreign keys rather than schema-per-tenant, which matches Supabase best practices for 2-10 tenant scenarios.

**Major components:**
1. **profiles table (new)** — Stores profile metadata, TTS voice presets (default_tts_provider, elevenlabs_voice_id, edge_tts_voice), Postiz configuration (postiz_integration_ids JSONB), and user ownership mapping
2. **Profile Context Dependency (backend)** — FastAPI dependency `get_current_profile()` extracts X-Profile-Id header, validates user owns profile, returns profile_id for service layer filtering
3. **ProfileProvider Context (frontend)** — React Context managing selected profile state, loads last-used profile from localStorage, broadcasts profile-switched events to clear stale data
4. **RLS Policies (database)** — Row-Level Security filters all queries by profile_id using `(SELECT auth.uid())` wrapper pattern for 94% performance improvement
5. **Tenant-Scoped Services** — All singleton services (JobStorage, CostTracker, PostizPublisher) require explicit profile_id parameter in method signatures to prevent data leakage

**Critical patterns:**
- **Composite cache keys:** `f"{profile_id}:{project_id}"` for all in-memory structures (_generation_progress, _memory_store, _project_locks)
- **Profile-scoped temp paths:** `settings.temp_dir / profile_id / job_id / filename` to prevent FFmpeg file collisions
- **Background task context preservation:** Explicitly pass profile_id to all `background_tasks.add_task()` calls (context lost at execution time)
- **Graceful migration:** Add profile_id as nullable → create default profiles → backfill data → make non-null (prevents constraint violations)

### Critical Pitfalls

Based on analysis of multi-tenant architecture failures and Supabase RLS best practices:

1. **Enabling RLS Without Policies = Production Blackout** — RLS defaults to "deny all" when enabled. Atomic transaction required: `BEGIN; ALTER TABLE ... ENABLE RLS; CREATE POLICY ...; COMMIT;` or production stops returning data instantly (no error, just empty results).

2. **Foreign Key Migration Without Backfill = Constraint Violations** — Adding `profile_id NOT NULL REFERENCES profiles(id)` to tables with existing NULL data causes migration failure. Prevention: Multi-step migration (nullable → backfill → non-null) with staging test using production-like data volume.

3. **Singleton Services Without Tenant Context = Data Leakage** — Edit Factory's `get_job_storage()`, `get_cost_tracker()` singletons share state globally. Without explicit `profile_id` filtering in every service method, Profile 1 sees Profile 2's jobs/costs/projects (GDPR violation, SOC 2 non-compliance).

4. **In-Memory Cache Without Tenant Keys = Cross-Profile Bleeding** — `_generation_progress`, `_memory_store`, `_project_locks` use project_id-only keys. Profile 1's progress overwrites Profile 2's if same project ID. Prevention: Composite keys `f"{profile_id}:{project_id}"` or nested dicts.

5. **Background Tasks Lose Tenant Context = Jobs Execute Against Wrong Profile** — FastAPI BackgroundTasks don't preserve request context. Profile 1's video processes but saves to Profile 2's database, or worse: publishes to Profile 2's Postiz accounts. Prevention: Explicitly pass profile_id to all `background_tasks.add_task()` calls.

## Implications for Roadmap

Based on research, architectural dependencies, and pitfall analysis, suggested 5-phase structure:

### Phase 1: Database Foundation & RLS Migration
**Rationale:** All other phases depend on database schema. Must establish tenant isolation at database level before API changes to prevent data leakage during development.
**Delivers:** profiles table with RLS, profile_id columns on existing tables (nullable), default profiles created and backfilled, RLS policies with proper indexes
**Addresses:** Table stakes feature "Per-Profile Library Isolation" (from FEATURES.md), establishes defense-in-depth security
**Avoids:** Pitfall #1 (RLS blackout via atomic transaction), Pitfall #2 (constraint violations via multi-step migration), Pitfall #6 (performance degradation via pre-RLS indexing)
**Duration:** 4-6 hours
**Research needs:** Standard patterns, skip /gsd:research-phase

### Phase 2: Backend API & Service Layer Isolation
**Rationale:** With database schema in place, retrofit API layer to inject profile context into all routes and service methods. Critical to audit ALL service methods for tenant filtering.
**Delivers:** Profile management endpoints (CRUD), get_current_profile() dependency, updated library/segments/postiz routes to accept profile_id, refactored singleton services with explicit profile_id parameters
**Addresses:** Foundation for "Profile Switcher UI" and "Per-Profile Settings Storage"
**Avoids:** Pitfall #3 (singleton data leakage via explicit filtering), Pitfall #4 (cache bleeding via composite keys), Pitfall #5 (background task context loss via explicit passing), Pitfall #11 (FFmpeg temp collisions via profile-scoped paths)
**Duration:** 8-12 hours
**Research needs:** Standard FastAPI patterns, skip /gsd:research-phase

### Phase 3: Frontend Context & Profile Switcher UI
**Rationale:** With API endpoints ready, build profile selection and context propagation in frontend. Must implement profile-switched event bus to prevent stale data display.
**Delivers:** ProfileProvider React Context, ProfileSelector navbar component, X-Profile-Id injection in API client, profile creation/editing UI, auto-select last-used profile on login
**Addresses:** Table stakes features "Profile Switcher UI", "Visual Profile Indicator", "Default Profile on Login"
**Avoids:** Pitfall #9 (stale data on profile switch via event bus), Pitfall #10 (blank screen via auto-selection)
**Duration:** 6-8 hours
**Research needs:** Standard React Context patterns, skip /gsd:research-phase

### Phase 4: TTS Provider Selection & Free Integration
**Rationale:** With profile isolation working, add TTS provider choice and integrate free alternatives. Independent of profile system but benefits from per-profile settings storage.
**Delivers:** TTS provider selection UI (ElevenLabs/Edge TTS radio buttons), Kokoro TTS integration, Piper TTS (optional), voice preset management per profile, cost comparison widget, fallback logic with state reset
**Addresses:** Table stakes "TTS Provider Selection UI", differentiator "TTS Voice Preview", "TTS Cost Comparison Widget"
**Avoids:** Pitfall #8 (fallback state not reset), Pitfall #12 (quota exceeded without frontend warning)
**Duration:** 6-10 hours
**Research needs:** Kokoro/Piper API documentation (medium complexity), consider /gsd:research-phase for integration specifics

### Phase 5: Per-Profile Postiz Config & Cost Enforcement
**Rationale:** Final isolation component is per-profile publishing configuration. Also implement quota enforcement to prevent budget overruns.
**Delivers:** Profile-specific Postiz API credentials storage, Postiz integration_ids per profile, cost quota enforcement (pre-call checks), quota display in UI, profile activity history dashboard
**Addresses:** Table stakes "Per-Profile Postiz Config", differentiator "Profile Activity History"
**Avoids:** Pitfall #7 (budget overruns via quota enforcement)
**Duration:** 4-6 hours
**Research needs:** Standard patterns, skip /gsd:research-phase

### Phase Ordering Rationale

- **Database first (Phase 1):** Establishes data model and security boundaries before application code. RLS policies prevent data leakage during development. Migration complexity (backfill, indexes) requires isolated testing phase.
- **Backend before frontend (Phase 2 → 3):** API contracts must be stable before UI implementation. Profile validation logic belongs in backend (security boundary). Frontend depends on profile CRUD endpoints.
- **TTS after isolation (Phase 4):** TTS provider selection is independent of profile system architecturally, but leverages per-profile settings table from Phase 1. Can be developed in parallel with Phase 3 if needed.
- **Postiz last (Phase 5):** Publishing configuration depends on profile system working end-to-end. Least risky phase (no architectural dependencies). Cost enforcement complements existing cost_tracker, additive feature.

**Dependency chain:** Phase 1 → Phase 2 → Phase 3 (critical path). Phase 4 depends on Phase 1 only (profile settings table). Phase 5 depends on Phase 1-3 (full profile system).

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 4 (TTS Integration):** Kokoro/Piper/Coqui have different installation requirements (espeak-ng system dependency, PyTorch for Coqui, ONNX model downloads). Voice selection patterns differ per provider. Recommend /gsd:research-phase to document integration specifics, model download procedures, and error handling.

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Database Migration):** Well-documented Supabase RLS patterns, official docs provide transaction examples and index optimization guides
- **Phase 2 (Backend Services):** Standard FastAPI dependency injection, established singleton refactoring patterns
- **Phase 3 (Frontend Context):** React Context API is well-documented, profile switcher is common UI pattern
- **Phase 5 (Postiz Config):** Extension of existing Postiz integration, JSONB storage pattern already used in codebase

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Supabase RLS verified with official docs, Kokoro/Piper/Coqui versions confirmed via PyPI WebFetch, concurrently verified via npm registry. Python version constraints cross-referenced. |
| Features | HIGH | Feature expectations verified across 15+ social media management tools (Statusbrew, Agorapulse, Planable) and multi-store e-commerce platforms. Table stakes vs differentiators clearly separated. |
| Architecture | HIGH | Three-layer isolation pattern (database RLS + API validation + frontend context) verified via Supabase official docs and community implementations. Performance benchmarks (94% improvement with SELECT wrapper) cited from official troubleshooting guide. |
| Pitfalls | HIGH | All critical pitfalls sourced from official docs (Supabase RLS blackout, FastAPI background tasks), verified bug reports (ElevenLabs retry issue), and real-world case studies (multi-tenant leakage articles). Testing checklist compiled from production incidents. |

**Overall confidence:** HIGH

### Gaps to Address

**Python version compatibility:** Current Edit Factory Python version unknown. If running Python 3.13+, venv downgrade to 3.11 required before Kokoro installation (Kokoro max Python 3.12). Verify early in Phase 4.

**Existing data ownership:** Research assumes Edit Factory currently has global data (no user_id on projects/clips). Migration creates "default profile" for backfill. If existing data has user_id, backfill strategy changes to: create default profile per user, assign projects by user_id match. Verify in Phase 1 planning.

**Postiz API multi-config support:** Research assumes Postiz supports multiple API configurations. If Postiz service uses global singleton with single API key, refactoring required to instantiate per-profile. Verify Postiz service architecture early in Phase 5 planning.

**FFmpeg temp directory permissions:** Profile-scoped temp paths (`temp_dir / profile_id / job_id`) require directory creation with proper permissions. If running in containerized environment, volume mount points may need adjustment. Test in Phase 2.

**Cost tracking per-profile aggregation:** Existing cost_tracker logs to `api_costs` table. Adding `profile_id` column enables per-profile filtering, but requires migration of historical cost data. Decide whether to backfill historical costs to "default profile" or leave NULL (global costs before profiles). Address in Phase 1 migration.

## Sources

### Primary (HIGH confidence)
- [Supabase Row Level Security Official Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS patterns, policy syntax, performance optimization
- [Supabase RLS Performance Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) — 94% performance improvement benchmark, index strategies
- [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data) — app_metadata vs user_metadata, JWT claims
- [coqui-tts PyPI](https://pypi.org/project/coqui-tts/) — Version 0.27.5 confirmed Jan 26, 2026
- [piper-tts PyPI](https://pypi.org/project/piper-tts/) — Version 1.4.0 confirmed Jan 30, 2026
- [FastAPI Background Tasks Official Docs](https://fastapi.tiangolo.com/tutorial/background-tasks/) — Context preservation behavior
- [concurrently npm](https://www.npmjs.com/package/concurrently) — Version 9.2.1, 8.6M weekly downloads

### Secondary (MEDIUM confidence)
- [Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) — Real-world implementation patterns
- [Statusbrew Social Media Management Tools](https://statusbrew.com/insights/social-media-management-tools-for-agencies) — Agency workspace isolation features
- [ElevenLabs TTS Retry Bug](https://github.com/livekit/agents/issues/4135) — Verified fallback state reset issue
- [FastAPI Multi-Tenant Isolation Strategies 2026](https://medium.com/@Praxen/5-fastapi-multi-tenant-isolation-strategies-that-scale-fd536fef5f88) — Dependency injection patterns
- [Best Open-Source TTS Models in 2026](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models) — Kokoro comparison and benchmarks
- [Kokoro-82M Installation Guide](https://aleksandarhaber.com/kokoro-82m-install-and-run-locally-fast-small-and-free-text-to-speech-tts-ai-model-kokoro-82m/) — System dependency requirements

### Tertiary (LOW confidence)
- [Multi-Tenant Cache Data Leakage 2026](https://medium.com/@instatunnel/multi-tenant-leakage-when-row-level-security-fails-in-saas-da25f40c788c) — Conceptual patterns, needs validation
- [Python In-Memory Cache Multi-Tenant](https://jumpi96.github.io/A-multi-tenant-cache/) — Composite key strategy examples

---
*Research completed: 2026-02-03*
*Ready for roadmap: yes*
