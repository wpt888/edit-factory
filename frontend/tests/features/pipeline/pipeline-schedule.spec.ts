import { test } from '@playwright/test';

test('Verify pipeline step 4 with schedule', async ({ page }) => {
  await page.goto('/pipeline?step=4');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/pipeline-step4-schedule.png', fullPage: true });
});
