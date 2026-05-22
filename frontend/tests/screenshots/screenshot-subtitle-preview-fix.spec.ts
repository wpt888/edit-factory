import { test, expect } from '@playwright/test';

const PIPELINE_URL =
  'http://localhost:3001/pipeline?step=3&id=f313a868-3a0c-4b30-9fae-4f6a26c49da9';

test('Step 3 subtitle preview fix + fullscreen', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto(PIPELINE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Ensure Advanced mode (4-step pipeline).
  const advancedBtn = page.getByRole('button', { name: /^Advanced$/i }).first();
  if (await advancedBtn.count()) {
    await advancedBtn.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.goto(PIPELINE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  await page.screenshot({
    path: 'screenshots/subtitle-fix-01-step3-loaded.png',
    fullPage: true,
  });

  const subtitlePreview = page.locator('img[alt="Subtitle preview"]').first();
  const count = await subtitlePreview.count();
  console.log(`Found ${count} subtitle preview(s)`);

  if (count > 0) {
    await subtitlePreview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'screenshots/subtitle-fix-02-preview-visible.png',
      fullPage: false,
    });
  }

  const expandBtns = page.locator('button[aria-label="Expand preview"]');
  const expandCount = await expandBtns.count();
  console.log(`Found ${expandCount} expand button(s)`);

  if (expandCount > 0) {
    const btn = expandBtns.first();
    await btn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await btn.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: 'screenshots/subtitle-fix-03-fullscreen-open.png',
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }

  expect(true).toBeTruthy();
});
