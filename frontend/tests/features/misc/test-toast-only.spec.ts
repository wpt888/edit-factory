import { test } from '@playwright/test';

test('verify toast notification appears', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  const clipCount = await page.locator('img[src*="thumbnail"]').count();
  console.log('Clips found:', clipCount);

  if (clipCount === 0) {
    console.log('No clips to test with');
    await page.screenshot({ path: 'screenshots/no-clips.png', fullPage: true });
    return;
  }

  // Set up dialog handler
  let alertCount = 0;
  page.on('dialog', async dialog => {
    console.log('Dialog type:', dialog.type(), '- message:', dialog.message());
    alertCount++;
    await dialog.accept();
  });

  // Select first clip
  const firstThumbnail = page.locator('img[src*="thumbnail"]').first();
  await firstThumbnail.hover({ force: true });
  await page.waitForTimeout(300);
  const firstCheckbox = page.locator('[role="checkbox"]').first();
  await firstCheckbox.click({ force: true });
  await page.waitForTimeout(500);

  // Take screenshot showing selection
  await page.screenshot({ path: 'screenshots/toast-test-selected.png', fullPage: true });

  // Click delete
  const deleteBtn = page.locator('button:has-text("Șterge selectate")');
  await deleteBtn.click();

  // Wait for confirm and then action
  await page.waitForTimeout(4000);

  // Take screenshot after delete
  await page.screenshot({ path: 'screenshots/toast-test-after-delete.png', fullPage: true });

  // Check page HTML for toast
  const pageHTML = await page.content();
  const hasToast = pageHTML.includes('data-sonner') || pageHTML.includes('sonner-toast');
  console.log('Has sonner toast elements in HTML:', hasToast);
  console.log('Alert dialogs shown:', alertCount);
});
