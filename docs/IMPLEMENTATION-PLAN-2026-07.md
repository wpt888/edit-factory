# Blipost — Plan de implementare & uniformizare (execuție /goal + Fable)

**Data:** 2026-07-06
**Context strategic complet (de citit prima dată):** `@docs/PLATFORM-STRATEGY-2026-07.md`
**Rol acestui fișier:** planul master de execuție. Fiecare fază e un `/goal` separat, într-un singur repo, cu spec propriu referențiat.

---

## 0. Cum se citește acest plan

- Fiecare **fază** = un singur `/goal`, într-un **singur repo**, self-contained și verificabil.
- Detaliile fiecărei faze stau într-un fișier de spec separat (`docs/plan/phase-*.md`) — referențiat cu `@` din promptul `/goal`.
- Ordinea recomandată: **D1 → W1 → W2 → U1** (apoi extra). Dependențele sunt explicite mai jos.
- Repo-uri:
  - **Desktop** = `C:\obSID SRL\n8n\edit_factory` (Electron + FastAPI + Next.js, Supabase).
  - **Web** = `C:\obSID SRL\n8n\social-scheduler` (Next.js + Drizzle + Postgres + R2 + Stripe).

---

## 1. Decizia de arhitectură: uniformizare prin PUNTE API (nu merge de DB)

**Problemă:** desktop (Supabase Auth + Supabase DB) și web (Auth.js + Postgres) sunt sisteme separate. Un merge complet de DB + auth = proiect mare, riscant, **nedelegabil autonom**.

**Soluția adoptată:** backend-ul **web e creierul canonic** pentru bani + conturi sociale + AI gestionat. Desktop-ul îl **consumă prin API**, autentificat cu un **token de platformă** pe care userul îl generează în dashboard-ul web și îl lipește în desktop (stocat în `api_key_vault`-ul care există deja). Fiecare aplicație își păstrează DB-ul propriu.

```
        ┌──────────────────────────────────────────┐
        │   CREIER CLOUD = backend web (canonic)     │
        │   credite (există) · 21 conectori (există) │
        │   R2 (există) · provider router AI (W1)    │
        │   Platform API + token auth (W2)           │
        └───────────────┬───────────────┬────────────┘
             web UI ────┘               └──── desktop (client + mușchi local)
                                              • mass-editing FFmpeg LOCAL (gratis)
                                              • product library local (D1)
                                              • consumă credite+conturi din creier (U1)
```

**Ce NU facem (acum):** nu unim DB-urile, nu unim auth-urile, nu rescriem conectorii sociali în desktop. Bridge-ul cu token e suficient pentru MVP și reversibil.

---

## 2. Guardrails globale (pentru orice sesiune Fable)

1. **Un repo per sesiune.** Nu edita cross-repo într-un singur `/goal`.
2. **Branch nou per fază** (`feat/<faza>`). Nu commite pe `main`. Nu commite/push fără cerere explicită la final.
3. **Reuse > rewrite.** Fiecare spec are o listă „refolosește asta". Coboară pe scara lenei înainte să scrii cod nou.
4. **Verificare obligatorie:** după orice modificare de UI → test Playwright + screenshot (regula din `CLAUDE.md`). Backend pe **8000** (fără `--reload`), frontend web dev pe **3001**, Electron dev pe **3947**.
5. **Standalone build necesar și în dev** pentru shell-ul Electron (gotcha cunoscut).
6. **Nu atinge (risc de stricat / date clienți):**
   - `DATA_BACKEND=supabase` pentru restul app-ului (product library local din D1 e o **excepție deliberată, izolată** — nu extinde localul în restul app-ului).
   - Auth-ul funcțional, pipeline-ul video care merge, `appId` / `APPDATA` / formatul de licență.
   - Path-ul de import feed Google Shopping (rămâne opțional, nu-l șterge).
7. **Fiecare fază livrează un check rulabil** (test sau demo self-check), nu doar cod.

---

## 3. Harta fazelor

| Fază | Repo | Ce livrează | Depinde de | Spec | Status |
|---|---|---|---|---|---|
| **D1** | desktop | Product library local (titlu+imagini+descriere) + descriere auto Gemini Vision + curățarea catalogului hardcodat | — | `@docs/plan/phase-D1-product-library.md` | ✅ **LIVRAT 2026-07-06** (`feat/d1-product-library`, 3 commits, Playwright PASSED) |
| **W1** | web | Provider router AI + integrare fal.ai (imagini + video) în sistemul de credite | — | `social-scheduler/docs/plan/phase-W1-ai-provider-router.md` | ✅ **LIVRAT 2026-07-06** (`feat/w1-ai-provider-router`, 5 commits, ai-router:check PASS) |
| **W2** | web | Platform API + token auth (balanță credite, generare AI, publicare, upload media) pentru clientul desktop | W1 | `social-scheduler/docs/plan/phase-W2-platform-api.md` | ✅ **LIVRAT 2026-07-07** (`feat/w2-platform-api` din w1; a refolosit tabelul `apiKeys` existent — zero migrații; contract în `docs/platform-api.md`; platform:check PASS) |
| **U1** | desktop | Desktop consumă creierul web: link cont via token, publicare prin API-ul web (înlocuiește Postiz), sold credite în UI | W2 | `docs/plan/phase-U1-desktop-bridge.md` | ✅ **LIVRAT 2026-07-07** (`feat/u1-desktop-bridge` din d1; migration 047 lărgește CHECK-ul din `api_key_vault` — aplicată pe cloud; Playwright + self-check live PASS) |
| **D2** | desktop | Video AI ca sursă de segmente (pe **credite platformă**, decizie 2026-07-07) + Task 0: repară cele 4 picker-e orfane de catalog | U1 + W2 | `docs/plan/phase-D2-ai-video-segments.md` | ✅ **LIVRAT 2026-07-07** (`feat/d2-ai-video-segments`, 2 commits; e2e live cu mock platform + ingest ffmpeg real; **gap descoperit: web dev n-are R2 creds → worker-ul video crapă la uploadObject — de rezolvat pe web (infra/dev-fallback)**) |
| **W3** (later) | web | TTS gestionat pe credite (necesită OEM ElevenLabs) | W1 | later | — |

**Consolidare 2026-07-07:** ambele lanțuri au trecut review de cod (2 agenți) și au fost mergeate fast-forward în `main`: desktop `main`=e70f09e (remediere+d1+u1), web `main`=58d9f1f (w1+w2 + fix de review: deducerea de credite + insert-ul jobului video într-o singură tranzacție — crash-ul între ele nu mai blochează credite).

**Follow-up-uri din review-ul D1/U1:**
- **Task 0 în D2 (obligatoriu):** 4 suprafețe UI încă cheamă `/catalog/products` și arată tăcut gol cu catalogul gated OFF: product-picker-dialog (asociere segment↔produs, `pipeline/page.tsx` ~3572) + image-picker-dialog, `create-image/page.tsx`, `pipeline-caption-generator.tsx`. Fix: migrare la `/product-library` (create-image, caption-generator) + gating cu `NEXT_PUBLIC_CATALOG_GOMAG` (asocierea).
- Asocierile segment↔produs sunt keyed pe id-uri de catalog Gomag — migrarea lor la produse locale = feature separat, încă OUT.
- Notat (pattern acceptat, nu bug): servirea imaginilor locale (product library + image-gen) e fără auth, pe UUID-uri neghicibile — de reconsiderat global dacă se schimbă postura de securitate.

**Notă pentru sesiunile web (W1/W2):** guardrails-urile adaptate repo-ului web sunt în `social-scheduler/docs/plan/PLAN-CONTEXT.md` — prompturile `/goal` de acolo îl referențiază pe acela, nu acest fișier (referințele `@` nu se rezolvă cross-repo).

**Graf de dependențe:**
```
D1 ─(independent)─────────────►
W1 ──► W2 ──► U1 ──► D2
W1 ──► W3
```
D1 și W1 pot rula în paralel (repo-uri diferite, ferestre diferite). U1 e ultimul pentru bridge.

---

## 4. Rezumate de fază (specul detaliat = fișierul referențiat)

### D1 — Product library local + curățare catalog (desktop) — PRIMA
Înlocuiește catalogul hardcodat Gomag (`v_catalog_products`/`uf.products_catalog`, risc de data leak) cu o **bibliotecă de produse locală, per-user**: adaugi titlu + imagine/imagini + descriere opțională, stocate local (SQLite în `userData`), cu **descriere auto din imagine+titlu prin Gemini Vision** (deja integrat). Se leagă în fluxul de generare ca sursă de context. Feed-import rămâne opțional. Sync cloud = fază ulterioară. **Spec:** `@docs/plan/phase-D1-product-library.md`

### W1 — Provider router AI + fal.ai (web)
Abstractizează generarea AI printr-un **router de provideri** (ca registry-ul de conectori sociali existent). Adaugă adapter **fal.ai**: imagini + video (async submit→poll→download→R2). Extinde `CREDIT_COSTS` cu video (per-secundă). UI de generare cu afișarea costului în credite. Reutilizează deducerea atomică + refund pe eșec (`lib/ai/generate.ts`) care există deja.

### W2 — Platform API pentru desktop (web)
Expune un API autentificat cu **token de platformă** (generat în dashboard, hash-uit în DB): `GET /balance`, `POST /generate` (metered), `GET /accounts` (conturi sociale), `POST /publish` (programare), `POST /media` (upload R2). Rate-limit + validare. Ăsta e contractul pe care desktop-ul îl consumă în U1.

### U1 — Desktop consumă creierul web (bridge)
Desktop: ecran de „conectează contul Blipost" unde userul lipește token-ul de platformă (stocat în `api_key_vault`, service nou `blipost_platform`). Publicarea socială din desktop apelează **API-ul web** în loc de Postiz. Opțional: feature-urile AI gestionate (fără BYOK) apelează endpoint-ul metered. BYOK rămâne disponibil ca alternativă.

---

## 5. Șablon de prompt `/goal` per fază

```
/goal <obiectiv într-o frază>.

Repo: <desktop|web>. Branch nou: feat/<faza>.
Respectă guardrails-urile din planul master. Verifică cu Playwright screenshot.
Nu depăși scope-ul din spec (secțiunea IN/OUT).

Plan master & guardrails: @docs/IMPLEMENTATION-PLAN-2026-07.md
Spec fază: @docs/plan/phase-<faza>.md
```
(Textul inline rămâne mult sub 4000 caractere; detaliile sunt în `@referințe`.)
