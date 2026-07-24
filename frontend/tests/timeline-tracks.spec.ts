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
      startMs: 0,
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

const OVERLAPPING_ATTENTION = {
  ...ATTENTION,
  cues: [
    ATTENTION.cues[0],
    {
      ...ATTENTION.cues[0],
      id: "cue-b",
      track: 3,
      layers: [
        {
          ...ATTENTION.cues[0].layers[0],
          id: "layer-b",
          assetId: "https://example.com/b.png",
          assetUrl: "https://example.com/b.png",
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

type Harness = {
  attentionPuts: Array<Record<string, unknown>>;
  matchesPuts: Array<Record<string, unknown>>;
};

const openFullEditor = async (
  page: Page,
  {
    maximize = true,
    attention = ATTENTION,
    composition = COMPOSITION,
  }: {
    maximize?: boolean;
    attention?: typeof ATTENTION;
    composition?: typeof COMPOSITION;
  } = {},
): Promise<{ editor: ReturnType<Page["getByTestId"]>; harness: Harness }> => {
  const harness: Harness = { attentionPuts: [], matchesPuts: [] };

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
        await route.fulfill({ json: attention });
      }
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/matches/0`) && request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      harness.matchesPuts.push(body);
      await route.fulfill({ json: body });
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
            video_timeline: composition,
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

test("maximized program monitor fits the workspace at a 9:16 aspect ratio", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const frame = editor.getByTestId("full-preview-frame");
  await expect(frame).toBeVisible();

  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(frameBox!.width / frameBox!.height).toBeCloseTo(9 / 16, 2);
  expect(frameBox!.width).toBeLessThan(frameBox!.height);
});

test("clicking a program subtitle opens text editing and persists the changed copy", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const subtitle = editor.getByTestId("preview-subtitle");
  await expect(subtitle).toContainText("One two");

  await subtitle.click();
  const textEditor = editor.getByTestId("subtitle-text-editor");
  const textarea = textEditor.getByLabel("Subtitle text");
  await expect(textarea).toHaveValue("One two");
  await textarea.fill("One two — edited on canvas");

  await expect(subtitle).toContainText("One two — edited on canvas");
  await expect.poll(() => {
    const last = harness.matchesPuts.at(-1) as { matches?: Array<{ srt_text?: string }> } | undefined;
    return last?.matches?.[0]?.srt_text;
  }, { timeout: 5000 }).toBe("One two — edited on canvas");
});

test("an attention image can be selected, moved, and resized in the program monitor", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  const layer = editor.getByTestId("attention-preview-cue-a-layer-a");
  await expect(layer).toBeVisible();

  const before = (await layer.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 20, before.y + before.height / 2 + 24, { steps: 6 });
  await page.mouse.up();

  await expect(layer).toHaveAttribute("aria-pressed", "true");
  const selectedTimelineCue = editor.locator('[data-cue-id="cue-a"]');
  await expect(selectedTimelineCue).toHaveAttribute("aria-pressed", "true");
  await expect(selectedTimelineCue).toHaveClass(/ring-2/);
  const resize = editor.getByTestId("attention-resize-cue-a-layer-a");
  await expect(resize).toBeVisible();
  await expect(editor.getByTestId("attention-layer-0")).toHaveClass(/border-primary/);

  const handle = (await resize.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 24, handle.y + handle.height / 2 - 48, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => {
    const last = harness.attentionPuts.at(-1) as {
      cues?: Array<{ layers?: Array<{ x?: number; y?: number; width?: number; height?: number }> }>;
    } | undefined;
    return last?.cues?.[0]?.layers?.[0];
  }, { timeout: 5000 }).toMatchObject({
    x: expect.any(Number),
    y: expect.any(Number),
    width: expect.any(Number),
    height: expect.any(Number),
  });

  const saved = (harness.attentionPuts.at(-1) as {
    cues: Array<{ layers: Array<{ x: number; y: number; width: number; height: number }> }>;
  }).cues[0].layers[0];
  expect(saved.x).toBeGreaterThan(0.1);
  expect(saved.y).toBeGreaterThan(0.1);
  expect(saved.width).toBeLessThan(0.8);
  expect(saved.height).toBeLessThan(0.8);
});

test("timeline selection owns canvas interaction when attention images overlap", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page, { attention: OVERLAPPING_ATTENTION });
  const selectedLayer = editor.getByTestId("attention-preview-cue-a-layer-a");
  const coveringLayer = editor.getByTestId("attention-preview-cue-b-layer-b");
  await expect(selectedLayer).toBeVisible();
  await expect(coveringLayer).toBeVisible();

  await editor.locator('[data-cue-id="cue-a"]').click();
  await expect(selectedLayer).toHaveAttribute("aria-pressed", "true");
  await expect(coveringLayer).toHaveCSS("pointer-events", "none");

  const before = (await selectedLayer.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 24, before.y + before.height / 2 + 20, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => {
    const last = harness.attentionPuts.at(-1) as {
      cues?: Array<{ id: string; layers: Array<{ x: number; y: number }> }>;
    } | undefined;
    return last?.cues?.map((cue) => ({
      id: cue.id,
      x: cue.layers[0].x,
      y: cue.layers[0].y,
    }));
  }, { timeout: 5000 }).toEqual([
    { id: "cue-a", x: expect.any(Number), y: expect.any(Number) },
    { id: "cue-b", x: 0.1, y: 0.1 },
  ]);

  const saved = (harness.attentionPuts.at(-1) as {
    cues: Array<{ id: string; layers: Array<{ x: number; y: number }> }>;
  }).cues;
  expect(saved[0].layers[0].x).toBeGreaterThan(0.1);
  expect(saved[0].layers[0].y).toBeGreaterThan(0.1);
});

test("selecting an attention block exposes per-image effects inside a compact variant card", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page, { maximize: false });

  await editor.locator('[data-cue-id="cue-a"]').click();

  const layer = editor.getByTestId("attention-layer-0");
  await expect(layer).toBeVisible();
  const transition = editor.getByTestId("attention-layer-a-effect-select");
  await transition.click();
  await page.getByRole("option", { name: /Fade/ }).click();
  await editor.getByTestId("attention-layer-a-enter-duration").fill("0.55");

  await expect.poll(() => {
    const last = harness.attentionPuts.at(-1) as {
      cues?: Array<{ layers?: Array<{ animation?: { preset?: string; enterMs?: number } }> }>;
    } | undefined;
    return last?.cues?.[0]?.layers?.[0]?.animation;
  }, { timeout: 5000 }).toMatchObject({ preset: "fade", enterMs: 550 });
});

test("an attention image transition can be changed per layer", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  await editor.getByTestId("attention-preview-cue-a-layer-a").click();

  const transition = editor.getByTestId("attention-layer-a-effect-select");
  await expect(transition).toContainText("Static / Classic");
  await transition.click();
  await page.getByRole("option", { name: /Wipe from right/ }).click();

  await expect(transition).toContainText("Wipe from right");
  await expect.poll(() => {
    const last = harness.attentionPuts.at(-1) as {
      cues?: Array<{ layers?: Array<{ animation?: { preset?: string } }> }>;
    } | undefined;
    return last?.cues?.[0]?.layers?.[0]?.animation?.preset;
  }, { timeout: 5000 }).toBe("wipe-right");

  await expect(editor.getByTestId("attention-layer-0")).toHaveScreenshot(
    "attention-image-effect-controls.png",
    { animations: "disabled" },
  );
});

test("maximized editor stays above the sticky Variant Previews header", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const header = page.getByTestId("step3-variant-header");

  await expect(header).toBeVisible();
  expect(await header.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    const fullEditor = document.querySelector<HTMLElement>('[data-testid="step3-full-editor"]');
    return Boolean(fullEditor && topmost && (topmost === fullEditor || fullEditor.contains(topmost)));
  })).toBe(true);

  await expect(editor).toBeVisible();
});

test("lanes use unified V/A ids and stack V3 above V2 above V1 above A1", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const labels = await laneLabels(editor);
  expect(labels.indexOf("V3")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("V3")).toBeLessThan(labels.indexOf("V2"));
  expect(labels.indexOf("V2")).toBeGreaterThanOrEqual(0);
  expect(labels.indexOf("V2")).toBeLessThan(labels.indexOf("V1"));
  expect(labels.indexOf("V1")).toBeLessThan(labels.indexOf("A1"));
  expect(labels).not.toContain("Subtitles");
  expect(labels).not.toContain("A1 Voiceover");
  await page.screenshot({ path: "screenshots/timeline-tracks-order.png" });
});

test("subtitle lane stays compact and audio tracks share one visual surface", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const timeline = editor.locator('[aria-label="Multi-track timeline"]');
  const captionBlocks = timeline.locator('[data-caption-density]');
  const firstCaption = captionBlocks.first();

  await expect(captionBlocks).toHaveCount(2);
  await expect(firstCaption.locator("span")).toHaveCSS("white-space", "nowrap");
  expect((await firstCaption.boundingBox())?.height).toBeLessThanOrEqual(27);

  const audioSurface = timeline.locator('[data-timeline-audio-surface]').first();
  await expect(audioSurface).toBeVisible();
  await expect(audioSurface).toHaveCSS("overflow", "hidden");
  const waveform = audioSurface.locator("canvas");
  await expect(waveform).toBeVisible();
  const initialCanvasWidth = await waveform.evaluate((canvas: HTMLCanvasElement) => canvas.width);

  for (let step = 0; step < 4; step += 1) {
    await timeline.getByRole("button", { name: "Zoom timeline in" }).click();
  }
  await expect.poll(
    () => waveform.evaluate((canvas: HTMLCanvasElement) => canvas.width),
  ).toBeGreaterThan(initialCanvasWidth);

  await expect(timeline).toHaveScreenshot("timeline-compact-subtitles-audio.png", {
    animations: "disabled",
  });
});

test("timeline zoom keeps the placed playhead fixed in the viewport", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const timeline = editor.locator('[aria-label="Multi-track timeline"]');
  const ruler = timeline.locator("[data-timeline-ruler]");
  const rulerBox = await ruler.boundingBox();
  if (!rulerBox) throw new Error("Timeline ruler is missing");

  await page.mouse.click(
    rulerBox.x + rulerBox.width * 0.68,
    rulerBox.y + rulerBox.height / 2,
  );

  const playhead = timeline.locator("[data-timeline-lane-playhead]");
  await expect(playhead).toBeVisible();
  const before = await playhead.boundingBox();
  if (!before) throw new Error("Timeline playhead is missing");

  await timeline.getByRole("button", { name: "Zoom timeline in" }).click();
  await expect.poll(async () => (await playhead.boundingBox())?.x ?? -1).toBeCloseTo(before.x, 0);
});

test("Add video track inserts V3 and renumbers subtitles to V4", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  await expect(editor.locator('[data-track-index="3"]')).toHaveCount(0);
  await editor.getByRole("button", { name: "Open V2 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add video track" }).click();
  await expect(editor.locator('[data-track-index="3"]')).toBeVisible();
  await expect(editor.locator("span.truncate", { hasText: /^V4$/ })).toBeVisible();
  await page.screenshot({ path: "screenshots/timeline-tracks-maximized-v3.png" });
});

test("an empty added video track can be deleted without deleting media", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  await editor.getByRole("button", { name: "Open V2 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add video track" }).click();
  await expect(editor.locator('[data-track-index="3"]')).toBeVisible();
  await editor.getByRole("button", { name: "Open V3 track settings" }).click();
  await page.getByRole("menuitem", { name: "Delete video track V3" }).click();
  await expect(editor.locator('[data-track-index="3"]')).toHaveCount(0);
  await expect(editor.locator("span.truncate", { hasText: /^V3$/ })).toBeVisible();
});

test("audio track settings add and delete tracks without duplicating the mute control", async ({ page }) => {
  const { editor } = await openFullEditor(page, { maximize: false });

  await editor.getByRole("button", { name: "Open A1 track settings" }).click();
  await expect(page.getByRole("menuitem", { name: "Mute audio track" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Add audio track" }).click();

  await expect(editor.locator("span.truncate", { hasText: /^A3$/ })).toBeVisible();
  await editor.getByRole("button", { name: "Open A3 track settings" }).click();
  await page.getByRole("menuitem", { name: "Delete audio track A3" }).click();
  await expect(editor.locator("span.truncate", { hasText: /^A3$/ })).toHaveCount(0);
});

test("track headers expose Premiere-style monitor, add, settings, and resize controls", async ({ page }) => {
  const { editor } = await openFullEditor(page);

  await expect(editor.getByRole("button", { name: "Lock video track V1" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Lock audio track A1" })).toBeVisible();
  const hideV1 = editor.getByRole("button", { name: "Hide video track V1" });
  const muteA1 = editor.getByRole("button", { name: "Mute audio track A1" });
  await expect(hideV1).toBeVisible();
  await expect(muteA1).toBeVisible();
  await expect(editor.getByRole("button", { name: "Add media to V2" })).toBeEnabled();
  await expect(editor.getByRole("button", { name: "Add media to V1" })).toBeEnabled();
  await expect(editor.getByRole("button", { name: "Open V2 track settings" })).toBeVisible();

  await hideV1.click();
  await expect(editor.getByRole("button", { name: "Show video track V1" })).toHaveAttribute("aria-pressed", "true");
  await muteA1.click();
  await expect(editor.getByRole("button", { name: "Unmute audio track A1" })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator("audio")).toHaveJSProperty("muted", true);

  const v1Resize = editor.getByRole("separator", { name: "Resize V1 track height" });
  const v2Resize = editor.getByRole("separator", { name: "Resize V2 track height" });
  const a1Resize = editor.getByRole("separator", { name: "Resize A1 track height" });
  const a2Resize = editor.getByRole("separator", { name: "Resize A2 track height" });
  await expect(v1Resize).toHaveAttribute("aria-valuenow", "48");
  await expect(v2Resize).toHaveAttribute("aria-valuenow", "48");
  await expect(a1Resize).toHaveAttribute("aria-valuenow", "44");
  await expect(a2Resize).toHaveAttribute("aria-valuenow", "44");

  const handle = await v1Resize.boundingBox();
  if (!handle) throw new Error("V1 resize handle is missing");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 24, { steps: 4 });
  await page.mouse.up();
  await expect(v1Resize).toHaveAttribute("aria-valuenow", "72");
});

test("locking a track prevents accidental edits while keeping visibility available", async ({ page }) => {
  const { editor } = await openFullEditor(page, { maximize: false });

  const lockV2 = editor.getByRole("button", { name: "Lock video track V2" });
  await lockV2.click();

  await expect(editor.getByRole("button", { name: "Unlock video track V2" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator('[data-track-index="2"]')).toHaveAttribute("data-track-locked", "true");
  await expect(editor.getByRole("button", { name: "Add media to V2" })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Open V2 track settings" })).toBeDisabled();
  await expect(editor.getByRole("separator", { name: "Resize V2 track height" })).toHaveCount(0);

  const hideV2 = editor.getByRole("button", { name: "Hide video track V2" });
  await expect(hideV2).toBeEnabled();
  await hideV2.click();
  await expect(editor.getByRole("button", { name: "Show video track V2" })).toBeVisible();
});

test("dragging a cue from V2 to V3 persists track: 3", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);
  await editor.getByRole("button", { name: "Open V2 track settings" }).click();
  await page.getByRole("menuitem", { name: "Add video track" }).click();

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

test("the pipeline ruler exposes fine sub-second increments", async ({ page }) => {
  const { editor } = await openFullEditor(page);
  const ruler = editor.locator("[data-timeline-ruler]");
  await expect(ruler).toBeVisible();

  const minorStep = Number(await ruler.getAttribute("data-timeline-ruler-minor-step"));
  expect(minorStep).toBeGreaterThan(0);
  expect(minorStep).toBeLessThanOrEqual(0.2);
  expect(await ruler.locator('[data-timeline-ruler-tick="minor"]').count()).toBeGreaterThan(10);

  const labelBoxes = (await ruler.locator("[data-timeline-ruler-label]").evaluateAll((labels) =>
    labels.map((label) => {
      const box = label.getBoundingClientRect();
      return { left: box.left, right: box.right };
    })
  )).sort((left, right) => left.left - right.left);
  for (let index = 1; index < labelBoxes.length; index += 1) {
    expect(labelBoxes[index].left).toBeGreaterThanOrEqual(labelBoxes[index - 1].right);
  }
});

test("crowded video clips collapse to clean markers instead of overlapping metadata", async ({ page }) => {
  const crowdedComposition = Array.from({ length: 24 }, (_, index) => ({
    ...COMPOSITION[index % COMPOSITION.length],
    id: `dense-${index}`,
    timeline_start: index * 0.5,
    timeline_duration: 0.5,
  }));
  const { editor } = await openFullEditor(page, { composition: crowdedComposition });
  const timeline = editor.locator('[aria-label="Multi-track timeline"]');
  const clips = timeline.locator('[data-testid^="composition-clip-dense-"]');

  await expect(clips).toHaveCount(crowdedComposition.length);
  await expect.poll(() => clips.evaluateAll((items) =>
    items.every((item) => item.getAttribute("data-clip-density") === "marker")
  )).toBe(true);
  expect(await clips.locator("span.font-mono").count()).toBe(0);
});

test("card timeline stays behind the sticky Variant Previews header while scrolling", async ({ page }) => {
  const { editor: canvas } = await openFullEditor(page, { maximize: false });
  const header = page.getByTestId("step3-variant-header");
  const timeline = canvas.locator('[aria-label="Multi-track timeline"]');

  await expect(header).toBeVisible();
  await expect(timeline).toBeVisible();

  await canvas.evaluate((element) => {
    const headerElement = element.querySelector<HTMLElement>('[data-testid="step3-variant-header"]');
    const timelineElement = element.querySelector<HTMLElement>('[aria-label="Multi-track timeline"]');
    if (!headerElement || !timelineElement) throw new Error("Step 3 header or timeline is missing");
    element.scrollTop += timelineElement.getBoundingClientRect().top - headerElement.getBoundingClientRect().top;
  });

  await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await header.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return topmost === element || element.contains(topmost);
  })).toBe(true);
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
