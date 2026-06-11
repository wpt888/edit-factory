"""
Seed the in-app Wiki (editai_wiki_pages) with the MVP Desktop implementation log.

Idempotent: re-running replaces the managed pages (matched by slug) without
touching any other wiki content. Seeds the page set into the "Default" profile
(or the first profile if none is named Default).

Usage:
    DESKTOP_MODE=true DATA_BACKEND=sqlite python scripts/seed_wiki_docs.py

The pages document phases F0-F7 of the desktop MVP. This script is the
version-controlled source of truth for that documentation — the wiki rows
themselves live in the per-profile DB and would otherwise not be reproducible.
"""
import os
import re
import sys
import uuid
from datetime import datetime, timezone

# Ensure the app package is importable when run from the repo root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.repositories.factory import get_repository  # noqa: E402
from app.repositories.models import QueryFilters  # noqa: E402

TABLE = "editai_wiki_pages"


def _slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "page"


# --- Page content (category, sort_order, title, markdown) ---------------------

MVP = "MVP Desktop"
REF = "Referință"

PAGES = [
    (MVP, 0, "00 · Overview & Status", """
# MVP Desktop — Overview & Status

Edit Factory a trecut de la aplicație **web SaaS** la aplicație **desktop
(Electron)** pentru editare video în masă. AI se folosește **doar** pentru
scripturi (Gemini) și voiceover (ElevenLabs cu fallback Edge-TTS gratuit);
restul fluxului e determinist (keyword matching, FFmpeg, scoring motion/blur).

Planul complet (sursa de adevăr): `.planning/MVP-DESKTOP-PLAN.md`.

## Stare faze (toate complete — 2026-06-11)

| Fază | Subiect | Commit |
|------|---------|--------|
| **F0** | Stabilizare (auth gate desktop + fix standalone build) | `d6e044d` |
| **F1** | Desktop trim — dezactivare routere web prin flags | `5b33946` |
| **F2** | Preview Tier 1 — cache per-segment + NVENC + SSE | `c25e671` |
| **F3** | Persistență pipeline în SQLite (write-through) | `e6d46a8` |
| **F4** | Refactor pipeline/page.tsx (7140 → 3694 linii) | `5654f68` |
| **F5** | Player compozit — preview instant fără render | `408dd2c` |
| **F6** | Batch mode — N idei → N videoclipuri | `91b1bd7` |
| **F7** | Packaging & hardening (vault local + Edge fallback) | `ea9c685` |

Total: ~47 fișiere, +11.700 / −7.900 linii.

## Diferențiatorul de produs

Preview-ul web rula un **render FFmpeg complet (30–80s)** la fiecare editare.
Pe desktop, segmentele sursă sunt fișiere locale → preview-ul devine o
**proiecție compusă în player** (audio TTS = master clock, segmente redate
secvențial, subtitrări overlay), **instant și fără FFmpeg**. Render-ul FFmpeg
rămâne doar pentru exportul final. Vezi pagina **F5 · Player Compozit**.

## Verificat end-to-end (SQLite desktop, API reale)

Idee → script Gemini → TTS (ElevenLabs, fallback Edge) → matching determinist
17/17 → preview instant (drift A/V ~30ms) → **MP4 final 1080×1920 în library cu
thumbnail**. Batch: 2 idei → 2 variante ready-for-review → approve → render.

## Livrabil

Installer NSIS: `electron/dist/editfactory-setup-0.1.0.exe` — **388 MB**
(sub limita de 550 MB). Construit cu `node scripts/build-installer.js`.

## Întrebări deschise (pentru release)

1. Smoke test installer pe o mașină/VM curată (manual).
2. Release cu login test `1234/1234` sau legăm licențiere înainte?
3. Rutele de produse (product-video/batch-generate) rămân montate dar ascunse
   din nav — le dezactivăm complet?

## Convenții utile

- Login test: **1234/1234** (configurabil `DESKTOP_TEST_USER`/`_PASSWORD`).
- Profil de test: **Default**.
- Vocea ElevenLabs default a profilului e *library voice* → 402 pe plan free;
  folosește o voce *premade* (ex. Adam `pNInz6obpgDQGcFmaJgB`) sau lasă
  fallback-ul Edge să preia. Vezi pagina **F7 · Packaging & Hardening**.
""".strip()),

    (MVP, 1, "F0 · Stabilizare", """
# F0 · Stabilizare — `d6e044d`

**Obiectiv:** comit munca necomisă din sesiunile anterioare și verifică pornirea
curată a aplicației Electron.

## Ce s-a făcut

- **Auth gate desktop:** license gate-ul vechi înlocuit cu login simplu
  user/parolă (default `1234/1234`). Endpoint-uri noi în
  `app/platforms/desktop/routes.py`: `/desktop/auth/login|status|logout`;
  starea `desktop_logged_in` persistată în `config.json` din AppData.
- **`DesktopAuthGuard`** (`frontend/src/components/desktop-auth-guard.tsx`):
  nu randează NICIODATĂ children pentru un user neautentificat (nici un frame
  în timpul redirect-ului) → fixează React error #310 pe pagina pipeline.
- **Fix critic standalone build** (`frontend/next.config.ts`):
  `outputFileTracingRoot` pinează workspace root-ul astfel încât
  `server.js` rămâne la `.next/standalone/server.js` (nu cuibărit sub
  `frontend/`), aliniind cu locul unde `postbuild.js` copiază assets.
  Fără el → toate `_next/static/*` dau 404 (ecran alb în Electron).
- `electron/src/main.js`: `checkStartupState()` rutează prin
  `/desktop/auth/status`, fail-closed spre `/login`.

## Acceptare

App-ul Electron pornește curat, login `1234/1234` → `/pipeline` fără 404 /
React #310, zero erori în consolă (verificat Playwright). A fost nevoie de
crearea unui profil "Default" — baza SQLite din AppData era goală.

Vezi și pagina **Overview & Status**.
""".strip()),

    (MVP, 2, "F1 · Desktop Trim", """
# F1 · Desktop Trim — `5b33946`

**Obiectiv:** aplicația desktop nu expune funcționalitatea web-SaaS. NIMIC nu se
șterge — doar feature flags.

## Backend (`app/main.py`)

6 routere montate condiționat `if not settings.desktop_mode`, cu importurile în
interiorul guard-ului (desktop nu plătește costul lor de import):
`postiz`, `buffer`, `schedule`, `feeds`, `catalog`, `image-gen` (fal.ai).
Rutele de produse rămân montate (decizie deschisă). Verificat: endpoint-urile
dezactivate răspund **404** în desktop mode, prezente toate în web mode.

## Frontend (`navbar.tsx`)

Filtrare în desktop mode prin `WEB_ONLY_HREFS` — nav-ul arată doar:
Pipeline, Segments, Clips, TTS, Settings (+ Batch, Wiki). Calendar și grupul
Products dispar.

## Gemini Vision

Flag nou `gemini_vision_enabled` (None = auto: OFF pe desktop) + helper
`gemini_vision_allowed()` în `video_processor.py` care gate-uiește ambele
puncte de utilizare. Scoring-ul determinist motion/variance/blur e fallback-ul.
Aliniere cu viziunea "AI doar pentru script + voiceover".

## Acceptare

142 teste SQLite/pipeline/assembly trec; singura cădere (`test_api_jobs`) e
pre-existentă (confirmată cu `git stash`).
""".strip()),

    (MVP, 3, "F2 · Preview — Cache + SSE", """
# F2 · Preview Tier 1 — `c25e671`

**Obiectiv:** re-preview după o editare iterativă scade de la 30–80s la <15s
(realizat: **<2s** pe media de test).

## Cache per-segment (`app/services/segment_cache.py` — nou)

Cache content-addressed pentru fișierele extrase (`segment_NNN.mp4`):
cheie = SHA256 peste `source mtime/size + interval + durată/looping + filtre +
codec params + fps`. Scrieri atomice (`.tmp` → `os.replace`), eviction LRU
plafonat la `segment_cache_max_gb` (default 5GB), partajat între profile.

În `assemble_video()` (`assembly_service.py`): lookup înainte de extracție
(hit-urile sar peste FFmpeg ȘI peste semafor); store după. Hit/miss logate.

## GPU decode

`-hwaccel cuda` la decode-ul de extracție când NVENC e prezent (fallback
software automat când codecul nu e suportat).

## SSE progress

Endpoint nou `GET /pipeline/preview-progress/{id}/{variant}` (diffing de stare
la 300ms, închide la status terminal). `variant-preview-player.tsx` folosește
`EventSource`, cu polling-ul vechi de 2s ca fallback. `-movflags +faststart`
era deja aplicat la preview prin `preset.extra_flags`.

## Acceptare

Test de integrare dovedește: re-render identic = toate hit-urile cache,
editare 1 segment = exact 1 miss. 78 teste trec.
""".strip()),

    (MVP, 4, "F3 · Persistență Pipeline", """
# F3 · Persistență Pipeline — `e6d46a8`

**Obiectiv:** restart de backend/Electron nu mai pierde lucrul în curs.

Write-through-ul de bază (`_db_save_pipeline`, `_db_load_pipeline`, lazy load,
`/pipeline/list`, UI de istoric) exista deja din fazele 80–88. F3 închide două
goluri reale:

## 1. Editările de timeline se persistă

Endpoint nou `PUT /pipeline/{id}/matches/{variant}` scrie match-urile editate
în `previews[key].preview_data` → `/restore-previews` returnează timeline-ul
editat la reluare, nu auto-match-ul original. Pagina pipeline salvează editările
**debounced (800ms)**, best-effort (rămân în state și sunt trimise oricum ca
`match_overrides` la render).

## 2. FIX CRITIC: salvarea pipeline pe SQLite eșua silențios

Schema SQLite nu avea `selected_captions` / `target_script_duration` /
`subtitle_settings_by_key`, iar retry-ul de degradare din `_db_save_pipeline`
poate elimina **o singură** coloană lipsă per încercare → starea pipeline-ului
nu se persista NICIODATĂ în desktop mode. Reparat: coloane în
`sqlite_schema.sql` + migrare ALTER TABLE in-place pentru DB-uri existente
(`sqlite_repo._ensure_pipeline_columns`) + înregistrare coloane JSON.

Acesta a fost primul dintr-o serie de bug-uri de schema-drift — vezi
pagina **Referință · SQLite Schema-Drift**.

## Acceptare

Test dovedește loop-ul de restart: salvează editări → drop memory cache →
`/restore-previews` returnează timeline-ul editat. 126 teste SQLite trec.
""".strip()),

    (MVP, 5, "F4 · Refactor Pipeline Page", """
# F4 · Refactor `pipeline/page.tsx` — `5654f68`

**Obiectiv:** pregătirea terenului pentru playerul compozit. ZERO schimbări de
comportament.

`frontend/src/app/pipeline/page.tsx`: **7140 → 3694 linii** prin extracție
mecanică cu pattern-ul "ctx-bag" (tot state-ul și closure-urile rămân în
`PipelinePage`; componentele de step primesc un singur obiect `ctx` și
destructurează, deci JSX-ul mutat e byte-identic).

## Fișiere noi

- `pipeline-types.ts` — tipuri partajate (PreviewKey, PreviewData, MatchPreview)
- `pipeline-utils.tsx` — debounced inputs, formatDuration, countWords
- `components/`: `step1-script` (528), `step2-tts` (1230),
  `step3-preview` (827), `step4-render` (413), `pipeline-stepper` (151),
  `pipeline-history-sidebar` (322), `script-card`, `eleven-credits-badge`,
  `subtitle-style-preview-panel`, `pipeline-error-boundary`

`Step3Ctx` documentează contractul tipizat al stării de timeline pe care
playerul compozit din F5 îl consumă (previews, match handlers, interstitials,
thumbnails, subtitle resolvers).

## Acceptare

`tsc` curat, eslint identic cu baseline (4/18 pre-existente), production build
OK, smoke test Electron: creare pipeline manual → step 2 + sidebar de istoric se
actualizează live, zero erori în consolă (screenshots).
""".strip()),

    (MVP, 6, "F5 · Player Compozit", """
# F5 · Player Compozit — `408dd2c` ⭐ DIFERENȚIATORUL

**Obiectiv:** preview = proiecție compusă în player, nu fișier randat. Editezi →
vezi instant (<1s), zero FFmpeg.

Playerul compozit (audio TTS = master clock, pool de video-uri per sursă,
overlay subtitrări, scrub, merge groups) exista deja în `TimelineEditor`. F5
închide golurile lui și bug-urile desktop care îl blocau end-to-end.

## Fix player

La activare, `syncPreviewVideo(0)` se auto-compara ca "același merge group" și
returna înainte de `video.play()` → primul segment rămânea înghețat până la
prima tranziție de grup. Reparat cu guard `prevIdx !== matchIdx`.

UI: "Play Preview" → **"Instant Preview"** (afordanța default); butonul Eye
(render-preview FFmpeg) re-etichetat ca preview de fidelitate înaltă.

## Fix offline TTS

`silence_remover`: lazy annotations (`from __future__ import annotations`) —
adnotarea `-> Optional[VoiceDetector]` arunca `NameError` la import când ML
bundle-ul lipsea, omorând TTS-ul complet în loc de fallback FFmpeg.

## Fix-uri schema SQLite (fiecare rupea un flux desktop la prima utilizare)

- `editai_source_videos` lipseau name/description/thumbnail_path/fps/
  file_size_bytes/segments_count → create eșua
- `editai_segments` lipseau keywords/notes/transforms/product_group/
  is_favorite/single_use/extracted_video_path → create eșua
- `list_segments` nu emula join-ul embedded `editai_source_videos(file_path)`
  → "No usable segments found"

Reparate prin schema file + ALTER TABLE in-place cu backfill legacy
(`filename`→`name` etc.) — vezi pagina **Referință · SQLite Schema-Drift**.

## Acceptare

Verificat E2E pe SQLite cu media reală: video local, 5 segmente cu keywords,
script manual, TTS, **17/17** matching determinist, playerul redă din segmentul
0 cu drift A/V **~30ms** (cerința <100ms), zero apeluri FFmpeg la preview.
""".strip()),

    (MVP, 7, "F6 · Batch Mode", """
# F6 · Batch Mode — `91b1bd7`

**Obiectiv:** promisiunea produsului — dai N idei → aplicația produce N
videoclipuri ready-for-review, fără babysitting.

## Backend (`app/api/batch_routes.py` — nou)

`POST /pipeline/batch` pune în coadă până la 20 idei. Un worker secvențial în
fundal transformă fiecare idee într-un pipeline persistat (script Gemini → TTS →
SRT → matching determinist) și îl marchează `ready_for_review`. Starea trăiește
în `JobStorage` (persistat, rezistent la restart); `POST /batch/{id}/resume`
reia DOAR item-urile neterminate. Izolare de eroare per-item.

Endpoint-uri: `GET /batch` (listă), `GET /batch/{id}` (status + items),
`POST /batch/{id}/resume`. Worker-ul refolosește `preview_variant()` direct
(aceeași cale de persistență ca UI-ul); render-ul item-urilor aprobate
refolosește `POST /pipeline/render/{id}`.

## Frontend (`frontend/src/app/batch/page.tsx`)

Pagina `/batch`: textarea de idei + setări, polling status la 2.5s cu badge-uri
per-item, **Review** → pipeline step 3, **Approve & Render** cu progres de
render; listă "Recent Batches"; intrare Batch în nav (vizibilă pe desktop).

## Acceptare

E2E cu API-uri reale: 2 idei → 2 `ready_for_review` (Gemini + ElevenLabs +
matching) → approve → MP4 1080×1920 de 11.5s în library cu thumbnail. 5 teste de
worker (succes / izolare eroare / resume) trec.
""".strip()),

    (MVP, 8, "F7 · Packaging & Hardening", """
# F7 · Packaging & Hardening — `ea9c685`

**Obiectiv:** installer instalabil pe o mașină curată, funcțional offline.

## Vault cheie locală (`app/services/key_vault.py`)

În desktop mode cheia Fernet derivă dintr-un **salt local per-mașină**
(hostname + `vault_salt.bin`), niciodată din `SUPABASE_KEY` — o aplicație
offline-first nu trebuie să-și cupleze secretele de o credențială cloud.
Vault-urile legacy criptate cu `SUPABASE_KEY` migrează transparent la prima
citire (decrypt cu fernet legacy → re-encrypt sub cheia curentă).

## Fallback Edge-TTS (`app/services/assembly_service.py`)

`generate_tts_with_timestamps` era hardwired pe ElevenLabs; orice eșec (lipsă
cheie, 402 cotă, rețea) omora preview/render-ul. Acum cade pe **Edge-TTS
(gratuit)** cu timestamp-uri de caractere estimate uniform — timing-ul
subtitrărilor e aproximativ dar întreg fluxul determinist merge fără nicio cheie
API. Verificat real: eșecul 402 "library voice" se completează acum prin Edge cu
15/15 fraze matched.

## Installer

`electron/dist/editfactory-setup-0.1.0.exe` — **388 MB** (limita 550). Construit
cu `node scripts/build-installer.js` (descarcă Node portabil v22, împachetează
venv + frontend standalone + FFmpeg). Notă: build-ul trebuie rulat din
PowerShell/Windows; simlink-urile WSL din `ffmpeg/.../bin` strică
electron-builder (EACCES lstat) — șterge-le înainte.

## Acceptare

3 teste de vault (izolare desktop / migrare / paritate web) trec; regresie
completă SQLite 194 passed (4 căderi pre-existente în `test_encoding_presets`,
confirmate cu stash).
""".strip()),

    (REF, 0, "SQLite Schema-Drift — bug-uri reparate", """
# Referință · SQLite Schema-Drift

Pattern recurent descoperit pe parcursul MVP-ului: `supabase/sqlite_schema.sql`
era în **drift sistemic** față de codul care scrie în tabele. Tabelul SQLite era
un snapshot vechi; codul (repository + routes) scria coloane care nu existau →
fiecare flux desktop nou lovea o coloană lipsă și eșua la **prima utilizare**.

## Bug-uri reparate

| Tabel | Coloane lipsă | Simptom | Fază |
|-------|---------------|---------|------|
| `editai_pipelines` | selected_captions, target_script_duration, subtitle_settings_by_key | salvare pipeline eșua silențios | F3 |
| `editai_source_videos` | name, description, thumbnail_path, fps, file_size_bytes, segments_count | add video local → 500 | F5 |
| `editai_segments` | keywords, notes, transforms, product_group, is_favorite, single_use, extracted_video_path | create segment → 500 | F5 |

Plus: `list_segments` nu emula join-ul embedded Supabase
`editai_source_videos(file_path)` → segmentele păreau fără cale ("No usable
segments found"). Emulat în `sqlite_repo.list_segments` (atașează dict-ul
`editai_source_videos` per rând).

## Reteta de fix (consistentă)

1. Adaugă coloanele în `supabase/sqlite_schema.sql` (pentru DB-uri noi).
2. Migrare in-place pentru DB-uri existente: `_ensure_<table>_columns()` în
   `sqlite_repo.py` — `PRAGMA table_info` → `ALTER TABLE ADD COLUMN` pentru ce
   lipsește, cu backfill din coloanele legacy (ex. `filename`→`name`).
3. Înregistrează coloanele JSON în `_JSON_COLUMNS` (ex. `keywords`,
   `transforms`).
4. Fallback-uri tolerante în response builders (ex. `_source_video_response`
   citește `name or filename`).

**Lecție pentru sesiuni viitoare:** orice flux desktop nou poate lovi acest
drift. Dacă un insert/select SQLite dă "no column named X" sau date goale
neașteptate, verifică întâi schema vs. codul care scrie.
""".strip()),

    (REF, 1, "Build, Run & Test", """
# Referință · Build, Run & Test

## Rulare în dezvoltare

```
# Backend (venv Python 3.12 — NU 3.14, scipy nu compilează)
python run.py                       # FastAPI :8000

# Frontend
cd frontend && npm run dev          # Next.js :3000

# Desktop complet (spawn backend + frontend + window)
cd electron && npm start
```

Login desktop: **1234/1234**. Mediul Electron injectează
`DESKTOP_MODE=true`, `DATA_BACKEND=sqlite`, `NEXT_PUBLIC_DESKTOP_MODE=true`.

## Build frontend standalone

```
cd frontend && npm run build        # → .next/standalone (server.js flat)
```

Dacă build-ul dă `EBUSY rmdir .next/standalone`, oprește mai întâi orice
Electron care rulează (`python -m app.platforms.desktop.service cleanup
--ports 8000 3000`).

## Build installer

```
node scripts/build-installer.js     # → electron/dist/editfactory-setup-X.Y.Z.exe
```

Rulează din Windows/PowerShell. Șterge simlink-urile WSL din
`ffmpeg/ffmpeg-master-latest-win64-gpl/bin` (ffmpeg/ffplay/ffprobe fără `.exe`)
înainte — strică electron-builder.

## Teste

```
# Suita SQLite + pipeline (rapidă, fără rețea)
venv/Scripts/python -m pytest tests/ -q --no-cov

# Teste cheie adăugate în MVP:
tests/test_segment_cache.py  tests/test_segment_cache_integration.py   # F2
tests/test_pipeline_save_matches.py                                    # F3
tests/test_sqlite_segments_embed.py                                    # F5
tests/test_batch_pipeline.py                                           # F6
tests/test_key_vault_desktop.py                                        # F7
```

Căderi pre-existente cunoscute (NU regresii): `test_api_jobs` (1),
`test_encoding_presets` (4) — confirmabile cu `git stash`.

## Re-seed acest wiki

```
DESKTOP_MODE=true DATA_BACKEND=sqlite python scripts/seed_wiki_docs.py
```

Idempotent — înlocuiește paginile gestionate fără a atinge alt conținut.
""".strip()),
]


def main() -> int:
    repo = get_repository()
    if not repo:
        print("ERROR: repository unavailable", file=sys.stderr)
        return 1

    # Pick the target profile: prefer one named "Default", else the first.
    profiles = repo.table_query(
        "editai_profiles", "select",
        filters=QueryFilters(select="id, name"),
    ).data or []
    if not profiles:
        print("ERROR: no profiles exist — create one in the app first", file=sys.stderr)
        return 1
    target = next((p for p in profiles if (p.get("name") or "").lower() == "default"), profiles[0])
    profile_id = target["id"]
    print(f"Seeding wiki for profile '{target.get('name')}' ({profile_id})")

    now = datetime.now(timezone.utc).isoformat()
    managed_slugs = {_slugify(title) for _, _, title, _ in PAGES}

    # Idempotent: delete any previously-managed pages by slug for this profile.
    existing = repo.table_query(
        TABLE, "select",
        filters=QueryFilters(select="id, slug", eq={"profile_id": profile_id}),
    ).data or []
    for row in existing:
        if row.get("slug") in managed_slugs:
            repo.table_query(TABLE, "delete", filters=QueryFilters(eq={"id": row["id"]}))

    inserted = 0
    for category, sort_order, title, content_md in PAGES:
        repo.table_query(TABLE, "insert", data={
            "id": str(uuid.uuid4()),
            "profile_id": profile_id,
            "title": title,
            "slug": _slugify(title),
            "category": category,
            "content_md": content_md,
            "sort_order": sort_order,
            "created_at": now,
            "updated_at": now,
        })
        inserted += 1

    print(f"Seeded {inserted} wiki pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
