> **STATUS: EXECUTAT 2026-07-18** (dispecerat din fereastra social-scheduler; agent Sonnet). Commituri locale eef2604..0743dcc pe main edit_factory, NEPUSHUITE. Toate taskurile acoperite (step4 = varianta „comentariu deliberat"); bonus: a livrat și S2 taskurile 1 (PageHeader pe 14 pagini) + 4 (CardTitle font-heading). Wiki: docs/wiki/28-pipeline-toolbar-heading-fixes.md.

Repară bugurile vizuale din ecranul Multi-Variant Pipeline (BlipStudio web UI, repo edit_factory, `frontend/src/`). DOAR design/layout — zero schimbări funcționale.

## Taskuri

1. **Stepper fără suprapunere** — `app/pipeline/components/pipeline-stepper.tsx:149`: stepper-ul e centrat cu `absolute left-1/2` + lățimi fixe pe breakpoints, iar la ~1100–1300px butoanele din dreapta (`z-10`) se suprapun peste pasul 4 (bug confirmat). Rescrie toolbar-ul ca flex pe 3 zone: context (min-w-0, truncate) | stepper (flex-1, justify-center, min-w-0) | acțiuni (shrink-0). Fără poziționare absolută; la lățimi unde stepper-ul nu încape, păstrează comportamentul de ascundere responsive existent.
2. **„Back to Scripts" o singură dată** — rămâne doar butonul ghost din toolbar; șterge dublura outline de lângă titlul din `step3-preview.tsx`.
3. **Cusătura negru/gri de sub toolbar** (bug-ul din screenshot-ul userului): în cele 7 situri unde Card-urile primesc `rounded-none border-0 shadow-none` pentru modul workspace (`step1-script.tsx:172`, `step2-tts.tsx:334`, `step3-preview.tsx:279/372/559`, `source-videos-card.tsx:52`, `pipeline-history-sidebar.tsx:89`) adaugă în aceeași ramură și `bg-background` (panourile rămân pe fundalul paginii, nu pe bg-card mai deschis). Extrage clasa comună într-o constantă/util `workspaceFlushCard` folosită de toate cele 7, ca să nu mai divergă.
4. **Un singur limbaj de toolbar în pipeline**: sub-headerul sticky din step2 (`step2-tts.tsx:598`, h-14 bg-card) și cel din step3 (`step3-preview.tsx:543`, h-10 bg-background) trec pe exact tratamentul stepper-ului: `h-14 border-b bg-background/95 backdrop-blur`.
5. **Titluri fără contoare vii**: `step3-preview.tsx:253` „Preview & Select Variants ({n} previews shown)" → `<h2 className="font-heading text-2xl font-semibold">Preview & Select Variants</h2>` + linie separată `<p className="text-sm text-muted-foreground">{n} previews shown</p>`. Caută în pipeline alte titluri cu numărători în text și aplică același pattern (titlu static + meta muted).
6. **Step 4**: adu Card-urile din `step4-render.tsx` pe același tratament workspace-flush ca pașii 1–3, sau lasă-le deliberat diferite cu un comentariu scurt care spune de ce.

## Constrângeri
- NU pushui (push = auto-deploy); commit-uri locale pe pași logici, mesaje conventional commits.
- Nu atinge deciziile aprobate: lime ca primary, dark default, radius Electron 0.375, fonturile de subtitrări.
- UI doar în engleză, fără diacritice în stringuri.
- Nu rula în paralel cu alt goal pe acest repo.

## Verificare
Screenshot headless (Chrome `--headless --virtual-time-budget`) pe /pipeline step 3 la 1152px și 1440px: fără suprapunere stepper/acțiuni, fără bandă negru/gri sub toolbar, un singur „Back to Scripts". Rulează build + check-urile repo-ului; totul verde înainte de commit final.

Context complet (findinguri cu file:line): @goals/design-audit-2026-07-17-findings.txt — secțiunile `surfaces-studio` și `shell-navigation`. Raport: @goals/design-audit-2026-07-17.md
