import { test } from '@playwright/test';

test('Check segments page with video', async ({ page }) => {
  await page.goto('http://localhost:3001/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot initial
  await page.screenshot({ path: 'screenshots/waveform-check-01.png', fullPage: true });

  // Check for source videos
  const sidebar = page.locator('text=Source Videos');
  console.log('Source Videos header:', await sidebar.count());

  // Try clicking first video if any exist
  const videoItems = page.locator('.group.flex.items-center.gap-2.p-2.rounded-lg');
  const count = await videoItems.count();
  console.log(`Video items found: ${count}`);

  if (count > 0) {
    await videoItems.first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/waveform-check-02-selected.png', fullPage: true });

    // Check for waveform button
    const waveformBtn = page.getByRole('button', { name: /waveform/i });
    const voiceBtn = page.getByRole('button', { name: /voice/i });
    console.log(`Waveform btn: ${await waveformBtn.count()}`);
    console.log(`Voice btn: ${await voiceBtn.count()}`);

    // Check canvas
    const canvas = page.locator('canvas');
    console.log(`Canvas count: ${await canvas.count()}`);

    // Check timeline height
    const timeline = page.locator('.h-24');
    console.log(`h-24 timeline: ${await timeline.count()}`);
    const timelineOld = page.locator('.h-16');
    console.log(`h-16 timeline (old): ${await timelineOld.count()}`);
  }

  // Check current URL
  console.log('Current URL:', page.url());
});
