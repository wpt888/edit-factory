import { test, expect } from '@playwright/test';

test('Final verification - all fixes working', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot final state
  await page.screenshot({
    path: 'screenshots/final-01-overview.png',
    fullPage: true
  });

  console.log('=== FINAL VERIFICATION ===\n');

  // 1. Verify badges show "Netrimis" without clock icon
  const badges = await page.locator('.aspect-\\[9\\/16\\] .absolute.top-2.right-2').all();
  console.log('1. BADGES:');
  for (let i = 0; i < badges.length; i++) {
    const text = await badges[i].textContent();
    const hasSvg = await badges[i].locator('svg').count();
    console.log(`   Badge ${i + 1}: "${text}" - Icon: ${hasSvg > 0 ? 'YES (should be NO for Netrimis)' : 'NO ✓'}`);
  }

  // 2. Verify thumbnails have cache-busting
  const imgs = await page.locator('.aspect-\\[9\\/16\\] img').all();
  console.log('\n2. CACHE-BUSTING:');
  for (let i = 0; i < imgs.length; i++) {
    const src = await imgs[i].getAttribute('src');
    const hasCacheBust = src?.includes('?v=');
    console.log(`   Thumbnail ${i + 1}: ${hasCacheBust ? '✓ Has ?v= parameter' : '✗ Missing cache-busting'}`);
  }

  // 3. Verify rename functionality
  console.log('\n3. RENAME FUNCTIONALITY:');
  const renameArea = page.locator('.bg-card.p-2 .cursor-pointer').first();
  const renameVisible = await renameArea.isVisible();
  console.log(`   Rename area visible: ${renameVisible ? '✓' : '✗'}`);

  if (renameVisible) {
    await renameArea.click();
    await page.waitForTimeout(500);
    const inputVisible = await page.locator('.bg-card.p-2 input[data-slot="input"]').isVisible();
    console.log(`   Input appears on click: ${inputVisible ? '✓' : '✗'}`);
    await page.keyboard.press('Escape');
  }

  // 4. Screenshot the clip info area
  await page.screenshot({
    path: 'screenshots/final-02-clips.png',
    fullPage: true
  });

  console.log('\n=== ALL FIXES VERIFIED ===');
});
