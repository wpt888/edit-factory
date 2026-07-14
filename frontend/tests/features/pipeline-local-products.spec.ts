import { test, expect } from '@playwright/test';

/**
 * Phase D1 — pipeline Step 1 context picker now sources the local Product
 * Library instead of the Gomag catalog.
 */
test('pipeline: reference context opens the local product catalog', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Browse Catalog/i }).click();
  await expect(page.getByPlaceholder('Search your products...')).toBeVisible();
  await page.screenshot({ path: 'screenshots/product-library-4-pipeline-picker.png', fullPage: true });
});
