import { test } from '@playwright/test';

test('click delete button directly', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Count initial clips
  const initialCount = await page.locator('img[src*="thumbnail"]').count();
  console.log('Initial clips:', initialCount);

  // Set up dialog handler BEFORE clicking
  page.on('dialog', async dialog => {
    console.log('Dialog appeared:', dialog.message());
    await dialog.accept();
  });

  // Find the delete button and click it directly using force
  const deleteBtn = page.locator('button[title="Șterge clipul definitiv"]').first();

  console.log('Clicking delete button...');
  await deleteBtn.click({ force: true });

  await page.waitForTimeout(3000);

  // Check new count
  const newCount = await page.locator('img[src*="thumbnail"]').count();
  console.log('Clips after delete:', newCount);

  if (newCount < initialCount) {
    console.log('SUCCESS! Clip was deleted.');
  } else {
    console.log('Clip count unchanged - delete may have failed');
  }

  await page.screenshot({
    path: 'screenshots/after-delete-test.png',
    fullPage: true
  });
});
