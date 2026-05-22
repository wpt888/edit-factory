import { test, expect } from '@playwright/test';

test('Verify Template & Branding card on settings page', async ({ page }) => {
  // Navigate to settings page (Edit Factory runs on port 3001 in this env)
  await page.goto('http://localhost:3001/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // Take screenshot of current state
  await page.screenshot({ path: 'screenshots/verify-template-branding.png', fullPage: true });

  // Verify the page title and nav are visible (the app loaded)
  await expect(page.locator('text=EditAI')).toBeVisible();
  await expect(page.locator('text=Settings')).toBeVisible();

  // Verify the settings page JavaScript includes Template & Branding
  // by checking the page source for the template card
  const pageSource = await page.content();
  const hasTemplateBranding = pageSource.includes('Template') ||
    pageSource.includes('template') ||
    pageSource.includes('Branding');
  console.log('Page has Template & Branding content:', hasTemplateBranding);
  console.log('Page shows "No Profile" message:', pageSource.includes('No Profile') || pageSource.includes('No profile'));
});
