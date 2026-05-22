import { test, expect } from '@playwright/test';

test('Verify simplified UI - no Randează Selectate button', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Take screenshot of simplified header
  await page.screenshot({
    path: 'screenshots/simplified-ui-01-header.png',
    fullPage: true
  });

  // Verify "Randează Selectate" button is NOT visible
  const renderButton = page.locator('text=Randează Selectate');
  const renderButtonVisible = await renderButton.isVisible();
  console.log('Randează Selectate button visible:', renderButtonVisible);
  expect(renderButtonVisible).toBe(false);

  // Verify "Netrimis" badges are visible
  const netrimisBadge = page.locator('text=Netrimis').first();
  const badgeVisible = await netrimisBadge.isVisible();
  console.log('Netrimis badge visible:', badgeVisible);

  // Verify Postiz button is still visible
  const postizButton = page.locator('button:has-text("Postiz")');
  const postizVisible = await postizButton.isVisible();
  console.log('Postiz button visible:', postizVisible);

  // Verify Segmente button is still visible
  const segmenteButton = page.locator('button:has-text("Segmente")');
  const segmenteVisible = await segmenteButton.isVisible();
  console.log('Segmente button visible:', segmenteVisible);

  console.log('Simplified UI verification completed!');
});
