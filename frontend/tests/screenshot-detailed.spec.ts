import { test, expect } from '@playwright/test';

test('Detailed screenshot of segment workflow', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Click on "Timer Test" project
  const timerTest = page.locator('text=Timer Test').first();
  await timerTest.click();
  await page.waitForTimeout(1000);

  // Screenshot after selecting project - showing the tabs
  await page.screenshot({
    path: 'screenshots/step1-project-selected.png',
    fullPage: true
  });

  // Now look for the mode tabs - there should be AI and Segmente tabs
  // Let's check what tabs exist
  const allButtons = await page.locator('button').allTextContents();
  console.log('All buttons on page:', allButtons);

  // Try clicking on Segmente tab if it exists
  const segmenteTab = page.locator('button').filter({ hasText: /^Segmente$/ });
  if (await segmenteTab.count() > 0) {
    await segmenteTab.first().click();
    await page.waitForTimeout(500);

    await page.screenshot({
      path: 'screenshots/step2-segmente-tab.png',
      fullPage: true
    });
  }

  // Try the "Adaugă" or "Selectează Segmente" button
  const addBtn = page.locator('button:has-text("Adaugă"), button:has-text("Selectează Segmente")').first();
  if (await addBtn.isVisible()) {
    await addBtn.click();
    await page.waitForTimeout(1000);

    await page.screenshot({
      path: 'screenshots/step3-modal-open.png',
      fullPage: true
    });

    // Try checkbox on first video
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible()) {
      await checkbox.click();
      await page.waitForTimeout(1000);

      await page.screenshot({
        path: 'screenshots/step4-segments-selected.png',
        fullPage: true
      });

      // Save
      const saveBtn = page.locator('button:has-text("Salvează")').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(1500);

        await page.screenshot({
          path: 'screenshots/step5-after-save-GENERATE.png',
          fullPage: true
        });
      }
    }
  }

  console.log('\n=== Screenshots saved to frontend/screenshots/ ===');
});
