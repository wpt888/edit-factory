import { test } from '@playwright/test';

test('Check waveform on segments with profile', async ({ page }) => {
  // First, get profiles to find the right one
  const profilesRes = await page.request.get('http://localhost:8000/api/v1/profiles');
  const profiles = await profilesRes.json();
  console.log('Available profiles:', JSON.stringify(profiles.map((p: any) => ({ id: p.id, name: p.name }))));

  // Use first profile (or Nortia if found)
  const profile = profiles.find((p: any) => p.name === 'Nortia') || profiles[0];
  if (!profile) {
    console.log('No profiles found, cannot proceed');
    return;
  }
  console.log('Using profile:', profile.name, profile.id);

  // Set profile in localStorage before navigating
  await page.goto('http://localhost:3001');
  await page.evaluate((pid: string) => {
    localStorage.setItem('editai_current_profile_id', pid);
  }, profile.id);

  // Navigate to segments
  await page.goto('http://localhost:3001/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'screenshots/waveform-mcp-01.png', fullPage: true });

  // Check for video items in sidebar
  const videoItems = page.locator('.group.flex.items-center.gap-2.p-2.rounded-lg');
  const count = await videoItems.count();
  console.log(`Video items in sidebar: ${count}`);

  if (count > 0) {
    // Click first video
    await videoItems.first().click();
    await page.waitForTimeout(4000); // Wait for video + waveform to load

    await page.screenshot({ path: 'screenshots/waveform-mcp-02-video-selected.png', fullPage: true });

    // Check for new UI elements
    const waveformBtn = page.getByRole('button', { name: /waveform/i });
    const voiceBtn = page.getByRole('button', { name: /voice/i });
    const canvas = page.locator('canvas');
    const timeline = page.locator('[class*="h-24"]');

    console.log(`Waveform button visible: ${await waveformBtn.isVisible().catch(() => false)}`);
    console.log(`Voice button visible: ${await voiceBtn.isVisible().catch(() => false)}`);
    console.log(`Canvas elements: ${await canvas.count()}`);
    console.log(`h-24 timeline elements: ${await timeline.count()}`);

    // Also check network for waveform request
    const waveformUrl = page.url().includes('segments') ? 'yes' : 'no';
    console.log(`On segments page: ${waveformUrl}`);
  } else {
    console.log('No videos found in sidebar');
  }
});
