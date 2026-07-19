import { expect, test, type Page } from "@playwright/test";

const PIPELINE_ID = "transitions-fade-pipeline";
const PROFILE = {
  id: "transitions-fade-profile",
  name: "Transitions QA",
  is_default: true,
  created_at: "2026-07-17T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
  { id: "seg-c", source_video_id: "source-c", start_time: 0, end_time: 10, duration: 10, keywords: ["third"], thumbnail_path: null, transforms: null },
];

// Boundary INTO body-b carries an explicit cross dissolve; boundary INTO
// body-c is inherited (no variant default) → renders as the small dot.
const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 0, timeline_duration: 2 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2, timeline_duration: 2, transitionIn: { kind: "fade", durationMs: 500 } },
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
        script_names: ["Transitions QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 6, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 6, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Transitions QA",
        idea: "Transitions QA",
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

const BLOCK = 'button[aria-label="Edit or move transition at this boundary"]';
const DOT = 'button[aria-label="Edit transition at this boundary"]';

test("fade transition renders as a Premiere-style block on the boundary", async ({ page }) => {
  const editor = await openFullEditor(page);

  // One block (fade into body-b) + one dot (cut boundary into body-c).
  await expect(editor.locator(BLOCK)).toHaveCount(1);
  await expect(editor.locator(DOT)).toHaveCount(1);
  await expect(editor.locator(BLOCK)).toHaveAttribute("title", /Fade \(dissolve\)/);

  // The popover offers the new Fade kind.
  await editor.locator(BLOCK).click();
  await expect(page.getByRole("combobox").filter({ hasText: "Fade (dissolve)" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.screenshot({ path: "screenshots/transitions-fade-block.png" });
});

test("dragging the transition block moves it to another boundary", async ({ page }) => {
  const editor = await openFullEditor(page);

  const block = editor.locator(BLOCK);
  await expect(block).toHaveCount(1);
  const blockBox = (await block.boundingBox())!;
  // Boundary into body-c sits one clip-width (2s of 6s ≈ a third of the lane)
  // to the right of the block's boundary; the dot marks it exactly.
  const dotBox = (await editor.locator(DOT).boundingBox())!;

  await page.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(dotBox.x + dotBox.width / 2, blockBox.y + blockBox.height / 2, { steps: 8 });
  await page.mouse.up();

  // The transition moved: still exactly one block, now titled at the new
  // boundary, and the origin became an explicit cut override.
  await expect(editor.locator(BLOCK)).toHaveCount(1);
  const movedBox = (await editor.locator(BLOCK).boundingBox())!;
  expect(movedBox.x).toBeGreaterThan(blockBox.x + 50);
  await expect(editor.locator(DOT)).toHaveAttribute("title", "Cut (override)");

  await page.screenshot({ path: "screenshots/transitions-fade-moved.png" });
});
