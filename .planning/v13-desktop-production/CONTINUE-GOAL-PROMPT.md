<!--
Prompt for /goal in a separate Claude window to run GSD-RALPH
continuously until v13 ships. Copy everything between the --- markers
below (no markers). Body is under 4000 chars.

Usage:
  /goal <paste body here>
-->

---

Goal: Take milestone v13 (Desktop Production-Ready & Monetization) from current state to SHIPPED via continuous GSD. Do not stop after one phase. Do not pause for already-decided product questions. Loop /gsd-autonomous (or /gsd-next + plan + execute) until /gsd-progress reports complete.

STATE: v13 OPENED 2026-05-22. Phase 80 plans exist in .planning/phases/80-library-routes-repository-migration/ (80-01/02/03-PLAN.md). 80-01 running. 18 more phases (81-98) remain. If STATE.md frontmatter says "milestone: v1.0" total_phases:1, gsd-tools corrupted it — repair to v13 / 19 / "Desktop Production-Ready & Monetization" before continuing.

SOURCES (read before any decision):
- .planning/v13-desktop-production/VISION.md — definition of done, non-negotiables
- .planning/v13-desktop-production/SCOPE.md — 5 tracks (A=Functional, B=ML, C=Marketing, D=OAuth, E=Distribution), wave rules
- .planning/v13-desktop-production/ARCHITECTURE.md — repo migration patterns A/B/C/D, OAuth diagram, ML download, paths
- .planning/milestones/v13-REQUIREMENTS.md — 34 reqs mapped to phases
- .planning/milestones/v13-ROADMAP.md — per-phase Goal/Depends/Success Criteria/Plans

ALREADY DECIDED (do not re-ask):
- Single big milestone (19 phases), not split.
- Marketing app in NEW marketing/ subfolder, port 3001, separate Supabase project. Existing frontend/ NOT touched.
- Pricing BYOAK: Starter $79 / Pro $149 one-time + Cloud Sync $39/yr.
- No code signing in v13. SmartScreen explainer in onboarding. Signing -> v14.
- ML features = optional ~1.5GB post-install bundle (PyTorch+Silero+Whisper+Coqui). Base installer <=550MB.
- Auth = OAuth 2.0 device flow with PKCE. Tokens in OS keychain via keyring lib. Fernet fallback.

WAVE ORDER (strict across, parallel within):
1. 80->81->82->83->84 sequential (same backend layer)
2. 85 smoke-test CI gate (blocks monetization merges if red)
3a. 86, 87, 88 parallel (Track B ML)
3b. 89->90 sequential (Track C scaffolding)
4. 91, 92 parallel (checkout + dashboard)
5. 93->94->95 sequential (OAuth backend -> desktop -> UI)
6. 96, 97 parallel (release + onboarding)
7. 98 final gate

NON-NEGOTIABLES:
- Existing frontend/ NEVER modified. All monetization in marketing/.
- Atomic commit per plan, push per phase, CI green before next plan.
- Wave 1 (80-85) MUST finish before Track C/D merges.
- Every migrated route gets a pytest asserting 200 (not 503) under DATA_BACKEND=sqlite.
- Three subscription layers fail-closed: Lemon Squeezy webhook -> JWT subscription_tier claim -> backend route check.

HUMAN PREREQUISITES (block Phases 91/93/96 — flag in PR, do NOT create accounts yourself):
1. Lemon Squeezy store + 3 variants + webhook signing secret
2. Second Supabase project for marketing/ (MARKETING_SUPABASE_URL/KEY)
3. Resend (or SMTP) API key for license emails
4. GitHub Actions GH_TOKEN with write:releases scope
5. macOS FFmpeg binary in repo or CI fetch

LOOP per iteration:
1. Read STATE.md. Repair frontmatter if corrupted.
2. /gsd-progress -> next action (plan, execute, audit, close).
3. Execute one action. Commit. Push.
4. Continue. Do not stop on a single phase.

DO NOT: pause on SCOPE.md-covered decisions; touch frontend/ or existing Supabase; skip Wave 2 CI gate; ship signed; re-litigate single-milestone scope.

Stop ONLY when /gsd-progress reports v13 SHIPPED, or a HUMAN PREREQUISITE blocks (then write a clear PR handoff comment and exit).

---
