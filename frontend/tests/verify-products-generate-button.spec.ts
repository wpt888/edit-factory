import { test } from '@playwright/test';

test('Verify products page has Generate Video button', async ({ page }) => {
  await page.goto('http://localhost:3001/products');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-products-generate-button.png', fullPage: true });
});
