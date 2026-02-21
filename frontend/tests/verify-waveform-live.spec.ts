import { test } from '@playwright/test';

test('Verify waveform on segments page with video selected', async ({ page }) => {
  // Go to segments page
  await page.goto('http://localhost:3001/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot the initial state
  await page.screenshot({ path: 'screenshots/waveform-01-initial.png', fullPage: true });

  // Check if there are source videos in the left sidebar
  const videoItems = page.locator('.group.flex.items-center.gap-2.p-2');
  const count = await videoItems.count();
  console.log(`Found ${count} source videos in sidebar`);

  if (count > 0) {
    // Click the first video
    await videoItems.first().click();
    await page.waitForTimeout(3000); // Wait for waveform to load

    await page.screenshot({ path: 'screenshots/waveform-02-video-selected.png', fullPage: true });

    // Check if waveform/voice buttons exist
    const waveformBtn = page.locator('button:has-text("Waveform")');
    const voiceBtn = page.locator('button:has-text("Voice")');
    console.log(`Waveform button visible: ${await waveformBtn.isVisible()}`);
    console.log(`Voice button visible: ${await voiceBtn.isVisible()}`);

    // Check if canvas exists
    const canvas = page.locator('canvas');
    console.log(`Canvas elements found: ${await canvas.count()}`);
  }
});
