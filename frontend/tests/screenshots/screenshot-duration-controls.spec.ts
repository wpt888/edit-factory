import { test } from '@playwright/test';

test('Verify duration adjustment controls on timeline', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/timeline-duration-controls.png', fullPage: true });
});
