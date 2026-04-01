import { test } from '@playwright/test';

test('Verify TikTok checkbox and captions in library', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/tiktok-captions-library.png', fullPage: true });
});
