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
 * Step 3 renders one panel at a time. When Meta multiplication is enabled,
 * the A/B switch replaces this panel so the preview can keep a useful size.
 */
export function SubtitleStylePreviewPanel({
  styleKey,
  settings,
  hasOverride,
  pipelineId,
  previewCards,
  previewText,
}: {
  styleKey: StyleKey;
  settings: SubtitleSettings;
  hasOverride: boolean;
  pipelineId: string | undefined;
  previewCards: PreviewCard[];
  previewText?: string;
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
    <div className="flex flex-col gap-2 rounded-lg bg-muted/10 p-3">
      <span className="text-xs font-medium text-foreground">
        {label}
      </span>
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
