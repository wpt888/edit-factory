import { test, expect } from '@playwright/test';

test('Test new Librărie page', async ({ page }) => {
  // Navigate to the new Librărie page
  await page.goto('http://localhost:3001/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot initial state
  await page.screenshot({
    path: 'screenshots/librarie-01-initial.png',
    fullPage: true
  });

  // Verify page title
  const title = page.locator('h1');
  await expect(title).toHaveText('Librărie');
  console.log('✓ Page title is "Librărie"');

  // Verify filters are visible
  const searchInput = page.locator('input[placeholder*="Caută"]');
  await expect(searchInput).toBeVisible();
  console.log('✓ Search input visible');

  const subtitlesFilter = page.locator('text=Subtitrări').first();
  await expect(subtitlesFilter).toBeVisible();
  console.log('✓ Subtitles filter visible');

  const voiceoverFilter = page.locator('text=Voiceover').first();
  await expect(voiceoverFilter).toBeVisible();
  console.log('✓ Voiceover filter visible');

  const postizFilter = page.locator('text=Status Postiz').first();
  await expect(postizFilter).toBeVisible();
  console.log('✓ Postiz filter visible');

  // Check if clips are displayed
  const clipCards = page.locator('.aspect-\\[9\\/16\\]');
  const clipCount = await clipCards.count();
  console.log(`Found ${clipCount} clips in library`);

  if (clipCount > 0) {
    // Screenshot with clips
    await page.screenshot({
      path: 'screenshots/librarie-02-clips.png',
      fullPage: true
    });

    // Verify clip card elements
    const firstClip = clipCards.first();

    // Check for Postiz badge
    const badge = firstClip.locator('.absolute.top-2.right-2');
    const badgeText = await badge.textContent();
    console.log(`First clip Postiz status: "${badgeText}"`);

    // Test URL tracking - apply filter
    const subtitlesSelect = page.locator('[data-slot="trigger"]').nth(0);
    await subtitlesSelect.click();
    await page.waitForTimeout(500);

    // Screenshot filter dropdown
    await page.screenshot({
      path: 'screenshots/librarie-03-filter-dropdown.png',
      fullPage: true
    });

    // Select "Cu subtitrări"
    await page.locator('text=Cu subtitrări').click();
    await page.waitForTimeout(500);

    // Verify URL updated
    const url = page.url();
    console.log('URL after filter:', url);
    expect(url).toContain('subtitles=');

    // Screenshot after filter
    await page.screenshot({
      path: 'screenshots/librarie-04-filtered.png',
      fullPage: true
    });

    // Test Postiz modal
    await page.locator('.aspect-\\[9\\/16\\]').first().hover();
    await page.waitForTimeout(500);

    // Click share button (Postiz)
    const shareButton = page.locator('.aspect-\\[9\\/16\\]').first().locator('button').last();
    await shareButton.click();
    await page.waitForTimeout(500);

    // Screenshot Postiz modal
    await page.screenshot({
      path: 'screenshots/librarie-05-postiz-modal.png',
      fullPage: true
    });

    // Verify modal is open
    const modalTitle = page.locator('text=Publică pe Social Media');
    await expect(modalTitle).toBeVisible();
    console.log('✓ Postiz modal opens');

    // Close modal
    await page.locator('button:has-text("Anulează")').click();
    await page.waitForTimeout(500);
  }

  console.log('\n=== LIBRĂRIE PAGE TEST COMPLETED ===');
});

test('Verify navbar has both Export and Librărie tabs', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.waitForLoadState('networkidle');

  // Screenshot homepage navbar
  await page.screenshot({
    path: 'screenshots/navbar-01.png',
    fullPage: false
  });

  // Verify Librărie tab exists
  const librarieTab = page.locator('nav a:has-text("Librărie")');
  await expect(librarieTab).toBeVisible();
  console.log('✓ Librărie tab visible');

  // Verify Export tab exists
  const exportTab = page.locator('nav a:has-text("Export")');
  await expect(exportTab).toBeVisible();
  console.log('✓ Export tab visible');

  // Click on Librărie
  await librarieTab.click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/librarie/);
  console.log('✓ Librărie tab navigates correctly');

  // Click on Export
  await page.locator('nav a:has-text("Export")').click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/library/);
  console.log('✓ Export tab navigates correctly');

  console.log('\n=== NAVBAR TEST COMPLETED ===');
});
