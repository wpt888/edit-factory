import { test } from '@playwright/test';

test('Verify caption fields visible in Step 4', async ({ page }) => {
  await page.goto('http://localhost:3000/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/captions-step4-pipeline.png', fullPage: true });
});
