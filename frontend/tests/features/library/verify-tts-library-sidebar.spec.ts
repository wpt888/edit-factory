import { test } from '@playwright/test';

test('Verify TTS Library sidebar on pipeline page', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Take full page screenshot first
  await page.screenshot({ path: 'screenshots/tts-library-sidebar-full.png', fullPage: true });
  
  // Try to find and click the TTS Library section to expand it
  const ttsLibraryHeader = page.locator('text=TTS Library').first();
  if (await ttsLibraryHeader.isVisible()) {
    await ttsLibraryHeader.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/tts-library-sidebar-expanded.png', fullPage: true });
  }
});
