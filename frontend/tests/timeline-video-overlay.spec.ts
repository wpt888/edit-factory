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

const ATTENTION_TIMELINE = {
  revision: 1,
  cues: [{
    id: "attention-at-second-segment",
    startMs: 2_000,
    durationMs: 2_000,
    track: 2,
    zone: "behind",
    sfxVolumeDb: 0,
    layers: [{
      id: "attention-layer",
      assetId: "https://assets.test/attention.png",
      assetUrl: "https://assets.test/attention.png",
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
      zIndex: 0,
      fit: "contain",
      animation: { preset: "zoom", enterMs: 300, exitMs: 0, delayMs: 0, intensity: 1 },
    }],
  }],
};

const DURATION_INVARIANT_ATTENTION_TIMELINE = {
  revision: 1,
  cues: [
    {
      ...ATTENTION_TIMELINE.cues[0],
      id: "attention-short-slot",
      startMs: 0,
      durationMs: 1_000,
      layers: [{
        ...ATTENTION_TIMELINE.cues[0].layers[0],
        id: "attention-short-layer",
        assetId: "https://assets.test/attention-short.png",
        assetUrl: "https://assets.test/attention-short.png",
      }],
    },
    {
      ...ATTENTION_TIMELINE.cues[0],
      id: "attention-long-slot",
      startMs: 2_000,
      durationMs: 2_000,
      layers: [{
        ...ATTENTION_TIMELINE.cues[0].layers[0],
        id: "attention-long-layer",
        assetId: "https://assets.test/attention-long.png",
        assetUrl: "https://assets.test/attention-long.png",
      }],
    },
  ],
};

type Clip = { id: string; track?: number; overlay_box?: unknown; timeline_start: number; timeline_duration: number };
type AttentionWrite = { cues: Array<{ id: string }> };
type Harness = {
  attentionPuts: AttentionWrite[];
  compositionPuts: Array<{ video_timeline: Clip[] }>;
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

const openFullEditor = async (
  page: Page,
  attentionTimeline: typeof ATTENTION_TIMELINE | { revision: number; cues: [] } = { revision: 0, cues: [] },
): Promise<{ editor: ReturnType<Page["getByTestId"]>; harness: Harness }> => {
  const harness: Harness = { attentionPuts: [], compositionPuts: [] };

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
      if (request.method() === "PUT") {
        harness.attentionPuts.push(request.postDataJSON() as AttentionWrite);
      }
      await route.fulfill({ json: attentionTimeline });
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

test("Delete removes the selected attention block from the pipeline timeline", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page, ATTENTION_TIMELINE);
  const cue = editor.locator('[data-cue-id="attention-at-second-segment"]');
  await cue.focus();
  await page.keyboard.press("Enter");
  await expect(cue).toHaveAttribute("aria-pressed", "true");
  const writesBeforeDelete = harness.attentionPuts.length;

  await page.keyboard.press("Delete");

  await expect(cue).toHaveCount(0);
  await expect.poll(() => harness.attentionPuts.length).toBeGreaterThan(writesBeforeDelete);
  expect(harness.attentionPuts.at(-1)?.cues.map((item) => item.id))
    .not.toContain("attention-at-second-segment");
});

test("Delete removes the selected overlay block from the pipeline timeline", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const overlay = editor.getByTestId("overlay-clip-ov-1");
  await overlay.click();
  const writesBeforeDelete = harness.compositionPuts.length;

  await page.keyboard.press("Delete");

  await expect.poll(() => harness.compositionPuts.length).toBeGreaterThan(writesBeforeDelete);
  expect(lastPut(harness)?.map((clip) => clip.id)).not.toContain("ov-1");
  await expect(overlay).toHaveCount(0);
});

test("Delete removes the selected magnetic video block from the pipeline timeline", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const clip = editor.getByTestId("composition-clip-body-a");
  await clip.click();
  const writesBeforeDelete = harness.compositionPuts.length;

  await page.keyboard.press("Delete");

  await expect.poll(() => harness.compositionPuts.length).toBeGreaterThan(writesBeforeDelete);
  expect(lastPut(harness)?.map((item) => item.id)).not.toContain("body-a");
  await expect(clip).toHaveCount(0);
});

test("a paused segment jump does not play the attention image entrance", async ({ page }) => {
  const { editor } = await openFullEditor(page, ATTENTION_TIMELINE);

  // Activate the media preview, pause it, then perform the same V1 segment
  // click that moves the playhead to the second segment / attention cue.
  await editor.getByRole("button", { name: "Play preview" }).click();
  await expect(editor.getByRole("button", { name: "Pause preview" })).toBeVisible();
  await editor.getByRole("button", { name: "Pause preview" }).click();
  await editor.getByTestId("composition-clip-body-b").click();

  const attentionImage = editor.locator('img[src="https://assets.test/attention.png"]');
  await expect(attentionImage).toBeVisible();
  await expect(attentionImage).toHaveCSS("animation-name", "none");

  const initialTransform = await attentionImage.evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(350);
  await expect.poll(() => attentionImage.evaluate((element) => getComputedStyle(element).transform))
    .toBe(initialTransform);
});

test("an attention entrance has a fixed timeline block and fixed preview duration", async ({ page }) => {
  const { editor } = await openFullEditor(page, DURATION_INVARIANT_ATTENTION_TIMELINE);
  const shortCue = editor.locator('[data-cue-id="attention-short-slot"]');
  const longCue = editor.locator('[data-cue-id="attention-long-slot"]');
  const shortEntrance = editor.getByTestId("attention-entrance-attention-short-slot");
  const longEntrance = editor.getByTestId("attention-entrance-attention-long-slot");

  await expect(shortEntrance).toHaveAttribute("title", /Entrance: Zoom in · 300ms/);
  await expect(longEntrance).toHaveAttribute("title", /Entrance: Zoom in · 300ms/);
  const [shortCueBox, longCueBox, shortEntranceBox, longEntranceBox] = await Promise.all([
    shortCue.boundingBox(),
    longCue.boundingBox(),
    shortEntrance.boundingBox(),
    longEntrance.boundingBox(),
  ]);
  expect(shortCueBox).not.toBeNull();
  expect(longCueBox).not.toBeNull();
  expect(shortEntranceBox).not.toBeNull();
  expect(longEntranceBox).not.toBeNull();
  expect(shortEntranceBox!.width / shortCueBox!.width).toBeCloseTo(300 / 1_000, 1);
  expect(longEntranceBox!.width / longCueBox!.width).toBeCloseTo(300 / 2_000, 1);

  await editor.getByRole("button", { name: "Play preview" }).click();
  const shortImage = editor.locator('img[src="https://assets.test/attention-short.png"]');
  await expect(shortImage).toBeVisible();
  await expect(shortImage).toHaveCSS("animation-duration", "0.3s");

  await editor.getByRole("button", { name: "Pause preview" }).click();
  await editor.getByTestId("composition-clip-body-b").click();
  await editor.getByRole("button", { name: "Play preview" }).click();
  const longImage = editor.locator('img[src="https://assets.test/attention-long.png"]');
  await expect(longImage).toBeVisible();
  await expect(longImage).toHaveCSS("animation-duration", "0.3s");

  await expect(longCue).toHaveScreenshot("attention-entrance-block.png", {
    animations: "disabled",
  });
});

test("an overlay trim edge snaps to a media boundary on another video track", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const overlay = editor.getByTestId("overlay-clip-ov-1");
  const endHandle = overlay.getByTestId("overlay-end-handle-ov-1");
  const v1 = editor.locator('[data-magnetic-lane]');
  const [handleBox, v1Box] = await Promise.all([endHandle.boundingBox(), v1.boundingBox()]);
  expect(handleBox).not.toBeNull();
  expect(v1Box).not.toBeNull();

  // V1 has a cut at 2s on a 6s ruler. Move just past it: the 10px magnet
  // should pull the overlay edge back to the exact shared boundary.
  const boundaryX = v1Box!.x + v1Box!.width / 3;
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boundaryX + 3, handleBox!.y + handleBox!.height / 2, { steps: 8 });
  await expect(editor.locator("[data-timeline-snap-guide]")).toBeVisible();
  await page.mouse.up();
  await expect(editor.locator("[data-timeline-snap-guide]")).toHaveCount(0);

  await expect.poll(() => {
    const saved = lastPut(harness)?.find(clip => clip.id === "ov-1");
    return saved ? saved.timeline_start + saved.timeline_duration : Number.NaN;
  }).toBeCloseTo(2, 3);
});

test("moving an overlay snaps either clip edge and shows the shared alignment guide", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const overlay = editor.getByTestId("overlay-clip-ov-1"); // 0.5–1.5s
  const v2 = editor.locator('[data-track-index="2"]');
  const [overlayBox, laneBox] = await Promise.all([overlay.boundingBox(), v2.boundingBox()]);
  expect(overlayBox).not.toBeNull();
  expect(laneBox).not.toBeNull();

  // Shift by ~0.5s so the trailing edge approaches the V1 cut at 2s. The
  // leading edge is not near that cut, proving whole-range snapping considers
  // both sides of the moving clip.
  const halfSecondPx = laneBox!.width * (0.5 / 6);
  const pointerX = overlayBox!.x + overlayBox!.width / 2;
  const pointerY = overlayBox!.y + overlayBox!.height / 2;
  await page.mouse.move(pointerX, pointerY);
  await page.mouse.down();
  await page.mouse.move(pointerX + halfSecondPx + 3, pointerY, { steps: 8 });

  const guide = editor.locator("[data-timeline-snap-guide]");
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute("data-timeline-snap-time", "2");
  await page.mouse.up();
  await expect(guide).toHaveCount(0);

  await expect.poll(() => {
    const saved = lastPut(harness)?.find(clip => clip.id === "ov-1");
    return saved ? saved.timeline_start + saved.timeline_duration : Number.NaN;
  }).toBeCloseTo(2, 3);
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
  const dragPreview = editor.getByTestId("composition-drag-preview");
  await expect(dragPreview).toBeVisible();
  await expect(dragPreview).toHaveAttribute("data-drag-target-track", "2");
  await page.mouse.up();

  await expect.poll(() => {
    const tl = lastPut(harness);
    const conv = tl?.find((c) => c.id === "body-a");
    return conv?.track === 2 && !!conv.overlay_box;
  }, { timeout: 5000 }).toBe(true);

  const tl = lastPut(harness)!;
  // body-a left the magnetic sequence; remaining magnetic clips reflow from 0.
  const magnetic = tl.filter((c) => (c.track ?? 1) === 1);
  const converted = tl.find((c) => c.id === "body-a")!;
  expect(magnetic.some((c) => c.id === "body-a")).toBe(false);
  expect(magnetic[0].timeline_start).toBeCloseTo(0, 2);
  // The drop X is persisted instead of retaining the clip's old V1 start (0s).
  expect(converted.timeline_start).toBeGreaterThan(1.5);
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
  await expect(editor.getByTestId("composition-drag-preview")).toHaveAttribute("data-drag-target-track", "1");
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

test("a video clip cannot be dropped onto an audio track", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const clip = editor.getByTestId("composition-clip-body-a");
  const audioTrack = editor.locator('[data-track-kind="audio"]').first();
  const clipBox = (await clip.boundingBox())!;
  const audioBox = (await audioTrack.boundingBox())!;
  const writesBefore = harness.compositionPuts.length;

  await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(clipBox.x + clipBox.width / 2 + 12, clipBox.y + clipBox.height / 2, { steps: 3 });
  await page.mouse.move(audioBox.x + audioBox.width * 0.75, audioBox.y + audioBox.height / 2, { steps: 12 });
  await expect(editor.getByTestId("composition-drag-preview")).toHaveCount(0);
  await page.mouse.up();

  expect(harness.compositionPuts).toHaveLength(writesBefore);
  await expect(editor.getByTestId("composition-clip-body-a")).toBeVisible();
  await expect(editor.getByTestId("overlay-clip-body-a")).toHaveCount(0);
});
