import { test, expect } from '@playwright/test';

/**
 * Per-Meta-version subtitle styling — visual smoke test.
 *
 * Verifies the Subtitle Style card in Step 3 of the pipeline (Advanced mode):
 *   1. Meta OFF → zero tabs, one "Live Preview" panel, one settings panel.
 *   2. Meta ON  → exactly two tabs ("A" / "B" with Instagram/Facebook labels),
 *                 one useful-size preview switched by the active tab, and one
 *                 shared settings panel.
 *
 * NOTE: These tests assume specific fixture pipelines exist in the DB,
 * each pre-configured with a different `meta_multiplication` value. The
 * Meta flag can only be toggled in Step 2 (it's a Checkbox, not a runtime
 * control in Step 3), so we use two separate pipelines to cover both
 * scenarios cleanly. Override via env vars if your fixtures differ.
 */

const PIPELINE_META_ON = process.env.SUBTITLE_TEST_PIPELINE_META_ON
  ?? '5b02fde8-9517-4829-b200-a7b1552794ec';
const PIPELINE_META_OFF = process.env.SUBTITLE_TEST_PIPELINE_META_OFF
  ?? '242029a5-2e35-48c2-9155-5db4c6e098a7';

/**
 * The Subtitle Style card only renders inside "Advanced" mode. Fresh loads
 * of /pipeline default to "Simple" mode (persisted in localStorage), so
 * every test must click the "Advanced" toggle before looking for anything.
 */
async function enterAdvancedMode(page: import('@playwright/test').Page) {
  const advancedBtn = page.getByRole('button', { name: /^Advanced$/ });
  if (await advancedBtn.count() > 0) {
    await advancedBtn.first().click();
    // Wait for the Advanced-mode layout to settle.
    await page.waitForTimeout(600);
  }
}

/**
 * Locate the Subtitle Style card's root element. We scope all assertions
 * to this scope to avoid false positives from the outer page (e.g. "Meta"
 * appearing in a breadcrumb).
 */
function styleCardLocator(page: import('@playwright/test').Page) {
  // Nearest Card ancestor of the "Subtitle Style" CardTitle (the outer
  // card, not the inner <h3> rendered by SubtitleEditor's settings panel).
  return page
    .locator('[data-slot="card-title"]')
    .filter({ hasText: /^Subtitle Style$/ })
    .first()
    .locator('xpath=ancestor::div[@data-slot="card"][1]');
}

test('subtitle preview remains visible while its inspector scrolls', async ({ page }) => {
  await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await enterAdvancedMode(page);
  await page.waitForTimeout(1500);

  const inspector = page.getByTestId('step3-inspector');
  const variantCanvas = page.getByTestId('step3-variant-canvas');
  const preview = page.getByTestId('subtitle-sticky-preview');

  await expect(preview).toBeVisible({ timeout: 10000 });
  const initialCanvasScrollTop = await variantCanvas.evaluate((element) => element.scrollTop);
  await inspector.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect(preview).toBeInViewport();
  await expect.poll(() => variantCanvas.evaluate((element) => element.scrollTop)).toBe(initialCanvasScrollTop);

  const [inspectorBox, previewBox] = await Promise.all([
    inspector.boundingBox(),
    preview.boundingBox(),
  ]);
  expect(inspectorBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  // The sticky surface intentionally bleeds a few pixels over the inspector's
  // top padding so settings cannot show through behind it while scrolling.
  expect(previewBox!.y).toBeGreaterThanOrEqual(inspectorBox!.y - 16);
  expect(previewBox!.y).toBeLessThan(inspectorBox!.y + inspectorBox!.height);
  expect(previewBox!.y + previewBox!.height).toBeLessThanOrEqual(
    inspectorBox!.y + inspectorBox!.height + 1,
  );
});

test.describe('Subtitle style — per-Meta-version model', () => {
  test('Meta OFF → single preview, zero tabs', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_OFF}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1500);

    // Subtitle Style card must be visible
    // Target the Subtitle Style CardTitle specifically (avoids collision with
    // the inner <h3> "Subtitle Style" rendered by SubtitleEditor's settings panel).
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /^Subtitle Style$/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /about subtitle styles/i })).toBeVisible();

    const styleCard = styleCardLocator(page);

    // Meta OFF → zero tabs inside the Subtitle Style card
    const tabsInStyleCard = styleCard.getByRole('tab');
    await expect(tabsInStyleCard).toHaveCount(0, { timeout: 3000 });

    // Meta OFF: NO per-version labels (no "Live Preview — A" or "— B"). This is
    // the definitive signal that only the "default" preview panel is rendering.
    await expect(styleCard.getByText(/Live Preview — A/i)).toHaveCount(0);
    await expect(styleCard.getByText(/Live Preview — B/i)).toHaveCount(0);
    await expect(styleCard.locator('#subtitle-style-preview').getByText(/^Live Preview$/).first()).toBeVisible();

    // "Save as preset" button must still be present (global action)
    await expect(page.getByRole('button', { name: /save as preset/i })).toBeVisible();

    await page.screenshot({
      path: 'screenshots/subtitle-meta-off.png',
      fullPage: true,
    });

    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Meta ON → two tabs + one active live preview', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1500);

    // Target the Subtitle Style CardTitle specifically (avoids collision with
    // the inner <h3> "Subtitle Style" rendered by SubtitleEditor's settings panel).
    await expect(page.locator('[data-slot="card-title"]').filter({ hasText: /^Subtitle Style$/ })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /about subtitle styles/i })).toBeVisible();

    const styleCard = styleCardLocator(page);

    // Exactly two tabs: A and B
    const tabs = styleCard.getByRole('tab');
    await expect(tabs).toHaveCount(2, { timeout: 5000 });

    // Each tab includes the platform name as part of its accessible name
    await expect(styleCard.getByRole('tab', { name: /Instagram/i })).toBeVisible();
    await expect(styleCard.getByRole('tab', { name: /Facebook/i })).toBeVisible();

    // Only the selected version gets a preview panel.
    await expect(styleCard.getByText(/Live Preview — A/i)).toBeVisible();
    await expect(styleCard.getByText(/Live Preview — B/i)).toHaveCount(0);

    await page.screenshot({
      path: 'screenshots/subtitle-meta-on.png',
      fullPage: true,
    });

    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Meta ON → switching tabs replaces the active preview', async ({ page }) => {
    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1500);

    const styleCard = styleCardLocator(page);

    // Click A, then B — the single preview follows the selected version.
    const tabA = styleCard.getByRole('tab', { name: /Instagram/i });
    const tabB = styleCard.getByRole('tab', { name: /Facebook/i });

    await tabA.click();
    await page.waitForTimeout(300);
    await expect(tabA).toHaveAttribute('aria-selected', 'true');
    await expect(styleCard.getByText(/Live Preview — A/i)).toBeVisible();
    await expect(styleCard.getByText(/Live Preview — B/i)).toHaveCount(0);

    await page.screenshot({
      path: 'screenshots/subtitle-editing-a-vs-b.png',
      fullPage: true,
    });

    await tabB.click();
    await page.waitForTimeout(300);
    await expect(tabB).toHaveAttribute('aria-selected', 'true');
    await expect(styleCard.getByText(/Live Preview — A/i)).toHaveCount(0);
    await expect(styleCard.getByText(/Live Preview — B/i)).toBeVisible();
  });
});
