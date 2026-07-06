import { test, expect } from '@playwright/test';

/**
 * Phase D1 — pipeline Step 1 context picker now sources the local Product
 * Library instead of the Gomag catalog.
 */
test('pipeline: context picker lists local library products', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Add from My Products/i }).click();
  await expect(page.getByText('Parfum Oud Royal 50ml').first()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: 'screenshots/product-library-4-pipeline-picker.png', fullPage: true });
});
