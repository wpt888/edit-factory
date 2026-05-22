import { test, expect } from '@playwright/test';

test('Verify 61-02: Check Library/Trash buttons exist', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Check for Library button
  const libraryBtn = page.getByRole('button', { name: 'Library' });
  const trashBtn = page.getByRole('button', { name: /Trash/ });

  console.log('Library button count:', await libraryBtn.count());
  console.log('Trash button count:', await trashBtn.count());

  await page.screenshot({ path: 'screenshots/61-02-check-buttons.png', fullPage: true });

  // Check if Library button exists
  await expect(libraryBtn).toBeVisible();
  await expect(trashBtn).toBeVisible();
});
