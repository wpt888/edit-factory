import type { AttentionAnimationPreset } from "@/types/attention-timeline";

/** One authored image slot on a template track. Coordinates are 0..1 frame fractions. */
export type AttentionTemplateImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0..1 image opacity. */
  opacity: number;
  /** How pipeline media of any aspect ratio is placed inside this slot. */
  fit: "contain" | "cover";
  startMs: number;
  durationMs: number;
  /** Optional content saved with the slot. Step 3 pre-populates from it; the
   *  pipeline overrides it per-run without mutating the template. */
  defaultAsset?: { url: string; type: "image" | "video" };
  /** Optional sound effect scheduled with this visual slot. */
  sfxAssetId?: string;
  sfxUrl?: string;
  sfxLabel?: string;
  sfxVolumeDb: number;
  /** 1-based audio lane used by the template editor (A1, A2, ...). */
  sfxTrack: number;
};

/** Track-based template: tracks[i] maps to timeline lane V(2+i). */
export type AttentionTemplatePayload = {
  name: string;
  zone: "behind" | "front";
  animation: AttentionAnimationPreset;
  /** Authored canvas size. Slot coordinates remain normalized frame fractions. */
  canvasWidth: number;
  canvasHeight: number;
  /** Delay added to the template start for every consecutive video variant. */
  variantGapMs: number;
  /** Empty audio lanes are retained so authored track layout survives reload. */
  audioTrackCount: number;
  tracks: AttentionTemplateImage[][];
};

/** Legacy strategy-based config still stored on old rows / system templates. */
export type LegacyAttentionTemplateConfig = {
  layers?: number;
  size?: number;
  durationMs?: number;
  zone?: "behind" | "front";
  animation?: AttentionAnimationPreset;
  sfx?: string;
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
  canvasWidth: 1080,
  canvasHeight: 1920,
  variantGapMs: 1000,
  audioTrackCount: 1,
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
    opacity: 1,
    fit: "contain",
    startMs: 0,
    durationMs: 1200,
    sfxVolumeDb: 0,
    sfxTrack: 1,
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
  const canvasWidth = normalizeCanvasDimension(template?.canvasWidth, 1080);
  const canvasHeight = normalizeCanvasDimension(template?.canvasHeight, 1920);
  const variantGapMs = Math.max(0, template?.variantGapMs ?? 1000);
  if (template?.tracks?.length) {
    const normalizedTracks = template.tracks.map(track => track.map(image => ({
      ...image,
      opacity: image.opacity ?? 1,
      fit: image.fit === "cover" ? "cover" as const : "contain" as const,
      defaultAsset: normalizeDefaultAsset(image.defaultAsset),
      sfxAssetId: image.sfxAssetId ?? template.sfx,
      sfxUrl: image.sfxUrl,
      sfxLabel: image.sfxLabel,
      sfxVolumeDb: Math.max(-60, Math.min(12, image.sfxVolumeDb ?? 0)),
      sfxTrack: Math.max(1, Math.min(10, Math.round(image.sfxTrack ?? 1))),
    })));
    const highestAssignedAudioTrack = Math.max(
      1,
      ...normalizedTracks.flat().map(image => image.sfxTrack),
    );
    return {
      name: template.name ?? "",
      zone,
      animation, canvasWidth, canvasHeight, variantGapMs,
      audioTrackCount: Math.max(
        highestAssignedAudioTrack,
        Math.min(10, Math.max(1, Math.round(template.audioTrackCount ?? 1))),
      ),
      tracks: normalizedTracks,
    };
  }
  const layers = Math.max(1, Math.min(10, template?.layers ?? 1));
  const size = template?.size ?? 0.8;
  const durationMs = template?.durationMs ?? 1200;
  const positions = attentionLayoutPositions(layers, size);
  return {
    name: template?.name ?? DEFAULT_ATTENTION_TEMPLATE.name,
    zone,
    animation, canvasWidth, canvasHeight, variantGapMs, audioTrackCount: 1,
    tracks: template
      ? positions.map((position, index) =>
          [newTemplateImage({
            id: `legacy-${index}`,
            x: position.x,
            y: position.y,
            width: size,
            height: size,
            startMs: 0,
            durationMs,
            sfxAssetId: template.sfx,
          })])
      : [[]],
  };
}

/** Keep only a well-formed {url, type}; drop anything else so old/garbled rows
 *  degrade to "no default" rather than crashing the picker. */
function normalizeDefaultAsset(
  value: AttentionTemplateImage["defaultAsset"],
): AttentionTemplateImage["defaultAsset"] {
  if (!value || typeof value.url !== "string" || value.url.length === 0) return undefined;
  return { url: value.url, type: value.type === "video" ? "video" : "image" };
}

function normalizeCanvasDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value)
    ? Math.round(Math.min(8192, Math.max(64, value!)) / 2) * 2
    : fallback;
}

export function templateEndMs(tracks: AttentionTemplateImage[][]): number {
  return Math.max(0, ...tracks.flat().map((image) => image.startMs + image.durationMs));
}
