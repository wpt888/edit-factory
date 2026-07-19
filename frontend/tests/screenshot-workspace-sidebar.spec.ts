import { test } from '@playwright/test';

test('Verify workspace list in web sidebar', async ({ page }) => {
  await page.goto('http://localhost:3005/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(4000);
  // Dev auto-login can bounce through /login — retry the target route once.
  if (page.url().includes('/login')) {
    await page.waitForTimeout(3000);
    await page.goto('http://localhost:3005/pipeline');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: 'screenshots/verify-workspace-sidebar.png', fullPage: false });
});
