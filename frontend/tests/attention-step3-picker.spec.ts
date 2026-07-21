import { expect, test } from "@playwright/test";

const PIPELINE_ID = "attention-step3-pipeline";
const PROFILE = {
  id: "attention-step3-profile",
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

// Shared route table for a Step 3 pipeline. `attentionSelection` seeds the
// persisted selection so callers can start empty or pre-populated.
type MediaRow = { id: string; displayName: string | null; mimeType: string; previewUrl: string; status: string };

function routeStep3(page: import("@playwright/test").Page, opts: {
  attentionSelection: Record<string, unknown> | null;
  onApply?: (key: string, body: { startOffsetMs?: number }) => void;
  media?: MediaRow[];
  uploadMediaId?: string;
  templates?: unknown[];
}) {
  return page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith("/platform/media/upload") && request.method() === "POST") {
      await route.fulfill({ json: { mediaId: opts.uploadMediaId ?? "" } });
      return;
    }

    const applyMatch = path.match(/attention-timeline\/([^/]+)\/apply-template$/);
    if (applyMatch && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      opts.onApply?.(applyMatch[1], body);
      await route.fulfill({ json: { revision: 1, cues: [{ id: "cue", startMs: 3000 + (body.startOffsetMs || 0), durationMs: 1200, layers: [], zone: "behind" }] } });
      return;
    }
    if (path.match(/attention-timeline\/[^/]+$/) && request.method() === "GET") {
      await route.fulfill({ json: { revision: 0, cues: [] } });
      return;
    }
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: { templates: opts.templates ?? TEMPLATES } });
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
        name: "Attention QA",
        idea: "Attention QA",
        provider: "gemini",
        variant_count: 2,
        meta_multiplication: false,
        attention_selection: opts.attentionSelection,
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
    if (path.includes("/platform/media")) {
      await route.fulfill({ json: { connected: true, media: opts.media ?? [] } });
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
}

test("step 3 attention card exposes template layout, numbered slots, and image assignment", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await routeStep3(page, { attentionSelection: null });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const card = page.getByTestId("step3-attention-apply");
  await expect(card).toBeVisible();

  const picker = card.getByTestId("attention-template-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox", { name: "Layout template" }).click();
  await page.getByRole("option", { name: "Tornado Stack · System" }).click();

  await expect(card.getByTestId("attention-layout-preview")).toBeVisible();
  await expect(card.getByTestId("attention-stagger-seconds")).toBeVisible();
  await expect(card.getByText("3 slots")).toBeVisible();
  // maxVariants was removed — Apply scope covers per-variant targeting now.
  await expect(card.getByTestId("attention-max-variants")).toHaveCount(0);

  const slots = card.getByTestId("attention-content-slots");
  await expect(slots.getByText("Choose")).toHaveCount(3);

  await slots.getByText("Choose").first().click();
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Media URL").fill("https://assets.test/attention-one.png");
  await page.getByRole("button", { name: "Use media URL" }).click();
  await expect(page.getByAltText("Attention content 1")).toHaveAttribute("src", "https://assets.test/attention-one.png");

  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/attention-step3-picker.png", fullPage: true });
});

test("selecting a template with saved default content pre-populates the slots", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  const slot = (id: string, startMs: number, defaultAsset: { url: string; type: string }) => ({
    id, x: 0.1, y: 0.1, width: 0.4, height: 0.4, opacity: 1, fit: "contain",
    startMs, durationMs: 1200, defaultAsset, sfxVolumeDb: 0, sfxTrack: 1,
  });
  const templateWithDefaults = {
    id: "tmpl-defaults", name: "Prefilled", is_system: false,
    canvasWidth: 1080, canvasHeight: 1920, zone: "behind", animation: "pop",
    variantGapMs: 1000, audioTrackCount: 1,
    tracks: [[
      slot("s1", 0, { url: "https://assets.test/default-a.png", type: "image" }),
      slot("s2", 1500, { url: "https://assets.test/default-b.mp4", type: "video" }),
    ]],
  };

  await routeStep3(page, { attentionSelection: null, templates: [templateWithDefaults] });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const card = page.getByTestId("step3-attention-apply");
  await expect(card).toBeVisible();

  await card.getByRole("combobox", { name: "Layout template" }).click();
  await page.getByRole("option", { name: "Prefilled · Personal" }).click();

  // Both slots fill from the template defaults — no empty "Choose" tiles remain.
  const slots = card.getByTestId("attention-content-slots");
  await expect(page.getByAltText("Attention content 1")).toHaveAttribute("src", "https://assets.test/default-a.png");
  await expect(slots.getByText("Choose")).toHaveCount(0);
  await expect(slots.getByText("Vid", { exact: true })).toBeVisible();

  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/attention-step3-prefill.png", fullPage: true });
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
  // Old bundle shape: assetUrls + maxVariants. Loading must not crash and the
  // stagger must still drive per-variant offsets.
  await routeStep3(page, {
    attentionSelection: {
      templateId: "system-quick-pulse",
      assetUrls: ["https://assets.test/one.png"],
      staggerSeconds: 1,
      maxVariants: 0,
    },
    onApply: (key, body) => applyPosts.push({ key, body }),
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  await expect.poll(() => applyPosts.length, { timeout: 20000 }).toBeGreaterThanOrEqual(2);
  const byKey = Object.fromEntries(applyPosts.map(post => [post.key, post.body]));
  expect(byKey["0"].startOffsetMs).toBe(0);
  expect(byKey["1"].startOffsetMs).toBe(1000);
});

test("gallery lists video assets and a pasted image lands in a slot", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await routeStep3(page, {
    // Seed a selected template so the paste listener is active, no assets yet.
    attentionSelection: { templateId: "system-tornado-stack", assets: [], staggerSeconds: 1 },
    uploadMediaId: "pasted-1",
    media: [
      { id: "vid-1", displayName: "Clip", mimeType: "video/mp4", previewUrl: "https://assets.test/clip.mp4", status: "ready" },
      { id: "pasted-1", displayName: "Pasted", mimeType: "image/png", previewUrl: "https://assets.test/pasted.png", status: "ready" },
    ],
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const card = page.getByTestId("step3-attention-apply");
  await expect(card).toBeVisible();

  // Gallery surfaces the video item with a "Video" badge.
  await card.getByTestId("attention-content-slots").getByText("Choose").first().click();
  await expect(page.getByRole("dialog").getByText("Video")).toBeVisible();
  await page.keyboard.press("Escape");

  // Synthesize a clipboard image paste; it uploads and fills the next slot.
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgo="), (c) => c.charCodeAt(0));
    const file = new File([bytes], "pasted.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.getByAltText("Attention content 1")).toHaveAttribute("src", "https://assets.test/pasted.png");
});
