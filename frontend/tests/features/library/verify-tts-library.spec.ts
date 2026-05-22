import { test } from '@playwright/test';

test('Verify TTS Library page', async ({ page }) => {
  await page.goto('/tts-library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-tts-library.png', fullPage: true });
});
