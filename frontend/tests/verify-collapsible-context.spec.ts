import { test, expect } from '@playwright/test';

test('Verify collapsible context on Pipeline page', async ({ page }) => {
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  // Screenshot 1: Empty state
  await page.screenshot({ path: 'screenshots/pipeline-context-empty.png', fullPage: true });

  // Type into the context textarea using fill
  const contextTextarea = page.locator('textarea#context');
  await contextTextarea.fill('[Product: Bocanci]\nDesc 1\n\n[Product: Manusi]\nDesc 2\n\n[Product: Geaca]\nDesc 3');
  await page.waitForTimeout(500);

  // Screenshot 2: Expanded with content
  await page.screenshot({ path: 'screenshots/pipeline-context-expanded.png', fullPage: true });

  // Try to find Collapse button
  const collapseBtn = page.locator('button:has-text("Collapse")');
  const collapseVisible = await collapseBtn.isVisible().catch(() => false);

  if (collapseVisible) {
    await collapseBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/pipeline-context-collapsed.png', fullPage: true });

    const expandBtn = page.locator('button:has-text("Expand")');
    await expandBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'screenshots/pipeline-context-reexpanded.png', fullPage: true });
  } else {
    await page.screenshot({ path: 'screenshots/pipeline-context-debug-nocollapse.png', fullPage: true });
  }
});
