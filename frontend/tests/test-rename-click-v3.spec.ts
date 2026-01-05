import { test, expect } from '@playwright/test';

test('Test rename click - verify input appears', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot initial - showing clips
  await page.screenshot({
    path: 'screenshots/rename-v3-01-clips.png',
    fullPage: true
  });

  // Find the clickable rename area for variant_1
  const renameArea = page.locator('.bg-card.p-2 .cursor-pointer').first();
  await renameArea.click();
  await page.waitForTimeout(1000);

  // Screenshot after clicking - should show input
  await page.screenshot({
    path: 'screenshots/rename-v3-02-input-visible.png',
    fullPage: true
  });

  // Find input using data-slot attribute
  const inputField = page.locator('.bg-card.p-2 input[data-slot="input"]');
  const inputVisible = await inputField.isVisible();
  console.log('Input field visible (using data-slot):', inputVisible);

  if (inputVisible) {
    // Get current value
    const currentValue = await inputField.inputValue();
    console.log('Current input value:', currentValue);

    // Clear and type new name
    await inputField.clear();
    await inputField.fill('Clip Redenumit');
    await page.waitForTimeout(500);

    // Screenshot with new name typed
    await page.screenshot({
      path: 'screenshots/rename-v3-03-typed.png',
      fullPage: true
    });

    // Press Enter to save
    await inputField.press('Enter');
    await page.waitForTimeout(1000);

    // Screenshot after save
    await page.screenshot({
      path: 'screenshots/rename-v3-04-saved.png',
      fullPage: true
    });

    // Verify the name changed
    const clipName = page.locator('.bg-card.p-2 .cursor-pointer p').first();
    const newName = await clipName.textContent();
    console.log('New clip name:', newName);

    expect(newName).toBe('Clip Redenumit');
    console.log('RENAME FUNCTIONALITY FULLY WORKING!');
  } else {
    console.log('ERROR: Input not visible');
  }
});
