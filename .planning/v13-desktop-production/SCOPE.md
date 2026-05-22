---
milestone: v13
doc: SCOPE
status: pending
---

# v13 Scope — Desktop Production-Ready & Monetization

## In Scope (organized as 5 tracks)

Tracks A–B are foundational and block C/D. Track E ships everything. Within a track, plans can often run in parallel; across tracks the ordering matters.

### Track A — Functional Desktop (foundation, blocks everything else)

Without these, the desktop is unsellable; we will not start C/D until A is green.

- **A1. Repository migration — Library routes**: replace all 27 `repo.get_client()` call sites in `app/api/library_routes.py` with typed repository methods or `table_query()` filters. Affected endpoints: `/library/clips/{id}/srt`, `/audio`, `/download`, `/render`, `/regenerate-voiceover`, `/remove-audio`, `/restore`, `/permanent`, `/content`, `/tags`, `/all-clips`, `/trash`, `/projects/{id}/generate`, `/projects/{id}/generate-from-segments`, bulk-delete, bulk-render, sync-orphans. Add repository methods for compound queries we cannot express via existing filters.
- **A2. Repository migration — Pipeline routes**: replace all 24 sites in `app/api/pipeline_routes.py`. Highest-priority endpoints: `/render`, `/render-preview`, `/tts`, `/preview`, `/scripts`, `/sync-to-library`, `/check-render`, `/generate-video-captions`, `/selected-captions`, `/video-caption-templates` CRUD, `/subtitle-frame-preview`.
- **A3. Repository migration — Segments routes**: replace all 37 sites in `app/api/segments_routes.py`. Source-videos CRUD, segments CRUD/transforms/extract/favorite/single-use, product-groups CRUD, match-srt, voice-detection, waveform, preview-stream, frames.
- **A4. Repository migration — Background services**: same migration in `app/services/assembly_service.py` and `app/core/cleanup.py`. These run inside background tasks and cause silent failures (logged but no user feedback).
- **A5. Cross-platform paths & FFmpeg discovery**: replace hard-coded Windows-style paths in `app/config.py`, `app/main.py`, `run.py`. Resolve `%APPDATA%` / `~/Library/Application Support/Edit Factory/` / `~/.config/edit-factory/` correctly. FFmpeg resolver works on three OSes. Electron `extraResources` rules updated to bundle the correct FFmpeg binary per platform.
- **A6. Desktop QA harness**: a `scripts/desktop-smoke-test.py` (or Playwright spec) that boots `DATA_BACKEND=sqlite python run.py`, hits every migrated endpoint, asserts no 5xx. CI step that fails the build if a single route returns 503 in SQLite mode. This is the regression net.

### Track B — Optional ML & Asset Bundling

- **B1. ML bundle download UX**: new desktop API endpoint `POST /desktop/ml/download` that fetches the PyTorch + Silero + Whisper + Coqui XTTS bundle (~1.5 GB) from a GitHub release asset and unpacks into `%APPDATA%/EditFactory/ml/`. Frontend: a settings screen with "Enable Advanced Voice Features" button, progress bar, resume on failure, integrity check (SHA256).
- **B2. ML feature flags & gating**: backend service detects whether the ML bundle is installed; routes that require it return `412 Precondition Failed` with a helpful message and download CTA when not installed; routes that require Pro tier check the OAuth token's subscription claim.
- **B3. Installer slimming verification**: confirm NSIS installer is ≤ 550 MB without PyTorch/Whisper/Coqui. Document the exclusion filter in `electron/package.json` and add a CI check on installer size.

### Track C — Marketing/Billing Web App (new `marketing/` subfolder)

This is a **brand-new Next.js 15 app**. Zero touch on the existing web app. Deploys to a separate origin (e.g., `marketing.editfactory.app`).

- **C1. Marketing app scaffolding**: `marketing/` directory with Next.js 15 App Router, Tailwind, Shadcn/UI matching the desktop's design system. Independent `package.json`, independent build/deploy. Local dev at port 3001 (port 3000 reserved for current web app).
- **C2. Landing page + pricing**: hero, feature grid, pricing table (Starter $79 one-time, Pro $149 one-time, Cloud Sync $39/yr), screenshots, comparison table vs SaaS competitors, FAQ. Lighthouse ≥ 90 perf and ≥ 95 a11y.
- **C3. Lemon Squeezy checkout integration**: embed checkout for each variant. Server-side webhook handler (`POST /api/lemon-squeezy/webhook`) signs and persists order, generates license key, sends confirmation email with download link + license key + activation instructions.
- **C4. Account dashboard**: routes `/account` (subscription status, plan, renewals), `/account/downloads` (Windows/macOS installer links pulled from latest GitHub Release), `/account/license` (current license key, regenerate, deactivate instances), `/account/billing` (Lemon Squeezy customer portal handoff). Auth via Supabase (separate project from existing app — clean slate).

### Track D — OAuth Device Flow (the auth pattern the user explicitly requested)

This is the auth contract between the desktop client and the marketing/billing backend. Mirrors the Claude Code / `gh` / AWS CLI flow.

- **D1. OAuth endpoints on marketing app**: implement OAuth 2.0 Authorization Code with PKCE (RFC 7636) on `marketing/`. Endpoints: `POST /oauth/authorize` (issues device code + user code), `GET /oauth/device` (the browser-facing approval page), `POST /oauth/token` (exchanges code for access + refresh tokens, embeds subscription tier in JWT claims), `POST /oauth/refresh`.
- **D2. Desktop OAuth client**: new module `app/services/credentials/oauth.py`. Starts a localhost HTTP server on an ephemeral port, generates code_verifier + challenge (PKCE), opens browser to `marketing.editfactory.app/oauth/device?client_id=desktop&code_challenge=...&redirect_uri=http://localhost:PORT/callback`, waits for callback, exchanges code at token endpoint, stores tokens in the OS credential vault (Windows Credential Manager / macOS Keychain / libsecret on Linux via `keyring` Python lib). Falls back to encrypted file vault if `keyring` is unavailable.
- **D3. Subscription tier gating in desktop**: backend reads `subscription_tier` claim from the JWT and feeds it into the existing graceful-degradation hierarchy. Frontend reads from a `/desktop/me` endpoint and conditionally renders Pro-only features (ElevenLabs UI, ML feature toggles, multi-profile, Cloud Sync).
- **D4. Logout & token refresh lifecycle**: refresh tokens rotate on use; on refresh failure, the app prompts re-auth (does not silently degrade to Starter — that would mask billing issues).

### Track E — Distribution & Launch

- **E1. GitHub Releases auto-publish pipeline**: GitHub Actions workflow that on tag `v13.x.x` builds Windows NSIS + macOS dmg, computes SHA256s, drafts a release, attaches installers + the ML bundle asset. Manual approval gate before publishing.
- **E2. Auto-updater verification**: end-to-end test that an installed v13.0.0 client receives an update to v13.0.1 and applies it correctly. Includes rollback path documentation.
- **E3. Onboarding flow polish**: first-run wizard upgraded to explain the SmartScreen warning with screenshots ("Click 'More info' then 'Run anyway' — we have not yet purchased an EV signing certificate; the app is open-source and safe to verify"). OAuth sign-in step. ML bundle prompt if user picks "Pro features."
- **E4. Launch readiness audit & gap closure**: integration test pass, screenshot pass on Windows + macOS, license activation pass on a fresh machine, audit-gap-closure round per the v12 pattern.

## Out of Scope (deferred, documented to prevent scope creep)

- **Code signing** (EV cert Windows / Apple Notarization) — defer to v14 once revenue justifies the ~$500/yr cost. Workaround: onboarding screenshots.
- **Linux installer** — not in launch target. Linux users can run from source.
- **Cloud sync of project files** — Cloud Sync tier in v13 syncs license + subscription only. Project file sync is v15.
- **Mobile app** — desktop-first product, mobile is a separate product entirely.
- **In-app subscription upgrade** — clicking "Upgrade to Pro" opens the browser to the marketing site dashboard; no in-app checkout for v13.
- **Multi-user / team workspaces** — single user per install.
- **Custom voice training UI** — Coqui XTTS exposes inference, no training UI.
- **Direct social-media publishing** — Postiz integration remains as-is.
- **Migration of Postiz / schedule / image-generate routes** beyond what Track A enumerates. If they call `get_client()`, fix only what is on the route list; do not preemptively migrate all remaining routes.
- **Tauri / smaller installer rewrite** — Electron is good enough. Revisit in v15+.
- **Touching the existing web app** in any way. Zero changes to `frontend/` for marketing/billing/OAuth. (Frontend changes for ML download UI and subscription gating in the desktop app are in scope.)

## Phase breakdown (estimated 18 phases)

The skill `/gsd-discuss-phase` will refine each into a `PLAN.md`. This list is the scope contract:

| # | Phase | Track | Estimated plans |
|---|-------|-------|-----------------|
| 80 | Library routes repository migration | A | 2-3 |
| 81 | Pipeline routes repository migration | A | 2-3 |
| 82 | Segments routes repository migration | A | 2-3 |
| 83 | Background services repository migration | A | 1-2 |
| 84 | Cross-platform paths & FFmpeg discovery | A | 1 |
| 85 | Desktop smoke-test harness (CI gate) | A | 1 |
| 86 | ML bundle download endpoint + UI | B | 2 |
| 87 | ML feature flags & subscription gating in backend | B | 1 |
| 88 | Installer slimming verification | B | 1 |
| 89 | Marketing app scaffolding | C | 1 |
| 90 | Landing page + pricing | C | 1-2 |
| 91 | Lemon Squeezy checkout + webhook | C | 2 |
| 92 | Account dashboard (subscription / downloads / license) | C | 2 |
| 93 | OAuth endpoints on marketing app (authorize / token / refresh) | D | 2 |
| 94 | Desktop OAuth client (PKCE + OS keychain) | D | 2 |
| 95 | Subscription tier gating in desktop UI | D | 1 |
| 96 | GitHub Releases auto-publish pipeline | E | 1 |
| 97 | Onboarding flow polish + SmartScreen explainer | E | 1 |
| 98 | Auto-updater verification + launch audit | E | 1-2 |

Total: ~19 phases. The roadmap is sized to mirror v12 (16 phases, 29 plans, completed in a single autonomous session) with some headroom for the new marketing app surface.

## Phase ordering / parallelism rules

- **Wave 1 (sequential)**: 80 → 81 → 82 → 83 → 84 → 85. These touch the same backend layer; serialize to avoid merge conflicts and to validate the migration pattern on `library_routes.py` before applying it elsewhere.
- **Wave 2 (parallel with each other, depend on Wave 1)**: 86, 87, 88 — independent.
- **Wave 3 (parallel with each other, depend on Wave 1)**: 89, 90 — marketing app is independent of Wave 2.
- **Wave 4 (depends on 89)**: 91, 92 — checkout and dashboard need scaffolding done.
- **Wave 5 (depends on 89 + 95)**: 93, 94, 95 — OAuth needs marketing app + desktop infra.
- **Wave 6 (depends on Waves 1–5)**: 96, 97, 98 — distribution.

If executed autonomously, the agent should respect these waves and dispatch parallel work within each wave.
