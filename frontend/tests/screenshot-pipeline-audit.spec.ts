import { test } from '@playwright/test';

test('Pipeline page renders after gating changes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/verify-pipeline-gating.png', fullPage: true });
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
});
