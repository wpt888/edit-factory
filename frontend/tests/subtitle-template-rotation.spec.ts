import { expect, test } from "@playwright/test";
import {
  assignedSubtitlePreset,
  NO_SUBTITLES_PRESET_ID,
  resolveRotatedSubtitleSettings,
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

test("Step 3 shows rotation controls and assigned template badges", async ({ page }) => {
  const visualPresets: UserSubtitlePreset[] = [
    {
      id: "punchy",
      name: "Punchy Karaoke",
      templateId: "launch-captions",
      templateName: "Launch captions",
      created_at: "",
      settings: { ...settings, textColor: "#ffffff", karaoke: true, highlightColor: "#a3e635" },
      wordsPerSubtitle: 2,
    },
    {
      id: "minimal",
      name: "Minimal Clean",
      templateId: "launch-captions",
      templateName: "Launch captions",
      created_at: "",
      settings: { ...settings, fontSize: 42, textColor: "#f8fafc", karaoke: false },
      wordsPerSubtitle: 4,
    },
  ];
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
    if (path.endsWith(`/profiles/${PROFILE.id}/subtitle-settings`)) {
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
        scripts: ["Variant one", "Variant two", "Variant three"],
        script_names: ["Variant 1", "Variant 2", "Variant 3"],
        context_products: [],
        preview_info: {
          "0": { has_audio: true, audio_duration: 6, has_srt: true },
          "1": { has_audio: true, audio_duration: 6, has_srt: true },
          "2": { has_audio: true, audio_duration: 6, has_srt: true },
        },
        tts_info: {},
        captions: {},
        selected_captions: {},
        name: "Rotation QA",
        idea: "Rotation QA",
        provider: "gemini",
        variant_count: 3,
        meta_multiplication: false,
        generation_job: {},
        tts_jobs: {},
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/restore-previews`)) {
      await route.fulfill({ json: {
        previews: { "0": preview(0), "1": preview(1), "2": preview(2) },
        available_segments: [],
      } });
      return;
    }
    if (path.endsWith(`/pipeline/${PIPELINE_ID}/subtitle-rotation`)) {
      await route.fulfill({ json: { enabled: true, presetIds: ["punchy", "minimal"] } });
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
        variant_count: 3,
        variants: [0, 1, 2].map((variant_index) => ({ variant_index, status: "not_started", progress: 0, current_step: "" })),
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
  await expect(rotationPanel).toBeVisible();
  await expect(rotationPanel.getByRole("switch", { name: "Enable subtitle template rotation" })).toBeChecked();
  await expect(rotationPanel.getByRole("combobox", { name: "Use subtitle template" })).toContainText("Launch captions");
  await expect(page.getByTestId("subtitle-template-select")).toHaveText([
    "Auto (Punchy Karaoke)",
    "Auto (Minimal Clean)",
    "Auto (Punchy Karaoke)",
  ]);

  await page.getByTitle("Override subtitles for Variant 1").click();
  const overrideDialog = page.getByTestId("variant-subtitle-override-dialog");
  await expect(overrideDialog).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(overrideDialog).not.toBeVisible();
  await page.screenshot({
    path: "screenshots/subtitle-template-rotation-step3.png",
    fullPage: false,
  });
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
