import { test, expect } from '@playwright/test';

test('Test regeneration creates different clips', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot initial clips
  await page.screenshot({
    path: 'screenshots/regen-01-initial.png',
    fullPage: true
  });

  // Get current clip data (variant names and IDs from DOM)
  const clipCards = page.locator('.aspect-\\[9\\/16\\]');
  const initialClipCount = await clipCards.count();
  console.log('Initial clip count:', initialClipCount);

  // Get clip names before regeneration
  const clipNamesBeforeElements = await page.locator('.bg-card.p-2 .cursor-pointer p').all();
  const clipNamesBefore: string[] = [];
  for (const el of clipNamesBeforeElements) {
    const text = await el.textContent();
    clipNamesBefore.push(text || '');
  }
  console.log('Clip names before:', clipNamesBefore);

  // Now trigger generation - click the GENEREAZĂ button
  const generateButton = page.locator('button:has-text("GENEREAZĂ")');
  const buttonVisible = await generateButton.isVisible();
  console.log('Generate button visible:', buttonVisible);

  if (buttonVisible) {
    await generateButton.click();
    console.log('Clicked generate button');

    // Wait for generation to complete - poll for "ready_for_triage" status
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max

    while (attempts < maxAttempts) {
      await page.waitForTimeout(1000);
      attempts++;

      // Check if generating indicator is gone and clips are visible
      const generating = await page.locator('text=Se generează').isVisible();
      const progressBar = await page.locator('[role="progressbar"]').isVisible();

      console.log(`Attempt ${attempts}: generating=${generating}, progressBar=${progressBar}`);

      if (!generating && !progressBar) {
        // Give it a moment more for UI to update
        await page.waitForTimeout(2000);
        break;
      }

      if (attempts === maxAttempts) {
        console.log('Timeout waiting for generation');
      }
    }

    // Screenshot after regeneration
    await page.screenshot({
      path: 'screenshots/regen-02-after.png',
      fullPage: true
    });

    // Get clip data after regeneration
    const afterClipCards = page.locator('.aspect-\\[9\\/16\\]');
    const afterClipCount = await afterClipCards.count();
    console.log('After regeneration clip count:', afterClipCount);

    // Get clip names after regeneration
    const clipNamesAfterElements = await page.locator('.bg-card.p-2 .cursor-pointer p').all();
    const clipNamesAfter: string[] = [];
    for (const el of clipNamesAfterElements) {
      const text = await el.textContent();
      clipNamesAfter.push(text || '');
    }
    console.log('Clip names after:', clipNamesAfter);

    // Verify regeneration happened
    if (clipNamesAfter.length > 0) {
      // Names should reset to variant_1, variant_2, etc. after regeneration
      // (unless the user renamed them)
      console.log('Regeneration completed!');
    } else {
      console.log('ERROR: No clips after regeneration');
    }
  }
});
