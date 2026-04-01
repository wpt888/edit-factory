import { test } from '@playwright/test';

test('Verify Library Images tab with approval checkbox', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  // Click "Imagini" tab
  await page.getByRole('button', { name: /imagini/i }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/031-library-images.png', fullPage: true });
});

test('Verify Create Image page with persistent settings', async ({ page }) => {
  await page.goto('/create-image');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/031-create-image.png', fullPage: true });
});
