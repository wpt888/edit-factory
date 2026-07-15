# Engineering Change Log

## 2026-07-15 - BlipStudio credit metering (Goal B2)

- Added a fail-closed Studio-to-web metering client with durable idempotent
  reserve/capture/refund state and desktop-only structured usage logging.
- Metered asynchronous Pipeline scripts and per-variant TTS, Pipeline final
  renders/remakes, fixed-five-second Seedance, and single/batch product jobs,
  including cancellation, failure refund, settlement retry, and restart paths.
- Reserved final-render credits before fair queue entry so denied work never
  occupies queue capacity; product composition and encoding share one ticket.
- Added shared friendly HTTP 402 guidance with a billing action across every
  affected UI flow and fixed web Seedance to its five-second rate-card unit.
- Verification: full backend **594 passed, 1 skipped, 18 xfailed**; TypeScript,
  focused ESLint, production Next build, and deterministic Chromium 402 test
  passed. No push was performed.
- Live two-app E2E found a Goal B1 blocker: web private mode redirects the
  internal metering routes because `/api/internal/studio` is absent from its
  public API prefixes. B2's web-read-only rule was preserved; the exact fix and
  rerun steps are documented in the page below.

See [BlipStudio credit metering](24-blipstudio-credit-metering.md).

## 2026-07-15 — Fair multi-tenant render queue (Goal C)

- Added a process-local scheduler that dispatches final Pipeline renders in
  round-robin order between users while preserving FIFO inside each user's
  queue and the existing `MAX_CONCURRENT_RENDERS`/FFmpeg semaphore limit.
- Persisted `queued` before background execution; status polling now exposes
  one-based queue position and a recent-duration ETA. Step 4 distinguishes
  queued work from active rendering and permits immediate queued cancellation.
- Made restart behavior honest: persisted queued/processing records whose
  callbacks vanished are marked interrupted/failed and can be submitted again.
- Added scheduler and Pipeline integration tests, a deterministic Step 4
  Playwright transition test, and two browser screenshots.
- Fixed a pre-existing Windows signing-key flake exposed by the full suite:
  binary key material is now persisted with `O_BINARY`, so `0x0A` is never
  converted to CRLF.
- Verification: **564 passed, 1 skipped, 18 xfailed, 0 failed** in the full
  backend suite; TypeScript passed; focused ESLint had zero errors; Playwright
  and browser queue-to-render transition checks passed. No deployment or push
  was performed.

See [Fair multi-tenant render queue](23-render-queue-multi-tenant.md).

## 2026-07-15 — Backend suite green: five pre-existing failures fixed

- Aligned the three `TestTTSGenerate` tests with the multi-provider
  `/tts/generate` contract (`provider`+`voice_id` required; status `processing`).
- Corrected `test_build_output_basename_uses_human_readable_labels` to the
  deliberate 6-word script-slug truncation (the expectation was miscounted).
- Root-caused the `"database is locked"` failure to a leaked SQLite connection:
  `close_repository()` reset the singleton without closing its connection, so an
  orphaned handle held the `data.db` write lock (GC-delayed under coverage). Now
  `close_repository()` closes the backend connection on reset.
- Local-only env fix: installed `python-magic-bin` in the venv because
  `import magic` hung on this Windows machine (`requirements.txt` unchanged —
  prod is Linux/Docker with `libmagic1`). No pytest zombies were present.
- Full backend suite: **555 passed, 1 skipped, 18 xfailed, 0 failed** (~63 s),
  run cap-à-queue with no hacks.

See [BlipStudio web remediation](22-blipstudio-web-remediation.md).

## 2026-07-15 — BlipStudio remediation: post-verification fixes

- Kept the `generate_raw_clips` web-mode guard (a bare `video_path` reads the
  server disk) and updated its test to assert `501` in web mode plus the
  non-503 path under desktop mode.
- Made `GET /segments/browse-local` an always-`501` stub in both modes and
  deleted the dead tkinter `_PICKER_SCRIPT`; the native picker is the Electron
  IPC bridge, so no client calls the HTTP endpoint.
- Removed the `profile_id` parameter from `_get_pipeline_state_lock` so
  `save_matches` and the async-job mutators can no longer resolve two different
  locks for the same pipeline.
- Committed the superseded local-video spec deletions and ignored `.codegraph/`
  tooling state (dropping the tracked `daemon.pid`).
- Migration `054_add_pipeline_async_jobs.sql` remains unapplied — no consecrated
  migration path exists; it is documented to run at deploy.
- Full backend suite: 550 passed, 5 failed (all pre-existing/contention,
  unrelated to these fixes), 1 skipped, 18 xfailed. Frontend `tsc` clean.

See [BlipStudio web remediation](22-blipstudio-web-remediation.md).

## 2026-07-15 — BlipStudio web remediation delivered (phases B–D)

- Made local browse/find segment operations return `501` immediately in web
  mode and kept the controls/behavior available only in Electron.
- Simplified Pipeline Step 1 to footage + Video Idea, with an optional generated
  name, collapsed Advanced settings, and an upload CTA plus hard guard at zero
  segments.
- Moved script generation and per-variant TTS to persisted FastAPI background
  jobs with `202` dispatch, polling, cancellation, parallel TTS start, progress
  per variant, and restoration after refresh or from Pipeline History.
- Serialized job mutation with its per-pipeline DB write so concurrent TTS
  variants cannot regress the persisted map; terminal cancellation now wins
  against a late worker completion.
- Added the additive `generation_job`/`tts_jobs` schema migration without
  applying it to any database.
- Verified 30 backend tests, TypeScript, focused lint with zero errors, and the
  reload/history/progress flows through Playwright MCP on isolated SQLite data.
  No push or deployment was performed.

See [BlipStudio web remediation](22-blipstudio-web-remediation.md).

## 2026-07-15 — BlipStudio production stack prepared (deployment pending approval)

- Replaced the obsolete production override with a standalone Coolify Compose
  stack for the Next.js frontend, FastAPI backend, external Supabase, durable
  media workspace, and explicit liveness checks.
- Made the web build fail closed unless desktop/auth bypass flags are false and
  all compiled public settings are present.
- Removed host-port and developer `.env` coupling from production, isolated
  Docker build contexts from local credentials/media, and moved backend writes
  to a named volume while running the API unprivileged.
- Kept Kokoro support while pinning the official CPU-only PyTorch wheel, so a
  CPU production host does not receive unused multi-gigabyte CUDA libraries.
- Updated the production web dependency chain to patched Next.js, Supabase JS,
  WebSocket, and PostCSS releases; moved the image to Node.js 22 as required by
  current Supabase JS; `npm audit --omit=dev` reports zero findings.
- Selected `blipstudio.blipost.com` for the frontend and DNS-only
  `studio-api.blipost.com` for large API uploads. Coolify/DNS creation and
  deployment remain unexecuted pending the required explicit approval.

See [BlipStudio production deployment](21-blipstudio-production-deployment.md).

## 2026-07-14 — Remediere sistem segmente (transforms v2 + curățenie API)

- Executat planul din [analiza sistemului de segmente](18-analiza-segmente.md),
  orchestrat pe 3 fronturi Codex paralele; verificat: 61 teste
  `test_segment_transforms`, 28 `test_api_segments_sqlite`, 18
  `test_assembly_scoring`, tsc frontend fără erori, graf blur-fill validat
  cu un render FFmpeg de probă.
- **Contract nou transforms** (per segment, DB `editai_segments.transforms`):
  `rotation, scale, pan_x, pan_y, flip_h, flip_v, speed (0.25–4.0),
  blur_fill (bool), brightness (-1..1), contrast (0..3), saturation (0..3)`.
  `opacity` ELIMINAT peste tot (era `colorchannelmixer` spre negru, nu
  transparență); valorile vechi din DB sunt ignorate silențios la parse.
- Backend (`segment_transforms.py` + `assembly_service.py`): `speed` cu
  fereastră de extracție conștientă de viteză (`setpts` + trim exact,
  fallback-ul loop-fill existent păstrat; fără `atempo` — extracțiile sunt
  video-only `-an`); `blur_fill` înlocuiește barele negre la zoom-out cu
  fundal blurat din același cadru (split→boxblur→overlay); culoare per
  segment prin `eq` condiționat. Preview și render final împart același
  drum de extracție (paritate păstrată).
- Frontend (`segment-transform-panel` + `global-transform-panel` +
  `video-processing.ts`): slider Speed cu butoane 0.5×/1×/2×, toggle Blur
  fill (activ doar la scale<1), secțiune Color, Pan dezactivat la scale≤1,
  Opacity scos; bulk apply global suportă toate câmpurile (add-mode:
  delta-față-de-identitate pentru scale/speed/contrast/saturation).
- Curățenie API: șters endpoint-ul orfan
  `PUT /projects/{id}/segments/{id}/transforms` + `update_project_segment`
  din toate repo-urile (zero apelanți); `GET /projects/{id}/segments`
  returnează transforms-ul segmentului direct; sanitizer cu allowlist de
  chei + clamping pe range-uri la `PUT /{id}/transforms` și
  `/bulk-transforms` (cheile necunoscute, inclusiv `opacity`, sunt
  eliminate silențios, nu respinse).
- Necesită restart de backend. Amânat (faza 2): crop box desenat pe preview,
  merge/split manual de grupuri pe timeline-ul Step 3.
- Gotcha operațional Codex: sandbox-ul workspace-write acoperă doar cwd-ul
  invocării — lansat din `electron\`, orice scriere în `app/`/`frontend/` e
  respinsă ca read-only; helperul trebuie invocat din rădăcina repo-ului.

## 2026-07-14 — Web-first Creative Studio (analiză, neimplementat)

- Evaluat mutarea editorului desktop într-o secțiune "Creative Studio" pe
  blipost.com, cu compute pe Oracle Cloud, în locul lansării desktop-first
  cu code signing pe Windows/macOS/Linux.
- Verdict: sustenabil — infrastructura server-side de render (coadă
  `render_jobs`, lease atomic, fleet OCI/Hetzner, autoscaler) există deja în
  social-scheduler; motorul de render Python (`blipost_runner.py`) e deja
  byte-echivalent cu runner-ul TS. Efort de portare estimat în săptămâni.
- Identificat lista de schimbări necesare, în ordinea greutății: storage
  (surse video local → R2/OCI Object Storage), auth bridge (Supabase JWT ↔
  Auth.js prin token `blp_`), rutarea render-ului prin coada existentă în
  loc de semaforul FFmpeg local, și eliminarea shell-ului Electron +
  licențierii per-mașină pentru varianta web.
- Verificat costurile Oracle Cloud (API oficial, iulie 2026): fleet ARM A1
  cu scale-to-zero costă efectiv ~$0 idle; rate-card-ul de credite pentru
  render cloud rămâne provizoriu, de calibrat prin benchmark.
- Semnalat singurul blocker juridic nou introdus de varianta web: generarea
  TTS ElevenLabs backend-side într-un SaaS poate necesita acord OEM/
  Enterprise (pe desktop era cheia userului).
- Recomandare: nu rescrie backend-ul în TypeScript — montează FastAPI ca
  serviciu intern lângă social-scheduler, desktop-ul rămâne opțiune
  ulterioară ("render gratuit pe mașina ta").

See [Web-first Creative Studio: mutarea editorului în blipost.com](19-web-first-creative-studio.md).

## 2026-07-14 — AI auto-segmentation (design, neimplementat)

- Analizat starea modelelor video (Gemini 2.5/3, Grok, Twelve Labs) pentru
  alegerea automată a segmentelor; LLM-urile localizează temporal slab
  (~60%), deci nu cerem timestamps de la AI.
- Decis arhitectura hibridă: FFmpeg shot detection (granițe) + pHash dedup
  + Gemini pentru etichetare/selecție diversă → rânduri în
  `editai_segments`; pipeline-ul din aval rămâne neschimbat.
- Estimare: câteva zile; partea delicată e calibrarea promptului de
  selecție. De implementat ulterior.

See [AI auto-segmentation (idee, neimplementat)](17-ai-auto-segmentation.md).

## 2026-07-13 — Desktop authentication and startup recovery

- Unified website and desktop authentication on the same Supabase identity and
  application-profile ownership contract.
- Forced real authentication into the compiled desktop bundle and included the
  build policy in standalone freshness detection.
- Removed the post-login state/navigation race and allowed a small JWT clock
  skew during backend verification.
- Replaced the authenticated `/` server redirect that caused React error #310
  during session restoration.
- Added second-instance service recovery and persistent renderer diagnostics.
- Recorded the required provider order, production regression flow, and
  incident diagnostic checklist.

See [Desktop authentication and startup recovery](16-desktop-auth-startup-recovery.md).

## 2026-07-13 — ElevenLabs tenant governance

- Izolat vocile private ale subscripției comune prin atribuiri per profil;
  vocile publice `premade` și `default` rămân disponibile tuturor.
- Adăugat un ledger lunar per profil, cu rezervări atomice înainte de request
  și reconciliere după costul exact raportat de ElevenLabs.
- Separat cheile BYOK de bugetul platformei și ascuns soldul/cheia centrală din
  endpointul și badge-ul folosite de utilizator.
- Adăugat administrare pentru atribuiri și limite, erori explicite de policy,
  migrare Supabase/SQLite și teste de concurență.

See [ElevenLabs: voci izolate și credite per profil](15-elevenlabs-tenant-governance.md).

## 2026-07-13 — Pipeline source-video prerequisite

- Extracted the Pipeline Source Videos selector into a shared card used by
  Steps 1 and 2 without changing the four-step workflow.
- Surfaced available video material while users write the idea and configure
  script generation.
- Added an actionable warning when no material exists, with a direct link to
  Segments, while keeping script generation available.
- Added Playwright coverage and screenshots for Step 1 placement, the empty
  state action, and the non-blocking Generate Scripts behavior.

See [Session navigation cache](10-session-navigation-cache.md).

## 2026-07-13 — Pre-launch cosmetic pass

- Hid legacy Postiz/Buffer config cards in Settings behind a collapsed
  "Legacy integrations" section (`SHOW_LEGACY_INTEGRATIONS` flag); Schedule
  and Calendar remain fully functional on the Postiz backend.
- Renamed "Clips" to "Local Projects" in the sidebar nav and the Library
  page title (route `/librarie` unchanged), reducing the naming collision
  with the web app's AI clipping pipeline.
- Added a "Free — renders on your machine" caption under the primary
  render button in Pipeline Step 3.
- Updated the `blipost-parity` skill: closed the theme-propagation
  watchlist item and logged the Clips rename.

See [Pre-launch cosmetic pass](14-pre-launch-cosmetics.md).

## 2026-07-12 â€” AI Video with Seedance 2.0

- Added Seedance 2.0 text-to-video generation through the existing FAL credential flow.
- Download completed MP4s locally, then register each asset in both Source Videos and Library.
- Added the AI Video workspace and documented how generated clips retain the normal editing, voiceover, caption, and social publishing workflows.

See [AI Video with Seedance 2.0](13-ai-video-seedance.md).

## 2026-07-12 â€” Pacing control and timeline card labels

- Added persisted Fast/Normal/Slow Step 3 pacing that re-runs preview matching
  and is shared with preview rendering and final rendering.
- Replaced visible phrase-index timeline labels with content-focused labels and
  compact duration metadata while retaining indices in hover tooltips.

See [Preview/render segment parity](12-preview-render-parity.md).

## 2026-07-12 — Preview/render segment parity

- Matched library footage once per merge group and expanded the shared selection to per-phrase preview data.
- Added overlap-aware visual clusters, cooldown relaxation reporting, and an amber low-variety warning in Step 3.

See [Preview/render segment parity](12-preview-render-parity.md).
## 2026-07-12 - Step-3 MP4 subtitle-style fidelity

- Changed the variant-preview MP4 request to submit the resolved A/B subtitle-style object shown by the editor, including karaoke fields.
- Kept the Meta visual version for segment selection and cache addressing while preventing a second backend Meta overlay from replacing the submitted style.
- Preserved the legacy backend fallback for non-Step-3 callers and verified the focused preview/frame tests plus the frontend typecheck.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Subtitle frame-preview parity verification

- Measured the exact frame-preview and preview-render FFmpeg chains with FontSize=107; both preserve the same glyph-to-frame ratio.
- Confirmed the frame-preview endpoint keeps `original_size=1080x1920`, matching the render path, and that the frontend sends raw font-size values.
- Reactivated and updated the endpoint regression test to guard the shared subtitle reference.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Session navigation cache

- Added a profile-scoped, renderer-memory cache to the shared API client so data already loaded by any sidebar section is reused when returning to it.
- Excluded live status, progress, health, log, and event reads from the cache.
- Cleared the shared cache after every API write to keep subsequent page visits authoritative.
- Preserved Pipeline source videos across the Pipeline → Segments → Pipeline flow and kept their cache fresh after source-video library changes.
- Restored the selected source video when returning to Segments through the sidebar.

See [Session navigation cache](10-session-navigation-cache.md).

## 2026-07-11 — Desktop application health audit

- Made API tests independent of the developer's SQLite database and updated stale tests to the repository, encoding, subtitle, scoring, and desktop-path contracts.
- Restored Next.js 16 lint compliance, isolated `.next-dev` output from ESLint, and verified lint/typecheck plus a production standalone build.
- Aligned the desktop pairing copy with the web Settings heading and added accessible names to the bridge controls.
- Changed desktop unpairing to revoke the web runner before deleting its local token; offline failures keep the token so the action can be retried.
- Moved the conditional ML gate before repository access so rejected voice-mute requests do not touch SQLite.
- Recorded the remaining dirty-overlap blockers and the safe Electron bundle restoration procedure.

See [Desktop application health audit](08-desktop-health-audit.md).

## 2026-07-11 — Segments editor video and timeline redesign

- Rebuilt the source-video player with the source aspect ratio, integrated controls, and a non-overlaying black playback bar.
- Replaced the flat timeline with a filmstrip, centered waveform, numbered segment ranges, time labels, and a high-contrast playhead.
- Changed the waveform to neutral gray outside saved segments and lime only inside saved ranges.
- Made Source Videos, the center editor, Segments Library, and the video/timeline split resizable.
- Reworked deleted-segment undo so `Ctrl+Z` remains retryable after an API failure and restores important segment metadata.
- Added a visible Undo action after deletion and corrected the delete confirmation copy.

See [Segments editor: video, timeline, resizing, and undo](07-segments-editor-timeline.md).

## 2026-07-11 — Desktop startup and subtitle preview first paint

- Removed the implicit production frontend build from Electron `start`/`dev`; desktop startup no longer fails when Google Fonts cannot be downloaded.
- Added shared first-layout and `ResizeObserver` measurement for subtitle previews.
- Migrated subtitle and timeline editors to the shared reactive measurement hook.
- Added regression coverage for synchronous first-paint height and later resize updates.

See [Desktop startup and subtitle preview reliability](06-desktop-preview-reliability.md).

## 2026-07-12 — Subtitle preview scaling

- Unified the CSS subtitle scaling contract around one 1920px reference height and a shared minimum-aware helper.
- Timeline overlays now consume ResizeObserver-backed container height and re-scale in compact and expanded previews.
- Kept backend subtitle rendering unchanged as the pixel ground truth.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).

## 2026-07-12 — Subtitle Style panel restructure

- Large sticky A/B preview cards (click to select which Meta version you edit) replacing the small previews with dead space below.
- Drag-to-position: subtitle text draggable vertically on the active preview, mapped to positionY.
- Controls regrouped into Text / Position / Effects; duplicated heading removed; RO helper text translated.
- Full-width font picker with per-option font rendering; Load system fonts as adjacent button.
- Saved presets unified into the visual preset grid (delete affordance, Apply preset dropdown removed) and applied to the active A/B version.
- Karaoke-only Highlight Color control added (backend highlightColor was previously unreachable).

See [Subtitle Style panel](11-subtitle-style-panel.md).

## 2026-07-12 — Expanded preview subtitle under-scaling

- Split the shared preview height measurement into per-view hook instances (compact vs expanded) with a callback-ref observer, fixing subtitles rendering ~2.3x too small in the Expanded Preview dialog.

See [Subtitle preview scaling](09-subtitle-preview-scaling.md).
