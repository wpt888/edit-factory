import { test } from '@playwright/test';

test('Verify segment product association controls', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-segments-product-assoc.png', fullPage: true });
});
