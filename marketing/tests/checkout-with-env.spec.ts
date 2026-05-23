import { test, expect } from '@playwright/test';

// D-20: Per-test process.env mutation cannot reach the `next dev` subprocess
// spawned by marketing/playwright.config.ts:33-40. This spec MUST be invoked
// via `npm run test:checkout:with-env` with mock env vars set FIRST:
//
//   PowerShell:
//     $env:NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG = "editfactory"
//     $env:NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID = "111111"
//     $env:NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID     = "222222"
//     $env:NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID = "333333"
//     npm run test:checkout:with-env
//
//   bash:
//     NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG=editfactory \
//     NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID=111111 \
//     NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID=222222 \
//     NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID=333333 \
//     npm run test:checkout:with-env
//
// In CI: set these via repository secrets / workflow env block. When real M2-provisioned
// IDs are NOT available, the test.beforeAll skip below leaves the suite passing-with-skips
// so CI does not fail on absent secrets (D-17).

test.describe('Phase 91-01: pricing CTAs route to Lemon Squeezy hosted checkout', () => {
  test.beforeAll(() => {
    test.skip(
      !process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG ||
        !process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID ||
        !process.env.NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID ||
        !process.env.NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID,
      'M-prerequisite M2: NEXT_PUBLIC_LEMON_SQUEEZY_* env vars not set. See 91-CONTEXT.md M2.'
    );
  });

  test('Test 1: all 3 pricing CTAs route to a Lemon Squeezy hosted checkout URL', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status(), 'home page should return HTTP 200').toBe(200);
    await page.waitForLoadState('networkidle');

    // Section scoping per landing.spec.ts:32-35 — '$79' and button text may appear in comparison table.
    const pricingSection = page.locator('section#pricing');
    const LS_URL_PATTERN = /^https:\/\/[\w-]+\.lemonsqueezy\.com\/buy\/\d+$/;

    // Each CTA href must match the Lemon Squeezy hosted-checkout URL shape.
    await expect(pricingSection.getByRole('link', { name: 'Buy Starter' })).toHaveAttribute(
      'href',
      expect.stringMatching(LS_URL_PATTERN)
    );
    await expect(pricingSection.getByRole('link', { name: 'Buy Pro' })).toHaveAttribute(
      'href',
      expect.stringMatching(LS_URL_PATTERN)
    );
    await expect(pricingSection.getByRole('link', { name: 'Add Cloud Sync' })).toHaveAttribute(
      'href',
      expect.stringMatching(LS_URL_PATTERN)
    );
  });

  test('Test 2: pricing CTA hrefs encode the correct variant IDs', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const pricingSection = page.locator('section#pricing');
    const starterId = process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID!;
    const proId = process.env.NEXT_PUBLIC_LEMON_SQUEEZY_PRO_VARIANT_ID!;
    const cloudSyncId = process.env.NEXT_PUBLIC_LEMON_SQUEEZY_CLOUD_SYNC_VARIANT_ID!;

    // href must END with /buy/<variant-id> for each tier.
    await expect(pricingSection.getByRole('link', { name: 'Buy Starter' })).toHaveAttribute(
      'href',
      new RegExp(`/buy/${starterId}$`)
    );
    await expect(pricingSection.getByRole('link', { name: 'Buy Pro' })).toHaveAttribute(
      'href',
      new RegExp(`/buy/${proId}$`)
    );
    await expect(pricingSection.getByRole('link', { name: 'Add Cloud Sync' })).toHaveAttribute(
      'href',
      new RegExp(`/buy/${cloudSyncId}$`)
    );
  });

  test('Test 3: MANDATORY full-page screenshot per CLAUDE.md (proves LS URLs are wired)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);  // webfonts + hydration settle (matches landing.spec.ts:130)

    await page.screenshot({
      path: 'screenshots/phase-91-pricing-with-checkout-urls.png',
      fullPage: true,
    });

    // Per Phase 90 gap-closure prevention: verify the file is substantial (> 100KB) — a smaller
    // file indicates the page failed to render properly even if the screenshot call succeeded.
    const fs = await import('node:fs');
    const stat = fs.statSync('screenshots/phase-91-pricing-with-checkout-urls.png');
    expect(stat.size, `screenshot size ${stat.size} must be > 100000 bytes`).toBeGreaterThan(100000);
  });
});
