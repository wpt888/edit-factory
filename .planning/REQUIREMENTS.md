# Requirements: Edit Factory

**Defined:** 2026-05-22
**Core Value:** Automated video production from any input — get social-media-ready videos with AI voiceover, synced subtitles, and matched visuals, ready to publish at scale, distributed as a true downloadable desktop product priced for indie creators.

## v13 Requirements

Requirements for Desktop Production-Ready & Monetization. Each maps to roadmap phases (80–98). See `.planning/v13-desktop-production/` for VISION, SCOPE, ARCHITECTURE.

### Functional Desktop (Track A) — closes the v12 functional gap

- [x] **FUNC-01**: Every backend endpoint that currently calls `repo.get_client()` returns a typed repository result under `DATA_BACKEND=sqlite` — no route returns `503 Database not available` during a complete end-to-end smoke test.
- [ ] **FUNC-02**: The full pipeline (upload source video → segment extraction → 3-step script→TTS→render flow → library save → tag/trash) completes successfully on a freshly installed desktop with no Supabase configured.
- [x] **FUNC-03**: Repository ABC gains the methods required by patterns currently handled via `.table().select()…` chains in `library_routes.py`, `pipeline_routes.py`, `segments_routes.py`, `assembly_service.py`, `core/cleanup.py`.
- [ ] **FUNC-04**: `app/config.py` resolves a platform-appropriate `base_dir` on Windows, macOS, and Linux (`%APPDATA%\EditFactory\`, `~/Library/Application Support/EditFactory/`, `~/.config/EditFactory/`).
- [ ] **FUNC-05**: FFmpeg resolver finds the binary on all three OSes — bundled binary in `extraResources` per-target, fallback to system PATH, fallback to `FFMPEG_BINARY` env var.
- [ ] **FUNC-06**: A `scripts/desktop-smoke-test.py` (or Playwright spec) exercises every previously-broken route in SQLite mode and is wired into CI as a release gate.

### Optional ML Bundle (Track B)

- [x] **ML-01**: The base installer remains ≤ 550 MB by excluding PyTorch / Whisper / Coqui XTTS from `extraResources`.
- [ ] **ML-02**: A new endpoint `POST /desktop/ml/download` fetches the platform-specific ML bundle (~1.5 GB) from a GitHub Release asset, streams progress via SSE, verifies SHA256, unpacks into `<base_dir>/ml/`, and writes a `.installed` marker.
- [ ] **ML-03**: The desktop UI exposes "Install Advanced Voice Features" with a progress bar and resume-on-failure behavior.
- [ ] **ML-04**: Routes that require ML return `412 Precondition Failed` with `{ "error": "ml_not_installed", "feature": "<name>" }` when the marker is absent — frontend shows an install CTA instead of a generic error.
- [ ] **ML-05**: Routes that require Pro tier return `402 Payment Required` (or `412` with `requires_tier: "pro"`) when the user's subscription claim is below Pro.

### Marketing & Billing Web App (Track C)

- [ ] **MARK-01**: A new `marketing/` subfolder contains a Next.js 15 App Router app, independent of the existing `frontend/`. Local dev port 3001 (does not collide with the existing app on 3000).
- [ ] **MARK-02**: Landing page with hero, feature grid, pricing table (Starter $79 one-time, Pro $149 one-time, Cloud Sync $39/yr), screenshots, FAQ. Lighthouse Performance ≥ 90, Accessibility ≥ 95.
- [ ] **MARK-03**: Lemon Squeezy embedded checkout for each of the three tiers — purchase issues a license key emailed to the buyer.
- [ ] **MARK-04**: Lemon Squeezy webhook handler at `marketing/app/api/lemon-squeezy/webhook/route.ts` verifies the signing secret, persists the order, generates a license key, and stores subscription_tier in Supabase.
- [ ] **MARK-05**: `/account` dashboard shows subscription status, plan, renewal date, billing portal handoff. `/account/downloads` shows latest Windows + macOS installer links pulled from GitHub Releases. `/account/license` shows the active key, instance count, and a deactivate-instance action.
- [ ] **MARK-06**: Auth is Supabase, in a SEPARATE Supabase project from the existing app's Supabase. Zero shared users between marketing.editfactory.app and the existing web app.

### OAuth Device Flow (Track D)

- [ ] **OAUTH-01**: Marketing app exposes `POST /oauth/authorize` (issues device + user code), `GET /oauth/device` (browser approval page), `POST /oauth/token` (exchanges code for tokens with PKCE), `POST /oauth/refresh` (rotates refresh tokens).
- [ ] **OAUTH-02**: Tokens are JWTs signed by the marketing app. Access token TTL 1h; refresh token TTL 30 days. Claims include `sub`, `email`, `subscription_tier`, `license_key`, `exp`.
- [ ] **OAUTH-03**: Desktop client starts a localhost HTTP server on an ephemeral port, generates a PKCE code_verifier + code_challenge (S256), opens the user's default browser to the device-authorize URL with the redirect URI, waits for the callback, exchanges the code at the token endpoint, and stores tokens in the OS credential vault (`keyring` library).
- [ ] **OAUTH-04**: Token storage uses the OS credential manager (Windows Credential Manager / macOS Keychain / libsecret on Linux) via `keyring`. Falls back to the existing Fernet-encrypted file vault if `keyring` is unavailable.
- [ ] **OAUTH-05**: On refresh failure, the desktop prompts re-auth instead of silently degrading the subscription tier.
- [ ] **OAUTH-06**: Refresh tokens rotate on each use (single-use refresh).
- [ ] **OAUTH-07**: A logout action wipes both access and refresh tokens from the OS keychain.

### Subscription Tier Gating (Track D)

- [ ] **TIER-01**: Backend reads `subscription_tier` from the JWT on every authenticated request and exposes it through `GET /desktop/me`.
- [ ] **TIER-02**: Pro-only features (ElevenLabs TTS, Coqui XTTS voice clone, multi-profile, ML bundle install for advanced voice features) are blocked at the backend with `402 Payment Required` when the user is below Pro.
- [ ] **TIER-03**: Frontend reads the tier from `/desktop/me` and conditionally renders Pro-only UI sections with a lock icon and inline "Upgrade" button that opens `marketing.editfactory.app/account/upgrade`.
- [ ] **TIER-04**: A fresh Lemon Squeezy purchase propagates to the desktop within 60 seconds via a refresh-token reissue triggered by the webhook (the desktop polls `/desktop/me` after returning from the "Successful purchase" browser tab).

### Distribution & Launch (Track E)

- [ ] **DIST-01**: A GitHub Actions workflow `.github/workflows/release.yml` triggers on tag `v13.x.x`, builds Windows NSIS + macOS dmg in parallel runners, computes SHA256s, drafts a GitHub Release with installers + ML bundle assets + `latest.yml` / `latest-mac.yml` for electron-updater.
- [ ] **DIST-02**: The release pipeline includes a manual approval gate before publishing — drafts are reviewable in the GitHub UI.
- [ ] **DIST-03**: An installed v13.0.0 client receives a v13.0.1 update via electron-updater within 10 minutes of release publication. Restart prompt is non-blocking.
- [ ] **DIST-04**: First-run wizard explains the Windows SmartScreen "Unknown publisher" warning with screenshots, since v13 does not include code signing. The user can complete install through SmartScreen without external help.
- [ ] **DIST-05**: First-run wizard surfaces the OAuth sign-in flow and optionally prompts to download the ML bundle if the user chose a Pro-marketed install path.
- [ ] **DIST-06**: A `LAUNCH-CHECKLIST.md` is produced during Phase 98 capturing manual QA results on Windows + macOS for: install, OAuth sign-in, end-to-end render, license activation, auto-update verified, ML bundle download verified.

## Future Requirements

Deferred beyond v13. Tracked but not in current roadmap.

### Distribution Polish (v14)
- **SIGN-01**: EV code signing certificate for Windows (Sectigo / DigiCert) — eliminate SmartScreen warning
- **SIGN-02**: Apple Developer Program + notarization for macOS — eliminate Gatekeeper warning
- **SIGN-03**: Reproducible builds + provenance attestation (SLSA)

### Cloud Sync (v15)
- **SYNC-01**: Project file sync between user's devices (Cloud Sync tier)
- **SYNC-02**: Settings sync between devices

### Collaboration (v16+)
- **COLLAB-01**: Multiple users share access to the same project
- **COLLAB-02**: Team workspace with role-based permissions

### Linux & Other Targets
- **LINUX-01**: Linux AppImage / deb / rpm installer

## Out of Scope

| Feature | Reason |
|---------|--------|
| Code signing in v13 | EV cert ~$400/yr + Apple Dev $99/yr — defer until revenue justifies. Mitigation: SmartScreen explainer in onboarding. |
| Linux installer | Windows + macOS first; Linux users can run from source for v13. |
| Tauri migration | Electron is good enough. Revisit in v15+ if installer size or memory becomes the actual blocker. |
| Touching the existing web app | The current web app remains untouched. Marketing/billing/OAuth all go to `marketing/`. |
| In-app subscription upgrade | "Upgrade to Pro" opens browser to marketing dashboard. No in-app checkout in v13. |
| Multi-user / team workspaces | Single user per install in v13. |
| Real-time collaboration | Same reason. |
| Custom voice training UI | Coqui XTTS exposes inference only. Training is out. |
| Direct social-media publishing | Postiz integration remains as-is. |
| Project file cloud sync | Cloud Sync tier syncs license + subscription only in v13. File sync is v15. |
| Mobile app | Desktop-first product. |
| Migration of Postiz/schedule/image-generate routes beyond Track A scope | Only fix what's on the route list. Do not preemptively migrate. |
| Server-side video processing | Local CPU/GPU only — no cloud rendering. Core to the monetization model. |

## Traceability

Which phases cover which requirements. Filled in during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FUNC-01 | 80, 81, 82, 83, 85 | Complete |
| FUNC-02 | 85 (smoke test gate) | Pending |
| FUNC-03 | 80, 81, 82, 83 (ABC method additions) | Complete |
| FUNC-04 | 84 | Pending |
| FUNC-05 | 84 | Pending |
| FUNC-06 | 85 | Pending |
| ML-01 | 88 | Complete |
| ML-02 | 86 | Pending |
| ML-03 | 86 | Pending |
| ML-04 | 87 | Pending |
| ML-05 | 87 | Pending |
| MARK-01 | 89 | Pending |
| MARK-02 | 90 | Pending |
| MARK-03 | 91 | Pending |
| MARK-04 | 91 | Pending |
| MARK-05 | 92 | Pending |
| MARK-06 | 89 | Pending |
| OAUTH-01 | 93 | Pending |
| OAUTH-02 | 93 | Pending |
| OAUTH-03 | 94 | Pending |
| OAUTH-04 | 94 | Pending |
| OAUTH-05 | 94 | Pending |
| OAUTH-06 | 93 | Pending |
| OAUTH-07 | 94 | Pending |
| TIER-01 | 95 | Pending |
| TIER-02 | 95 | Pending |
| TIER-03 | 95 | Pending |
| TIER-04 | 95 | Pending |
| DIST-01 | 96 | Pending |
| DIST-02 | 96 | Pending |
| DIST-03 | 98 | Pending |
| DIST-04 | 97 | Pending |
| DIST-05 | 97 | Pending |
| DIST-06 | 98 | Pending |

**Coverage:**
- v13 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0

---
*Requirements defined: 2026-05-22*
*Source documents: `.planning/v13-desktop-production/VISION.md`, `SCOPE.md`, `ARCHITECTURE.md`*
