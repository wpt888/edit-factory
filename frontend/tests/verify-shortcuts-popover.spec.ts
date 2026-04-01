import { test } from '@playwright/test';

test('Verify shortcuts popover opens on ? click', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Select a video first
  const videoItem = page.locator('text=oregon').first();
  if (await videoItem.isVisible()) {
    await videoItem.click();
    await page.waitForTimeout(2000);
  }

  // Click the ? help button (last button in controls row)
  const helpButton = page.locator('button[title="Keyboard shortcuts (?)"]');
  await helpButton.click();
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'screenshots/segments-shortcuts-popover.png', fullPage: false });
});
