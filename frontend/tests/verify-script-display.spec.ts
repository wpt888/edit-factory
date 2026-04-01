import { test } from '@playwright/test';

test('Verify script display in library', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/library-scripts-check.png', fullPage: true });
});
