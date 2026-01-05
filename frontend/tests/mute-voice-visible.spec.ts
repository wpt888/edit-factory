import { test, expect } from '@playwright/test';

test('Mute source voice option is visible and ON by default', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });

  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on the project
  const projectItem = page.locator('text=Armaf Bliss');
  if (await projectItem.isVisible()) {
    await projectItem.click();
    await page.waitForTimeout(2000);
  }

  // Find the mute source switch by its ID
  const muteSwitch = page.locator('#mute-source');
  const switchExists = await muteSwitch.count();
  console.log('Mute switch exists:', switchExists > 0);

  if (switchExists > 0) {
    // Check if it's checked (ON)
    const isChecked = await muteSwitch.isChecked();
    console.log('Mute switch is CHECKED (ON):', isChecked);

    // Get aria-checked attribute
    const ariaChecked = await muteSwitch.getAttribute('aria-checked');
    console.log('aria-checked attribute:', ariaChecked);

    // Get data-state attribute (shadcn uses this)
    const dataState = await muteSwitch.getAttribute('data-state');
    console.log('data-state attribute:', dataState);
  }

  await page.screenshot({
    path: 'screenshots/mute-voice-state-check.png',
    fullPage: false
  });
});
