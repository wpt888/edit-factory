import { expect, test } from "@playwright/test";
import {
  assignedSubtitlePreset,
  NO_SUBTITLES_PRESET_ID,
  resolveRotatedSubtitleSettings,
  resolveSubtitleAssignmentForCard,
  resolveSubtitlePresetForCard,
  subtitlesDisabledForCard,
  subtitleSettingsDiff,
  wordsPerSubtitleForVariant,
} from "../src/app/pipeline/subtitle-template-rotation";
import type { UserSubtitlePreset } from "../src/types/video-processing";

const PIPELINE_ID = "subtitle-rotation-pipeline";
const PROFILE = {
  id: "subtitle-rotation-profile",
  name: "Subtitle Rotation QA",
  is_default: true,
  created_at: "2026-07-20T00:00:00Z",
};

const settings = {
  fontSize: 48,
  fontFamily: "Montserrat",
  textColor: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 3,
  positionY: 85,
};

const presets: UserSubtitlePreset[] = [
  { id: "one", name: "One", created_at: "", settings, wordsPerSubtitle: 2 },
  { id: "two", name: "Two", created_at: "", settings, wordsPerSubtitle: 3 },
  { id: "three", name: "Three", created_at: "", settings, wordsPerSubtitle: 4 },
  { id: "four", name: "Four", created_at: "", settings, wordsPerSubtitle: 2 },
];

test("subtitle template rotation assigns i modulo N and leaves excess templates unused", () => {
  const rotation = { enabled: true, presetIds: presets.map((preset) => preset.id) };
  expect(Array.from({ length: 10 }, (_, index) => assignedSubtitlePreset(rotation, presets, index)?.id)).toEqual([
    "one", "two", "three", "four", "one", "two", "three", "four", "one", "two",
  ]);
  expect(Array.from({ length: 2 }, (_, index) => assignedSubtitlePreset(rotation, presets, index)?.id)).toEqual([
    "one", "two",
  ]);
});

test("words per subtitle follows the assigned template", () => {
  const rotation = { enabled: true, presetIds: ["one", "two", "three"] };
  expect(Array.from({ length: 6 }, (_, index) => wordsPerSubtitleForVariant(rotation, presets, index, 5))).toEqual([
    2, 3, 4, 2, 3, 4,
  ]);
});

test("Meta outputs consume every template style in card order and then repeat", () => {
  const rotation = { enabled: true, presetIds: ["one", "two", "three", "four"] };
  const cards = [0, 1, 2, 3].flatMap((baseIndex) => ([
    { key: `${baseIndex}_A`, baseIndex, visualVersion: "A" },
    { key: `${baseIndex}_B`, baseIndex, visualVersion: "B" },
  ]));

  expect(cards.map((card) => resolveSubtitlePresetForCard(rotation, {}, presets, card)?.id)).toEqual([
    "one", "two", "three", "four", "one", "two", "three", "four",
  ]);
});

test("a preset named none disables subtitles even when legacy settings omit enabled", () => {
  const nonePreset: UserSubtitlePreset = {
    id: "legacy-none",
    name: "none",
    created_at: "",
    settings,
  };
  const resolved = resolveRotatedSubtitleSettings({
    card: { key: "0", baseIndex: 0 },
    rotation: { enabled: true, presetIds: [nonePreset.id] },
    presets: [nonePreset],
    defaultSettings: settings,
    metaOverrides: {},
    variantOverrides: {},
  });
  expect(resolved.enabled).toBe(false);
});

test("variant override stores only its delta and keeps following template edits", () => {
  const card = { key: "0_A", baseIndex: 0, visualVersion: "A" };
  const rotation = { enabled: true, presetIds: ["one"] };
  const initial = resolveRotatedSubtitleSettings({
    card,
    rotation,
    presets,
    defaultSettings: settings,
    metaOverrides: { A: { ...settings, outlineWidth: 5 } },
    variantOverrides: {},
  });
  const delta = subtitleSettingsDiff(initial, { ...initial, textColor: "#a3e635" });
  expect(delta).toEqual({ textColor: "#a3e635" });

  const editedPresets = presets.map((preset) => (
    preset.id === "one" ? { ...preset, settings: { ...preset.settings, fontSize: 72 } } : preset
  ));
  expect(resolveRotatedSubtitleSettings({
    card,
    rotation,
    presets: editedPresets,
    defaultSettings: settings,
    metaOverrides: {},
    variantOverrides: { "0_A": delta },
  })).toMatchObject({ fontSize: 72, textColor: "#a3e635" });
});

test("assignment reports the source and a legacy full Meta override preserves the template", () => {
  const card = { key: "0_A", baseIndex: 0, visualVersion: "A" };
  const rotation = { enabled: true, presetIds: ["one"] };

  expect(resolveSubtitleAssignmentForCard(rotation, {}, presets, card)).toMatchObject({
    source: "rotation",
    presetId: "one",
    disabled: false,
  });
  expect(resolveSubtitleAssignmentForCard(rotation, { "0_A": "two" }, presets, card)).toMatchObject({
    source: "manual",
    presetId: "two",
    disabled: false,
  });

  const templatePresets = presets.map((preset) => (
    preset.id === "one"
      ? { ...preset, settings: { ...preset.settings, fontSize: 72, textColor: "#f59e0b" } }
      : preset
  ));
  expect(resolveRotatedSubtitleSettings({
    card,
    rotation,
    presets: templatePresets,
    defaultSettings: settings,
    metaOverrides: { A: { ...settings, outlineWidth: 7 } },
    variantOverrides: {},
  })).toMatchObject({ fontSize: 72, textColor: "#f59e0b", outlineWidth: 7 });
});

test("template colors stay authoritative over automatic Meta fallback colors", () => {
  const templatePreset: UserSubtitlePreset = {
    id: "brand-style",
    name: "Brand style",
    created_at: "",
    settings: {
      ...settings,
      textColor: "#f59e0b",
      outlineColor: "#111827",
      highlightColor: "#a3e635",
      highlightBgColor: "#312e81",
    },
  };

  const resolved = resolveRotatedSubtitleSettings({
    card: { key: "0_A", baseIndex: 0, visualVersion: "A" },
    rotation: { enabled: true, presetIds: [templatePreset.id] },
    presets: [templatePreset],
    defaultSettings: settings,
    metaOverrides: {},
    variantOverrides: {},
    metaFallback: {
      A: {
        textColor: "#ff0000",
        outlineColor: "#ffffff",
        highlightColor: "#0000ff",
        highlightBgColor: "#00ff00",
      },
    },
  });

  expect(resolved).toMatchObject({
    textColor: "#f59e0b",
    outlineColor: "#111827",
    highlightColor: "#a3e635",
    highlightBgColor: "#312e81",
  });
});

test("multi-variant template styles use their saved A and B settings", () => {
  const templatePreset: UserSubtitlePreset = {
    id: "platform-style",
    name: "Platform style",
    created_at: "",
    settings: { ...settings, textColor: "#ffffff" },
    settingsA: { ...settings, textColor: "#fb7185", outlineColor: "#4c0519" },
    settingsB: { ...settings, textColor: "#38bdf8", outlineColor: "#082f49" },
  };
  const shared = {
    rotation: { enabled: true, presetIds: [templatePreset.id] },
    presets: [templatePreset],
    defaultSettings: settings,
    metaOverrides: {},
    variantOverrides: {},
  };

  expect(resolveRotatedSubtitleSettings({
    ...shared,
    card: { key: "0_A", baseIndex: 0, visualVersion: "A" },
  })).toMatchObject({ textColor: "#fb7185", outlineColor: "#4c0519" });
  expect(resolveRotatedSubtitleSettings({
    ...shared,
    card: { key: "0_B", baseIndex: 0, visualVersion: "B" },
  })).toMatchObject({ textColor: "#38bdf8", outlineColor: "#082f49" });
});

test("Step 3 edits selected template styles inline", async ({ page }) => {
  const visualPresets: UserSubtitlePreset[] = [
    {
      id: "punchy",
      name: "Punchy Karaoke",
      templateId: "launch-captions",
      templateName: "Launch captions",
      created_at: "",
      settings: { ...settings, fontSize: 56, textColor: "#ffffff", karaoke: true, highlightColor: "#a3e635" },
      wordsPerSubtitle: 2,
    },
    {
      id: "minimal",
      name: "Minimal Clean",
      templateId: "launch-captions",
      templateName: "Launch captions",
      created_at: "",
      settings: {
        ...settings,
        fontSize: 72,
        textColor: "#f59e0b",
        outlineColor: "#111827",
        outlineWidth: 6,
        positionY: 68,
        karaoke: false,
      },
      wordsPerSubtitle: 4,
    },
    {
      id: "editorial",
      name: "Editorial Blue",
      templateId: "launch-captions",
      templateName: "Launch captions",
      created_at: "",
      settings: { ...settings, fontSize: 88, textColor: "#60a5fa", karaoke: false },
      wordsPerSubtitle: 3,
    },
  ];
  const subtitlePersistenceWrites: string[] = [];
  const rotationWrites: Array<Record<string, unknown>> = [];
  const templateWrites: Array<{ name: string; styles: UserSubtitlePreset[] }> = [];
  const preview = (index: number) => ({
    audio_duration: 6,
    srt_content: "1\n00:00:00,000 --> 00:00:03,000\nOne two three four\n\n2\n00:00:03,000 --> 00:00:06,000\nFive six seven eight",
    matches: [
      {
        srt_index: 0,
        srt_text: "One two three four",
        srt_start: 0,
        srt_end: 3,
        segment_id: `segment-${index}`,
        segment_keywords: ["demo"],
        matched_keyword: "demo",
        confidence: 1,
        source_video_id: "source-a",
        segment_start_time: 0,
        segment_end_time: 6,
        merge_group: 0,
        merge_group_duration: 6,
      },
    ],
    total_phrases: 2,
    matched_count: 1,
    unmatched_count: 0,
    available_segments: [],
    intro_offset_sec: 0,
    intro_segments: [],
    video_timeline: [
      {
        id: `body-${index}`,
        kind: "body",
        segment_id: `segment-${index}`,
        segment_keywords: ["demo"],
        source_video_id: "source-a",
        start_time: 0,
        end_time: 6,
        timeline_start: 0,
        timeline_duration: 6,
      },
    ],
  });

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
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-presets`)) {
      await route.fulfill({ json: { presets: visualPresets } });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-templates/launch-captions`)) {
      const body = request.postDataJSON() as {
        name: string;
        styles: UserSubtitlePreset[];
      };
      templateWrites.push(body);
      await route.fulfill({
        json: {
          id: "launch-captions",
          name: body.name,
          created_at: "",
          styles: body.styles.map((style) => ({
            ...style,
            id: style.id.startsWith("new-") ? "created-style" : style.id,
            created_at: style.created_at ?? "",
          })),
        },
      });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-settings`)) {
      if (request.method() !== "GET") subtitlePersistenceWrites.push(`${request.method()} ${path}`);
      await route.fulfill({ json: settings });
      return;
    }
    if (path.endsWith(`/profiles/${PROFILE.id}`)) {
      await route.fulfill({ json: { ...PROFILE, tts_settings: {} } });
      return;
    }
    if (path.endsWith("/profiles/") || path.endsWith("/profiles")) {
      await route.fulfill({ json: [PROFILE] });
      return;
    }
    if (path.endsWith(`/pipeline/scripts/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        scripts: ["Variant one", "Variant two", "Variant three", "Variant four"],
        script_names: ["Variant 1", "Variant 2", "Variant 3", "Variant 4"],
        context_products: [],
        preview_info: {
          "0": { has_audio: true, audio_duration: 6, has_srt: true },
          "1": { has_audio: true, audio_duration: 6, has_srt: true },
          "2": { has_audio: true, audio_duration: 6, has_srt: true },
          "3": { has_audio: true, audio_duration: 6, has_srt: true },
        },
        tts_info: {},
        captions: {},
        selected_captions: {},
        name: "Rotation QA",
        idea: "Rotation QA",
        provider: "gemini",
        variant_count: 4,
        meta_multiplication: false,
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: {
        previews: { "0": preview(0), "1": preview(1), "2": preview(2), "3": preview(3) },
        available_segments: [],
      } });
      return;
    }
    if (path.includes(`/pipeline/preview/${PIPELINE_ID}/`)) {
      const variantIndex = Number(path.split("/").at(-1));
      await route.fulfill({ json: preview(variantIndex) });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/subtitle-rotation`)) {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as Record<string, unknown>;
        rotationWrites.push(body);
        const expectedRevision = Number(body.expected_revision);
        await route.fulfill({
          json: {
            ...body,
            revision: Number.isInteger(expectedRevision) ? expectedRevision + 1 : 1,
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          enabled: true,
          presetIds: ["punchy", "minimal", "editorial"],
          variantTemplates: { "3": "minimal" },
        },
      });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/template-settings`) && request.method() === "PUT") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const expectedRevision = Number(body.expected_revision);
      await route.fulfill({
        json: {
          status: "saved",
          revision: Number.isInteger(expectedRevision) ? expectedRevision + 1 : 1,
        },
      });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/subtitle-overrides`)) {
      await route.fulfill({ json: { overrides: {} } });
      return;
    }
    if (path.includes(`/pipeline/${PIPELINE_ID}/attention-timeline/`)) {
      await route.fulfill({ json: { revision: 0, cues: [] } });
      return;
    }
    if (path.endsWith(`/pipeline/status/${PIPELINE_ID}`)) {
      await route.fulfill({ json: {
        pipeline_id: PIPELINE_ID,
        provider: "gemini",
        variant_count: 4,
        variants: [0, 1, 2, 3].map((variant_index) => ({ variant_index, status: "not_started", progress: 0, current_step: "" })),
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
    if (path.includes(`/pipeline/subtitle-frame-preview/${PIPELINE_ID}/`)) {
      // Exercise the browser-rendered fallback so the visual snapshot proves
      // the resolved settings without depending on FFmpeg in this UI test.
      await route.fulfill({ status: 503, body: "Preview renderer unavailable in test" });
      return;
    }
    if (path.endsWith("/segments/source-videos")) {
      await route.fulfill({ json: [{ id: "source-a", name: "Source A", duration: 10, segments_count: 3, status: "ready" }] });
      return;
    }
    if (path.endsWith("/tts-library/") || path.endsWith("/tts/voices") || path.endsWith("/subtitle-presets")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (path.endsWith("/pipeline/segment-duration")) {
      await route.fulfill({ json: { total_segment_duration: 18 } });
      return;
    }
    if (path.endsWith("/ai-instructions")) {
      await route.fulfill({ json: { ai_instructions: "" } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.setViewportSize({ width: 2048, height: 1100 });
  await page.goto(`/pipeline?step=3&id=${PIPELINE_ID}&desktopAuth=confirmed`);

  const rotationPanel = page.getByTestId("subtitle-template-rotation");
  const attentionCard = page.getByTestId("step3-attention-apply");
  await expect(rotationPanel).toBeVisible();
  await expect(rotationPanel.getByRole("switch", { name: "Enable subtitle template rotation" })).toBeChecked();
  await expect(attentionCard.getByText("Subtitle templates", { exact: true })).toHaveCount(0);
  const templateSelect = page.getByRole("combobox", { name: "Subtitle template", exact: true });
  await expect(templateSelect).toHaveText("Launch captions · 3 styles");
  const variantCanvas = page.getByTestId("step3-variant-canvas");
  await expect(page.getByTestId("variant-template-assignments")).toHaveCount(0);
  await expect(rotationPanel.getByRole("combobox")).toHaveCount(0);
  await expect(rotationPanel.getByTestId("subtitle-rotation-row")).toHaveText([
    /1Punchy Karaoke2w/,
    /2Minimal Clean4w/,
    /3Editorial Blue3w/,
  ]);
  await expect(rotationPanel.getByRole("button", { name: "Add style" })).toBeVisible();
  await expect(rotationPanel.getByRole("button", { name: "Edit Punchy Karaoke" })).toBeVisible();
  await expect(rotationPanel.getByRole("button", { name: "Delete Punchy Karaoke" })).toBeVisible();
  await expect(page.getByTestId("subtitle-template-controls")).toHaveScreenshot(
    "subtitle-template-inline-style-controls.png",
    { animations: "disabled", maxDiffPixelRatio: 0.001 },
  );
  await expect(variantCanvas.getByTestId("subtitle-assignment-badge")).toHaveText([
    "Punchy Karaoke · Rotation",
    "Minimal Clean · Rotation",
    "Editorial Blue · Rotation",
    "Minimal Clean · Manual",
  ]);

  const legacyAssignments = page.getByTestId("subtitle-legacy-assignments");
  await expect(legacyAssignments).toContainText("1 legacy assignment takes precedence");
  const writeCountBeforeLegacyReset = rotationWrites.length;
  await legacyAssignments.getByRole("button", { name: "Use template for all outputs" }).click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect.poll(() => rotationWrites.length).toBe(writeCountBeforeLegacyReset + 1);
  expect(rotationWrites.at(-1)).toMatchObject({
    enabled: true,
    presetIds: ["punchy", "minimal", "editorial"],
    variantTemplates: {},
  });
  await expect(legacyAssignments).toHaveCount(0);
  await expect(variantCanvas.getByTestId("subtitle-assignment-badge")).toHaveText([
    "Punchy Karaoke · Rotation",
    "Minimal Clean · Rotation",
    "Editorial Blue · Rotation",
    "Punchy Karaoke · Rotation",
  ]);

  const previewPanel = page.getByTestId("subtitle-style-preview-panel");
  const previewOutput = page.getByRole("combobox", { name: "Preview output" });
  await expect(previewOutput).toContainText("Variant 1 · Punchy Karaoke");
  await expect(previewPanel.getByTestId("subtitle-current-assignment")).toHaveText("Punchy Karaoke · Template rotation");
  await expect(page.getByRole("combobox", { name: "Subtitle style to apply" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Subtitle apply scope" })).toHaveCount(0);
  await expect(previewPanel.getByTestId("subtitle-preview-state")).toHaveCount(0);
  await expect(previewPanel).not.toContainText("Accurate preview");

  await previewOutput.click();
  await page.getByRole("option", { name: "Variant 2 · Minimal Clean", exact: true }).click();
  await expect(previewPanel.getByTestId("subtitle-current-assignment")).toHaveText("Minimal Clean · Template rotation");
  await expect(previewPanel).not.toContainText(/Font: \d+px \| Outline: \d+px \| Y: \d+%/);
  expect(subtitlePersistenceWrites).toEqual([]);

  await page.getByTitle("Override subtitles for Variant 1").click();
  const overrideDialog = page.getByTestId("variant-subtitle-override-dialog");
  await expect(overrideDialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(overrideDialog).not.toBeVisible();

  const rotationSwitch = rotationPanel.getByRole("switch", { name: "Enable subtitle template rotation" });
  await rotationSwitch.click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect(rotationSwitch).not.toBeChecked();
  await expect(rotationPanel.getByTestId("subtitle-rotation-row")).toHaveCount(3);
  await expect(rotationPanel.getByTestId("subtitle-rotation-summary")).toHaveText("3 styles ready · off");
  await expect(templateSelect).toHaveText("Launch captions · 3 styles");
  await expect(rotationPanel.getByRole("button", { name: "Add style" })).toBeVisible();
  await expect(rotationPanel.getByRole("button", { name: "Edit Punchy Karaoke" })).toBeVisible();
  await expect(rotationPanel.getByRole("button", { name: "Delete Punchy Karaoke" })).toBeVisible();

  const writeCountBeforeRotationEnable = rotationWrites.length;
  await rotationSwitch.click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect.poll(() => rotationWrites.length).toBe(writeCountBeforeRotationEnable + 1);
  expect(rotationWrites.at(-1)).toMatchObject({
    enabled: true,
    presetIds: ["punchy", "minimal", "editorial"],
    variantTemplates: {},
  });
  await expect(templateSelect).toHaveText("Launch captions · 3 styles");
  await expect(rotationSwitch).toBeChecked();
  await expect(variantCanvas.getByTestId("subtitle-assignment-badge")).toHaveText([
    "Punchy Karaoke · Rotation",
    "Minimal Clean · Rotation",
    "Editorial Blue · Rotation",
    "Punchy Karaoke · Rotation",
  ]);
  await expect(page.getByTestId("step3-variant-canvas").getByTestId("preview-subtitle")).toHaveCount(4);
  await expect(rotationPanel.getByRole("combobox")).toHaveCount(0);

  await rotationPanel.getByRole("button", { name: "Add style" }).click();
  const styleDialog = page.getByRole("dialog", { name: "Add subtitle style" });
  await expect(styleDialog).toBeVisible();
  await styleDialog.getByLabel("Style name").fill("Fresh captions");
  await styleDialog.getByLabel("Words per subtitle").fill("5");
  await styleDialog.getByRole("button", { name: "Save style" }).click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect(rotationPanel.getByTestId("subtitle-rotation-row")).toHaveCount(4);
  await expect(rotationPanel.getByTestId("subtitle-rotation-row").last()).toContainText("Fresh captions");
  expect(templateWrites.at(-1)?.styles).toHaveLength(4);
  expect(rotationWrites.at(-1)).toMatchObject({
    presetIds: ["punchy", "minimal", "editorial", "created-style"],
  });

  await rotationPanel.getByRole("button", { name: "Edit Fresh captions" }).click();
  await page.getByRole("dialog", { name: "Edit subtitle style" }).getByLabel("Style name").fill("Fresh edited");
  await page.getByRole("dialog", { name: "Edit subtitle style" }).getByRole("button", { name: "Save style" }).click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect(rotationPanel.getByTestId("subtitle-rotation-row").last()).toContainText("Fresh edited");

  await rotationPanel.getByRole("button", { name: "Delete Fresh edited" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete subtitle style?");
  await page.getByRole("button", { name: "Delete style", exact: true }).click();
  await page.getByRole("button", { name: "Update 4 outputs", exact: true }).click();
  await expect(rotationPanel.getByTestId("subtitle-rotation-row")).toHaveCount(3);
  expect(templateWrites.at(-1)?.styles).toHaveLength(3);

  const subtitleSettingsSections = page.getByTestId("subtitle-settings-sections");
  await subtitleSettingsSections.getByRole("button", { name: /^Subtitle templates/ }).click();
  await subtitleSettingsSections.getByRole("button", { name: /^Subtitle style/ }).click();
  await page.getByTestId("step3-preview-timing").getByRole("button", { name: /^Preview Timing/ }).click();
  await page.getByTestId("step3-safe-zone-settings").getByRole("button", { name: /^Safe Zone/ }).click();
  await attentionCard.getByRole("button", { name: /^Content templates/ }).click();
  const resourceTabs = page.getByRole("tablist", { name: "Preview resource panels" });
  await resourceTabs.getByRole("tab", { name: /^Sources/ }).click();
  await expect(page.getByTestId("step3-source-inventory")).toBeVisible();
  await resourceTabs.getByRole("tab", { name: /^Content Templates/ }).click();
  await expect(page.getByTestId("subtitle-template-controls")).toBeHidden();
  await expect(page.getByTestId("subtitle-style-variant-editor")).toBeHidden();
  await expect(page.getByTestId("step3-preview-timing").getByText("Pacing", { exact: true })).toBeHidden();
  await expect(attentionCard.getByTestId("attention-template-picker")).toBeHidden();
  await expect(page.getByTestId("step3-source-inventory")).toBeHidden();
  await expect(subtitleSettingsSections.getByRole("button", { name: /^Variant templates/ })).toHaveCount(0);
});

test("a None rotation slot disables only its assigned variant", () => {
  const rotation = { enabled: true, presetIds: ["one", "two", NO_SUBTITLES_PRESET_ID] };
  const cards = [0, 1, 2].map((baseIndex) => ({ key: String(baseIndex), baseIndex }));

  expect(cards.map((card) => subtitlesDisabledForCard(rotation, {}, presets, card))).toEqual([
    false, false, true,
  ]);
  expect(resolveRotatedSubtitleSettings({
    card: { ...cards[2], visualVersion: undefined },
    rotation,
    presets,
    defaultSettings: settings,
    metaOverrides: {},
    variantOverrides: {},
  }).enabled).toBe(false);
});
