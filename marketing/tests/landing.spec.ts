import { test, expect } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';

// CLAUDE.md MANDATORY rule: full-page Playwright screenshot of the rendered landing page.
// D-16 Test 1 + Test 3 run against Playwright's webServer (next dev on port 3001).
// D-16 Test 2 runs against a separately-spawned `next start` on a COMPUTED port (PROD_PORT =
// PLAYWRIGHT_PORT + 1000, defaulting to 4001) — Lighthouse against next dev
// would score Performance 50-70 due to HMR/dev-runtime overhead; production build is required.

test.describe('Phase 90: landing page + pricing', () => {
  test('Test 1: landing page renders all 7 sections', async ({ page }) => {
    const response = await page.goto('/');
    expect(response, 'page.goto should return a Response').not.toBeNull();
    expect(response?.status(), 'home page should return HTTP 200').toBe(200);
    await page.waitForLoadState('networkidle');

    // Section heading assertions (one per section per D-02 order).
    await expect(page.getByRole('heading', { name: 'Automated video production for indie creators.', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Why Edit Factory', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Simple pricing', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'See it in action', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How we compare', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Frequently asked questions', level: 2 })).toBeVisible();

    // Hero CTAs.
    await expect(page.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '#pricing');

    // Pricing tier CTAs — exact prices from D-07.
    // Use section scoping to avoid strict-mode violation: '$79' also appears in comparison table.
    const pricingSection = page.locator('section#pricing');
    await expect(pricingSection.getByText('$79')).toBeVisible();
    await expect(pricingSection.getByText('$149')).toBeVisible();
    await expect(pricingSection.getByText('$39')).toBeVisible();
    await expect(page.getByText('Most popular')).toBeVisible();

    // Footer legal links.
    await expect(page.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/legal/privacy');
    await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/legal/terms');
    await expect(page.getByRole('link', { name: 'Cookies' })).toHaveAttribute('href', '/legal/cookies');
  });

  test('Test 2: Lighthouse Performance >= 90 and Accessibility >= 95 (production build)', async () => {
    test.setTimeout(300_000); // 5 minutes: build + start + Lighthouse run

    // Lighthouse + chrome-launcher are ESM-only — use dynamic import (Playwright runs CommonJS by default).
    // The dynamic await imports inside the test function are intentional and necessary.
    const lighthouse = (await import('lighthouse')).default;
    const chromeLauncher = await import('chrome-launcher');

    // Step 1: Ensure production build exists. `npm run build` is idempotent — re-running with a
    // valid .next/ cache is fast (~5s). If T2 just built, this is near-instant.
    const marketingRoot = path.resolve(process.cwd(), '.');
    execSync('npx next build', { cwd: marketingRoot, stdio: 'inherit' });

    // Step 2: Spawn `next start` on PROD_PORT (computed = PLAYWRIGHT_PORT + 1000, default 4001).
    // This formula guarantees no collision with Phase 89's documented port set
    // (default 3001; autonomous fallback documented in 89-01-SUMMARY.md)
    // regardless of any future upstream PLAYWRIGHT_PORT override.
    const PROD_PORT = parseInt(process.env.PLAYWRIGHT_PORT ?? '3001', 10) + 1000;
    const prodServer: ChildProcess = spawn('npx', ['next', 'start', '--port', String(PROD_PORT)], {
      cwd: marketingRoot,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });

    // Step 3: Wait for "Ready" log from next start (≤ 30s).
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('next start timed out waiting for ready')), 30_000);
      prodServer.stdout?.on('data', (chunk: Buffer) => {
        if (chunk.toString().match(/Ready|ready|started|listening|Local:/i)) {
          clearTimeout(timer);
          resolve();
        }
      });
      prodServer.stderr?.on('data', (chunk: Buffer) => {
        if (chunk.toString().match(/Ready|ready|started|listening|Local:/i)) {
          clearTimeout(timer);
          resolve();
        }
      });
      prodServer.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Step 4: Spawn Chrome via chrome-launcher.
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });

    try {
      // Step 5: Run Lighthouse against production server.
      const result = await lighthouse(`http://localhost:${PROD_PORT}`, {
        port: chrome.port,
        output: 'json',
        onlyCategories: ['performance', 'accessibility'],
        logLevel: 'error',
      });

      if (!result?.lhr) {
        throw new Error('Lighthouse returned no result');
      }

      const perf = (result.lhr.categories.performance.score ?? 0) * 100;
      const a11y = (result.lhr.categories.accessibility.score ?? 0) * 100;

      console.log(`Lighthouse — Performance: ${perf}, Accessibility: ${a11y}`);

      // D-16 LOCKED thresholds — verbatim per CONTEXT.md.
      expect(perf, `Performance score ${perf} must be >= 90`).toBeGreaterThanOrEqual(90);
      expect(a11y, `Accessibility score ${a11y} must be >= 95`).toBeGreaterThanOrEqual(95);
    } finally {
      // Step 6: Always tear down Chrome + production server, even on failure.
      // chrome.kill() may throw EPERM on Windows when cleaning up temp lighthouse dirs — suppress it.
      try { await chrome.kill(); } catch { /* Windows temp dir cleanup EPERM — safe to ignore */ }
      prodServer.kill('SIGTERM');
      // Give the process 2s to terminate gracefully.
      await new Promise((r) => setTimeout(r, 2000));
      if (!prodServer.killed) {
        prodServer.kill('SIGKILL');
      }
    }
  });

  test('Test 3: MANDATORY full-page screenshot per CLAUDE.md', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Allow webfonts / hydration to settle so the screenshot is representative.
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: 'screenshots/phase-90-landing.png',
      fullPage: true,
    });

    // Verify the file exists and is substantially larger than the 24 KB Phase 89 scaffold
    // (the full landing page with 7 sections should produce a screenshot > 100 KB at full-page resolution).
    const fs = await import('node:fs');
    const stat = fs.statSync('screenshots/phase-90-landing.png');
    expect(stat.size, `screenshot size ${stat.size} must be > 100000 bytes`).toBeGreaterThan(100000);
  });
});
