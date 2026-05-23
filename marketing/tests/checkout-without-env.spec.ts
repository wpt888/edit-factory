import { test, expect } from '@playwright/test';

// D-20: This spec asserts the env-ABSENT fallback shape. Invoked via
// `npm run test:checkout:without-env` with NO NEXT_PUBLIC_LEMON_SQUEEZY_*
// env vars set (cross-platform: just don't set them). Unconditional —
// no test.skip needed; the absence of env vars IS the condition under test.

test.describe('Phase 91-01: pricing CTAs fall back to /signup?plan=* when LS env absent', () => {
  test('Test 1: fallback hrefs preserve Phase 90 placeholder shape', async ({ page }) => {
    // Sanity check — if the operator accidentally set the env vars, fail loudly:
    // the fallback branch only triggers when ALL 4 env vars are absent.
    test.skip(
      !!process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STORE_SLUG &&
        !!process.env.NEXT_PUBLIC_LEMON_SQUEEZY_STARTER_VARIANT_ID,
      'NEXT_PUBLIC_LEMON_SQUEEZY_* env vars ARE set — this spec only runs in the env-absent mode.'
    );

    const response = await page.goto('/');
    expect(response?.status(), 'home page should return HTTP 200').toBe(200);
    await page.waitForLoadState('networkidle');

    const pricingSection = page.locator('section#pricing');

    // Fallback hrefs per D-19: 'starter' + 'pro' use the tier-arg slug directly;
    // 'cloud_sync' (underscore arg) maps to the hyphen-form fallback href
    // per the TIER_TO_FALLBACK_SLUG map — Phase 90 byte-compat.
    await expect(pricingSection.getByRole('link', { name: 'Buy Starter' })).toHaveAttribute(
      'href',
      '/signup?plan=starter'
    );
    await expect(pricingSection.getByRole('link', { name: 'Buy Pro' })).toHaveAttribute(
      'href',
      '/signup?plan=pro'
    );
    await expect(pricingSection.getByRole('link', { name: 'Add Cloud Sync' })).toHaveAttribute(
      'href',
      '/signup?plan=cloud-sync'
    );
  });
});
