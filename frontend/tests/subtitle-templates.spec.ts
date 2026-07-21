import { test, expect } from '@playwright/test';

/**
 * Subtitle Templates management page (/subtitle-templates).
 *
 * Mocks the profile + subtitle-template API and verifies the hierarchy:
 * templates expand to ordered styles, styles can be added, and the full set
 * persists in one request.
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

test('lists a template with child styles, adds a style, saves, and deletes', async ({ page }) => {
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  // List renders one template container, not two unrelated presets.
  const editor = page.getByTestId('subtitle-template-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('subtitle-template-row')).toHaveText(/Launch captions.*2 styles/);

  // Create: fresh page defaults to "New template" mode -> Save should POST.
  await page.getByTestId('subtitle-template-save').click();
  await expect.poll(() => recorded(page).some((request) => request.method === 'POST')).toBe(true);
  await expect(page.getByText('Template created')).not.toBeVisible({ timeout: 10_000 });

  // Selecting expands the saved template and exposes both styles underneath.
  await page.getByTestId('subtitle-template-row').click();
  await expect(page.getByTestId('subtitle-style-row')).toHaveCount(2);
  await expect(page.getByTestId('subtitle-style-row')).toHaveText([/Bold Yellow/, /Clean White/]);

  // Add a third style and rename it inline by double-clicking its current name.
  await page.getByRole('button', { name: 'Add style to Launch captions' }).click();
  await expect(page.getByTestId('subtitle-style-row')).toHaveCount(3);
  await page.getByTestId('subtitle-style-row').nth(2).getByText('Style 3').dblclick();
  const inlineName = page.getByTestId('subtitle-style-name-input');
  await expect(inlineName).toBeFocused();
  await inlineName.fill('Karaoke Green');
  await inlineName.press('Enter');
  await expect(page.getByTestId('subtitle-style-row').nth(2)).toContainText('Karaoke Green');
  await expect(page.getByTestId('subtitle-style-name')).toHaveValue('Karaoke Green');
  await expect(editor).toHaveScreenshot('subtitle-template-with-three-styles.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.02,
  });
  const slider = page.getByRole('slider').first();
  await slider.focus();
  await slider.press('ArrowRight');
  await page.getByTestId('subtitle-template-save').click();

  await expect.poll(() => recorded(page).find((request) => request.method === 'PUT')).toBeTruthy();
  const put = recorded(page).find((request) => request.method === 'PUT');
  const styles = (put?.body as { styles?: Array<{ name: string; settings: { fontSize?: number } }> })?.styles;
  expect(styles).toHaveLength(3);
  expect(styles?.map((style) => style.name)).toEqual(['Bold Yellow', 'Clean White', 'Karaoke Green']);
  expect(styles?.[2]?.settings.fontSize).toBeGreaterThan(48);

  // Delete keeps the existing confirm-gated template deletion flow.
  await page.getByRole('button', { name: 'Delete template' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete template' }).click();
  await expect.poll(() => recorded(page).some((request) => request.method === 'DELETE')).toBe(true);
});

test('orders, reorders, and resizes all subtitle workspace panels', async ({ page }) => {
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  const templates = page.getByTestId('subtitle-panel-templates');
  const settings = page.getByTestId('subtitle-panel-settings');
  const preview = page.getByTestId('subtitle-panel-preview');
  await expect(templates).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(preview).toBeVisible();

  const [templatesBox, settingsBox, previewBox] = await Promise.all([
    elementRect(templates),
    elementRect(settings),
    elementRect(preview),
  ]);
  expect(templatesBox.x).toBeLessThan(settingsBox.x);
  expect(settingsBox.x).toBeLessThan(previewBox.x);
  await expect(page.locator('[data-slot="resizable-handle"]')).toHaveCount(2);

  const panelHeaders = page.locator('[data-slot="workspace-panel-header"]');
  await expect(panelHeaders).toHaveCount(3);
  const headerRects = await panelHeaders.evaluateAll((headers) => headers.map((header) => {
    const rect = header.getBoundingClientRect();
    return { y: rect.y, height: rect.height };
  }));
  expect(headerRects.map(({ height }) => height)).toEqual([48, 48, 48]);
  expect(new Set(headerRects.map(({ y }) => y)).size).toBe(1);

  // Every header is a drag surface, including Preview.
  const previewHeader = page.getByTestId('subtitle-panel-header-preview');
  const previewHeaderBox = await elementRect(previewHeader);
  await page.mouse.move(
    previewHeaderBox.x + previewHeaderBox.width / 2,
    previewHeaderBox.y + previewHeaderBox.height / 2,
  );
  await page.mouse.down();
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
