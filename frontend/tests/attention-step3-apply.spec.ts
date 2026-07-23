import { expect, test } from "@playwright/test";

const PIPELINE_ID = "attention-step3-pipeline";
const PROFILE = {
  id: "attention-step3-profile",
  name: "Attention Step 3 QA",
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

test("Step 3 picks and applies an attention template to all variants with overwrite confirmation", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  const timelineGets = new Set<string>();
  const applyPosts: Array<{ key: string; body: Record<string, unknown> }> = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const applyMatch = path.match(/attention-timeline\/([^/]+)\/apply-template$/);
    if (applyMatch && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      applyPosts.push({ key: applyMatch[1], body });
      await route.fulfill({ json: {
        revision: Number(body.revision) + 1,
        cues: [{ id: `applied-${applyMatch[1]}`, startMs: Number(body.startOffsetMs), durationMs: 1200, layers: [], zone: "behind" }],
      } });
      return;
    }

    const timelineMatch = path.match(/attention-timeline\/([^/]+)$/);
    if (timelineMatch && request.method() === "GET") {
      const key = timelineMatch[1];
      timelineGets.add(key);
      // Both variants start with existing attention images so the auto-apply
      // effect (empty timelines only) skips them and the manual overwrite
      // confirmation is what drives the apply.
      await route.fulfill({ json: key === "0"
        ? { revision: 3, cues: [{ id: "existing-0", startMs: 1000, durationMs: 1200, layers: [], zone: "behind" }] }
        : { revision: 5, cues: [{ id: "existing-1", startMs: 2000, durationMs: 1200, layers: [], zone: "behind" }] }
      });
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
        name: "Attention manual apply",
        idea: "Attention QA",
        provider: "gemini",
        variant_count: 2,
        meta_multiplication: false,
        attention_selection: {
          templateId: "",
          assetUrls: [],
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

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const applyCard = page.getByTestId("step3-attention-apply");
  await expect(applyCard).toBeVisible();
  await expect(applyCard.getByRole("link", { name: "Manage templates" })).toBeVisible();
  await expect.poll(() => timelineGets.size, { timeout: 20_000 }).toBe(2);

  await applyCard.getByRole("combobox", { name: "Layout template", exact: true }).click();
  await page.getByRole("option", { name: /Quick Pulse/ }).click();
  await applyCard.getByTestId("attention-content-slots").getByText("Choose").first().click();
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Media URL").fill("https://assets.test/step3-attention.png");
  await page.getByRole("button", { name: "Use media URL" }).click();

  await applyCard.getByRole("combobox", { name: "All-slot entrance effect" }).click();
  await page.getByRole("option", { name: /Slide from right/ }).click();
  await applyCard.getByTestId("step3-attention-enter-duration").fill("0.45");

  await expect(applyCard.getByRole("combobox", { name: "Attention template apply scope", exact: true })).toHaveText(/All variants/);
  await applyCard.scrollIntoViewIfNeeded();
  await applyCard.screenshot({ path: "screenshots/attention-apply-step3.png" });

  await applyCard.getByRole("button", { name: "Apply template" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("2 targeted variants already have attention images");
  expect(applyPosts).toHaveLength(0);
  await confirm.getByRole("button", { name: "Replace attention images" }).click();

  await expect.poll(() => applyPosts.length).toBe(2);
  expect(applyPosts.map((post) => post.key).sort()).toEqual(["0", "1"]);
  const byKey = Object.fromEntries(applyPosts.map((post) => [post.key, post.body]));
  expect(byKey["0"]).toMatchObject({
    templateId: TEMPLATE.id,
    animation: "slide-right",
    enterMs: 450,
    assets: [{ url: "https://assets.test/step3-attention.png", type: "image" }],
    durationMs: 12000,
    subtitleBoundariesMs: [0, 6000, 12000],
    revision: 3,
    mode: "replace",
    startOffsetMs: 0,
  });
  expect(byKey["1"]).toMatchObject({ revision: 5, mode: "replace" });
  await expect(applyCard.getByTestId("attention-apply-result")).toHaveText("Applied to 2 variants.");
});
