---
milestone: v13
name: Desktop Production-Ready & Monetization
status: pending
target_phases: 16-20
target_ship: TBD (user-driven, single autonomous push)
parent_milestone: v12 (Desktop Product MVP — shipped 2026-03-09)
---

# v13 — Desktop Production-Ready & Monetization

## Why this milestone exists

Edit Factory cannot be monetized as a SaaS without major data-center investment. Routing all video processing (FFmpeg, Gemini frame analysis, ElevenLabs TTS, Whisper, Coqui XTTS) through a central server creates per-user CPU/GPU/bandwidth costs that scale linearly with usage and make a $79–149 indie price point impossible.

**v12 shipped the foundation** — Electron shell, SQLite local repo, encrypted API-key vault, Lemon Squeezy license stub, NSIS Windows installer, macOS dmg target. But **v12 left two structural gaps that block real-world distribution**:

1. **Functional gap** — 88 backend code sites still call `repo.get_client()`, which returns `None` when `DATA_BACKEND=sqlite`. These sites cover the actual product loops (render, segments CRUD, pipeline preview, tags, trash). The desktop app can list projects and open the wizard, but it cannot complete the core "upload → segment → render" pipeline locally. We grep-counted 88 call sites across `library_routes.py` (27), `pipeline_routes.py` (24), `segments_routes.py` (37), with smaller pockets in `assembly_service.py` and `core/cleanup.py`. ROUTES-AUDIT.md (TBD) will reduce this to the unique route×operation pairs that block user flows.

2. **Monetization gap** — there is no buying path. The existing web app is the editor (which must remain untouched for live users), not a storefront. There is no separate marketing/account/billing site, no OAuth handshake the desktop client can do, no subscription enforcement.

v13 closes both gaps in one push so the product can be priced, sold, and supported as a real downloadable product.

## Definition of done

A new user who has never seen Edit Factory before can:

1. Land on **a NEW marketing site** (`marketing/` subfolder in this repo, deployed at a separate origin from the existing web app). See pricing, features, screenshots, "Download for Windows / macOS" buttons.
2. **Buy a Starter / Pro license** via Lemon Squeezy embedded checkout. Receive a license key by email and see it on their account dashboard.
3. **Download the installer** (Windows NSIS or macOS dmg) from a GitHub Releases asset, run it, see the Windows SmartScreen warning explained in onboarding (no signing certificate purchased for v13), proceed to install.
4. **Authenticate via OAuth device flow** — desktop opens browser to marketing site, user clicks "Authorize," browser redirects to a local callback server in the desktop, tokens are exchanged and stored in the OS credential vault. This mirrors the Claude Code / `gh` / AWS CLI flow exactly.
5. **Run the full pipeline locally end-to-end**: upload a source video → segment extraction (local FFmpeg + Gemini AI with their own key) → 3-step pipeline (script → TTS → render) → library tags/trash management → export. All operations succeed under `DATA_BACKEND=sqlite` with zero `503 Database not available` errors.
6. **Optionally enable advanced ML features** (Silero VAD voice-mute, Coqui XTTS voice clone, Whisper transcription) via a one-time post-install download (~1.5GB) gated behind the Pro tier.
7. **Receive a silent auto-update** via electron-updater when a new build is published to GitHub Releases. Restart prompt is non-blocking, license re-validates on first run.
8. **Hit a subscription wall** if their tier doesn't unlock a feature — e.g., Starter user clicks "ElevenLabs TTS" and sees an inline upgrade prompt; Pro user proceeds.

If any of the above breaks, v13 is not done.

## Non-negotiables

- **The existing web app at the current origin is not modified**. Zero risk of regression for current users of the editor. All marketing/billing work goes into the new `marketing/` subfolder.
- **Repository migration is the foundation** — no monetization work merges to main until the 88 `get_client()` sites no longer fail under `DATA_BACKEND=sqlite`. Otherwise we will sell people a broken app.
- **OAuth device flow ships at v13 launch**. The user has accepted this as part of the milestone. It is the only acceptable auth pattern for a downloadable client tied to a server-side subscription.
- **No code signing for v13** — installer warnings are documented in onboarding. v14 may add an EV certificate after revenue justifies it.
- **No PyTorch in base installer** — installer stays under ~500MB. ML features download on demand with a clear progress UI, and only attempt download when the feature is invoked.
- **Cross-platform paths from day one** — Windows, macOS, Linux all resolve `%APPDATA%` / `~/Library/Application Support/` / `~/.config/` correctly. v12 left this Windows-leaning; v13 fixes the residue.

## What is explicitly NOT in v13

- Code signing (EV cert Windows / Apple Developer Notarization) — deferred to v14
- Tauri migration — Electron is good enough
- Real-time collaboration / multi-user
- Mobile app
- Cloud sync between devices for project files (only license + subscription syncs to cloud)
- Custom voice cloning UI (Coqui XTTS is exposed but training UI is out)
- Direct social-media publishing from desktop (Postiz integration remains as-is)
- Migration of additional Supabase-coupled features beyond the 88 sites identified

## Success metrics

- Zero `503 Database not available` responses during a complete end-to-end smoke test under `DATA_BACKEND=sqlite`
- Installer size ≤ 550 MB (Windows NSIS)
- OAuth device flow round-trip completes in < 10 seconds on a fresh install
- ML optional download succeeds on Windows + macOS, with resume-on-fail
- First production GitHub Release published with auto-update verified end-to-end
- Marketing site Lighthouse score: Performance ≥ 90, Accessibility ≥ 95

## Risks acknowledged at planning time

- **Scope is the largest milestone ever attempted in this project** (v12 was 16 phases, v13 targets 16–20). Mitigation: aggressive parallel wave execution where independent (Track A/B/C in SCOPE.md), and the v13 SCOPE.md hard scope list — anything not on that list is out.
- **No signing means SmartScreen warnings will hurt early conversion.** Mitigation: a screenshot-rich onboarding page that explicitly walks the user through "More info → Run anyway."
- **Lemon Squeezy + OAuth integration is new ground for this codebase.** Mitigation: the marketing app is built fresh in Next.js 15 with a clean architecture; the existing web app is not entangled.
- **88 routes is a large surface area to migrate without regression.** Mitigation: an explicit ROUTES-AUDIT.md (produced during planning) enumerates each route and the repository method it should call; tests are added per migrated route.

See `SCOPE.md` for the in/out list and phase breakdown. See `ARCHITECTURE.md` for the technical layout — repo migration patterns, OAuth device flow, ML download UX, cross-platform paths.
