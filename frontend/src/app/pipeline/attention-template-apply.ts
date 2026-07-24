import type { AttentionSelection } from "@/components/attention-template-picker";
import type {
  AttentionAnimationPreset,
  AttentionLayer,
  AttentionTimeline,
} from "@/types/attention-timeline";

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

export type AppliedAttentionEffectSummary = {
  layerCount: number;
  animation?: AttentionAnimationPreset;
  enterMs?: number;
  mixedAnimation: boolean;
  mixedEnterMs: boolean;
};

export type AttentionEffectPatch = {
  animation?: AttentionAnimationPreset;
  enterMs?: number;
};

export type AttentionEffectTarget = {
  cueId?: string;
  layerId?: string;
  cueIds?: string[];
  layerIds?: string[];
};

export function summarizeAppliedAttentionLayers(
  layers: AttentionLayer[],
): AppliedAttentionEffectSummary | undefined {
  if (layers.length === 0) return undefined;

  const animations = new Set(layers.map((layer) => layer.animation.preset));
  const enterDurations = new Set(layers.map((layer) => layer.animation.enterMs));
  return {
    layerCount: layers.length,
    animation: animations.size === 1 ? animations.values().next().value : undefined,
    enterMs: enterDurations.size === 1 ? enterDurations.values().next().value : undefined,
    mixedAnimation: animations.size > 1,
    mixedEnterMs: enterDurations.size > 1,
  };
}

/** Describe the effect currently stored on applied timeline layers. The
 * template picker uses this instead of presenting its next-apply selection as
 * if it were already authoritative for existing cues. */
export function summarizeAppliedAttentionEffect(
  timelines: AttentionTimeline[],
): AppliedAttentionEffectSummary | undefined {
  const layers = timelines.flatMap((timeline) =>
    Array.isArray(timeline?.cues)
      ? timeline.cues.flatMap((cue) => Array.isArray(cue.layers) ? cue.layers : [])
      : []);
  return summarizeAppliedAttentionLayers(layers);
}

/** Apply an explicit all-slot effect without disturbing cue placement, layer
 * geometry, per-layer delay, exit timing, or intensity. Returns the original
 * timeline when it already matches so callers do not create redundant saves. */
export function applyEffectToAttentionTimeline(
  timeline: AttentionTimeline,
  animation: AttentionAnimationPreset,
  enterMs: number,
): AttentionTimeline {
  return applyEffectPatchToAttentionTimeline(timeline, { animation, enterMs });
}

/** Update only the requested entrance-effect fields. This lets the Step 3
 * inspector change a preset without flattening mixed durations, and vice
 * versa. */
export function applyEffectPatchToAttentionTimeline(
  timeline: AttentionTimeline,
  patch: AttentionEffectPatch,
  target?: AttentionEffectTarget,
): AttentionTimeline {
  if (patch.animation === undefined && patch.enterMs === undefined) return timeline;
  let changed = false;
  const cueIds = target?.cueIds ? new Set(target.cueIds) : null;
  const layerIds = target?.layerIds ? new Set(target.layerIds) : null;
  const cues = timeline.cues.map((cue) => {
    if (target?.cueId !== undefined && cue.id !== target.cueId) return cue;
    if (cueIds && !cueIds.has(cue.id)) return cue;
    let cueChanged = false;
    const layers = cue.layers.map((layer) => {
      if (target?.layerId !== undefined && layer.id !== target.layerId) return layer;
      if (layerIds && !layerIds.has(layer.id)) return layer;
      if (
        (patch.animation === undefined || layer.animation.preset === patch.animation)
        && (patch.enterMs === undefined || layer.animation.enterMs === patch.enterMs)
      ) {
        return layer;
      }
      changed = true;
      cueChanged = true;
      return {
        ...layer,
        animation: {
          ...layer.animation,
          ...(patch.animation !== undefined ? { preset: patch.animation } : {}),
          ...(patch.enterMs !== undefined ? { enterMs: patch.enterMs } : {}),
        },
      };
    });
    return cueChanged ? { ...cue, layers } : cue;
  });
  return changed ? { ...timeline, cues } : timeline;
}

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
