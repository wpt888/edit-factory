import { test } from '@playwright/test';

test('Verify Template & Branding card on settings page', async ({ page }) => {
  // Navigate to settings page (Edit Factory runs on port 3001 in this env)
  await page.goto('http://localhost:3001/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(5000);

  // Screenshot initial state (may show "No Profile" message or loading)
  await page.screenshot({ path: 'screenshots/verify-template-branding.png', fullPage: true });

  // Check if we see the "No Profile" message or loading state
  const pageContent = await page.textContent('body');
  console.log('Page text excerpt:', pageContent?.substring(0, 200));
});
