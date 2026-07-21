import type { AttentionSelection } from "@/components/attention-template-picker";
import type { AttentionTimeline } from "@/types/attention-timeline";

import type { PreviewData } from "./pipeline-types";

export type AttentionTemplateApplyPayload = {
  templateId: string;
  assetUrls: string[];
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
    // Phase 2: backend still consumes a flat image-URL list. Video slots are
    // wired end-to-end in Phase 3; until then only image assets are sent.
    assetUrls: selection.assets.filter((asset) => asset.type === "image").map((asset) => asset.url),
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
