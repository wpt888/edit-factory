import { expect, test, type Page } from "@playwright/test";

// Regression: the Transitions V1 boundary dot used to sit at the vertical
// center of the cut — exactly over the trim handle's natural grab point — so
// grabbing the boundary in the middle silently did nothing (no resize). The
// dot now lives at the top of the cut; the handle owns the middle.

const PIPELINE_ID = "trim-handle-pipeline";
const PROFILE = {
  id: "trim-handle-profile",
  name: "Trim Handle QA",
  is_default: true,
  created_at: "2026-07-17T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
];

const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 0, timeline_duration: 2 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2, timeline_duration: 2 },
];

const makeSilentWav = () => {
  const sampleRate = 8_000;
  const samples = sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
};

const setupStep3 = async (page: Page) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    if (path.endsWith(`/pipeline/audio/${PIPELINE_ID}/0`)) {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: makeSilentWav() });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["One two three four"],
        script_names: ["Trim Handle QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 4, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 4, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Trim Handle QA",
        idea: "Trim Handle QA",
        provider: "gemini",
        variant_count: 1,
        meta_multiplication: false,
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: {
        previews: {
          "0": {
            audio_duration: 4,
            srt_content: "1\n00:00:00,000 --> 00:00:02,000\nOne two\n\n2\n00:00:02,000 --> 00:00:04,000\nThree four",
            matches: [
              { srt_index: 0, srt_text: "One two", srt_start: 0, srt_end: 2, segment_id: "seg-a", segment_keywords: ["first"], matched_keyword: "first", confidence: 1, source_video_id: "source-a", segment_start_time: 0, segment_end_time: 4, merge_group: 0, merge_group_duration: 2 },
              { srt_index: 1, srt_text: "Three four", srt_start: 2, srt_end: 4, segment_id: "seg-b", segment_keywords: ["second"], matched_keyword: "second", confidence: 1, source_video_id: "source-b", segment_start_time: 0, segment_end_time: 4, merge_group: 1, merge_group_duration: 2 },
            ],
            total_phrases: 2,
            matched_count: 2,
            unmatched_count: 0,
            available_segments: SEGMENTS,
            intro_offset_sec: 0,
            intro_segments: [],
            video_timeline: COMPOSITION,
          },
        },
        available_segments: SEGMENTS,
      } });
      return;
    }
    if (path.endsWith(`/pipeline/status/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        provider: "gemini",
        variant_count: 1,
        variants: [{ variant_index: 0, status: "not_started", progress: 0, current_step: "" }],
        meta_variants: null,
        meta_multiplication: false,
        preview_info: {},
        tts_info: {},
        library_project_id: null,
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/source-selection`)) {
      await route.fulfill({ json: { source_video_ids: ["source-a", "source-b"] } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/subtitle-overrides`)) {
      await route.fulfill({ json: { overrides: {} } });
      return;
    }
    if (path.endsWith("/profiles/") || path.endsWith("/profiles")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ json: [
        { id: "source-a", name: "Source A", duration: 10, segments_count: 1, status: "ready" },
        { id: "source-b", name: "Source B", duration: 10, segments_count: 1, status: "ready" },
      ] });
      return;
    }
    if (path.includes("/preview-proxy")) {
      await route.fulfill({ json: { status: "ready" } });
      return;
    }
    if (path.endsWith("/tts-library/") || path.endsWith("/tts/voices") || path.endsWith("/subtitle-presets")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/pipeline/segment-duration")) {
      await route.fulfill({ json: { total_segment_duration: 20 } });
      return;
    }
    if (path.endsWith("/ai-instructions")) {
      await route.fulfill({ json: { ai_instructions: "" } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);
};

// Grab the trim boundary dead-center — the gesture that used to be swallowed.
const dragHandleCenterBy = async (page: Page, scope: ReturnType<Page["locator"]>, dx: number) => {
  const handle = scope.locator('[role="separator"][aria-label^="Trim boundary"]').first();
  await expect(handle).toBeVisible();
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
  await page.mouse.up();
};

const clipDuration = async (scope: ReturnType<Page["locator"]>, id: string) => {
  const text = await scope.getByTestId(`composition-clip-${id}`).locator("span.font-mono").last().innerText();
  return parseFloat(text);
};

test("maximized editor: trim handle grabbed at its center resizes the clip", async ({ page }) => {
  await setupStep3(page);
  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();

  const before = await clipDuration(editor, "body-a");
  await dragHandleCenterBy(page, editor, 120);
  await expect.poll(() => clipDuration(editor, "body-a")).toBeGreaterThan(before + 0.1);
  await page.screenshot({ path: "screenshots/trim-handle-maximized.png" });
});

test("inline card editor: trim handle grabbed at its center resizes the clip", async ({ page }) => {
  await setupStep3(page);
  const canvas = page.getByTestId("step3-variant-canvas");
  await expect(canvas.getByTestId("composition-clip-body-a")).toBeVisible();

  const before = await clipDuration(canvas, "body-a");
  await dragHandleCenterBy(page, canvas, 120);
  await expect.poll(() => clipDuration(canvas, "body-a")).toBeGreaterThan(before + 0.1);
});

test("maximized editor: transition dot still opens its popover", async ({ page }) => {
  await setupStep3(page);
  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();

  await editor.locator('button[aria-label="Edit transition at this boundary"]').first().click();
  await expect(page.getByText("Transition", { exact: true })).toBeVisible();
});

test("maximized editor: dragging a block onto another reorders them", async ({ page }) => {
  await setupStep3(page);
  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();

  const clipA = editor.getByTestId("composition-clip-body-a");
  const clipB = editor.getByTestId("composition-clip-body-b");
  const leftBefore = await clipA.evaluate((el) => (el as HTMLElement).style.left);
  // Insert semantics: the clip lands at the boundary nearest the cursor, so
  // drop past B's midpoint to insert A after B.
  const bBox = (await clipB.boundingBox())!;
  await clipA.dragTo(clipB, { targetPosition: { x: bBox.width * 0.75, y: bBox.height / 2 } });
  await expect.poll(() => clipA.evaluate((el) => (el as HTMLElement).style.left)).not.toBe(leftBefore);
  await page.screenshot({ path: "screenshots/trim-handle-reorder.png" });
});
