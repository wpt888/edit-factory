# 49 — Audit remediation orchestration (2026-07-22)

Record al sesiunii de remediere a auditului NO-GO de producție pentru ambele
aplicații Blipost: **edit_factory** (desktop) și **social-scheduler**
(blipost.com web). Orchestrare cu model premium (Fable) ca dispatcher +
agenți Codex (`gpt-5.6-sol` pentru cod greu, `gpt-5.3-codex-spark` pentru
UX/CI) + finisheri Sonnet pentru verificare/commit/wiki.

## Punct de plecare — auditul

Verdict inițial: **NO-GO producție + billing plătit**. 5 blocante critice +
~15 probleme majore UX/funcționale + probleme de quality/CI. Findings
complete, cu file:line, salvate în:
- `goals/audit-2026-07-21-findings.md` (edit_factory)
- `../social-scheduler/goals/audit-2026-07-21-findings.md`

## Cele 9 goal-uri și maparea pe blocante

| Goal | Repo | Blocant/temă | Model |
|------|------|--------------|-------|
| EF-1 | edit_factory | CRITIC — IDOR/cross-tenant pe rutele pipeline + SSRF downloader | sol |
| EF-2 | edit_factory | CRITIC — Captions → Smart Schedule rupt e2e | sol |
| EF-3 | edit_factory | MAJOR — outputuri derivate stale + erori Step 1 + retenție | sol |
| EF-4 | edit_factory | MAJOR — UX Step 4 (nav/Retry/Stop confirm) + accesibilitate | spark |
| EF-5 | edit_factory | Quality — CI verde Ruff/ESLint | spark |
| SS-1 | social-scheduler | CRITIC — billing FAL pe output mock + verificare R2 | sol |
| SS-2 | social-scheduler | CRITIC — motor workflow: starvation, versiuni, succes-fără-output, webhooks | sol |
| SS-3 | social-scheduler | CRITIC — publicare idempotentă (postări duplicate, canale-fantomă, TikTok) | sol |
| SS-4 | social-scheduler | MAJOR — UX Clipping (polling/retry/schedule link/paginare) + domain checks CI | spark |

Prompturile de goal (cu clauzele standard commit/wiki/return) sunt în
`goals/0X-*.md` în fiecare repo.

## Rezultat — 8/9 livrate, 1 neterminat

**social-scheduler: COMPLET (4/4).**

| Goal | Commituri (main, nepush) | Wiki |
|------|--------------------------|------|
| SS-1 | `b1b022e` `4b819fb` `57535a8` `346854a` `f217fb9` `04d527b` | `security/2026-07-21-ai-mock-billing-gate-and-r2-verify.md` |
| SS-2 | `585a8d2` `a38177f` `73e82ed` `9cc96e3` `c9ee32a` `7be1cbf` | `security/2026-07-21-workflow-engine-starvation-and-hardening.md` |
| SS-3 | `f1525ec` `7940c69` `f7ab75c` `d7b9a80` `0b7d31f` `4b78c01` | `architecture/per-target-publish-pipeline.md` |
| SS-4 | `98a9a1f` `8b56333` `6fa8ad2` `00f0ca5` `4e14cae` `d8a8a80` | `architecture/clipping-live-status-and-library-picker.md` |

SS-3 a adăugat migrarea Drizzle `0049_swift_gressill.sql` (coloane
`publish_attempted_at`/`publish_attempt_id` + status `needs_review`).

**edit_factory: 5/5 livrate.**

| Goal | Commituri (main, nepush) | Wiki |
|------|--------------------------|------|
| EF-1 | `8cd60cd` `ee90f8a` `84a8201` `62ee5f7` | `44-pipeline-ownership-and-overlay-ssrf-fix.md` |
| EF-2 | `86ec08b` `75977a4` `71f0254` `27eaf86` `4d0bcbe` | `46-captions-smart-schedule-chain-fix.md` |
| EF-3 | `cdbce8f` `024cb7d` `ade008f` `3ee49ff` `1cac027` `78dee70` | `47-stale-outputs-invalidation-and-step1-retry.md` |
| EF-4 | `5ba0dc9` `e74396c` `af191cf` `e518df7` `e7389a1` | `48-step4-ux-a11y.md` |
| EF-5 | `cb12c2d` `5225e29` `1ac1454` | `01-log.md` (2026-07-22 EF-5) |

EF-5 re-rulare curată (Sonnet, fără Codex): ruff 175→0 erori (F821 reale +
E402/F401/F541/F841/E741/E731 mecanice), ESLint pipeline 48→0 erori. Root
cause al celor 48 erori ESLint: `eslint-config-next`'s `core-web-vitals`
adaugă de la eslint-plugin-react-hooks v7 4 reguli "React Compiler
readiness" (`refs`, `set-state-in-effect`, `immutability`,
`preserve-manual-memoization`) ca eroare necondiționat, chiar dacă proiectul
nu a adoptat React Compiler — flagau pattern-uri pre-compiler intenționate
(ref mirrors în timpul render-ului, setState în efecte pentru fetch).
Dezactivate în `frontend/eslint.config.mjs` la nivel de regulă (nu
`eslint-disable` per fișier — asta e exact ce a fost respins la tentativa
Codex anterioară); `rules-of-hooks`/`exhaustive-deps` rămân active.
`npm run build` + `design:check` + pytest scoped (34+63 teste) trec.

EF-3: invalidarea acoperă 15 rute de editare (nu doar cele 2 numite în goal).

## Bug-uri prinse de finisheri (peste implementarea Codex)

- **EF-1**: test-uri pre-existente apelau `get_pipeline_status` direct fără
  `ProfileContext` → `AttributeError` pe noul `Depends`. Reparat la rădăcină.
- **EF-2**: extins fixul și în `schedule_routes.py` (progress raporta
  `completed` la eșec de plan) pentru criteriul „failure vizibil".
- **EF-4**: butonul Retry apela `handleRender` greșit → ar fi re-randat TOATE
  variantele, nu doar cea failed. Corectat la `handleRemakeVariant` (flux
  single-variant existent).
- **SS-4**: revert scope-creep — Codex spark cablase un local-upload care
  importa un export existent DOAR în WIP-ul necomis → build izolat ar fi
  picat. Plus reparat mojibake UTF-8 (`·`→`Â·`, `—`→`â€"`).

## Incidente — hang-uri Codex pe căutări la rădăcină

**Cauză comună**: `rg`/`Get-Content` rulate la RĂDĂCINA edit_factory (care
conține binare ffmpeg, video, node_modules, venv) se agață la infinit.
Contorul „Elapsed" al companion-ului continuă să curgă chiar și când
procesul e mort — **verifică mtime-ul log-ului din**
`~/.claude/plugins/data/codex-codex-plugin-cc/state/<proj>/jobs/<task>.log`
**ca test real de liveness**, nu „Elapsed".

- **EF-3**: agățat ~1h40m pe `rg -n '/pipeline/'` la rădăcină după ce
  implementarea era DEJA completă. Oprit; assessor Sonnet a confirmat GO și a
  comis. Recuperat integral.
- **EF-5**: agățat ~3h pe un `Get-Content`. Implementare parțială și de
  calitate discutabilă (dezactivare eslint la nivel de fișier pentru cele 48
  de erori react-hooks — exact ce goal-ul interzicea). **NU a fost comis
  nimic.** Necesită re-rulare curată.

**Mitigare aplicată** din EF-4 încolo: guardrail explicit în brief — orice
căutare limitată la `app/`, `tests/`, `frontend/src`, niciodată la rădăcină.
EF-4 a rulat curat în 16 min.

## Rămas de făcut

1. **Push** — toate commiturile (EF + SS) sunt pe `main` local,
   **nepush** în ambele repo-uri.
2. **Reconciliere `01-log.md`** — un hunk WIP pre-existent conținea o
   ștergere a unei intrări de log EF-2; verificat la EF-5: intrarea EF-2 a
   supraviețuit (`01-log.md` linia ~150 după inserția EF-5).
3. **Verificare browser restantă** — SS-2/SS-3/SS-4 n-au putut fi verificate
   în browser (DB local `:5436` + Docker indisponibile în sesiune); de rulat
   când infra web e pornită.
4. **Rămase din audit, neabordate** (sub pragul de goal): render runner
   heartbeat/stale, retenție cleanup UI warning, TTS Step 2 race-uri,
   `format:check` (261 fișiere) + `npm audit` (3 moderate) în social-scheduler,
   ~15 avertismente ESLint reziduale pe suprafața pipeline (destructurări
   dead-code în `page.tsx`/`pipeline-schedule.tsx`, `<img>` vs
   `next/image`) — documentate ca skip în `01-log.md`.

## Note de proces

- Fiecare goal comis selectiv cu `git add -p` peste WIP-ul pre-existent
  bogat din ambele tree-uri; separarea verificată prin stash + type-check pe
  snapshot izolat (SS-2/SS-3/SS-4).
- Modificările necomise pre-existente (attention templates, subtitle
  templates, timeline snapping etc.) au rămas intacte, neincluse în niciun
  commit.
- Fantoma `task-mrv8zet2` (EF-3 mort) rămâne „running" în bookkeeping-ul
  companion — cosmetic, munca e comisă.

## Addendum — fixe de verificare post-audit (2026-07-22, aceeași zi)

O trecere de verificare pe edit_factory, separată de goal-urile EF-1…EF-5, a
găsit și reparat două probleme rămase:

1. **IDOR rezidual pe `PUT /pipeline/{pipeline_id}/scripts`** — EF-1 a
   convertit 54 de rute la `_require_owned_pipeline()`, dar ruta de update
   scripts a rămas pe `_get_pipeline_or_load()` fără verificare de
   `profile_id`, deci un profil putea suprascrie scripturile altui profil cu
   200. Corectat cu același helper; `tests/test_pipeline_idor.py` acum
   execută ruta (nu doar verifică prezența dependency-ului de auth) și
   confirmă respingerea cross-profil.
2. **PiP overlay eșuat silențios** — `assembly_service.assemble_video()`
   înghițea `OverlaySourceError` (și orice altă eroare) dintr-un
   `except Exception: logger.warning(...)`, deci render-ul raporta succes cu
   imaginea PiP absentă. Eroarea propagă acum, la fel ca
   `apply_attention_timeline()`/`mix_attention_sfx()` din același fișier.

De asemenea a fost finalizată curățarea reziduului EF-5 abandonat (menționat
la punctul „Rămas de făcut" de mai sus): sweep-ul ruff-autofix pe ~35 fișiere
`app/*.py` + ~15 `tests/*.py` a fost revertat (fișiere pur mecanice), cele 3
`eslint-disable` la nivel de fișier au fost eliminate din
`pipeline/page.tsx` / `pipeline-caption-generator.tsx` / `pipeline-schedule.tsx`,
și cele 3 dependency array modificate au fost restaurate la valorile din
HEAD. Fișierele cu hunk-uri substanțiale (attention templates RLS-scoped
repo access, attention-media upload/serve, overlay_renderer base-dir fix)
au fost lăsate neatinse.

Detalii commit-uri: vezi `01-log.md`, intrarea „Audit remediation
follow-up: pipeline scripts IDOR + PiP overlay silent failure".
