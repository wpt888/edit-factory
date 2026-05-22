import { test } from '@playwright/test';

test('Verify crash reporting settings card', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/settings-crash-reporting.png', fullPage: true });
});
