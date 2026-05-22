import { test } from '@playwright/test';

test('Verify 61-02: Library header with trash toggle', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/61-02-library-header.png', fullPage: false });
});
