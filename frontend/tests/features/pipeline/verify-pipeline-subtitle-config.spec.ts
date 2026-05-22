import { test } from '@playwright/test';

test('Verify Pipeline page subtitle config card on Step 3', async ({ page }) => {
  // Navigate to Pipeline page
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Take screenshot of Step 1 (starting state)
  await page.screenshot({ path: 'screenshots/verify-pipeline-subtitle-step1.png', fullPage: true });
});
