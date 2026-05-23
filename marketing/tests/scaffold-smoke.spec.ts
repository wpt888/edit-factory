import { test, expect } from '@playwright/test';

test.describe('Phase 89: marketing app scaffold smoke', () => {
  test('renders placeholder home page on port 3001 with required text', async ({ page }) => {
    // Step 1: navigate to the placeholder page (Playwright auto-starts `npm run dev` via webServer config).
    const response = await page.goto('/');

    // Step 2: assert HTTP 200 — MARK-01 success criterion #2.
    expect(response, 'page.goto should return a Response').not.toBeNull();
    expect(response?.status(), 'home page should return HTTP 200').toBe(200);

    // Step 3: wait for the page to settle (Next.js hydration + Tailwind class application).
    await page.waitForLoadState('networkidle');

    // Step 4: assert the literal placeholder text is present (per D-09).
    await expect(page.getByText('Edit Factory', { exact: false })).toBeVisible();
    await expect(page.getByText('Coming soon', { exact: false })).toBeVisible();

    // Step 5: full-page screenshot per CLAUDE.md MANDATORY Playwright rule.
    await page.screenshot({
      path: 'screenshots/phase-89-scaffold.png',
      fullPage: true,
    });
  });
});
