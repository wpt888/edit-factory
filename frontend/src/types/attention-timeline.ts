export type AttentionAnimationPreset =
  | "static"
  | "fade"
  | "pop"
  | "zoom"
  | "slide"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "wipe-left"
  | "wipe-right"
  | "bounce"
  | "spin"
  | "tornado";

export const DEFAULT_ATTENTION_ENTER_MS = 250;
export const DEFAULT_ATTENTION_EXIT_MS = 200;

export const ATTENTION_ANIMATION_OPTIONS: ReadonlyArray<{
  value: AttentionAnimationPreset;
  label: string;
  description: string;
}> = [
  { value: "static", label: "Static / Classic", description: "Appears instantly and stays still" },
  { value: "fade", label: "Fade", description: "Soft fade into the slot" },
  { value: "pop", label: "Pop", description: "Quick scale with a light overshoot" },
  { value: "zoom", label: "Zoom in", description: "Smoothly grows into position" },
  { value: "bounce", label: "Bounce", description: "Drops in with a playful bounce" },
  { value: "slide", label: "Slide from left", description: "Enters horizontally from the left" },
  { value: "slide-right", label: "Slide from right", description: "Enters horizontally from the right" },
  { value: "slide-up", label: "Slide from bottom", description: "Rises into the frame" },
  { value: "slide-down", label: "Slide from top", description: "Drops into the frame" },
  { value: "wipe-left", label: "Wipe from left", description: "Fast directional reveal from the left" },
  { value: "wipe-right", label: "Wipe from right", description: "Fast directional reveal from the right" },
  { value: "spin", label: "Spin", description: "Rotates and settles into place" },
  { value: "tornado", label: "Tornado", description: "High-energy spin, drop, and scale" },
];

export const attentionAnimationLabel = (preset: AttentionAnimationPreset): string =>
  ATTENTION_ANIMATION_OPTIONS.find(option => option.value === preset)?.label ?? preset;

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
  script_id?: string;
  output_id?: string;
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
