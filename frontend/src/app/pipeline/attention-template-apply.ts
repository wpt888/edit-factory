import type { AttentionSelection } from "@/components/attention-template-picker";
import type { AttentionAnimationPreset, AttentionTimeline } from "@/types/attention-timeline";

import type { PreviewData } from "./pipeline-types";

export type AttentionTemplateApplyPayload = {
  templateId: string;
  animation?: AttentionAnimationPreset;
  enterMs?: number;
  assets: { url: string; type: "image" | "video" }[];
  durationMs: number;
  subtitleBoundariesMs: number[];
  revision: number;
  mode: "replace";
  startOffsetMs: number;
};

export type AttentionTemplateApplyResult = {
  appliedKeys: string[];
  skippedKeys: string[];
  failedKeys: string[];
};

export function buildAttentionTemplateApplyPayload({
  selection,
  preview,
  timeline,
  variantIndex,
}: {
  selection: AttentionSelection;
  preview: PreviewData;
  timeline: AttentionTimeline;
  variantIndex: number;
}): AttentionTemplateApplyPayload {
  return {
    templateId: selection.templateId,
    animation: selection.animation,
    enterMs: selection.enterMs,
    // Typed slot content — images composite as stills, videos as muted overlay
    // clips. Backend still accepts the legacy flat assetUrls for old clients.
    assets: selection.assets.map((asset) => ({ url: asset.url, type: asset.type })),
    durationMs: Math.max(1, Math.round(preview.audio_duration * 1000)),
    subtitleBoundariesMs: Array.from(new Set(preview.matches.flatMap((match) => [
      Math.round(match.srt_start * 1000),
      Math.round(match.srt_end * 1000),
    ]))).sort((a, b) => a - b),
    revision: timeline.revision,
    mode: "replace",
    startOffsetMs: Math.round(variantIndex * (selection.staggerSeconds || 0) * 1000),
  };
}
