import { test } from '@playwright/test';

test('Calendar tab screenshot', async ({ page }) => {
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/calendar-tab.png', fullPage: true });
});
