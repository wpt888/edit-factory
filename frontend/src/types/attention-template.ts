import type { AttentionAnimationPreset } from "@/types/attention-timeline";

/** One authored image slot on a template track. Coordinates are 0..1 frame fractions. */
export type AttentionTemplateImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  startMs: number;
  durationMs: number;
};

/** Track-based template: tracks[i] maps to timeline lane V(2+i). */
export type AttentionTemplatePayload = {
  name: string;
  zone: "behind" | "front";
  animation: AttentionAnimationPreset;
  tracks: AttentionTemplateImage[][];
};

/** Legacy strategy-based config still stored on old rows / system templates. */
export type LegacyAttentionTemplateConfig = {
  layers?: number;
  size?: number;
  durationMs?: number;
  zone?: "behind" | "front";
  animation?: AttentionAnimationPreset;
};

export type AttentionTemplate = Partial<AttentionTemplatePayload> &
  LegacyAttentionTemplateConfig & {
    id: string;
    name: string;
    is_system: boolean;
  };

export const DEFAULT_ATTENTION_TEMPLATE: AttentionTemplatePayload = {
  name: "New attention template",
  zone: "behind",
  animation: "pop",
  tracks: [[]],
};

let imageIdCounter = 0;
export function newTemplateImage(partial?: Partial<AttentionTemplateImage>): AttentionTemplateImage {
  return {
    id: `img-${Date.now()}-${imageIdCounter++}`,
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
    startMs: 0,
    durationMs: 1200,
    ...partial,
  };
}

/** Legacy diagonal cascade — kept only to visualize old strategy-based templates. */
export function attentionLayoutPositions(layerCount: number, size: number) {
  const base = (1 - size) / 2;
  const step = 0.03;
  return Array.from({ length: layerCount }, (_, index) => ({
    x: Number((base + index * step).toFixed(4)),
    y: Number((base + index * step).toFixed(4)),
  }));
}

/** Normalize any stored template (new track-based or legacy strategy-based) into
 *  the track-based editor shape. Legacy templates become one stacked moment at t=0. */
export function normalizeAttentionTemplate(
  template?: Partial<AttentionTemplate>,
): AttentionTemplatePayload {
  const zone = template?.zone === "front" ? "front" : "behind";
  const animation = template?.animation ?? "pop";
  if (template?.tracks?.length) {
    return { name: template.name ?? "", zone, animation, tracks: template.tracks };
  }
  const layers = Math.max(1, Math.min(10, template?.layers ?? 1));
  const size = template?.size ?? 0.8;
  const durationMs = template?.durationMs ?? 1200;
  const positions = attentionLayoutPositions(layers, size);
  return {
    name: template?.name ?? DEFAULT_ATTENTION_TEMPLATE.name,
    zone,
    animation,
    tracks: template
      ? positions.map((position, index) =>
          [newTemplateImage({ id: `legacy-${index}`, x: position.x, y: position.y, width: size, height: size, startMs: 0, durationMs })])
      : [[]],
  };
}

export function templateEndMs(tracks: AttentionTemplateImage[][]): number {
  return Math.max(0, ...tracks.flat().map((image) => image.startMs + image.durationMs));
}
