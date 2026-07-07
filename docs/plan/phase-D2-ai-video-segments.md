# Faza D2 — Video AI ca sursă de segmente (desktop, pe credite platformă)

**Repo:** `C:\obSID SRL\n8n\edit_factory` (desktop). **Branch:** `feat/d2-ai-video-segments`, din `main` (main include acum d1+u1, mergeate 2026-07-07).
**Plan master & guardrails:** `@docs/IMPLEMENTATION-PLAN-2026-07.md`
**Depinde de:** U1 (bridge-ul platform, în main) + W1/W2 pe web (joburile video + endpoint-urile `/videos` din contractul `social-scheduler/docs/platform-api.md`).

---

## 1. Obiectiv (o frază)

În pipeline-ul de mass-editing, userul poate **genera un segment video cu AI** (prin creditele platformei Blipost, nu BYOK) acolo unde nu are footage potrivit — clipul generat intră în timeline exact ca un segment obișnuit.

**Decizie de bani (luată):** generarea video din desktop merge pe **credite platformă** — desktop-ul apelează `POST /api/platform/v1/videos` prin clientul U1 (`blipost_platform_client`). O singură cheie fal (a firmei, pe web), userul consumă credite. NU adăuga cheie fal per-user pentru video.

## 2. Task 0 (obligatoriu, întâi) — repară cele 4 picker-e orfane de catalog

Review-ul post-D1 a găsit 4 suprafețe UI care încă cheamă `/catalog/products` și, cu catalogul Gomag gated OFF (default), arată tăcut „no products":

1. `frontend/src/components/dialogs/product-picker-dialog.tsx` (folosit din `pipeline/page.tsx` ~3572 pentru asocierea segment↔produs) + copilul `image-picker-dialog.tsx`
2. `frontend/src/app/create-image/page.tsx` (~326, 356)
3. `frontend/src/components/pipeline/pipeline-caption-generator.tsx` (~396)

**Fix cerut:**
- **create-image + caption-generator**: migrează picker-ele la `/product-library` (același pattern ca migrarea Step-1 din D1 — formă `{title, description}` + imaginile locale).
- **product-picker-dialog + image-picker-dialog (asocierea segment↔produs)**: DOAR gate-uiește intrarea în UI cu `NEXT_PUBLIC_CATALOG_GOMAG` (ca în `products/page.tsx`). Migrarea asocierilor la produse locale rămâne OUT (asocierile sunt keyed pe id-uri de catalog — feature separat, notat în planul master).

## 3. Scope D2 propriu-zis

**IN:**
- Extinde `app/services/blipost_platform_client.py` (U1) cu: `submit_video(prompt, model, duration_sec)` → `POST /videos`, `get_video(job_id)` → `GET /videos/{id}` (+ URL de download la `done`). Contractul exact: citește `social-scheduler/docs/platform-api.md` (DOAR citire, alt repo). Erorile 401/402/429 sunt deja mapate în `_check` — refolosește.
- Backend route(s) în desktop (`/platform/videos` sau extinderea `blipost_platform_routes.py`): submit + poll status; la `done`, **descarcă** video-ul local (în zona media a app-ului) și **înregistrează-l ca segment** utilizabil în pipeline. Investighează cum intră azi un video/segment în sistem (`editai_segments`, `source_video_id`, thumbnails) și folosește același drum — clipul AI trebuie să se comporte identic cu un segment tăiat din footage (thumbnail, durată, selectabil în timeline, renderabil).
- UI în pipeline (Step 3 / picker-ul de segmente): buton „Generate with AI" pe un slot/frază — prompt pre-completat din fraza de script + contextul de produs (editabil), selector model + durată (valorile permise vin din contract: Wan/Kling, 5|10s), **afișează costul în credite și soldul înainte de submit** (sold din `GET /me`; costul: dacă contractul nu expune ratele per model, afișează-l după submit din răspunsul `creditCost` și arată înainte doar soldul — nu inventa un endpoint nou pe web din acest repo).
- Stări UI: pending/generating (poll) / done (segmentul apare) / failed (mesaj + mențiunea că creditele se refundează automat pe platformă).
- Fără token platform configurat → butonul „Generate with AI" ascuns sau disabled cu hint („Connect Blipost account in Settings") — nimic nu crapă.

**OUT:**
- BYOK fal pentru video (imaginile BYOK existente rămân cum sunt — nu le atinge).
- TTS gestionat, sync product library cloud.
- Migrarea asocierilor segment↔produs la produse locale (doar gated, vezi Task 0).
- Orice modificare în repo-ul web (dacă contractul nu ajunge, oprește-te și raportează ce lipsește).

## 4. Refolosește (scara lenei)

- `blipost_platform_client.py` + maparea de erori + progress-store-ul din U1.
- Drumul existent de ingest segment/video (investighează `segments_routes.py`, procesarea de thumbnails, `editai_segments`).
- Pattern-ul de poll din UI (progress polling există în publish/pipeline).
- Pattern-ul picker-elor migrate în D1 pentru Task 0.

## 5. Criterii de acceptare

1. Task 0: create-image și caption-generator listează produsele din biblioteca locală; picker-ul de asociere nu mai apare fără flag; nimic nu mai arată tăcut gol.
2. Cu token platform + credite: din pipeline, „Generate with AI" pe o frază → job submis, status vizibil, la final clipul apare ca segment cu thumbnail și e folosit la render exact ca un segment normal.
3. Soldul e vizibil înainte de submit; 402 → mesaj clar „Insufficient credits" cu link/hint spre web.
4. Job failed pe platformă → mesaj clar, fără crash, fără segment fantomă.
5. Fără token → feature ascuns/disabled cu hint; restul pipeline-ului neatins.
6. Web-ul (repo-ul celălalt) nemodificat.

## 6. Verificare

- Playwright + screenshot (regula CLAUDE.md): Task 0 (picker-ele cu produse locale) + fluxul Generate-with-AI (mock sau live). Pentru live: web-ul de dev din `social-scheduler` (acum pe `main`) cu `PORT=3002 npm run dev` + worker (`npm run worker`) — worker-ul procesează jobul video (mock keyless: fără FAL_API_KEY produce clip determinist).
- Self-check backend: submit→poll→download→segment cu server mock (MockTransport, ca în testele U1) + asserturi pe 402 și failed.
- Backend desktop 8000 fără `--reload`, frontend 3001, Electron dev 3947.

## 7. Investigează întâi

- `social-scheduler/docs/platform-api.md` (contractul — doar citire), `app/services/blipost_platform_client.py`, `app/api/blipost_platform_routes.py`, `app/api/segments_routes.py` + cum se creează segmente/thumbnails, `frontend/src/app/pipeline/page.tsx` (Step 3 + picker segmente + linia ~3572), cele 4 fișiere din Task 0, `tests/test_blipost_platform_client.py` (pattern MockTransport).

## 8. Livrare

Commit-uri mici pe `feat/d2-ai-video-segments` (Task 0 în commit-uri separate de D2). Fără push/PR fără cerere explicită. La final: rezumat (livrat / OUT / cum s-a verificat).
