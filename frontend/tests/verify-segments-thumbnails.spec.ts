import { test } from '@playwright/test';

test('Verify video plays after seeking', async ({ page }) => {
  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Switch to Nortia profile
  const profileDropdown = page.locator('button:has-text("Default")').first();
  if (await profileDropdown.isVisible()) {
    await profileDropdown.click();
    await page.waitForTimeout(500);
    const nortiaOption = page.locator('text=Nortia').first();
    if (await nortiaOption.isVisible()) {
      await nortiaOption.click();
      await page.waitForTimeout(3000);
    }
  }

  // Click on the source video
  const videoItem = page.locator('text=New Jilin').first();
  if (await videoItem.isVisible()) {
    await videoItem.click();
    await page.waitForTimeout(4000);
  }

  // Seek to 10 seconds and take screenshot
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = 10;
    }
  });
  await page.waitForTimeout(2000);

  // Check video state after seeking
  const videoState = await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return 'NO VIDEO';
    return {
      currentTime: video.currentTime,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      paused: video.paused,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
    };
  });
  console.log('VIDEO STATE AT 10s:', JSON.stringify(videoState, null, 2));

  await page.screenshot({ path: 'screenshots/segments-video-seek.png', fullPage: true });

  // Also try playing briefly
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (video) video.play();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (video) video.pause();
  });

  await page.screenshot({ path: 'screenshots/segments-video-playing.png', fullPage: true });
});
