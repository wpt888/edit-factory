import { test } from '@playwright/test';

test('Verify workspace list in web sidebar', async ({ page }) => {
  await page.goto('http://localhost:3000/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-workspace-sidebar.png', fullPage: false });
});
