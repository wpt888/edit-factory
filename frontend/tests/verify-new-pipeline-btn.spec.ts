import { test } from '@playwright/test';

test('Verify New Pipeline button on Advanced step 2', async ({ page }) => {
  await page.goto('/pipeline');
  await page.evaluate(() => {
    localStorage.setItem('ef_pipeline_mode', 'advanced');
  });
  await page.goto('/pipeline?step=2');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/new-pipeline-btn-step2.png', fullPage: false });
});

test('Verify New Pipeline button on Advanced step 1', async ({ page }) => {
  await page.goto('/pipeline');
  await page.evaluate(() => {
    localStorage.setItem('ef_pipeline_mode', 'advanced');
  });
  await page.goto('/pipeline?step=1');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/new-pipeline-btn-step1.png', fullPage: false });
});
