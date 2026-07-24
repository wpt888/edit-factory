import { test, expect } from '@playwright/test';

/**
 * Per-Meta-version subtitle styling — visual smoke test.
 *
 * Verifies the Subtitle Style card in Step 3 of the pipeline (Advanced mode):
 *   1. Meta OFF → zero tabs, one "Live Preview" panel, one settings panel.
 *   2. Meta ON  → two real A/B outputs in one preview selector and one shared
 *                 settings panel.
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
let simulateActiveVoiceRegeneration = false;

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
  simulateActiveVoiceRegeneration = false;
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
        tts_jobs: simulateActiveVoiceRegeneration
          ? {
              '0': {
                status: 'processing',
                progress: 45,
                current_step: 'Regenerating voice-over',
                attempt_id: 'active-voice-attempt',
                output_id: 'script_subtitle_meta:default',
              },
            }
          : {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${pipelineId}/restore-previews`)) {
      await route.fulfill({
        json: {
          previews: metaMultiplication
            ? { '0_A': preview, '0_B': preview }
            : { '0': preview },
          available_segments: [],
        },
      });
      return;
    }
    if (path.endsWith(`/pipeline/status/${pipelineId}`)) {
      await route.fulfill({ json: {
        pipeline_id: pipelineId,
        provider: 'gemini',
        variant_count: 1,
        variants: [{ variant_index: 0, status: 'not_started', progress: 0, current_step: '' }],
        // Keep one historical Meta result even when the persisted setting is
        // OFF. Status hydration must still select the base output.
        meta_variants: metaMultiplication
          ? { A: {}, B: {} }
          : [{
              variant_index: 0,
              visual_version: 'A',
              status: 'completed',
              progress: 100,
              current_step: 'Historical Meta render',
              final_video_path: 'historical-meta-a.mp4',
            }],
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
 * Locate the Subtitle Settings card's root element. We scope all assertions
 * to this scope to avoid false positives from the outer page (e.g. "Meta"
 * appearing in a breadcrumb).
 */
function styleCardLocator(page: import('@playwright/test').Page) {
  return page
    .getByTestId('step3-subtitle-style-header')
    .first()
    .locator('xpath=ancestor::div[@data-slot="card"][1]');
}

test('subtitle preview stays continuously visible between inspector and variants', async ({ page }) => {
  await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await enterAdvancedMode(page);
  await page.waitForTimeout(1500);

  const inspector = page.getByTestId('step3-inspector');
  const variantCanvas = page.getByTestId('step3-variant-canvas');
  const preview = page.getByTestId('subtitle-sticky-preview');

  await expect(preview).toBeVisible({ timeout: 10000 });
  const inspectorBox = await inspector.boundingBox();
  const previewBox = await preview.boundingBox();
  const canvasBox = await variantCanvas.boundingBox();
  expect(inspectorBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(previewBox!.x).toBeGreaterThanOrEqual(inspectorBox!.x + inspectorBox!.width - 2);
  expect(previewBox!.x + previewBox!.width).toBeLessThanOrEqual(canvasBox!.x + 2);

  const initialCanvasScrollTop = await variantCanvas.evaluate((element) => element.scrollTop);
  await inspector.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  // The middle preview is a permanent Step 3 column, so scrolling either
  // neighboring workspace does not move or hide it.
  await expect(preview).toBeInViewport();
  await expect.poll(() => variantCanvas.evaluate((element) => element.scrollTop)).toBe(initialCanvasScrollTop);
  await expect(page.getByTestId('subtitle-style-preview-toggle')).toHaveCount(0);
});

test.describe('Template-only subtitle assignment', () => {
  const PRESETS = [
    { id: 'preset-red', name: 'Bold Red', created_at: '', settings: { ...SUBTITLE_SETTINGS, textColor: '#ff0000' }, wordsPerSubtitle: 2 },
    { id: 'preset-yellow', name: 'Punchy Yellow', created_at: '', settings: { ...SUBTITLE_SETTINGS, textColor: '#ffff00' }, wordsPerSubtitle: 3 },
  ];

  // Layer a more-specific handler on top of beforeEach's: serve presets and
  // capture the rotation PUT so we can replay it on reload. Registered after
  // beforeEach, so Playwright runs it first; unmatched paths fall through.
  async function withPresetRoutes(page: import('@playwright/test').Page) {
    let stored: { enabled: boolean; presetIds: string[]; variantTemplates: Record<string, string> } = {
      enabled: false,
      presetIds: [],
      variantTemplates: {},
    };
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-presets`)) {
        await route.fulfill({ json: { presets: PRESETS } });
        return;
      }
      if (path.endsWith(`/pipeline/${PIPELINE_META_OFF}/subtitle-rotation`)) {
        if (route.request().method() === 'PUT') {
          stored = JSON.parse(route.request().postData() || '{}');
        }
        await route.fulfill({ json: stored });
        return;
      }
      await route.fallback();
    });
    return () => stored;
  }

  test('choosing one template updates every output through the single assignment source', async ({ page }) => {
    await withPresetRoutes(page);
    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_OFF}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1000);

    const selector = page.getByTestId('step3-subtitle-template-select');
    await expect(selector).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Default style · Default');

    await selector.click();
    await page.getByRole('option', { name: 'Punchy Yellow · 1 style', exact: true }).click();
    await page.getByRole('button', { name: 'Update 1 output', exact: true }).click();
    await expect(selector).toContainText('Punchy Yellow · 1 style');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Punchy Yellow · Template rotation');
    await expect(page.getByTestId('subtitle-assignment-badge')).toContainText('Punchy Yellow · Rotation');
    await expect(page.getByTestId('subtitle-style-to-apply')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Subtitle editing scope' })).toContainText('Pipeline defaults');
  });

  test('selection survives reload (persisted via rotation endpoint)', async ({ page }) => {
    await withPresetRoutes(page);
    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_OFF}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1000);

    const selector = page.getByTestId('step3-subtitle-template-select');
    await selector.click();
    await page.getByRole('option', { name: 'Bold Red · 1 style', exact: true }).click();
    await page.getByRole('button', { name: 'Update 1 output', exact: true }).click();
    await expect(selector).toContainText('Bold Red · 1 style');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Bold Red · Template rotation');

    // Reload — the captured PUT is replayed by GET, so the pick is restored.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1000);

    await expect(page.getByTestId('step3-subtitle-template-select')).toContainText('Bold Red · 1 style');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Bold Red · Template rotation');
  });
});

test.describe('Subtitle style — per-Meta-version model', () => {
  test('Meta ON separates the A/B switch from the template subtitle styles', async ({ page }) => {
    const templatePresets = [
      { id: 'preset-red', name: 'Bold Red', created_at: '', settings: { ...SUBTITLE_SETTINGS, textColor: '#ff0000' }, wordsPerSubtitle: 2 },
      { id: 'preset-yellow', name: 'Punchy Yellow', created_at: '', settings: { ...SUBTITLE_SETTINGS, textColor: '#ffff00' }, wordsPerSubtitle: 3 },
    ];

    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-presets`)) {
        await route.fulfill({ json: { presets: templatePresets } });
        return;
      }
      if (path.endsWith(`/pipeline/${PIPELINE_META_ON}/subtitle-rotation`)) {
        await route.fulfill({
          json: { enabled: true, presetIds: ['preset-red', 'preset-yellow'], variantTemplates: {} },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);

    const previewOutput = page.getByRole('combobox', { name: 'Preview output' });
    const editingScope = page.getByRole('combobox', { name: 'Subtitle editing scope' });
    await expect(previewOutput).toContainText('Variant 1 A · Bold Red');
    await expect(editingScope).toContainText('All A outputs');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Bold Red · Template rotation');
    await previewOutput.click();

    await expect(page.getByRole('option')).toHaveText([
      'Variant 1 A · Bold Red',
      'Variant 1 B · Punchy Yellow',
    ]);
    await expect(page.getByRole('listbox')).not.toContainText(/Instagram|Facebook/);
    await page.getByRole('option', { name: 'Variant 1 B · Punchy Yellow', exact: true }).click();

    await expect(previewOutput).toContainText('Variant 1 B · Punchy Yellow');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Punchy Yellow · Template rotation');
    await expect(editingScope).toContainText('All A outputs');
    await expect(page.getByTestId('studio-edit-scope')).toContainText('Editing: All A outputs');
    await expect(page.getByRole('combobox', { name: 'Subtitle style to apply' })).toHaveCount(0);
  });

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

    await expect(page.getByTestId('step3-subtitle-style-header')).toContainText('Subtitle Settings', { timeout: 10000 });
    await expect(page.getByRole('button', { name: /about subtitle settings/i })).toBeVisible();

    const styleCard = styleCardLocator(page);

    // Meta OFF → zero tabs inside the Subtitle Style card
    const tabsInStyleCard = styleCard.getByRole('tab');
    await expect(tabsInStyleCard).toHaveCount(0, { timeout: 3000 });

    // Meta OFF: the preview panel follows the one real output and reports its
    // current assignment independently from the staged style candidate.
    await expect(page.getByTestId('subtitle-style-preview-panel')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Preview output' })).toContainText('Variant 1 · Default');
    await expect(page.getByTestId('subtitle-current-assignment')).toContainText('Default style · Default');

    // "Save as preset" button must still be present (global action)
    await expect(page.getByRole('button', { name: /save as preset/i })).toBeVisible();

    await page.screenshot({
      path: 'screenshots/subtitle-meta-off.png',
      fullPage: true,
    });

    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Meta ON → two real outputs + one active live preview', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1500);

    await expect(page.getByTestId('step3-subtitle-style-header')).toContainText('Subtitle Settings', { timeout: 10000 });
    await expect(page.getByRole('button', { name: /about subtitle settings/i })).toBeVisible();

    const styleCard = styleCardLocator(page);

    // Output selection lives with the preview, not in the settings inspector.
    const tabs = styleCard.getByRole('tab');
    await expect(tabs).toHaveCount(0, { timeout: 5000 });

    await expect(page.getByRole('combobox', { name: 'Preview output' })).toContainText('Variant 1 A · Default');
    await expect(page.getByRole('radio', { name: /Preview video variant/ })).toHaveCount(0);

    await page.screenshot({
      path: 'screenshots/subtitle-meta-on.png',
      fullPage: true,
    });

    expect(consoleErrors, `Console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  });

  test('Meta ON → preview changes do not change the edit target', async ({ page }) => {
    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);
    await page.waitForTimeout(1500);

    const previewOutput = page.getByRole('combobox', { name: 'Preview output' });
    const editingScope = page.getByRole('combobox', { name: 'Subtitle editing scope' });
    await expect(previewOutput).toContainText('Variant 1 A · Default');
    await expect(editingScope).toContainText('All A outputs');

    await page.screenshot({
      path: 'screenshots/subtitle-editing-a-vs-b.png',
      fullPage: true,
    });

    await previewOutput.click();
    await page.getByRole('option', { name: 'Variant 1 B · Default', exact: true }).click();
    await page.waitForTimeout(300);
    await expect(previewOutput).toContainText('Variant 1 B · Default');
    await expect(editingScope).toContainText('All A outputs');

    await editingScope.click();
    await page.getByRole('option', { name: 'Output · Variant 1 B', exact: true }).click();
    await expect(page.getByTestId('studio-preview-scope')).toContainText('Previewing: Variant 1 B');
    await expect(page.getByTestId('studio-edit-scope')).toContainText('Editing: Output Variant 1 B');
    await page.waitForTimeout(300);
    await page.screenshot({
      path: 'screenshots/studio-scope-output-b.png',
      fullPage: true,
    });
  });

  test('output subtitle override works without an assigned template', async ({ page }) => {
    let checkPayload: Record<string, unknown> | null = null;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/pipeline/check-render/${PIPELINE_META_ON}`)) {
        checkPayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({ json: { results: [], any_skippable: false } });
        return;
      }
      if (path.endsWith(`/pipeline/render/${PIPELINE_META_ON}`)) {
        await route.fulfill({
          json: {
            pipeline_id: PIPELINE_META_ON,
            rendering_variants: [0],
            total_variants: 2,
            meta_multiplication: true,
            visual_versions: ['A', 'B'],
          },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);

    const editingScope = page.getByRole('combobox', { name: 'Subtitle editing scope' });
    await editingScope.click();
    await page.getByRole('option', { name: 'Output · Variant 1 B', exact: true }).click();

    const fontSize = styleCardLocator(page).getByRole('slider').first();
    await expect(fontSize).toHaveAttribute('aria-valuenow', '48');
    await fontSize.press('ArrowRight');
    await expect(fontSize).toHaveAttribute('aria-valuenow', '49');

    await page.getByTestId('step3-go-to-export').click();
    await page.getByTestId('export-render-button').click();
    await expect.poll(() => checkPayload).not.toBeNull();

    const subtitles = (checkPayload as unknown as {
      subtitle_settings_by_key?: Record<string, { fontSize?: number }>;
    }).subtitle_settings_by_key;
    expect(subtitles?.['0_A']?.fontSize).toBe(48);
    expect(subtitles?.['0_B']?.fontSize).toBe(49);
  });

  test('Meta A and B are independently selectable through the render payload', async ({ page }) => {
    let checkPayload: Record<string, unknown> | null = null;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith(`/pipeline/check-render/${PIPELINE_META_ON}`)) {
        checkPayload = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({ json: { results: [], any_skippable: false } });
        return;
      }
      if (path.endsWith(`/pipeline/render/${PIPELINE_META_ON}`)) {
        await route.fulfill({
          json: {
            pipeline_id: PIPELINE_META_ON,
            rendering_variants: [0],
            total_variants: 1,
            meta_multiplication: true,
            visual_versions: ['B'],
          },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_ON}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await enterAdvancedMode(page);

    const outputA = page.getByRole('checkbox', { name: 'Select Variant 1 A for render' });
    const outputB = page.getByRole('checkbox', { name: 'Select Variant 1 B for render' });
    await expect(outputA).toBeChecked();
    await expect(outputB).toBeChecked();
    await outputA.uncheck();
    await expect(outputA).not.toBeChecked();
    await expect(outputB).toBeChecked();
    await expect(page.getByTestId('studio-render-scope')).toContainText('Render: 1 output selected');

    await page.getByTestId('step3-go-to-export').click();
    await page.getByTestId('export-render-button').click();

    await expect.poll(() => checkPayload).not.toBeNull();
    expect(checkPayload).toMatchObject({
      variant_indices: [0],
      output_keys: ['0_B'],
      meta_multiplication: true,
    });
  });

  test('active voice regeneration locks Preview, Meta, and Render actions', async ({ page }) => {
    simulateActiveVoiceRegeneration = true;
    await page.setViewportSize({ width: 2048, height: 900 });
    await page.goto(`/pipeline?step=2&id=${PIPELINE_META_OFF}`);
    await page.waitForLoadState('networkidle');
    await enterAdvancedMode(page);

    await expect(
      page.getByRole('button', { name: /Generate (Previews|Voice-Overs)/ }),
    ).toBeDisabled();
    await expect(
      page.getByRole('checkbox', { name: 'Meta Multiplication before preview' }),
    ).toBeDisabled();
    await page.screenshot({
      path: 'screenshots/voice-regeneration-action-lock.png',
      fullPage: false,
    });

    await page.goto(`/pipeline?step=3&id=${PIPELINE_META_OFF}`);
    await page.waitForLoadState('networkidle');
    await enterAdvancedMode(page);
    await page.getByTestId('pipeline-mode-export').click();
    await expect(page.getByTestId('export-render-button')).toBeDisabled();
    await expect(page.getByTestId('export-render-button')).toContainText(
      'Voice-over updating...',
    );
  });
});
