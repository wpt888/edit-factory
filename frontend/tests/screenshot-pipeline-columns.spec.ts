import { test } from '@playwright/test';

test('Pipeline columns layout screenshots', async ({ page }) => {
  for (const [width, height, path] of [
    [1900, 1000, 'screenshots/pipeline-columns-1900.png'],
    [1000, 900, 'screenshots/pipeline-columns-1000.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path, fullPage: true });
  }
});

test('Pipeline Step 2 via hugo,test history entry', async ({ page }) => {
  for (const [width, height, path] of [
    [1900, 1000, 'screenshots/pipeline-step2-columns-1900.png'],
    [1000, 900, 'screenshots/pipeline-step2-columns-1000.png'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/pipeline');
    await page.waitForLoadState('networkidle');
    const card = page.locator('div.rounded-lg.border', { hasText: 'hugo, test' }).first();
    await card.waitFor({ timeout: 45000 });
    await card.locator('text=scripts').first().click(); // expand card → shows Load buttons
    await page.locator('button:has-text("Load All")').first().click(); // load scripts → Step 2
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2500);
    await page.screenshot({ path, fullPage: true });
  }
});
