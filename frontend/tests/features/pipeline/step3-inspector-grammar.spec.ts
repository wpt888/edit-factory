import { expect, test } from "@playwright/test";

// Screenshot-only verification for the unified Step 3 inspector grammar. Uses
// fully mocked API routes (same approach as attention-step1-picker) so it does
// not depend on a seeded backend pipeline. Verifies the editing workspace and
// the separate top-level Export workspace.

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

test("Edit and Export stay separate while sharing the inspector grammar", async ({ page }) => {
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

  const advanced = page.getByRole("button", { name: /^Advanced$/ });
  if (await advanced.count() > 0) {
    await advanced.first().click();
    await page.waitForTimeout(500);
  }

  await expect(page.getByTestId("export-render-settings")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-step-4")).toBeVisible();
  await expect(page.getByTestId("pipeline-step-4")).toContainText("Render");

  const subtitlePanel = page.getByTestId("step3-inspector");
  const previewTargetPanel = page.getByTestId("step3-preview-target-panel");
  const variantPanel = page.getByTestId("step3-variant-canvas");
  await expect(page.getByTestId("step3-workspace")).toHaveCSS("overflow", "hidden");
  await expect(subtitlePanel.locator('[data-slot="workspace-panel-header"]').filter({ hasText: "Subtitle Settings" })).toBeVisible();
  await expect(previewTargetPanel.locator('[data-slot="workspace-panel-header"]')).toContainText("Subtitle Preview");
  await expect(variantPanel.locator('[data-slot="workspace-panel-header"]')).toContainText("Variant Previews");
  await expect(previewTargetPanel.locator(':scope > [data-slot="workspace-panel-header"]')).toHaveCount(1);
  const workspacePanes = [
    subtitlePanel.locator("xpath=ancestor::*[@data-workspace-pane][1]"),
    previewTargetPanel.locator("xpath=ancestor::*[@data-workspace-pane][1]"),
    variantPanel.locator("xpath=ancestor::*[@data-workspace-pane][1]"),
  ];
  for (const pane of workspacePanes) {
    await expect(pane).toHaveCount(1);
    await expect(pane).toHaveCSS("padding-bottom", "12px");
    expect(await pane.evaluate((element) => {
      const endcap = getComputedStyle(element, "::after");
      return {
        position: endcap.position,
        bottom: endcap.bottom,
        height: endcap.height,
      };
    })).toEqual({ position: "absolute", bottom: "0px", height: "12px" });
  }
  const resourceTablist = previewTargetPanel.getByRole("tablist", { name: "Preview resource panels" });
  const imageTemplatesTab = resourceTablist.getByRole("tab", { name: /Image Templates/ });
  await expect(imageTemplatesTab).toBeVisible();
  await expect(imageTemplatesTab).toHaveCSS("border-top-width", "2px");
  await expect(imageTemplatesTab).toHaveCSS("border-bottom-width", "0px");
  const [resourceTablistBox, imageTemplatesTabBox] = await Promise.all([
    resourceTablist.boundingBox(),
    imageTemplatesTab.boundingBox(),
  ]);
  expect(resourceTablistBox).not.toBeNull();
  expect(imageTemplatesTabBox).not.toBeNull();
  expect(Math.abs(resourceTablistBox!.x - imageTemplatesTabBox!.x)).toBeLessThanOrEqual(1);
  const sourcesTab = previewTargetPanel.getByRole("tab", { name: /Sources/ });
  await expect(sourcesTab).toBeVisible();
  await sourcesTab.click();
  await expect(sourcesTab).toHaveAttribute("aria-selected", "true");
  await expect(previewTargetPanel.getByTestId("step3-sources")).toBeVisible();
  const imageTemplatesPanel = previewTargetPanel.getByTestId("step3-attention-apply");
  await expect(imageTemplatesPanel).toBeAttached();
  await expect(imageTemplatesPanel).toBeHidden();
  await expect(imageTemplatesPanel).toHaveAttribute("hidden", "");
  await expect(previewTargetPanel.getByRole("combobox", { name: "Filter sources by type" })).toBeVisible();
  await expect(previewTargetPanel.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  await previewTargetPanel.getByRole("button", { name: "Icon view" }).click();
  await expect(previewTargetPanel.getByTestId("step3-source-inventory")).toHaveAttribute("data-view", "icons");

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
  await expect(previewTargetHeader.locator('[data-slot="workspace-panel-grip"]')).toBeVisible();
  await expect(variantPanel).toHaveCSS("overflow-x", "hidden");

  const previewPanel = page.getByTestId("subtitle-style-preview-panel");
  const previewFrame = previewPanel.locator(":scope > div").first();
  const targetSelect = previewPanel.getByTestId("subtitle-preview-output");
  const [previewFrameBox, targetSelectBox] = await Promise.all([
    previewFrame.boundingBox(),
    targetSelect.boundingBox(),
  ]);
  expect(previewFrameBox).not.toBeNull();
  expect(targetSelectBox).not.toBeNull();
  expect(targetSelectBox!.y).toBeGreaterThan(previewFrameBox!.y + previewFrameBox!.height);
  await expect(subtitlePanel.getByTestId("subtitle-version-switch")).toHaveCount(0);

  const previewPane = page.getByTestId("subtitle-sticky-preview");
  const previewPanelsScroller = page.getByTestId("step3-preview-panels-scroll");
  await expect(previewPane).toHaveCSS("overflow", "hidden");
  await expect(previewPanelsScroller).toHaveCSS("overflow-y", "auto");
  const [resourceTabsBeforeScroll, previewPanelsScrollerBox] = await Promise.all([
    resourceTablist.boundingBox(),
    previewPanelsScroller.boundingBox(),
  ]);
  expect(resourceTabsBeforeScroll).not.toBeNull();
  expect(previewPanelsScrollerBox).not.toBeNull();
  expect(previewPanelsScrollerBox!.y).toBeGreaterThanOrEqual(
    resourceTabsBeforeScroll!.y + resourceTabsBeforeScroll!.height - 1,
  );
  const previewFrameY = (await previewFrame.boundingBox())!.y;
  await previewPanelsScroller.evaluate((element) => {
    element.scrollTop = Math.min(800, element.scrollHeight - element.clientHeight);
  });
  await expect.poll(async () => {
    const stickyPreviewBox = await previewFrame.boundingBox();
    if (!stickyPreviewBox) return Number.POSITIVE_INFINITY;
    return Math.abs(stickyPreviewBox.y - previewFrameY);
  }).toBeLessThanOrEqual(0.5);
  await expect.poll(async () => {
    const resourceTabsAfterScroll = await resourceTablist.boundingBox();
    if (!resourceTabsAfterScroll) return Number.POSITIVE_INFINITY;
    return Math.abs(resourceTabsAfterScroll.y - resourceTabsBeforeScroll!.y);
  }).toBeLessThanOrEqual(0.5);

  await page.screenshot({ path: "screenshots/step3-inspector-grammar.png", fullPage: true });

  await page.mouse.move(
    previewTargetHeaderBox!.x + previewTargetHeaderBox!.width / 2,
    previewTargetHeaderBox!.y + previewTargetHeaderBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    variantHeaderBox!.x + variantHeaderBox!.width / 2,
    variantHeaderBox!.y + variantHeaderBox!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();

  await expect.poll(async () => (await previewTargetHeader.boundingBox())?.x)
    .toBeGreaterThan((await variantHeader.boundingBox())?.x ?? Number.MAX_SAFE_INTEGER);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("blipost.pipeline-split.step3-preview-canvas.swapped")))
    .toBe("1");

  const editTab = page.getByTestId("pipeline-mode-edit");
  const exportTab = page.getByTestId("pipeline-mode-export");
  const [editTabBefore, exportTabBefore] = await Promise.all([
    editTab.boundingBox(),
    exportTab.boundingBox(),
  ]);
  await expect(page.getByTestId("step3-go-to-export")).toBeEnabled();
  await page.getByTestId("step3-go-to-export").click();
  const exportSettings = page.getByTestId("export-render-settings");
  await expect(exportSettings).toBeVisible();
  await expect(exportSettings.getByText("Encoding Mode", { exact: true })).toBeVisible();
  await expect(page.getByTestId("step3-workspace")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`\\?step=3&id=${PIPELINE_ID}`));
  await expect(page.getByTestId("pipeline-workspace-tabs")).toBeVisible();
  await expect(exportTab).toHaveAttribute("data-state", "active");
  const [editTabAfter, exportTabAfter] = await Promise.all([
    editTab.boundingBox(),
    exportTab.boundingBox(),
  ]);
  expect(editTabAfter).toEqual(editTabBefore);
  expect(exportTabAfter).toEqual(exportTabBefore);
  expect(await exportTab.evaluate((element) => getComputedStyle(element, "::after").top)).toBe("-5px");

  await exportSettings.getByRole("button", { name: /Video adjustments/ }).click();
  await exportSettings.getByRole("button", { name: /Audio adjustments/ }).click();
  await expect(page.getByTestId("export-render-button")).toBeEnabled();
  await page.screenshot({ path: "screenshots/export-settings-workspace.png", fullPage: true });

  await page.getByTestId("pipeline-mode-edit").click();
  await expect(page.getByTestId("step3-workspace")).toBeVisible();
  await expect(page.getByTestId("export-render-settings")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`\\?step=3&id=${PIPELINE_ID}`));

  await page.getByTestId("pipeline-step-2").click();
  await expect(page.getByTestId("pipeline-workspace-tabs")).toHaveCount(0);
});
