import { test } from '@playwright/test';

test('Verify catalog picker on Pipeline page', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Screenshot 1: Pipeline page with "Add from Catalog" button visible
  await page.screenshot({ path: 'screenshots/pipeline-catalog-button.png', fullPage: true });

  // Click "Add from Catalog" to open picker
  const catalogBtn = page.getByRole('button', { name: /Add from Catalog/i });
  if (await catalogBtn.isVisible()) {
    await catalogBtn.click();
    await page.waitForTimeout(2000); // Wait for products to load

    // Screenshot 2: Catalog picker open with products
    await page.screenshot({ path: 'screenshots/pipeline-catalog-open.png', fullPage: true });
  }
});
