import { test, expect } from '@playwright/test';

/**
 * Subtitle Templates management page (/subtitle-templates).
 *
 * Mocks the profile + subtitle-preset API (same pattern as the TTS specs) and
 * verifies: the template list renders, creating calls POST, editing font size
 * marks state and lands in the PUT payload, and delete calls DELETE.
 */

const PROFILE = {
  id: 'subtitle-templates-profile',
  name: 'Subtitle Templates QA',
  is_default: true,
  created_at: '2026-07-20T00:00:00Z',
};

const PRESET = {
  id: 'preset-1',
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

    if (path.includes('/subtitle-presets')) {
      if (method === 'GET') {
        await route.fulfill({ json: { presets: [PRESET] } });
        return;
      }
      recorded.push({ method, path, body });
      if (method === 'POST') {
        await route.fulfill({ json: { ...PRESET, id: 'preset-new', ...(body as object) } });
        return;
      }
      if (method === 'PUT') {
        await route.fulfill({ json: { ...PRESET, ...(body as object) } });
        return;
      }
      await route.fulfill({ json: {} }); // DELETE
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

test('lists templates, creates, edits font size (PUT), and deletes', async ({ page }) => {
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  // List renders the seeded preset.
  const editor = page.getByTestId('subtitle-template-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('subtitle-template-row')).toHaveText(/Bold Yellow/);

  await page.screenshot({ path: 'screenshots/subtitle-templates.png', fullPage: true });

  // Create: fresh page defaults to "New template" mode → Save should POST.
  await page.getByTestId('subtitle-template-save').click();
  await expect.poll(() => recorded(page).some((r) => r.method === 'POST')).toBe(true);

  // Edit an existing template's font size → PUT payload carries the new value.
  await page.getByTestId('subtitle-template-row').click();
  const slider = page.getByRole('slider').first();
  await slider.focus();
  await slider.press('ArrowRight');
  await page.getByTestId('subtitle-template-save').click();

  await expect.poll(() => recorded(page).find((r) => r.method === 'PUT')).toBeTruthy();
  const put = recorded(page).find((r) => r.method === 'PUT');
  const settings = (put?.body as { settings?: { fontSize?: number } })?.settings;
  expect(settings?.fontSize).toBeGreaterThan(48);

  // Delete: sidebar button opens the confirm dialog → confirm → DELETE.
  await page.getByRole('button', { name: 'Delete template' }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete template' }).click();
  await expect.poll(() => recorded(page).some((r) => r.method === 'DELETE')).toBe(true);
});

test('orders, reorders, and resizes all subtitle workspace panels', async ({ page }) => {
  await page.goto('/subtitle-templates');
  await page.waitForLoadState('networkidle');

  const templates = page.getByTestId('subtitle-panel-templates');
  const settings = page.getByTestId('subtitle-panel-settings');
  const preview = page.getByTestId('subtitle-panel-preview');

  const [templatesBox, settingsBox, previewBox] = await Promise.all([
    templates.boundingBox(),
    settings.boundingBox(),
    preview.boundingBox(),
  ]);
  expect(templatesBox).not.toBeNull();
  expect(settingsBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(templatesBox!.x).toBeLessThan(settingsBox!.x);
  expect(settingsBox!.x).toBeLessThan(previewBox!.x);
  await expect(page.locator('[data-slot="resizable-handle"]')).toHaveCount(2);

  // Every header is a drag surface, including Preview.
  const previewHeader = page.getByTestId('subtitle-panel-header-preview');
  const previewHeaderBox = await previewHeader.boundingBox();
  expect(previewHeaderBox).not.toBeNull();
  await page.mouse.move(
    previewHeaderBox!.x + previewHeaderBox!.width / 2,
    previewHeaderBox!.y + previewHeaderBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(templatesBox!.x + 10, templatesBox!.y + 24, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => (await preview.boundingBox())?.x ?? Number.MAX_SAFE_INTEGER)
    .toBeLessThan((await templates.boundingBox())!.x);

  // The vertical separator changes the adjacent panel width.
  const firstHandle = page.locator('[data-slot="resizable-handle"]').first();
  const handleBox = await firstHandle.boundingBox();
  const widthBefore = (await preview.boundingBox())!.width;
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + 60, handleBox!.y + 100, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await preview.boundingBox())!.width).not.toBe(widthBefore);
});
