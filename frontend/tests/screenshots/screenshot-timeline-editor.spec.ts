import { test } from '@playwright/test';

test('Verify TimelineEditor in pipeline Step 3', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/timeline-editor-pipeline.png', fullPage: true });
});
