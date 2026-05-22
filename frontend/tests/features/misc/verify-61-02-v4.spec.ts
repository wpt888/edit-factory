import { test, expect } from '@playwright/test';

test('Verify 61-02: Library/Trash toggle visible', async ({ page }) => {
  // Wait for HMR to settle
  await page.goto('/librarie');

  // Wait for the page to fully load (including client-side hydration)
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: 'screenshots/61-02-final-check.png', fullPage: false });

  // Look for Library/Trash buttons
  const libraryBtns = await page.locator('button:has-text("Library")').count();
  const trashBtns = await page.locator('button:has-text("Trash")').count();
  console.log(`Library buttons: ${libraryBtns}, Trash buttons: ${trashBtns}`);

  // Get all button texts
  const allButtons = await page.locator('button').allTextContents();
  console.log('All buttons:', allButtons.filter(t => t.trim()).slice(0, 20));
});
