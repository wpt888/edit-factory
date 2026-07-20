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

const PROFILE = {
  id: 'subtitle-meta-profile',
  name: 'Subtitle Meta QA',
  is_default: true,
  created_at: '2026-07-20T00:00:00Z',
};

const SUBTITLE_SETTINGS = {
  fontSize: 48,
  fontFamily: 'Montserrat',
  textColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 3,
  positionY: 85,
  horizontalAlignment: 'center',
  letterSpacing: 0,
  opacity: 100,
};

const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwK8AAAAAElFTkSuQmCC',
  'base64',
);

const makeSilentWav = () => {
  const sampleRate = 8_000;
  const samples = sampleRate * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((profile) => {
    localStorage.setItem('editai_profiles', JSON.stringify([profile]));
    localStorage.setItem('editai_current_profile_id', profile.id);
  }, PROFILE);

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const pipelineId = path.includes(PIPELINE_META_ON) ? PIPELINE_META_ON : PIPELINE_META_OFF;
    const metaMultiplication = pipelineId === PIPELINE_META_ON;
    const preview = {
      audio_duration: 3,
      srt_content: '1\n00:00:00,000 --> 00:00:03,000\nSubtitle preview text',
      matches: [{
        srt_index: 0,
        srt_text: 'Subtitle preview text',
        srt_start: 0,
        srt_end: 3,
        segment_id: 'segment-a',
        segment_keywords: ['demo'],
        matched_keyword: 'demo',
        confidence: 1,
        source_video_id: 'source-a',
        segment_start_time: 0,
        segment_end_time: 3,
        merge_group: 0,
        merge_group_duration: 3,
      }],
      total_phrases: 1,
      matched_count: 1,
      unmatched_count: 0,
      available_segments: [],
      intro_offset_sec: 0,
      intro_segments: [],
      video_timeline: [{
        id: 'body-a',
        kind: 'body',
        segment_id: 'segment-a',
        segment_keywords: ['demo'],
        source_video_id: 'source-a',
        start_time: 0,
        end_time: 3,
        timeline_start: 0,
        timeline_duration: 3,
      }],
    };

    if (path.endsWith(`/pipeline/audio/${pipelineId}/0`)) {
      await route.fulfill({ status: 200, contentType: 'audio/wav', body: makeSilentWav() });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${pipelineId}`)) {
      await route.fulfill({ json: {
        pipeline_id: pipelineId,
        scripts: ['Subtitle preview text'],
        script_names: ['Subtitle QA'],
        context_products: [],
        preview_info: { '0': { has_audio: true, audio_duration: 3, has_srt: true } },
        tts_info: { '0': { has_audio: true, audio_duration: 3, approved: true, srt_content: preview.srt_content } },
        captions: {},
        selected_captions: {},
        name: 'Subtitle Meta QA',
        idea: 'Subtitle Meta QA',
        provider: 'gemini',
        variant_count: 1,
        meta_multiplication: metaMultiplication,
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/restore-previews`)) {
      await route.fulfill({ json: { previews: { '0': preview }, available_segments: [] } });
      return;
    }
    if (path.endsWith(`/pipeline/status/${pipelineId}`)) {
      await route.fulfill({ json: {
        pipeline_id: pipelineId,
        provider: 'gemini',
        variant_count: 1,
        variants: [{ variant_index: 0, status: 'not_started', progress: 0, current_step: '' }],
        meta_variants: metaMultiplication ? { A: {}, B: {} } : null,
        meta_multiplication: metaMultiplication,
        preview_info: {},
        tts_info: {},
        library_project_id: null,
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/source-selection`)) {
      await route.fulfill({ json: { source_video_ids: ['source-a'] } });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/subtitle-overrides`)) {
      await route.fulfill({ json: { overrides: {} } });
      return;
    }
    if (path.includes('/pipeline/subtitle-frame-preview/')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PNG });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-settings`)) {
      await route.fulfill({ json: SUBTITLE_SETTINGS });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-presets`)) {
      await route.fulfill({ json: { presets: [] } });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}`)) {
      await route.fulfill({ json: { ...PROFILE, tts_settings: {} } });
      return;
    }
    if (path.endsWith('/profiles/') || path.endsWith('/profiles')) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith('/segments/source-videos')) {
      await route.fulfill({ json: [{ id: 'source-a', name: 'Source A', duration: 3, segments_count: 1, status: 'ready' }] });
      return;
    }
    if (path.endsWith('/tts-library/') || path.endsWith('/tts/voices') || path.endsWith('/subtitle-presets')) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith('/pipeline/segment-duration')) {
      await route.fulfill({ json: { total_segment_duration: 3 } });
      return;
    }
    if (path.endsWith('/ai-instructions')) {
      await route.fulfill({ json: { ai_instructions: '' } });
      return;
    }
    await route.fulfill({ json: {} });
  });
});

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
