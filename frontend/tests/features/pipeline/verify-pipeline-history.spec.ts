import { test, expect } from '@playwright/test';

test('Verify pipeline history sidebar is always visible', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/pipeline');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Sidebar should be visible without any click
  const sidebarTitle = page.getByText('Script History');
  await expect(sidebarTitle).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: 'screenshots/verify-pipeline-history.png', fullPage: true });
});

test('pipeline toolbar stays consistent and Step 3 history starts below it', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });

  for (const step of [1, 2, 3, 4]) {
    await page.goto(`/pipeline?step=${step}`);
    await page.waitForLoadState('networkidle');

    const toolbar = page.getByTestId('pipeline-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.getByTestId(`pipeline-step-${step}`)).toHaveAttribute('aria-current', 'step');

    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(toolbarBox!.height).toBe(56);

    if (step === 2) {
      await page.screenshot({
        path: 'screenshots/pipeline-step2-unified-toolbar.png',
        fullPage: false,
      });
    }

    if (step === 3) {
      const historyHeader = page.getByTestId('pipeline-history-header');
      const toolbarContext = page.getByTestId('pipeline-toolbar-context');
      const toolbarActions = page.getByTestId('pipeline-toolbar-actions');
      await expect(historyHeader).toBeVisible();
      await expect(toolbarContext.getByText('Multi-Variant Pipeline')).toBeVisible();
      const [historyHeaderBox, toolbarContextBox, toolbarActionsBox] = await Promise.all([
        historyHeader.boundingBox(),
        toolbarContext.boundingBox(),
        toolbarActions.boundingBox(),
      ]);
      expect(historyHeaderBox).not.toBeNull();
      expect(toolbarContextBox).not.toBeNull();
      expect(toolbarActionsBox).not.toBeNull();
      expect(toolbarContextBox!.width).toBeGreaterThan(160);
      expect(toolbarContextBox!.x).toBeGreaterThanOrEqual(toolbarBox!.x);
      expect(toolbarActionsBox!.x + toolbarActionsBox!.width).toBeLessThanOrEqual(
        toolbarBox!.x + toolbarBox!.width,
      );
      expect(historyHeaderBox!.y).toBeGreaterThanOrEqual(
        toolbarBox!.y + toolbarBox!.height + 10,
      );
      await page.screenshot({
        path: 'screenshots/pipeline-step3-toolbar-history.png',
        fullPage: false,
      });
      await toolbar.screenshot({ path: 'screenshots/pipeline-step3-toolbar.png' });
    }
  }

  await page.setViewportSize({ width: 2048, height: 900 });
  await page.goto('/pipeline?step=3');
  const wideToolbar = page.getByTestId('pipeline-toolbar');
  await expect(wideToolbar.getByText('/ Preview & Select', { exact: true })).toBeVisible();
  await expect(wideToolbar.getByText(/\d+ previews?/)).toBeVisible();
  await wideToolbar.screenshot({ path: 'screenshots/pipeline-step3-toolbar-wide.png' });
});
