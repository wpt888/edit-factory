import { expect, test } from "@playwright/test";

const PIPELINE_ID = "attention-step1-pipeline";
const PROFILE = {
  id: "attention-step1-profile",
  name: "Attention QA",
  is_default: true,
  created_at: "2026-07-19T00:00:00Z",
};

const TEMPLATES = [
  { id: "system-quick-pulse", name: "Quick Pulse", is_system: true, strategy: "count", count: 3, durationMs: 1200, animation: "pop", layers: 1, size: 0.8, zone: "behind" },
  { id: "system-tornado-stack", name: "Tornado Stack", is_system: true, strategy: "count", count: 2, durationMs: 1800, animation: "tornado", layers: 3, size: 0.8, zone: "behind" },
];

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

test("step 1 exposes template layout and numbered content slots", async ({ page }) => {
  await page.addInitScript(({ profile }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
  }, { profile: PROFILE });

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: TEMPLATES } });
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
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/pipeline?desktopAuth=confirmed");

  const picker = page.getByTestId("attention-template-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox").click();
  await page.getByRole("option", { name: "Tornado Stack · System" }).click();
  await expect(page.getByTestId("attention-stagger-seconds")).toBeVisible();
  await expect(page.getByTestId("attention-max-variants")).toBeVisible();
  await expect(picker.getByText("3 slots")).toBeVisible();
  await expect(page.getByTestId("attention-layout-preview")).toBeVisible();
  await expect(page.getByTestId("attention-content-slots").getByText("Slot 1")).toBeVisible();
  await expect(page.getByTestId("attention-content-slots").getByText("Slot 3")).toBeVisible();

  await page.getByTestId("attention-content-slots").getByText("Choose image").first().click();
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Image URL").fill("https://assets.test/attention-one.png");
  await page.getByRole("button", { name: "Use image URL" }).click();
  await expect(page.getByAltText("Attention content 1")).toHaveAttribute("src", "https://assets.test/attention-one.png");

  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/attention-step1-picker.png", fullPage: true });
});

test("auto-apply staggers each variant by the configured offset", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  const applyPosts: Array<{ key: string; body: { startOffsetMs?: number } }> = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    const applyMatch = path.match(/attention-timeline\/([^/]+)\/apply-template$/);
    if (applyMatch && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      applyPosts.push({ key: applyMatch[1], body });
      await route.fulfill({ json: { revision: 1, cues: [{ id: "cue", startMs: 3000 + (body.startOffsetMs || 0), durationMs: 1200, layers: [], zone: "behind" }] } });
      return;
    }
    if (path.match(/attention-timeline\/[^/]+$/) && request.method() === "GET") {
      await route.fulfill({ json: { revision: 0, cues: [] } });
      return;
    }
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: TEMPLATES } });
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
        name: "Attention stagger",
        idea: "Attention QA",
        provider: "gemini",
        variant_count: 2,
        meta_multiplication: false,
        attention_selection: {
          templateId: "system-quick-pulse",
          assetUrls: ["https://assets.test/one.png"],
          staggerSeconds: 1,
          maxVariants: 0,
        },
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

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  await expect.poll(() => applyPosts.length, { timeout: 20000 }).toBeGreaterThanOrEqual(2);
  const byKey = Object.fromEntries(applyPosts.map(post => [post.key, post.body]));
  expect(byKey["0"].startOffsetMs).toBe(0);
  expect(byKey["1"].startOffsetMs).toBe(1000);
});
