import { test } from '@playwright/test';

test('Verify waveform in TTS library', async ({ page }) => {
  await page.goto('/tts-library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/tts-library-waveform.png', fullPage: true });
});
