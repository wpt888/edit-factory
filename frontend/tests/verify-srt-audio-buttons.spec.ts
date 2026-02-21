import { test } from '@playwright/test';

test('Verify SRT & Audio download buttons in library', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take full page screenshot first
  await page.screenshot({ path: 'screenshots/verify-srt-audio-buttons.png', fullPage: true });

  // Try hovering on first clip card to reveal hover actions
  const firstCard = page.locator('.group').first();
  if (await firstCard.isVisible()) {
    await firstCard.hover();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/verify-srt-audio-hover.png', fullPage: true });
  }
});
