import { test } from '@playwright/test';

test('Verify library page with project selected', async ({ page }) => {
  // Navigate to library page
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Try to click on the first project
  const firstProject = page.locator('[class*="cursor-pointer"]').filter({ hasText: /clipuri|ready_for_triage|generating/i }).first();
  if (await firstProject.count() > 0) {
    await firstProject.click();
    await page.waitForTimeout(1500);

    // Take screenshot showing the project details
    await page.screenshot({
      path: 'screenshots/library-project-selected-light.png',
      fullPage: true
    });

    // Switch to dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'screenshots/library-project-selected-dark.png',
      fullPage: true
    });

    console.log('Project screenshots saved');
  } else {
    console.log('No projects found to select');
    await page.screenshot({
      path: 'screenshots/library-no-project.png',
      fullPage: true
    });
  }
});
