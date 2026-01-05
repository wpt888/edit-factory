import { test, expect } from '@playwright/test';

test('Screenshot after saving segments', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Click on "Timer Test" project
  await page.locator('text=Timer Test').first().click();
  await page.waitForTimeout(1000);

  // Click Segmente tab/button
  await page.locator('button').filter({ hasText: /^Segmente$/ }).first().click();
  await page.waitForTimeout(500);

  // This opens the modal - check if already has segments
  // If modal is open, save them
  const saveBtn = page.locator('button:has-text("Salvează Selecția")');
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
    await page.waitForTimeout(2000);
  }

  // Take screenshot of the main page after modal closes
  // This should show the generate button
  await page.screenshot({
    path: 'screenshots/FINAL-after-save.png',
    fullPage: true
  });

  // Also scroll down to see everything
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/FINAL-scrolled.png',
    fullPage: true
  });

  console.log('\n=== SCREENSHOTS SAVED ===');
  console.log('Check: frontend/screenshots/FINAL-after-save.png');
  console.log('Check: frontend/screenshots/FINAL-scrolled.png');
});
