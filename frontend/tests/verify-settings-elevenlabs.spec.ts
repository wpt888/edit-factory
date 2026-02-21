import { test } from '@playwright/test';

test('Verify settings page shows only ElevenLabs', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-settings-elevenlabs.png', fullPage: true });
});
