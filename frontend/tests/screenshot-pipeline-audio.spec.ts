import { test } from '@playwright/test';

test('Verify Pipeline page with audio preview UI', async ({ page }) => {
  // Navigate directly — page may redirect to login if not authenticated
  await page.goto('http://localhost:3000/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Take screenshot of whatever state the page is in
  await page.screenshot({ path: 'screenshots/pipeline-audio-preview.png', fullPage: true });
});
