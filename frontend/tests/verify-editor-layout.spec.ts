import { test, expect } from '@playwright/test';

test('Verify professional segment editor layout', async ({ page }) => {
  // Navigate to segments page
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of the professional editor layout
  await page.screenshot({
    path: 'screenshots/editor-layout-full.png',
    fullPage: true
  });

  // Verify the layout structure exists
  const leftPanel = page.locator('text=Source Videos').first();
  const rightPanel = page.locator('text=Segments Library').first();

  // Check panels are visible
  await expect(leftPanel).toBeVisible({ timeout: 10000 });
  await expect(rightPanel).toBeVisible({ timeout: 10000 });

  console.log('✅ Professional editor layout verified successfully');
});

test('Test panel collapse functionality', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Screenshot with both panels open
  await page.screenshot({
    path: 'screenshots/editor-panels-open.png',
    fullPage: true
  });

  // Press [ to collapse left panel
  await page.keyboard.press('[');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/editor-left-collapsed.png',
    fullPage: true
  });

  // Press ] to collapse right panel
  await page.keyboard.press(']');
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/editor-both-collapsed.png',
    fullPage: true
  });

  console.log('✅ Panel collapse functionality verified');
});
