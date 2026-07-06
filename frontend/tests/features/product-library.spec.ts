import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Phase D1 verification — local Product Library.
 * Opens the page, adds a product with a test image, generates the AI
 * description (real Gemini Vision call), saves, and screenshots each step.
 */
test('product library: add product with image + AI description', async ({ page }) => {
  test.setTimeout(180000);

  await page.goto('/product-library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/product-library-1-list.png', fullPage: true });

  // Open the Add Product dialog
  await page.getByTestId('add-product').click();
  await page.getByLabel('Title').fill('Parfum Oud Royal 50ml');

  // Upload the fixture image (hidden input behind the drop zone)
  await page
    .getByTestId('image-input')
    .setInputFiles(path.join(__dirname, '../fixtures/test-product.jpg'));
  await page.waitForTimeout(500);

  // Generate description from image + title via Gemini Vision
  await page.getByTestId('generate-description').click();
  await expect(page.locator('#product-description')).not.toHaveValue('', { timeout: 90000 });
  await page.screenshot({ path: 'screenshots/product-library-2-generated.png', fullPage: true });

  // Save and verify the product card appears in the grid
  await page.getByTestId('save-product').click();
  await expect(page.getByTestId('product-card').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Parfum Oud Royal 50ml').first()).toBeVisible();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/product-library-3-saved.png', fullPage: true });
});
