"use client";

import { useEffect } from "react";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { Badge } from "@/components/ui/badge";
import { InspectorField } from "@/components/ui/inspector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { PreviewCard, PreviewKey } from "../pipeline-types";
import {
  resolveSubtitleAssignmentForCard,
  type SubtitleTemplateRotation,
} from "../subtitle-template-rotation";

type PreviewCardTarget = Pick<
  PreviewCard,
  "key" | "scriptId" | "outputId" | "baseIndex" | "label" | "visualVersion"
>;

export function SubtitleStylePreviewPanel({
  previewCards,
  pipelineId,
  subtitleRotation,
  userSubtitlePresets,
  variantTemplateSelections,
  variantSubtitleOverrides,
  getPreviewSubtitleSettingsFor,
  getPreviewSubtitleTextFor,
  selectedCardKey,
  onPreviewCardChange,
}: {
  previewCards: PreviewCard[];
  pipelineId: string | undefined;
  subtitleRotation: SubtitleTemplateRotation;
  userSubtitlePresets: UserSubtitlePreset[];
  variantTemplateSelections: Partial<Record<PreviewKey, string>>;
  variantSubtitleOverrides: Partial<Record<PreviewKey, Partial<SubtitleSettings>>>;
  getPreviewSubtitleSettingsFor: (card: PreviewCardTarget) => SubtitleSettings;
  getPreviewSubtitleTextFor: (card: PreviewCardTarget) => string | undefined;
  selectedCardKey: PreviewKey | null;
  onPreviewCardChange: (card: PreviewCard) => void;
}) {
  const selectedCard = previewCards.find((card) => card.key === selectedCardKey)
    ?? previewCards[0];

  useEffect(() => {
    if (!selectedCard) return;
    if (selectedCardKey !== selectedCard.key) onPreviewCardChange(selectedCard);
  }, [onPreviewCardChange, selectedCard, selectedCardKey]);

  if (!selectedCard) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="subtitle-style-preview-panel">
        Generate a preview to inspect the subtitle template.
      </p>
    );
  }

  const currentAssignment = resolveSubtitleAssignmentForCard(
    subtitleRotation,
    variantTemplateSelections,
    userSubtitlePresets,
    selectedCard,
  );
  const currentAssignmentLabel = currentAssignment.disabled
    ? "No subtitles"
    : currentAssignment.preset?.name ?? "Default style";
  const currentSourceLabel = currentAssignment.source === "manual"
    ? "Legacy override"
    : currentAssignment.source === "rotation"
      ? "Template rotation"
      : "Default";

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="subtitle-style-preview-panel"
    >
      <SubtitleEditor
        className="min-[1280px]:bg-surface-canvas min-[1280px]:px-4 min-[1280px]:pt-3 [&>div>div:first-child]:hidden"
        renderMode="preview-only"
        settings={getPreviewSubtitleSettingsFor(selectedCard)}
        onSettingsChange={() => {
          /* preview-only — no-op */
        }}
        showPreview
        previewHeight={440}
        previewMaxViewportHeight={42}
        compact={false}
        pipelineId={pipelineId}
        scriptId={selectedCard.scriptId}
        outputId={selectedCard.outputId}
        variantIndex={selectedCard.baseIndex}
        previewText={getPreviewSubtitleTextFor(selectedCard)}
        visualVersion={selectedCard.visualVersion}
        visualVersionStyleResolved
      />

      <div className="flex flex-col gap-3 min-[1280px]:px-4">
        <InspectorField
          label="Preview output"
          helper="The frame, text, platform version, and current assignment all come from this output."
        >
          <Select
            value={selectedCard.key}
            onValueChange={(value) => {
              const nextCard = previewCards.find((card) => card.key === value);
              if (nextCard) onPreviewCardChange(nextCard);
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full text-xs"
              aria-label="Preview output"
              data-testid="subtitle-preview-output"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              {previewCards.map((card) => {
                const assignment = resolveSubtitleAssignmentForCard(
                  subtitleRotation,
                  variantTemplateSelections,
                  userSubtitlePresets,
                  card,
                );
                const label = assignment.disabled
                  ? "No subtitles"
                  : assignment.preset?.name ?? "Default";
                return (
                  <SelectItem key={card.key} value={card.key}>
                    {card.label} · {label}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </InspectorField>

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Currently applied</span>
          <Badge variant="outline" className="min-w-0 truncate font-normal" data-testid="subtitle-current-assignment">
            {currentAssignmentLabel} · {currentSourceLabel}
            {variantSubtitleOverrides[selectedCard.key] ? " + Override" : ""}
          </Badge>
        </div>
      </div>

    </div>
  );
}
