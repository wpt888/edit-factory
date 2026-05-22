import { test } from '@playwright/test';

test('Verify pipeline name input in Step 1', async ({ page }) => {
  await page.goto('http://localhost:3000/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/pipeline-name-field.png', fullPage: true });
});
