import { test, expect } from '@playwright/test';

test('Verify rename button visible in librarie', async ({ page }) => {
  // Go to librarie page
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take full page screenshot
  await page.screenshot({
    path: 'screenshots/librarie-rename-button.png',
    fullPage: true
  });

  console.log('Screenshot taken: librarie-rename-button.png');
});
