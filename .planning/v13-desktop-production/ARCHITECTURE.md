---
milestone: v13
doc: ARCHITECTURE
status: pending
---

# v13 Architecture — Technical Decisions

## 1. Repository migration pattern

The 88 `repo.get_client()` call sites are not 88 unique problems; they are roughly 4 query patterns repeated. The migration is one decision per pattern.

### Pattern A — simple chained query
```python
# BEFORE
sb = repo.get_client()
res = sb.table("editai_clips").select("variant_index")\
    .eq("project_id", pid).eq("profile_id", profile_id)\
    .eq("is_deleted", False).execute()
clips = res.data
```
**Resolution**: use the existing `list_clips_by_profile(profile_id, filters=QueryFilters(eq={"project_id": pid, "is_deleted": False}))`. If no method exists, add one in `DataRepository` ABC, implement in both `SupabaseRepository` and `SQLiteRepository`.

### Pattern B — count / aggregate
```python
sb.table("editai_segments").select("id", count="exact").eq(...).execute()
```
**Resolution**: add `count_segments(filters)` method to ABC. Implementations return `int`.

### Pattern C — complex OR / range / maybe_single
```python
sb.table("...").select("*").or_(...).maybe_single().execute()
```
**Resolution**: case-by-case. Either add a named method (`get_or_create_library_project`, `find_clip_by_paths`, etc.) or refactor the route to call multiple simpler methods and combine in Python.

### Pattern D — raw SQL / RPC
```python
sb.rpc("editai_get_catalog_grouped", {...}).execute()
```
**Resolution**: `SQLiteRepository` implements equivalent SQL directly. Add named method like `list_catalog_products_grouped()` (this one already exists in the ABC — verify routes use it).

### Auditable artifact
During planning of Track A, the executor produces `ROUTES-AUDIT.md` listing each call site with: file, line, pattern (A–D), target ABC method (existing or new). This is the diff target for the migration.

## 2. Cross-platform path resolution

```
Windows:  %APPDATA%\EditFactory\                  ← base_dir
macOS:    ~/Library/Application Support/EditFactory/
Linux:    ~/.config/EditFactory/                   (XDG_CONFIG_HOME if set)

Structure (all OSes):
  base_dir/
    settings.json
    license.json
    db/editfactory.sqlite
    media/  (input, output, temp, thumbnails)
    ml/     (downloaded ML bundle, if present)
    logs/
    cache/
```

`app/config.py` exposes `get_base_dir()` that branches on `platform.system()`. FFmpeg resolver searches in order: `FFMPEG_BINARY` env var → `<resources>/ffmpeg/ffmpeg(.exe)` (bundled) → system PATH.

`electron/package.json` `extraResources` is split per-target:
- `win` → `ffmpeg/ffmpeg-master-latest-win64-gpl/bin`
- `mac` → `ffmpeg/ffmpeg-macos/bin` (must be added to repo or downloaded in CI)
- `linux` → not bundled for v13

## 3. OAuth Device Flow (Track D)

```
┌──────────────┐                         ┌─────────────────────┐
│  Desktop App │                         │  Marketing/Billing  │
│  (Electron)  │                         │   (marketing/)      │
└──────┬───────┘                         └──────────┬──────────┘
       │                                            │
       │ 1. Click "Sign in"                         │
       │ 2. Generate code_verifier (PKCE)           │
       │ 3. Start local HTTP server on :PORT        │
       │                                            │
       │ 4. shell.openExternal(                     │
       │    https://marketing.editfactory.app/      │
       │    oauth/device?                           │
       │    client_id=desktop&                      │
       │    code_challenge=...&                     │
       │    code_challenge_method=S256&             │
       │    redirect_uri=http://localhost:PORT/cb)  │
       │                                            │
       │            (browser opens) ──────────────►│
       │                                            │ 5. User sees "Authorize Edit Factory Desktop?"
       │                                            │    (already logged in to Supabase)
       │                                            │ 6. User clicks Approve
       │                                            │ 7. Server issues short-lived auth code
       │                                            │
       │            ◄────── 8. 302 to              │
       │            http://localhost:PORT/cb?       │
       │            code=AUTH_CODE                  │
       │                                            │
       │ 9. Local server captures code              │
       │ 10. POST /oauth/token                      │
       │     {code, code_verifier, client_id}       │
       │     ────────────────────────────────────► │
       │                                            │ 11. Validate PKCE, mint JWT with claims:
       │                                            │     sub, email, subscription_tier,
       │                                            │     license_key, exp (1h),
       │                                            │     refresh_token (30 days)
       │            ◄──── 12. {access, refresh}    │
       │                                            │
       │ 13. Store in OS keychain (keyring lib)     │
       │ 14. Close local server                     │
       │ 15. Desktop UI re-renders authenticated    │
       └────────────────────────────────────────────┘
```

**Key design choices**:
- **PKCE (RFC 7636)** — not a client secret, because Electron clients cannot keep secrets. PKCE protects against authorization-code interception.
- **Ephemeral local port** — picked from OS at runtime; redirect_uri must be exact-match on token exchange; ephemeral port prevents fixed-port collisions.
- **JWT claims include subscription_tier** — desktop reads this directly instead of polling subscription endpoint. Refresh tokens rotate on use, so claims update within 1 hour of a Lemon Squeezy webhook firing.
- **OS keychain via Python `keyring` library** — Windows Credential Manager, macOS Keychain, libsecret on Linux. Fallback: existing Fernet-encrypted file vault from v12.

## 4. ML optional download (Track B)

**Bundle composition** (~1.5 GB total):
- PyTorch CPU build (~700 MB)
- Silero VAD model weights (~30 MB)
- Whisper base model (~150 MB) — for CAPTIONS_AENEAS standalone tool, kept opt-in
- Coqui XTTS model (~600 MB) — voice cloning
- `kokoro` weights (~80 MB) — already in base installer? verify

**Distribution**: a single `.tar.zst` per platform attached as a GitHub Release asset, e.g., `editfactory-ml-bundle-v13.0.0-win64.tar.zst`. SHA256 published in release notes.

**Backend endpoint** (`POST /desktop/ml/download`):
```python
{
  "status": "downloading",
  "progress": 0.42,
  "downloaded_bytes": 630000000,
  "total_bytes": 1500000000,
  "eta_seconds": 120
}
```
Streams progress via Server-Sent Events. Resumes interrupted downloads via HTTP Range. After download: extract → verify SHA256 → write `ml/.installed` marker → reload affected service singletons.

**Gating**: routes that need ML check `ml/.installed` file. If missing, return `412 Precondition Failed` with `{ "error": "ml_not_installed", "feature": "voice_mute" }`. Frontend shows "Install Advanced Voice Features" CTA.

**Subscription gating** (separate dimension): some ML features (Coqui XTTS) may be Pro-only. The `412` response also includes `requires_tier: "pro"` if applicable, prompting upgrade rather than download.

## 5. Subscription enforcement layers

Three layers, fail-closed at each:

1. **Marketing app webhook** — Lemon Squeezy webhook is the source of truth. Persists subscription_tier in Supabase per user.
2. **OAuth token claims** — JWT carries the tier the desktop sees. Refresh rotates within 1 hour.
3. **Desktop runtime checks** — both backend routes and frontend UI read tier from `GET /desktop/me`. Backend enforces by tier in critical paths (render, ElevenLabs API call). UI shows lock icons but never relies on UI as the only check.

## 6. Marketing app stack

- **Framework**: Next.js 15 App Router (matches existing repo conventions, plus React Server Components for the dashboard).
- **Styling**: Tailwind + Shadcn/UI (same primitives as desktop app for visual consistency).
- **Auth**: Supabase Auth (a NEW Supabase project, not the existing one — keeps users separate; existing web app users are not auto-converted).
- **Payment**: Lemon Squeezy (already partially integrated for v12 license validation).
- **Email**: Lemon Squeezy's built-in receipts + a `marketing/lib/email.ts` using Resend for license key delivery and onboarding.
- **Deploy**: Vercel (Next.js native) or self-host. CI builds on push to main; deploys to staging on PR, prod on tag.
- **Local dev**: port 3001 (3000 reserved for existing web app); `marketing/package.json` independent.

## 7. Build & release pipeline

```
git tag v13.0.0
  ↓ (GitHub Actions: .github/workflows/release.yml)
  ├─ Windows runner: npm run dist (in electron/) → editfactory-setup-13.0.0.exe + latest.yml
  ├─ macOS runner: npm run dist:mac → EditFactory-13.0.0.dmg + latest-mac.yml
  ├─ Both: compute SHA256 of installers + ML bundle
  └─ Draft GitHub Release with:
       - editfactory-setup-13.0.0.exe
       - EditFactory-13.0.0.dmg
       - editfactory-ml-bundle-13.0.0-win64.tar.zst
       - editfactory-ml-bundle-13.0.0-mac.tar.zst
       - latest.yml, latest-mac.yml (for electron-updater)
       - SHA256SUMS.txt
  ↓ (manual approval)
Publish release → triggers electron-updater for existing installs
```

## 8. Testing strategy

- **Unit tests**: per-route migration adds a pytest case asserting the route returns 200 (not 503) under `DATA_BACKEND=sqlite`.
- **Integration smoke test**: `scripts/desktop-smoke-test.py` runs the full pipeline end-to-end in SQLite mode. Wired into CI; release is blocked if it fails.
- **Playwright (frontend)**: existing test suite extended with `marketing/` flows (checkout flow stubbed in dev, real in staging).
- **Manual QA**: Windows + macOS install + first-run wizard + OAuth + render. Documented in `LAUNCH-CHECKLIST.md` generated during Phase 98.

## 9. Risks acknowledged

- **Supabase Auth in marketing/ separate from existing app's Supabase**: doubles infra. Acceptable because of the "don't touch the existing app" constraint.
- **OAuth + Lemon Squeezy webhook race**: a fresh purchase may take 5–60 seconds for the JWT to include the new tier. Mitigation: webhook fires a `notify` to refresh-token cache; client polls `/desktop/me` after a redirect from "Successful purchase" page.
- **No code signing in v13**: SmartScreen warning will reduce installation conversion. Mitigation: onboarding page with screenshots; this is documented in VISION.md non-negotiables.
- **`keyring` Python lib reliability on Linux**: libsecret can be absent on minimal distros. Mitigation: graceful fallback to Fernet vault (already proven in v12).
