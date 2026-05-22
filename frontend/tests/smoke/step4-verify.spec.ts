import { test } from '@playwright/test';

test('Verify Step 4 UI changes', async ({ page }) => {
  await page.goto('http://localhost:3001/pipeline?step=4');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/step4-verify.png', fullPage: true });
});
