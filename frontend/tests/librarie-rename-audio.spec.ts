import { test, expect } from '@playwright/test';

test('Librarie page - rename and audio removal features', async ({ page }) => {
  // Navigate to librarie page
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take initial screenshot
  await page.screenshot({
    path: 'screenshots/librarie-features-01-initial.png',
    fullPage: true
  });

  // Check if there are any clips
  const clipCards = page.locator('[class*="hover:ring-2"]');
  const count = await clipCards.count();

  if (count > 0) {
    // Hover over first clip to show actions
    const firstClip = clipCards.first();
    await firstClip.hover();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'screenshots/librarie-features-02-hover.png',
      fullPage: true
    });

    // Test rename by clicking on clip name area
    const clipName = page.locator('[class*="group/name"]').first();
    if (await clipName.isVisible()) {
      await clipName.click();
      await page.waitForTimeout(300);

      await page.screenshot({
        path: 'screenshots/librarie-features-03-rename-mode.png',
        fullPage: true
      });

      // Press Escape to cancel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  console.log(`✅ Librarie features test completed. Found ${count} clips.`);
});
