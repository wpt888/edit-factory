import type { AttentionCue } from "@/types/attention-timeline";

// Generic Premiere-style timeline tracks derived from the cue set. Track order
// is z-order: video tracks stack V1 (magnetic main video, bottom) under
// V2..Vn (image-clip tracks). Audio tracks are fixed A1 (voiceover) + A2
// (music, a later phase). This is the single source of truth for how many
// image tracks exist and which cues live on each.

export type TrackKind = "video" | "audio";

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  /** 1-based track number: V1/A1 = 1, V2/A2 = 2, ... */
  index: number;
  /** V1 only: the magnetic main-video lane that always fills the timeline. */
  magnetic?: boolean;
}

// A cue with no explicit track belongs to V2 (the first image track).
const trackOf = (cue: AttentionCue): number => cue.track ?? 2;

export function cuesOnTrack(cues: AttentionCue[], trackIndex: number): AttentionCue[] {
  return cues.filter((cue) => trackOf(cue) === trackIndex);
}

export function deriveTracks(
  cues: AttentionCue[],
  minimumVideoTrackCount: number,
  overlayTrackIndices: number[] = [],
): { video: TimelineTrack[]; audio: TimelineTrack[] } {
  const maxCueTrack = cues.reduce((max, cue) => Math.max(max, trackOf(cue)), 2);
  const maxOverlayTrack = overlayTrackIndices.reduce((max, index) => Math.max(max, index), 2);
  const videoCount = Math.max(2, maxCueTrack, maxOverlayTrack, minimumVideoTrackCount);

  // Top-to-bottom: Vn .. V2 (image tracks), then V1 (magnetic) at the bottom.
  const video: TimelineTrack[] = [];
  for (let index = videoCount; index >= 1; index -= 1) {
    video.push({ id: `V${index}`, kind: "video", index, magnetic: index === 1 });
  }

  const audio: TimelineTrack[] = [
    { id: "A1", kind: "audio", index: 1 },
    { id: "A2", kind: "audio", index: 2 },
  ];

  return { video, audio };
}
