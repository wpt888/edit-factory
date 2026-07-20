import { expect, test, type Page } from "@playwright/test";

// Phase C — video clips on upper tracks (PiP / B-roll). Route-mock harness like
// timeline-tracks.spec.ts. Covers: overlay clips render on V2 and NOT in the V1
// sequence; V1 clip dragged to V2 becomes an overlay (track + overlay_box) while
// V1 reflows; an overlay dragged to V1 loses track/overlay_box and joins the
// sequence; same-track overlap is prevented.

const PIPELINE_ID = "overlay-pipeline";
const PROFILE = {
  id: "overlay-profile",
  name: "Overlay QA",
  is_default: true,
  created_at: "2026-07-19T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
  { id: "seg-b", source_video_id: "source-b", start_time: 0, end_time: 10, duration: 10, keywords: ["second"], thumbnail_path: null, transforms: null },
];

// Two magnetic V1 body clips + two free overlays on V2 (one carries a box).
const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 3, end_time: 7, timeline_start: 0, timeline_duration: 2 },
  { id: "body-b", kind: "body", segment_id: "seg-b", segment_keywords: ["body two"], source_video_id: "source-b", start_time: 4, end_time: 8, timeline_start: 2, timeline_duration: 2 },
  { id: "ov-1", kind: "body", track: 2, segment_id: "seg-a", segment_keywords: ["overlay one"], source_video_id: "source-a", start_time: 1, end_time: 2, timeline_start: 0.5, timeline_duration: 1, overlay_box: { x: 0.1, y: 0.2, width: 0.5, height: 0.25, fit: "contain" } },
  { id: "ov-2", kind: "body", track: 2, segment_id: "seg-b", segment_keywords: ["overlay two"], source_video_id: "source-b", start_time: 1, end_time: 2, timeline_start: 3, timeline_duration: 1 },
];

type Clip = { id: string; track?: number; overlay_box?: unknown; timeline_start: number; timeline_duration: number };
type Harness = { compositionPuts: Array<{ video_timeline: Clip[] }> };

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

const openFullEditor = async (page: Page): Promise<{ editor: ReturnType<Page["getByTestId"]>; harness: Harness }> => {
  const harness: Harness = { compositionPuts: [] };

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

    if (path.includes(`/pipeline/${PIPELINE_ID}/composition/`)) {
      if (request.method() === "PUT") {
        harness.compositionPuts.push(request.postDataJSON() as { video_timeline: Clip[] });
      }
      await route.fulfill({ json: {} });
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
        script_names: ["Overlay QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 6, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 6, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Overlay QA",
        idea: "Overlay QA",
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
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/attention-timeline/0`)) {
      await route.fulfill({ json: { revision: 0, cues: [] } });
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
  await expect(editor.getByTestId("composition-clip-body-a")).toBeVisible();
  return { editor, harness };
};

const lastPut = (harness: Harness) => harness.compositionPuts.at(-1)?.video_timeline;

test("a track-2 clip renders as an overlay block on V2, not in the V1 sequence", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  await expect(editor.getByTestId("overlay-clip-ov-1")).toBeVisible();
  await expect(editor.getByTestId("overlay-clip-ov-2")).toBeVisible();
  // The overlay is NOT a V1 clip block.
  await expect(editor.getByTestId("composition-clip-ov-1")).toHaveCount(0);
  await expect(editor.getByTestId("composition-clip-body-a")).toBeVisible();
});

test("dragging a V1 clip onto V2 converts it to an overlay (track + overlay_box), V1 reflows", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const clipA = editor.getByTestId("composition-clip-body-a");
  const v2 = editor.locator('[data-track-index="2"]');
  await expect(v2).toBeVisible();

  const a = (await clipA.boundingBox())!;
  const v2Box = (await v2.boundingBox())!;
  // Drop onto an empty far-right region of the V2 lane.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 15, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(v2Box.x + v2Box.width * 0.9, v2Box.y + v2Box.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect.poll(() => {
    const tl = lastPut(harness);
    const conv = tl?.find((c) => c.id === "body-a");
    return conv?.track === 2 && !!conv.overlay_box;
  }, { timeout: 5000 }).toBe(true);

  const tl = lastPut(harness)!;
  // body-a left the magnetic sequence; remaining magnetic clips reflow from 0.
  const magnetic = tl.filter((c) => (c.track ?? 1) === 1);
  expect(magnetic.some((c) => c.id === "body-a")).toBe(false);
  expect(magnetic[0].timeline_start).toBeCloseTo(0, 2);
});

test("dragging an overlay onto V1 strips track/overlay_box and splices into the sequence", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const ov = editor.getByTestId("overlay-clip-ov-1");
  const v1 = editor.locator('[data-magnetic-lane]');
  await expect(v1).toBeVisible();

  const ovBox = (await ov.boundingBox())!;
  const v1Box = (await v1.boundingBox())!;
  await page.mouse.move(ovBox.x + ovBox.width / 2, ovBox.y + ovBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ovBox.x + ovBox.width / 2, ovBox.y + ovBox.height / 2 + 8, { steps: 3 });
  // Drop over the middle of the V1 lane (a boundary in the magnetic sequence).
  await page.mouse.move(v1Box.x + v1Box.width * 0.5, v1Box.y + v1Box.height / 2, { steps: 15 });
  await page.mouse.up();

  await expect.poll(() => {
    const tl = lastPut(harness);
    const conv = tl?.find((c) => c.id === "ov-1");
    return conv ? conv.track === undefined && conv.overlay_box === undefined : false;
  }, { timeout: 5000 }).toBe(true);

  const tl = lastPut(harness)!;
  expect(tl.filter((c) => (c.track ?? 1) === 1).some((c) => c.id === "ov-1")).toBe(true);
});

test("an overlay cannot be dragged to overlap a same-track sibling", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const ov = editor.getByTestId("overlay-clip-ov-1"); // starts 0.5–1.5 on V2
  const v2 = editor.locator('[data-track-index="2"]');
  const ovBox = (await ov.boundingBox())!;
  const v2Box = (await v2.boundingBox())!;

  // Drag ov-1 far right toward ov-2 (3–4s). It must clamp before 3s so the two
  // never overlap (ov-1 duration 1s → max start 2s).
  await page.mouse.move(ovBox.x + ovBox.width / 2, ovBox.y + ovBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ovBox.x + ovBox.width / 2 + 10, ovBox.y + ovBox.height / 2, { steps: 3 });
  await page.mouse.move(v2Box.x + v2Box.width * 0.95, v2Box.y + v2Box.height / 2, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => harness.compositionPuts.length, { timeout: 5000 }).toBeGreaterThan(0);
  const tl = lastPut(harness)!;
  const moved = tl.find((c) => c.id === "ov-1")!;
  const other = tl.find((c) => c.id === "ov-2")!;
  expect(moved.timeline_start + moved.timeline_duration).toBeLessThanOrEqual(other.timeline_start + 0.05);
});
