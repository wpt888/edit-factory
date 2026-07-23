# Goal EF-2 — Repară lanțul Captions → Smart Schedule end-to-end

**Working directory: `C:\OBSID SRL\n8n\edit_factory`** (Blipost desktop — FastAPI + Next.js)

## Obiectiv

Captions generate în pipeline ajung efectiv în postările programate prin Smart Schedule. Astăzi lanțul e rupt în 3 locuri și eșecul e silențios (raportează succes cu caption gol).

Citește ÎNTÂI `goals/audit-2026-07-21-findings.md` secțiunea 3 — file:line exacte.

## Task-uri

1. `frontend/src/components/pipeline/pipeline-caption-generator.tsx:311` — NU folosi `window.location.origin`; folosește clientul API standard (`frontend/src/lib/api.ts` — `apiPost`/`apiGet`, care cunoaște baza API). Tratează `!response.ok` ca eroare vizibilă pentru user, nu doar rejection-ul de `fetch`.
2. `frontend/src/components/pipeline/pipeline-schedule.tsx:531` — confirmarea Smart Schedule trimite caption-ul real per variantă, nu `caption_template: ""`. Dacă o variantă nu are caption, userul vede asta ÎNAINTE de confirmare, nu se trimite gol pe tăcute.
3. `app/services/schedule_service.py:494` — `QueryFilters` e nedefinit în `_execute_v2` (NameError înghițit de un except larg). Repară importul/logica și NU mai înghiți excepția: eșecul de schedule se propagă ca failure vizibil (job status / răspuns HTTP), nu succes `(1, 0)`.

## Criterii de acceptare

- Test end-to-end **hermetic** (fără Postiz real, publisher mock) care verifică: generare caption → confirmare Smart Schedule → publisher-ul mock primește caption-ul nenul al variantei corecte. Testul pică pe codul vechi, trece pe cel nou.
- 404/500 la salvarea caption-ului produce un mesaj de eroare vizibil în UI (toast/inline), nu succes fals.
- `QueryFilters`/`timedelta` și orice alt nume nedefinit din `schedule_service.py` eliminate; `ruff check app/services/schedule_service.py` curat.
- Suita pytest relevantă pentru schedule trece.

## Clauze obligatorii

**A. Commit discipline.** Commit după FIECARE modificare logică — un commit per schimbare coerentă, mesaj conventional. Nu grupa totul într-un commit final, nu lăsa tree-ul dirty. NU face push.

**B. Wiki la finalizare COMPLETĂ.** Doar la final: actualizează pagina relevantă în `docs/wiki/`, intrare în `docs/wiki/01-log.md`, pagini noi în `docs/wiki/00-index.md`. Comite și wiki-ul.

**C. Return shape.** Return: (1) confirmarea celor 3 fixuri + rezultatul testului e2e, (2) lista commiturilor (hash + subiect), (3) paginile wiki atinse. Fără tururi, fără dump-uri.

**D. Verificare browser.** Schimbarea e web-facing: verifică fluxul în browser (Playwright — screenshot conform convenției din CLAUDE.md) și include în return calea screenshot-ului sau „verified: <ce ai văzut>".
