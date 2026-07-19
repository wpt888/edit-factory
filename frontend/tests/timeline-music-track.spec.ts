import { expect, test, type Page } from "@playwright/test";

// Phase B: A2 background music. Pick a track (mock platform media route) → a
// block appears on the A2 lane → edit ducking in the inspector → the debounced
// composition PUT carries `music` with the edited values → clear → block gone.
// Route-mock harness, mirroring timeline-tracks.spec.ts.

const PIPELINE_ID = "music-pipeline";
const PROFILE = {
  id: "music-profile",
  name: "Music QA",
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

const MUSIC_TRACK = {
  id: "track-1",
  displayName: "Chill Beat",
  mimeType: "audio/mpeg",
  previewUrl: "https://example.com/chill.mp3",
  status: "ready",
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

type Harness = { compositionPuts: Array<Record<string, unknown>> };

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

    if (path.endsWith(`/pipeline/${PIPELINE_ID}/composition/0`)) {
      if (request.method() === "PUT") {
        harness.compositionPuts.push(request.postDataJSON() as Record<string, unknown>);
        await route.fulfill({ json: { status: "saved" } });
      } else {
        await route.fulfill({ json: {} });
      }
      return;
    }
    if (path.endsWith("/platform/media")) {
      await route.fulfill({ json: { connected: true, media: [MUSIC_TRACK] } });
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
        script_names: ["Music QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 4, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 4, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Music QA",
        idea: "Music QA",
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
            music: null,
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
  await expect(editor.locator("span.truncate", { hasText: /^A2 Music$/ })).toBeVisible();
  return { editor, harness };
};

const lastMusic = (harness: Harness) =>
  (harness.compositionPuts.at(-1) as { music?: Record<string, unknown> } | undefined)?.music;

test("pick music → block on A2, edit ducking → composition PUT carries music, clear → gone", async ({ page }) => {
  const { editor, harness } = await openFullEditor(page);

  // Empty A2 lane → open the inspector.
  await editor.getByTestId("music-lane-empty").click();
  const inspector = editor.getByTestId("music-inspector");
  await expect(inspector).toBeVisible();

  // Open the picker (gallery mock) and choose the track.
  await inspector.getByTestId("music-pick").click();
  await page.getByTestId("music-gallery").getByRole("button", { name: /Chill Beat/ }).click();

  // A music block now spans the A2 lane and the inspector shows controls.
  await expect(editor.getByTestId("music-block")).toBeVisible();
  await expect(inspector.getByTestId("music-ducking")).toBeVisible();

  // Screenshot: A2 lane block + open inspector (MANDATORY).
  await page.screenshot({ path: "screenshots/timeline-music-track.png" });

  // Toggle ducking OFF — mutates music → debounced composition PUT.
  await inspector.getByTestId("music-ducking").click();

  await expect.poll(() => lastMusic(harness)?.ducking, { timeout: 5000 }).toBe(false);
  const music = lastMusic(harness)!;
  expect(music.assetUrl).toBe(MUSIC_TRACK.previewUrl);
  expect(music.label).toBe(MUSIC_TRACK.displayName);
  expect(music.volume).toBeCloseTo(0.3, 5);

  // Clear the track — block disappears and the PUT carries music: null.
  await inspector.getByTestId("music-clear").click();
  await expect(editor.getByTestId("music-block")).toHaveCount(0);
  // The next composition PUT explicitly carries music: null (distinct from an
  // absent key), so use "in" to tell null apart from "no PUT yet".
  await expect
    .poll(() => {
      const last = harness.compositionPuts.at(-1) as { music?: unknown } | undefined;
      return last && "music" in last ? last.music : "no-put";
    }, { timeout: 5000 })
    .toBeNull();
});
