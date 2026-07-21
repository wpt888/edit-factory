import { expect, test } from '@playwright/test';

const step1Screenshot = 'screenshots/pipeline-step1-source-videos.png';
const emptyStateScreenshot = 'screenshots/pipeline-step1-source-videos-empty.png';

test('Step 1 aligns the source inspector beside the idea canvas', async ({ page }) => {
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

  const ideaCard = page.locator('[data-slot="card"]', { hasText: 'Video Idea' }).first();
  const sourceVideosCard = page.locator('[data-slot="card"]', { hasText: 'Source Videos' }).first();
  await expect(ideaCard).toBeVisible({ timeout: 45_000 });
  await expect(sourceVideosCard).toBeVisible({ timeout: 45_000 });

  const ideaBox = await ideaCard.boundingBox();
  const sourceVideosBox = await sourceVideosCard.boundingBox();
  expect(ideaBox).not.toBeNull();
  expect(sourceVideosBox).not.toBeNull();
  expect(sourceVideosBox!.x).toBeLessThan(ideaBox!.x);
  expect(Math.abs(sourceVideosBox!.y - ideaBox!.y)).toBeLessThanOrEqual(2);

  const sourceHeader = page.getByTestId('source-videos-header');
  const ideaHeader = page.getByTestId('step1-idea-header');
  const [sourceHeaderBox, ideaHeaderBox] = await Promise.all([
    sourceHeader.boundingBox(),
    ideaHeader.boundingBox(),
  ]);
  expect(sourceHeaderBox).not.toBeNull();
  expect(ideaHeaderBox).not.toBeNull();
  expect(Math.abs(sourceHeaderBox!.y - ideaHeaderBox!.y)).toBeLessThanOrEqual(1);
  expect(sourceHeaderBox!.height).toBe(ideaHeaderBox!.height);

  await expect(sourceHeader.getByRole('button', { name: 'Deselect All' })).toHaveCount(0);
  await expect(sourceHeader.getByRole('button', { name: 'Select All' })).toHaveCount(0);
  await expect(sourceVideosCard.getByRole('button', { name: 'Deselect All' })).toBeVisible();
  await expect(sourceVideosCard.getByRole('button', { name: 'Select All' })).toBeVisible();

  await page.screenshot({ path: step1Screenshot, fullPage: true });
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
