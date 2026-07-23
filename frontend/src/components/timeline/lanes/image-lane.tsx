"use client";

import React from "react";
import type { AttentionCue } from "@/types/attention-timeline";
import { AttentionEntranceOverlay } from "@/components/timeline/attention-entrance-overlay";

export type CueTimingEdge = "move" | "resize" | "resize-start";

// One image track (V2..Vn). Dumb presentational component: the cue set for this
// track and all handlers arrive as props. Blocks keep the data-timeline-block
// attribute the existing specs key off. Left + right trim handles both drive the
// shared timing-drag handler in TimelineEditor.

export interface ImageLaneProps {
  cues: AttentionCue[];
  trackIndex: number;
  selectedCueId: string | null;
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
  selectedCueId,
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
      {cues.map((cue) => {
        const isSelected = selectedCueId === cue.id;
        const entrance = [...cue.layers]
          .filter((layer) => layer.animation.preset !== "static" && layer.animation.enterMs > 0)
          .sort((left, right) => left.animation.delayMs - right.animation.delayMs)[0];
        return (
        <button
          type="button"
          key={cue.id}
          data-timeline-block
          data-cue-id={cue.id}
          data-cue-track={trackIndex}
          aria-pressed={isSelected}
          className={`absolute inset-y-1 min-w-3 cursor-grab overflow-hidden rounded border bg-primary/70 px-1 text-left text-primary-foreground outline-none transition-colors active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary ${
            isSelected
              ? "z-10 border-primary-foreground/80 ring-2 ring-primary"
              : "border-primary/60"
          }`}
          style={{ left: pct(cue.startMs / 1000), width: widthPct(cue.durationMs / 1000) }}
          onPointerDown={(event) => onBeginTimingDrag(event, cue, "move")}
          onClick={() => onSelectCue(cue.id)}
          title="Drag to move (up/down to change track). Hold Alt to disable media-edge snapping."
        >
          {/* Left-edge trim: drag the start, keeping the right edge fixed. */}
          <span
            className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-black/20"
            onPointerDown={(event) => onBeginTimingDrag(event, cue, "resize-start")}
          />
          {entrance && (
            <AttentionEntranceOverlay
              preset={entrance.animation.preset}
              enterMs={entrance.animation.enterMs}
              offsetMs={entrance.animation.delayMs}
              clipDurationMs={cue.durationMs}
              testId={`attention-entrance-${cue.id}`}
            />
          )}
          {cue.layers.length} image{cue.layers.length === 1 ? "" : "s"}
          <span
            className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-black/20"
            onPointerDown={(event) => onBeginTimingDrag(event, cue, "resize")}
          />
        </button>
        );
      })}
    </>
  );
}
