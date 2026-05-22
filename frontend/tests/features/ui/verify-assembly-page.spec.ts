import { test } from '@playwright/test';

test('Verify assembly page', async ({ page }) => {
  await page.goto('/assembly');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-assembly-page.png', fullPage: true });
});
