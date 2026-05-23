---
phase: 90
plan: "01"
subsystem: marketing
tags: [landing-page, pricing, next-js, playwright, lighthouse, shadcn, tailwind]
dependency_graph:
  requires: [89-01]
  provides: [landing-page-v1, pricing-section, faq-section, comparison-section]
  affects: [marketing/app/page.tsx, marketing/components/sections/*, marketing/tests/]
tech_stack:
  added:
    - "@radix-ui/react-accordion ^1.2"
    - "@radix-ui/react-separator ^1.1"
    - "lighthouse ^12"
    - "chrome-launcher ^1"
  patterns:
    - Next.js 16 App Router server components (6 of 7 sections are RSC)
    - Single "use client" island pattern (faq.tsx only — D-14 constraint)
    - Shadcn UI primitives via Radix (Accordion, Badge, Separator, Card, Button)
    - Section-scoped Playwright locators to avoid strict-mode violations
    - PROD_PORT formula (PLAYWRIGHT_PORT + 1000) avoids dev-server port collision
key_files:
  created:
    - marketing/components/ui/accordion.tsx
    - marketing/components/ui/badge.tsx
    - marketing/components/ui/separator.tsx
    - marketing/components/sections/hero.tsx
    - marketing/components/sections/features.tsx
    - marketing/components/sections/pricing.tsx
    - marketing/components/sections/screenshots.tsx
    - marketing/components/sections/comparison.tsx
    - marketing/components/sections/faq.tsx
    - marketing/components/sections/footer.tsx
    - marketing/tests/landing.spec.ts
    - marketing/screenshots/.gitkeep
  modified:
    - marketing/app/page.tsx
    - marketing/package.json
    - marketing/.gitignore
    - marketing/tests/scaffold-smoke.spec.ts
decisions:
  - "faq.tsx is the sole 'use client' island (D-14); all other sections are RSC"
  - "PROD_PORT = PLAYWRIGHT_PORT + 1000 (default 4001) avoids any port collision with dev server"
  - "section#pricing scoping in Playwright avoids strict-mode violation from $79 in comparison table"
  - "chrome.kill() wrapped in try-catch for Windows EPERM on temp lighthouse dir cleanup"
  - "separator.tsx 'use client' excluded from D-14 gate (it is in ui/, not sections/)"
metrics:
  duration: "~35 minutes total (T1 deps 2m, T2 components 20m, T3 tests 13m)"
  completed: "2026-05-23"
  tasks_completed: 3
  tasks_total: 3
  files_created: 12
  files_modified: 4
---

# Phase 90 Plan 01: Landing Page + Pricing Summary

One-liner: Production landing page (7 RSC sections + 1 client FAQ island) with Lighthouse 97/100 Performance, 100/100 Accessibility, and full Playwright coverage.

## Objective

Replace the Phase 89 "Coming soon" placeholder at `marketing/app/page.tsx` with a production-grade marketing landing page: Hero -> Features -> Pricing -> Screenshots -> Comparison -> FAQ -> Footer, per 18 locked decisions in `90-CONTEXT.md` (D-01..D-18).

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| T1 | Install deps + UI primitives + screenshots dir | d4f345c | package.json, accordion.tsx, badge.tsx, separator.tsx, .gitignore |
| T2 | Build 7 section components + wire page.tsx | 57b78b2 | hero.tsx, features.tsx, pricing.tsx, screenshots.tsx, comparison.tsx, faq.tsx, footer.tsx, page.tsx |
| T3 | Add landing.spec.ts + fix scaffold-smoke.spec.ts | 1775c1e | landing.spec.ts, scaffold-smoke.spec.ts |

## Test Results

All 3 tests in `landing.spec.ts` passed:

- **Test 1** (7-section assertions): 966ms — all headings, CTAs, pricing prices, footer legal links verified
- **Test 2** (Lighthouse production build): Lighthouse Performance 97/100, Accessibility 100/100 — both exceed D-16 thresholds (>=90, >=95)
- **Test 3** (CLAUDE.md mandatory screenshot): Screenshot at `screenshots/phase-90-landing.png`, 217,285 bytes (> 100,000 byte threshold)

`scaffold-smoke.spec.ts` also passes: 1.1s, 1/1 tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed scaffold-smoke.spec.ts strict-mode violation after page replacement**
- **Found during:** T3 verification
- **Issue:** Phase 89 smoke test asserted `getByText('Edit Factory', { exact: false })` which matched 7 elements on the new landing page (H1, footer brand, page title, nav links, etc.). Also `getByText('Coming soon', { exact: false })` no longer matched because the landing page uses "Screenshot coming soon" (capital S). Both caused Playwright strict-mode failures.
- **Fix:** Replaced with `getByRole('heading', { name: 'Automated video production for indie creators.', level: 1 })` (unique) and `getByText(/coming soon/i).first()` (case-insensitive regex + first() for multiple screenshot cards).
- **Files modified:** `marketing/tests/scaffold-smoke.spec.ts`
- **Commit:** 1775c1e

**2. [Rule 1 - Bug] Fixed Playwright strict-mode violation from $79 in comparison table**
- **Found during:** T3 initial run of landing.spec.ts Test 1
- **Issue:** `page.getByText('$79')` matched both the Pricing section CardTitle and the comparison table cell "One-time $79-$149", causing a strict-mode violation.
- **Fix:** Scoped to `const pricingSection = page.locator('section#pricing')` and used `pricingSection.getByText('$79')`.
- **Files modified:** `marketing/tests/landing.spec.ts`
- **Commit:** 1775c1e

**3. [Rule 1 - Bug] Fixed chrome.kill() EPERM on Windows in Lighthouse test**
- **Found during:** T3 Test 2 (Lighthouse)
- **Issue:** `chrome.kill()` in the `finally` block threw an EPERM error on Windows when chrome-launcher tried to clean up a temp lighthouse directory. The Lighthouse scores were correct (97/100) but the test failed at teardown.
- **Fix:** Wrapped `await chrome.kill()` in try-catch with comment explaining Windows EPERM.
- **Files modified:** `marketing/tests/landing.spec.ts`
- **Commit:** 1775c1e

**4. [Rule 1 - Bug] Fixed hardcoded port 3099 in landing.spec.ts comment**
- **Found during:** T3 post-write grep gate (D-16: "3099 must not appear in source files")
- **Issue:** PROD_PORT comment originally contained the literal string "3099" (the Phase 89 autonomous fallback port).
- **Fix:** Changed comment to reference "89-01-SUMMARY.md" without embedding the port number.
- **Files modified:** `marketing/tests/landing.spec.ts`
- **Commit:** 1775c1e

**5. [Rule 1 - Bug] Fixed "Most popular" appearing twice (once in comment)**
- **Found during:** T3 pre-commit grep check
- **Issue:** pricing.tsx had "Most popular" in both the Badge JSX and an adjacent comment, causing `grep -c "Most popular"` to return 2. Test 1 would match both, potentially causing strict-mode issues.
- **Fix:** Changed comment to "Tier 2 - Pro".
- **Files modified:** `marketing/components/sections/pricing.tsx`
- **Commit:** 57b78b2

## D-14 Compliance Check

Exactly one `"use client"` directive in `marketing/app/` + `marketing/components/sections/`:
- `marketing/components/sections/faq.tsx` — required for Radix Accordion interactive state

`marketing/components/ui/separator.tsx` has `"use client"` but is excluded from the D-14 gate (it is a UI primitive in `ui/`, not a section component).

## D-18 Compliance Check

Zero modifications outside `marketing/`. All changes confined to the marketing worktree directory.

## Known Stubs

- `marketing/components/sections/screenshots.tsx`: 3 Cards with "Screenshot coming soon" placeholder text. Screenshots of the actual product UI do not yet exist. This is intentional — the plan explicitly calls for placeholder screenshots. A future plan will wire real product screenshots.

## Threat Flags

None. This plan adds only static marketing HTML/TSX with no network endpoints, no auth paths, no file access patterns, and no schema changes. The only external network calls are the test-time Lighthouse run (read-only) and the production build (local only).

## Self-Check: PASSED

Files verified present:
- marketing/components/sections/hero.tsx: FOUND
- marketing/components/sections/features.tsx: FOUND
- marketing/components/sections/pricing.tsx: FOUND
- marketing/components/sections/screenshots.tsx: FOUND
- marketing/components/sections/comparison.tsx: FOUND
- marketing/components/sections/faq.tsx: FOUND
- marketing/components/sections/footer.tsx: FOUND
- marketing/components/ui/accordion.tsx: FOUND
- marketing/components/ui/badge.tsx: FOUND
- marketing/components/ui/separator.tsx: FOUND
- marketing/tests/landing.spec.ts: FOUND
- marketing/app/page.tsx: FOUND (replaced)

Commits verified:
- d4f345c (T1): FOUND
- 57b78b2 (T2): FOUND
- 1775c1e (T3): FOUND
