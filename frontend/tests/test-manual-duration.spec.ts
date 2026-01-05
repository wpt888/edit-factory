import { test, expect } from '@playwright/test';

test('Test manual duration setting (15 seconds)', async ({ page }) => {
  // Navigate to the project in segments mode
  const projectId = '4b310ada-0fc5-4d54-983a-b554d5203faf';
  await page.goto(`http://localhost:3001/library?project=${projectId}&mode=segments`);

  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of initial state
  await page.screenshot({
    path: 'screenshots/duration-test-01-initial.png',
    fullPage: true
  });

  // Check if we need to click "Resetează pentru Generare Nouă" button
  const resetButton = page.locator('button:has-text("Resetează pentru Generare Nouă")');
  if (await resetButton.isVisible()) {
    console.log('Clicking reset button to access generation UI...');
    await resetButton.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot after reset
  await page.screenshot({
    path: 'screenshots/duration-test-02-after-reset.png',
    fullPage: true
  });

  // Now find and set the duration slider to 15 seconds
  const slider = page.locator('[role="slider"]').first();

  // Wait for slider to be visible
  await slider.waitFor({ state: 'visible', timeout: 10000 });

  // Get the slider's bounding box
  const sliderBox = await slider.boundingBox();
  if (sliderBox) {
    // We need to set to 15 seconds. The range is 10-60, so 15 is 5/50 = 10% from the left
    const targetX = sliderBox.x + (sliderBox.width * 0.1); // 10% for 15 seconds
    await page.mouse.click(targetX, sliderBox.y + sliderBox.height / 2);
    await page.waitForTimeout(500);
  }

  // Take screenshot after setting duration
  await page.screenshot({
    path: 'screenshots/duration-test-03-slider-set.png',
    fullPage: true
  });

  // Click the generate button
  const generateButton = page.locator('button:has-text("GENEREAZĂ")').first();
  await generateButton.click();

  // Wait for generation to start
  await page.waitForTimeout(2000);

  // Take screenshot showing generation started
  await page.screenshot({
    path: 'screenshots/duration-test-04-generating.png',
    fullPage: true
  });

  // Wait for generation to complete (poll for status change)
  let attempts = 0;
  const maxAttempts = 60; // 120 seconds max

  while (attempts < maxAttempts) {
    await page.waitForTimeout(2000);

    // Check if we see "pending" badges which indicate clips are created
    const pendingBadges = await page.locator('text=pending').count();
    const readyBadges = await page.locator('text=ready').count();

    if (pendingBadges > 0 || readyBadges > 0) {
      console.log(`Generation complete! Found ${pendingBadges} pending, ${readyBadges} ready clips`);
      break;
    }

    // Also check for clips in the UI
    const clipCards = await page.locator('[class*="clip"]').count();
    if (clipCards > 0) {
      console.log(`Found ${clipCards} clip cards`);
      break;
    }

    attempts++;
    console.log(`Waiting for generation... attempt ${attempts}/${maxAttempts}`);
  }

  // Take final screenshot
  await page.screenshot({
    path: 'screenshots/duration-test-05-complete.png',
    fullPage: true
  });

  // Now let's verify the durations by checking the API
  const response = await page.request.get(`http://localhost:8000/projects/${projectId}/clips`);
  const clips = await response.json();

  console.log('\n=== DURATION VERIFICATION ===');
  console.log('Generated clips:');
  for (const clip of clips) {
    console.log(`  Variant ${clip.variant_index}: ${clip.duration}s (target: 15s)`);
    // Each clip should be approximately 15 seconds (with some tolerance)
    expect(clip.duration).toBeLessThanOrEqual(16); // Allow 1 second tolerance
    expect(clip.duration).toBeGreaterThanOrEqual(10); // At least 10 seconds
  }
  console.log('=== END VERIFICATION ===\n');
});
