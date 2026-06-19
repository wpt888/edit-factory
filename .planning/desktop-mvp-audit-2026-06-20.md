# Edit Factory Desktop — Audit Complet de Produs (Feature / UX / Scalare)

> **Data:** 2026-06-20 · **Metodă:** audit multi-agent (10 mapper-i pe subsisteme + 4 analiști pe lentile) · 14 agenți, ~1.3M tokens, fiecare claim verificat în cod cu citare `file:line`.
> **Scop:** NU bug-hunt. Focus pe feature-uri, fricțiune UX, bottleneck-uri de scalare, puncte forte/moat, și ce lipsește pentru un MVP de top.

---

## 0. Verdict într-o frază

**Oasele bat SaaS-ul, suprafața nu încă.** Engine-ul face lucruri pe care cloud-ul *structural nu le poate face* (procesare locală fără upload, cost zero/video, captions word-perfect din timestamp-uri TTS, failover multi-cont ElevenLabs, preview instant client-side). Dar pe experiența *simțită* e în urma CapCut/Submagic: captions statice (nu karaoke), encode-ul final rulează pe CPU 2-pass serial chiar cu GPU disponibil, onboarding-ul cere un "Supabase anon key" pe care un seller de Shopify nu l-a auzit în viața lui. **E un produs ~70% construit; restul de 30% e aproape în întregime polish de UX + throughput, nu arhitectură nouă** — adică exact tipul *bun* de gap.

---

## 1. Cele 6 descoperiri care schimbă prioritățile (verificate în cod)

Astea sunt aurul auditului — fapte contraintuitive confirmate cu `file:line`:

1. **"Render paralel" pe variante e de fapt SERIAL.** `asyncio.gather` peste variante *pare* paralel, dar fiecare task e `async with acquire_render_slot()` iar semaforul e `MAX_CONCURRENT_RENDERS=1` (`ffmpeg_semaphore.py:28`). E *teatru de concurență* — N variante se encodează una câte una.
2. **NVENC (GPU) e detectat, apoi ocolit intenționat la render-ul final.** Toate preset-urile default la `vbr_2pass` (`encoding_presets.py:45`), iar 2-pass *forțează* `use_gpu=False` (`:69-70`). Pe o mașină cu RTX, fiecare video se encodează pe libx264 `-threads 4`. **Îți arunci singurul moat (M1: cost zero/video) la gunoi.**
3. **Datele karaoke EXISTĂ deja, doar sunt colapsate.** Captions vin din `character_start/end_times` ElevenLabs, dar sunt reduse la cue-uri de frază cu stil ASS static (`tts_subtitle_generator.py`). Partea grea (timing per-cuvânt) e rezolvată; lipsește doar emiterea tag-urilor `\k`/`\t`. **Cel mai mare ROI din tot produsul.**
4. **State-ul pipeline-ului ESTE persistat** (contrar presupunerii din brief/memorie). Se salvează la `editai_pipelines` la fiecare mutație și se restaurează via `_get_pipeline_or_load` + URL `?id=`. Un restart NU pierde conținutul Step 2-3 — doar progresul live de render. **De marketat ca superputere ("nu pierzi niciodată munca"), nu de temut.**
5. **Engine-ul de product-video e un slideshow.** `product_video_compositor.py:506` compune Ken Burns dintr-**o singură imagine de produs** — nu atinge niciodată footage-ul local al creatorului. Sistemul asociere→segment→PiP care AR conecta footage-ul la produse există dar e **deconectat** de generator. **Killer feature-ul pentru audiența primară (e-commerce) e subțire fix unde contează.**
6. **Onboarding-ul cere "Supabase URL + Anon Key" ca câmpuri obligatorii** (`setup/page.tsx:347-390`, Next blocat la `:482`). Pentru sellerul non-tehnic = perete imposibil. **#1 conversion-killer.**

---

## 2. Puncte forte reale + MOAT (ce să exploatezi și să protejezi)

### Table-stakes făcute bine (parity, nu edge)
- **Shell desktop crash-resilient** — sidecar two-runtime, auto-restart cu exponential backoff, single-instance lock fără self-fratricide, orphan cleanup, tray, electron-updater funcțional (`main.js`). Cel mai greu pattern desktop, gestionat mai bine decât majoritatea app-urilor Electron indie.
- **Library asset-management matur** — hover-to-play, multi-select, trash soft-delete 30 zile cu restore, infinite-scroll cursor, mutații optimiste cu rollback. Igienă async rară (AbortController la profile switch).
- **Plumbing de render production-grade** — runner subprocess zombie-safe, cancel registry via ContextVar, disk pre-check, cache extracție per-segment content-addressed, 4 semafoare separate.
- **Calitate A/V broadcast-correct** — 2-pass -14 LUFS loudnorm + lanț denoise→sharpen→color.

### Diferențiat real (greu de copiat de SaaS)
| # | Avantaj | De ce SaaS NU poate | Forță |
|---|---------|---------------------|-------|
| **M1** | **Cost marginal ZERO/video** ($79/149 o dată + BYOAK) | Vendorul cloud plătește *fiecare* render → trebuie să măsoare/limiteze. "Unlimited renders for $79" îl falimentează. | **CEA MAI PUTERNICĂ** — e tot business-ul. Dar azi e *pe jumătate realizat* (encode CPU serial). |
| **M2** | **Zero upload de footage** — citit in-place de pe disc via `os.walk` (`segments_routes.py:585-644`) | SaaS *trebuie* să ingereze GB pe servere — lent, scump, expunere IP. Un seller cu 40GB footage nu uploadează niciodată. | **PUTERNIC & durabil** — privacy + viteză + cost într-unul. |
| **M3** | **Offline-after-setup + date locale** (grace 72h, vault Fernet local) | SaaS moare fără net și îți ține datele ostatice. | **MODERAT** — subminat de onboarding-ul care cere Supabase. |
| **M4** | **Control privacy/IP** (footage/scripturi/chei nu pleacă de pe mașină) | Agențiile sub NDA *nu pot* pune footage de client pe SaaS terț. | **MODERAT-PUTERNIC** pentru segmentul agenții. |
| **M5** | **GPU-ul pe care îl ai deja** — NVENC 3-5× realtime la cost zero pt vendor | Timpul GPU SaaS = COGS-ul lor, îl raționalizează. RTX-ul tău idle = capacitate gratis. | **POTENȚIAL PUTERNIC dar AZI IROSIT** (`encoding_presets.py:69-70` forțează CPU). |

**Concluzie moat:** avantajul de cost (M1) e aproape inatacabil — *dacă* render-ul local e rapid și fiabil. Azi e gâtuit de `MAX_CONCURRENT_RENDERS=1` + CPU 2-pass. **Moat-ul e în arhitectură, nu încă în experiența userului. Prioritatea #1 strategică: fă render-ul local atât de rapid cât permite hardware-ul** — singurul lucru pe care concurența nu-l poate bate pe preț.

### Puncte forte IROSITE (cost de inginerie deja plătit, lipsește doar expunerea)
- **W1 — NVENC ocolit** → înlocuiește toggle-ul confuz "2-pass↔GPU disabled" cu o alegere **"Speed / Balanced / Max Quality"**, default NVENC single-pass când există GPU. Mesaj: *"Renders 3-5× faster on your GPU — zero cost/video."*
- **W3 — Failover multi-cont ElevenLabs** (`tts/elevenlabs.py:361-395`, rotește cheia mid-generation la 402) → chip de status "3 conturi, auto-failover ON" + bullet: *"Nu opri niciodată un batch de 100 video pentru că o cheie a rămas fără credite."*
- **W4 — Karaoke captions** la un pas (vezi §1.3) → cel mai mare ROI din produs.
- **W5 — Engine de scheduling sofisticat** (jitter anti-spam, Meta A/B, routing per-platformă în `schedule_service.py:156`) ascuns după dependența Postiz → randează planuri locale în calendar fără Postiz.
- **Meta-multiplication** — 2 cut-uri vizual distincte/script ca să eviți penalizările de duplicate content Meta. Niciun SaaS mainstream nu livrează asta.

---

## 3. Bottleneck-uri & scalare (clasate după *când* lovesc × *cât de tare*)

### #1 — Encode tier: 1 slot serial + CPU 2-pass default *(plafonul real)*
Lovește **de la 2 video-uri**. Multi-variant *pare* paralel dar serializează pe semafor=1; default 2-pass forțează CPU pe mașini cu GPU; libx264 `-threads 4`. Userul vede "Render All pe 10 variante = ~10× un render", GPU idle la pasul cel mai greu.
**Fix:** (a) NVENC single/multipass default când există GPU — **M, ~3-5× mai rapid**; (b) `MAX_CONCURRENT_RENDERS` adaptiv (2-4, cores/VRAM-aware) — **S să flip-uiești, M să fie OOM-safe**. *Cea mai mare pârghie din tot codebase-ul.*

### #2 — Preview = render FFmpeg server 30-300s; orice edit de 1 segment invalidează tot timeline-ul
Fingerprint SHA256 din **tot** array-ul de match-uri + setări (`pipeline_routes.py:5650-5654`). Un editor atent care face 10 tweak-uri plătește 10 render-uri complete. Progress fake care sare la ~85% și îngheață (fără parsare `ffmpeg -progress`).
**Fix:** scurt — `ffmpeg -progress` real + ETA (**S**, omoară "e blocat?"); mediu — compune transforms/PiP/logo/color în Instant Preview-ul *deja existent* via CSS (**M**), păstrând FFmpeg doar pt export final; lung — cache preview incremental segment-diff (**L**).

### #3 — State live de job/progres în dict-uri in-memory + auto-restart silențios al shell-ului
`_pipelines` (cap 1000), `_assembly_jobs`, `render_jobs` sunt volatile. Conținutul e persistat (vezi §1.4), dar progresul live de render și job-urile in-flight se pierd, iar shell-ul Electron restartează backend-ul *silențios* de 3×. Userul vede un render 60% gata "dispărut" fără explicație.
**Fix:** persistă state-ul live de render/preview în tabela `jobs` *deja existentă* (batch routes o folosesc deja) + rehidratează la load — **M**. Transformă un eveniment de data-loss înfricoșător în unul resumable.

### #4 — Batch: strict secvențial, cap 20 idei, BackgroundTasks (nu coadă durabilă)
Două sisteme batch deconectate, ambele single-file. La **50 video** wall-clock = Σ tuturor = **50-65 min** înainte să termine ceva. Crash mid-batch → click manual `/resume` (idea) sau *fără resume deloc* (product).
**Fix:** concurență mărginită (2-4) sub semaforul adaptiv (depinde de #1) — **M**; ridică cap-ul + "select all N matching" — **S**; coadă durabilă auto-resume pt ambele tipuri — **L**; import CSV/Sheets — **M**.

### #5 — Supabase N+1 pe Library și Segments
`list_all_clips` face `get_clip_content` per clip + `get_project` per project_id (adnotat "N+1 accepted for v13"). Segments încarcă tot la `limit=500` și filtrează client-side. Lovește la **sute de clipuri/source-videos** — audiența 50-500 SKU ajunge acolo în săptămâni. Search "nu găsește nimic" (filtrează doar paginile încărcate); segmentele peste 500 dispar din matching.
**Fix:** batch-fetch (join/`in`), search/sort server-side, paginare faceted — **M** fiecare; agregat cost DB-side RPC — **S**.

### #6 — Memorie & write-amplification în sesiuni lungi
`_db_save_pipeline` serializează *tot* blob-ul JSON la *fiecare* mutație (~15 locuri). Timeline desenând pe **30-50 source clips distincte** → limita de media-elements browser (~16-75) → load-uri eșuate, audio desync, crash tab.
**Fix:** upsert-uri patch/delta; pooling `<video>` windowed/lazy; grid library virtualizat — **M** fiecare.

### #7 — Monolit `page.tsx` (3698 linii) / `pipeline_routes.py` (6502 linii) *(velocitate, nu runtime)*
4 pași + ~60 `useState` într-un component; 40+ endpoint-uri într-un router. Nu lovește userul direct, dar plafonează capacitatea echipei de a *repara* tot ce e mai sus.
**Fix:** extrage componente per-pas + split router pe domenii — **L, ongoing**, făcut *în paralel* cu #1-#3, nu ca sprint izolat.

### 🎯 Plafonul de bulk-production
**Azi: ~30-60 video finite/oră pe o mașină puternică — și NU scalează cu hardware-ul.** Encode-ul rulează unul câte unul, CPU 2-pass `-threads 4` → ~60-90s/video serializat. Adăugarea de core-uri sau GPU **nu ajută** (GPU bypassed, thread cap). **Constrângerea care leagă totul = encode tier-ul (#1).** O singură investiție (NVENC default + concurență 2-4) plausibil mută plafonul la **150-300+/oră** — diferența între "jucărie slideshow" și "onorează promisiunea de mass-production".

---

## 4. Fricțiune UX — călătoria end-to-end + Top 10

| Etapă | Fricțiune | Cel mai rău moment |
|-------|-----------|--------------------|
| Install / First-run | **Dureroasă** | Installer nesemnat → SmartScreen "unknown publisher" pe un produs de $79-149; cold start 30-60s cu fereastra ascunsă (doar tray tooltip) → pare înghețat |
| Enter API keys | **Dureroasă** | Cere Supabase URL+Anon Key *obligatoriu*, fără explicație/link; zero "get your key here" pt Gemini/ElevenLabs |
| Ingest & tag footage | **Rough** | Tagging 100% manual (7 chip-uri generice); `GeminiVideoAnalyzer` există dar nu e cablat; fără selecție voce la onboarding |
| Generate first video | **Rough→Dureroasă** | Totul gated după chei AI, fără demo/sample; primul preview stă 30-300s |
| Edit / refine | **Dureroasă** | Orice edit de 1 segment re-renderează tot; 2 sisteme de preview cu fidelitate diferită (Instant Preview nu arată transforms/PiP/logo) → poți livra cut-ul greșit; fără trim-in-segment |
| Bulk-produce | **Dureroasă** | Strict secvențial; fără CSV import; cap 20 idei; idea batch se oprește la `ready_for_review` cerând click manual per item |
| Manage / export | **Rough** | Library = firehose plat fără grupare pe proiect/campanie; fără bulk download/ZIP (un `window.open` odată) |

**Net:** *mijlocul* pâlniei (segment-marking, robustețe pipeline, calitate render) e solid. **Cele două capete — onboarding și bulk/export — sunt unde sângerează userii**, și exact ele decid o cumpărare și un word-of-mouth.

### Top 10 fricțiuni (reach × hurt)
1. **Onboarding cere Supabase URL+Anon Key** (100% useri, blochează activarea) — **L** · *#1 conversion-killer*
2. **App nesemnat → SmartScreen** (100% instalări, pre-trust) — **M**
3. **Fără ghidare "get your key here"** Gemini/ElevenLabs — **S**
4. **Preview 30-300s + edit de 1 segment re-renderează tot** — **M** (engine-ul Instant Preview există deja)
5. **Fără demo/sample — valoarea e gated după chei** — **M**
6. **Bulk strict secvențial + fără auto-finish + fără CSV** — **L** (S toggle auto-render, M concurență, M CSV)
7. **Cheile de la onboarding invizibile in-app (2 vault-uri deconectate)** — **M**
8. **Library fără grupare proiect/campanie + fără ZIP export** — **M**
9. **Cold start fără splash/progres** — **S** · *cel mai mare câștig de perceived-quality per dolar*
10. **Tagging 100% manual + fără audiție voce in-app** (`preview_url` ElevenLabs există) — **M** (S doar audiția)

*Mențiuni:* progress bar fake care îngheață la 85%; gate-ul mort 1234/1234 (parola e literalmente în placeholder) în timp ce `LicenseService` real nu e enforced la startup; microcopy RO/EN amestecat în library (pare neterminat).

### Problema "primelor 5 minute"
Un seller non-tehnic **NU poate ajunge la un video finit** în 5 min: SmartScreen → fereastră înghețată 60s → gate 1234/1234 → **peretele Supabase** (aici moare trial-ul) → fără voce selectată → tot are nevoie de cheie AI fără demo → primul preview 30-300s.

**Fluxul țintă:** *Install (semnat) → splash → "Make my first video" pe footage bundle cu Edge-TTS gratis → MP4 finit în player în ~2-3 min → apoi* "Adaugă footage-ul tău / cheia ta AI pt voci premium". Livrează magia "idee → short finit" *înainte* să ceri userului să înțeleagă vreun concept tehnic — exact ce face CapCut/Submagic și exact ce inversează produsul azi.

---

## 5. ⭐ Feature-uri lipsă pentru un MVP de top (roadmap prioritizat)

### MVP-CRITICAL (fără astea nu câștigă audiența țintă)
| # | Feature | Durere ucisă | Bar-setter | Efort |
|---|---------|--------------|-----------|-------|
| **G1** | **Karaoke captions word-level** (highlight/pop/emoji din timestamp-urile existente) | Output "flat", amatoricesc; pe asta judecă creatorii un tool short-form la prima vedere | Submagic, CapCut | **M** |
| **G2** | **Backend de date zero-config** (omoară peretele Supabase din onboarding) | Sellerul non-tehnic literalmente nu poate finaliza setup-ul | CapCut/Creatify | **L** |
| **G3** | **Render GPU-first + progres real + sloturi paralele** | Tot render-ul "pare lent", bara îngheață, N variante serial pe CPU cu GPU idle | CapCut (export GPU local) | **M** |
| **G4** | **Bulk real: CSV/feed-in → multe video finite într-o coadă unificată** | Promisiunea "mass production" contrazisă de cap 20, fără CSV, 2 UI-uri batch, click manual per item | OpusClip/Pictory | **L** |
| **G5** | **Preview in-player care arată look-ul FINAL** (transforms/PiP/logo/captions) | 2 preview-uri în dezacord; poți livra ce nu trebuie | CapCut/Descript | **M** |
| **G6** | **Folosește footage-ul PROPRIU în product-video** (cablează asociere→segment→PiP existent) | Engine-ul produce slideshow Ken Burns, contrazice singurul diferențiator, fix la audiența killer | Creatify (UGC) | **L** |
| **G7** | **Ghidare achiziție chei + selecție voce în onboarding** | Fără deep-links "get key"; userul termină setup-ul fără voce → stare non-render-ready | Creatify BYOAK | **S** |
| **G8** | **Vault unificat + vizibilitate cost/spend pre-render** | 2 vault-uri deconectate ("unde mi-a dispărut cheia?"); fără estimare "~$2.70" pre-batch; BYOAK = frică de bill-shock | Orice BYOAK matur | **M** |
| **G9** | **AI auto-tag / auto-segment din footage** (cablează `GeminiVideoAnalyzer` existent) | "Selectează o dată" = 100% manual cu 7 chip-uri; promisiunea "AI face partea plictisitoare" neîmplinită | Descript/OpusClip | **M** |

### DELIGHT (moat-builders — SaaS literalmente nu le poate egala)
1. **Rail "Recent pipelines" / Resume** (state-ul e DEJA persistat, doar ascuns după `?id=`) — *"EF nu-ți pierde niciodată munca"* — **S**
2. **Muzică auto / trending-audio cu ducking sub voiceover** (sidechain) — absent total azi — **M**
3. **Matching semantic/sinonime + confidence per-linie + swap 1-click** ("shoe" nu prinde "sneakers" azi) — face engine-ul determinist să pară inteligent — **M**
4. **Multi-language / auto-translate voiceover + captions** (1 script → 5 limbi) — feature de standing-ovation pt e-commerce multi-piață — **L**
5. **Bibliotecă hook/CTA/template + brand-voice presets** care ghidează AI-ul; etichetează variantele pe strategie ("curiosity/problem-solution/social-proof") — **M**
6. **Splash brandat + semnare cod (Authenticode)** — diferența între "indie sketchy" și "native trustworthy" la prima impresie — **M**
7. **Conectori direcți Shopify / TikTok Shop / Google Merchant** (skill `merchant` deja există în workspace) — **L**
8. **Vedere library pe proiect/campanie + export ZIP bulk** — cum lucrează efectiv sellerii 50-500 SKU și agențiile — **M**

### LATER / V2
- Coadă de render durabilă distribuită (înlocuiește BackgroundTasks) — **L**
- Gate real de licență (înlocuiește 1234/1234; `LicenseService` + Lemon Squeezy există) — **M**
- Sync feed recurent → auto-generate la SKU nou — **L** (depinde de G6 + coadă durabilă)
- Output HEVC/AV1 + cache rezultat encode final — **M**
- Paritate macOS (semnare/notarizare) — **L**
- Editor cue manual per-caption + undo/redo + shortcut-uri tastatură — **M**

---

## 6. Secvențiere recomandată (ce întâi)

> **Lead cu ce SaaS nu poate copia (local, free, bulk, no-upload, never-lose-work), dar câștigi dreptul să le arăți doar după ce treci 2 pereți non-negociabili: gate-ul Supabase din onboarding (G2) și captions flat (G1).**

1. **Quick wins de încredere (zile, nu săptămâni):** `ffmpeg -progress` real (#2-S) · splash brandat (UX#9-S) · deep-links chei + audiție voce (G7) · drop gate 1234 · surface failover ElevenLabs (W3) · rail Resume (Delight#1).
2. **Cei 2 pereți:** G1 (karaoke — ROI maxim, date deja existente) + G2 (zero-config backend + "Make my first video" pe sample cu Edge-TTS).
3. **Fă bucla rapidă & de încredere:** G3 (NVENC default + concurență 2-4) → ridică plafonul la 150-300 video/oră · G5 (preview in-player fidel) · persistă job state în tabela `jobs` (#3).
4. **Onorează promisiunea de bulk:** G4 (CSV + coadă unificată + auto-render) · G8 (vault unificat + cost pre-batch).
5. **Câștigă e-commerce-ul:** G6 (footage propriu în product-video) · conectori Shopify/TikTok Shop.
6. **Decompune monolitul** (#7) *în paralel* cu pașii de mai sus, nu ca sprint separat.

**Prioritatea #1 strategică peste tot:** fă render-ul local atât de rapid cât permite hardware-ul (G3) — pentru că ăsta e singurul lucru pe care concurența nu-l poate bate niciodată pe preț.
