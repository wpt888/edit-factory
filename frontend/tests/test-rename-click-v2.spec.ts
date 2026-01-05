import { test, expect } from '@playwright/test';

test('Test rename click via proper navigation', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot initial - showing clips
  await page.screenshot({
    path: 'screenshots/rename-v2-01-clips-loaded.png',
    fullPage: true
  });

  // Find the clickable rename area for variant_1
  const renameArea = page.locator('.bg-card.p-2 .cursor-pointer').first();
  const renameAreaVisible = await renameArea.isVisible();
  console.log('Rename area visible:', renameAreaVisible);

  if (renameAreaVisible) {
    // Get bounding box to verify clickability
    const box = await renameArea.boundingBox();
    console.log('Rename area bounding box:', JSON.stringify(box));

    // Click on the rename area
    await renameArea.click();
    await page.waitForTimeout(1000);

    // Screenshot after clicking
    await page.screenshot({
      path: 'screenshots/rename-v2-02-after-click.png',
      fullPage: true
    });

    // Check if input field appeared
    const inputField = page.locator('.bg-card.p-2 input[type="text"]');
    const inputVisible = await inputField.isVisible();
    console.log('Input field visible after click:', inputVisible);

    if (inputVisible) {
      // Type new name
      await inputField.fill('Test Rename');
      await page.waitForTimeout(500);

      // Screenshot with typed text
      await page.screenshot({
        path: 'screenshots/rename-v2-03-typed.png',
        fullPage: true
      });

      // Press Escape to cancel
      await inputField.press('Escape');
      await page.waitForTimeout(500);

      // Screenshot after cancel
      await page.screenshot({
        path: 'screenshots/rename-v2-04-cancelled.png',
        fullPage: true
      });

      console.log('RENAME FUNCTIONALITY WORKS!');
    } else {
      console.log('ERROR: Input field did not appear after clicking rename area');

      // Check what elements exist inside bg-card
      const bgCardHtml = await page.locator('.bg-card.p-2').first().innerHTML();
      console.log('bg-card inner HTML:', bgCardHtml.substring(0, 500));
    }
  } else {
    console.log('ERROR: Rename area not found');
  }
});
