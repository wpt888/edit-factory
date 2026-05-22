# v13 Roadmap — Desktop Production-Ready & Monetization

**Defined:** 2026-05-22
**Status:** Active
**Phases:** 80–98 (19 phases)
**Source:** `.planning/v13-desktop-production/VISION.md`, `SCOPE.md`, `ARCHITECTURE.md`, `.planning/milestones/v13-REQUIREMENTS.md`

## Milestones (history)

- ✅ v1.0 MVP through v12 Desktop Product MVP — see `.planning/MILESTONES.md`
- 🚧 **v13 Desktop Production-Ready & Monetization** — Phases 80–98

## v13 Phase List

- [ ] **Phase 80: Library routes repository migration** — Replace all 27 `repo.get_client()` sites in `app/api/library_routes.py` with typed repository methods (~2–3 plans)
- [ ] **Phase 81: Pipeline routes repository migration** — Replace all 24 sites in `app/api/pipeline_routes.py` (~2–3 plans)
- [ ] **Phase 82: Segments routes repository migration** — Replace all 37 sites in `app/api/segments_routes.py` (~2–3 plans)
- [ ] **Phase 83: Background services repository migration** — `app/services/assembly_service.py` + `app/core/cleanup.py` (~1–2 plans)
- [ ] **Phase 84: Cross-platform paths & FFmpeg discovery** — Windows/macOS/Linux base_dir resolution + per-target FFmpeg bundling (~1 plan)
- [ ] **Phase 85: Desktop smoke-test harness (CI gate)** — Automated end-to-end run under `DATA_BACKEND=sqlite` that fails the build on any 503 (~1 plan)
- [ ] **Phase 86: ML bundle download endpoint + UI** — `POST /desktop/ml/download` + frontend installer flow with progress and resume (~2 plans)
- [ ] **Phase 87: ML feature flags & subscription gating in backend** — `412` for missing bundle, `402` for missing tier (~1 plan)
- [ ] **Phase 88: Installer slimming verification** — Confirm ≤ 550 MB without PyTorch/Whisper/Coqui + CI check on size (~1 plan)
- [ ] **Phase 89: Marketing app scaffolding** — `marketing/` Next.js 15 App Router, Tailwind, Shadcn, separate Supabase project (~1 plan)
- [ ] **Phase 90: Landing page + pricing** — Hero, features, pricing table, screenshots, FAQ; Lighthouse ≥ 90 (~1–2 plans)
- [ ] **Phase 91: Lemon Squeezy checkout + webhook** — Three-tier embedded checkout + signed webhook + license key issuance + email (~2 plans)
- [ ] **Phase 92: Account dashboard** — /account, /account/downloads, /account/license, /account/billing (~2 plans)
- [ ] **Phase 93: OAuth endpoints on marketing app** — authorize / token / refresh, PKCE, JWT with subscription_tier claim, rotating refresh tokens (~2 plans)
- [ ] **Phase 94: Desktop OAuth client (PKCE + OS keychain)** — Local callback server, `keyring` token storage, Fernet fallback (~2 plans)
- [ ] **Phase 95: Subscription tier gating in desktop UI** — Backend `/desktop/me`, frontend lock icons + Upgrade CTAs, webhook→refresh propagation (~1 plan)
- [ ] **Phase 96: GitHub Releases auto-publish pipeline** — `.github/workflows/release.yml`, parallel Win/Mac runners, draft + manual approval (~1 plan)
- [ ] **Phase 97: Onboarding flow polish + SmartScreen explainer** — First-run wizard upgrade: SmartScreen screenshots, OAuth sign-in step, optional ML download prompt (~1 plan)
- [ ] **Phase 98: Auto-updater verification + launch audit** — End-to-end update test, LAUNCH-CHECKLIST.md, gap closure audit (~1–2 plans)

**Total: 19 phases, ~28–32 plans.**

## Wave / Parallelism Plan

Within waves, plans may run in parallel. Across waves, strict ordering — Wave N must finish before Wave N+1 starts.

| Wave | Phases | Description | Why ordered |
|------|--------|-------------|-------------|
| 1 | 80 → 81 → 82 → 83 → 84 | Backend repository migration | Same code surface (`app/api/*`); serialize to validate migration pattern on first phase, prevent merge conflicts. |
| 2 | 85 | Smoke-test harness (CI gate) | Depends on Wave 1 — only meaningful once routes are migrated. |
| 3a | 86, 87, 88 (parallel) | ML bundle download + gating + installer slimming | Track B is independent of Track C, can run in parallel with Wave 3b. |
| 3b | 89 → 90 (sequential) | Marketing app scaffolding + landing page | Track C internal sequence. |
| 4 | 91, 92 (parallel) | Lemon Squeezy + account dashboard | Both depend on Wave 3b scaffolding. |
| 5 | 93 → 94 → 95 (sequential) | OAuth backend → desktop client → tier gating | Track D — strict order: server endpoints exist before client uses them. |
| 6 | 96, 97 (parallel) | Distribution + onboarding | Track E pre-launch. |
| 7 | 98 | Auto-updater verification + launch audit | Final gate. |

## v13 Phase Details

### Phase 80: Library routes repository migration

**Goal**: Every `repo.get_client()` call in `app/api/library_routes.py` (27 sites covering `/library/clips/{id}/srt`, `/audio`, `/download`, `/render`, `/regenerate-voiceover`, `/remove-audio`, `/restore`, `/permanent`, `/content`, `/tags`, `/all-clips`, `/trash`, `/projects/{id}/generate`, `/projects/{id}/generate-from-segments`, `/clips/bulk-delete`, `/clips/bulk-render`, `/sync-orphans`) is replaced with typed repository methods or `table_query(QueryFilters)` calls. Routes that previously returned `503 Database not available` under `DATA_BACKEND=sqlite` now return `200` (or the correct status for the operation).
**Depends on**: Nothing (first v13 phase).
**Requirements**: FUNC-01, FUNC-03.
**Success Criteria** (what must be TRUE):
  1. Zero `repo.get_client()` calls remain in `library_routes.py` — `grep -c "get_client()" app/api/library_routes.py` returns `0`.
  2. A `ROUTES-AUDIT.md` artifact lists each migrated call site with the pattern (A/B/C/D from ARCHITECTURE.md §1) and the repository method used.
  3. New ABC methods added to `app/repositories/base.py` are implemented in both `SupabaseRepository` and `SQLiteRepository` — no `NotImplementedError` paths.
  4. Existing routes still work in Supabase mode — regression test suite passes.
  5. Each migrated route gains a pytest case asserting `200` under `DATA_BACKEND=sqlite`.
**Plans**: 2–3 plans (e.g., audit + pattern A/B migration, pattern C/D migration, regression tests)

### Phase 81: Pipeline routes repository migration

**Goal**: Every `repo.get_client()` call in `app/api/pipeline_routes.py` (24 sites covering `/render`, `/render-preview`, `/tts`, `/preview`, `/scripts`, `/sync-to-library`, `/check-render`, `/generate-video-captions`, `/selected-captions`, `/video-caption-templates` CRUD, `/subtitle-frame-preview`) is replaced with typed repository methods. The full 4-step pipeline (script → TTS → preview → render) executes end-to-end under `DATA_BACKEND=sqlite`.
**Depends on**: Phase 80 (the migration pattern is established and ABC has the new methods).
**Requirements**: FUNC-01, FUNC-02, FUNC-03.
**Success Criteria**:
  1. Zero `repo.get_client()` calls remain in `pipeline_routes.py`.
  2. A fresh pipeline (create → script gen → TTS → render-preview → render) succeeds in SQLite mode and produces a playable mp4 in `<base_dir>/media/output/`.
  3. Per-route pytest cases pass under `DATA_BACKEND=sqlite`.
**Plans**: 2–3 plans.

### Phase 82: Segments routes repository migration

**Goal**: Every `repo.get_client()` call in `app/api/segments_routes.py` (37 sites covering source-videos CRUD + stream + preview-stream + waveform + voice-detection, segments CRUD + transforms + extract + favorite + single-use, product-groups CRUD, match-srt, frames) is replaced with typed repository methods. Segments and source videos can be created, listed, edited, deleted, streamed, and matched against TTS SRT phrases under `DATA_BACKEND=sqlite`.
**Depends on**: Phase 80.
**Requirements**: FUNC-01, FUNC-03.
**Success Criteria**:
  1. Zero `repo.get_client()` calls remain in `segments_routes.py`.
  2. Uploading a source video, extracting segments, and assigning them to a pipeline preview succeeds in SQLite mode end-to-end.
  3. Per-route pytest cases pass under `DATA_BACKEND=sqlite`.
**Plans**: 2–3 plans.

### Phase 83: Background services repository migration

**Goal**: `app/services/assembly_service.py` and `app/core/cleanup.py` no longer call `repo.get_client()`. Background tasks (segment generation, project cleanup, orphan sync) complete without silent SQLite failures.
**Depends on**: Phase 80.
**Requirements**: FUNC-01.
**Success Criteria**:
  1. Zero `repo.get_client()` calls remain in `assembly_service.py` and `core/cleanup.py`.
  2. Triggering segment generation for a fresh source video in SQLite mode produces segments and updates project status without errors in `logs/`.
**Plans**: 1–2 plans.

### Phase 84: Cross-platform paths & FFmpeg discovery

**Goal**: `app/config.py` exposes a `get_base_dir()` that returns the OS-appropriate user-data directory on Windows/macOS/Linux. FFmpeg is discovered via a resolver that checks `FFMPEG_BINARY` env var → bundled binary → system PATH, in that order, on all three OSes. `electron/package.json` `extraResources` ships per-target FFmpeg binaries.
**Depends on**: Nothing (parallel-safe with Wave 1, but executes after for clean cohabitation with route migration).
**Requirements**: FUNC-04, FUNC-05.
**Success Criteria**:
  1. On Windows, `get_base_dir()` returns `%APPDATA%\EditFactory\`; on macOS, `~/Library/Application Support/EditFactory/`; on Linux, `~/.config/EditFactory/` (or `$XDG_CONFIG_HOME/EditFactory/`).
  2. Booting the app on macOS with FFmpeg installed via Homebrew succeeds — FFmpeg resolver finds the binary.
  3. `electron/package.json` build config includes a per-target `extraResources` entry for FFmpeg binaries.
**Plans**: 1 plan.

### Phase 85: Desktop smoke-test harness (CI gate)

**Goal**: A `scripts/desktop-smoke-test.py` (or Playwright spec) boots the app in SQLite mode, hits every migrated endpoint, asserts no 5xx responses, and is wired into CI as a release gate.
**Depends on**: Phases 80–84.
**Requirements**: FUNC-02, FUNC-06.
**Success Criteria**:
  1. `python scripts/desktop-smoke-test.py` exits 0 after a full pipeline run in SQLite mode.
  2. A GitHub Actions workflow `.github/workflows/desktop-smoke.yml` runs the harness on every PR; failure blocks merge.
  3. The harness output lists each endpoint hit and its status code; visible in CI logs.
**Plans**: 1 plan.

### Phase 86: ML bundle download endpoint + UI

**Goal**: A new backend endpoint `POST /desktop/ml/download` fetches a platform-specific ML bundle (~1.5 GB) from a GitHub Release asset, streams progress via Server-Sent Events, verifies SHA256, unpacks into `<base_dir>/ml/`, and writes a `.installed` marker. A frontend settings screen exposes "Install Advanced Voice Features" with a progress bar and resume-on-failure.
**Depends on**: Phase 84 (needs `base_dir` resolution).
**Requirements**: ML-02, ML-03.
**Success Criteria**:
  1. `POST /desktop/ml/download` returns SSE progress events ending with `status: "installed"`.
  2. After successful install, `<base_dir>/ml/.installed` exists with the bundle version inside.
  3. Interrupting the download and re-invoking the endpoint resumes via HTTP Range — does not redownload completed bytes.
  4. Frontend shows progress bar live and a final success toast.
**Plans**: 2 plans.

### Phase 87: ML feature flags & subscription gating in backend

**Goal**: Backend routes that require the ML bundle return `412 Precondition Failed` with a structured error when the `<base_dir>/ml/.installed` marker is absent. Routes that require Pro tier return `402 Payment Required` (or `412` with `requires_tier`) when the JWT's `subscription_tier` is below Pro.
**Depends on**: Phase 86, Phase 95 (for tier check). Defer tier check wiring to 95 if 87 runs first.
**Requirements**: ML-04, ML-05.
**Success Criteria**:
  1. Calling a voice-mute or voice-clone route without the ML bundle installed returns `412` with `{ "error": "ml_not_installed", "feature": "<name>" }`.
  2. Calling a Pro-only feature with a Starter subscription claim returns `402` with `{ "error": "tier_insufficient", "requires_tier": "pro" }`.
**Plans**: 1 plan.

### Phase 88: Installer slimming verification

**Goal**: The Windows NSIS installer is ≤ 550 MB without PyTorch/Whisper/Coqui — verified via an automated CI check that fails the build if size exceeds the threshold.
**Depends on**: Phase 86.
**Requirements**: ML-01.
**Success Criteria**:
  1. Building the installer produces `editfactory-setup-13.0.0.exe` ≤ 550 MB.
  2. A CI step measures installer size and fails the build if > 550 MB.
**Plans**: 1 plan.

### Phase 89: Marketing app scaffolding

**Goal**: A new `marketing/` subfolder contains a Next.js 15 App Router app, independent of the existing `frontend/`. Local dev runs at port 3001, independent `package.json`, Tailwind + Shadcn/UI matching the desktop design system. Supabase Auth is wired to a SEPARATE Supabase project (not the existing one).
**Depends on**: Nothing — fully independent track.
**Requirements**: MARK-01, MARK-06.
**Success Criteria**:
  1. `marketing/package.json` exists with Next.js 15, Tailwind, Shadcn dependencies.
  2. `npm run dev` in `marketing/` starts a server on port 3001 with a placeholder home page.
  3. Supabase client in `marketing/lib/supabase.ts` uses env vars `MARKETING_SUPABASE_URL` and `MARKETING_SUPABASE_KEY` (distinct from existing app).
**Plans**: 1 plan.

### Phase 90: Landing page + pricing

**Goal**: The marketing app's home page presents a hero, feature grid, three-tier pricing table (Starter $79 / Pro $149 / Cloud Sync $39/yr), screenshots, and FAQ. Lighthouse Performance ≥ 90 and Accessibility ≥ 95.
**Depends on**: Phase 89.
**Requirements**: MARK-02.
**Success Criteria**:
  1. `marketing/app/page.tsx` renders the full landing page.
  2. `npx playwright test marketing/tests/landing.spec.ts` passes a Lighthouse run with both metrics meeting thresholds.
**Plans**: 1–2 plans.

### Phase 91: Lemon Squeezy checkout + webhook

**Goal**: Each pricing tier opens a Lemon Squeezy embedded checkout. A webhook handler at `marketing/app/api/lemon-squeezy/webhook/route.ts` verifies the signing secret, persists the order in Supabase, generates a license key, and sends a confirmation email via Resend.
**Depends on**: Phase 89.
**Requirements**: MARK-03, MARK-04.
**Success Criteria**:
  1. Clicking "Buy Starter" opens Lemon Squeezy checkout; completing a test purchase fires the webhook.
  2. The webhook is signature-verified — invalid signatures return 401.
  3. A new order row appears in `marketing.orders` Supabase table with the generated license key.
  4. A confirmation email arrives at the buyer's address with the license key and download link.
**Plans**: 2 plans.

### Phase 92: Account dashboard

**Goal**: Routes `/account` (subscription status), `/account/downloads` (Windows + macOS installer links pulled from latest GitHub Release), `/account/license` (current key, instance count, deactivate-instance action), `/account/billing` (handoff to Lemon Squeezy customer portal).
**Depends on**: Phase 91.
**Requirements**: MARK-05.
**Success Criteria**:
  1. A logged-in user with an active subscription sees their plan and renewal date on `/account`.
  2. `/account/downloads` lists installers fetched from `api.github.com/repos/.../releases/latest`.
  3. `/account/license` shows the active key and a deactivate-instance button that calls a backend endpoint.
**Plans**: 2 plans.

### Phase 93: OAuth endpoints on marketing app

**Goal**: The marketing app exposes `POST /oauth/authorize`, `GET /oauth/device`, `POST /oauth/token`, `POST /oauth/refresh`. PKCE (S256) is enforced. Access tokens are JWTs with `sub`, `email`, `subscription_tier`, `license_key`, `exp` claims. Refresh tokens are single-use and rotate.
**Depends on**: Phase 89.
**Requirements**: OAUTH-01, OAUTH-02, OAUTH-06.
**Success Criteria**:
  1. A test client can complete the full device flow: `authorize` → user approves at `/oauth/device` → `token` exchange succeeds with PKCE.
  2. A token issued for a Starter customer contains `subscription_tier: "starter"`.
  3. Refresh tokens rotate — using the same refresh token twice returns 401 on the second call.
**Plans**: 2 plans.

### Phase 94: Desktop OAuth client (PKCE + OS keychain)

**Goal**: The desktop client opens a localhost server on an ephemeral port, generates PKCE code_verifier/challenge, opens the user's default browser to the marketing app's device URL, waits for the callback, exchanges the code at the token endpoint, and stores tokens in the OS credential vault via `keyring`. Falls back to Fernet vault if `keyring` is unavailable.
**Depends on**: Phase 93.
**Requirements**: OAUTH-03, OAUTH-04, OAUTH-05, OAUTH-07.
**Success Criteria**:
  1. Clicking "Sign in" in the desktop opens the browser; approving issues tokens stored in the OS keychain.
  2. Reading tokens from the keychain on next launch returns the same values — no re-auth required.
  3. Logout wipes both tokens — keychain entries are deleted.
  4. On a Linux system without libsecret, the client falls back to the existing Fernet vault and logs a warning.
**Plans**: 2 plans.

### Phase 95: Subscription tier gating in desktop UI

**Goal**: Backend exposes `GET /desktop/me` returning `{ subscription_tier, email, license_key }` from the JWT. Frontend reads it on mount, conditionally renders Pro-only sections with a lock icon and "Upgrade" CTA that opens `marketing.editfactory.app/account/upgrade`. After a successful purchase, the desktop polls `/desktop/me` and updates the UI within 60 seconds.
**Depends on**: Phase 94.
**Requirements**: TIER-01, TIER-02, TIER-03, TIER-04.
**Success Criteria**:
  1. A Starter-tier user sees lock icons on ElevenLabs TTS and Coqui XTTS sections.
  2. Clicking the Upgrade CTA opens the browser to the marketing dashboard.
  3. Completing a Pro purchase in the browser propagates to the desktop within 60 seconds (UI auto-unlocks).
  4. Backend rejects Pro-only endpoints with `402` when called with a Starter token.
**Plans**: 1 plan.

### Phase 96: GitHub Releases auto-publish pipeline

**Goal**: A GitHub Actions workflow `.github/workflows/release.yml` triggered on tag `v13.x.x` builds Windows NSIS and macOS dmg in parallel runners, computes SHA256s, drafts a release with installer + ML bundle assets + electron-updater metadata. Publishing requires manual approval.
**Depends on**: Phase 88 (installer slimming verified).
**Requirements**: DIST-01, DIST-02.
**Success Criteria**:
  1. Pushing tag `v13.0.0-rc1` triggers the workflow.
  2. The workflow produces a draft release with `editfactory-setup-13.0.0-rc1.exe`, `EditFactory-13.0.0-rc1.dmg`, `latest.yml`, `latest-mac.yml`, and the ML bundle assets.
  3. Publishing requires clicking "Publish release" in the GitHub UI — the workflow does not auto-publish.
**Plans**: 1 plan.

### Phase 97: Onboarding flow polish + SmartScreen explainer

**Goal**: The first-run wizard explains the Windows SmartScreen "Unknown publisher" warning with annotated screenshots (since v13 ships unsigned). Surfaces the OAuth sign-in step. Optionally prompts to download the ML bundle if the user picked a Pro-marketed install.
**Depends on**: Phase 94 (OAuth sign-in step exists).
**Requirements**: DIST-04, DIST-05.
**Success Criteria**:
  1. A fresh install on Windows shows the SmartScreen explainer page with screenshots before any login UI.
  2. The OAuth sign-in step appears after the SmartScreen explainer.
  3. The wizard offers ML bundle install if the user clicks "I have a Pro license."
**Plans**: 1 plan.

### Phase 98: Auto-updater verification + launch audit

**Goal**: End-to-end verification that an installed v13.0.0 client receives a v13.0.1 update via electron-updater within 10 minutes of release publication. A `LAUNCH-CHECKLIST.md` captures manual QA results on Windows + macOS. Gap-closure round addresses any audit findings.
**Depends on**: Phase 96, 97.
**Requirements**: DIST-03, DIST-06.
**Success Criteria**:
  1. Installing v13.0.0 on a fresh Windows VM, then publishing v13.0.1, results in the installed client offering the update within 10 minutes.
  2. Restart prompt is non-blocking — the user can choose "Later" and the update applies on next launch.
  3. `LAUNCH-CHECKLIST.md` exists with checkboxes for: install on Win/Mac, OAuth sign-in, end-to-end render in SQLite mode, license activation, auto-update verified, ML bundle download verified.
  4. Any audit findings are captured as follow-up issues or closed via gap-closure plans.
**Plans**: 1–2 plans.

---
*Roadmap created: 2026-05-22*
