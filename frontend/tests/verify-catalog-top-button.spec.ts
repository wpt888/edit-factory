import { test } from '@playwright/test';

test('Verify Add to Context button at top of catalog', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Open catalog picker
  const addFromCatalog = page.locator('button:has-text("Add from Catalog")');
  await addFromCatalog.click();
  await page.waitForTimeout(2000);

  // Screenshot 1: Catalog open, no selection
  await page.screenshot({ path: 'screenshots/catalog-no-selection.png', fullPage: true });

  // Select first product (click on the first product row)
  const firstProduct = page.locator('[role="button"]').first();
  if (await firstProduct.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstProduct.click();
    await page.waitForTimeout(300);

    // Screenshot 2: Product selected - top action bar should appear
    await page.screenshot({ path: 'screenshots/catalog-with-selection.png', fullPage: true });
  } else {
    await page.screenshot({ path: 'screenshots/catalog-no-products.png', fullPage: true });
  }
});
