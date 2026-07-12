"use client";

import { useMemo } from "react";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings } from "@/types/video-processing";
import type { StyleKey, PreviewCard } from "../pipeline-types";

/**
 * Thin wrapper around <SubtitleEditor renderMode="preview-only"> used by
 * the Subtitle Style card in Step 3. Encapsulates the per-Meta-version
 * plumbing (picking a `variantIndex` for the FFmpeg background frame,
 * deciding whether to pass `visualVersion`, labelling the panel) so the
 * parent JSX stays readable.
 *
 * Meta ON renders two of these side-by-side (A and B). Meta OFF renders
 * one (styleKey="default"). In both cases the preview always reflects the
 * *effective* style (default + override + optional Meta overlay).
 */
export function SubtitleStylePreviewPanel({
  styleKey,
  settings,
  hasOverride,
  pipelineId,
  previewCards,
  isActive,
  onSelect,
  previewText,
  onSettingsChange,
}: {
  styleKey: StyleKey;
  settings: SubtitleSettings;
  hasOverride: boolean;
  pipelineId: string | undefined;
  previewCards: PreviewCard[];
  isActive: boolean;
  onSelect: () => void;
  previewText?: string;
  onSettingsChange: (settings: SubtitleSettings) => void;
}) {
  // Pick an arbitrary script variant that has the matching visualVersion so
  // the FFmpeg frame preview has a background frame to sample. Since the
  // style is now shared across all scripts under the same Meta version, it
  // doesn't matter *which* script we pick — just that one exists.
  const variantIndex = useMemo(() => {
    const targetVersion =
      styleKey === "A" ? "A" : styleKey === "B" ? "B" : undefined;
    const match = previewCards.find((c) => c.visualVersion === targetVersion);
    return match?.baseIndex ?? 0;
  }, [previewCards, styleKey]);

  // Only apply the Meta profile overlay in the preview when there is NO
  // user override for this key — mirrors the render-time suppression rule
  // so the preview doesn't diverge from the eventual render output.
  const visualVersion =
    hasOverride || styleKey === "default" ? undefined : styleKey;

  const label =
    styleKey === "default"
      ? "Live Preview"
      : `Live Preview — ${styleKey} (${styleKey === "A" ? "Instagram" : "Facebook"})`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`flex flex-col gap-2 flex-shrink-0 rounded-lg border p-2 cursor-pointer transition-all ${
        isActive
          ? "border-primary ring-2 ring-primary/40 bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      <span className={`text-xs font-medium ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
      <SubtitleEditor
        renderMode="preview-only"
        settings={settings}
        onSettingsChange={() => {
          /* preview-only — no-op */
        }}
        showPreview={true}
        previewHeight={440}
        compact={false}
        pipelineId={pipelineId}
        variantIndex={variantIndex}
        previewText={previewText}
        visualVersion={visualVersion}
      />
    </div>
  );
}
