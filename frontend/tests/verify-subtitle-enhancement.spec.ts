import { test } from '@playwright/test';

test('Verify subtitle enhancement controls', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Take a full page screenshot first
  await page.screenshot({ path: 'screenshots/subtitle-enhancement-fullpage.png', fullPage: true });
  
  // Try to find and click on a clip to open render dialog
  // Look for clip cards or render buttons
  const clipCards = page.locator('[class*="clip"], [class*="card"], [class*="video"]').first();
  if (await clipCards.isVisible({ timeout: 3000 }).catch(() => false)) {
    await clipCards.click();
    await page.waitForTimeout(1000);
  }
  
  // Take screenshot after interaction
  await page.screenshot({ path: 'screenshots/subtitle-enhancement-dialog.png', fullPage: true });
});
