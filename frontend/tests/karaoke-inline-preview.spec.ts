import { expect, test } from "@playwright/test";

// Verifies the karaoke "Background box" style end-to-end: the settings panel
// toggle + live animated mock (Work package B), and the real inline Step-3
// preview player's per-word rAF-driven highlight (Work package A).

const PIPELINE_ID = "karaoke-preview-pipeline";
const PROFILE = {
  id: "karaoke-preview-profile",
  name: "Karaoke QA",
  is_default: true,
  created_at: "2026-07-19T00:00:00Z",
};

const SEGMENTS = [
  { id: "seg-a", source_video_id: "source-a", start_time: 0, end_time: 10, duration: 10, keywords: ["first"], thumbnail_path: null, transforms: null },
];

const COMPOSITION = [
  { id: "body-a", kind: "body", segment_id: "seg-a", segment_keywords: ["body one"], source_video_id: "source-a", start_time: 0, end_time: 3, timeline_start: 0, timeline_duration: 3 },
];

// Phrase 0: "One two three four five" over [0, 1.5) — enough words to see the
// active-word box move well past the first word during real playback.
const MATCHES = [
  { srt_index: 0, srt_text: "One two three four five", srt_start: 0, srt_end: 1.5, segment_id: "seg-a", segment_keywords: ["first"], matched_keyword: "first", confidence: 1, source_video_id: "source-a", segment_start_time: 0, segment_end_time: 3, merge_group: 0, merge_group_duration: 3 },
];

// 3s of silence @ 8kHz mono 16-bit — long enough to play well past phrase 0.
const makeSilentWav = (durationSec: number) => {
  const sampleRate = 8_000;
  const samples = sampleRate * durationSec;
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

test("karaoke background-box style: settings mock + live inline preview", async ({ page }) => {
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
      await route.fulfill({ status: 200, contentType: "audio/wav", body: makeSilentWav(3) });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["One two three four five"],
        script_names: ["Karaoke QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 3, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 3, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Karaoke QA",
        idea: "Karaoke QA",
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
            audio_duration: 3,
            srt_content: "1\n00:00:00,000 --> 00:00:01,500\nOne two three four five",
            matches: MATCHES,
            total_phrases: 1,
            matched_count: 1,
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
      await route.fulfill({ json: { source_video_ids: ["source-a"] } });
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
      await route.fulfill({ json: { total_segment_duration: 3 } });
      return;
    }
    if (path.endsWith("/ai-instructions")) {
      await route.fulfill({ json: { ai_instructions: "" } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1900, height: 1080 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  // --- Work package B: settings panel + animated mock -------------------
  const settingsEditor = page.getByTestId("subtitle-style-variant-editor");
  await expect(settingsEditor.getByText("Karaoke Highlight")).toBeVisible();

  const karaokeRow = settingsEditor.locator("div.flex.items-center.justify-between").filter({ hasText: "Karaoke Highlight" });
  await karaokeRow.getByRole("switch").click();

  const styleSection = settingsEditor.locator("div.space-y-2").filter({ hasText: "Highlight Style" });
  await styleSection.getByRole("combobox").click();
  await page.getByRole("option", { name: "Background box" }).click();

  const livePreview = page.getByTestId("subtitle-sticky-preview");
  await expect(livePreview.getByTestId("karaoke-preview-overlay")).toBeVisible();
  await livePreview.screenshot({ path: "screenshots/karaoke-settings-box-mode.png" });

  // --- Work package A: the real inline preview player --------------------
  const canvas = page.getByTestId("step3-variant-canvas");
  const activeBoxWord = () => canvas.evaluate((el) => {
    const spans = Array.from(el.querySelectorAll("span"));
    const active = spans.find((s) => getComputedStyle(s).backgroundColor === "rgb(163, 230, 53)");
    return active?.textContent ?? null;
  });

  // Paused, before any playback: the fallback clock (time 0) highlights word 0.
  await expect.poll(activeBoxWord).toBe("One");

  // Two controls share the "Play preview" label before playback starts (the
  // centered overlay button and the transport-bar toggle) — either works.
  await canvas.getByRole("button", { name: "Play preview" }).first().click();
  await page.waitForTimeout(1200);

  // Playing: the child component's own rAF loop (reading audio.currentTime
  // directly) has advanced the highlight well past the first word — proof
  // the fine-grained clock is live, not just the coarse ~0.1s parent clock.
  const wordDuringPlayback = await activeBoxWord();
  expect(wordDuringPlayback).not.toBe("One");
  expect(wordDuringPlayback).not.toBeNull();

  await canvas.screenshot({ path: "screenshots/karaoke-inline-preview-box-mode.png" });
});
