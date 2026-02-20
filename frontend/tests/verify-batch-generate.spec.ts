import { test } from '@playwright/test';

test('Verify batch-generate page renders', async ({ page }) => {
  // Visit with a fake batch_id — page should render without crash, showing error/empty state
  await page.goto('/batch-generate?batch_id=test-batch-123');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-batch-generate-page.png', fullPage: true });
});

test('Verify batch-generate page without batch_id', async ({ page }) => {
  await page.goto('/batch-generate');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'screenshots/verify-batch-generate-no-id.png', fullPage: true });
});

test('Verify products page with checkboxes', async ({ page }) => {
  await page.goto('/products');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-products-multiselect.png', fullPage: true });
});
