# MVP Desktop — Plan Complet de Implementare

> **Creat:** 2026-06-11 (sesiunea "REFACTOR")
> **Decizie de produs:** Renunțăm la aplicația WEB (codul rămâne, nu se șterge — doar se dezactivează prin flags). Ne concentrăm exclusiv pe aplicația DESKTOP (Electron). AI se folosește DOAR pentru: generare scripturi (Gemini) + voiceover (ElevenLabs/Edge-TTS). Restul e determinist (keyword matching, FFmpeg, scoring motion/blur). Distribuirea pe social media (Postiz) NU e în scope — focus 100% pe editarea video în masă.
> **Pitch-ul produsului:** Creatorii care postează 3+ clipuri/zi nu pot edita manual. Userul își selectează o dată segmentele importante din materialul sursă, apoi aplicația generează instant videoclipuri complete (script → voiceover → matching segmente → render) pornind de la simple idei.

---

## Context tehnic (verificat în audit, 2026-06-11)

### Ce e DEJA gata (din milestone v13, fazele 80–88 — NU se reface)
- Migrare completă la repository pattern: 88→0 apeluri directe Supabase; `DATA_BACKEND=sqlite` funcțional (67 teste trec)
- Electron shell matur: `electron/src/main.js` (~471 linii) — spawn backend uvicorn :8000 + Next.js standalone :3000, health checks, orphan cleanup, tray
- FFmpeg bundled cross-platform, NVENC detectat (`app/services/ffmpeg_semaphore.py`)
- ML bundle opțional cu gating (412/402)
- electron-builder configurat: NSIS installer Windows, limită 550MB

### Lucru în curs NECOMIS în working tree (din sesiunile 2026-06-10, recuperate din transcripts)
Înlocuirea license gate cu login simplu de test:
- `app/config.py` — `desktop_test_user`/`desktop_test_password` (default 1234/1234)
- `app/platforms/desktop/routes.py` — endpoints noi `/desktop/auth/login`, `/desktop/auth/status`, `/desktop/auth/logout` (persistă `desktop_logged_in` în `config.json` din AppData)
- `electron/src/main.js` — `checkStartupState()` refactorizat: verifică `/desktop/auth/status` → rutează la `/login` sau `/` (fail-closed la login)
- `frontend/next.config.ts` — **fix critic** `outputFileTracingRoot` (fără el, standalone build se cuibărește sub `frontend/` și toate assets dau 404 în Electron)
- `frontend/src/app/layout.tsx` — `<LicenseGuard>` înlocuit cu `<DesktopAuthGuard>`
- `frontend/src/components/desktop-auth-guard.tsx` — fișier NOU (untracked!) — guard care nu randează NICIODATĂ children pentru user neautentificat (fixează React error #310 pe pagina pipeline)
- `frontend/src/app/login/page.tsx` — branch desktop: câmp "User" în loc de email, fără "Forgot password"
- ATENȚIE: `frontend/src/components/post-detail-modal.tsx`, `electron/package-lock.json`, `frontend/package-lock.json` — și ele modificate; de inclus în commit după review diff.

### Diagnosticul problemei #1: PREVIEW (30–80s per preview)
Fluxul actual: dialog deschis → POST `/pipeline/render-preview/{id}/{variant}` (`app/api/pipeline_routes.py:5507-5740`) → fingerprint SHA256 din matches+settings (`:5554-5597`) → cache hit DOAR dacă nimic nu s-a schimbat → altfel re-render complet: extracție TOATE segmentele (paralel, max 3 — `ffmpeg_semaphore.py:238`) → concat → encode libx264 ultrafast CRF 32 540x960 (`library_routes.py:4387+`) → polling la 2s din `variant-preview-player.tsx:108-246`.

Cauze fundamentale:
1. Orice editare (1 segment swap) invalidează fingerprint-ul ÎNTREGULUI timeline → re-render total
2. Nu există cache per-segment — toate segmentele se re-extrag mereu
3. Fișierul nu e redabil până la final (moov atom la sfârșit)
4. NVENC e fallback, nu default; fără hwaccel la decode
5. Arhitectural: preview = FIȘIER produs de server, nu PROIECȚIE compusă în player (cum fac CapCut/Premiere). În Electron segmentele sursă sunt LOCALE — compositing-ul în player e posibil.

### Alte probleme confirmate
- `_pipelines` dict în memorie (`pipeline_routes.py`) — restart backend = pierzi tot lucrul din Step 2–3
- `frontend/src/app/pipeline/page.tsx` ≈ 4500 linii, toate cele 4 step-uri într-un singur component
- Vault-ul de chei API derivă cheia de criptare din `SUPABASE_KEY` (`app/config.py:109` aprox) — dependență cloud într-o app offline-first
- Auth desktop e doar gate de UI; API-ul localhost e deschis (`app/api/auth.py:115-127` bypass când `desktop_mode=true`) — acceptabil pentru MVP single-user

---

## FAZELE MVP (în ordine, cu dependențe)

```
F0 → F1 → F2 → F3 → F4 → F5 → F6 → F7
          └────────┐
F2 (cache segmente) rămâne util și după F5 (exportul final tot prin FFmpeg trece)
F3 (persistență) e PRECONDIȚIE pentru F6 (batch)
F4 (refactor) e PRECONDIȚIE pentru F5 (player compozit)
```

---

### FAZA 0 — Stabilizare lucru curent (≈0.5 zi)
**Obiectiv:** Commit-uiește și verifică munca necomisă din sesiunile anterioare.

Taskuri:
1. `git diff` pe toate fișierele modificate; review; commit logic (auth gate desktop + fix standalone build). Nu uita fișierul UNTRACKED `frontend/src/components/desktop-auth-guard.tsx`.
2. Build complet: `cd frontend && npm run build`, apoi pornește Electron (`cd electron && npm start` sau echivalent din package.json) și verifică: login 1234/1234 → pagina pipeline se încarcă fără 404/React #310.
3. Screenshot Playwright de verificare (regulă obligatorie din CLAUDE.md).

**Acceptare:** App-ul Electron pornește curat, login funcționează, zero erori în consolă pe `/` și `/pipeline`.

---

### FAZA 1 — Desktop trim: dezactivare dead-weight web (≈1 zi)
**Obiectiv:** Aplicația desktop nu expune funcționalitatea web-SaaS. NIMIC nu se șterge — doar feature flags.

Taskuri:
1. În `app/main.py`, montează condiționat (`if not settings.desktop_mode:`) routerele: `postiz_routes`, `schedule_routes`, `buffer_routes`, `image_generate_routes` (fal.ai), `catalog_routes`, `feed_routes` (sync-ul de feed e web-only; verifică dacă `product_generate_routes` depinde de el înainte de a-l dezactiva).
2. Frontend: ascunde din navigație în desktop mode (`NEXT_PUBLIC_DESKTOP_MODE`) paginile `/products`, `/calendar`, `/schedule`, `/create-image` și orice UI Postiz (ex: `post-detail-modal.tsx`).
3. Gemini Vision (analiza frame-urilor la upload, `app/services/gemini_analyzer.py`): fă-o opțională, OFF by default în desktop mode — scoring-ul determinist (motion/variance/blur) există deja ca fallback. Aliniere cu viziunea "AI doar pentru script + voiceover".
4. Verifică că nu se rupe nimic: pornește backend-ul, rulează testele SQLite existente.

**Acceptare:** În desktop mode, endpoint-urile dezactivate răspund 404; nav-ul frontend arată doar: Pipeline, Library, Segments, TTS, Settings. Toate testele existente trec.

---

### FAZA 2 — Preview Tier 1: cache per-segment + quick wins (≈2–4 zile)
**Obiectiv:** Re-preview după o editare iterativă scade de la 30–80s la <15s.

Taskuri:
1. **Cache per-segment** în `assembly_service.assemble_video()` (`app/services/assembly_service.py:1394-1680`): fișierele extrase (`segment_NNN.mp4`) se cache-uiesc per profil, cu cheie = hash(`segment_id`, `start`, `end`, `target_duration`/looping, parametri scale/crop/encode). La rebuild, segmentele neschimbate se refolosesc de pe disc; doar cele afectate de editare se re-extrag. Adaugă eviction simplă (LRU pe dimensiune totală, ex. 5GB).
2. **`-movflags +faststart`** (sau fragmented MP4) la encode-ul de preview (`library_routes.py:4540-4547` + `ffmpeg_semaphore.get_preview_codec_params()`) — fișierul devine redabil progresiv.
3. **NVENC default + hwaccel decode** când `is_nvenc_available()`: folosește `-hwaccel cuda` la decode pentru extracția segmentelor, nu doar la encode-ul final.
4. **Înlocuiește polling-ul de 2s** cu SSE: endpoint `GET /pipeline/preview-progress/{id}/{variant}` care streamează progresul (pattern SSE există deja la ML download, faza 86 — refolosește-l). Frontend: `EventSource` în `variant-preview-player.tsx`.
5. Nu porni render dacă fingerprint-ul e identic cu un render în curs (verifică `_preview_locks` — există deja, doar confirmă comportamentul).

**Acceptare:** Test manual: timeline cu 10 segmente, preview generat o dată; swap 1 segment → al doilea preview folosește 9 segmente din cache (verificabil în logs) și termină în <15s pe mașina de dev. Video-ul de preview poate fi redat înainte de finalizarea completă.

---

### FAZA 3 — Persistență pipeline în SQLite (≈2–3 zile)
**Obiectiv:** Restart de backend/Electron nu mai pierde lucrul în curs.

Taskuri:
1. Fă SQLite (tabelul `editai_pipelines`, există deja) sursa de adevăr pentru starea pipeline-ului: scripts, tts_previews (căi fișiere + metadata), matches/match_overrides, status per variantă. Pattern write-through: orice mutație a `_pipelines[id]` se persistă imediat; dict-ul rămâne cache de citire.
2. La startup (sau lazy, la primul GET pe un pipeline_id necunoscut), reîncarcă starea din DB. Validează că fișierele referite (TTS audio, segmente) încă există; marchează ce lipsește.
3. Frontend: pagina pipeline la mount listează pipeline-urile recente (endpoint nou sau existent `GET /pipeline/list`) și permite reluarea unuia în loc să înceapă mereu de la zero.
4. `_generation_progress` și `_preview_locks` rămân in-memory (sunt efemere prin natură) — doar starea de conținut se persistă.

**Acceptare:** Test: pipeline dus până în Step 3 cu TTS + matches editate → kill backend → restart → pipeline-ul se redeschide cu scripturi, TTS și timeline intacte.

---

### FAZA 4 — Refactor Step 3 / spargerea pipeline/page.tsx (≈2 zile)
**Obiectiv:** Pregătirea terenului pentru playerul compozit. ZERO schimbări de comportament.

Taskuri:
1. Sparge `frontend/src/app/pipeline/page.tsx` (~4500 linii) în componente per step: `Step1Script.tsx`, `Step2TTS.tsx`, `Step3Preview.tsx`, `Step4Render.tsx` + hooks pentru state partajat (`usePipelineState`).
2. Step 3 e prioritatea: izolează starea de timeline (matches, merge groups, subtitle settings, filtre) într-un hook/context propriu, ca playerul compozit din F5 să o consume direct.
3. Verificare vizuală Playwright înainte/după (screenshot diff pe fiecare step).

**Acceptare:** Build trece, comportament identic (screenshots), `page.tsx` < ~1000 linii, starea Step 3 accesibilă printr-un hook dedicat.

---

### FAZA 5 — Playerul compozit: preview INSTANT fără render (≈4–7 zile) ⭐ DIFERENȚIATORUL
**Obiectiv:** Schimbarea de paradigmă: preview = proiecție compusă în player, nu fișier randat. Editezi → vezi instant (<1s), zero FFmpeg.

Concept: playerul redă secvențial segmentele SURSĂ (fișiere locale!) conform timeline-ului, cu audio TTS suprapus și subtitrări desenate ca overlay. FFmpeg rămâne doar pentru exportul final (Step 4) — unde cache-ul per-segment din F2 tot ajută.

Taskuri:
1. **Servirea segmentelor sursă către player:** backend-ul servește deja fișiere cu `Accept-Ranges: bytes` (`library_routes.py:380-431`). Adaugă endpoint pentru fișierul sursă al unui segment cu range requests (sau, mai direct în Electron, un custom protocol `media://` în main.js care mapează la căile locale — alege varianta mai simplă; HTTP local cu range e probabil suficient și nu atinge Electron).
2. **Componenta `CompositePreviewPlayer`:** două elemente `<video>` alternante (double-buffering): în timp ce A redă segmentul curent (cu `currentTime` setat la `start` și oprire la `end`), B pre-încarcă și face seek pe următorul. La granița dintre segmente: swap A↔B (vizibilitate CSS). Pentru segmente cu looping (segment mai scurt decât slotul), re-seek la `start`.
3. **Audio:** un `<audio>` separat cu TTS-ul variantei (există deja blob URL playback în Step 2) — el e MASTER CLOCK-ul. Video-urile se sincronizează la el (la fiecare graniță de segment + corecție drift la ~500ms prin comparare cu poziția calculată din timeline).
4. **Subtitrări:** parsează SRT-ul (există deja în pipeline state) și randează fraza curentă ca overlay HTML absolut poziționat, stilizat după subtitle_settings (font/culoare/glow — aproximare CSS a stilului final; fidelitatea 100% rămâne pe exportul FFmpeg).
5. **Scrub:** click pe bara de timp compusă → calculează (segment, offset) din poziția globală → seek ambele video-uri + audio.
6. **Filtrele video (denoise/sharpen/color)** NU se aplică în preview-ul compozit (sunt aproximabile prin CSS filters dacă e trivial, altfel se marchează "vizibile doar la export"). Butonul vechi "render preview" rămâne disponibil ca "Preview fidel (render)" pentru verificare finală — folosește fluxul din F2.
7. Integrare în Step 3: playerul compozit devine preview-ul DEFAULT; orice `onMatchesChange` se reflectă instant (playerul citește direct starea din hook-ul creat în F4).

**Acceptare:** Pe un timeline cu 8–10 segmente: redare fluentă cu audio sincron (drift <100ms), swap de segment vizibil instant (<1s, fără niciun apel FFmpeg), scrub funcțional, subtitrări sincrone. Render-ul FFmpeg se mai întâmplă DOAR la cerere explicită sau la export.

Riscuri & fallback: dacă double-buffering-ul are gap-uri vizibile la granițe (decode lag pe surse 4K), fallback acceptabil: micro-fade de 50ms la tranziție SAU proxy-uri low-res generate în background pentru playback (o singură dată per segment sursă, cache-uite). Nu bloca MVP-ul pe perfecțiunea tranzițiilor.

---

### FAZA 6 — Batch mode: editare în masă (≈3–5 zile)
**Obiectiv:** Promisiunea produsului: dai N idei → aplicația produce N videoclipuri gata de review, fără babysitting. DEPINDE de F3 (persistență).

Taskuri:
1. **Coadă de idei:** UI simplu (în pipeline sau pagină nouă `/batch`): textarea cu o idee per linie (sau listă) + setări comune (voce, profil de stil, durată țintă, sursa de segmente) → `POST /pipeline/batch` creează N pipeline-uri persistate cu status `queued`.
2. **Worker în background:** procesare secvențială (sau 2 concurent, respectând `ffmpeg_semaphore`) per pipeline: script (Gemini) → TTS → matching determinist → status `ready_for_review`. Folosește `BackgroundTasks` + starea persistată din F3 (recovery la restart: reia ce era `queued`/`processing`).
3. **Ecran de review în masă:** grid cu toate variantele `ready_for_review`; click → se deschide Step 3 cu playerul compozit (instant, din F5); acțiuni: Approve (→ render queue), Edit, Discard.
4. **Render queue:** variantele aprobate se randează în fundal (F2 cache ajută); progres vizibil; output în folder configurabil (`Export to folder`), cu nume predictibile.

**Acceptare:** Test: 5 idei introduse → pleci → revii: 5 variante ready for review; aprobi 3 → 3 MP4-uri finale apar în folderul de export fără altă intervenție.

---

### FAZA 7 — Packaging & hardening MVP (≈2–3 zile)
**Obiectiv:** Installer instalabil pe o mașină curată, funcțional offline.

Taskuri:
1. **Fix vault chei API:** derivarea cheii de criptare din `SUPABASE_KEY` (`app/config.py`, ~linia 109) se înlocuiește cu cheie locală per-mașină (generată la primul run, stocată în AppData; sau `keyring`/DPAPI pe Windows). Migrare: dacă vault-ul vechi există, re-criptează.
2. **Build installer:** `electron-builder` NSIS; verifică limita de 550MB (CI `installer-size.yml` există); smoke test pe instalare curată.
3. **Offline path:** verifică fluxul complet FĂRĂ chei API: scripturi — input manual (sau mesaj clar că Gemini lipsește), TTS — Edge-TTS (gratuit), matching + preview + render — totul local. Graceful degradation peste tot.
4. **Robustețe procese:** orphan cleanup pe Windows (Access Denied handling), `ensure_dirs` la startup, port conflict handling (8000/3000 ocupate → mesaj clar sau port alternativ).
5. Smoke tests automate: scriptul de health + un test E2E minimal (upload → segment → pipeline → render) sub `DATA_BACKEND=sqlite`.

**Acceptare:** Pe o mașină/VM fără dev tools: installer-ul se instalează, app-ul pornește, fluxul complet idee→video funcționează cu Edge-TTS fără nicio cheie API configurată.

---

## EXPLICIT ÎN AFARA MVP-ului (post-MVP, fazele v13 existente rămân valabile)
- Marketing site / Lemon Squeezy checkout (fazele 89–92 — parțial făcute, se continuă DUPĂ MVP)
- OAuth device flow / cloud sync tier (fazele 93–95)
- Auto-updater + GitHub Releases publish + SmartScreen (fazele 96–98)
- Postiz / scheduling / publishing (dezactivate în F1, nu se șterg)
- fal.ai image generation (dezactivat în F1)
- Voice cloning (Coqui XTTS) îmbunătățiri — rămâne cum e, gated de ML bundle
- macOS build (Windows first)

## Estimare totală: ~17–25 zile de lucru efectiv

## Cum se lucrează (recomandare pentru sesiunea de implementare)
- Proiectul folosește GSD (`.planning/`). Opțiuni: (a) rulează `/gsd-insert-phase` pentru a insera fazele F0–F7 în roadmap și lucrează cu `/gsd-plan-phase` + `/gsd-execute-phase`; sau (b) lucrează direct, fază cu fază, cu commit-uri atomice. Oricum ai face: o fază = unul sau mai multe commit-uri + verificare Playwright (obligatoriu per CLAUDE.md) înainte de a trece mai departe.
- Verifică `file:line`-urile din acest plan înainte de a edita — au fost corecte la 2026-06-11, dar codul se mișcă.
- După F0, fiecare fază e independent shippable; nu începe F5 fără F4.
