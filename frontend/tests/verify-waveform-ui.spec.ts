import { test } from '@playwright/test';

test('Verify waveform UI on segments page', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-waveform-segments.png', fullPage: true });
});
