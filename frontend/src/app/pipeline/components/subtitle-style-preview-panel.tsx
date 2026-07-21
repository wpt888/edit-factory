"use client";

import { useMemo, useState } from "react";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { InspectorField } from "@/components/ui/inspector";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { StyleKey, PreviewCard } from "../pipeline-types";
import type { SubtitleTemplateRotation, VariantTemplateSelections } from "../subtitle-template-rotation";
import {
  NO_SUBTITLES_PRESET_ID,
  resolveSubtitlePresetForCard,
  subtitlesDisabledForCard,
} from "../subtitle-template-rotation";

type PreviewCardTarget = Pick<PreviewCard, "key" | "baseIndex" | "visualVersion">;

type PreviewTarget =
  | {
      id: `style:${StyleKey}`;
      kind: "style";
      label: string;
      styleKey: StyleKey;
    }
  | {
      id: string;
      kind: "rotation" | "variant";
      label: string;
      card: PreviewCardTarget;
    };

const STYLE_TARGETS: PreviewTarget[] = [
  { id: "style:default", kind: "style", label: "Default", styleKey: "default" },
  { id: "style:A", kind: "style", label: "A · Instagram", styleKey: "A" },
  { id: "style:B", kind: "style", label: "B · Facebook", styleKey: "B" },
];

/**
 * Preview-only subtitle target picker for Step 3. Base styles use the legacy
 * A/B/default path; rotation entries and real variant cards are resolved by
 * the same callback used by the timeline and final preview player.
 */
export function SubtitleStylePreviewPanel({
  activeStyleKey,
  getSubtitleSettingsFor,
  getPreviewSubtitleSettingsFor,
  hasStyleOverride,
  getStylePreviewText,
  pipelineId,
  previewCards,
  subtitleRotation,
  userSubtitlePresets,
  variantTemplateSelections,
}: {
  activeStyleKey: StyleKey;
  getSubtitleSettingsFor: (styleKey: StyleKey) => SubtitleSettings;
  getPreviewSubtitleSettingsFor: (card: PreviewCardTarget) => SubtitleSettings;
  hasStyleOverride: (styleKey: StyleKey) => boolean;
  getStylePreviewText: (styleKey: StyleKey) => string | undefined;
  pipelineId: string | undefined;
  previewCards: PreviewCard[];
  subtitleRotation: SubtitleTemplateRotation;
  userSubtitlePresets: UserSubtitlePreset[];
  variantTemplateSelections: VariantTemplateSelections;
}) {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  const rotationTargets = useMemo<PreviewTarget[]>(() => {
    if (!subtitleRotation.enabled) return [];

    return subtitleRotation.presetIds.flatMap((presetId, index) => {
      if (presetId === NO_SUBTITLES_PRESET_ID) {
        return [{
          id: `rotation:${index}:${presetId}`,
          kind: "rotation" as const,
          label: `Rotation ${index + 1} · No subtitles`,
          card: {
            key: `__subtitle-preview-rotation-${index}`,
            baseIndex: index,
          },
        }];
      }
      const preset = userSubtitlePresets.find((candidate) => candidate.id === presetId);
      if (!preset) return [];
      return [{
        id: `rotation:${index}:${preset.id}`,
        kind: "rotation" as const,
        label: `Rotation ${index + 1} · ${preset.name}`,
        // A synthetic key deliberately avoids card-local overrides. The
        // resolver still follows the production rotation path by index.
        card: {
          key: `__subtitle-preview-rotation-${index}`,
          baseIndex: index,
        },
      }];
    });
  }, [subtitleRotation, userSubtitlePresets]);

  const variantTargets = useMemo<PreviewTarget[]>(() => (
    previewCards.map((card) => {
      const subtitlesDisabled = subtitlesDisabledForCard(
        subtitleRotation,
        variantTemplateSelections,
        userSubtitlePresets,
        card,
      );
      const preset = resolveSubtitlePresetForCard(
        subtitleRotation,
        variantTemplateSelections,
        userSubtitlePresets,
        card,
      );
      const compactLabel = card.visualVersion
        ? `Variant ${card.baseIndex + 1}${card.visualVersion}`
        : `Variant ${card.baseIndex + 1}`;

      return {
        id: `variant:${card.key}`,
        kind: "variant" as const,
        label: subtitlesDisabled
          ? `${compactLabel} · No subtitles`
          : preset
            ? `${compactLabel} · ${preset.name}`
            : compactLabel,
        card,
      };
    })
  ), [previewCards, subtitleRotation, userSubtitlePresets, variantTemplateSelections]);

  const targets = useMemo(
    () => [...STYLE_TARGETS, ...rotationTargets, ...variantTargets],
    [rotationTargets, variantTargets],
  );

  // Until the user makes an explicit preview-only choice, continue following
  // the active A/B/default editor style. Removed targets fall back safely.
  const selectedTarget = targets.find((target) => target.id === selectedTargetId)
    ?? STYLE_TARGETS.find((target) => target.id === `style:${activeStyleKey}`)
    ?? STYLE_TARGETS[0];

  const selectedStyleKey = selectedTarget.kind === "style"
    ? selectedTarget.styleKey
    : selectedTarget.card.visualVersion === "A" || selectedTarget.card.visualVersion === "B"
      ? selectedTarget.card.visualVersion
      : "default";
  const settings = selectedTarget.kind === "style"
    ? getSubtitleSettingsFor(selectedTarget.styleKey)
    : getPreviewSubtitleSettingsFor(selectedTarget.card);
  const variantIndex = selectedTarget.kind === "style"
    ? previewCards.find((card) => (
        card.visualVersion === (selectedTarget.styleKey === "default" ? undefined : selectedTarget.styleKey)
      ))?.baseIndex ?? 0
    : selectedTarget.card.baseIndex;

  // Card and rotation settings are already fully resolved (template, Meta,
  // local delta), so the frame endpoint must not layer Meta a second time.
  const visualVersion = selectedTarget.kind === "style"
    && selectedTarget.styleKey !== "default"
    && !hasStyleOverride(selectedTarget.styleKey)
      ? selectedTarget.styleKey
      : undefined;
  const previewText = getStylePreviewText(selectedStyleKey);

  return (
    <div className="flex flex-col gap-3" data-testid="subtitle-style-preview-panel">
      <InspectorField
        label="Style or variant"
        helper="Preview only · does not change saved subtitle settings."
      >
        <Select value={selectedTarget.id} onValueChange={setSelectedTargetId}>
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label="Subtitle preview target"
            data-testid="subtitle-preview-target"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              <SelectLabel>Base styles</SelectLabel>
              {STYLE_TARGETS.map((target) => (
                <SelectItem key={target.id} value={target.id}>{target.label}</SelectItem>
              ))}
            </SelectGroup>
            {rotationTargets.length > 0 && (
              <SelectGroup>
                <SelectLabel>Active rotation</SelectLabel>
                {rotationTargets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>{target.label}</SelectItem>
                ))}
              </SelectGroup>
            )}
            {variantTargets.length > 0 && (
              <SelectGroup>
                <SelectLabel>Variants</SelectLabel>
                {variantTargets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>{target.label}</SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
      </InspectorField>
      <SubtitleEditor
        className="[&>div>div:first-child]:hidden"
        renderMode="preview-only"
        settings={settings}
        onSettingsChange={() => {
          /* preview-only — no-op */
        }}
        showPreview={true}
        previewHeight={440}
        previewMaxViewportHeight={42}
        compact={false}
        pipelineId={pipelineId}
        variantIndex={variantIndex}
        previewText={previewText}
        visualVersion={visualVersion}
      />
    </div>
  );
}
