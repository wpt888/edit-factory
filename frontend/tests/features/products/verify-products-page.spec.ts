import { test } from '@playwright/test';

test('Verify products page', async ({ page }) => {
  await page.goto('/products');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-products-page.png', fullPage: true });
});
