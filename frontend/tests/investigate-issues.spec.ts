import { test, expect } from '@playwright/test';

test('Investigate current UI issues', async ({ page }) => {
  // Navigate to library
  await page.goto('http://localhost:3001/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on "Armaf Bliss" project
  await page.locator('text=Armaf Bliss').click();
  await page.waitForTimeout(3000);

  // Screenshot 1: Overview of clips
  await page.screenshot({
    path: 'screenshots/investigate-01-overview.png',
    fullPage: true
  });

  // Check badge content
  const badges = await page.locator('.aspect-\\[9\\/16\\] .absolute.top-2.right-2').all();
  console.log('\n=== BADGE ANALYSIS ===');
  for (let i = 0; i < badges.length; i++) {
    const badgeText = await badges[i].textContent();
    const badgeHtml = await badges[i].innerHTML();
    console.log(`Badge ${i + 1}: "${badgeText}"`);
    console.log(`  HTML: ${badgeHtml.substring(0, 200)}...`);
  }

  // Screenshot 2: Zoom on first clip
  const firstClip = page.locator('.aspect-\\[9\\/16\\]').first();
  await firstClip.screenshot({
    path: 'screenshots/investigate-02-first-clip.png'
  });

  // Check clip info area (where rename should be)
  console.log('\n=== CLIP INFO ANALYSIS ===');
  const clipInfoAreas = await page.locator('.bg-card.p-2').all();
  console.log(`Found ${clipInfoAreas.length} clip info areas`);

  for (let i = 0; i < Math.min(clipInfoAreas.length, 3); i++) {
    const html = await clipInfoAreas[i].innerHTML();
    console.log(`Clip info ${i + 1}: ${html.substring(0, 300)}...`);
  }

  // Try to find the rename button by hovering
  console.log('\n=== TESTING RENAME HOVER ===');
  const clipNameArea = page.locator('.bg-card .group').first();
  const groupExists = await clipNameArea.count();
  console.log(`Group elements found: ${groupExists}`);

  if (groupExists > 0) {
    // Force hover using JavaScript
    await page.evaluate(() => {
      const group = document.querySelector('.bg-card .group');
      if (group) {
        group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        console.log('Hover triggered');
      }
    });
    await page.waitForTimeout(1000);

    // Screenshot after hover
    await page.screenshot({
      path: 'screenshots/investigate-03-after-hover.png',
      fullPage: true
    });

    // Check for pencil button
    const pencilButtons = await page.locator('.bg-card button svg').all();
    console.log(`Pencil/button SVGs found: ${pencilButtons.length}`);
  }

  // Screenshot 3: Full page for reference
  await page.screenshot({
    path: 'screenshots/investigate-04-full.png',
    fullPage: true
  });

  console.log('\n=== INVESTIGATION COMPLETE ===');
});
