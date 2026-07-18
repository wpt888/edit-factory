import type { AttentionAnimationPreset } from "@/types/attention-timeline";

export type AttentionTemplateStrategy = "count" | "everySeconds";

export type AttentionTemplatePayload = {
  name: string;
  strategy: AttentionTemplateStrategy;
  count: number;
  everySeconds: number;
  minimumGapMs: number;
  protectedStartMs: number;
  protectedEndMs: number;
  durationMs: number;
  animation: AttentionAnimationPreset;
  layers: number;
  size: number;
  zone: "behind" | "front";
  sfx: string | null;
  assetPool: string[];
};

export type AttentionTemplate = Partial<AttentionTemplatePayload> & {
  id: string;
  name: string;
  is_system: boolean;
};

export const DEFAULT_ATTENTION_TEMPLATE: AttentionTemplatePayload = {
  name: "New attention template",
  strategy: "count",
  count: 3,
  everySeconds: 6,
  minimumGapMs: 1800,
  protectedStartMs: 1500,
  protectedEndMs: 1500,
  durationMs: 1200,
  animation: "pop",
  layers: 1,
  size: 0.8,
  zone: "behind",
  sfx: null,
  assetPool: [],
};

export function normalizeAttentionTemplate(
  template?: Partial<AttentionTemplatePayload>,
): AttentionTemplatePayload {
  return { ...DEFAULT_ATTENTION_TEMPLATE, ...template };
}

export function attentionLayoutPositions(layerCount: number, size: number) {
  const base = (1 - size) / 2;
  const step = 0.03;
  return Array.from({ length: layerCount }, (_, index) => ({
    x: Number((base + index * step).toFixed(4)),
    y: Number((base + index * step).toFixed(4)),
  }));
}
