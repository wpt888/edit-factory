import { test, expect } from '@playwright/test';

test('Check new workflow panel', async ({ page }) => {
  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Click on Timer Test project
  await page.locator('text=Timer Test').first().click();
  await page.waitForTimeout(3000);

  // Take full page screenshot
  await page.screenshot({
    path: 'screenshots/workflow-panel-full.png',
    fullPage: true
  });

  // Check for workflow steps
  const step1Visible = await page.locator('text=Pas 1: Script & Audio').isVisible();
  const step2Visible = await page.locator('text=Pas 2: Durată Video').isVisible();
  const step3Visible = await page.locator('text=Pas 3: Generare Video').isVisible();

  console.log(`Step 1 visible: ${step1Visible}`);
  console.log(`Step 2 visible: ${step2Visible}`);
  console.log(`Step 3 visible: ${step3Visible}`);
});
