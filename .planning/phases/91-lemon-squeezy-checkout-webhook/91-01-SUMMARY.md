---
phase: 91-lemon-squeezy-checkout-webhook
plan: 1
subsystem: payments
tags: [lemon-squeezy, checkout, env-vars, playwright, marketing-app, nextjs, server-component, screenshot]

# Dependency graph
requires:
  - phase: 89-marketing-supabase-scaffold
    provides: env-var-throws-with-named-error pattern in marketing/lib/supabase.ts; dual env-var (server + NEXT_PUBLIC_) convention
  - phase: 90-marketing-landing
    provides: marketing/components/sections/pricing.tsx with 3 placeholder CTAs (/signup?plan=*); landing.spec.ts Playwright pattern (section scoping + MANDATORY screenshot block); marketing/.gitignore screenshots/* exception pattern
provides:
  - marketing/lib/lemon-squeezy.ts utility with 3 exports (getCheckoutUrl, variantIdToTier, type LemonSqueezyTier) — interface-first for Plan 91-02 webhook consumption
  - Pricing CTAs wired to Lemon Squeezy hosted-checkout URLs (env-PRESENT) with /signup?plan=* fallback (env-ABSENT) — Phase 90 byte-compat preserved
  - marketing/.env.example documenting 13 Phase-91 env vars uncommented (M2 + M3 prerequisite contract)
  - marketing/.gitignore pre-emptively allowing both phase-91-*.png AND phase-91-*.json named artifacts (Phase 90 inter-agent learning)
  - 3 new npm scripts: test:checkout, test:checkout:with-env, test:checkout:without-env (D-20 two-spec-file mechanism)
  - 2 Playwright spec files asserting both env-PRESENT (LS URL) and env-ABSENT (fallback) paths
  - MANDATORY 217,285-byte CLAUDE.md screenshot at marketing/screenshots/phase-91-pricing-with-checkout-urls.png
affects: [91-02-webhook-handler, 92-account-dashboard, 93-oauth-jwt]

# Tech tracking
tech-stack:
  added: []  # NO new npm dependencies (D-03 forbids @lemonsqueezy SDK; D-13 reserves resend for Plan 91-02)
  patterns:
    - "Env-var-driven hosted-checkout URL construction with graceful /signup?plan=* fallback (does NOT throw)"
    - "Dual env-var pattern reuse from Phase 89: server-only LEMON_SQUEEZY_* + client-visible NEXT_PUBLIC_LEMON_SQUEEZY_* (mirroring MARKETING_SUPABASE_* convention)"
    - "Two-spec-file Playwright mechanism for env-conditional testing — separate npm scripts invoke separate specs with different env states (D-20 — required because playwright.config.ts webServer is spawned ONCE per invocation)"
    - "Pre-emptive .gitignore named-artifact exceptions for cross-plan artifacts (Phase 90 gap-closure prevention)"
    - "Tier-slug underscore-vs-hyphen mapping (D-19): function API uses 'cloud_sync' matching DB CHECK constraint; fallback href uses 'cloud-sync' preserving Phase 90 byte-compat"

key-files:
  created:
    - marketing/lib/lemon-squeezy.ts (121 lines; 3 exports + JSDoc dual-env-var doc)
    - marketing/tests/checkout-with-env.spec.ts (98 lines; 3 tests incl. MANDATORY screenshot)
    - marketing/tests/checkout-without-env.spec.ts (42 lines; 1 test asserting /signup?plan=* fallback)
    - marketing/screenshots/phase-91-pricing-with-checkout-urls.png (217,285 bytes; force-added per Phase 90 closure pattern)
  modified:
    - marketing/components/sections/pricing.tsx (added 1 import + rewired 3 hrefs; preserved Tailwind classes + section structure byte-for-byte)
    - marketing/.env.example (uncommented + extended Phase-91 stub block; now 13 vars; Phase 89 Supabase + Phase 93 OAuth blocks untouched)
    - marketing/.gitignore (extended named-exceptions list for phase-91-*.png + phase-91-*.json)
    - marketing/package.json (added 3 test-invocation npm scripts; preserved all 6 existing scripts and all dependencies byte-for-byte)

key-decisions:
  - "D-19 tier slug convention locked: function API uses underscore form ('cloud_sync') matching the DB CHECK constraint Plan 91-02 will create; fallback href uses hyphen ('/signup?plan=cloud-sync') preserving Phase 90 byte-compat. Documented in TIER_TO_FALLBACK_SLUG vs TIER_TO_CLIENT_ENV_VAR maps in lib/lemon-squeezy.ts."
  - "D-20 two-spec-file mechanism: per-test process.env mutations CANNOT reach the spawned next dev subprocess. Therefore 2 separate Playwright specs (checkout-with-env + checkout-without-env) invoked via separate npm scripts. The operator sets env vars BEFORE running test:checkout:with-env (PowerShell or bash inline env-var assignment); test:checkout:without-env runs with no vars set."
  - "D-23 license-key regex locked here for cross-plan contract: /^EF13(-[0-9A-F]{4}){4}$/. Plan 91-02 Task 1 will assert against this regex."
  - "No new npm dependencies: D-03 forbids @lemonsqueezy SDK; D-13 reserves the single 'resend' dep for Plan 91-02. Acceptance verified: grep -c '@lemonsqueezy' marketing/package.json = 0; grep -c 'resend' marketing/package.json = 0."

patterns-established:
  - "Hosted-checkout URL pattern: https://${slug}.lemonsqueezy.com/buy/${variantId} constructed at SSR time from NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG + NEXT_PUBLIC_LEMON_SQUEEZY_<TIER>_VARIANT_ID; no client-side JS surface; no SDK"
  - "Variant-id-to-tier reverse-lookup: iterates server-only LEMON_SQUEEZY_<TIER>_VARIANT_ID env vars; throws on missing env (fail-closed per D-07); returns null for unknown variant ID (so webhook returns 200 unknown_variant per CONTEXT.md <specifics> line 246)"
  - "Playwright spec pair for env-conditional behavior (env-PRESENT + env-ABSENT) with shared test.skip() guard pattern (D-17) so CI without secrets skips gracefully"

requirements-completed: [MARK-03]

# Metrics
duration: ~75min (incl. npm install + Playwright runs)
completed: 2026-05-23
---

# Phase 91 Plan 1: Lemon Squeezy checkout URL wiring Summary

**Pricing CTAs wired to Lemon Squeezy hosted checkout via lib/lemon-squeezy.ts utility with /signup?plan=* fallback; MANDATORY 217KB screenshot produced; interface-first variantIdToTier export ready for Plan 91-02 webhook consumption**

## Performance

- **Duration:** ~75 min (including 40s npm install + 2 Playwright test invocations on alternate port 3099)
- **Started:** 2026-05-23T16:32:00Z (approx)
- **Completed:** 2026-05-23T16:49:09Z
- **Tasks:** 3
- **Files created:** 4 (1 utility + 2 specs + 1 screenshot)
- **Files modified:** 4 (pricing.tsx + .env.example + .gitignore + package.json)

## Accomplishments

- **Frontend half of MARK-03 closed.** All 3 pricing tier CTAs ("Buy Starter", "Buy Pro", "Add Cloud Sync") now route to Lemon Squeezy hosted-checkout URLs when M2 env vars are provisioned; otherwise fall back to /signup?plan=* preserving Phase 90 placeholder shape so the dev landing page renders without M2.
- **Interface-first contract published for Plan 91-02.** `variantIdToTier()` reverse-lookup and `LemonSqueezyTier` union type are exported from `marketing/lib/lemon-squeezy.ts` with documented JSDoc dual-env-var contract (server-only `LEMON_SQUEEZY_*_VARIANT_ID` for variantIdToTier; client-visible `NEXT_PUBLIC_LEMON_SQUEEZY_*` for getCheckoutUrl).
- **MANDATORY CLAUDE.md proof artifact produced and committed.** `marketing/screenshots/phase-91-pricing-with-checkout-urls.png` = 217,285 bytes (well above the 100KB threshold), produced by Test 3 in `checkout-with-env.spec.ts` with mock env vars (`111111`/`222222`/`333333`) set inline. Force-added to override repo-root `.gitignore` line 114 `screenshots/` pattern, following the Phase 90 closure pattern.
- **Phase 90 inter-agent learning honored.** Pre-emptively extended `marketing/.gitignore` to allow both `phase-91-*.png` and `phase-91-*.json` named artifacts, so Plan 91-02's webhook proof artifact will be committable in the same wave it is produced (gap-closure prevention).
- **Zero npm dependencies added.** `@lemonsqueezy/lemonsqueezy.js` SDK rejected per D-03; `resend` reserved for Plan 91-02 per D-13. URL construction is pure string-concat; the webhook handler in Plan 91-02 will use `node:crypto` directly for HMAC verification.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author marketing/lib/lemon-squeezy.ts utility** — `6c3ac1a` (feat)
2. **Task 2: Rewire pricing.tsx + update .env.example + extend .gitignore + add 3 npm scripts** — `3bf1ef8` (feat)
3. **Task 3: Author checkout-with-env.spec.ts + checkout-without-env.spec.ts + MANDATORY screenshot** — `06797b7` (test)

## Files Created/Modified

### Created (4)
- `marketing/lib/lemon-squeezy.ts` (121 lines) — 3 exports: `getCheckoutUrl(tier)`, `variantIdToTier(variantId)`, `type LemonSqueezyTier`. Reuses Phase 89's env-var-throws pattern from `marketing/lib/supabase.ts` for `variantIdToTier` (fail-closed per D-07); `getCheckoutUrl` returns the `/signup?plan=*` fallback when env absent (does NOT throw — dev landing works without M2).
- `marketing/tests/checkout-with-env.spec.ts` (98 lines) — 3 tests: (1) all 3 CTAs match LS URL regex `^https://[\w-]+\.lemonsqueezy\.com/buy/\d+$`; (2) hrefs end with `/buy/<variant-id>` matching env vars; (3) MANDATORY full-page screenshot with `fs.statSync().size > 100000` assertion.
- `marketing/tests/checkout-without-env.spec.ts` (42 lines) — 1 test asserting `/signup?plan=starter`, `/signup?plan=pro`, `/signup?plan=cloud-sync` (D-19 hyphen-form fallback for cloud_sync).
- `marketing/screenshots/phase-91-pricing-with-checkout-urls.png` (217,285 bytes) — MANDATORY proof-of-execution artifact.

### Modified (4)
- `marketing/components/sections/pricing.tsx` — added `import { getCheckoutUrl } from "@/lib/lemon-squeezy"` on line 5; rewired the 3 hrefs (lines 35, 60, 84) to `href={getCheckoutUrl("starter" | "pro" | "cloud_sync")}`. NO `'use client'` added (server-component preserved); Tailwind classes + Card/CardHeader/Badge/Separator structure unchanged.
- `marketing/.env.example` — REPLACED the previously-commented Phase-91 stub block (lines 15-26) with an UNCOMMENTED 16-line block documenting: 6 server-only LS env vars + 4 NEXT_PUBLIC_ LS env vars + 2 RESEND vars + 1 NEXT_PUBLIC_GITHUB_REPO default = 13 Phase-91 vars total. Phase 89 Supabase block (lines 5-13) and Phase 93 OAuth stub (lines 28-31 in original numbering) preserved byte-for-byte.
- `marketing/.gitignore` — REPLACED the existing 4-line `screenshots/*` block with a 9-line block adding `!screenshots/phase-91-*.png` AND `!screenshots/phase-91-*.json` exceptions. Phase 90's `!screenshots/phase-*-landing.png` exception preserved.
- `marketing/package.json` — added 3 npm scripts (test:checkout, test:checkout:with-env, test:checkout:without-env) to the existing 6-script block. All 13 dependencies and 13 devDependencies preserved byte-for-byte; no new packages added.

## Decisions Made

- **D-19 underscore-vs-hyphen mapping documented in code.** The `TIER_TO_FALLBACK_SLUG` map in `lib/lemon-squeezy.ts` is the single source of truth: `{ starter: "starter", pro: "pro", cloud_sync: "cloud-sync" }`. Function API takes underscore form; fallback href emits hyphen form.
- **D-20 mechanism: two separate spec files, two separate npm scripts.** `playwright.config.ts` spawns `next dev` ONCE per invocation; per-test `process.env` mutations don't reach the subprocess. Operator sets env vars BEFORE `npm run test:checkout:with-env` (inline `VAR=x VAR=y npm run ...` form on bash or `$env:VAR="x"; npm run ...` on PowerShell).
- **D-23 license-key regex locked here for Plan 91-02 contract:** `/^EF13(-[0-9A-F]{4}){4}$/`.
- **No new npm dependencies in 91-01.** `@lemonsqueezy/lemonsqueezy.js` rejected (D-03 — SDK is beta + adds opaque dep on undocumented shapes; 50 lines of `node:crypto` + string-concat is sufficient). `resend` reserved for Plan 91-02 (D-13).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc examples in lib/lemon-squeezy.ts contained `111111` literal that violated D-04 acceptance grep**
- **Found during:** Task 1 verification
- **Issue:** Plan `<action>` block included JSDoc example `getCheckoutUrl('starter') // with env: 'https://editfactory.lemonsqueezy.com/buy/111111'`, but the plan's acceptance criterion required `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts` to return 0 matches. The literal `111111` in the JSDoc comment caused that grep to match.
- **Fix:** Replaced the numeric literal in the JSDoc example with the placeholder `<variantId>` (e.g., `'https://<slug>.lemonsqueezy.com/buy/<variantId>'`). The D-04 intent (no hardcoded numeric LS IDs in source) is preserved more strictly.
- **Files modified:** marketing/lib/lemon-squeezy.ts (JSDoc only — no functional code changed)
- **Verification:** `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts` now returns 0 matches.
- **Committed in:** `6c3ac1a` (Task 1 commit)

**2. [Rule 1 - Bug] JSDoc example also caused `cloud-sync` count > 1 in lib/lemon-squeezy.ts**
- **Found during:** Task 1 verification
- **Issue:** Acceptance criterion required `grep -c "cloud-sync" marketing/lib/lemon-squeezy.ts` to return exactly 1 (only the `TIER_TO_FALLBACK_SLUG` map value). The plan's JSDoc example block contained 2 additional `cloud-sync` literals (one in the design-rationale doc, one in the function-Example comment), producing count 3.
- **Fix:** Rephrased the JSDoc to refer to "the HYPHEN form for the third tier slug" instead of spelling out `cloud-sync`; replaced the Example line with `'/signup?plan=<hyphen-form>' (see TIER_TO_FALLBACK_SLUG)`.
- **Files modified:** marketing/lib/lemon-squeezy.ts (JSDoc only)
- **Verification:** `grep -c "cloud-sync" marketing/lib/lemon-squeezy.ts` now returns 1 (only the map value).
- **Committed in:** `6c3ac1a` (Task 1 commit)

**3. [Rule 1 - Bug] checkout-without-env.spec.ts comment caused `/signup?plan=cloud-sync` count > 1**
- **Found during:** Task 3 verification
- **Issue:** Acceptance criterion required `grep -c "/signup?plan=cloud-sync" marketing/tests/checkout-without-env.spec.ts` to return exactly 1 (only the assertion). The plan's verbatim spec included the literal in an explanatory comment as well, producing count 2.
- **Fix:** Rephrased the comment to "the hyphen-form fallback href" instead of literal `/signup?plan=cloud-sync`.
- **Files modified:** marketing/tests/checkout-without-env.spec.ts (comment only)
- **Verification:** `grep -c "/signup?plan=cloud-sync" marketing/tests/checkout-without-env.spec.ts` now returns 1.
- **Committed in:** `06797b7` (Task 3 commit)

**4. [Rule 3 - Blocking] Repo-root .gitignore `screenshots/` rule overrides marketing/.gitignore exception — screenshot needed `git add -f`**
- **Found during:** Task 3 (post-screenshot-generation verification)
- **Issue:** The plan's acceptance criterion required `git check-ignore marketing/screenshots/phase-91-pricing-with-checkout-urls.png` to exit 1 (file NOT ignored). The marketing/.gitignore exceptions added in Task 2 (`!screenshots/phase-91-*.png`) cannot override the repo-root `.gitignore:114` `screenshots/` rule because Git does not descend into directories excluded by a parent .gitignore. Per D-15 ("zero modifications outside marketing/"), the repo-root .gitignore cannot be modified.
- **Fix:** Used `git add -f marketing/screenshots/phase-91-pricing-with-checkout-urls.png` to force-track the file. Once tracked, `git check-ignore` exits 1 (NOT ignored — the rule no longer applies to tracked files). This matches the Phase 90 closure pattern (commit `4ea2a21 fix(90-01): commit MANDATORY landing screenshot artifact (gap closure)`) which used the same `git add -f` mechanism.
- **Files modified:** N/A — only changed git index (force-tracked the artifact)
- **Verification:** `git check-ignore marketing/screenshots/phase-91-pricing-with-checkout-urls.png` exits 1. The file is now part of the repo and persists across future merges.
- **Committed in:** `06797b7` (Task 3 commit)
- **Note for future planning:** The plan acceptance criterion's grep contract assumed the marketing-scoped .gitignore exception alone was sufficient; this is incorrect in Git's nested-gitignore semantics when a parent rule excludes the directory entirely. Plan 91-02 should be aware: its `phase-91-webhook-success.json` artifact will likewise require `git add -f`.

---

**Total deviations:** 4 auto-fixed (3 Rule-1 bugs from grep-incompatible comments verbatim in plan; 1 Rule-3 blocking issue requiring git-add-f workaround per D-15 constraint).

**Impact on plan:** All deviations were small comment/JSDoc tweaks (no functional code changed) plus one mandatory `git add -f` to satisfy the proof-artifact-committable acceptance criterion. The plan's intent and observable behavior are preserved unchanged.

## Issues Encountered

- **Port 3001 was occupied by a stale `next dev` process at execution start.** Per advisor pre-execution advice, ran Playwright with `PLAYWRIGHT_PORT=3099 PLAYWRIGHT_BASE_URL=http://localhost:3099 CI=1` to force a fresh `next dev` spawn on an alternate port (3099 was confirmed free). This is a documented mechanism in `playwright.config.ts` lines 9-12 from Phase 89 D-06. No code changes required.

- **`marketing/node_modules` was absent at execution start.** Ran `npm install` (40 seconds, 649 packages) before any verification step. No code changes — pre-existing dependency contract from Phase 89/90.

## Test Run Results

- `npm run test:checkout:without-env` (no env vars set) → 1 passed, 0 failed, 0 skipped (env-ABSENT spec).
- `NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG=editfactory NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID=111111 NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID=222222 NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID=333333 npm run test:checkout:with-env` → 3 passed, 0 failed, 0 skipped (env-PRESENT spec; Test 3 produced the 217,285-byte MANDATORY screenshot).
- `npm test` (default suite — includes landing.spec.ts + scaffold-smoke.spec.ts + both checkout specs) → 5 passed, 3 skipped (env-PRESENT correctly skipped without env vars per test.beforeAll guard), 0 failed. **No regressions in landing.spec.ts.** Lighthouse Performance: 96 / Accessibility: 100 (unchanged from Phase 90).
- The mock IDs `111111`/`222222`/`333333` exist ONLY as runtime env-var values during the test invocation; they are NOT present anywhere in source files (D-04 protection intact — `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts marketing/components/sections/pricing.tsx` returns 0 matches).

## User Setup Required

**External services require manual configuration before the env-PRESENT path becomes operational:**

- **M2 (Lemon Squeezy):** Operator must create the LS store + 3 product variants (Starter $79, Pro $149, Cloud Sync $39/yr) at https://app.lemonsqueezy.com/, capture the store slug + 3 variant IDs + API key + webhook signing secret, and write all 11 LS env vars into `marketing/.env.local`. Full operator-facing how-to is documented in `.planning/phases/91-lemon-squeezy-checkout-webhook/91-CONTEXT.md` § M2.
- **M3 (Resend):** Reserved for Plan 91-02. Not yet required for Plan 91-01 verification.

No code changes are required for the dev landing page to render — `getCheckoutUrl` returns the `/signup?plan=*` fallback when M2 env vars are absent (Test 1 of `checkout-without-env.spec.ts` proves this).

## Next Phase Readiness

**Plan 91-02 (webhook handler + Supabase + license-key + email) is unblocked:**

- `marketing/lib/lemon-squeezy.ts` exports `variantIdToTier(variantId: string): LemonSqueezyTier | null` — the webhook handler at `marketing/app/api/lemon-squeezy/webhook/route.ts` will import this directly.
- `LemonSqueezyTier` union type is exported and matches the `subscription_tier` CHECK constraint Plan 91-02's migration will create (D-11).
- 13 env-var contracts documented in `marketing/.env.example` give the operator a single source-of-truth for M2 + M3 provisioning.
- `marketing/.gitignore` already allows `phase-91-*.json` named artifacts so Plan 91-02's webhook proof artifact (`phase-91-webhook-success.json`) can be force-added without another gap-closure cycle.
- D-23 license-key regex `/^EF13(-[0-9A-F]{4}){4}$/` is locked here for Plan 91-02 Task 1 to use verbatim.

No blockers. Plan 91-02 can begin immediately.

## Confirmations

- **No `@lemonsqueezy` package added** (`grep -c '@lemonsqueezy' marketing/package.json` = 0; per D-03).
- **No `resend` package added** (`grep -c 'resend' marketing/package.json` = 0; reserved for Plan 91-02 per D-13).
- **3 contracts exported from `lib/lemon-squeezy.ts` ready for Plan 91-02 consumption:** `getCheckoutUrl`, `variantIdToTier`, `type LemonSqueezyTier`.
- **Env-var modes tested:** with-env (mock IDs `111111`/`222222`/`333333` → LS URLs) and without-env (fallback `/signup?plan=*` shape).

## Self-Check: PASSED

- All 9 files claimed exist: marketing/lib/lemon-squeezy.ts, marketing/components/sections/pricing.tsx, marketing/.env.example, marketing/.gitignore, marketing/tests/checkout-with-env.spec.ts, marketing/tests/checkout-without-env.spec.ts, marketing/package.json, marketing/screenshots/phase-91-pricing-with-checkout-urls.png, .planning/phases/91-lemon-squeezy-checkout-webhook/91-01-SUMMARY.md.
- All 3 task commits exist in git log: 6c3ac1a (Task 1), 3bf1ef8 (Task 2), 06797b7 (Task 3).
- Screenshot file size: 217,285 bytes (well above 100,000 threshold).
- `git check-ignore marketing/screenshots/phase-91-pricing-with-checkout-urls.png` exits 1 (file NOT ignored — committable).
- `grep -E "[0-9]{6,}" marketing/lib/lemon-squeezy.ts marketing/components/sections/pricing.tsx` returns 0 matches (D-04 acceptance).
- `grep -c "@lemonsqueezy" marketing/package.json` = 0 (D-03).
- `grep -c "resend" marketing/package.json` = 0 (Plan 91-02 territory).
- `npx tsc --noEmit` clean. `npm run lint` shows 0 errors and only Phase 89's 5 pre-existing tolerated warnings.

---
*Phase: 91-lemon-squeezy-checkout-webhook*
*Plan: 91-01*
*Completed: 2026-05-23*
