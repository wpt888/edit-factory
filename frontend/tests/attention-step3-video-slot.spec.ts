import { expect, test } from "@playwright/test";

// Phase 3 screenshot: a video asset assigned to an attention slot in Step 3
// renders as a video thumbnail with a "Vid" badge (not a broken <img>).

const PIPELINE_ID = "attention-step3-video-pipeline";
const PROFILE = {
  id: "attention-step3-video-profile",
  name: "Attention Step 3 Video QA",
  is_default: true,
  created_at: "2026-07-21T00:00:00Z",
};

const TEMPLATE = {
  id: "system-quick-pulse",
  name: "Quick Pulse",
  is_system: true,
  strategy: "count",
  count: 2,
  durationMs: 1200,
  animation: "pop",
  layers: 1,
  size: 0.8,
  zone: "behind",
};

const previewFor = (offset: number) => ({
  audio_duration: 12,
  srt_content: "1\n00:00:00,000 --> 00:00:06,000\nOne two\n\n2\n00:00:06,000 --> 00:00:12,000\nThree four",
  matches: [
    { srt_index: 0, srt_text: "One two", srt_start: 0, srt_end: 6, segment_id: "seg-a", segment_keywords: ["first"], matched_keyword: "first", confidence: 1, source_video_id: "source-a", segment_start_time: offset, segment_end_time: offset + 6, merge_group: 0, merge_group_duration: 6 },
    { srt_index: 1, srt_text: "Three four", srt_start: 6, srt_end: 12, segment_id: "seg-b", segment_keywords: ["second"], matched_keyword: "second", confidence: 1, source_video_id: "source-b", segment_start_time: 0, segment_end_time: 6, merge_group: 1, merge_group_duration: 6 },
  ],
  total_phrases: 2,
  matched_count: 2,
  unmatched_count: 0,
  available_segments: [],
});

test("Step 3 slot shows an assigned video with a Vid badge", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

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

    const applyMatch = path.match(/attention-timeline\/([^/]+)\/apply-template$/);
    if (applyMatch && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: {
        revision: Number(body.revision) + 1,
        cues: [{ id: `applied-${applyMatch[1]}`, startMs: 0, durationMs: 1200, layers: [], zone: "behind" }],
      } });
      return;
    }

    const timelineMatch = path.match(/attention-timeline\/([^/]+)$/);
    if (timelineMatch && request.method() === "GET") {
      await route.fulfill({ json: { revision: 0, cues: [] } });
      return;
    }
    if (timelineMatch && request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { revision: Number(body.revision) + 1, cues: body.cues ?? [] } });
      return;
    }
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: [TEMPLATE] } });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["One two three four", "Five six seven eight"],
        script_names: ["Variant one", "Variant two"],
        context_products: [],
        preview_info: {
          "0": { has_audio: true, audio_duration: 12, has_srt: true },
          "1": { has_audio: true, audio_duration: 12, has_srt: true },
        },
        tts_info: {
          "0": { has_audio: true, audio_duration: 12, approved: true, srt_content: "" },
          "1": { has_audio: true, audio_duration: 12, approved: true, srt_content: "" },
        },
        captions: {},
        selected_captions: {},
        name: "Attention video slot",
        idea: "Attention QA",
        provider: "gemini",
        variant_count: 2,
        meta_multiplication: false,
        attention_selection: { templateId: "", assets: [], staggerSeconds: 1 },
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: {
        previews: { "0": previewFor(0), "1": previewFor(1) },
        available_segments: [],
      } });
      return;
    }
    if (path.endsWith(`/pipeline/status/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        provider: "gemini",
        variant_count: 2,
        variants: [
          { variant_index: 0, status: "not_started", progress: 0, current_step: "" },
          { variant_index: 1, status: "not_started", progress: 0, current_step: "" },
        ],
        meta_variants: null,
        meta_multiplication: false,
        preview_info: {},
        tts_info: {},
        library_project_id: null,
      } });
      return;
    }
    if (path.endsWith("/profiles/") || path.endsWith("/profiles")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/tts-library/") || path.endsWith("/tts/voices") || path.endsWith("/subtitle-presets")) {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const applyCard = page.getByTestId("step3-attention-apply");
  await expect(applyCard).toBeVisible();

  // Choose the layout template, then assign a video to a slot via the URL tab.
  await applyCard.getByRole("combobox", { name: "Layout template", exact: true }).click();
  await page.getByRole("option", { name: /Quick Pulse/ }).click();
  await applyCard.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Media URL").fill("https://assets.test/attention-slot.mp4");
  await page.getByRole("button", { name: "Use media URL" }).click();

  // The slot now carries a video: the "Vid" badge proves the typed asset stuck.
  await expect(applyCard.getByText("Vid", { exact: true })).toBeVisible();
  // Let the auto-apply effect settle, then guard against a render crash.
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "screenshots/attention-step3-video-slot.png", fullPage: true });
  expect(pageErrors, pageErrors.join("\n")).toEqual([]);
});
