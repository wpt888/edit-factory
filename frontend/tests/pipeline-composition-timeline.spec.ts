import { expect, test } from "@playwright/test";

const PIPELINE_ID = "timeline-composition-pipeline";
const PROFILE = {
  id: "timeline-composition-profile",
  name: "Composition QA",
  is_default: true,
  created_at: "2026-07-17T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
];

const COMPOSITION = [
  { id: "intro-a", kind: "intro", segment_id: "seg-a", segment_keywords: ["first"], source_video_id: "source-a", start_time: 1, end_time: 1.5, timeline_start: 0, timeline_duration: 0.5 },
  { id: "intro-b", kind: "intro", segment_id: "seg-b", segment_keywords: ["second"], source_video_id: "source-b", start_time: 2, end_time: 2.5, timeline_start: 0.5, timeline_duration: 0.5 },
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 1, timeline_duration: 1.5 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2.5, timeline_duration: 1.5 },
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

test("maximized editor exposes gapless movable and roll-trimmable composition clips", async ({ page }) => {
  page.on("pageerror", (error) => console.error(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  const compositionWrites: Array<{ video_timeline: typeof COMPOSITION }> = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith(`/pipeline/${PIPELINE_ID}/composition/0`) && request.method() === "PUT") {
      compositionWrites.push(JSON.parse(request.postData() || "{}"));
      await route.fulfill({ json: { status: "saved", clip_count: 4, duration: 4 } });
      return;
    }
    if (path.endsWith(`/pipeline/audio/${PIPELINE_ID}/0`)) {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: makeSilentWav() });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["One two three four"],
        script_names: ["Timeline composition"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 4, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 4, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Timeline composition",
        idea: "Timeline QA",
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
            intro_offset_sec: 1,
            intro_segments: COMPOSITION.slice(0, 2),
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

  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);

  // Maximizing is a workspace layout mode, not an app-wide modal: controls
  // outside the editor must remain interactive and must not dismiss it.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(editor).toBeVisible();

  const clipLocators = COMPOSITION.map((clip) => editor.getByTestId(`composition-clip-${clip.id}`));
  for (const clip of clipLocators) await expect(clip).toBeVisible();

  const geometry = await Promise.all(clipLocators.map((clip) => clip.evaluate((element) => {
    const node = element as HTMLElement;
    return { left: parseFloat(node.style.left), width: parseFloat(node.style.width) };
  })));
  for (let index = 0; index < geometry.length - 1; index += 1) {
    expect(geometry[index].left + geometry[index].width).toBeCloseTo(geometry[index + 1].left, 3);
  }
  await expect(editor.getByText("0:04", { exact: true }).first()).toBeVisible();

  const zoomOut = editor.getByRole("button", { name: "Zoom timeline out" });
  for (let count = 0; count < 4; count += 1) await zoomOut.click();
  await expect(editor.getByRole("button", { name: "Fit the full timeline" })).toHaveText("0.50x");
  await expect(zoomOut).toBeDisabled();

  await editor.getByTestId("composition-clip-intro-a").click();
  const inspector = editor.getByTestId("composition-clip-inspector");
  await inspector.getByRole("button", { name: "Move later" }).click();
  await expect.poll(() => compositionWrites.length).toBeGreaterThanOrEqual(1);
  expect(compositionWrites.at(-1)?.video_timeline.slice(0, 2).map((clip) => clip.id)).toEqual(["intro-b", "intro-a"]);

  await editor.getByTestId("composition-clip-body-a").click();
  const rightEdgeRow = inspector.getByText("Right edge", { exact: true }).locator("..");
  await rightEdgeRow.getByRole("button", { name: "+0.1" }).click();
  await expect.poll(() => compositionWrites.length).toBeGreaterThanOrEqual(2);
  const finalTimeline = compositionWrites.at(-1)!.video_timeline;
  const bodyA = finalTimeline.find((clip) => clip.id === "body-a")!;
  const bodyB = finalTimeline.find((clip) => clip.id === "body-b")!;
  expect(bodyA.timeline_duration).toBeCloseTo(1.6, 5);
  expect(bodyB.timeline_duration).toBeCloseTo(1.4, 5);
  for (let index = 1; index < finalTimeline.length; index += 1) {
    expect(finalTimeline[index].timeline_start).toBeCloseTo(
      finalTimeline[index - 1].timeline_start + finalTimeline[index - 1].timeline_duration,
      5,
    );
  }

  const previewPosition = editor.getByRole("slider", { name: "Preview position" });
  await editor.getByTitle("Play", { exact: true }).click();
  await expect(previewPosition).toBeEnabled();
  await expect(editor.getByTitle("Pause", { exact: true })).toBeVisible({ timeout: 5_000 });
  await previewPosition.click();
  await expect(previewPosition).toBeFocused();

  const scrollBeforeSpace = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("Space");
  await expect(editor.getByTitle("Play", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeSpace);

  await page.keyboard.press("Space");
  await expect(editor.getByTitle("Pause", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(editor.getByTitle("Play", { exact: true })).toBeVisible();
});
