import { test, expect } from '@playwright/test';

test('Verify mute source voice UI state', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:3002/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on the project
  const projectItem = page.locator('text=Armaf Bliss');
  if (await projectItem.isVisible()) {
    await projectItem.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot showing the UI state
  await page.screenshot({
    path: 'screenshots/ui-mute-state-verification.png',
    fullPage: false
  });

  // Check the mute switch
  const muteSwitch = page.locator('#mute-source');
  const count = await muteSwitch.count();
  console.log('Mute switch count:', count);

  if (count > 0) {
    const isChecked = await muteSwitch.isChecked();
    console.log('Mute switch checked:', isChecked);
    const dataState = await muteSwitch.getAttribute('data-state');
    console.log('Data state:', dataState);

    expect(isChecked).toBe(true); // Should be ON by default now
  }

  console.log('UI verification complete');
});
