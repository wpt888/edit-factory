import { test } from '@playwright/test';

test('Verify PiP overlay controls on segments page', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/verify-pip-overlay-controls.png', fullPage: true });
});
