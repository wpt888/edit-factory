"use client";

import React from "react";
import type { AttentionCue } from "@/types/attention-timeline";

export type CueTimingEdge = "move" | "resize" | "resize-start";

// One image track (V2..Vn). Dumb presentational component: the cue set for this
// track and all handlers arrive as props. Blocks keep the data-timeline-block
// attribute the existing specs key off. Left + right trim handles both drive the
// shared timing-drag handler in TimelineEditor.

export interface ImageLaneProps {
  cues: AttentionCue[];
  trackIndex: number;
  onBeginTimingDrag: (event: React.PointerEvent, cue: AttentionCue, edge: CueTimingEdge) => void;
  onSelectCue: (cueId: string) => void;
  pct: (sec: number) => string;
  widthPct: (sec: number) => string;
  /** Show the "no images yet" hint when this track is empty (first image lane only). */
  showEmptyHint?: boolean;
}

export function ImageLane({
  cues,
  trackIndex,
  onBeginTimingDrag,
  onSelectCue,
  pct,
  widthPct,
  showEmptyHint,
}: ImageLaneProps) {
  return (
    <>
      {cues.length === 0 && showEmptyHint && (
        <div className="absolute inset-0 flex items-center px-2 text-muted-foreground/60">
          No attention images — use the + on this lane to add one, then drag to position
        </div>
      )}
      {cues.map((cue) => (
        <button
          type="button"
          key={cue.id}
          data-timeline-block
          data-cue-id={cue.id}
          data-cue-track={trackIndex}
          className="absolute inset-y-1 min-w-3 cursor-grab overflow-hidden rounded bg-primary/70 px-1 text-left text-primary-foreground active:cursor-grabbing"
          style={{ left: pct(cue.startMs / 1000), width: widthPct(cue.durationMs / 1000) }}
          onPointerDown={(event) => onBeginTimingDrag(event, cue, "move")}
          onClick={() => onSelectCue(cue.id)}
          title="Drag to move (up/down to change track). Hold Alt to disable subtitle snapping."
        >
          {/* Left-edge trim: drag the start, keeping the right edge fixed. */}
          <span
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-black/20"
            onPointerDown={(event) => onBeginTimingDrag(event, cue, "resize-start")}
          />
          {cue.layers.length} image{cue.layers.length === 1 ? "" : "s"}
          <span
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/20"
            onPointerDown={(event) => onBeginTimingDrag(event, cue, "resize")}
          />
        </button>
      ))}
    </>
  );
}
