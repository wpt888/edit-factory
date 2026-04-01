import { test } from '@playwright/test';

test('Verify script approval checkbox UI', async ({ page }) => {
  await page.goto('/pipeline?step=2&id=test');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-approval-checkbox.png', fullPage: true });
});
