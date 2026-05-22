import { test } from '@playwright/test';

test('Verify product-video page renders', async ({ page }) => {
  // Navigate with sample product data — server runs on 3001 in this env
  await page.goto('http://localhost:3001/product-video?id=test-123&title=Test%20Product&image=&price=99.99%20RON&brand=TestBrand');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-product-video-page.png', fullPage: true });
});
