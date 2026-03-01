import { test } from '@playwright/test';

test('Verify Setup Wizard page (non-desktop mode fallback)', async ({ page }) => {
  await page.goto('/setup');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/setup-wizard-non-desktop.png', fullPage: true });
});

test('Verify Settings page with Setup Wizard link area', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/settings-page-bottom.png', fullPage: true });
});
