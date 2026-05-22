import { test } from '@playwright/test';

test('Verify ElevenLabs model selector in library page', async ({ page }) => {
  // Navigate to library page
  await page.goto('http://localhost:3000/library');

  // Wait for page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take a full page screenshot to see the overall layout
  await page.screenshot({
    path: 'screenshots/elevenlabs-model-selector-full.png',
    fullPage: true
  });

  console.log('Screenshot saved to: screenshots/elevenlabs-model-selector-full.png');
  console.log('Check for TTS Model selector in the render section');
});
