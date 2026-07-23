# Goal EF-4 — UX Step 4 (navigare, Retry, Stop confirm) + accesibilitate

**Working directory: `C:\OBSID SRL\n8n\edit_factory`** (Blipost desktop — Next.js frontend)

Înainte de orice schimbare UI, citește `frontend/DESIGN_SYSTEM.md` și `frontend/AGENTS.md` (contract vizual canonic). Citește și `goals/audit-2026-07-21-findings.md` secțiunile 6 și 7 — file:line exacte.

## Obiectiv

Userul nu mai rămâne blocat în Step 4 și fluxurile distructive cer confirmare; History + Source Videos devin operabile cu tastatura.

## Task-uri

1. `frontend/src/app/pipeline/components/pipeline-stepper.tsx:233` — stepperul vizibil la 1920px (Full HD). Coboară breakpoint-ul sau compactează stepperul; nu-l ascunde la lățimi desktop obișnuite (regulă existentă în CLAUDE.md pentru header/breadcrumb).
2. `frontend/src/app/pipeline/components/step4-render.tsx:241` — adaugă Back către Step 3 și buton Retry pe variantele `failed`/`cancelled` (re-folosește fluxul de render existent, nu unul nou).
3. `frontend/src/app/pipeline/components/step4-render.tsx:96` — Stop Render (global și per variantă) cere confirmare cu același pattern de dialog folosit la „Start New Pipeline".
4. Accesibilitate:
   - `pipeline-history-sidebar.tsx:109` — înlocuiește `span role=button` cu `<button>` real (sau adaugă suport Enter+Space și focus vizibil); SVG-urile click-only devin butoane etichetate.
   - `source-videos-card.tsx:140` — cardurile selectabile operabile cu tastatura; butoanele icon-only primesc `aria-label`; „Edit segments" face `stopPropagation` ca să nu schimbe selecția.

## Criterii de acceptare

- La viewport 1920×1080, stepperul e vizibil (screenshot Playwright ca dovadă).
- Variantă failed → Retry vizibil și funcțional; Step 4 are Back.
- Stop fără confirmare nu mai există.
- Test Playwright de tastatură: Tab până la un item din history sidebar + Enter/Space îl activează.
- `npm run lint` nu introduce erori noi; `design:check` trece.

## Clauze obligatorii

**A. Commit discipline.** Commit după FIECARE modificare logică — un commit per schimbare coerentă, mesaj conventional. Nu grupa totul într-un commit final, nu lăsa tree-ul dirty. NU face push.

**B. Wiki la finalizare COMPLETĂ.** Doar la final: pagina relevantă în `docs/wiki/`, intrare în `docs/wiki/01-log.md`, pagini noi în `docs/wiki/00-index.md`. Comite și wiki-ul.

**C. Return shape.** Return: (1) lista schimbărilor UX + căile screenshot-urilor, (2) commiturile (hash + subiect), (3) paginile wiki. Fără tururi, fără dump-uri.

**D. Verificare browser.** OBLIGATORIU (CLAUDE.md): screenshot Playwright pentru fiecare schimbare vizuală, la 1920×1080. Căile în return.
