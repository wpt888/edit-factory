import { test } from '@playwright/test';

test('Verify Add Local button appears in Segments page', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-local-button.png', fullPage: true });
});
