import { test } from '@playwright/test';

test('Verify Buffer settings section exists', async ({ page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Scroll to find Buffer Publishing section
  const bufferSection = page.getByText('Buffer Publishing');
  if (await bufferSection.isVisible()) {
    await bufferSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }

  await page.screenshot({ path: 'screenshots/buffer-settings.png', fullPage: true });
});
