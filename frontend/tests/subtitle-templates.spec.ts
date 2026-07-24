import { test, expect } from '@playwright/test';

/**
 * Subtitle Templates management page (/subtitle-templates).
 *
 * Mocks the profile + subtitle-template API and verifies the hierarchy:
 * templates expand to ordered styles, styles can be added, and the full set
 * persists automatically without a manual Save action.
 */

const PROFILE = {
  id: 'subtitle-templates-profile',
  name: 'Subtitle Templates QA',
  is_default: true,
  created_at: '2026-07-20T00:00:00Z',
};

const TEMPLATE = {
  id: 'template-1',
  name: 'Launch captions',
  created_at: '2026-07-20T00:00:00Z',
  styles: [
    {
      id: 'style-1',
      name: 'Bold Yellow',
      created_at: '2026-07-20T00:00:00Z',
      wordsPerSubtitle: 3,
      settings: {
        fontSize: 48,
        fontFamily: 'Montserrat',
        textColor: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 3,
        positionY: 85,
        horizontalAlignment: 'center',
        letterSpacing: 0,
        opacity: 100,
      },
    },
    {
      id: 'style-2',
      name: 'Clean White',
      created_at: '2026-07-20T00:00:00Z',
      wordsPerSubtitle: 4,
      settings: {
        fontSize: 42,
        fontFamily: 'Inter',
        textColor: '#FFFFFF',
        outlineColor: '#000000',
        outlineWidth: 1,
        positionY: 88,
        horizontalAlignment: 'center',
        letterSpacing: 0,
        opacity: 100,
      },
    },
  ],
};

type Recorded = { method: string; path: string; body: unknown };

test.beforeEach(async ({ page }) => {
  const recorded: Recorded[] = [];
  (page as unknown as { _recorded: Recorded[] })._recorded = recorded;

  await page.addInitScript((profile) => {
    localStorage.setItem('editai_profiles', JSON.stringify([profile]));
    localStorage.setItem('editai_current_profile_id', profile.id);
  }, PROFILE);

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { /* no body */ }

    if (path.endsWith('/subtitle-templates') || path.includes('/subtitle-templates/')) {
      if (method === 'GET') {
        await route.fulfill({ json: { templates: [TEMPLATE] } });
        return;
      }
      recorded.push({ method, path, body });
      const payload = body as typeof TEMPLATE;
      const templateId = method === 'POST' ? 'template-new' : TEMPLATE.id;
      await route.fulfill({ json: {
        ...payload,
        id: templateId,
        created_at: TEMPLATE.created_at,
        styles: payload.styles.map((style, index) => ({
          ...style,
          id: style.id || `style-added-${index}`,
          created_at: TEMPLATE.created_at,
        })),
      } });
      return;
    }

    if (path.includes('/subtitle-presets') && method === 'DELETE') {
      recorded.push({ method, path, body });
      await route.fulfill({ json: {} });
      return;
    }

    if (path.endsWith('/profiles/') || path.endsWith('/profiles')) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    await route.fulfill({ json: {} });
  });
});

function recorded(page: import('@playwright/test').Page): Recorded[] {
  return (page as unknown as { _recorded: Recorded[] })._recorded;
}

async function elementRect(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

test('lists a template with child styles, autosaves create and edits, and deletes', async ({ page }) => {
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  // List renders one template container, not two unrelated presets.
  const editor = page.getByTestId('subtitle-template-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('subtitle-template-row')).toHaveText(/Launch captions.*2 styles/);
  await expect(page.getByText('New template', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Add style', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('subtitle-template-draft-styles')).toHaveCount(0);
  await expect(page.getByTestId('subtitle-style-row')).toHaveText([/Bold Yellow/, /Clean White/]);

  // Create: the first valid edit persists automatically; there is no Save CTA.
  await expect(page.getByRole('button', { name: 'Save template' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New template' }).first().click();
  await page.getByTestId('subtitle-template-name').fill('Always saved captions');
  await expect.poll(() => recorded(page).some((request) => request.method === 'POST')).toBe(true);
  await expect(page.getByTestId('subtitle-template-save-status')).toHaveText('Saved');

  // Selecting expands the saved template and exposes both styles underneath.
  await page.getByRole('button', { name: 'Launch captions 2 styles' }).click();
  const launchGroup = page.getByTestId('subtitle-template-group').filter({ hasText: 'Launch captions' });
  const launchStyles = launchGroup.getByTestId('subtitle-style-row');
  await expect(launchStyles).toHaveCount(2);
  await expect(launchStyles).toHaveText([/Bold Yellow/, /Clean White/]);
  await expect(page.getByText('Add style', { exact: true })).toHaveCount(0);

  // The template group name follows the same double-click inline-edit contract as styles.
  await launchGroup.getByText('Launch captions', { exact: true }).dblclick();
  const inlineTemplateName = page.getByTestId('subtitle-template-name-input');
  await expect(inlineTemplateName).toBeFocused();
  await inlineTemplateName.fill('Social launch captions');
  await inlineTemplateName.press('Enter');
  const renamedLaunchGroup = page.getByTestId('subtitle-template-group').filter({ hasText: 'Social launch captions' });
  const renamedLaunchStyles = renamedLaunchGroup.getByTestId('subtitle-style-row');
  await expect(renamedLaunchGroup.getByTestId('subtitle-template-row')).toContainText('Social launch captions');
  await expect(page.getByTestId('subtitle-template-name')).toHaveValue('Social launch captions');
  await expect.poll(() => {
    const puts = recorded(page).filter((request) => request.method === 'PUT');
    return (puts.at(-1)?.body as { name?: string } | undefined)?.name;
  }).toBe('Social launch captions');

  // Template deletion stays in the top action bar, immediately after New template.
  const newTemplateAction = page.getByRole('button', { name: 'New template' }).first();
  const deleteTemplateAction = page.getByRole('button', { name: 'Delete template' });
  const [newTemplateBox, deleteTemplateBox] = await Promise.all([
    elementRect(newTemplateAction),
    elementRect(deleteTemplateAction),
  ]);
  expect(Math.abs(newTemplateBox.y - deleteTemplateBox.y)).toBeLessThanOrEqual(1);
  expect(deleteTemplateBox.x).toBeGreaterThan(newTemplateBox.x);

  // Add a third style and rename it inline by double-clicking its current name.
  await page.getByRole('button', { name: 'Add style to Social launch captions' }).click();
  await expect(renamedLaunchStyles).toHaveCount(3);
  await renamedLaunchStyles.nth(2).getByText('Style 3').dblclick();
  const inlineName = page.getByTestId('subtitle-style-name-input');
  await expect(inlineName).toBeFocused();
  await inlineName.fill('Karaoke Green');
  await inlineName.press('Enter');
  await expect(renamedLaunchStyles.nth(2)).toContainText('Karaoke Green');
  await expect(page.getByTestId('subtitle-style-name')).toHaveValue('Karaoke Green');
  await expect(editor).toHaveScreenshot('subtitle-template-with-three-styles.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
  const slider = page.getByRole('slider').first();
  await slider.focus();
  await slider.press('ArrowRight');
  await expect.poll(() => {
    const puts = recorded(page).filter((request) => request.method === 'PUT');
    const latest = puts.at(-1)?.body as { styles?: Array<{ settings: { fontSize?: number } }> } | undefined;
    return latest?.styles?.[2]?.settings.fontSize ?? 0;
  }).toBeGreaterThan(48);
  await expect(page.getByTestId('subtitle-template-save-status')).toHaveText('Saved');

  const put = recorded(page).filter((request) => request.method === 'PUT').at(-1);
  const styles = (put?.body as { styles?: Array<{ name: string; settings: { fontSize?: number } }> })?.styles;
  expect(styles).toHaveLength(3);
  expect(styles?.map((style) => style.name)).toEqual(['Bold Yellow', 'Clean White', 'Karaoke Green']);
  expect(styles?.[2]?.settings.fontSize).toBeGreaterThan(48);

  // Style deletion is immediate, persists through autosave, and stays undoable
  // with the platform keyboard shortcut without opening a modal.
  await renamedLaunchStyles.nth(1).getByRole('button', { name: 'Delete style Clean White' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Delete subtitle style?' })).toHaveCount(0);
  await expect(renamedLaunchStyles).toHaveCount(2);
  await expect(renamedLaunchStyles).toHaveText([/Bold Yellow/, /Karaoke Green/]);
  await expect.poll(() => {
    const puts = recorded(page).filter((request) => request.method === 'PUT');
    const latest = puts.at(-1)?.body as { styles?: Array<{ name: string }> } | undefined;
    return latest?.styles?.map((style) => style.name);
  }).toEqual(['Bold Yellow', 'Karaoke Green']);
  await expect(page.getByTestId('subtitle-template-save-status')).toHaveText('Saved');

  await page.keyboard.press('Control+z');
  await expect(renamedLaunchStyles).toHaveCount(3);
  await expect(renamedLaunchStyles).toHaveText([/Bold Yellow/, /Clean White/, /Karaoke Green/]);
  await expect.poll(() => {
    const puts = recorded(page).filter((request) => request.method === 'PUT');
    const latest = puts.at(-1)?.body as { styles?: Array<{ name: string }> } | undefined;
    return latest?.styles?.map((style) => style.name);
  }).toEqual(['Bold Yellow', 'Clean White', 'Karaoke Green']);

  // Delete keeps the existing confirm-gated template deletion flow.
  await page.getByRole('button', { name: 'Delete template' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete template' }).click();
  await expect.poll(() => recorded(page).some((request) => request.method === 'DELETE')).toBe(true);
});

test('orders, reorders, and resizes all subtitle workspace panels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  const templates = page.getByTestId('subtitle-panel-templates');
  const settings = page.getByTestId('subtitle-panel-settings');
  const preview = page.getByTestId('subtitle-panel-preview');
  await expect(templates).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(preview).toBeVisible();

  await expect.poll(async () => {
    const [templatesRect, settingsRect, previewRect] = await Promise.all([
      elementRect(templates),
      elementRect(settings),
      elementRect(preview),
    ]);
    return templatesRect.x < settingsRect.x && settingsRect.x < previewRect.x;
  }).toBe(true);
  const templatesBox = await elementRect(templates);
  await expect(page.locator('[data-slot="resizable-handle"]')).toHaveCount(2);

  const panelHeaders = page.locator('[data-slot="workspace-panel-header"]');
  await expect(panelHeaders).toHaveCount(3);
  const headerRects = await panelHeaders.evaluateAll((headers) => headers.map((header) => {
    const rect = header.getBoundingClientRect();
    return { y: rect.y, height: rect.height };
  }));
  expect(headerRects.map(({ height }) => height)).toEqual([36, 36, 36]);
  expect(new Set(headerRects.map(({ y }) => y)).size).toBe(1);

  // Every compact header remains visible and draggable, including Preview.
  const previewHeader = page.getByTestId('subtitle-panel-header-preview');
  await expect(previewHeader).toBeVisible();
  const previewHeaderBox = await elementRect(previewHeader);
  await expect.poll(() => page.evaluate(({ x, y }) => (
    document
      .elementFromPoint(x, y)
      ?.closest('[data-slot="workspace-panel-header"]')
      ?.getAttribute('data-testid')
  ), {
    x: previewHeaderBox.x + 24,
    y: previewHeaderBox.y + previewHeaderBox.height / 2,
  })).toBe('subtitle-panel-header-preview');
  await page.mouse.move(
    previewHeaderBox.x + 24,
    previewHeaderBox.y + previewHeaderBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    previewHeaderBox.x + 84,
    previewHeaderBox.y + previewHeaderBox.height / 2,
    { steps: 4 },
  );
  await expect(preview).toHaveCSS('opacity', '0.5');
  await page.mouse.move(templatesBox.x + 10, templatesBox.y + 24, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await elementRect(preview)).x)
    .toBeLessThan((await elementRect(templates)).x);

  // The vertical separator changes the adjacent panel width.
  const firstHandle = page.locator('[data-slot="resizable-handle"]').first();
  const handleBox = await elementRect(firstHandle);
  const widthBefore = (await elementRect(preview)).width;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 60, handleBox.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await elementRect(preview)).width).not.toBe(widthBefore);
});
