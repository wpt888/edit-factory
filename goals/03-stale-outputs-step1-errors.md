# Goal EF-3 — Invalidarea outputurilor derivate la editare + erori Step 1

**Working directory: `C:\OBSID SRL\n8n\edit_factory`** (Blipost desktop — FastAPI + Next.js)

## Obiectiv

(1) Orice editare de conținut invalidează renderele derivate, ca să nu se poată publica un video vechi după modificare. (2) Eșecurile din Step 1 nu mai lasă joburi blocate în `processing`.

Citește ÎNTÂI `goals/audit-2026-07-21-findings.md` secțiunile 4, 5 și 9 — file:line exacte.

## Task-uri

1. **Invalidare** (`app/api/pipeline_routes.py:4209` și rutele de editare înrudite): schimbarea scriptului, composition, attention, muzicii sau subtitles marchează renderul variantei ca stale/invalidated (nu `completed`). Găsește TOATE rutele de editare care afectează outputul — nu doar cele numite. Folosește mecanismul de fingerprint existent din preview-cache ca model; nu inventa un sistem nou dacă extinderea fingerprint-ului acoperă cazul.
2. **UI**: o variantă cu render invalidat arată clar „needs re-render" și nu oferă publish/download pe fișierul vechi.
3. **Step 1** (`app/api/pipeline_routes.py:4998`): elimină variabila nedefinită `deduplicate`; după refund, jobul se marchează `failed` cu mesaj de eroare, nu rămâne `processing`.
4. **Retenție**: la orice editare a unui pipeline, prelungește `expires_at` (history 30 zile / assembly 7 zile — vezi `app/main.py:224`, migration 016). În UI, un pipeline aproape de expirare arată un avertisment simplu.

## Criterii de acceptare

- Test pytest: edit script după render → statusul renderului nu mai e `completed`; publish pe render invalidat e respins.
- Test pytest: eșec generic de provider în Step 1 → job `failed` + refund, nu `processing` etern.
- `ruff check` curat pe funcțiile atinse (fără nume nedefinite).
- Suita pytest relevantă trece.

## Clauze obligatorii

**A. Commit discipline.** Commit după FIECARE modificare logică — un commit per schimbare coerentă, mesaj conventional. Nu grupa totul într-un commit final, nu lăsa tree-ul dirty. NU face push.

**B. Wiki la finalizare COMPLETĂ.** Doar la final: pagina relevantă în `docs/wiki/`, intrare în `docs/wiki/01-log.md`, pagini noi în `docs/wiki/00-index.md`. Comite și wiki-ul.

**C. Return shape.** Return: (1) lista rutelor de editare acoperite de invalidare + rezultatele testelor, (2) commiturile (hash + subiect), (3) paginile wiki. Fără tururi, fără dump-uri.

**D. Verificare browser.** Pentru partea de UI (badge „needs re-render", avertisment expirare): screenshot Playwright conform CLAUDE.md, calea în return.
