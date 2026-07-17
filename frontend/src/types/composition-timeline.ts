export type CompositionClipKind = "intro" | "body";

/** Transition kinds for V1 — the no-overlap fade family only (P0 data model). */
export type TransitionKind = "dip_black" | "flash_white";

/**
 * The transition *into* a clip (boundary between the previous clip and this one).
 * Absent/null = hard cut. First clip ignores it. `durationMs` is the stored ms
 * value (never the UI label); backend clamps it to [150, 600].
 */
export interface TransitionSpec {
  kind: TransitionKind;
  durationMs: number;
}

/**
 * One editable clip on the final output clock.
 *
 * Unlike an SRT match, this is post-merge render data: every item maps to one
 * actual visual cut and all items are expected to be contiguous.
 */
export interface CompositionClip {
  id: string;
  kind: CompositionClipKind;
  segment_id?: string | null;
  segment_keywords?: string[];
  source_video_id?: string | null;
  source_video_path?: string;
  thumbnail_path?: string | null;
  product_group?: string | null;
  start_time: number;
  end_time: number;
  timeline_start: number;
  timeline_duration: number;
  transforms?: Record<string, unknown> | null;
  pinned?: boolean;
  /** P0: transition into this clip; absent/null = hard cut. First clip ignores it. */
  transitionIn?: TransitionSpec | null;
}

/**
 * Resolve a variant's default transition into concrete per-boundary values so the
 * backend never sees indirection (P0 item 4). A clip with an explicit `transitionIn`
 * (object = override, null = explicit cut) is left untouched; a clip with the field
 * *absent* inherits `defaultTransition`. First clip and intro clips never take one.
 *
 * With no default set (the P0 reality — the UI that sets it lands in P1) this is a
 * no-op that returns clips whose payload is byte-identical to today.
 */
export function resolveCompositionTransitions(
  clips: CompositionClip[],
  defaultTransition?: TransitionSpec | null,
): CompositionClip[] {
  return clips.map((clip, i) => {
    if (i === 0 || clip.kind === "intro") {
      if (clip.transitionIn == null) return clip;
      const { transitionIn: _drop, ...rest } = clip;
      return rest;
    }
    if (clip.transitionIn !== undefined) return clip; // explicit override wins
    if (defaultTransition == null) return clip; // no default → hard cut, unchanged
    return { ...clip, transitionIn: defaultTransition };
  });
}

