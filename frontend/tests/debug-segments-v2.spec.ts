import { test, expect } from '@playwright/test';

test('Debug segment loading v2', async ({ page }) => {
  // Listen to console logs - specifically DEBUG logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('DEBUG') || text.includes('Error')) {
      console.log(`[Browser]:`, text);
    }
  });

  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  console.log('\n=== STEP 1: Clicking on Timer Test project ===\n');

  // Click on Timer Test project
  await page.locator('text=Timer Test').first().click();

  // Wait for any async operations
  await page.waitForTimeout(3000);

  console.log('\n=== STEP 2: Checking panel visibility ===\n');

  // Check for projectSegments in the DOM by looking for the panel
  const panelVisible = await page.locator('text=Generare din Segmente').isVisible();
  console.log(`Panel "Generare din Segmente" visible: ${panelVisible}`);

  // Take screenshot
  await page.screenshot({
    path: 'screenshots/DEBUG-v2.png',
    fullPage: true
  });

  console.log('\n=== Screenshot saved: screenshots/DEBUG-v2.png ===\n');
});
