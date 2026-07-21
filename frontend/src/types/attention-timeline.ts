export type AttentionAnimationPreset =
  | "static"
  | "pop"
  | "zoom"
  | "slide"
  | "spin"
  | "tornado";

export type AttentionLayer = {
  id: string;
  assetId: string;
  /** Browser-safe URL. Persisted for legacy/remote assets until imported. */
  assetUrl?: string;
  /** image (default) or video — a video layer composites as a muted overlay clip. */
  mediaType?: "image" | "video";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  zIndex: number;
  fit: "contain" | "cover";
  animation: {
    preset: AttentionAnimationPreset;
    enterMs: number;
    exitMs: number;
    delayMs: number;
    intensity: number;
  };
};

export type AttentionCue = {
  id: string;
  startMs: number;
  durationMs: number;
  layers: AttentionLayer[];
  sfxAssetId?: string;
  sfxUrl?: string;
  sfxVolumeDb: number;
  templateId?: string;
  /** Composite behind (default) or in front of the burned-in subtitles. */
  zone?: "behind" | "front";
  /** Timeline track this cue lives on: 2 = first image track (V2), 3 = V3, ...
   *  Absent = V2. Additive; drives lane placement and preview z-order. */
  track?: number;
};

export type AttentionTimeline = {
  revision: number;
  cues: AttentionCue[];
};

export const EMPTY_ATTENTION_TIMELINE: AttentionTimeline = {
  revision: 0,
  cues: [],
};

export function cueAtTime(timeline: AttentionTimeline, timeMs: number): AttentionCue[] {
  return timeline.cues.filter(
    (cue) => timeMs >= cue.startMs && timeMs < cue.startMs + cue.durationMs,
  );
}
