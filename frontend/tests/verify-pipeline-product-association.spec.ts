import { test } from '@playwright/test';

test('Verify pipeline page loads with product association imports', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-pipeline-product-assoc.png', fullPage: true });
});
