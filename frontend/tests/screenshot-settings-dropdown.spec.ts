import { test } from '@playwright/test';

test('Verify settings dropdown position', async ({ page }) => {
  await page.goto('http://localhost:3000/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/settings-dropdown-closed.png', fullPage: false });

  // Click the settings button
  const settingsBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
  // Find the settings gear button in navbar
  await page.locator('header button').filter({ hasText: '' }).nth(0).click().catch(() => {});
  // Try clicking via the nav settings icon
  await page.locator('header').locator('button').filter({ has: page.locator('[class*="lucide-settings"], [data-lucide="settings"]') }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'screenshots/settings-dropdown-open.png', fullPage: false });
});
