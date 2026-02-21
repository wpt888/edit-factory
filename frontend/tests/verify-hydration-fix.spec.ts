import { test, expect } from '@playwright/test';

// Run against already-running dev server
test.use({ baseURL: 'http://localhost:3000' });

test('Verify hydration fix - pipeline page', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Hydration') || text.includes('mismatch') || text.includes('aria-controls')) {
      hydrationErrors.push(text);
    }
  });

  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/hydration-fix-pipeline.png', fullPage: true });

  if (hydrationErrors.length > 0) {
    console.log('HYDRATION ERRORS:', hydrationErrors.join('\n'));
  } else {
    console.log('No hydration errors on pipeline page');
  }
});

test('Verify hydration fix - segments page', async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('Hydration') || text.includes('mismatch') || text.includes('aria-controls')) {
      hydrationErrors.push(text);
    }
  });

  await page.goto('/segments');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshots/hydration-fix-segments.png', fullPage: true });

  if (hydrationErrors.length > 0) {
    console.log('HYDRATION ERRORS:', hydrationErrors.join('\n'));
  } else {
    console.log('No hydration errors on segments page');
  }
});
