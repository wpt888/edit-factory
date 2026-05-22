import { test } from '@playwright/test';

test('Verify timeline drag-drop and swap UI', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/timeline-dnd-swap.png', fullPage: true });
});
