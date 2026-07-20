import { expect, test } from "@playwright/test";

// Verifies the maximized Step-3 editor ("Maximize editor" button on a variant
// card -> full-viewport NLE dialog): (a) the karaoke word-highlight renders in
// its preview panel exactly like the compact inline player (same
// renderPreviewSubtitleOverlay/PreviewSubtitleOverlayText, reused per
// displayMode="full"), and (b) the settings column on the right exposes the
// full preview-settings surface (Subtitles / Timing / Adjust tabs) reusing the
// same Subtitle Style + Preview Timing + Render Settings panels/state as the
// left inspector — no divergent copies.

const PIPELINE_ID = "karaoke-max-pipeline";
const PROFILE = {
  id: "karaoke-max-profile",
  name: "Karaoke Max QA",
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

test("maximized editor: karaoke overlay + full settings column with tabs", async ({ page }) => {
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
        script_names: ["Karaoke Max QA"],
        context_products: [],
        preview_info: { "0": { has_audio: true, audio_duration: 3, has_srt: true } },
        tts_info: { "0": { has_audio: true, audio_duration: 3, approved: true, srt_content: "" } },
        captions: {},
        selected_captions: {},
        name: "Karaoke Max QA",
        idea: "Karaoke Max QA",
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

  // Turn karaoke ON with the "Background box" style from the left inspector.
  const settingsEditor = page.getByTestId("subtitle-style-variant-editor").first();
  await expect(settingsEditor.getByText("Karaoke Highlight")).toBeVisible();
  const karaokeRow = settingsEditor.locator("div.flex.items-center.justify-between").filter({ hasText: "Karaoke Highlight" });
  await karaokeRow.getByRole("switch").click();
  const styleSection = settingsEditor.locator("div.space-y-2").filter({ hasText: "Highlight Style" });
  await styleSection.getByRole("combobox").click();
  await page.getByRole("option", { name: "Background box" }).click();

  // Open the maximized editor for the variant card.
  const canvas = page.getByTestId("step3-variant-canvas");
  await canvas.getByRole("button", { name: /Maximize editor/ }).click();

  const fullEditor = page.getByTestId("step3-full-editor");
  await expect(fullEditor).toBeVisible();

  // --- (b) the settings column exposes the full surface, tabbed ----------
  const settingsColumn = page.getByTestId("step3-full-editor-settings");
  await expect(settingsColumn).toBeVisible();
  await expect(settingsColumn.getByRole("tab", { name: "Subtitles" })).toBeVisible();
  await expect(settingsColumn.getByRole("tab", { name: "Timing" })).toBeVisible();
  await expect(settingsColumn.getByRole("tab", { name: "Adjust" })).toBeVisible();

  // Subtitles tab (default) shows the same Subtitle Style panel (incl. the
  // karaoke toggle we just flipped, reflecting the SAME shared state).
  await expect(settingsColumn.getByText("Subtitle Style")).toBeVisible();
  const maximizedKaraokeRow = settingsColumn
    .locator("div.flex.items-center.justify-between")
    .filter({ hasText: "Karaoke Highlight" });
  await expect(maximizedKaraokeRow.getByRole("switch")).toHaveAttribute("data-state", "checked");

  // Timing tab shows Preview Timing controls.
  await settingsColumn.getByRole("tab", { name: "Timing" }).click();
  await expect(settingsColumn.getByText("Preview Timing")).toBeVisible();
  await expect(settingsColumn.getByText("Pacing")).toBeVisible();

  // Adjust tab shows Render Settings (encoding + picture/audio adjustments).
  await settingsColumn.getByRole("tab", { name: "Adjust" }).click();
  await expect(settingsColumn.getByText("Render Settings")).toBeVisible();

  // Back to Subtitles for the screenshot.
  await settingsColumn.getByRole("tab", { name: "Subtitles" }).click();

  // --- (a) karaoke renders in the maximized preview -----------------------
  const activeBoxWord = () => fullEditor.evaluate((el) => {
    const spans = Array.from(el.querySelectorAll("span"));
    const active = spans.find((s) => getComputedStyle(s).backgroundColor === "rgb(163, 230, 53)");
    return active?.textContent ?? null;
  });

  // Paused, before any playback: the fallback clock (time 0) highlights word 0.
  await expect.poll(activeBoxWord).toBe("One");
  await fullEditor.screenshot({ path: "screenshots/karaoke-maximized-paused.png" });

  await fullEditor.getByRole("button", { name: "Play preview" }).first().click();

  // Playing: the rAF loop has advanced the highlight past the first word —
  // proof the maximized view's overlay is live, not a static/first-word stub.
  // Poll (rather than a single fixed-delay read) because the highlight color
  // transitions over 120ms on each word change — a single sampled instant can
  // land mid-transition even though the highlight is genuinely advancing.
  const isAdvancedPastFirstWord = async () => {
    const word = await activeBoxWord();
    return word !== null && word !== "One";
  };
  await expect.poll(isAdvancedPastFirstWord, { timeout: 3000 }).toBe(true);

  await fullEditor.screenshot({ path: "screenshots/karaoke-maximized-playing.png" });
});
