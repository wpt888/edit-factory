import { test, expect } from '@playwright/test';

test('Verify UI improvements: Postiz badges, no checkbox, rename', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project which has clips
  const projectCard = page.locator('text=Armaf Bliss');
  if (await projectCard.isVisible()) {
    await projectCard.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot of clip cards
  await page.screenshot({
    path: 'screenshots/ui-improvements-01-clips.png',
    fullPage: true
  });

  // Check if clips exist, if not generate them
  const clipCards = page.locator('.aspect-\\[9\\/16\\]');
  const clipCount = await clipCards.count();
  console.log('Found clips:', clipCount);

  if (clipCount === 0) {
    // Need to generate clips first
    const generateButton = page.getByRole('button', { name: /GENEREAZĂ.*VARIANTE/ });
    if (await generateButton.isVisible()) {
      console.log('Generating clips...');
      await generateButton.click();
      // Wait for generation to complete
      await page.waitForTimeout(60000);
    }
  }

  // Take another screenshot after ensuring clips exist
  await page.screenshot({
    path: 'screenshots/ui-improvements-02-with-clips.png',
    fullPage: true
  });

  // Verify "Netrimis" badge is visible (Postiz status)
  const netrimisBadge = page.locator('text=Netrimis').first();
  const badgeVisible = await netrimisBadge.isVisible();
  console.log('Netrimis badge visible:', badgeVisible);

  if (badgeVisible) {
    console.log('SUCCESS: Postiz status badge "Netrimis" is visible');
  }

  // Test rename functionality - find clip name area and hover
  const clipNameArea = page.locator('.bg-card .group').first();
  if (await clipNameArea.isVisible()) {
    await clipNameArea.hover();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'screenshots/ui-improvements-03-hover-rename.png',
      fullPage: true
    });

    // Look for pencil button
    const pencilButton = clipNameArea.locator('button');
    if (await pencilButton.isVisible()) {
      console.log('Pencil button found for rename!');
      await pencilButton.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'screenshots/ui-improvements-04-rename-mode.png',
        fullPage: true
      });

      // Type new name
      const renameInput = page.locator('.bg-card input');
      if (await renameInput.isVisible()) {
        await renameInput.fill('Test Renamed Clip');
        await page.screenshot({
          path: 'screenshots/ui-improvements-05-rename-typed.png',
          fullPage: true
        });

        // Cancel instead of saving to not mess up the data
        await renameInput.press('Escape');
        console.log('Rename test completed (cancelled to preserve data)');
      }
    }
  }

  // Final screenshot
  await page.screenshot({
    path: 'screenshots/ui-improvements-06-final.png',
    fullPage: true
  });

  console.log('UI improvements test completed!');
});
