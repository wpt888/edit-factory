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

test('pipeline editor header follows the shared editor chrome', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/pipeline?step=3');
  await page.waitForLoadState('networkidle');

  const toolbar = page.getByTestId('pipeline-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCSS('height', '56px');
  await expect(toolbar.getByText('Multi-Variant Pipeline', { exact: true })).toBeVisible();
  await expect(toolbar.getByText('Preview & Select', { exact: true })).toBeVisible();
  await expect(toolbar.getByText(/\d+ previews?/)).toBeVisible();
  await expect(page.getByTestId('pipeline-progress')).toBeHidden();

  await toolbar.screenshot({ path: 'screenshots/pipeline-standard-editor-header.png' });
});

test('workspace panel headers share one height, separator, and vertical alignment', async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 });

  for (const step of [1, 2, 3]) {
    await page.goto(`/pipeline?step=${step}`);
    await page.waitForLoadState('networkidle');

    const headers = page.locator('[data-slot="workspace-panel-header"]:visible');
    await expect(headers.first()).toBeVisible();
    expect(await headers.count()).toBeGreaterThanOrEqual(step === 3 ? 3 : 2);

    for (const header of await headers.all()) {
      await expect(header).toHaveCSS('height', '56px');
      await expect(header).toHaveCSS('border-bottom-style', 'solid');

      const title = header.locator('[data-slot="workspace-panel-title"]');
      await expect(title).toBeVisible();
      const [headerBox, titleBox] = await Promise.all([
        header.boundingBox(),
        title.boundingBox(),
      ]);
      expect(headerBox).not.toBeNull();
      expect(titleBox).not.toBeNull();

      const topSpace = titleBox!.y - headerBox!.y;
      const bottomSpace = headerBox!.y + headerBox!.height - (titleBox!.y + titleBox!.height);
      expect(Math.abs(topSpace - bottomSpace)).toBeLessThanOrEqual(1);

      const titleLabelFits = await title.locator('span').first().evaluate(
        (label) => label.scrollWidth <= label.clientWidth,
      );
      expect(titleLabelFits).toBe(true);
    }
  }
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
      await page.getByTestId('pipeline-history-toggle').click();
      const historyHeader = page.getByTestId('pipeline-history-header');
      const toolbarContext = page.getByTestId('pipeline-toolbar-context');
      const toolbarActions = page.getByTestId('pipeline-toolbar-actions');
      await expect(historyHeader).toBeVisible();
      await expect(toolbarContext.getByText('Multi-Variant Pipeline')).toBeVisible();
      await expect(toolbar.getByText('Preview & Select', { exact: true })).toBeVisible();
      await expect(toolbar.getByText(/\d+ previews?/)).toBeVisible();
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
  await expect(page.getByTestId('pipeline-progress')).toBeVisible();
  await expect(wideToolbar.getByText('Preview & Select', { exact: true })).toBeVisible();
  await expect(wideToolbar.getByText(/\d+ previews?/)).toBeVisible();
  await wideToolbar.screenshot({ path: 'screenshots/pipeline-step3-toolbar-wide.png' });
});
