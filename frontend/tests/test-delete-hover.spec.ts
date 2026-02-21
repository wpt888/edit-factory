import { test, expect } from '@playwright/test';

test('hover on clip card to reveal delete button', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Find first clip card with thumbnail
  const firstClipCard = page.locator('.aspect-video').first();

  // Hover over the card
  await firstClipCard.hover();
  await page.waitForTimeout(500);

  // Take screenshot after hover
  await page.screenshot({
    path: 'screenshots/librarie-hover.png',
    fullPage: true
  });

  // Look for delete button after hover
  const deleteBtn = page.locator('button:has(svg.lucide-trash-2)').first();
  const isVisible = await deleteBtn.isVisible().catch(() => false);
  console.log('Delete button visible after hover:', isVisible);

  // Click on a card to see if overlay appears
  await firstClipCard.click();
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/librarie-clicked.png',
    fullPage: true
  });

  // Check all buttons on the page
  const buttons = await page.locator('button').all();
  for (let i = 0; i < Math.min(buttons.length, 20); i++) {
    const btn = buttons[i];
    const text = await btn.textContent();
    const title = await btn.getAttribute('title');
    const isVis = await btn.isVisible();
    if (title || text) {
      console.log(`Button ${i}: "${text?.trim()}" title="${title}" visible=${isVis}`);
    }
  }
});

test('test delete functionality', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Count initial clips
  const initialClipCount = await page.locator('.aspect-video').count();
  console.log('Initial clip count:', initialClipCount);

  // Find and hover over first clip
  const firstClip = page.locator('.aspect-video').first();
  await firstClip.hover();
  await page.waitForTimeout(500);

  // Try to find delete button
  const deleteBtn = page.locator('button[title*="Șterge"], button:has(.lucide-trash-2)').first();

  if (await deleteBtn.isVisible()) {
    console.log('Delete button found! Clicking...');

    // Set up dialog handler
    page.on('dialog', async dialog => {
      console.log('Dialog message:', dialog.message());
      await dialog.accept(); // Click OK on confirm
    });

    await deleteBtn.click();
    await page.waitForTimeout(2000);

    // Check if clip was removed
    const newClipCount = await page.locator('.aspect-video').count();
    console.log('New clip count:', newClipCount);

    await page.screenshot({
      path: 'screenshots/librarie-after-delete.png',
      fullPage: true
    });
  } else {
    console.log('Delete button not visible. Taking debug screenshot...');
    await page.screenshot({
      path: 'screenshots/librarie-no-delete-btn.png',
      fullPage: true
    });
  }
});
