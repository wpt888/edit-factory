import { test } from '@playwright/test';

test('Verify 62-02 tag filter UI in library page - settled', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'screenshots/verify-62-02-library-tags-v2.png', fullPage: true });
});
