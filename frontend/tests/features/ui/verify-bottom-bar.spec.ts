import { test } from '@playwright/test';

test('Verify sticky bottom delete bar', async ({ page }) => {
  await page.goto('/librarie');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  
  // Click on the first few clip checkboxes
  const checkboxes = page.locator('button[role="checkbox"]');
  const count = await checkboxes.count();
  console.log(`Found ${count} checkboxes`);
  
  if (count >= 2) {
    await checkboxes.nth(0).click({ force: true });
    await page.waitForTimeout(300);
    await checkboxes.nth(1).click({ force: true });
    await page.waitForTimeout(300);
  }
  
  // Scroll to bottom to show the sticky bar
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  
  await page.screenshot({ path: 'screenshots/verify-bottom-bar.png', fullPage: false });
});
