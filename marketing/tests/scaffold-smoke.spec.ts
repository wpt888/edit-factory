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

    // Step 4: assert page content is present.
    // [Rule 1 - Bug] Phase 90 replaced the "Coming soon" placeholder with the full landing page.
    // The old assertions caused strict-mode violations (7 matches for "Edit Factory") and a
    // case mismatch ("Coming soon" vs "Screenshot coming soon"). Updated to unique locators.
    await expect(page.getByRole('heading', { name: 'Automated video production for indie creators.', level: 1 })).toBeVisible();
    await expect(page.getByText(/coming soon/i).first()).toBeVisible();

    // Step 5: full-page screenshot per CLAUDE.md MANDATORY Playwright rule.
    await page.screenshot({
      path: 'screenshots/phase-89-scaffold.png',
      fullPage: true,
    });
  });
});
