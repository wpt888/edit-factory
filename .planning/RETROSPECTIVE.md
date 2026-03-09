# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v9 — Assembly Pipeline Fix + Overlays

**Shipped:** 2026-02-28
**Phases:** 4 | **Plans:** 6 | **Tasks:** 12

### What Was Built
- Assembly diversity fix: round-robin merge preserves all N segment assignments with overlapping-time-range adjacency prevention
- SRT content persistence: Step 2 TTS cache carries srt_content so Step 3 render skips redundant ElevenLabs calls
- Minimum 100ms SRT duration floor + 0.5s video timeline safety margin
- Interstitial slide controls: '+' insertion buttons, duration slider, Ken Burns animation toggle in timeline editor
- Overlay FFmpeg render service: PiP compositing + interstitial clip generation with graceful degradation
- Assembly pipeline overlay integration: PiP post-extract pass + concat list rebuild for interstitials

### What Worked
- Parallel independent phases (43 + 44) executed simultaneously without conflicts — both are backend-only fixes to different services
- Phase dependency chain (43/44 → 45 → 46) enforced correct ordering for overlay work
- Verification reports caught all integration touchpoints — no surprises at milestone audit
- Autonomous mode with auto-approved checkpoints kept execution fast (all 6 plans completed in ~1.5 hours)
- Absorbing deferred v7 phases (36-37) into v9 phases (45-46) gave clean scope closure

### What Was Inefficient
- gsd-tools summary-extract returned null for one_liner and requirements_completed fields — YAML parsing issue with bracket-style arrays vs dash-style
- gsd-tools milestone complete counted ALL phases (20) instead of just v9 phases (4) — needed manual correction
- Phase 45 left a dead code block in pipeline_routes.py that Phase 46 superseded — could have been caught in plan review

### Patterns Established
- Graceful degradation for FFmpeg overlay functions: always return safe fallback (original path or None)
- Post-extract PiP pass pattern: apply overlays after parallel segment extraction, before concat
- Interstitial concat insertion: afterMatchIndex mapping with -1 = before-first

### Key Lessons
1. When a phase creates a stub for the next phase (e.g., Phase 45 logging interstitial_slides for Phase 46), the next phase should clean up the stub rather than creating a parallel block
2. SUMMARY frontmatter `requirements-completed` should use dash-style YAML arrays for tool compatibility
3. Assembly pipeline modifications are safe to parallelize when they touch different functions (merge step vs SRT generation)

### Cost Observations
- Model mix: ~30% opus (orchestration), ~70% sonnet (execution agents)
- Sessions: 1 (full milestone in single session)
- Notable: v9 was the fastest milestone — 4 phases, 6 plans, ~1.5 hours of agent execution time

---

## Milestone: v12 — Desktop Product MVP

**Shipped:** 2026-03-09
**Phases:** 16 | **Plans:** 29

### What Was Built
- Repository pattern abstraction (106 methods) with SQLite + Supabase backends
- SQLite local database for projects, clips, settings, cost tracking, TTS cache
- Local filesystem media storage with project-scoped directories and offline CRUD
- Full auth flow: JWT injection, logout, forgot password, middleware route protection
- Lemon Squeezy license revalidation with 72h offline grace period
- Encrypted API key vault (Fernet) for ElevenLabs/Gemini with Edge TTS fallback
- Simplified 3-step pipeline with 5 style presets and batch upload queue
- Setup wizard with Free TTS preset, inline API key validation, 6 caption presets
- Brand unification and complete Romanian→English cleanup
- Electron polish: real publish config, macOS dmg target, ICO/ICNS generation

### What Worked
- Autonomous execution of 16 phases and 29 plans in a single session
- Pre-created plans for phases 67-69 reduced planning overhead
- Iterative audit-gap-closure cycle (3 rounds: Phase 74, 75, 76) caught increasingly subtle issues
- Integration checker with sonnet found diacritics in Romanian strings that grep missed
- Parallel wave execution for independent phases (70-01/02/03, 71-01/02)

### What Was Inefficient
- 3 rounds of gap closure (74, 75, 76) + 2 additional tech debt phases (77, 78, 79) — 6 extra phases beyond the original 10
- get_client() escape hatch leaves 60 routes not working in SQLite mode — intentional but limits desktop usability
- Previous grep passes for Romanian missed Unicode diacritics (ă, ț, ș) — needed exact character search
- gsd-tools summary-extract returned empty accomplishments for milestone complete

### Patterns Established
- Repository pattern with ABC interface for database abstraction
- Encrypted vault with machine-specific key derivation for API key storage
- Lazy singleton refresh pattern for service hot-reload after config changes
- SimplePipeline as isolated component to avoid modifying large page files

### Key Lessons
1. Data layer abstraction is the single largest architectural change — 106 methods across 26 tables. Plan for multiple migration waves.
2. Unicode diacritics require explicit search — grep for "Romanian" misses strings with ă/ț/ș characters
3. Audit-gap-closure cycles are valuable but scope grows — original 10 phases became 16 with 3 gap closure rounds
4. get_client() escape hatch is pragmatic but creates long-tail tech debt — 60 routes still need migration

### Cost Observations
- Model mix: ~20% opus (orchestration), ~80% sonnet (execution agents)
- Sessions: 1 (full milestone in single autonomous session)
- Notable: Largest milestone by phase count (16), all executed in one session

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v2 | 6 | 23 | First GSD milestone, established patterns |
| v3 | 5 | 12 | Refined phase scoping |
| v4 | 5 | 11 | Script-first workflow, 3 new pages |
| v5 | 7 | 13 | Product video system, batch processing |
| v6 | 8 | 16 | Hardening focus, most files touched |
| v7 | 4 | 7 | Partial ship with deferred phases |
| v8 | 5 | 8 | UX overhaul, timeline editor |
| v9 | 4 | 6 | Bug fixes + deferred completion, fastest milestone |
| v10 | 8 | 18 | Desktop launcher, Electron shell |
| v11 | 9 | 22 | Production polish, security, testing |
| v12 | 16 | 29 | Largest milestone, data layer abstraction, desktop product |

### Top Lessons (Verified Across Milestones)

1. Parallel phase execution works well for independent backend changes (v4, v9, v12)
2. Deferring phases to future milestones is better than shipping incomplete features (v7 → v9)
3. Verification reports with concrete line numbers catch integration issues before audit (v8, v9, v12)
4. Iterative audit-gap-closure cycles catch increasingly subtle issues but add scope (v12: 3 rounds)
5. Data layer abstractions require multiple migration waves — plan for escape hatches (v12)
