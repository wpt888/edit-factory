import { test } from '@playwright/test';

test('Verify 61-01: librarie page with AlertDialog and inline player UI', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/61-01-librarie-page.png', fullPage: true });
});

test('Verify 61-01: pipeline page with AlertDialog', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/61-01-pipeline-page.png', fullPage: true });
});

test('Verify 61-01: settings page with AlertDialog', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/61-01-settings-page.png', fullPage: true });
});
