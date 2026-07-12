import { expect, test } from '@playwright/test';

test('Pipeline density layout is responsive without horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const [width, path] of [
    [1900, 'screenshots/pipeline-density-1900.png'],
    [1000, 'screenshots/pipeline-density-1000.png'],
  ] as const) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('/pipeline?step=2');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path, fullPage: true });
  }
  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
});
