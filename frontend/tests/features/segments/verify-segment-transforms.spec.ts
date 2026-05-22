import { test } from '@playwright/test';

test('Verify segment transforms - Segments page', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-segment-transforms-segments.png', fullPage: true });
});

test('Verify segment transforms - Assembly page', async ({ page }) => {
  await page.goto('/assembly');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/verify-segment-transforms-assembly.png', fullPage: true });
});
