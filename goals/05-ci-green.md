# Goal EF-5 — CI verde: Ruff + ESLint

**Working directory: `C:\OBSID SRL\n8n\edit_factory`** (Blipost desktop)

⚠️ Rulează acest goal DUPĂ EF-1…EF-4 — fixurile lor rezolvă o parte din erorile Ruff (`deduplicate`, `QueryFilters`, `timedelta`).

Citește `goals/audit-2026-07-21-findings.md` secțiunea 11.

## Obiectiv

`ruff check` și ESLint pe suprafața pipeline trec curat; CI (`.github/workflows/ci.yml`) devine verde.

## Task-uri

1. **Ruff (104 probleme)**: rulează `ruff check app/ tests/`. Prioritate: numele nedefinite (F821) — sunt buguri reale, repară-le cu logică corectă, nu cu `# noqa`. Restul (importuri nefolosite, etc.) — fix mecanic. `# noqa` doar unde regula e genuin greșită pentru caz, cu justificare într-un cuvânt.
2. **ESLint pipeline** (48 erori + 27 avertismente pe `frontend/src/app/pipeline/` + componentele pipeline): repară erorile; avertismentele care sunt buguri reale (deps de hooks lipsă care cauzează stale state) se repară, cele pur stilistice se pot lăsa documentate în return.
3. Nu ataca tot `src` (185/114) în acest goal — doar suprafața pipeline. Raportează restul ca număr rămas.
4. Verifică la final că `npm run build` (frontend) și suita pytest relevantă încă trec — fixurile de lint nu au voie să schimbe comportamentul.

## Criterii de acceptare

- `ruff check app/ tests/` → 0 erori.
- ESLint pe fișierele pipeline → 0 erori.
- `npm run build` trece; pytest relevant trece; `design:check` trece.

## Clauze obligatorii

**A. Commit discipline.** Commit după FIECARE modificare logică (grupare pe categorie de fix e OK: „fix: ruff F821 in schedule_service", „chore: unused imports"). Nu un singur commit-mamut, nu tree dirty. NU face push.

**B. Wiki la finalizare COMPLETĂ.** Doar la final: intrare în `docs/wiki/01-log.md` (+ pagina relevantă dacă există una de CI/quality). Comite și wiki-ul.

**C. Return shape.** Return: (1) numărul de probleme fixate per categorie + ce a rămas în afara scope-ului, (2) commiturile (hash + subiect), (3) paginile wiki. Fără tururi, fără dump-uri.
