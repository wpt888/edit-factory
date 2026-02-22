import { test } from '@playwright/test';

test('Verify library page refactor - visual parity', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-library-refactor.png', fullPage: true });
});
