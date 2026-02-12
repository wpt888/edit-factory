import { test } from '@playwright/test';

test('Verify pipeline page UI', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: 'screenshots/verify-pipeline-page.png',
    fullPage: true
  });
});
