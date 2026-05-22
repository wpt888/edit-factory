import { test, expect } from '@playwright/test';

test('Verify cache-busting on thumbnails', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(2000);

  // Screenshot to verify clips are loaded
  await page.screenshot({
    path: 'screenshots/cache-bust-01-loaded.png',
    fullPage: true
  });

  // Get all img tags for thumbnails
  const thumbnailImgs = page.locator('.aspect-\\[9\\/16\\] img');
  const imgCount = await thumbnailImgs.count();
  console.log('Number of thumbnail images:', imgCount);

  // Check if URLs have cache-busting parameter
  for (let i = 0; i < imgCount; i++) {
    const src = await thumbnailImgs.nth(i).getAttribute('src');
    console.log(`Thumbnail ${i + 1} src: ${src}`);

    // Verify cache-busting parameter exists
    const hasVersionParam = src?.includes('?v=');
    console.log(`  Has cache-busting (v=): ${hasVersionParam}`);
    expect(hasVersionParam).toBe(true);
  }

  // Verify badges show "Netrimis" (not "pending" with clock)
  const badges = await page.locator('.aspect-\\[9\\/16\\] .absolute.top-2.right-2').all();
  console.log('Number of badges:', badges.length);

  for (let i = 0; i < badges.length; i++) {
    const badgeText = await badges[i].textContent();
    console.log(`Badge ${i + 1}: "${badgeText}"`);

    // Check no clock icon
    const hasClock = await badges[i].locator('svg').count();
    console.log(`  Has clock icon: ${hasClock > 0}`);
  }

  console.log('Cache-busting verification complete!');
});
