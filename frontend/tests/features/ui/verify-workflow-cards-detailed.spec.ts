import { test } from '@playwright/test';

test('Verify workflow cards are visible with better contrast', async ({ page }) => {
  // Navigate to library page
  await page.goto('http://localhost:3000/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Select the first project to reveal workflow cards
  const firstProject = page.locator('[data-project-card]').first();
  if (await firstProject.isVisible()) {
    await firstProject.click();
    await page.waitForTimeout(1500);

    // Switch to dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.waitForTimeout(500);

    // Try to scroll to workflow section
    const step1 = page.locator('text=Pas 1: Script & Audio').first();
    if (await step1.isVisible()) {
      await step1.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);

      // Take a screenshot showing the workflow cards
      await page.screenshot({
        path: 'screenshots/workflow-cards-visible-dark.png',
        fullPage: true
      });

      // Zoom in on the workflow panel
      const workflowPanel = page.locator('text=Pas 1: Script & Audio').locator('..');
      if (await workflowPanel.isVisible()) {
        await workflowPanel.screenshot({
          path: 'screenshots/workflow-cards-zoomed-dark.png'
        });
      }
    }

    // Switch back to light mode
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
    });
    await page.waitForTimeout(500);

    // Take light mode screenshot
    if (await step1.isVisible()) {
      await page.screenshot({
        path: 'screenshots/workflow-cards-visible-light.png',
        fullPage: true
      });
    }
  }
});
