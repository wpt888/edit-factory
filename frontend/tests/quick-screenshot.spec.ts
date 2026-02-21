import { test } from '@playwright/test';

test('quick screenshot of librarie with multi-select', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Take screenshot of the page
  await page.screenshot({
    path: 'screenshots/librarie-multiselect-ui.png',
    fullPage: true
  });

  console.log('Screenshot taken');
});
