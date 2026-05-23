---
phase: 89-marketing-app-scaffolding
plan: "01"
subsystem: infra
tags: [nextjs-16, react-19, tailwind-4, shadcn, supabase-ssr, playwright, app-router, marketing]

requires:
  - phase: 88-installer-slimming
    provides: stable v13 baseline for greenfield scaffold
provides:
  - "marketing/ Next.js 16 App Router scaffold (port 3001, dual Supabase clients, Shadcn primitives)"
  - "Playwright smoke harness with screenshot proof per CLAUDE.md MANDATORY rule"
  - "Dual env-var pattern (MARKETING_SUPABASE_* server + NEXT_PUBLIC_MARKETING_SUPABASE_* browser) ready for Phase 91 consumption"
  - "Shadcn primitive copies (Button + Card) byte-identical from frontend/ — visual consistency with desktop"
affects: [90-landing-page, 91-lemon-squeezy-checkout, 92-account-dashboard, 93-oauth-endpoints, 96-vercel-deploy]

tech-stack:
  added:
    - "next@^16.1.1"
    - "react@19.2.1 + react-dom@19.2.1"
    - "tailwindcss@^4 + @tailwindcss/postcss@^4 + tw-animate-css@^1.4.0"
    - "@supabase/ssr@^0.8.0 + @supabase/supabase-js@^2.89.0"
    - "@radix-ui/react-slot@^1.2.4 + class-variance-authority@^0.7.1"
    - "clsx@^2.1.1 + tailwind-merge@^3.4.0"
    - "sonner@^2.0.7 + lucide-react@^0.556.0"
    - "@playwright/test@^1.57.0 + chromium browser"
    - "eslint@^9 + eslint-config-next@^16.1.1"
    - "typescript@^5"
  patterns:
    - "Dual Supabase factory pattern: getMarketingSupabase() (server, service-role, throw-on-missing-env) + getMarketingBrowserClient() (browser, anon, NEXT_PUBLIC_ prefix)"
    - "Port-via-CLI-flag (D-06): `next dev --port 3001` in scripts.dev — single source of truth, not env var"
    - "Shadcn primitives copied byte-for-byte from frontend/ — no shared workspace package (drift accepted per SCOPE.md)"
    - "App Router with no src/ directory — tsconfig paths `@/*` -> `./*` (D-08)"
    - "Server-rendered placeholder home (no 'use client' — D-09)"
    - "Playwright webServer self-management with env-var port override fallback"

key-files:
  created:
    - "marketing/package.json"
    - "marketing/tsconfig.json"
    - "marketing/next.config.ts"
    - "marketing/postcss.config.mjs"
    - "marketing/eslint.config.mjs"
    - "marketing/next-env.d.ts"
    - "marketing/.env.example"
    - "marketing/.gitignore (Rule 2 addition — +1 vs plan's 16)"
    - "marketing/app/layout.tsx"
    - "marketing/app/page.tsx"
    - "marketing/app/globals.css"
    - "marketing/lib/utils.ts"
    - "marketing/lib/supabase.ts"
    - "marketing/components/ui/button.tsx"
    - "marketing/components/ui/card.tsx"
    - "marketing/playwright.config.ts"
    - "marketing/tests/scaffold-smoke.spec.ts"
  modified: []

key-decisions:
  - "D-01 honored: Next.js 16.1.1 (NOT 15 as requirement-text reads — version-bump documented + locked)"
  - "D-04 honored: copy Shadcn Button + Card from frontend/ — NOT package dependency (drift accepted)"
  - "D-05 honored: dual env-var pattern (MARKETING_SUPABASE_* server + NEXT_PUBLIC_MARKETING_SUPABASE_* browser)"
  - "D-06 honored: port 3001 via `next dev --port 3001` CLI flag — NOT env var (single source of truth)"
  - "D-09 honored: server-rendered placeholder (no 'use client' directive in page.tsx — grep count = 0)"
  - "D-12 honored: missing env vars throw clear Error with var name — no silent undefined"
  - "Rule 3 deviation: playwright.config.ts parametrized to accept PLAYWRIGHT_PORT env override (port 3001 collision workaround for autonomous loop — locked defaults still pass all grep ACs)"
  - "Rule 2 deviation: added marketing/.gitignore with *.tsbuildinfo + test-results/ + playwright-report/ (TS cache + per-run artifacts should never be committed)"

patterns-established:
  - "Dual Supabase client factories with throw-on-missing-env: pattern for Phase 91-93 inheritance"
  - "Playwright webServer with env-var port override: pattern for autonomous test environments where canonical port is occupied"
  - "Shadcn primitive copying with @/lib/utils import: marketing/components/ui/ matches frontend/src/components/ui/ semantics under @/* alias"

requirements-completed: [MARK-01, MARK-06]

duration: "~25min execution + planning offline"
completed: "2026-05-23"
---

# Phase 89 Plan 01: Marketing App Scaffolding Summary

**Greenfield Next.js 16 App Router scaffold at `marketing/` (port 3001) with dual Supabase clients, copied Shadcn Button+Card primitives, and Playwright smoke test producing the CLAUDE.md MANDATORY screenshot — closes MARK-01 + MARK-06.**

## Performance

- **Duration:** ~25 minutes (npm install 42s + execution + 1 deviation cycle + verification)
- **Started:** 2026-05-23T15:25Z (approximate)
- **Completed:** 2026-05-23T15:50Z (approximate)
- **Tasks:** 5/5 completed
- **Files created:** 17 (16 planned + 1 deviation: marketing/.gitignore)
- **Files modified:** 0 outside marketing/
- **Commits:** 5 task commits + this metadata commit (6 total)

## Accomplishments

- **Independent Next.js 16 + Tailwind 4 + React 19.2.1 app** scaffolded at `marketing/`, completely isolated from existing `frontend/` (zero shared code, zero shared dependencies — fresh node_modules)
- **Server-rendered placeholder home page** verified rendering correctly on port 3001 with literal `Edit Factory` + `Coming soon` text strings, dark-theme OKLCH design tokens applied, Card layout rendered (screenshot proof at 24270 bytes)
- **Dual Supabase client factory** wired with throw-on-missing-env error surfacing: `getMarketingSupabase()` (service-role server) + `getMarketingBrowserClient()` (anon browser), ready for Phase 91 Lemon Squeezy webhook + Phase 92 account dashboard consumption
- **Shadcn primitives copied byte-identical** (verified via `diff --strip-trailing-cr`) from `frontend/src/components/ui/button.tsx` and `card.tsx` — visual consistency with desktop app preserved
- **Playwright smoke test** with self-managed dev server passes (1.3s) producing mandatory screenshot artifact per CLAUDE.md visual-testing rule
- **TypeScript strict mode clean** across entire marketing/ TS graph (`tsc --noEmit` exit 0)
- **ESLint clean** (0 errors, 5 warnings — all in intentional Supabase cookie no-op stubs that Phase 92 wires)
- **Zero files modified outside `marketing/`** — `git diff --name-only HEAD~5..HEAD | grep -v "^marketing/" | wc -l` returns 0
- **15 locked decisions (D-01..D-15) all honored** — see decision traceability table below

## Task Commits

Each task committed atomically with `--no-verify` (parallel worktree mode):

1. **Task 1: Create marketing/ root config files + npm install** — `8bb070f` (feat)
   - 7 files (6 configs + package-lock.json from npm install)
   - 453 packages installed in 42s

2. **Task 2: Create App Router shell + globals.css + lib/utils.ts** — `5fa5b90` (feat)
   - 4 files (layout.tsx + page.tsx + globals.css + utils.ts)
   - 248 insertions

3. **Task 3: Copy Shadcn primitives (Button + Card)** — `71e7c13` (feat)
   - 2 files (button.tsx + card.tsx, byte-identical via diff --strip-trailing-cr)
   - 152 insertions, `tsc --noEmit` clean

4. **Task 4: Create Supabase client wiring + .env.example** — `e83b96d` (feat)
   - 2 files (supabase.ts dual factories + .env.example)
   - 123 insertions

5. **Task 5: Playwright smoke test + screenshot** — `075653f` (test)
   - 4 files (playwright.config.ts + scaffold-smoke.spec.ts + .gitignore + next-env.d.ts modified by Next.js)
   - 73 insertions
   - Test result: 1 passed (1.3s), screenshot 24270 bytes

## Decision Traceability (D-01..D-15)

| Decision | Honored in | Evidence |
|----------|-----------|----------|
| D-01 Next.js 16.1.1 (not 15) | Task 1 | `grep -q '"next": "^16.1.1"' marketing/package.json` |
| D-02 React 19.2.1 exact pin | Task 1 | `grep -q '"react": "19.2.1"' marketing/package.json` |
| D-03 Tailwind v4 + OKLCH tokens | Task 1 + Task 2 | `tailwindcss@^4`, `@import "tailwindcss"`, `@theme inline` in globals.css (185 lines) |
| D-04 Copy Shadcn Button + Card (not depend) | Task 3 | byte-identical diff with `--strip-trailing-cr`; only Button + Card (ls marketing/components/ui/ = 2) |
| D-05 Dual env-var pattern | Task 4 | server: MARKETING_SUPABASE_URL/KEY; browser: NEXT_PUBLIC_MARKETING_SUPABASE_URL/ANON_KEY |
| D-06 Port 3001 via CLI flag | Task 1 | `"dev": "next dev --port 3001"` in package.json (NOT env var) |
| D-07 TypeScript strict | Task 1 | `"strict": true` in tsconfig.json; `tsc --noEmit` clean |
| D-08 App Router, no src/ dir | Task 1 + Task 2 | `paths: { "@/*": ["./*"] }`; marketing/app/ at root |
| D-09 Server-rendered placeholder | Task 2 | `grep -c "'use client'" marketing/app/page.tsx` = 0 |
| D-10 .env.example with future-phase placeholders | Task 4 | MARKETING_SUPABASE_*, LEMON_SQUEEZY_*, RESEND_*, OAUTH_JWT_SIGNING_KEY |
| D-11 Playwright + MANDATORY screenshot | Task 5 | screenshot 24270 bytes at `marketing/screenshots/phase-89-scaffold.png` |
| D-12 Throw on missing env (not silent) | Task 4 | 4× `throw new Error("MARKETING_SUPABASE_* is not set...")` in supabase.ts |
| D-13 No Vercel deploy in 89 | (excluded by scope) | No Vercel config touched; deferred to Phase 96 |
| D-14 No auth UI in 89 | (excluded by scope) | Browser client EXPORTED but not consumed by any component yet |
| D-15 Manual follow-ups documented | this SUMMARY | See "Manual Follow-Ups" section below |

## Acceptance-Criteria Evidence

### Task 1 (Config + npm install)
- All 6 config files present + node_modules populated: PASS
- Next.js, @supabase/ssr, sonner, @radix-ui/react-slot installed: PASS
- Port lock + Next 16.1.1 + React 19.2.1 + Tailwind 4 + strict TS + paths alias: all PASS

### Task 2 (App Router shell)
- All 4 files present: PASS
- "Edit Factory" + "Coming soon" literals in page.tsx: PASS
- `grep -c "'use client'" page.tsx` = 0 (server-rendered per D-09): PASS
- Sonner Toaster wired in layout: PASS
- globals.css 185 lines (>= 180 threshold, full design-token block): PASS
- `twMerge(clsx(inputs))` in utils.ts: PASS

### Task 3 (Shadcn copies)
- Both files present: PASS
- `diff --strip-trailing-cr frontend/src/components/ui/{button,card}.tsx marketing/components/ui/` returns empty: PASS (byte-identical per Windows line-ending guidance)
- `npx tsc --noEmit` exit 0 across full marketing/ tree: PASS
- `ls marketing/components/ui/ | wc -l` = 2 (only Button + Card per D-04): PASS

### Task 4 (Supabase + .env.example)
- All 15 grep ACs PASS (see Task 4 verification output above):
  - getMarketingSupabase exported, getMarketingBrowserClient exported
  - process.env.MARKETING_SUPABASE_URL + KEY referenced
  - process.env.NEXT_PUBLIC_MARKETING_SUPABASE_URL + ANON_KEY referenced
  - createServerClient + createBrowserClient imported from @supabase/ssr
  - throw new Error pattern (D-12)
  - NEXT_PUBLIC_SUPABASE_URL (existing app's) grep-absent (MARK-06 boundary)
  - .env.example: MARKETING_SUPABASE_URL= empty placeholder + LEMON_SQUEEZY + OAUTH_JWT_SIGNING_KEY
- `npx tsc --noEmit` exit 0: PASS

### Task 5 (Playwright smoke)
- Config + test files present: PASS
- `http://localhost:3001` + `webServer` + `reuseExistingServer` strings present in config: PASS
- HTTP 200 assertion + Edit Factory + Coming soon + phase-89-scaffold.png strings in spec: PASS
- `npx playwright test` exit 0 (with PLAYWRIGHT_PORT=3099 CI=1 override): PASS — 1 passed in 1.3s
- `marketing/screenshots/phase-89-scaffold.png` exists, 24270 bytes (> 1000 byte threshold): PASS
- Screenshot is gitignored via root `.gitignore` line 114 (`screenshots/`): PASS

## End-to-End Verification Gates

| Gate | Check | Result |
|------|-------|--------|
| 1 | All 16 planned files exist under marketing/ | PASS (ls returned 16) |
| 2 | `cd marketing && npx tsc --noEmit` exit 0 | PASS |
| 3 | `cd marketing && npx eslint .` (errors only) | PASS (0 errors, 5 warnings in cookie stubs) |
| 4 | `cd marketing && npx playwright test` exit 0 + screenshot exists | PASS |
| 5 | `grep -q '"dev": "next dev --port 3001"' marketing/package.json` | PASS |
| 6 | MARK-06 env vars present in supabase.ts | PASS |
| 7 | Zero `NEXT_PUBLIC_SUPABASE_URL` (existing-app name) in marketing/ | PASS (0 matches outside node_modules) |
| 8 | No files outside marketing/ modified | PASS (`git diff --name-only HEAD~5..HEAD \| grep -v "^marketing/" \| wc -l` = 0) |
| 9 | D-01..D-15 traceability table complete | PASS (see table above) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Port 3001 occupied by unrelated process during smoke test**
- **Found during:** Task 5 (Playwright smoke test, first run)
- **Issue:** `node.exe` PID 7912 (an unrelated NRT Fleet dev server in Romanian — confirmed via `netstat -ano | grep :3001` + Playwright error-context showing Romanian delivery-service HTML) was bound to `0.0.0.0:3001` on the development host. With Playwright's default `reuseExistingServer: !process.env.CI` (true in local mode), the test runner reused that wrong server, navigated to it, and naturally found no `Edit Factory` text — test failed.
- **Fix:** Parametrized `marketing/playwright.config.ts` to accept `PLAYWRIGHT_PORT` + `PLAYWRIGHT_BASE_URL` env-var overrides. Defaults remain `3001` so all three locked grep ACs (`"http://localhost:3001"`, `webServer`, `reuseExistingServer`) still pass. `marketing/package.json scripts.dev` UNCHANGED (D-06 `"next dev --port 3001"` remains the single source of truth for human-driven dev runs).
- **Verification:** Re-ran test with `PLAYWRIGHT_PORT=3099 PLAYWRIGHT_BASE_URL=http://localhost:3099 CI=1 npx playwright test --reporter=list` → 1 passed (1.3s); screenshot proof at marketing/screenshots/phase-89-scaffold.png shows correct Edit Factory + Coming soon Card.
- **Deviates from T-89-02 accept-disposition:** plan accepted port collision with "Documented manual recovery: stop the colliding process". Autonomous loop CANNOT perform that manual recovery — killing PID 7912 would destroy unknown user work on an unrelated project (NRT Fleet). The autonomous-friendly env-var override is the minimum necessary deviation to produce the CLAUDE.md MANDATORY screenshot artifact while preserving every locked decision intact.
- **Files modified:** `marketing/playwright.config.ts`
- **Commit:** `075653f` (Task 5)

**2. [Rule 2 - Missing Critical] Added `marketing/.gitignore` for TS incremental cache + Playwright artifacts**
- **Found during:** Post-Task-5 git status check
- **Issue:** `npx tsc --noEmit` generates `marketing/tsconfig.tsbuildinfo` (TS incremental compile cache). `npx playwright test` generates `marketing/test-results/` + `marketing/playwright-report/` (per-run artifacts). None are covered by root `.gitignore`. Plan asserted "no .gitignore changes needed" but didn't anticipate these generated artifacts.
- **Fix:** Created `marketing/.gitignore` with three patterns: `*.tsbuildinfo`, `test-results/`, `playwright-report/`. Pattern precedent exists in `frontend/.gitignore` (`*.tsbuildinfo`).
- **Verification:** `git status --short` after the addition shows no untracked generated artifacts.
- **Scope impact:** +1 file vs plan's 16 (now 17 total in marketing/). All other plan items unaffected.
- **Files modified:** `marketing/.gitignore` (created)
- **Commit:** `075653f` (folded into Task 5 commit since same root cause: test-execution artifacts)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 blocking, 1 Rule 2 missing-critical)
**Impact on plan:** Both deviations preserve every locked decision (D-01..D-15). The port override defaults to 3001 so all grep ACs pass; the .gitignore addition prevents pollution of git status without altering any plan-locked file. No scope creep beyond the +1 marketing/.gitignore.

## Issues Encountered

- **Windows line endings on `diff` AC**: planner-flagged INFO-3 ("diff AC line-ending sensitivity on Windows"). Resolved as predicted by using `diff --strip-trailing-cr` — byte-identical match confirmed for both Button and Card. No deviation, just an executor-side adaptation.
- **`next-env.d.ts` auto-extension by Next.js dev server**: After first dev-server startup, Next.js 16 auto-added `import "./.next/dev/types/routes.d.ts";` to `next-env.d.ts`. Per Next.js convention this is expected behavior. Committed as part of Task 5.
- **Turbopack workspace-root warning**: dev server logged a warning about multiple lockfiles (root + marketing/) detecting `package-lock.json` at repo root and picking the wrong workspace root. Non-blocking (test still passed). Future enhancement: set `turbopack.root` in `next.config.ts` to explicitly anchor marketing/ as its own root. Deferred — not a Phase 89 blocker.

## Manual Follow-Ups (NOT autonomous-loop blockers — per D-15)

These are required before Phase 91 (Lemon Squeezy webhook handler) starts consuming the Supabase client:

1. **Provision separate Supabase project for marketing/** via Supabase Web UI (cannot be automated — Supabase Web UI navigation requires human). Create new project distinct from the existing `editai_*` schema (MARK-06 zero-shared-users constraint).

2. **Wire 4 env vars into `marketing/.env.local`** (gitignored via root `.gitignore` line 4 `.env.local`):
   - `MARKETING_SUPABASE_URL` (project URL)
   - `MARKETING_SUPABASE_KEY` (service-role key — server-only)
   - `NEXT_PUBLIC_MARKETING_SUPABASE_URL` (same URL as above, browser-safe)
   - `NEXT_PUBLIC_MARKETING_SUPABASE_ANON_KEY` (anon key from Supabase dashboard)

3. **Add marketing/ to Vercel project** (Phase 96 territory — deferred).

4. **Carry forward from prior phases** (NOT new):
   - Phase 85: "Desktop SQLite-mode smoke harness" required status check on `main`
   - Phase 88: "Windows NSIS installer <= 550 MB" required status check on `main` (recommend batching with #4a)
   - Phase 81/82/83/86: verifications batchable
   - Phase 86 CR-01 tarslip: Phase 86.1 gap-closure candidate
   - Phase 87 IN-01..IN-03: foldable into Phase 95

## Version-Bump Justification (Next.js 16.1.1 vs MARK-01 requirement-text "Next.js 15")

The MARK-01 requirement text in `.planning/milestones/v13-REQUIREMENTS.md` (written 2026-05-22) literally specifies "Next.js 15". This plan ships Next.js 16.1.1 per locked decision D-01. Rationale:

- **SCOPE.md §C1 intent**: "matching the desktop's design system" — existing `frontend/` already validated Next.js 16.1.1 + React 19.2.1 + Tailwind 4 + 17 Radix primitives + Supabase SSR in production
- **ARCHITECTURE.md §6**: "matches existing repo conventions"
- **Risk profile**: Phase 89 is a greenfield scaffold; staying on a major version behind the existing app would introduce immediate drift cost and accumulate technical debt before the first landing page (Phase 90) ships
- **No new risk**: The 16.x stack is already production-validated on this repo

**Verifier/audit action**: treat the version bump as a LOCKED DECISION (D-01), NOT a deviation from MARK-01's literal text. SUMMARY documents the rationale; STATE.md decision log records D-01 as honored. MARK-01 satisfaction is bound to "Next.js + Tailwind + Shadcn scaffold runs on port 3001 with placeholder home page" — the major-version constant is implementation detail.

## MARK-01 + MARK-06 Closure

**MARK-01** ("Next.js 15 [bumped to 16.1.1 per D-01] + Tailwind + Shadcn scaffold for `marketing/` exists; `npm run dev` runs on port 3001 with placeholder home page"):

- ✅ Scaffold exists: 17 files under `marketing/`, package.json + node_modules populated
- ✅ `npm run dev` runs on port 3001: locked at `scripts.dev = "next dev --port 3001"` (D-06)
- ✅ Placeholder home page renders: Playwright smoke test passes; screenshot proof at 24270 bytes shows "Edit Factory — Production-Ready Video Tools" + "Coming soon: full landing page in Phase 90"

**MARK-06** ("Supabase client in `marketing/lib/supabase.ts` uses env vars `MARKETING_SUPABASE_URL` and `MARKETING_SUPABASE_KEY` — distinct from existing app; zero shared users"):

- ✅ supabase.ts present with `getMarketingSupabase()` reading exactly `MARKETING_SUPABASE_URL` + `MARKETING_SUPABASE_KEY`
- ✅ Zero leakage of existing-app `NEXT_PUBLIC_SUPABASE_URL` env-var name into marketing/ (grep = 0 matches outside node_modules)
- ✅ Dual env-var pattern supports future Phase 92 browser-side consumption without re-architecture
- ⚠️ Live Supabase project provisioning is a documented manual follow-up (D-12 — autonomous loop cannot navigate Supabase Web UI). Missing-env behavior is the chosen fail-mode: `getMarketingSupabase()` throws a clear Error naming the missing var, NOT silent undefined.

**Post-execution requirement-flipping** (orchestrator/verifier responsibility — out of scope for executor):
- `[ ] MARK-01` → `[x]` in `.planning/milestones/v13-REQUIREMENTS.md` line ~29
- `[ ] MARK-06` → `[x]` in `.planning/milestones/v13-REQUIREMENTS.md` line ~34

## Next Phase Readiness

**Ready for Phase 90 (landing page):**
- App Router shell + globals.css + Shadcn Button + Card primitives in place
- Tailwind v4 design tokens (OKLCH) match desktop frontend
- Add more Shadcn primitives as Phase 90 needs them (Input, Label, etc. — copy pattern established)

**Ready for Phase 91 (Lemon Squeezy checkout + webhook) — pending manual follow-up:**
- `getMarketingSupabase()` server client wired and ready
- `.env.example` documents LEMON_SQUEEZY_API_KEY / LEMON_SQUEEZY_WEBHOOK_SECRET / LEMON_SQUEEZY_STORE_ID / LEMON_SQUEEZY_VARIANT_* + RESEND_API_KEY placeholders
- Phase 91 will add Route Handlers (`marketing/app/api/lemon-squeezy/webhook/route.ts`) consuming `getMarketingSupabase()`
- **Blocker**: manual provisioning of separate Supabase project + writing real values into `marketing/.env.local`

**Ready for Phase 92 (account dashboard) — pending Phase 91:**
- `getMarketingBrowserClient()` browser client wired and ready (anon key path)
- Cookie callbacks are scaffold-mode no-ops; Phase 92 will extend with `next/headers cookies()` integration

**Ready for Phase 93 (OAuth endpoints) — pending Phase 92:**
- `.env.example` documents `OAUTH_JWT_SIGNING_KEY` placeholder + generation command (`openssl rand -base64 64`)

## Self-Check: PASSED

Verified after writing this SUMMARY:
- All 17 marketing/ files exist on disk
- All 5 task commits + this metadata commit present in git log
- Screenshot 24270 bytes at marketing/screenshots/phase-89-scaffold.png
- `git diff --name-only HEAD~5..HEAD | grep -v "^marketing/"` returns empty
- All locked decisions D-01..D-15 traced to evidence

---
*Phase: 89-marketing-app-scaffolding*
*Completed: 2026-05-23*
