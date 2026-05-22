<!--
The text between the dashed lines below is the 4000-char-max input
for /gsd-new-milestone. It is the milestone VISION/BRIEF — the deep
detail lives in .planning/v13-desktop-production/{VISION,SCOPE,
ARCHITECTURE}.md and .planning/milestones/v13-{REQUIREMENTS,ROADMAP}.md.

To use:
  1. Open the project in Claude Code.
  2. Type:  /gsd-new-milestone
  3. Paste the text between --- markers below (3960 chars incl. spaces).
  4. The agent will gather any remaining context interactively and
     reuse the docs that already exist.
-->

---

Milestone v13: Desktop Production-Ready & Monetization. Single big milestone, 19 phases (80–98), ~28–32 plans. All deep detail already written — reuse it, do not regenerate:

- .planning/v13-desktop-production/VISION.md — why this milestone exists, definition of done, non-negotiables, what is NOT in v13
- .planning/v13-desktop-production/SCOPE.md — 5 tracks (A Functional / B ML / C Marketing / D OAuth / E Distribution), phase list with wave/parallelism rules, explicit out-of-scope
- .planning/v13-desktop-production/ARCHITECTURE.md — repo migration patterns (A/B/C/D), cross-platform path resolution, OAuth device flow diagram, ML bundle download UX, subscription enforcement layers, marketing app stack, release pipeline
- .planning/milestones/v13-REQUIREMENTS.md — 34 requirements (FUNC/ML/MARK/OAUTH/TIER/DIST) mapped to phases
- .planning/milestones/v13-ROADMAP.md — 19 phase entries with Goal / Depends / Requirements / Success Criteria / Plans

Context: v12 shipped a desktop MVP (Electron + SQLite + Lemon Squeezy license + encrypted vault) but left two structural gaps that block real-world distribution: (1) 88 backend sites in library_routes / pipeline_routes / segments_routes / assembly_service / cleanup still call repo.get_client(), which returns None under DATA_BACKEND=sqlite — the app can list projects but cannot complete render/pipeline/segment flows locally; (2) there is no monetization path — no marketing site, no Lemon Squeezy checkout, no OAuth handshake the desktop client can use. v13 closes both in one push so the product can be priced, sold, and supported as a real downloadable indie product.

User decisions already taken — do not re-ask:
- Single large milestone (19 phases), not split into v13+v14
- Marketing app lives in NEW marketing/ subfolder of this repo (not a separate repo). Port 3001. Separate Supabase project from the existing app's Supabase. The existing web app is NOT touched in v13.
- Pricing: Starter $79 one-time, Pro $149 one-time, Cloud Sync $39/year. BYOAK (bring your own API key) — user supplies their own ElevenLabs / Gemini keys.
- Code signing deferred to v14 — v13 ships unsigned with a SmartScreen explainer in the first-run wizard.
- ML features (PyTorch + Silero VAD + Whisper + Coqui XTTS) ship as an optional ~1.5GB post-install bundle download via GitHub Release asset; base installer stays ≤ 550MB.
- Auth pattern: OAuth 2.0 device flow with PKCE (RFC 7636), tokens in OS keychain via Python keyring (Windows Credential Manager / macOS Keychain / Linux libsecret), Fernet vault fallback. Mirrors Claude Code / gh / AWS CLI.

Non-negotiable constraints:
- The existing web app and Supabase project are not modified
- Repository migration (Phases 80–85, Track A) must complete and the SQLite smoke test (Phase 85) must be green before any monetization work merges to main
- OAuth device flow ships at v13 launch — not deferred
- Every migrated route gets a pytest case asserting 200 (not 503) under DATA_BACKEND=sqlite
- Three subscription enforcement layers (webhook → JWT claim → backend route check) — fail-closed at each

Wave order (strict across waves, parallel within):
1. 80→81→82→83→84 sequential (same backend layer)
2. 85 smoke-test gate
3a. 86, 87, 88 parallel (Track B)
3b. 89→90 sequential (Track C scaffolding)
4. 91, 92 parallel
5. 93→94→95 sequential (Track D)
6. 96, 97 parallel
7. 98 final gate

Action: open this milestone (PROJECT.md / STATE.md / ROADMAP.md already mark v13 active). Start Track A. Suggested first command after opening: /gsd-discuss-phase 80 or /gsd-autonomous for hands-off execution of all 19 phases.

---
