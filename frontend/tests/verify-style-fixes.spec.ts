import { test } from '@playwright/test';

test('Verify library page style fixes', async ({ page }) => {
  // Navigate to library page
  await page.goto('http://localhost:3000/library');
  await page.waitForLoadState('networkidle');

  // Wait for projects to load
  await page.waitForSelector('text=Timer Test', { timeout: 10000 });

  // Click on a project to show workflow panel
  await page.click('text=Timer Test');
  await page.waitForTimeout(1000);

  // Scroll to workflow steps
  const workflowPanel = page.locator('text=Pas 1: Script & Audio').first();
  await workflowPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Take screenshot of the full page in dark mode (default)
  await page.screenshot({
    path: 'screenshots/style-fixes-dark-full.png',
    fullPage: true
  });

  // Take screenshot focused on workflow steps
  const workflowSection = page.locator('div').filter({ hasText: /Pas 1: Script & Audio/ }).first().locator('..');
  if (await workflowSection.count() > 0) {
    await workflowSection.screenshot({
      path: 'screenshots/style-fixes-workflow-steps.png'
    });
  }

  console.log('Screenshots saved for style verification');
});
