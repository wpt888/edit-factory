export type CompositionClipKind = "intro" | "body";

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
}

