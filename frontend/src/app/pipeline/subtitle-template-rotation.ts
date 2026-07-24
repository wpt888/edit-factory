import type { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { PreviewCard, PreviewKey, StyleKey } from "./pipeline-types";

export interface SubtitleTemplateRotation {
  enabled: boolean;
  presetIds: string[];
}

// Portable sentinel persisted in rotation slots and explicit per-card picks.
// It is deliberately not a real preset ID: resolving it produces
// SubtitleSettings.enabled=false at the render boundary.
export const NO_SUBTITLES_PRESET_ID = "__none__";

export function isNoSubtitlesPreset(preset: UserSubtitlePreset | undefined): boolean {
  if (!preset) return false;
  if (preset.settings.enabled === false) return true;
  return ["none", "no subtitles", "off"].includes(preset.name.trim().toLocaleLowerCase());
}

export const EMPTY_SUBTITLE_TEMPLATE_ROTATION: SubtitleTemplateRotation = {
  enabled: false,
  presetIds: [],
};

// Explicit manual per-variant template picks, keyed by PreviewKey ("0", "0_A").
export type VariantTemplateSelections = Partial<Record<PreviewKey, string>>;

type SubtitleRotationCard = Pick<PreviewCard, "key" | "baseIndex" | "visualVersion"> & {
  /** Preview-only callers can point directly at one slot in the template. */
  rotationIndex?: number;
};

export type SubtitleAssignmentSource = "manual" | "rotation" | "default";

export type ResolvedSubtitleAssignment = {
  source: SubtitleAssignmentSource;
  presetId?: string;
  preset?: UserSubtitlePreset;
  disabled: boolean;
};

/**
 * Return the output ordinal consumed by subtitle rotation.
 *
 * Meta multiplication turns every script into two consecutive outputs, so
 * 0_A, 0_B, 1_A, 1_B must consume slots 0, 1, 2, 3. Using only baseIndex
 * would assign the same style to both Meta outputs and skip half the template.
 */
export function subtitleRotationIndexForCard(card: SubtitleRotationCard): number {
  if (card.rotationIndex != null) return card.rotationIndex;
  if (card.visualVersion === "A") return card.baseIndex * 2;
  if (card.visualVersion === "B") return card.baseIndex * 2 + 1;
  return card.baseIndex;
}

export function assignedSubtitlePreset(
  rotation: SubtitleTemplateRotation,
  presets: UserSubtitlePreset[],
  variantIndex: number,
): UserSubtitlePreset | undefined {
  if (!rotation.enabled || rotation.presetIds.length === 0 || variantIndex < 0) return undefined;
  const presetId = rotation.presetIds[variantIndex % rotation.presetIds.length];
  return presets.find((preset) => preset.id === presetId);
}

export function resolveSubtitleAssignmentForCard(
  rotation: SubtitleTemplateRotation,
  selections: VariantTemplateSelections,
  presets: UserSubtitlePreset[],
  card: SubtitleRotationCard,
): ResolvedSubtitleAssignment {
  const explicitId = selections?.[card.key];
  if (explicitId === NO_SUBTITLES_PRESET_ID) {
    return { source: "manual", presetId: explicitId, disabled: true };
  }
  const explicitPreset = explicitId
    ? presets.find((preset) => preset.id === explicitId)
    : undefined;
  if (explicitPreset) {
    return {
      source: "manual",
      presetId: explicitPreset.id,
      preset: explicitPreset,
      disabled: isNoSubtitlesPreset(explicitPreset),
    };
  }

  if (!rotation.enabled || rotation.presetIds.length === 0 || card.baseIndex < 0) {
    return { source: "default", disabled: false };
  }
  const rotationIndex = subtitleRotationIndexForCard(card) % rotation.presetIds.length;
  const rotatedId = rotation.presetIds[rotationIndex];
  if (rotatedId === NO_SUBTITLES_PRESET_ID) {
    return { source: "rotation", presetId: rotatedId, disabled: true };
  }
  const rotatedPreset = presets.find((preset) => preset.id === rotatedId);
  if (!rotatedPreset) return { source: "default", disabled: false };
  return {
    source: "rotation",
    presetId: rotatedPreset.id,
    preset: rotatedPreset,
    disabled: isNoSubtitlesPreset(rotatedPreset),
  };
}

export function subtitlesDisabledForCard(
  rotation: SubtitleTemplateRotation,
  selections: VariantTemplateSelections,
  presets: UserSubtitlePreset[],
  card: SubtitleRotationCard,
): boolean {
  return resolveSubtitleAssignmentForCard(rotation, selections, presets, card).disabled;
}

// Precedence: explicit per-variant selection > rotation round-robin > none.
// Unknown/deleted preset ids fall through gracefully.
export function resolveSubtitlePresetForCard(
  rotation: SubtitleTemplateRotation,
  selections: VariantTemplateSelections,
  presets: UserSubtitlePreset[],
  card: SubtitleRotationCard,
): UserSubtitlePreset | undefined {
  return resolveSubtitleAssignmentForCard(rotation, selections, presets, card).preset;
}

export function wordsPerSubtitleForVariant(
  rotation: SubtitleTemplateRotation,
  presets: UserSubtitlePreset[],
  variantIndex: number,
  fallback: number,
  selections?: VariantTemplateSelections,
  previewKey?: PreviewKey,
): number {
  const key = previewKey ?? (String(variantIndex) as PreviewKey);
  const visualVersion = key.endsWith("_B") ? "B" : key.endsWith("_A") ? "A" : undefined;
  const card = { key, baseIndex: variantIndex, visualVersion };
  const preset = resolveSubtitlePresetForCard(rotation, selections ?? {}, presets, card);
  return Math.max(1, Math.min(20, preset?.wordsPerSubtitle ?? fallback));
}

export function subtitleSettingsDiff(
  base: SubtitleSettings,
  effective: SubtitleSettings,
): Partial<SubtitleSettings> {
  return Object.fromEntries(
    (Object.keys(effective) as Array<keyof SubtitleSettings>)
      .filter((key) => effective[key] !== base[key])
      .map((key) => [key, effective[key]]),
  ) as Partial<SubtitleSettings>;
}

export function resolveRotatedSubtitleSettings({
  card,
  rotation,
  selections,
  presets,
  defaultSettings,
  metaOverrides,
  variantOverrides,
  metaFallback,
}: {
  card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">;
  rotation: SubtitleTemplateRotation;
  selections?: VariantTemplateSelections;
  presets: UserSubtitlePreset[];
  defaultSettings: SubtitleSettings;
  metaOverrides: Partial<Record<StyleKey, SubtitleSettings>>;
  variantOverrides: Partial<Record<PreviewKey, Partial<SubtitleSettings>>>;
  metaFallback?: Partial<Record<string, Partial<SubtitleSettings>>>;
}): SubtitleSettings {
  if (subtitlesDisabledForCard(rotation, selections ?? {}, presets, card)) {
    return { ...defaultSettings, enabled: false };
  }

  const preset = resolveSubtitlePresetForCard(rotation, selections ?? {}, presets, card);
  const styleKey: StyleKey = card.visualVersion === "A" || card.visualVersion === "B"
    ? card.visualVersion
    : "default";
  const metaOverride = metaOverrides[styleKey];
  const variantOverride = variantOverrides[card.key];

  // A selected template owns the complete visual baseline, including colors.
  // Multi-variant templates may also carry a dedicated A/B look. Falling back
  // to the platform Meta style after resolving a template would overwrite its
  // text/highlight/outline colors while leaving font and sizing intact.
  const presetSettings = preset
    ? (
        card.visualVersion === "A"
          ? preset.settingsA ?? preset.settings
          : card.visualVersion === "B"
            ? preset.settingsB ?? preset.settings
            : preset.settings
      )
    : undefined;
  let effective = { ...defaultSettings, ...(presetSettings ?? {}) };
  if (preset?.wordsPerSubtitle != null) {
    effective.wordsPerSubtitle = Math.max(
      1,
      Math.min(20, preset.wordsPerSubtitle),
    );
  }
  if (metaOverride && Object.keys(metaOverride).length > 0) {
    // Legacy A/B overrides can contain the complete editor value. Applying
    // that object wholesale would erase the selected template. Only fields
    // that differ from the pipeline default are platform adjustments.
    const metaDelta = subtitleSettingsDiff(defaultSettings, metaOverride);
    effective = { ...effective, ...metaDelta };
  } else if (!preset && card.visualVersion && metaFallback?.[card.visualVersion]) {
    effective = { ...effective, ...metaFallback[card.visualVersion] };
  }
  if (variantOverride && Object.keys(variantOverride).length > 0) {
    effective = { ...effective, ...variantOverride };
  }
  return effective;
}
