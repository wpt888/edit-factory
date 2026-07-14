# Web-first Creative Studio — analiză (2026-07-14)

## Context

Utilizatorul evaluează abandonarea lansării desktop-first (Electron, care
cere build + code signing pe Windows/macOS/Linux) în favoarea integrării
editorului video în site-ul blipost.com (social-scheduler) ca secțiune
"Creative Studio" / "Blipost Studio", cu tot compute-ul pe server Oracle
Cloud. Desktop-ul nu moare — devine opțiune ulterioară.

Analiza acoperă: sustenabilitate, ce e de schimbat, costuri, impact asupra
prețurilor de abonament.

## Verdict

Sustenabil și mai aproape decât pare: infrastructura server-side de render
**există deja** în social-scheduler (livrată 2026-07-10). Întrebarea corectă
nu e "mutăm Electron-ul pe server", ci **"portăm pipeline-ul
script→TTS→matching→render ca un nou tip de job pe fleet-ul existent + montăm
UI-ul pipeline în blipost.com sub `/studio`"**. Efort de săptămâni, nu luni.

## Infrastructura existentă în social-scheduler (reutilizabilă)

- Coadă `render_jobs` + Lease API
  (`app/api/render/v1/{lease,pair,jobs/[id]/{heartbeat,complete,fail}}`),
  claim atomic `FOR UPDATE SKIP LOCKED` —
  `docs/wiki/architecture/render-compute-hybrid.md:36-58` (în social-scheduler)
- Contract Recipe (Zod, `lib/render/recipe.ts`):
  `{sourceR2Key, durationSec, transcript, segments[], variants[], output}`
- Fleet cloud efemer pe Oracle Cloud (OCI A1 Flex, PAYG, scale-to-zero),
  Hetzner CAX21 fallback, ordine default `oci,hetzner`; provider config
  DB-first criptat; consolă `/admin/infra`
- Autoscaler ponderat pe secunde de muncă reală, nu pe număr de joburi
- `edit_factory/app/services/blipost_runner.py` = port Python 1:1 al
  `render-runner/runner.ts` → motorul de render desktop și cel cloud sunt
  deja byte-echivalente
- Pipeline clipping AI (`worker/clip-pipeline.ts`, `worker/clip-render.ts`) și
  Caption Studio sunt deja clienți ai aceleiași cozi — Creative Studio
  trebuie să conveargă pe același Recipe contract, nu sistem paralel
- **Gotcha**: orice extensie de Recipe trebuie făcută în ambele porturi
  (TS + Python) pentru byte-echivalență; branch `feat/caption-studio-runner`
  era nemerge-uit în main la data analizei
- TTS ElevenLabs nu e încă provider în gateway-ul AI web (doar
  Kokoro/Google TTS implementate)

## Ce e deja web-ready în edit_factory

- Frontend Next.js: build standalone, Electron doar îl pornește ca proces
  copil — zero rewrite UI
- Date: `DATA_BACKEND=supabase` forțat deja pe desktop, fără SQLite în
  producție; tabele `editai_*` = sursă unică de adevăr
- Auth Supabase JWT partajat desktop/web (același proiect Supabase)
- Gemini, ElevenLabs/Edge-TTS (cu vault per-profil), FAL Seedance, Postiz —
  toate HTTP din backend
- `SupabaseFileStorage` există deja ca opt-in pentru output-uri finale
  (`FILE_STORAGE_BACKEND=supabase`)
- `queryLocalFonts()` pentru fonturi merge și în browser Chromium

## Ce trebuie schimbat

Lista de lucru, în ordinea greutății:

1. **STORAGE (problema nr. 1)**: sursele video stocate ca path absolut local
   ("no upload, no copy" — `app/api/segments_routes.py:770-814`);
   `LocalFileStorage` e default (`app/config.py:177`); TTS cache +
   intermediare FFmpeg "always remain local"
   (`app/services/file_storage.py:23-24`).
   → Upload HTTP din browser → R2 (bucket `blipost-media` există deja,
   egress zero) sau OCI Object Storage; disc de lucru pe VM-ul de render
   pentru intermediare.
2. **AUTH BRIDGE**: desktop = Supabase Auth (JWT), blipost.com = Auth.js —
   două lumi; puntea există (token `blp_` din Platform API / U1). FastAPI
   trebuie să accepte sesiunea web.
3. **CONCURENȚĂ FFMPEG**: semafor global per-proces
   (`app/services/ffmpeg_semaphore.py:36,95-108`) dimensionat pe GPU-ul
   local via `nvidia-smi` (:63-92) — gândit pentru un singur user pe o
   mașină. → Rutare prin coada `render_jobs` existentă (lease atomic +
   autoscaling + fairness per-tenant).
4. **DE ȘTERS pentru web**: shell Electron complet
   (`electron/src/main.js:6-1026`, auto-updater :853-905), file picker nativ
   (`main.js:710-729` + fallback tkinter server-side
   `segments_routes.py:686-767`), licențiere Lemon Squeezy per-mașină cu
   `instance_id` + `license.json` + 72h offline grace
   (`app/services/credentials/license.py:1-163`) → înlocuită de entitlement
   Stripe existent; `seedDesktopEnv`/APPDATA `.env` (`main.js:216-264`);
   desktop titlebar/window controls.

## Ar funcționa la fel ca pe desktop?

~90% da, 3 diferențe oneste:

| # | Diferență | Detalii |
|---|---|---|
| 1 | Upload-ul surselor | Pe desktop instant (path local); pe web userul urcă GB prin browser — singurul hit real de UX; atenuare: upload rezumabil, procesare în timpul upload-ului. |
| 2 | Viteza de render | Fără NVENC local, CPU e 3-5× mai lent per job (`app/services/encoding_presets.py:196-210`: NVENC single-pass = 3-5x mai rapid decât CPU 2-pass la calitate aproape identică); dar fleet-ul scalează orizontal → throughput total poate depăși un desktop. FFmpeg pe ARM Ampere e la paritate sau peste x86 la encoding (x264 ~1,05-2,09× vs Xeon 8380/EPYC 7763; x265 ~1,1-2,5× — surse Ampere, vendor-favorabile). GPU A10 ($2/h) doar la volum mare. |
| 3 | Preview | Randat pe server + streamat — latență puțin mai mare; cache-ul pe fingerprint funcționează identic. |

## Costuri Oracle Cloud

Verificate în API-ul oficial de prețuri Oracle, iulie 2026:

| Item | Preț |
|---|---|
| Always Free Ampere A1 | 2 OCPU / 12 GB RAM total (ÎNJUMĂTĂȚIT în 2026 de la 4/24) |
| Always Free egress | 10 TB/lună |
| Always Free block storage / object storage | 200 GB / 20 GB |
| PAYG A1 Flex | $0.01/OCPU-h + $0.0015/GB RAM-h |
| PAYG AMD E4 / E5 | $0.025 / $0.03 per OCPU-h |
| GPU VM.GPU.A10.1 | $2.00/h (~$1.460/lună continuu) |
| Block Volume | ~$0.0425/GB-lună efectiv (Balanced) |
| Object Storage | $0.0255/GB-lună |
| Egress peste 10 TB | $0.0085/GB (NA/EU) — ~10× sub AWS ($0.09/GB după 100 GB) |

- VM render 8 OCPU A1 / 48 GB, 24/7 ≈ $111/lună + storage ≈ ~$120/lună; cu
  scale-to-zero (deja implementat) costul idle ≈ $0.
- Echivalent x86 E4 ~$198/lună → ARM e alegerea corectă.
- Costuri per video (~60s): TTS ElevenLabs ~$0.10-0.30 (domină) + compute
  ~$0.01-0.05 + Gemini bănuți.
- Costuri fixe la lansare: VM-ul Coolify/nortia existent + ~$5-20 storage +
  fleet ~$0 idle.

## Prețuri abonament — nu se schimbă, se calibrează rate-card-ul

Planuri existente
(`docs/wiki/architecture/subscription-pricing-and-credit-economics.md` în
social-scheduler):

| Plan | Preț | Credite |
|---|---|---|
| Free | $0 | 100cr o dată |
| Creator (SKU starter) | $39 | 1.500cr |
| Pro (SKU creator) | $99 | 5.000cr |
| Studio | $249 | 13.000cr "coming soon", fără SKU Stripe încă |
| Agency | $499 | 28.000cr legacy renewal-only |

Top-up neactivat: 1K = $25, 5K = $100.

Rate-card relevant: script 2cr, EL Flash 9cr/1000 chars, EL Multilingual
17cr/1000 chars, render cloud 4cr/output ≤60s (**PROVIZORIU, necalibrat**),
render desktop 0cr, Wan 9cr/s, Kling 12cr/s.

Un video Studio 60s ≈ script 2 + TTS ~9 + render 4 ≈ **15 credite** →
Creator ~100 video/lună, Pro ~330. Limite sănătoase.

De făcut înainte de lansare:

- **(a)** benchmark obligatoriu pt calibrarea tarifului de render (4cr e
  provizoriu — pe web render-ul e pe banii noștri, pe desktop era 0cr pe
  mașina userului);
- **(b)** confirmare contractuală ElevenLabs — generare backend-side livrată
  în SaaS poate cere acord OEM/Enterprise; pe desktop era cheia userului, pe
  web devine problema noastră juridică → **SINGURUL blocker cu adevărat nou
  introdus de web-first**.

## Blocaje de lansare existente (neschimbate de această decizie)

Din audits/2026-07-13 (social-scheduler): Meta review → private mode off →
Stripe live (ultimul, deliberat); migrare completă ledger + teste
concurență/idempotency + review juridic expirare credite; `FAL_API_KEY` +
float; benchmark rate-card render.

## Recomandare

**Web-first, dar NU rescrie** — montează: backend-ul FastAPI rămâne în
Python, deploy ca serviciu intern lângă social-scheduler (același Coolify),
render rutat prin `render_jobs`. Port complet în TypeScript = luni de muncă
pentru zero valoare user. Desktop-ul devine ulterior opțiunea "render gratuit
pe mașina ta" (0 credite) — diferențiator de vânzare, nu cost; code signing +
instalatoare macOS/Linux ies de pe drumul critic.

Ordinea de lucru:

1. Backend R2/upload HTTP pentru surse
2. Auth bridge `blp_` → FastAPI
3. Rutarea render-ului prin `render_jobs` (Recipe type nou)
4. UI pipeline montat în blipost.com sub `/studio`
5. Benchmark + calibrare rate-card render

## Stare ecosistem la data analizei (context)

Wiki edit_factory (intrări 2026-07-11 → 07-14) arată pre-launch hardening,
nu feature work: auth unification desktop/web (16), health audit desktop
(08), ElevenLabs tenant governance (15), pre-launch cosmetics (14). Pagina
17 (AI auto-segmentation) e design-only, neimplementată. Nimic în wiki nu
discuta încă mutarea pe Oracle/renunțarea la Electron — direcție net-nouă,
consemnată prima dată de această pagină.

Hosting prod social-scheduler: Coolify pe prod-nortia (Docker Compose:
postgres → migrate → web + worker), Traefik `Host(blipost.com)`, public prin
Cloudflare din 2026-07-04, SSH doar prin Tailscale. R2 bucket activ:
`blipost-media`. CI: runner self-hosted Windows; workflow
`render-runner-image` încă blocat de billing GitHub Actions (fix cunoscut,
neaplicat).
