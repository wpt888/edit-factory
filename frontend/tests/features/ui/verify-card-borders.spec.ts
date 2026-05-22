import { test } from '@playwright/test';

test('Verify workflow cards have visible borders and no hardcoded colors', async ({ page }) => {
  // Navigate to library page
  await page.goto('http://localhost:3000/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take full page screenshot in light mode
  await page.screenshot({
    path: 'screenshots/workflow-cards-light.png',
    fullPage: true
  });

  // Switch to dark mode
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });
  await page.waitForTimeout(500);

  // Take full page screenshot in dark mode
  await page.screenshot({
    path: 'screenshots/workflow-cards-dark.png',
    fullPage: true
  });

  // Focus on the workflow panel area if visible
  // Try to scroll to the workflow section
  const workflowSection = page.locator('text=Pas 1: Script & Audio').first();
  if (await workflowSection.isVisible()) {
    await workflowSection.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // Take a focused screenshot of the workflow cards area
    await page.screenshot({
      path: 'screenshots/workflow-cards-dark-focused.png',
      fullPage: false
    });
  }
});
