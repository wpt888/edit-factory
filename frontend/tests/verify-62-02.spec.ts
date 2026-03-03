import { test } from '@playwright/test';

test('Verify 62-02 tag filter UI in library page', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-62-02-library-tags.png', fullPage: true });
});
