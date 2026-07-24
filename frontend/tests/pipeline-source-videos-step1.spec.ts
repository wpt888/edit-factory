import { expect, test } from '@playwright/test';

const step1Screenshot = 'screenshots/pipeline-step1-source-videos.png';
const guidedStep1Screenshot = 'screenshots/pipeline-step1-guided-compact.png';
const emptyStateScreenshot = 'screenshots/pipeline-step1-source-videos-empty.png';

test('Step 1 aligns the source inspector beside the idea canvas', async ({ page }) => {
  await page.addInitScript(() => {
    const profile = {
      id: 'source-videos-step1-profile',
      name: 'Source Videos QA',
      is_default: true,
      created_at: '2026-07-21T00:00:00Z',
    };
    localStorage.setItem('editai_profiles', JSON.stringify([profile]));
    localStorage.setItem('editai_current_profile_id', profile.id);
  });
  await page.route('**/api/v1/segments/source-videos*', async (route) => {
    await route.fulfill({
      json: [
        { id: 'source-a', name: 'Source A', duration: 12, segments_count: 2, thumbnail_path: null },
        { id: 'source-b', name: 'Source B', duration: 8, segments_count: 1, thumbnail_path: null },
      ],
    });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/pipeline');

  const ideaCard = page.getByTestId('step1-idea-canvas').locator('[data-slot="card"]').first();
  const sourceVideosCard = page.getByTestId('source-videos-panel');
  await expect(ideaCard).toBeVisible({ timeout: 45_000 });
  await expect(sourceVideosCard).toBeVisible({ timeout: 45_000 });

  const sourceHeader = page.getByTestId('source-videos-header');
  const ideaHeader = page.getByTestId('step1-idea-header');
  await expect(sourceHeader.getByRole('button', { name: 'Deselect All' })).toHaveCount(0);
  await expect(sourceHeader.getByRole('button', { name: 'Select All', exact: true })).toHaveCount(0);
  await expect(sourceVideosCard.getByRole('button', { name: 'Deselect All' })).toBeVisible();
  await expect(sourceVideosCard.getByRole('button', { name: 'Select All', exact: true })).toBeVisible();

  const [sourceHeaderBox, ideaHeaderBox] = await Promise.all([
    sourceHeader.boundingBox(),
    ideaHeader.boundingBox(),
  ]);
  expect(sourceHeaderBox).not.toBeNull();
  expect(ideaHeaderBox).not.toBeNull();
  expect(Math.abs(sourceHeaderBox!.y - ideaHeaderBox!.y)).toBeLessThanOrEqual(1);
  expect(sourceHeaderBox!.height).toBe(ideaHeaderBox!.height);

  await page.screenshot({ path: step1Screenshot, fullPage: true });
});

test('Step 1 guided layout stacks footage above a compact centered editor', async ({ page }) => {
  await page.addInitScript(() => {
    const profile = {
      id: 'guided-step1-profile',
      name: 'Guided Step 1 QA',
      is_default: true,
      created_at: '2026-07-23T00:00:00Z',
    };
    localStorage.setItem('editai_profiles', JSON.stringify([profile]));
    localStorage.setItem('editai_current_profile_id', profile.id);
    localStorage.setItem('blipost.pipeline-layout', JSON.stringify('guided'));
  });
  await page.route('**/api/v1/segments/source-videos*', async (route) => {
    await route.fulfill({
      json: [
        { id: 'source-a', name: 'Product demo — wide angle', duration: 42, segments_count: 5, thumbnail_path: null },
        { id: 'source-b', name: 'Product detail — close-up', duration: 36, segments_count: 4, thumbnail_path: null },
      ],
    });
  });
  await page.setViewportSize({ width: 1536, height: 1100 });
  await page.goto('/pipeline');

  const workspace = page.getByTestId('step1-workspace');
  const sourceVideos = page.getByTestId('source-videos-panel');
  const ideaCanvas = page.getByTestId('step1-idea-canvas');
  await expect(workspace).toHaveAttribute('data-layout', 'guided', { timeout: 45_000 });
  await expect(sourceVideos).toBeVisible();
  await expect(ideaCanvas).toBeVisible();

  const [workspaceBox, sourceBox, ideaBox] = await Promise.all([
    workspace.boundingBox(),
    sourceVideos.boundingBox(),
    ideaCanvas.boundingBox(),
  ]);
  expect(workspaceBox).not.toBeNull();
  expect(sourceBox).not.toBeNull();
  expect(ideaBox).not.toBeNull();
  expect(workspaceBox!.width).toBeLessThanOrEqual(1280);
  expect(ideaBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);

  await page.getByTestId('step1-advanced-trigger').click();
  await expect(page.getByTestId('step1-advanced-content')).toBeVisible();
  await page.screenshot({ path: guidedStep1Screenshot, fullPage: true });
});

test('Step 1 empty state warns and links to Segments', async ({ page }) => {
  await page.route('**/api/v1/segments/source-videos*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/pipeline');

  const warning = page.getByRole('alert').filter({
    hasText: 'No video material yet — scripts will have nothing to match.',
  });
  const addSourceVideos = warning.getByRole('link', { name: 'Add source videos' });
  await expect(warning).toBeVisible({ timeout: 45_000 });
  await expect(addSourceVideos).toBeEnabled();
  await expect(addSourceVideos).toHaveAttribute('href', '/segments');
  await page.getByLabel('Video Idea *').fill('A script that can be generated without source videos');
  await page.getByLabel('Video Idea *').blur();
  await expect(page.getByRole('button', { name: 'Generate Scripts' })).toBeEnabled();

  await warning.scrollIntoViewIfNeeded();
  await page.screenshot({ path: emptyStateScreenshot, fullPage: true });
  await addSourceVideos.click();
  await expect(page).toHaveURL(/\/segments(?:\?.*)?$/);
});
