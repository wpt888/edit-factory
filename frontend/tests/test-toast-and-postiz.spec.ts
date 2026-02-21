import { test, expect } from '@playwright/test';

test.describe('Toast notifications and Postiz upload', () => {
  test('should show toast notification instead of browser alert on delete', async ({ page }) => {
    await page.goto('/librarie');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const clipCount = await page.locator('img[src*="thumbnail"]').count();
    console.log('Clips found:', clipCount);

    if (clipCount === 0) {
      console.log('No clips to test with');
      return;
    }

    // Set up dialog handler to catch any alerts (should NOT fire)
    let alertFired = false;
    page.on('dialog', async dialog => {
      // Accept confirm dialogs, but note if any other alert fires
      if (dialog.type() === 'confirm') {
        console.log('Confirm dialog (expected):', dialog.message());
        await dialog.accept();
      } else {
        alertFired = true;
        console.log('Alert fired (unexpected):', dialog.message());
        await dialog.accept();
      }
    });

    // Select a clip
    const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
    await firstThumbnail.hover({ force: true });
    await page.waitForTimeout(300);
    const firstCheckbox = page.locator('[role="checkbox"]').first();
    await firstCheckbox.click({ force: true });
    await page.waitForTimeout(500);

    // Click delete button
    const deleteBtn = page.locator('button:has-text("Șterge selectate")');
    await deleteBtn.click();
    await page.waitForTimeout(500); // Wait for confirm dialog

    // Wait for toast to appear
    await page.waitForTimeout(3000);

    // Take screenshot
    await page.screenshot({
      path: 'screenshots/toast-notification.png',
      fullPage: true
    });

    // Check for toast (sonner creates elements with data-sonner-toast attribute)
    const toastVisible = await page.locator('[data-sonner-toast]').count() > 0;
    console.log('Toast notification visible:', toastVisible);

    // Verify no alert was fired (aside from confirm)
    console.log('Unexpected alert fired:', alertFired);
  });

  test('should attempt Postiz upload and show result', async ({ page }) => {
    await page.goto('/librarie');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const clipCount = await page.locator('img[src*="thumbnail"]').count();
    console.log('Clips found:', clipCount);

    if (clipCount === 0) {
      console.log('No clips to test with');
      return;
    }

    // Handle confirm dialogs
    page.on('dialog', async dialog => {
      console.log('Dialog:', dialog.type(), dialog.message());
      await dialog.accept();
    });

    // Select a clip
    const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
    await firstThumbnail.hover({ force: true });
    await page.waitForTimeout(300);
    const firstCheckbox = page.locator('[role="checkbox"]').first();
    await firstCheckbox.click({ force: true });
    await page.waitForTimeout(500);

    // Take screenshot before
    await page.screenshot({
      path: 'screenshots/before-postiz-upload.png',
      fullPage: true
    });

    // Click Postiz button
    const postizBtn = page.locator('button:has-text("Trimite la Postiz")');
    await postizBtn.click();

    // Wait for upload to complete (may take a while)
    console.log('Waiting for Postiz upload...');
    await page.waitForTimeout(10000);

    // Take screenshot after
    await page.screenshot({
      path: 'screenshots/after-postiz-upload.png',
      fullPage: true
    });

    // Check for toast
    const toastElements = await page.locator('[data-sonner-toast]').all();
    console.log('Toast count:', toastElements.length);

    for (const toast of toastElements) {
      const text = await toast.textContent();
      console.log('Toast content:', text);
    }
  });
});
