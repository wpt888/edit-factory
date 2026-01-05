import { test, expect } from '@playwright/test';

test('Screenshot segment workflow', async ({ page }) => {
  // Navigate to library
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Take screenshot of initial state
  await page.screenshot({
    path: 'screenshots/01-library-page.png',
    fullPage: true
  });

  // Click first project if available
  const projectItems = page.locator('.space-y-2 > div').filter({ hasText: /variante|proiect/i });
  const count = await projectItems.count();

  if (count > 0) {
    await projectItems.first().click();
    await page.waitForTimeout(1000);

    // Screenshot after selecting project
    await page.screenshot({
      path: 'screenshots/02-project-selected.png',
      fullPage: true
    });

    // Look for Segments tab and click it
    const segmentsTab = page.locator('button:has-text("Segmente")').first();
    if (await segmentsTab.isVisible()) {
      await segmentsTab.click();
      await page.waitForTimeout(500);

      // Screenshot of segments mode
      await page.screenshot({
        path: 'screenshots/03-segments-mode.png',
        fullPage: true
      });
    }

    // Try to open segment modal
    const addButton = page.locator('button:has-text("Adaugă"), button:has-text("Selectează Segmente")').first();
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Screenshot of modal
      await page.screenshot({
        path: 'screenshots/04-segment-modal.png',
        fullPage: true
      });

      // Check for checkboxes on source videos
      const checkbox = page.locator('input[type="checkbox"]').first();
      if (await checkbox.isVisible()) {
        await checkbox.click();
        await page.waitForTimeout(500);

        // Screenshot after selecting
        await page.screenshot({
          path: 'screenshots/05-after-checkbox.png',
          fullPage: true
        });
      }

      // Save if possible
      const saveBtn = page.locator('button:has-text("Salvează")').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    // Final screenshot showing generate button
    await page.screenshot({
      path: 'screenshots/06-generate-button.png',
      fullPage: true
    });
  }

  console.log('Screenshots saved to: frontend/screenshots/');
});
