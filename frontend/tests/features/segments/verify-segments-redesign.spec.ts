import { test } from '@playwright/test';

test('Verify segments page redesign - no scroll layout', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/segments-redesign-1080p.png', fullPage: false });
});

test('Verify segments page with video selected', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Click on a video that has segments (e.g., "oregon" with 7 seg)
  const videoItem = page.locator('text=oregon').first();
  if (await videoItem.isVisible()) {
    await videoItem.click();
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: 'screenshots/segments-redesign-with-video.png', fullPage: false });
});
