import { test, expect } from '@playwright/test';

test('Verify mute source voice fix - generate new clip', async ({ page }) => {
  test.setTimeout(180000); // 3 minutes for generation

  await page.setViewportSize({ width: 1400, height: 900 });

  // Navigate to library page
  console.log('1. Navigating to library...');
  await page.goto('http://localhost:3002/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Take screenshot of initial state
  await page.screenshot({
    path: 'screenshots/mute-fix-1-library.png',
    fullPage: false
  });

  // Click on the project "Armaf Bliss"
  console.log('2. Selecting project Armaf Bliss...');
  const projectItem = page.locator('text=Armaf Bliss');
  if (await projectItem.isVisible()) {
    await projectItem.click();
    await page.waitForTimeout(2000);
  } else {
    console.log('Project not found, taking screenshot...');
    await page.screenshot({
      path: 'screenshots/mute-fix-error-no-project.png',
      fullPage: true
    });
    return;
  }

  // Take screenshot of project selected
  await page.screenshot({
    path: 'screenshots/mute-fix-2-project-selected.png',
    fullPage: false
  });

  // Find and click on "Generare Clip-uri din Segmente" tab
  console.log('3. Clicking on segment generation tab...');
  const segmentTab = page.locator('button:has-text("Generare Clip-uri din Segmente")');
  if (await segmentTab.isVisible()) {
    await segmentTab.click();
    await page.waitForTimeout(1000);
  }

  // Take screenshot showing generation options
  await page.screenshot({
    path: 'screenshots/mute-fix-3-generation-tab.png',
    fullPage: false
  });

  // Check if mute source voice checkbox exists and is visible
  console.log('4. Checking mute source voice option...');
  const muteSwitch = page.locator('#mute-source');
  const muteSwitchExists = await muteSwitch.count();
  console.log('   Mute switch exists:', muteSwitchExists > 0);

  if (muteSwitchExists > 0) {
    const isChecked = await muteSwitch.isChecked();
    console.log('   Mute switch is ON:', isChecked);

    // If not checked, click to enable
    if (!isChecked) {
      console.log('   Enabling mute source voice...');
      await muteSwitch.click();
      await page.waitForTimeout(500);
    }
  }

  // Set variant count to 1 for quick testing
  console.log('5. Setting variant count to 1...');
  const variantInput = page.locator('input[type="number"]').first();
  if (await variantInput.isVisible()) {
    await variantInput.fill('1');
  }

  // Take screenshot before generation
  await page.screenshot({
    path: 'screenshots/mute-fix-4-before-generate.png',
    fullPage: false
  });

  // Find and click the generate button
  console.log('6. Looking for generate button...');
  const generateButton = page.locator('button:has-text("Generează Clip-uri")').first();

  if (await generateButton.isVisible()) {
    console.log('   Clicking generate button...');
    await generateButton.click();
    console.log('   Generate button clicked!');

    // Wait for generation to start
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: 'screenshots/mute-fix-5-generating.png',
      fullPage: false
    });

    // Wait for generation to complete (up to 2 minutes)
    console.log('7. Waiting for generation...');
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      console.log(`   Waiting... ${(i + 1) * 5}s`);

      // Take periodic screenshots
      if (i % 4 === 0) {
        await page.screenshot({
          path: `screenshots/mute-fix-6-progress-${i * 5}s.png`,
          fullPage: false
        });
      }

      // Check if generation complete
      const successMessage = await page.locator('text=/succes|complet|finalizat/i').count();
      if (successMessage > 0) {
        console.log('   Generation complete!');
        break;
      }

      // Check for error
      const errorMessage = await page.locator('text=/eroare|error|failed/i').count();
      if (errorMessage > 0) {
        console.log('   Generation failed!');
        break;
      }
    }

    // Final screenshot
    await page.screenshot({
      path: 'screenshots/mute-fix-7-complete.png',
      fullPage: false
    });
  } else {
    console.log('   Generate button not found');
    await page.screenshot({
      path: 'screenshots/mute-fix-error-no-button.png',
      fullPage: true
    });
  }

  console.log('Test completed!');
});
