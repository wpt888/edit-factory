import { expect, test } from "@playwright/test";

// Screenshot-only verification for the unified Step 3 inspector grammar. Uses
// fully mocked API routes (same approach as attention-step1-picker) so it does
// not depend on a seeded backend pipeline. Renders both the left Subtitle Style
// inspector and the right Render Settings panel.

const PIPELINE_ID = "grammar-step3-pipeline";
const PROFILE = {
  id: "grammar-step3-profile",
  name: "Grammar QA",
  is_default: true,
  created_at: "2026-07-21T00:00:00Z",
};

const previewFor = (offset: number) => ({
  audio_duration: 12,
  srt_content: "1\n00:00:00,000 --> 00:00:06,000\nOne two\n\n2\n00:00:06,000 --> 00:00:12,000\nThree four",
  matches: [
    { srt_index: 0, srt_text: "One two", srt_start: 0, srt_end: 6, segment_id: "seg-a", segment_keywords: ["first"], matched_keyword: "first", confidence: 1, source_video_id: "source-a", segment_start_time: offset, segment_end_time: offset + 6, merge_group: 0, merge_group_duration: 6 },
    { srt_index: 1, srt_text: "Three four", srt_start: 6, srt_end: 12, segment_id: "seg-b", segment_keywords: ["second"], matched_keyword: "second", confidence: 1, source_video_id: "source-b", segment_start_time: 0, segment_end_time: 6, merge_group: 1, merge_group_duration: 6 },
  ],
  total_phrases: 2,
  matched_count: 2,
  unmatched_count: 0,
  available_segments: [],
});

test("Step 3 renders both inspectors on the unified grammar", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.match(/attention-timeline\/[^/]+\/apply-template$/) && request.method() === "POST") {
      await route.fulfill({ json: { revision: 1, cues: [] } });
      return;
    }
    if (path.match(/attention-timeline\/[^/]+$/) && request.method() === "GET") {
      await route.fulfill({ json: { revision: 0, cues: [] } });
      return;
    }
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: [] } });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["One two three four", "Five six seven eight"],
        script_names: ["Variant one", "Variant two"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 12, has_srt: true }, "1": { has_audio: true, audio_duration: 12, has_srt: true } },
        tts_info: {
          "0": { has_audio: true, audio_duration: 12, approved: true, srt_content: "" },
          "1": { has_audio: true, audio_duration: 12, approved: true, srt_content: "" },
        },
        captions: {},
        selected_captions: {},
        name: "Grammar QA",
        idea: "Grammar QA",
        provider: "gemini",
        variant_count: 2,
        meta_multiplication: false,
        attention_selection: { templateId: "", assetUrls: [], staggerSeconds: 1, maxVariants: 0 },
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: { previews: { "0": previewFor(0), "1": previewFor(1) }, available_segments: [] } });
      return;
    }
    if (path.endsWith(`/pipeline/status/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        provider: "gemini",
        variant_count: 2,
        variants: [
          { variant_index: 0, status: "not_started", progress: 0, current_step: "" },
          { variant_index: 1, status: "not_started", progress: 0, current_step: "" },
        ],
        meta_variants: null,
        meta_multiplication: false,
        preview_info: {},
        tts_info: {},
        library_project_id: null,
      } });
      return;
    }
    if (path.endsWith("/profiles/") || path.endsWith("/profiles")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/tts-library/") || path.endsWith("/tts/voices") || path.endsWith("/subtitle-presets")) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);
  await page.waitForLoadState("networkidle");

  const advanced = page.getByRole("button", { name: /^Advanced$/ });
  if (await advanced.count() > 0) {
    await advanced.first().click();
    await page.waitForTimeout(500);
  }

  const renderSettings = page.getByTestId("step3-render-settings");
  await expect(renderSettings).toBeVisible({ timeout: 15_000 });
  await expect(renderSettings.getByText("Encoding Mode", { exact: true })).toBeVisible();

  const subtitlePanel = page.getByTestId("step3-inspector");
  const previewTargetPanel = page.getByTestId("step3-preview-target-panel");
  const variantPanel = page.getByTestId("step3-variant-canvas");
  await expect(subtitlePanel.locator('[data-slot="workspace-panel-header"]').filter({ hasText: "Subtitle Style" })).toBeVisible();
  await expect(previewTargetPanel.locator('[data-slot="workspace-panel-header"]')).toContainText("Preview Target");
  await expect(variantPanel.locator('[data-slot="workspace-panel-header"]')).toContainText("Variant Previews");
  await expect(previewTargetPanel.locator(':scope > [data-slot="workspace-panel-header"]')).toHaveCount(1);

  const previewTargetHeader = page.getByTestId("step3-preview-target-header");
  const variantHeader = page.getByTestId("step3-variant-header");
  const [previewTargetHeaderBox, variantHeaderBox] = await Promise.all([
    previewTargetHeader.boundingBox(),
    variantHeader.boundingBox(),
  ]);
  expect(previewTargetHeaderBox).not.toBeNull();
  expect(variantHeaderBox).not.toBeNull();
  expect(Math.abs(previewTargetHeaderBox!.y - variantHeaderBox!.y)).toBeLessThanOrEqual(1);
  expect(previewTargetHeaderBox!.height).toBe(variantHeaderBox!.height);
  await expect(previewTargetPanel).toHaveCSS("padding-top", "0px");
  await expect(previewTargetHeader.locator("svg")).toHaveCount(0);

  // Open the flush collapsible sections so the grammar (dividers, no boxes) shows.
  await renderSettings.getByRole("button", { name: /Video adjustments/ }).click();
  await renderSettings.getByRole("button", { name: /Audio adjustments/ }).click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: "screenshots/step3-inspector-grammar.png", fullPage: true });
});
