# Engineering Change Log

## 2026-07-19 - Multi-track timeline Phase B: background music (A2) with auto-ducking

- The A2 lane is now live: pick a per-variant background track, it plays under
  the voiceover and auto-ducks (sidechaincompress keyed on the voice) while the
  voice speaks. Server-rendered, so the Step 3 preview and Step 4 render carry
  the identical mix.
- New pure helper `build_audio_mix_filter` (`app/services/audio/mix.py`): folds
  the loudnorm-first voice chain into a `-filter_complex` and mixes ducked,
  looped/trimmed music; `amix=duration=first` + the caller's `-t` keep output
  duration identical. No music leaves the legacy `-af` path untouched. Wired
  into both `_render_with_preset` encode branches.
- `MusicSettings` model; music persisted additively in `preview_data['music']`
  (no DB migration) and folded into both cache fingerprints with a file mtime.
  Music source reuses the Blipost media library (`kind=audio`) + direct URL.
- A2 lane block + Music inspector (volume, ducking toggle, fades). Backend
  restart required for the new routes/models.
- Tests: `tests/test_bgm_mix.py` (unit + ffmpeg ducking smoke),
  `frontend/tests/timeline-music-track.spec.ts`.

See [Background music (A2) with auto-ducking — Phase B](34-bgm-ducking.md).

## 2026-07-19 - Multi-track timeline Phase A: generic tracks + images as clips

- Step 3 timeline lanes are now generic Premiere-style tracks built dynamically:
  Subtitles > Vn..V2 (image tracks, addable, cues draggable between them with a
  new left-edge trim) > V1 (magnetic video) > A1 Voiceover > A2 Music (stub) >
  SFX. Track order = z-order, mirrored in the preview overlay.
- Attention cues gained one additive `track` field (frontend type + Pydantic
  model — required server-side or PUTs strip it). Reflow helpers, the V1 lane
  and the image lane were extracted into pure modules/components; existing
  timeline specs pass unmodified. Details: page 33.

## 2026-07-19 - Karaoke highlight: three root-cause fixes + per-word box mode

- Karaoke was invisible everywhere: preview reused tag-less Step-2 SRT,
  `sanitize_srt_for_ffmpeg` destroyed `{\k}` tags on every render path, and the
  inline Step-3 player had no karaoke rendering at all. All three fixed at the
  shared roots (incl. self-healing of poisoned SRT cache entries).
- New `karaokeStyle: "color" | "box"` + `highlightBgColor` — CapCut-style
  per-word background box, burned via two-layer per-word ASS events and mirrored
  live in the inline player + settings mock. Details: page 32.

## 2026-07-19 - Consolidation: three work lots landed into main

- `feat/attention-images` committed (6 grouped commits: karaoke ASS burn,
  segment proximity, Step 1 attention picker, portable template settings,
  pipeline-UI reshuffle, timeline polish) and fast-forwarded into `main`.
- Timeline transitions V1 branch (`worktree-agent-a22083ccab05e3f25`,
  14 commits) merged into `main`; 9 conflict blocks resolved keeping BOTH
  features (attention two-pass overlay + proximity fuse kept; transitions
  validators/fades auto-merged). Its wiki page renumbered 30 -> 31 because
  attention images already claimed page 30.
- `feat/caption-studio-runner` verified already an ancestor of `main` -
  nothing to merge (tracking note was stale).
- Dead `if False and interstitial_slides:` concat path + stale "Phase 46"
  comment removed.
- Verified on main: 728 passed / 1 skipped / 18 xfailed backend tests,
  `tsc --noEmit` + `npm run build` green, real-render smoke (dip_black
  boundary luma 2 vs 126 mid-clip, front attention overlay above karaoke
  subs, 6.000s duration invariant), live Step 3 screenshot on pipeline
  "hugo, test" (transition popover + attention lane + subtitle styles).
- Gotcha: full pytest needs `.env` (ElevenLabs key) - a bare worktree fails
  `test_preview_tts_provider_failure_refunds_and_restores_forced_audio`
  with 400-instead-of-503. Port 3001 is now held by a WSL NestJS service;
  web dev verification ran on :3000 against a second backend on :8001.

## 2026-07-19 - Attention Images: Pipeline Step 1 integration + per-variant stagger

- Added a Step 1 picker (`attention-template-picker.tsx`) under Video Idea
  to choose a template + source images once for the whole pipeline, with
  a **Stagger / variant (s)** control (variant *N* shifts by
  `N × staggerSeconds`) and a **Variants (0 = all)** cap.
- Added `PUT /api/v1/pipeline/{id}/attention-selection`, persisted under a
  reserved `_selection` key in `editai_pipelines.attention_timeline`
  (can't collide with numeric preview keys); restored via
  `attention_selection` on `GET /pipeline/scripts/{id}`, including history
  restore and import.
- Added an auto-apply effect in `pipeline/page.tsx`: once a variant has a
  preview and an empty attention timeline, it calls apply-template with
  `startOffsetMs = variantIndex × staggerSeconds × 1000`; hand-edited
  (non-empty) timelines are never overwritten.
- `ApplyAttentionTemplateRequest` gained `startOffsetMs` (0–60000); cues
  are shifted after `distribute_attention_cues` and any cue overflowing
  `durationMs` is dropped.
- Verified: `test_apply_template_start_offset_staggers_and_drops_overflow`
  (backend, 3/3 in file) + `attention-step1-picker.spec.ts` (frontend,
  2/2). Screenshot `attention-step1-picker.png`.
- Gotchas recorded: frontend serves from a standalone Next.js build on
  :3947 (needs `npm run build`, EBUSY if the server process still holds
  `.next/standalone`); backend (:8000) runs without `--reload`; the
  Step 1 + stagger diff is uncommitted, interleaved in `page.tsx` /
  `pipeline_routes.py` with unrelated parallel-session work (segment
  proximity scoring, karaoke `subtitle_styler.py`) and needs hunk-level
  staging plus the mixed-EOL rebuild recipe from
  `goals/attention-images-details.md`.

See [Attention Images: Pipeline Step 1 integration + per-variant stagger](30-attention-images-pipeline-integration.md).

## 2026-07-18 - Shell parity pack — X1 (web ↔ desktop)

- Cross-repo follow-up to S2 (`social-scheduler/goals/design-x1-parity.md`),
  source of truth = web. Made on `feat/timeline-transitions-v1`, touching
  only `navbar.tsx`/`product-switcher.tsx`/`ui/button.tsx` (unrelated
  uncommitted attention-image work on that branch left untouched).
- Media Library icon `Cloud` → `Images`; product-switcher `PRODUCTS`
  descriptions made identical to web's copy (name/description only —
  href/icon stay per-app).
- Nav hover token on inactive items `hover:text-lime` →
  `hover:text-sidebar-accent-foreground` (lime isn't an approved hover
  accent).
- Group-label class copied verbatim from web's `app-nav.tsx`; nav list
  `gap-1` → `gap-0.5`; collapsed rail `pt-6` → `pt-4` and gained
  inter-group dividers (previously none).
- Footer radius `rounded-xl` → `rounded-lg` (switcher trigger, credit
  pill, user card); sidebar wordmark `h-8` → `h-11`.
- Credit widget restyled to match web: `Wallet` → `Zap` in lime + "AI
  Credits Remaining" label, no quota bar (`/platform/me` doesn't return
  one here).
- Icon collision fix: `AI Video` `Clapperboard` → `Film` (new residual
  collision with `Local Exports`'s `Film`, logged in the parity skill
  watchlist, not fixed this pass); `Generate` renamed `Context Video`
  (was colliding with web `/create`'s "Generate").
- `ui/button.tsx` base + sm/lg size radius `rounded-md` → `rounded-lg`.
- Web counterpart in the same session: `app-nav.tsx` active-route match
  made boundary-safe; `ui/button.tsx` default `h-8` → `h-9`.
- Verified: `eslint` + `tsc --noEmit` clean on both repos for the changed
  files. Screenshot `x1-parity-studio-expanded.png` (repo root) against a
  live dev server confirms the rendered result. Collapsed-rail screenshot
  (`x1-parity-studio-collapsed.png`, repo root) captured 2026-07-18 against
  the still-live `:3005` dev server (sidebar collapsed via the
  `blipost.sidebar.collapsed` localStorage key); confirms `pt-4` top
  padding and the inter-group divider lines in the icon rail.

See [Shell, spacing, and icon-sizing sweep (S2)](29-shell-spacing-sweep.md#follow-up-x1-shell-parity-pack-2026-07-18).
## 2026-07-18 - Timeline transitions V1: dip to black + flash white

- Added `transitionIn { kind: dip_black | flash_white, durationMs }` to
  composition clips (frontend type + backend `TimelineEntry`), additive with
  no migration; per-variant `defaultTransition` resolved client-side before
  any request.
- One shared backend validator at every composition ingress (save loop,
  `composition_overrides`, `composition_override`, `_timeline_from_composition`):
  bad kind/duration → 422, out-of-range → clamped [150, 600], intro clips
  stripped; filtergraph args built only from the validated enum + int.
- Render: fade-out/fade-in halves appended to `extract_segment()`'s `-vf`
  chain — timeline duration invariant by construction (real-FFmpeg ffprobe
  test), zero-transition concat `-c copy` fast path untouched; fade specs
  enter the segment cache key only when present (legacy keys byte-identical,
  invalidation limited to adjacent segments). Guards: intro clips, sides
  shorter than 2×duration, interstitial-slide boundaries.
- Step 3 UI: per-variant "Default transition" + "Duration" selects; boundary
  dot markers with popover (Cut / Dip to black / Flash white, duration
  preset, "Use variant default", override state); marker raised to z-40 over
  the z-30 trim handle after live testing caught click interception.
- Instant preview: rAF-driven opacity overlay from the TTS-audio master
  clock (pause/scrub correct, no dual playback); subtitles/attention cues
  sit above and never fade.
- Verified: 711 backend tests green (61 transitions), tsc/eslint/build
  clean, real-render boundary frames (solid black / white, control clean,
  all 6.000000s), live-app screenshots on pipeline "hugo, test".

See [Timeline transitions V1 — dip to black + flash white](31-timeline-transitions-v1.md).

## 2026-07-18 - Pipeline toolbar overlap + heading-consistency fix pack (S1)

- Rebuilt `PipelineStepper`'s toolbar as a plain flex row (context | step
  track `flex-1` | actions) instead of `absolute left-1/2` + fixed
  per-breakpoint widths, fixing the stepper/action-button overlap around
  1100-1300px viewport width.
- Removed the duplicate "Back to Scripts" button in Step 3's mobile header
  (the toolbar ghost button already owns that action).
- Gave every workspace-mode `Card` (7 sites across steps 1-3, source-videos
  card, history sidebar) `bg-background` instead of the default `bg-card`,
  removing the visible seam under the toolbar; factored the fix into a
  shared `WORKSPACE_CARD_BG` constant in `pipeline-utils.tsx`.
- Unified the Step 2/Step 3 sub-header language (`bg-background`, `h-14`).
- Split "Review Scripts (N)" / "Preview & Select Variants (N previews
  shown)" into a heading plus a separate meta line.
- Added `components/page-header.tsx` and migrated the 14 top-level pages
  that were missing `font-heading` on their H1 onto it.
- Added `font-heading` to `CardTitle`'s default className (~40 call sites).

See [Pipeline toolbar overlap + heading-consistency fix pack](28-pipeline-toolbar-heading-fixes.md).

## 2026-07-17 - Pipeline media preview host parity

- Fixed broken Pipeline thumbnails and previews caused by native media URLs
  using `127.0.0.1` while the browser page and media-session cookie used
  `localhost`.
- Added a hydration-safe runtime API URL hook and applied it to Step 3,
  source-video cards, the timeline, the thumbnail picker, variant previews,
  and completed render media.
- Normalized Windows and POSIX thumbnail paths to basename-only segment URLs,
  preventing full `C:\...` paths from being encoded into `<img>` sources.
- Verified TypeScript, focused ESLint, the Windows-path URL helper, the desktop
  media-session tests (4 passed), and CodeGraph synchronization. The standalone
  rebuild remains pending because the running Electron server locked
  `.next/standalone`; no process was terminated.

See [Pipeline media preview host parity](27-pipeline-media-preview-host-parity.md).

## 2026-07-17 - Local BlipCreative to BlipStudio SSO recovery

- Fixed the local Studio platform bridge so it calls the running BlipCreative
  app instead of the production domain, and made the web desktop-auth endpoint
  reuse the same server-only Supabase identity configuration as `/studio`.
- Confirmed that the SSO token was issued and consumed successfully; Supabase
  was healthy and the Auth.js user mapping matched the existing Supabase user.
  The visible "Desktop identity provider is unavailable" message was therefore
  a misleading fallback symptom, not the root cause.
- Found the actual failure after token consumption: the desktop production
  build unconditionally changed a browser launch from `localhost:3947` to
  `127.0.0.1:3947`. That separated Studio from the Auth.js cookie on
  `localhost:3000`, so the Creative-session check invalidated the newly issued
  Studio session and returned the user to login.
- Restricted loopback host pinning to a real Electron renderer
  (`window.editFactory?.isDesktop`). Normal browser SSO now remains on
  `localhost`; native Electron still uses `127.0.0.1` for its backend media
  cookie contract.
- Rebuilt the standalone frontend and relaunched Electron. Verified the auth
  regression check, focused ESLint, TypeScript, production build, frontend and
  backend health, and credentialed CORS from `http://localhost:3947`.

See [Local BlipCreative to BlipStudio SSO recovery](26-local-creative-studio-sso.md).

## 2026-07-17 - Step 3 "Variant Previews" timeline editor rework

- Fixed the Instant Preview frozen playhead (stuck at 0:00, no segment cuts):
  the click-primed `audio.play()` left `audio.paused` transiently false, so
  startup skipped the authoritative `play()` and ran the rAF clock loop against
  audio stuck at 0. Added `playAudioAndStartLoop()` to start the loop only after
  `play()` resolves and clear the playing state on rejection; applied to all
  startup paths and the non-intro resume.
- Removed the duplicate storyboard strip; the multi-track timeline is now the
  single segment view. Relocated its "+" attention-image insert to the Attention
  images lane; all other affordances remain via Video-lane selection + the
  inline panel. Updated the stale strip hint.
- Video lane now renders one clip block per phrase with real SRT boundaries
  (NLE semantics); adjacent same-`merge_group` clips get a subtle linked tint
  and flattened touching corners. `merge_group` data model unchanged. Pin
  indicator relocated onto clips.
- Added a Maximize control per variant card opening a near-fullscreen editor
  that reuses `TimelineEditor` via a new `displayMode="full"` prop.
- Reordered the multi-track lanes to top = topmost visual layer (Subtitles >
  Attention images > Video, then audio). Backend compositor was already correct
  (attention baked before subtitles in `assembly_service.py`); no backend change.
- New wiki page `25-step3-variant-timeline-editor.md`. Verified via clean
  `next build` + `tsc` + `eslint`; live browser verification not feasible
  without a populated pipeline and a running app instance.
- Commits: `116cfac` (preview clock fix), `c082ec5` (storyboard strip removal),
  `bd4fa9b` (per-phrase Video clips), `9c775bd` (lane order), `adb36bf`
  (maximize editor), `fbcff77` (wiki).

## 2026-07-16 - BlipStudio credit metering validated live E2E (Goal D)

- Validated the Studio→web credit metering path end-to-end for the first time
  against a running local web app and its real Postgres ledger (no mocks on the
  metering path), using the real `StudioMeteringClient` and a shared test
  `STUDIO_SERVICE_TOKEN` (local `.env`, uncommitted).
- Scenario A (with credits): reserve debited exactly the rate-card amount
  (`studio.script_pipeline`, 2 credits; balance 100→98) and capture persisted
  the spend (98, `captured`). The local `GEMINI_API_KEY` is invalid, so the
  intended in-Studio AI step failed and exercised the live reserve→refund
  fail-closed path (98→100); capture was proven as a separate live transaction.
- Scenario B (no credits): real `402 insufficient_credits`
  (`available_credits=0`) before any provider work; the live web-mode frontend
  rendered the real 402 billing toast with a **Manage credits** action to
  `https://blipost.com/billing` (screenshot captured).
- Scenario C (desktop mode): deterministic local `desktop:<uuid5>` reservation,
  captured, with zero HTTP calls to the web ledger — early access unbilled and
  unblocked.
- The prior 307 private-mode blocker is fixed on WEB by `ceb5057`. Updated
  `docs/wiki/24-blipstudio-credit-metering.md`: replaced the "Live integration
  blocker" note with the real results. No committed code changed on either repo.

## 2026-07-15 - BlipStudio credit metering (Goal B2)

- Added a fail-closed Studio-to-web metering client with durable idempotent
  reserve/capture/refund state and desktop-only structured usage logging.
- Metered asynchronous Pipeline scripts and per-variant TTS, Pipeline final
  renders/remakes, fixed-five-second Seedance, single/batch product jobs,
  standalone TTS, TTS Library assets, and Library voiceover regeneration,
  including cancellation, failure refund, settlement retry, and restart paths.
- Closed historical web-mode provider/render bypasses with explicit
  desktop-only guards, while preserving those compatibility routes in Electron.
- Added terminal crash-window recovery so a completed capture/refund cannot
  leave a pending job or cause paid provider work to run again after restart.
- Reserved final-render credits before fair queue entry so denied work never
  occupies queue capacity; product composition and encoding share one ticket.
- Added shared friendly HTTP 402 guidance with a billing action across every
  affected UI flow and fixed web Seedance to its five-second rate-card unit;
  Library voiceover render billing is re-quoted from exact generated audio.
- Verification: full backend **652 passed, 1 skipped, 18 xfailed**; focused
  metering **83 passed**; legacy guards **15 passed**; TypeScript, ESLint with
  zero errors, production Next Webpack build/post-build, and three deterministic
  Chromium 402 scenarios passed. No push was performed.
- Live two-app E2E found a Goal B1 blocker: web private mode redirects the
  internal metering routes because `/api/internal/studio` is absent from its
  public API prefixes. The inspected local environments also lack the shared
  service token. B2's web-read-only rule was preserved; the exact fix,
  provisioning, and rerun steps are documented in the page below.

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
