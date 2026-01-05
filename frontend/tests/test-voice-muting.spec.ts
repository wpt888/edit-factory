import { test, expect } from '@playwright/test';

test('Test voice muting in segment generation', async ({ page }) => {
  test.setTimeout(120000); // 2 minutes timeout for generation

  await page.setViewportSize({ width: 1400, height: 900 });

  // Navigate to library page
  console.log('1. Navigating to library...');
  await page.goto('http://localhost:3000/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on the project "Armaf Bliss"
  console.log('2. Selecting project Armaf Bliss...');
  const projectItem = page.locator('text=Armaf Bliss');
  await expect(projectItem).toBeVisible({ timeout: 10000 });
  await projectItem.click();
  await page.waitForTimeout(2000);

  // Take screenshot of initial state
  await page.screenshot({
    path: 'screenshots/voice-mute-test-1-project-selected.png',
    fullPage: false
  });

  // Verify mute source voice is ON
  console.log('3. Checking mute source voice option...');
  const muteSwitch = page.locator('#mute-source');
  const isChecked = await muteSwitch.isChecked();
  console.log('   Mute source voice is ON:', isChecked);

  // If not checked, click it to enable
  if (!isChecked) {
    console.log('   Enabling mute source voice...');
    await muteSwitch.click();
    await page.waitForTimeout(500);
  }

  // Take screenshot showing mute option is ON
  await page.screenshot({
    path: 'screenshots/voice-mute-test-2-mute-enabled.png',
    fullPage: false
  });

  // Find and click the generate button
  console.log('4. Looking for generate button...');
  const generateButton = page.locator('button:has-text("GENEREAZĂ")').first();

  if (await generateButton.isVisible()) {
    console.log('   Found generate button, clicking...');

    // Take screenshot before clicking
    await page.screenshot({
      path: 'screenshots/voice-mute-test-3-before-generate.png',
      fullPage: false
    });

    await generateButton.click();
    console.log('   Generate button clicked!');

    // Wait for generation to start and complete
    console.log('5. Waiting for generation to complete...');

    // Wait for progress indicator or completion
    await page.waitForTimeout(5000);

    await page.screenshot({
      path: 'screenshots/voice-mute-test-4-generating.png',
      fullPage: false
    });

    // Wait up to 60 seconds for generation
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      console.log(`   Waiting... ${(i + 1) * 5}s`);

      // Check if still generating
      const progressText = await page.locator('text=/Se generează|Generating|progress/i').count();
      if (progressText === 0) {
        console.log('   Generation appears complete!');
        break;
      }
    }

    // Final screenshot
    await page.screenshot({
      path: 'screenshots/voice-mute-test-5-complete.png',
      fullPage: false
    });

  } else {
    console.log('   Generate button not found!');
    await page.screenshot({
      path: 'screenshots/voice-mute-test-error-no-button.png',
      fullPage: true
    });
  }

  console.log('Test completed!');
});
