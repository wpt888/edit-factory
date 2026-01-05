import { test, expect } from '@playwright/test';

test('Debug segment loading', async ({ page }) => {
  // Listen to console logs
  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}]:`, msg.text());
  });

  // Listen to network requests
  page.on('response', response => {
    if (response.url().includes('segments')) {
      console.log(`[Network] ${response.url()} -> ${response.status()}`);
    }
  });

  await page.goto('/library');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('\n=== CLICKING ON TIMER TEST PROJECT ===\n');

  // Click on Timer Test project
  await page.locator('text=Timer Test').first().click();
  await page.waitForTimeout(3000);

  // Check for projectSegments in the DOM by looking for the panel
  const panelVisible = await page.locator('text=Generare din Segmente').isVisible();
  console.log(`\n=== PANEL VISIBLE: ${panelVisible} ===\n`);

  // Check if the badge with segment count is showing
  const segmentBadge = page.locator('button:has-text("Segmente")').locator('span, .badge, [class*="badge"]');
  const badgeText = await segmentBadge.textContent().catch(() => 'not found');
  console.log(`\n=== SEGMENT BADGE: ${badgeText} ===\n`);

  await page.screenshot({
    path: 'screenshots/DEBUG-after-click.png',
    fullPage: true
  });

  // Scroll down to see if panel is below fold
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  await page.screenshot({
    path: 'screenshots/DEBUG-scrolled.png',
    fullPage: true
  });

  console.log('\n=== SCREENSHOTS SAVED TO frontend/screenshots/ ===\n');
});
