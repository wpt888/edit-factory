import { test } from '@playwright/test';

test('Verify QC checkbox and regenerate voiceover on library page', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/verify-qc-feature.png', fullPage: true });
});

test('Verify video player popup with QC controls', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  
  // Hover over first clip card to reveal play button
  const firstCard = page.locator('.grid .overflow-hidden').first();
  await firstCard.hover();
  await page.waitForTimeout(500);
  
  // Click play button
  const playButton = firstCard.locator('button:has(svg)').first();
  await playButton.click();
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'screenshots/verify-qc-popup.png', fullPage: false });
});
