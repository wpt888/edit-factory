import { expect, test, type Page } from "@playwright/test";

const PIPELINE_ID = "clip-drag-pipeline";
const PROFILE = {
  id: "clip-drag-profile",
  name: "Drag QA",
  is_default: true,
  created_at: "2026-07-17T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
  { id: "seg-c", source_video_id: "source-c", start_time: 0, end_time: 10, duration: 10, keywords: ["third"], thumbnail_path: null, transforms: null },
];

const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 0, timeline_duration: 2 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2, timeline_duration: 2 },
  { id: "body-c", kind: "body", segment_id: "seg-c", segment_keywords: ["body three"], source_video_id: "source-c", start_time: 1, end_time: 5, timeline_start: 4, timeline_duration: 2 },
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

const openFullEditor = async (page: Page) => {
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
        scripts: ["One two three four five six"],
        script_names: ["Drag QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 6, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 6, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Drag QA",
        idea: "Drag QA",
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
            audio_duration: 6,
            srt_content: "1\n00:00:00,000 --> 00:00:02,000\nOne two\n\n2\n00:00:02,000 --> 00:00:04,000\nThree four\n\n3\n00:00:04,000 --> 00:00:06,000\nFive six",
            matches: [
              { srt_index: 0, srt_text: "One two", srt_start: 0, srt_end: 2, segment_id: "seg-a", segment_keywords: ["first"], matched_keyword: "first", confidence: 1, source_video_id: "source-a", segment_start_time: 0, segment_end_time: 4, merge_group: 0, merge_group_duration: 2 },
              { srt_index: 1, srt_text: "Three four", srt_start: 2, srt_end: 4, segment_id: "seg-b", segment_keywords: ["second"], matched_keyword: "second", confidence: 1, source_video_id: "source-b", segment_start_time: 0, segment_end_time: 4, merge_group: 1, merge_group_duration: 2 },
              { srt_index: 2, srt_text: "Five six", srt_start: 4, srt_end: 6, segment_id: "seg-c", segment_keywords: ["third"], matched_keyword: "third", confidence: 1, source_video_id: "source-c", segment_start_time: 0, segment_end_time: 4, merge_group: 2, merge_group_duration: 2 },
            ],
            total_phrases: 3,
            matched_count: 3,
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
      await route.fulfill({ json: { source_video_ids: ["source-a", "source-b", "source-c"] } });
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
        { id: "source-c", name: "Source C", duration: 10, segments_count: 1, status: "ready" },
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
      await route.fulfill({ json: { total_segment_duration: 30 } });
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
  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();
  return editor;
};

test("dragging a clip while the preview is active still reorders", async ({ page }) => {
  const editor = await openFullEditor(page);
  const clipA = editor.getByTestId("composition-clip-body-a");
  const clipC = editor.getByTestId("composition-clip-body-c");
  await expect(clipA).toBeVisible();

  // Activate the inline preview (Space on the focused timeline surface).
  const axis = editor.locator("[data-timeline-axis]").first();
  await axis.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(" ");
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    (window as any).__dragEvents = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"]) {
      document.addEventListener(type, () => (window as any).__dragEvents.push(type), true);
    }
  });

  const a = (await clipA.boundingBox())!;
  const c = (await clipC.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 15, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(c.x + c.width * 0.75, c.y + c.height / 2, { steps: 15 });
  await page.mouse.up();

  console.log("PREVIEW-ACTIVE DRAG EVENTS:", await page.evaluate(() => (window as any).__dragEvents));
  const aBoxAfter = (await editor.getByTestId("composition-clip-body-a").boundingBox())!;
  const cBoxAfter = (await editor.getByTestId("composition-clip-body-c").boundingBox())!;
  console.log("A after:", aBoxAfter.x, "C after:", cBoxAfter.x);
  await page.screenshot({ path: "screenshots/clip-drag-preview-active.png" });
  expect(aBoxAfter.x).toBeGreaterThan(cBoxAfter.x);
});

test("dragging a video clip onto another reorders the composition", async ({ page }) => {
  const editor = await openFullEditor(page);

  const clipA = editor.getByTestId("composition-clip-body-a");
  const clipC = editor.getByTestId("composition-clip-body-c");
  await expect(clipA).toBeVisible();
  await expect(clipC).toBeVisible();

  // Instrument: does dragstart even fire?
  await page.evaluate(() => {
    (window as any).__dragEvents = [];
    for (const type of ["dragstart", "dragover", "drop", "dragend"]) {
      document.addEventListener(type, () => (window as any).__dragEvents.push(type), true);
    }
  });

  const a = (await clipA.boundingBox())!;
  const c = (await clipC.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 15, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(c.x + c.width * 0.75, c.y + c.height / 2, { steps: 15 });

  // Premiere-style insertion indicator is visible mid-drag.
  await expect(editor.getByTestId("composition-drop-indicator")).toBeVisible();
  await page.screenshot({ path: "screenshots/clip-drag-indicator.png" });
  await page.mouse.up();

  const events = await page.evaluate(() => (window as any).__dragEvents);
  console.log("DRAG EVENTS:", events);

  await page.screenshot({ path: "screenshots/clip-drag-after.png" });

  // After moving A onto C, A should now start at 4s (last position).
  const aBoxAfter = (await editor.getByTestId("composition-clip-body-a").boundingBox())!;
  const cBoxAfter = (await editor.getByTestId("composition-clip-body-c").boundingBox())!;
  console.log("A after:", aBoxAfter.x, "C after:", cBoxAfter.x);
  expect(aBoxAfter.x).toBeGreaterThan(cBoxAfter.x);
});
