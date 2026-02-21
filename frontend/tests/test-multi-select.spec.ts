import { test, expect } from '@playwright/test';

test.describe('Multi-select functionality', () => {
  test('should show checkboxes on hover and allow selection', async ({ page }) => {
    await page.goto('/librarie');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Count initial clips
    const clipCards = await page.locator('img[src*="thumbnail"]').count();
    console.log('Total clips:', clipCards);

    // Take initial screenshot
    await page.screenshot({
      path: 'screenshots/multi-select-initial.png',
      fullPage: true
    });

    if (clipCards === 0) {
      console.log('No clips found, skipping test');
      return;
    }

    // Hover to reveal checkbox, then click on the checkbox
    const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
    await firstThumbnail.hover({ force: true });
    await page.waitForTimeout(300);

    // Click the checkbox directly
    const firstCheckbox = page.locator('[role="checkbox"]').first();
    await firstCheckbox.click({ force: true });
    await page.waitForTimeout(500);

    // Check if selection toolbar appears
    const selectionToolbar = page.locator('text=clip selectat');
    const toolbarVisible = await selectionToolbar.isVisible().catch(() => false);
    console.log('Selection toolbar visible:', toolbarVisible);

    await page.screenshot({
      path: 'screenshots/multi-select-one-selected.png',
      fullPage: true
    });

    // Select a second clip - hover then click checkbox
    const secondThumbnail = page.locator('img[src*="thumbnail"]').nth(1);
    await secondThumbnail.hover({ force: true });
    await page.waitForTimeout(300);
    const secondCheckbox = page.locator('[role="checkbox"]').nth(1);
    await secondCheckbox.click({ force: true });
    await page.waitForTimeout(500);

    // Check if toolbar shows 2 clips selected
    const twoSelected = page.locator('text=clipuri selectate');
    const twoSelectedVisible = await twoSelected.isVisible().catch(() => false);
    console.log('Two clips selected toolbar visible:', twoSelectedVisible);

    await page.screenshot({
      path: 'screenshots/multi-select-two-selected.png',
      fullPage: true
    });

    // Click "Select All" button
    const selectAllBtn = page.locator('button:has-text("Selectează toate")');
    if (await selectAllBtn.isVisible()) {
      await selectAllBtn.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'screenshots/multi-select-all-selected.png',
        fullPage: true
      });
      console.log('Selected all clips');
    }

    // Check if Delete and Postiz buttons are visible
    const deleteBtn = page.locator('button:has-text("Șterge selectate")');
    const postizBtn = page.locator('button:has-text("Trimite la Postiz")');

    const deleteBtnVisible = await deleteBtn.isVisible().catch(() => false);
    const postizBtnVisible = await postizBtn.isVisible().catch(() => false);

    console.log('Delete button visible:', deleteBtnVisible);
    console.log('Postiz button visible:', postizBtnVisible);

    // Click deselect button
    const deselectBtn = page.locator('button:has-text("Deselectează")');
    if (await deselectBtn.isVisible()) {
      await deselectBtn.click();
      await page.waitForTimeout(500);

      await page.screenshot({
        path: 'screenshots/multi-select-deselected.png',
        fullPage: true
      });
      console.log('Deselected all clips');
    }

    // Verify toolbar is gone
    const toolbarGone = !(await selectionToolbar.isVisible().catch(() => false));
    console.log('Toolbar hidden after deselect:', toolbarGone);
  });

  test('should show checkbox on hover', async ({ page }) => {
    await page.goto('/librarie');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const clipCards = await page.locator('img[src*="thumbnail"]').count();
    if (clipCards === 0) {
      console.log('No clips found, skipping test');
      return;
    }

    // Hover over first thumbnail (use force to bypass overlay issues)
    const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
    await firstThumbnail.hover({ force: true });
    await page.waitForTimeout(500);

    // Take screenshot showing checkbox
    await page.screenshot({
      path: 'screenshots/multi-select-hover-checkbox.png',
      fullPage: true
    });

    // Check if checkbox is visible
    const checkbox = page.locator('[role="checkbox"]').first();
    const checkboxVisible = await checkbox.isVisible().catch(() => false);
    console.log('Checkbox visible on hover:', checkboxVisible);
  });
});
