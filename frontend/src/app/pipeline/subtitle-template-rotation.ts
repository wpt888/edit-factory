import type { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { PreviewCard, PreviewKey, StyleKey } from "./pipeline-types";

export interface SubtitleTemplateRotation {
  enabled: boolean;
  presetIds: string[];
}

export const EMPTY_SUBTITLE_TEMPLATE_ROTATION: SubtitleTemplateRotation = {
  enabled: false,
  presetIds: [],
};

export function assignedSubtitlePreset(
  rotation: SubtitleTemplateRotation,
  presets: UserSubtitlePreset[],
  variantIndex: number,
): UserSubtitlePreset | undefined {
  if (!rotation.enabled || rotation.presetIds.length === 0 || variantIndex < 0) return undefined;
  const presetId = rotation.presetIds[variantIndex % rotation.presetIds.length];
  return presets.find((preset) => preset.id === presetId);
}

export function wordsPerSubtitleForVariant(
  rotation: SubtitleTemplateRotation,
  presets: UserSubtitlePreset[],
  variantIndex: number,
  fallback: number,
): number {
  const preset = assignedSubtitlePreset(rotation, presets, variantIndex);
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
  presets,
  defaultSettings,
  metaOverrides,
  variantOverrides,
  metaFallback,
}: {
  card: Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">;
  rotation: SubtitleTemplateRotation;
  presets: UserSubtitlePreset[];
  defaultSettings: SubtitleSettings;
  metaOverrides: Partial<Record<StyleKey, SubtitleSettings>>;
  variantOverrides: Partial<Record<PreviewKey, Partial<SubtitleSettings>>>;
  metaFallback?: Partial<Record<string, Partial<SubtitleSettings>>>;
}): SubtitleSettings {
  const preset = assignedSubtitlePreset(rotation, presets, card.baseIndex);
  const styleKey: StyleKey = card.visualVersion === "A" || card.visualVersion === "B"
    ? card.visualVersion
    : "default";
  const metaOverride = metaOverrides[styleKey];
  const variantOverride = variantOverrides[card.key];

  // Rotation chooses the base. Meta A/B stays orthogonal and layers on top;
  // a card-local edit is last and never mutates the reusable template.
  let effective = { ...defaultSettings, ...(preset?.settings ?? {}) };
  if (metaOverride && Object.keys(metaOverride).length > 0) {
    effective = { ...effective, ...metaOverride };
  } else if (card.visualVersion && metaFallback?.[card.visualVersion]) {
    effective = { ...effective, ...metaFallback[card.visualVersion] };
  }
  if (variantOverride && Object.keys(variantOverride).length > 0) {
    effective = { ...effective, ...variantOverride };
  }
  return effective;
}
