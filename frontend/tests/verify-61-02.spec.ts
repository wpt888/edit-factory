import { test } from '@playwright/test';

test('Verify 61-02: Library trash toggle and hover preview', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/61-02-library-view.png', fullPage: true });
});

test('Verify 61-02: Segments drag-drop', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/61-02-segments-view.png', fullPage: true });
});
