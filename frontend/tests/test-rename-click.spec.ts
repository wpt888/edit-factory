import { test, expect } from '@playwright/test';

test('Test rename click functionality', async ({ page }) => {
  // Go directly to the project with clips
  await page.goto('http://localhost:3001/library?project=4b310ada-0fc5-4d54-983a-b554d5203faf');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Screenshot initial
  await page.screenshot({
    path: 'screenshots/rename-click-01-initial.png',
    fullPage: true
  });

  // Find the clip card with variant_1 text and click on the name area
  const clipNameDiv = page.locator('text=variant_1').first();
  const isVisible = await clipNameDiv.isVisible();
  console.log('variant_1 text visible:', isVisible);

  if (isVisible) {
    // Get the parent clickable area
    const clickableArea = clipNameDiv.locator('xpath=ancestor::div[contains(@class, "cursor-pointer")]');
    const clickableExists = await clickableArea.count();
    console.log('Clickable area found:', clickableExists);

    if (clickableExists > 0) {
      await clickableArea.click();
      await page.waitForTimeout(1000);
    } else {
      // Try clicking directly on the text
      await clipNameDiv.click();
      await page.waitForTimeout(1000);
    }

    // Screenshot after clicking
    await page.screenshot({
      path: 'screenshots/rename-click-02-after-click.png',
      fullPage: true
    });

    // Check if input appeared - look for input inside bg-card
    const inputs = await page.locator('.p-2.bg-card input').all();
    console.log('Number of rename inputs found:', inputs.length);

    if (inputs.length > 0) {
      const renameInput = inputs[0];
      await renameInput.fill('Clip Redenumit Test');
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'screenshots/rename-click-03-typed.png',
        fullPage: true
      });

      // Press Escape to cancel (don't save for testing)
      await renameInput.press('Escape');
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'screenshots/rename-click-04-cancelled.png',
        fullPage: true
      });

      console.log('Rename functionality works!');
    } else {
      console.log('ERROR: Rename input did not appear after click');
    }
  }
});
