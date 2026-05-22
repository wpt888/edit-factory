import { test, expect } from '@playwright/test';

test('Verify pipeline history sidebar is always visible', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Sidebar should be visible without any click
  const sidebarTitle = page.getByText('Script History');
  await expect(sidebarTitle).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: 'screenshots/verify-pipeline-history.png', fullPage: true });
});
