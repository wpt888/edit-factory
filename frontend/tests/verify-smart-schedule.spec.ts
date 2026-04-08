import { test } from '@playwright/test';

test('Verify Smart Schedule V2 UI', async ({ page }) => {
  await page.goto('/schedule');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/smart-schedule-v2.png', fullPage: true });
});
