import { test } from '@playwright/test';

test('Verify 61-02: Library with trash toggle', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'screenshots/61-02-updated.png', fullPage: false });

  const libraryBtns = await page.locator('button:has-text("Library")').count();
  const trashBtns = await page.locator('button:has-text("Trash")').count();
  const allBtns = await page.locator('button').allTextContents();
  console.log(`Library buttons: ${libraryBtns}, Trash buttons: ${trashBtns}`);
  console.log('Buttons:', allBtns.filter(t => t.trim()).slice(0, 15));
});
