import { test, expect } from '@playwright/test';

test('Debug ALL console logs', async ({ page }) => {
  // Capture ALL console messages
  const logs: string[] = [];
  page.on('console', msg => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  // Capture page errors
  page.on('pageerror', error => {
    console.log('[PAGE ERROR]:', error.message);
  });

  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('\n=== Clicking Timer Test ===\n');

  // Click on Timer Test
  await page.locator('text=Timer Test').first().click();
  await page.waitForTimeout(2000);

  // Log collected messages
  console.log('\n=== ALL LOGS ===');
  logs.forEach(log => console.log(log));
  console.log('=================\n');

  // Check panel
  const panelVisible = await page.locator('text=Generare din Segmente').isVisible();
  console.log(`Panel visible: ${panelVisible}`);

  // Also check if projectSegments length by evaluating in page context
  const segmentCount = await page.evaluate(() => {
    // @ts-ignore
    return window.__NEXT_DATA__?.props?.pageProps?.projectSegments?.length || 'N/A';
  });
  console.log(`Segment count from page: ${segmentCount}`);

  await page.screenshot({
    path: 'screenshots/DEBUG-all-logs.png',
    fullPage: true
  });
});
