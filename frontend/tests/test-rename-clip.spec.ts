import { test, expect } from '@playwright/test';

test('Test clip rename functionality', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot showing clips with Netrimis badge
  await page.screenshot({
    path: 'screenshots/rename-01-clips-with-badge.png',
    fullPage: true
  });

  // Find the clip name area (under the thumbnail) and use force click
  const clipNameText = page.locator('text=variant_1').first();

  // Get parent container and find pencil button
  const clipCard = clipNameText.locator('xpath=ancestor::div[contains(@class, "bg-card")]');

  // Click directly on the clip info area using JavaScript
  await page.evaluate(() => {
    const clipInfo = document.querySelector('.bg-card .group');
    if (clipInfo) {
      // Trigger mouseenter event
      clipInfo.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    }
  });

  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/rename-02-after-hover.png',
    fullPage: true
  });

  // Try to click the pencil button using JavaScript
  const pencilClicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.bg-card button');
    for (const btn of buttons) {
      if (btn.querySelector('svg')) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  console.log('Pencil button clicked:', pencilClicked);
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/rename-03-rename-mode.png',
    fullPage: true
  });

  // Check if rename input appeared
  const renameInput = page.locator('.bg-card input');
  const inputVisible = await renameInput.isVisible();
  console.log('Rename input visible:', inputVisible);

  if (inputVisible) {
    // Type new name
    await renameInput.fill('Clip Favorit');
    await page.waitForTimeout(300);

    await page.screenshot({
      path: 'screenshots/rename-04-typed-name.png',
      fullPage: true
    });

    // Save by pressing Enter
    await renameInput.press('Enter');
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'screenshots/rename-05-saved.png',
      fullPage: true
    });

    // Verify the name changed
    const newName = page.locator('text=Clip Favorit');
    const nameChanged = await newName.isVisible();
    console.log('Name successfully changed:', nameChanged);
  }

  console.log('Rename test completed!');
});
