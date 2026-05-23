---
phase: 90-landing-page-pricing
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - marketing/.gitignore
  - marketing/app/page.tsx
  - marketing/components/sections/comparison.tsx
  - marketing/components/sections/faq.tsx
  - marketing/components/sections/features.tsx
  - marketing/components/sections/footer.tsx
  - marketing/components/sections/hero.tsx
  - marketing/components/sections/pricing.tsx
  - marketing/components/sections/screenshots.tsx
  - marketing/components/ui/accordion.tsx
  - marketing/components/ui/badge.tsx
  - marketing/components/ui/separator.tsx
  - marketing/next-env.d.ts
  - marketing/package-lock.json
  - marketing/package.json
  - marketing/screenshots/.gitkeep
  - marketing/tests/landing.spec.ts
  - marketing/tests/scaffold-smoke.spec.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 90: Code Review Report

**Reviewed:** 2026-05-23
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 90 added a full marketing landing page (7 RSC sections, 1 client FAQ island) to the `marketing/` Next.js 16 subtree, plus a Playwright + Lighthouse test harness. All 18 changed files were reviewed.

No critical issues found. The section components themselves are clean static RSC — no user input, no XSS surfaces, no secrets, no auth paths. The Shadcn primitives are canonical copies. The two warnings are both in the Lighthouse test harness (`landing.spec.ts` Test 2), where a subprocess lifecycle gap creates a reproducible port-leak on failure paths, and a Windows-specific `shell: true` + SIGTERM incompatibility that can leave orphaned processes.

The four info items cover Next.js conventions and a minor accessibility footnote.

This review is advisory only per Phase 90 scope. The warnings are future-phase fix candidates (suggested for Phase 92 or the next marketing iteration).

---

## Warnings

### WR-01: `next start` child process leaks if server startup or Chrome launch fails

**File:** `marketing/tests/landing.spec.ts:62-92`

**Issue:** `prodServer` is spawned at line 62. The `try/finally` block that would kill it only begins at line 92 — after both the "Ready" wait (lines 69-87) and `chromeLauncher.launch()` (line 90). Two failure paths escape cleanup:

1. The "Ready" promise rejects (30-second timeout fires, or `prodServer` emits `'error'`). `prodServer` is never killed. `PROD_PORT` (default 4001) stays occupied until the OS or a human reclaims it.
2. `chromeLauncher.launch()` throws. `prodServer` has already started and is listening on `PROD_PORT`, but the `finally` block is never entered.

Either failure leaves an orphaned `next start` process that blocks subsequent test runs on the same machine with a port-already-in-use error.

**Fix:** Wrap `prodServer` inside the `try/finally` immediately after spawn, making the kill unconditional on all exit paths. The Chrome kill inside the same block needs a null guard since Chrome may not have launched yet:

```typescript
const prodServer: ChildProcess = spawn(/* ... */);

let chrome: Awaited<ReturnType<typeof chromeLauncher.launch>> | null = null;
try {
  // Wait for "Ready"
  await new Promise<void>((resolve, reject) => { /* ... unchanged ... */ });

  // Launch Chrome
  chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });

  // Run Lighthouse
  const result = await lighthouse(/* ... */);
  // ... assertions ...
} finally {
  if (chrome) {
    try { await chrome.kill(); } catch { /* Windows EPERM */ }
  }
  prodServer.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  if (!prodServer.killed) {
    prodServer.kill('SIGKILL');
  }
}
```

---

### WR-02: SIGTERM/SIGKILL does not reliably kill `next start` descendants on Windows with `shell: true`

**File:** `marketing/tests/landing.spec.ts:65,117-122`

**Issue:** On Windows the process is spawned with `shell: process.platform === 'win32'` (line 65), which wraps the command in `cmd.exe`. `prodServer.kill('SIGTERM')` and `prodServer.kill('SIGKILL')` kill the `cmd.exe` shell PID, not the `node`/`next` process tree it forked. `prodServer.killed` reflects the shell exit, not the `next start` node process. The node process remains alive, holding `PROD_PORT`, until OS cleanup.

This is consistent with the WR-01 scenario: even on a clean successful test run, the current teardown may not fully release the port on Windows.

**Fix:** Use `taskkill /F /T` on Windows to kill the entire process tree, falling back to SIGKILL on non-Windows. A lightweight in-tree solution (no new dependency) using Node's built-in `execSync`:

```typescript
// In the finally block, replace the kill sequence:
if (process.platform === 'win32') {
  try {
    execSync(`taskkill /F /T /PID ${prodServer.pid}`, { stdio: 'ignore' });
  } catch { /* process may already be gone */ }
} else {
  prodServer.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  if (!prodServer.killed) prodServer.kill('SIGKILL');
}
```

Note: `execSync` is already imported at line 2, so no new import is required.

---

## Info

### IN-01: Internal page navigations use bare `<a>` instead of `next/link`

**Files:** `marketing/components/sections/hero.tsx:15,18`, `marketing/components/sections/pricing.tsx:33,59,82`, `marketing/components/sections/footer.tsx:21,22,23`

**Issue:** Full-page navigations to internal routes (`/signup`, `/signup?plan=...`, `/legal/privacy`, `/legal/terms`, `/legal/cookies`) use `<a href="...">` wrapped in `Button asChild`. Next.js App Router provides `next/link` for client-side prefetching and soft navigation; bare `<a>` triggers a full browser navigation. For a static marketing page this has no correctness impact, but it diverges from Next.js conventions and will cause noticeable page reloads if the app later adds a persistent nav bar or layout state.

Hash anchor links (`#pricing`, `#features`, `#faq`) are correctly using bare `<a>` — those do not benefit from `next/link`.

**Fix:** Replace `<a href="/signup">` with `<Link href="/signup">` (imported from `next/link`) inside the `Button asChild` wrapper. No change needed for `#hash` links.

---

### IN-02: Bare `catch {}` silently swallows all `chrome.kill()` errors

**File:** `marketing/tests/landing.spec.ts:116`

**Issue:** `try { await chrome.kill(); } catch { }` catches any error, not just Windows EPERM. If `chrome.kill()` fails for an unrelated reason (e.g., the chrome process had already crashed unexpectedly), the failure is invisible. The comment says "Windows temp dir cleanup EPERM" but the catch has no guard on error type.

**Fix:** Log the swallowed error at minimum so CI output captures unexpected failures:

```typescript
try { await chrome.kill(); } catch (e) {
  // Windows temp dir cleanup EPERM is expected — log others for visibility.
  if ((e as NodeJS.ErrnoException).code !== 'EPERM') console.warn('chrome.kill unexpected error:', e);
}
```

---

### IN-03: `comparison.tsx` check/cross glyphs use Unicode characters without explicit screen-reader text

**File:** `marketing/components/sections/comparison.tsx:29-44`

**Issue:** Table cells use `✓` and `✗` Unicode characters. Screen reader announcement varies by platform (NVDA reads "check mark", VoiceOver on macOS reads "heavy check mark", some assistants read nothing). The parenthetical prose in each cell (`(local-first)`, `(cloud only)`, etc.) provides semantic context, so the practical impact is low. Lighthouse Accessibility 100/100 passed, but Lighthouse does not audit Unicode character semantics. A future WCAG 1.3.1 (Info and Relationships) audit could flag this.

**Fix (optional):** Wrap the glyphs in a `<span aria-hidden="true">` and add a visually-hidden sibling, or replace with an SVG icon component that carries an `aria-label`:

```tsx
<td className="p-4">
  <span aria-hidden="true">✓</span>
  <span className="sr-only">Yes</span>
  {" (local-first)"}
</td>
```

---

### IN-04: `screenshots/.gitignore` excludes entire `screenshots/` directory, not just test artifacts

**File:** `marketing/.gitignore:7`

**Issue:** The `.gitignore` entry `screenshots/` ignores all files under `marketing/screenshots/`, including `marketing/screenshots/.gitkeep` (which was explicitly committed to ensure the directory exists for Playwright output). The `.gitkeep` is tracked now because it was committed before the `.gitignore` rule was added, but any future file placed in `marketing/screenshots/` (e.g., actual product screenshot assets) will be silently ignored by git.

If the intent is to ignore only Playwright-generated PNG artifacts, a more specific pattern would be safer:

```gitignore
# Playwright test screenshots (generated — not source)
screenshots/*.png
# Keep the directory anchor
!screenshots/.gitkeep
```

The current state is functionally correct for the Phase 90 test output use-case, but the coarse exclusion may surprise a future contributor adding real product screenshots to this directory.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
