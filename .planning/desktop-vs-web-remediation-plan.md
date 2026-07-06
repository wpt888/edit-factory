# Plan de remediere — Desktop vs Web (33 probleme)

**Bazat pe:** `.planning/desktop-vs-web-audit-2026-06-26.md`
**Data:** 2026-06-26 · **Branch sugerat:** continuă pe `feat/mvp-remediation-w0-w2` sau worktree nou `fix/desktop-parity`
**Principiu:** cele 33 de probleme vin din ne-coordonarea celor 3 comutatoare (backend trim / frontend gate / shell). Planul le coordonează.

---

## Legendă
- **Efort:** S = <1h · M = 1-3h · L = >3h sau decizie de produs
- **Risc fix:** Low = mecanic, izolat · Med = atinge cale critică · High = schimbare arhitecturală
- **🔶 DECIZIE** = necesită alegerea ta înainte de implementare (marcată explicit)

---

## Wave D0 — Izolarea datelor (CRITIC, înainte de orice utilizare reală)

> Cele 2 critice. Atâta timp cât astea sunt deschise, desktop-ul poate amesteca date între conturi și poate rupe preview/render tăcut.

### D0.1 — Fix rezolvare profil în desktop_mode  ·  Efort M · Risc Med
**Probleme acoperite:** #1 (critical), #31 (low).
**Fișier:** `app/api/auth.py:295-323` (ramura `if settings.desktop_mode`).
**Acum:** linia 310 face `eq={"is_default": True}` limit 1 **fără `user_id`** → primul default global (alt cont). Header `X-Profile-Id` acceptat verbatim, fără validare (`:301-304`).
**Schimbare:**
1. Aliniază rezolvarea default la pattern-ul deja folosit în ramura `dev` (`auth.py:266-277`): întâi `eq={"user_id": <desktop_uid>, "is_default": True}`, apoi `eq={"user_id": <desktop_uid>}`, **fără** fallback la `is_default` global neproprietat.
2. Validează `X-Profile-Id` și în desktop (existență + că aparține `<desktop_uid>`), ca pe web (`auth.py:362-369`).
**🔶 DECIZIE D0.1:** ce `user_id` folosește desktop-ul?
   - **(a) UUID hardcodat actual** (`aaaaaaaa-…`) + seed un profil real cu acel `user_id` în cloud la primul run (extinde `seedDesktopEnv`/onboarding). Curat, izolează desktop-ul de conturile web.
   - **(b) Un user_id real dedicat desktop-ului** (creat o dată în Supabase), pus în `credentials.env`.
   - Recomandare: **(a)** — auto-seed la primul run, zero config pentru user.
**Verificare:** pe desktop nou, `/profiles/` întoarce profilul desktop (nu gol); requesturile pipeline/library nu mai ating profiluri străine. Test: `tests/` nou `test_desktop_profile_scope`.

### D0.2 — Strategie media: DB cloud partajat vs fișiere locale  ·  Efort L · Risc High · 🔶 DECIZIE
**Probleme acoperite:** #2 (critical), #25 (medium), #26 (medium).
**Cauză:** desktop pornește `DATA_BACKEND=supabase` (`electron/src/main.js:225`) dar `file_storage_backend` rămâne `local` (`config.py:158`), `base_dir=%APPDATA%\EditFactory`. Sursele video din DB-ul cloud au căi de pe mașina web → 404 / segmente sărite.
**🔶 DECIZIE D0.2 — alege direcția:**
   - **Opțiunea A (paritate reală):** setează `FILE_STORAGE_BACKEND=supabase` + `MINIO_PUBLIC_URL` în `credentials.env`/`main.js`; sursele se urcă în storage cloud la upload (`segments_routes.py` upload trebuie să folosească abstracția `file_storage`, azi o ocolește pentru surse). Cost: refactor ingest + bandă/stocare cloud.
   - **Opțiunea B (local cu UX onest):** detectează căile lipsă și afișează un flux „re-localizează fișierul" + exclude proiectele cu surse indisponibile din render cu **eroare clară** (nu 404/skip silențios). Mai ieftin, dar nu sincronizează între mașini.
   - Recomandare: **B pe termen scurt** (oprește comportamentul tăcut/derutant rapid) + **A ca obiectiv** dacă vrei cu adevărat multi-machine.
**Sub-task cuplate (indiferent de A/B):**
   - **D0.2a (#26):** în `assembly_service.py:2022,2063` (+ build_timeline `:1019/1055/1105/1128`) aplică `normalize_path()` la `source_video_path` **și** la verificarea `.exists()` **și** la argumentul ffmpeg `-i` (consistent cu `segments_routes.stream`). Mecanic, Risc Low.
   - **D0.2b (#25):** `serve_segment_file` (`segments_routes.py:2532-2598`) — adaugă fallback de regenerare thumbnail segment din `source_video + start_time` (cum face deja endpoint-ul self-healing de source-video). Risc Low.

---

## Wave D1 — Gardează UI publishing/scheduling/image-gen (închide ~12 probleme, Low risk)

> Pattern-ul corect EXISTĂ deja în `settings/page.tsx` (Crash Reporting `:1631`, Setup Wizard `:1660` sunt gardate cu `NEXT_PUBLIC_DESKTOP_MODE`). Doar îl aplicăm consecvent. Build standalone necesar după (vezi [[project-desktop-shell-gotchas]]).

### D1.1 — Pipeline Step 4  ·  Efort S · Risc Low
**Probleme:** #3, #7, #14. **Fișier:** `frontend/src/app/pipeline/components/step4-render.tsx`.
- Înfășoară butonul „Publish to Social Media" (`:312-320`) și `<PipelineSchedule>` (`:392`) în `process.env.NEXT_PUBLIC_DESKTOP_MODE !== 'true'`.
- Opțional: înlocuiește pe desktop cu o acțiune „Save/Export" relevantă.

### D1.2 — Pagina /librarie (landing desktop)  ·  Efort S-M · Risc Low
**Probleme:** #4, #16. **Fișier:** `frontend/src/app/librarie/page.tsx`.
- Nu apela `fetchPostizStatus` la mount (`:505`) când desktop.
- Gardează tab-ul/secțiunea de imagini AI (`/image-gen/*`: `:1011,1047,1082,1119,1137,1457,1509`), butonul Publish (`:1520`/`PublishDialog :2524`) și `BulkScheduleDialog` (`:2793`) pe `!DESKTOP_MODE`.

### D1.3 — Pagina Settings  ·  Efort S · Risc Low
**Probleme:** #5, #15. **Fișier:** `frontend/src/app/settings/page.tsx`.
- Înfășoară cardul Postiz (`:1095-1311`) și cardul Buffer (`:1313+`) + panourile „Connected …" și efectele `loadIntegrations`/`loadChannels` (`:483,504,555,591`) în `!DESKTOP_MODE`, identic cu blocurile deja gardate la `:1631/:1660`.

### D1.4 — Guard de pagină pentru rute WEB_ONLY (anti rută-fantomă)  ·  Efort S-M · Risc Low
**Probleme:** #11, #12, #13, #17, #27. **Fișiere:** paginile `schedule/`, `calendar/`, `create-image/` (+ tab-ul Feed din `products/`).
- Adaugă un guard la nivel de pagină: când `NEXT_PUBLIC_DESKTOP_MODE === 'true'` → `redirect('/pipeline')` sau `notFound()`. (Paginile rămân rutabile prin URL chiar dacă navbar-ul le ascunde.)
- Pentru `/products` (#13): tab-ul Catalog merge (`/catalog/*` montat), doar tab-ul Feed (`/feeds` list/create/sync din `feed_routes`, nemontat) e rupt → gardează butonul/tab-ul Feed pe desktop, SAU vezi D2.1.

### D1.5 — ML bundle installer + prompt 412  ·  Efort S · Risc Low
**Probleme:** #28. **Fișier:** `frontend/src/app/settings/page.tsx:1676`.
- Gardează `<MLBundleInstaller/>` pe `NEXT_PUBLIC_DESKTOP_MODE` (azi apare și pe web inutil).
- La 412 `ml_not_installed`, afișează în UI „descarcă pachetul ML" ca userul desktop să înțeleagă pasul.

---

## Wave D2 — Rezolvă orfanul product-video (DECIZIE de produs)

### D2.1 — product-video / products / batch-generate: surface sau demontează  ·  Efort S-M · 🔶 DECIZIE
**Probleme:** #6, #8. **Fișiere:** `frontend/src/components/navbar.tsx:58-68`, `app/main.py:421-435`.
**Stare:** routerele `product`/`product_generate`/`catalog`/`association` SUNT montate în desktop; paginile `/products`, `/product-video`, `/batch-generate` sunt în `WEB_ONLY_HREFS` → ascunse. product-video footage (Wave 4.1, `7c1b255`) e funcțional dar inaccesibil.
**🔶 DECIZIE D2.1:**
   - **(a) Surface** (recomandat dacă product-video face parte din MVP desktop): scoate `/product-video` și `/batch-generate` din `WEB_ONLY_HREFS`; pentru `/products` rezolvă întâi tab-ul Feed (mută endpoint-urile de management feed din `feed_routes` în `product_routes` montat, SAU montează `feed_routes` în desktop, SAU ascunde tab-ul Feed).
   - **(b) Demontează** routerele product în desktop dacă feature-ul e intenționat doar web (elimină backend-ul orfan).
- Oricum: **corectează comentariul eronat** din `navbar.tsx:58-60` („Their backend routers are not mounted" — fals pentru product*).

---

## Wave D3 — Hardening packaging (previne ruperea la build curat)

### D3.1 — Bake env-ul frontend pentru desktop  ·  Efort S · Risc Med
**Probleme:** #9, #10, #24. **Fișiere:** `frontend/.env.production`, `frontend/src/middleware.ts`, eventual `scripts/build-installer.js`.
**Cauză:** `NEXT_PUBLIC_AUTH_DISABLED` + `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` + `NEXT_PUBLIC_API_URL` trăiesc DOAR în `frontend/.env.local` (gitignored). Build curat/CI → middleware redirect-loop `/login` sau 503.
**Schimbare (alege una sau ambele):**
   1. Mută variabilele necesare desktop-ului în `frontend/.env.production` (versionat) sau injectează-le explicit în scriptul de build desktop.
   2. **Mai robust:** fă `middleware.ts` să fie no-op când `NEXT_PUBLIC_DESKTOP_MODE === 'true'` (desktop nu folosește niciodată sesiune Supabase SSR — auth-ul real e gate-ul local 1234). Astfel desktop-ul nu mai depinde de AUTH_DISABLED deloc.
   - Recomandare: **#2** (decuplează desktop-ul de auth-ul Supabase) + bake `API_URL`/Supabase pentru renderer.
**Verificare:** build pe checkout curat fără `.env.local` → desktop pornește, login 1234 trece, paginile protejate nu redirect-ează.

### D3.2 — Guard pagini auth Supabase pe desktop  ·  Efort S · Risc Low
**Probleme:** #32. **Fișiere:** `frontend/src/app/signup/page.tsx`, `frontend/src/app/login/reset-password/page.tsx`.
- Redirect către `/login` (sau `notFound()`) când `DESKTOP_MODE` — azi `/signup` poate crea conturi cloud fantomă pe care desktop-ul nu le folosește.

---

## Wave D4 — Robustețe shell Electron

### D4.1 — cleanupOrphans nu mai ucide backendul web dev + race bind  ·  Efort S · Risc Med
**Probleme:** #18 (medium), #29 (low, diff necomis). **Fișier:** `electron/src/main.js:54,136-170,760-764`.
- În `isDev`, fie sari peste `cleanupOrphans`, fie limitează-l la portul frontend (3947), fie folosește un port backend dedicat desktop (ex. 8947) ca la frontend → nu mai omoară `python run.py` de pe 8000.
- Adaugă un settle scurt (200-500ms) după ce `cleanupOrphans` rezolvă, înainte de `startBackend()` (azi mutarea sync→async lasă un race de bind).

### D4.2 — Download-uri in-app, nu în browser extern  ·  Efort S-M · Risc Low
**Probleme:** #19. **Fișiere:** `electron/src/main.js:607-612`, `frontend/src/app/librarie/page.tsx:2189,1508`.
- În `setWindowOpenHandler`, lasă in-app URL-urile către originea proprie (localhost:8000/3947); deschide extern doar host-uri cu adevărat externe. SAU migrează butoanele de download de la `window.open` la `fetch→blob→<a download>` (pattern deja folosit la `librarie:936`).

### D4.3 — loadURL host-consistent + handler eșec + timeout splash  ·  Efort S · Risc Med
**Probleme:** #20. **Fișier:** `electron/src/main.js:393-394,775-779`.
- Folosește `127.0.0.1` consecvent în `checkStartupState` (ca la health-check).
- Adaugă `mainWindow.webContents.on('did-fail-load', …)` + `.catch` pe `loadURL` (afișează fereastra/dialog, închide splash) + un timeout de siguranță care forțează închiderea splash-ului.

### D4.4 — Dialog recuperare crash frontend  ·  Efort S · Risc Low
**Probleme:** #21. **Fișier:** `electron/src/main.js:339-348` (vs backend `:266-291`).
- La epuizarea bugetului de restart frontend, afișează dialog Restart/Quit (replică backendul).

### D4.5 — Validare credențiale înainte de startBackend  ·  Efort S · Risc Med
**Probleme:** #22. **Fișier:** `electron/src/main.js:178-203,225`.
- După `seedDesktopEnv`, verifică prezența `SUPABASE_URL/KEY`; dacă lipsesc, blochează cu mesaj clar (ghidează spre Settings) SAU permite fallback sqlite — nu trata absența ca non-fatală pe `DATA_BACKEND=supabase`.

### D4.6 — Kill process tree la quit (ffmpeg orfan)  ·  Efort S · Risc Low
**Probleme:** #23. **Fișier:** `electron/src/main.js:632-650`.
- Inversează ordinea: rulează cleanup-ul psutil pe port (omoară recursiv copiii uvicorn, inclusiv ffmpeg) ÎNAINTE de `backendProcess.kill()`; SAU `taskkill /T /PID` / `psutil children(recursive=True)`.

### D4.7 — Notificare tray la prima minimizare  ·  Efort S · Risc Low
**Probleme:** #30. **Fișier:** `electron/src/main.js:494-538,615-620`.
- Balloon o singură dată „Edit Factory rulează în continuare în tray" sau preferință „închide complet la X".

---

## Wave D5 — Polish căi/native (low)

### D5.1 — Fallback APPDATA-lipsă user-writable  ·  Efort S · Risc Low
**Probleme:** #33. **Fișier:** `app/config.py:33-52`.
- Dacă `APPDATA` lipsește, alege `os.path.expanduser('~')/EditFactory` (scriabil) + log clar, în loc de rădăcina pachetului (potențial read-only) → evită eșec `ensure_dirs` la pornire.

---

## Secvențiere recomandată & dependențe

```
D0.1 (profil)          ─┐  CRITIC, independent — START AICI
D0.2a/b (normalize+thumb)─┤  mecanic, low-risk, poate merge în paralel
D0.2 media (A/B) ────────┘  🔶 decizie ta

D1.1–D1.5 (gating UI) ──── un singur build standalone la final închide ~12 probleme
D2.1 (orphan) ──────────── 🔶 decizie ta (cuplat cu D1.4 pt /products)
D3.1 (env bake) ────────── înainte de orice release/CI build
D3.2, D4.*, D5.* ───────── polish, după ce critice+gating sunt verzi
```

**Decizii care te blochează (rezolvă-le întâi):**
1. 🔶 **D0.1** — ce `user_id` are desktop-ul (auto-seed UUID hardcodat vs user dedicat)?
2. 🔶 **D0.2** — media: storage cloud (A) sau local-cu-UX (B)?
3. 🔶 **D2.1** — product-video: surface în navbar sau demontează routerele?
4. 🔶 **D3.1** — middleware no-op pe desktop SAU bake env (sau ambele)?

**Estimare grosieră:** D0 = ~1-2 zile (mai ales decizia media) · D1 = ~半 zi (mecanic) · D2 = ~2h + decizie · D3 = ~2h · D4 = ~半 zi · D5 = ~1h.

**Note de proces:** build standalone necesar după modificările frontend (`cd frontend && npm run build`) chiar și în dev — vezi [[project-desktop-shell-gotchas]]. La commit folosește `git add` explicit (tree partajat cu fișiere necomise). Mașina asta are NVENC; FFmpeg la `ffmpeg/ffmpeg-master-latest-win64-gpl/bin`.
