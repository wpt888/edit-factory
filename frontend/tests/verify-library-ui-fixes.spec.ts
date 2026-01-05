import { test } from '@playwright/test';

test('Verify library page UI fixes', async ({ page }) => {
  // Navigate to library page
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of the full page
  await page.screenshot({
    path: 'screenshots/library-ui-fixes-full-page.png',
    fullPage: true
  });

  console.log('Screenshot saved to screenshots/library-ui-fixes-full-page.png');
});

test('Verify library page - light and dark mode', async ({ page }) => {
  // Test light mode
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  await page.screenshot({
    path: 'screenshots/library-ui-light-mode.png',
    fullPage: true
  });

  // Toggle to dark mode
  const themeToggle = page.locator('[role="button"]').filter({ hasText: /theme/i }).first();
  if (await themeToggle.count() > 0) {
    await themeToggle.click();
    await page.waitForTimeout(500);
  } else {
    // Try to add dark class manually
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(500);
  }

  await page.screenshot({
    path: 'screenshots/library-ui-dark-mode.png',
    fullPage: true
  });

  console.log('Light and dark mode screenshots saved');
});
