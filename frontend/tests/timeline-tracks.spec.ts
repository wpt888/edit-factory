import { expect, test, type Page } from "@playwright/test";

// Phase A multi-track timeline: generic V/A tracks, add-track, cross-track cue
// drag (persists a `track` field), and left-edge trim. Route-mock harness only.

const PIPELINE_ID = "tracks-pipeline";
const PROFILE = {
  id: "tracks-profile",
  name: "Tracks QA",
  is_default: true,
  created_at: "2026-07-19T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
];

const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 0, timeline_duration: 2 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2, timeline_duration: 2 },
];

// One attention cue on V2 (track 2) so the image lane has something to drag.
const ATTENTION = {
  revision: 0,
  cues: [
    {
      id: "cue-a",
      startMs: 500,
      durationMs: 1500,
      sfxVolumeDb: 0,
      zone: "behind",
      track: 2,
      layers: [
        {
          id: "layer-a",
          assetId: "https://example.com/a.png",
          assetUrl: "https://example.com/a.png",
          x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 1, fit: "contain",
          animation: { preset: "static", enterMs: 250, exitMs: 200, delayMs: 0, intensity: 1 },
        },
      ],
    },
  ],
};

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

type Harness = { attentionPuts: Array<Record<string, unknown>> };

const openFullEditor = async (
  page: Page,
  { maximize = true }: { maximize?: boolean } = {},
): Promise<{ editor: ReturnType<Page["getByTestId"]>; harness: Harness }> => {
  const harness: Harness = { attentionPuts: [] };

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

    if (path.endsWith(`/pipeline/${PIPELINE_ID}/attention-timeline/0`)) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as Record<string, unknown>;
        harness.attentionPuts.push(body);
        await route.fulfill({ json: body });
      } else {
        await route.fulfill({ json: ATTENTION });
      }
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
        script_names: ["Tracks QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 4, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 4, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Tracks QA",
        idea: "Tracks QA",
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
  if (!maximize) {
    const canvas = page.getByTestId("step3-variant-canvas");
    await expect(canvas.locator('[data-cue-id="cue-a"]')).toBeVisible();
    return { editor: canvas, harness };
  }
  await page.locator('button[title^="Maximize editor"]').first().click();
  const editor = page.getByTestId("step3-full-editor");
  await expect(editor).toBeVisible();
  // The cue on V2 confirms the attention timeline loaded.
  await expect(editor.locator('[data-cue-id="cue-a"]')).toBeVisible();
  return { editor, harness };
};

// Lane label gutter spans use .truncate; clip "V1"/"Intro" chips do not, so an
// exact match on a .truncate span uniquely targets the lane label.
const laneLabels = async (editor: ReturnType<Page["getByTestId"]>) =>
  (await editor.locator("span.truncate").allInnerTexts()).map((t) => t.trim());

test("lanes stack V2 above V1 above A1 Voiceover", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const labels = await laneLabels(editor);
  expect(labels.indexOf("V2")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("V2")).toBeLessThan(labels.indexOf("V1"));
  expect(labels.indexOf("V1")).toBeLessThan(labels.indexOf("A1 Voiceover"));
  await page.screenshot({ path: "screenshots/timeline-tracks-order.png" });
});

test("Add video track adds a V3 lane", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  await expect(editor.locator("span.truncate", { hasText: /^V3$/ })).toHaveCount(0);
  await editor.getByRole("button", { name: "Add video track" }).click();
  await expect(editor.locator("span.truncate", { hasText: /^V3$/ })).toBeVisible();
  await page.screenshot({ path: "screenshots/timeline-tracks-maximized-v3.png" });
});

test("dragging a cue from V2 to V3 persists track: 3", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  await editor.getByRole("button", { name: "Add video track" }).click();

  const v3 = editor.locator('[data-track-index="3"]');
  await expect(v3).toBeVisible();
  const cue = editor.locator('[data-cue-id="cue-a"]');
  const cueBox = (await cue.boundingBox())!;
  const v3Box = (await v3.boundingBox())!;

  await page.mouse.move(cueBox.x + cueBox.width / 2, cueBox.y + cueBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(v3Box.x + v3Box.width / 2, v3Box.y + v3Box.height / 2, { steps: 12 });
  await page.mouse.up();

  // The attention PUT is debounced (~800ms upstream).
  await expect
    .poll(() => {
      const last = harness.attentionPuts.at(-1) as { cues?: Array<{ track?: number }> } | undefined;
      return last?.cues?.[0]?.track;
    }, { timeout: 5000 })
    .toBe(3);
});

test("card mode renders the generic lanes with a scrollable, sticky-ruler timeline", async ({ page }) => {
  const { editor } = await openFullEditor(page, { maximize: false });
  const labels = await laneLabels(editor);
  expect(labels.indexOf("V2")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("V2")).toBeLessThan(labels.indexOf("V1"));
  await page.screenshot({ path: "screenshots/timeline-tracks-card.png", fullPage: false });
});

test("left-edge trim moves the cue start later", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const cue = editor.locator('[data-cue-id="cue-a"]');
  const leftBefore = await cue.evaluate((el) => (el as HTMLElement).style.left);

  const handle = cue.locator("span.cursor-ew-resize").first();
  const box = (await handle.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(() => cue.evaluate((el) => parseFloat((el as HTMLElement).style.left)))
    .toBeGreaterThan(parseFloat(leftBefore));
});
