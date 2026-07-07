# Faza D1 — Product Library local + curățare catalog (desktop)

**Repo:** `C:\obSID SRL\n8n\edit_factory` (desktop). **Branch:** `feat/d1-product-library`.
**Plan master & guardrails:** `@docs/IMPLEMENTATION-PLAN-2026-07.md`
**De ce (context):** `@docs/PLATFORM-STRATEGY-2026-07.md` §8.

---

## 1. Obiectiv (o frază)

Înlocuiește catalogul hardcodat pe magazinul Gomag cu o **bibliotecă de produse locală, per-user** (titlu + imagini + descriere), cu **descriere generată automat din imagine+titlu prin Gemini Vision**, folosibilă ca sursă de context în generarea în masă.

## 2. De ce (problema)

- `v_catalog_products` (view peste `uf.products_catalog`, migrarea `018`) e **hardcodat pe magazinul userului** (Gomag, `company_id`, `gomag_product_id`), nefiltrat pe profil. **Dacă se livrează așa, orice client viitor vede produsele altcuiva** → data leak + jenă. Blocker de lansare.
- Tabelul `products` (migrarea `013`) e per-profil, dar **presupune un feed Google Shopping** — friction pentru cine n-are magazin.
- Userul vrea: adaugă manual produse (titlu + imagini + descriere opțională), **local pe PC**, reutilizate la generare **fără să lipească context de fiecare dată**. Local întâi, cloud ulterior.

## 3. Scope

**IN:**
- Store local de produse (SQLite în `userData`, izolat de restul app-ului).
- CRUD backend + UI „Product Library / Produsele mele".
- Upload 1..N imagini per produs, salvate local.
- Endpoint „Generează descriere" din imagine(i)+titlu via Gemini Vision.
- Legarea unui produs local ca sursă de context în fluxul de generare existent.
- Gate-uirea (ascunderea din default) a catalogului hardcodat Gomag.

**OUT (nu în această fază):**
- Sync în cloud/Supabase (fază ulterioară — lasă doar coloana `synced_at` pregătită, nu implementa sync-ul).
- Ștergerea path-ului de import feed (rămâne opțional, neatins).
- Orice schimbare în auth, pipeline video, sau `DATA_BACKEND` pentru restul app-ului.

## 4. Model de date (local, izolat)

Store local dedicat, **independent de `DATA_BACKEND=supabase`** (excepție deliberată, documentată în planul master).

- Locație: SQLite în directorul `userData` al app-ului (folosește helper-ul existent pentru path userData / `settings`).
- Imaginile: fișiere în `userData/product_library/images/<product_id>/`. În DB stochează **path-uri relative**, nu blob-uri.

Tabel `local_products`:
| coloană | tip | note |
|---|---|---|
| `id` | TEXT PK | uuid |
| `profile_id` | TEXT | pentru izolare per-profil (chiar și local) |
| `title` | TEXT NOT NULL | |
| `description` | TEXT | opțional; poate fi auto-generat |
| `image_paths` | TEXT (JSON array) | path-uri relative la imagini |
| `created_at` | TEXT | ISO |
| `updated_at` | TEXT | ISO |
| `synced_at` | TEXT NULL | rezervat pentru sync cloud ulterior (lasă NULL) |

## 5. Backend (FastAPI)

Router nou `app/api/product_library_routes.py`, prefix `/product-library`, montat sub `/api/v1` (urmează pattern-ul routerelor existente). Auth prin `Depends(get_profile_context)` ca restul.

Endpoints:
- `POST /product-library` — creează produs. Multipart: `title`, `description?`, `images[]`. Salvează imaginile local, inserează rândul. Întoarce produsul.
- `GET /product-library` — listă per-profil.
- `GET /product-library/{id}` — un produs.
- `PUT /product-library/{id}` — update titlu/descriere; add/remove imagini.
- `DELETE /product-library/{id}` — șterge rândul + fișierele de imagine.
- `GET /product-library/{id}/image/{idx}` — servește imaginea locală (sau folosește mecanismul existent de servire a imaginilor locale, dacă există).
- `POST /product-library/{id}/generate-description` — apelează Gemini Vision cu imaginea(ile)+titlu, întoarce descrierea propusă. **Nu suprascrie automat** — o întoarce ca sugestie, userul o acceptă în UI.

Persistență: adaugă metodele în stratul SQLite (`app/repositories/`), urmând pattern-ul `SQLiteRepository` existent. **Nu** băga produsele locale în Supabase.

## 6. Gemini Vision — descriere auto

- **Refolosește clientul Gemini deja folosit** pentru analiză video / script (caută în `app/services/` — `script_generator.py` și serviciul de analiză vizuală). Nu adăuga un SDK nou.
- Cheia se rezolvă prin `api_key_vault` (service `gemini`) cu fallback env, exact ca acum.
- Prompt (RO/EN, scurt): „Ai imaginea unui produs și titlul «{title}». Scrie o descriere de produs concisă (2-3 fraze), potrivită pentru reels/TikTok, care evidențiază beneficiile. Fără emoji, fără hashtag-uri."
- Loghează costul în `api_costs` (există `cost_tracker.log_gemini_analysis` sau similar) — refolosește.

## 7. Frontend (Next.js)

- Pagină nouă „Product Library" (localizează pattern-ul paginilor existente în `frontend/src/app/`; refolosește componentele Shadcn existente și stilul Blipost din `globals.css`).
- Listă/grid de produse (thumbnail + titlu).
- Dialog „Adaugă produs": input titlu, upload imagini (drag&drop), textarea descriere + buton **„Generează descriere"** (apelează endpoint-ul Gemini, populează textarea cu sugestia, editabilă).
- Editare/ștergere produs.
- În fluxul de generare existent (localizează unde se alege produsul azi — vezi `product_generate_routes.py` și pagina care îl consumă), adaugă opțiunea de a alege un **produs din biblioteca locală** ca sursă de context (descrierea lui devine `context`).

## 8. Curățarea catalogului hardcodat

- Ascunde catalogul Gomag din navigarea/UI default (feature-flag OFF by default, ex. setare `catalog_gomag_enabled=false`, sau scoate ruta din meniul default).
- **Nu șterge** migrarea `018` sau datele — doar asigură-te că **nu e calea default** și **nu e vizibilă altor useri**. Product library locală devine default-ul.
- Verifică `catalog_routes.py` să nu returneze catalogul hardcodat fără flag explicit.

## 9. Refolosește (scara lenei)

- `SQLiteRepository` + pattern-ul de repository (`app/repositories/`).
- Coloana/pattern-ul `local_image_path` deja existent pentru imagini locale.
- Clientul Gemini existent (analiză video / `script_generator.py`).
- `api_key_vault` pentru cheie, `cost_tracker` pentru logging.
- Fluxul `product → context → ScriptGenerator` din `product_generate_routes.py` (~linia 743).
- Componente Shadcn + stil Blipost existente.

## 10. Criterii de acceptare (verificabile)

1. Pe un profil nou, **fără** seed Supabase, userul poate adăuga un produs (titlu + ≥1 imagine) care se salvează **local** și persistă după restart.
2. Butonul „Generează descriere" produce o descriere plauzibilă din imagine+titlu (Gemini Vision).
3. Descrierea produsului local poate fi folosită ca context pentru a genera scripturi/video (fluxul existent).
4. Catalogul hardcodat Gomag **nu** mai apare în UI-ul default.
5. Import-ul feed Google Shopping încă funcționează (neatins).
6. `DATA_BACKEND=supabase` neschimbat pentru restul app-ului.

## 11. Verificare (obligatorie)

- Test Playwright care: deschide pagina Product Library, adaugă un produs cu o imagine de test, apasă „Generează descriere", face **screenshot** în `frontend/screenshots/` (regula din `CLAUDE.md`).
- Rulează backend pe 8000 (fără `--reload`), frontend pe 3001. Shell Electron: standalone build necesar și în dev.
- Self-check backend: un mic test care creează un produs local, îl citește, generează path de imagine, îl șterge (assert pe fiecare pas).

## 12. Investigează întâi (ancore în cod)

- `app/api/catalog_routes.py`, `app/api/product_routes.py`, `app/api/product_generate_routes.py`, `app/api/feed_routes.py`
- `supabase/migrations/013_create_product_tables.sql`, `018_create_catalog_view.sql`
- `app/repositories/` (SQLiteRepository + factory)
- `app/services/script_generator.py` + serviciul de analiză vizuală Gemini
- `app/services/credentials/vault.py`, `app/services/cost_tracker.py`
- `frontend/src/app/` (pagina de catalog/produse existentă + pattern de pagină)

## 13. Livrare

- Commit-uri mici, incrementale, pe `feat/d1-product-library`. **Nu** push/PR fără cerere explicită.
- La final: rezumat scurt (ce s-a livrat, ce a rămas OUT, cum s-a verificat).
