# BlipStudio production deployment

Status on 2026-07-15: production stack prepared and locally audited; Coolify
resource creation, DNS change, push, and deployment remain behind the explicit
operator approval gate.

## Runtime topology

`docker-compose.prod.yml` is the only Compose file used by the Coolify
application. It is deliberately separate from the local development stack.

```text
Cloudflare-proxied blipstudio.blipost.com
  -> Coolify/Traefik on prod-nortia
  -> frontend:3000 (Next.js standalone)

DNS-only studio-api.blipost.com
  -> Coolify/Traefik on prod-nortia
  -> backend:8000 (FastAPI/FFmpeg)
  -> external Supabase project
  -> named Docker volume studio-data at /data
```

The API hostname is DNS-only because browser uploads can exceed Cloudflare's
proxied request-size limit. Traefik terminates TLS for that exact hostname.
Neither service publishes a host port. Coolify owns routing labels and the
application network.

## Production invariants

- `NEXT_PUBLIC_DESKTOP_MODE=false` and
  `NEXT_PUBLIC_AUTH_DISABLED=false` are asserted during the frontend image
  build. A build fails if either policy changes or required public settings are
  absent.
- `NEXT_PUBLIC_*` values are supplied as Docker build arguments because Next.js
  compiles them into browser code. The same values are present at runtime for
  middleware/server execution.
- The backend runs with `DEBUG=false`, `AUTH_DISABLED=false`,
  `DESKTOP_MODE=false`, `DATA_BACKEND=supabase`, and
  `FILE_STORAGE_BACKEND=supabase`.
- Backend source uploads, thumbnails, FFmpeg intermediates, local fallbacks,
  and logs share the persistent `/data` volume. Final output is uploaded to
  the private Supabase `editai-output` bucket when available.
- Frontend health probes `/login`; backend liveness probes
  `/api/v1/health/live`. Release verification separately requires the deeper
  `/api/v1/health` response to report `status=ok`, Supabase available, and
  FFmpeg available.
- Docker build contexts use allow-lists. Local `.env` files, media, databases,
  Electron artifacts, and developer caches never enter a build context.
- The backend pins PyTorch from the official CPU-only wheel index. Kokoro
  remains available without bundling unused CUDA libraries; the index provides
  both CPython 3.11 amd64 and arm64 wheels.
- The production frontend dependency audit is clean: Next.js is on the patched
  16.2 line, Supabase JS includes the fixed WebSocket dependency, and PostCSS is
  overridden to its patched 8.5 release while Next.js catches up transitively.
  The image runs Node.js 22, matching the current Supabase JS engine contract.
- The API runs as an unprivileged Linux user. Both containers use Docker's init
  process and bounded stop grace periods.

This is a single-backend deployment. Local source/intermediate paths therefore
remain coherent. Do not scale the backend above one replica until those assets
move to shared object storage and in-memory pipeline state is externalized.

## Coolify resource

Create one new public-Git Docker Compose application, without instant deploy:

| Field | Value |
| --- | --- |
| Name | `blipstudio` |
| Repository | `https://github.com/wpt888/edit-factory` |
| Branch | `main` |
| Compose file | `/docker-compose.prod.yml` |
| Project | existing SITE_ZERO/Blipost project |
| Environment | production |
| Server/destination | `prod-nortia` / its `coolify` standalone destination |
| Git commit | exact operator-approved release SHA |
| Auto-deploy on Git push | off |
| Instant deploy | off during creation |
| Auto-generated domain | off |
| Frontend domain | `https://blipstudio.blipost.com` -> `frontend` |
| API domain | `https://studio-api.blipost.com` -> `backend` |

The resource must first parse the Compose file without deploying. Populate and
validate environment variables next, then trigger a deployment only after the
operator confirms the exact commit SHA.

## Environment variable contract

Never print, log, or commit values. Set production and not preview variants.

Required backend/build inputs:

- `SUPABASE_URL` — same value as Blipost's `DESKTOP_SUPABASE_URL`.
- `SUPABASE_KEY` — same anon-key value as
  `DESKTOP_SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` — same value as
  `DESKTOP_SUPABASE_SERVICE_ROLE_KEY`.

Authentication verification policy:

- Leave `SUPABASE_JWT_SECRET` empty by default. With the matching Supabase URL
  and anon key, the backend validates access tokens against Supabase Auth's
  `/auth/v1/user` endpoint. Set a JWT secret only after proving that it matches
  the current project's signing configuration; an old HS256 secret takes
  precedence in the backend and would reject otherwise-valid sessions.

Optional integrations, when their current production values are available:

- `GEMINI_API_KEY`.
- `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
- `ANTHROPIC_API_KEY`, `FAL_API_KEY`, `POSTIZ_API_URL`,
  `POSTIZ_API_KEY`, `MINIO_PUBLIC_URL`, and `SENTRY_DSN` for their optional
integrations.

Pre-deploy credential audit on 2026-07-15 (values were never printed):

- The local Supabase URL and anon key exactly match the values already used by
  the production Blipost container. Its service-role key is available as the
  source for the Studio resource.
- Supabase REST, ElevenLabs account/voice, fal.ai billing authentication,
  Postiz integrations, and the MinIO public endpoint all answered successfully.
- The locally configured Gemini key is rejected by Google as invalid. Do not
  copy it to Coolify. Leave the server default empty until a replacement is
  provided; users with a valid profile-scoped Gemini credential can still use
  that credential through the existing vault path.
- The frontend lockfile includes native Linux ARM64 packages for Next.js,
  Sharp, Tailwind, and Lightning CSS. A CPython 3.11 resolver dry-run also
  found compatible ARM64 wheels for the complete backend dependency tree and
  the official CPU-only PyTorch build. `srt` is the sole pure-Python package
  installed from its source distribution rather than a platform wheel.

Before deployment, audit only names, preview/build/runtime flags, and whether
each required value is non-empty. Runtime verification may inspect variable
names inside containers, never their values.

## DNS and deployment sequence

1. Confirm the target Git SHA contains the audited Compose and Docker changes.
2. Create the Coolify application pinned to that SHA, with instant deploy,
   auto-deploy, and automatic domain generation disabled. Keep forced HTTPS
   enabled. The API request must use the Compose domain array form, with one
   entry each for `frontend` and `backend`.
3. Wait for Compose parsing; confirm only `frontend` and `backend` services plus
   the `studio-data` volume are declared.
4. Populate environment variables through the Coolify API without echoing
   request bodies or responses containing values.
5. Keep the existing proxied `blipstudio.blipost.com` record. Create a DNS-only
   `A` record `studio-api.blipost.com -> 130.61.223.102`.
6. Trigger only the new BlipStudio application. Do not restart, stop, or deploy
   Blipost, Nortia, Obsid, or their workers.
7. Poll the deployment and inspect only the new application's build/runtime
   logs if it fails.

## Acceptance checks

All checks are required:

1. `HEAD https://blipstudio.blipost.com/` returns a status below 500.
2. `GET https://blipstudio.blipost.com/login` returns 200.
3. `GET https://studio-api.blipost.com/api/v1/health/live` returns 200 with
   `status=ok`.
4. `GET https://studio-api.blipost.com/api/v1/health` returns 200 with overall
   `status=ok`, `supabase_status=ok`, and `ffmpeg_status=ok`.
5. An authenticated existing Blipost user opens `/studio`, lands on the Studio
   `/pipeline`, and remains signed in after refresh.
6. A newly registered web user completes the same flow and receives a matching
   Supabase identity/profile without manual intervention.
7. Browser requests from the Studio origin pass CORS; an unrelated origin does
   not receive an allow-origin grant.
8. All pre-existing production containers remain running and healthy.

After source edits, run repository checks and `codegraph sync`. Record the
deployed application UUID and exact release SHA here only after the acceptance
checks pass.
