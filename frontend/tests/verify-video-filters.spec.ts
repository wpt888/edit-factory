import { test } from '@playwright/test';

test('Verify video enhancement filters UI', async ({ page }) => {
  // Navigate to library page
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of the full page
  await page.screenshot({
    path: 'screenshots/video-filters-library.png',
    fullPage: true
  });

  // Try to find and click on a project if one exists
  const projectCard = page.locator('[data-testid="project-card"]').first();
  if (await projectCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    await projectCard.click();
    await page.waitForTimeout(1000);

    // Look for a clip to select
    const clipCard = page.locator('[data-testid="clip-card"]').first();
    if (await clipCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await clipCard.click();
      await page.waitForTimeout(1000);
    }
  }

  // Take screenshot after navigating into project/clip if possible
  await page.screenshot({
    path: 'screenshots/video-filters-detail.png',
    fullPage: true
  });

  // Try to find the video enhancement section
  const enhancementSection = page.locator('text=Video Enhancement').first();
  if (await enhancementSection.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Scroll to the enhancement section
    await enhancementSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Take a focused screenshot
    await page.screenshot({
      path: 'screenshots/video-filters-section.png',
      fullPage: false
    });
  }
});
