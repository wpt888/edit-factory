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
type UploadedAsset = { url: string; type: "image" | "video" };

function routeStep3(page: import("@playwright/test").Page, opts: {
  attentionSelection: Record<string, unknown> | null;
  onApply?: (key: string, body: { startOffsetMs?: number }) => void;
  timelines?: Record<string, Record<string, unknown>>;
  onTimelineSave?: (key: string, body: Record<string, unknown>) => void;
  media?: MediaRow[];
  mediaConnected?: boolean;
  uploadedAsset?: UploadedAsset;
  templates?: unknown[];
  personalTemplatesAvailable?: boolean;
}) {
  return page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path.endsWith("/segments/attention-media") && request.method() === "POST") {
      await route.fulfill({ json: {
        asset: opts.uploadedAsset ?? {
          url: "media/attention/profile/pasted.png",
          type: "image",
        },
      } });
      return;
    }

    const applyMatch = path.match(/attention-timeline\/([^/]+)\/apply-template$/);
    if (applyMatch && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      opts.onApply?.(applyMatch[1], body);
      await route.fulfill({ json: { revision: 1, cues: [{ id: "cue", startMs: 3000 + (body.startOffsetMs || 0), durationMs: 1200, layers: [], zone: "behind" }] } });
      return;
    }
    const timelineMatch = path.match(/attention-timeline\/([^/]+)$/);
    if (timelineMatch && request.method() === "GET") {
      await route.fulfill({
        json: opts.timelines?.[timelineMatch[1]] ?? { revision: 0, cues: [] },
      });
      return;
    }
    if (timelineMatch && request.method() === "PUT") {
      const body = JSON.parse(request.postData() || "{}") as Record<string, unknown>;
      opts.onTimelineSave?.(timelineMatch[1], body);
      await route.fulfill({
        json: {
          ...body,
          revision: Number(body.revision ?? 0) + 1,
        },
      });
      return;
    }
    if (path.endsWith("/attention-templates")) {
      await route.fulfill({ json: {
        templates: opts.templates ?? TEMPLATES,
        personal_templates_available: opts.personalTemplatesAvailable ?? true,
      } });
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
      await route.fulfill({ json: {
        connected: opts.mediaConnected ?? true,
        media: opts.media ?? [],
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
}

test("step 3 content templates expose numbered slots and the shared effect library", async ({ page }) => {
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

  // The live variant canvas is the visual source of truth; the old miniature
  // simulation consumed most of the inspector without adding useful feedback.
  await expect(card.getByTestId("attention-layout-preview")).toHaveCount(0);
  await expect(card.getByTestId("attention-stagger-seconds")).toBeVisible();
  const transition = card.getByRole("combobox", { name: "Template effect for next apply" });
  await expect(transition).toContainText("Static / Classic");
  await transition.click();
  await expect(page.getByLabel("Search entrance effects")).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Entrance effects" })).toHaveScreenshot(
    "attention-effect-library.png",
    { animations: "disabled" },
  );
  await page.getByRole("option", { name: /^Tornado High-energy/ }).click();
  await expect(transition).toContainText("Tornado");
  await transition.click();
  await page.getByRole("option", { name: /Static \/ Classic/ }).click();
  await expect(transition).toContainText("Static / Classic");
  await expect(card.getByText("3 slots")).toBeVisible();
  // maxVariants was removed — Apply scope covers per-variant targeting now.
  await expect(card.getByTestId("attention-max-variants")).toHaveCount(0);

  const slots = card.getByTestId("attention-content-slots");
  await expect(slots.getByText("Choose")).toHaveCount(3);
  await expect(slots.locator(":scope > div").nth(1)).toHaveCSS(
    "grid-template-columns",
    /.+ .+ .+ .+/,
  );

  await slots.getByText("Choose").first().click();
  await page.getByRole("tab", { name: "URL" }).click();
  await page.getByLabel("Media URL").fill("https://assets.test/attention-one.png");
  await page.getByRole("button", { name: "Use media URL" }).click();
  await expect(page.getByAltText("Attention content 1")).toHaveAttribute("src", "https://assets.test/attention-one.png");

  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText("Template effect for next apply", { exact: true }).locator("..")).toHaveScreenshot("attention-step3-transition-picker.png", {
    animations: "disabled",
  });
  await page.screenshot({ path: "screenshots/attention-step3-picker.png", fullPage: true });
});

test("step 3 explains when personal template storage is unavailable", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  await routeStep3(page, {
    attentionSelection: null,
    personalTemplatesAvailable: false,
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const card = page.getByTestId("step3-attention-apply");
  await expect(card).toContainText(
    "Personal templates are unavailable until the attention-template database migration is applied.",
  );
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

test("local upload works while Blipost is disconnected and paste lands in a slot", async ({ page }) => {
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
    mediaConnected: false,
    uploadedAsset: { url: "media/attention/profile/pasted.png", type: "image" },
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const card = page.getByTestId("step3-attention-apply");
  await expect(card).toBeVisible();

  // Reproduce the reported state: the optional cloud gallery is disconnected.
  await card.getByTestId("attention-content-slots").getByText("Choose").first().click();
  await expect(page.getByText("Connect Blipost to use the shared media gallery")).toBeVisible();

  // The Upload tab uses local storage, independently of the Blipost gallery.
  await page.getByRole("tab", { name: "Upload" }).click();
  await expect(page.getByText("Blipost connection is not required.")).toBeVisible();
  await page.locator('input[type="file"][accept="image/*,video/*"]').setInputFiles({
    name: "local.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgo=", "base64"),
  });
  await expect(page.getByAltText("Attention content 1")).toHaveAttribute(
    "src",
    /\/segments\/attention-media\/pasted\.png\?profile_id=attention-step3-profile$/,
  );

  // Remove the first selection so paste verifies the same local upload path.
  await card.getByRole("button", { name: "Remove content 1" }).click();

  // Synthesize a clipboard image paste; it uploads and fills the next slot.
  await page.evaluate(() => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgo="), (c) => c.charCodeAt(0));
    const file = new File([bytes], "pasted.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.getByAltText("Attention content 1")).toHaveAttribute(
    "src",
    /\/segments\/attention-media\/pasted\.png\?profile_id=attention-step3-profile$/,
  );
});

test("multiple selected images and the global toggle expose distinct effect scopes", async ({ page }) => {
  await page.addInitScript(({ profile, pipelineId }) => {
    localStorage.setItem("editai_profiles", JSON.stringify([profile]));
    localStorage.setItem("editai_current_profile_id", profile.id);
    localStorage.setItem(
      `blipost.workspace.${profile.id}.pipeline.session`,
      JSON.stringify({ pipelineId, step: 3 }),
    );
  }, { profile: PROFILE, pipelineId: PIPELINE_ID });

  const layer = (id: string, preset: "static" | "fade" = "static") => ({
    id,
    assetId: `https://assets.test/${id}.png`,
    assetUrl: `https://assets.test/${id}.png`,
    mediaType: "image",
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
    zIndex: 1,
    fit: "contain",
    animation: {
      preset,
      enterMs: 250,
      exitMs: 200,
      delayMs: 0,
      intensity: 1,
    },
  });
  const timelines = {
    "0": {
      revision: 1,
      cues: [
        {
          id: "cue-zero",
          startMs: 1000,
          durationMs: 1800,
          layers: [layer("zero-a")],
          sfxVolumeDb: 0,
          zone: "behind",
          track: 2,
        },
        {
          id: "cue-zero-b",
          startMs: 4000,
          durationMs: 1800,
          layers: [layer("zero-b")],
          sfxVolumeDb: 0,
          zone: "behind",
          track: 3,
        },
      ],
    },
    "1": {
      revision: 1,
      cues: [{
        id: "cue-one",
        startMs: 4000,
        durationMs: 1800,
        layers: [layer("one-a", "fade")],
        sfxVolumeDb: 0,
        zone: "behind",
        track: 2,
      }],
    },
  };
  const saves: Array<{ key: string; body: Record<string, unknown> }> = [];
  await routeStep3(page, {
    attentionSelection: null,
    timelines,
    onTimelineSave: (key, body) => saves.push({ key, body }),
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const cue = page.locator('[data-cue-id="cue-zero"]').first();
  await expect(cue).toBeVisible();
  await cue.click();

  const timelineEffects = page.getByTestId("step3-timeline-effects");
  const scope = timelineEffects.getByRole("combobox", { name: "Timeline effect scope" });
  await expect(scope).toContainText("Selected image");
  const globalToggle = timelineEffects.getByRole("checkbox", { name: "Apply this effect to all images" });
  await expect(globalToggle).not.toBeChecked();

  await timelineEffects.getByRole("combobox", { name: "Entrance effect" }).click();
  await page.getByRole("option", { name: /^Fade / }).click();
  await expect.poll(() => {
    const latest = [...saves].reverse().find((save) => save.key === "0");
    const savedCues = latest?.body.cues as Array<{ layers: Array<{ animation: { preset: string } }> }> | undefined;
    return savedCues?.flatMap((savedCue) => (
      savedCue.layers.map((savedLayer) => savedLayer.animation.preset)
    ));
  }, { timeout: 10_000 }).toEqual(["fade", "static"]);

  const secondCue = page.locator('[data-cue-id="cue-zero-b"]').first();
  const firstCueBounds = await cue.boundingBox();
  const secondCueBounds = await secondCue.boundingBox();
  expect(firstCueBounds).not.toBeNull();
  expect(secondCueBounds).not.toBeNull();
  const marqueeLeft = Math.min(firstCueBounds!.x, secondCueBounds!.x) - 8;
  const marqueeTop = Math.min(firstCueBounds!.y, secondCueBounds!.y) - 2;
  const marqueeRight = Math.max(
    firstCueBounds!.x + firstCueBounds!.width,
    secondCueBounds!.x + secondCueBounds!.width,
  ) + 8;
  const marqueeBottom = Math.max(
    firstCueBounds!.y + firstCueBounds!.height,
    secondCueBounds!.y + secondCueBounds!.height,
  ) + 2;
  await page.mouse.move(marqueeLeft, marqueeTop);
  await page.mouse.down();
  await page.mouse.move(marqueeRight, marqueeBottom, { steps: 8 });
  await expect(page.getByTestId("attention-selection-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("attention-selection-marquee")).toBeHidden();
  await expect(cue).toHaveAttribute("aria-pressed", "true");
  await expect(secondCue).toHaveAttribute("aria-pressed", "true");
  await expect(scope).toContainText("Selected images · 2");
  await scope.scrollIntoViewIfNeeded();
  await expect(timelineEffects).toHaveScreenshot(
    "attention-effect-scope-inspector.png",
    {
      animations: "disabled",
    },
  );

  await timelineEffects.getByRole("combobox", { name: "Entrance effect" }).click();
  await page.getByRole("option", { name: /^Pop / }).click();

  await expect.poll(() => {
    const latest = [...saves].reverse().find((save) => save.key === "0");
    const savedCues = latest?.body.cues as Array<{ layers: Array<{ animation: { preset: string } }> }> | undefined;
    return savedCues?.flatMap((savedCue) => (
      savedCue.layers.map((savedLayer) => savedLayer.animation.preset)
    ));
  }, { timeout: 10_000 }).toEqual(["pop", "pop"]);

  await globalToggle.click();
  await expect(globalToggle).toBeChecked();
  await timelineEffects.getByRole("combobox", { name: "Entrance effect" }).click();
  await page.getByRole("option", { name: /^Tornado / }).click();

  await expect.poll(() => {
    const latestByKey = Object.fromEntries(saves.map((save) => [save.key, save.body]));
    return ["0", "1"].map((key) => {
      const savedCues = latestByKey[key]?.cues as Array<{ layers: Array<{ animation: { preset: string } }> }> | undefined;
      return savedCues?.every((savedCue) => (
        savedCue.layers.every((savedLayer) => savedLayer.animation.preset === "tornado")
      ));
    });
  }, { timeout: 10_000 }).toEqual([true, true]);

  await cue.click();
  await expect(globalToggle).toBeChecked();
});
