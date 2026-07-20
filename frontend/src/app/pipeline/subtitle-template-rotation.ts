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

// Explicit manual per-variant template picks, keyed by PreviewKey ("0", "0_A").
export type VariantTemplateSelections = Partial<Record<PreviewKey, string>>;

export function assignedSubtitlePreset(
  rotation: SubtitleTemplateRotation,
  presets: UserSubtitlePreset[],
  variantIndex: number,
): UserSubtitlePreset | undefined {
  if (!rotation.enabled || rotation.presetIds.length === 0 || variantIndex < 0) return undefined;
  const presetId = rotation.presetIds[variantIndex % rotation.presetIds.length];
  return presets.find((preset) => preset.id === presetId);
}

// Precedence: explicit per-variant selection > rotation round-robin > none.
// Unknown/deleted preset ids fall through gracefully.
export function resolveSubtitlePresetForCard(
  rotation: SubtitleTemplateRotation,
  selections: VariantTemplateSelections,
  presets: UserSubtitlePreset[],
  card: Pick<PreviewCard, "key" | "baseIndex">,
): UserSubtitlePreset | undefined {
  const explicitId = selections?.[card.key];
  if (explicitId) {
    const found = presets.find((preset) => preset.id === explicitId);
    if (found) return found;
  }
  return assignedSubtitlePreset(rotation, presets, card.baseIndex);
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
  const card = { key, baseIndex: variantIndex };
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
  const preset = resolveSubtitlePresetForCard(rotation, selections ?? {}, presets, card);
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
