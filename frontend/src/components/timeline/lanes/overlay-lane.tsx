"use client";

import React from "react";
import { Film } from "lucide-react";
import { segmentFileUrl } from "@/lib/media-url";
import type { CompositionClip } from "@/types/composition-timeline";
import type { CueTimingEdge } from "@/components/timeline/lanes/image-lane";

// Phase C — free video overlay clips (PiP / B-roll) on an image track (V2..Vn).
// Dumb presentational component mirroring ImageLane: the clip set for this track
// plus handlers arrive as props. Blocks carry data-testid="overlay-clip-{id}"
// and keep data-timeline-block so shared timeline specs/behaviours apply. Move +
// edge trims drive the same pointer-drag handler in TimelineEditor as image cues.

export interface OverlayLaneProps {
  clips: CompositionClip[];
  mediaApiUrl: string;
  pct: (sec: number) => string;
  widthPct: (sec: number) => string;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onBeginTimingDrag: (event: React.PointerEvent, clip: CompositionClip, edge: CueTimingEdge) => void;
}

export function OverlayLane({
  clips,
  mediaApiUrl,
  pct,
  widthPct,
  selectedClipId,
  onSelectClip,
  onBeginTimingDrag,
}: OverlayLaneProps) {
  return (
    <>
      {clips.map((clip) => {
        const isSelected = selectedClipId === clip.id;
        const label = clip.segment_keywords?.slice(0, 2).join(", ") || "Overlay";
        return (
          <button
            type="button"
            key={clip.id}
            data-timeline-block
            data-testid={`overlay-clip-${clip.id}`}
            data-overlay-clip-id={clip.id}
            className={`absolute inset-y-1 min-w-3 cursor-grab overflow-hidden rounded border text-left text-white active:cursor-grabbing ${
              isSelected
                ? "z-10 border-sky-200 ring-2 ring-sky-300/80"
                : "border-sky-300/60"
            } bg-sky-400/20`}
            style={{ left: pct(clip.timeline_start), width: widthPct(clip.timeline_duration) }}
            onPointerDown={(event) => onBeginTimingDrag(event, clip, "move")}
            onClick={() => onSelectClip(clip.id)}
            title={`${label} · overlay on V${clip.track ?? 2} — drag to move (up/down changes track), edges to trim`}
          >
            {clip.thumbnail_path ? (
              <img
                src={segmentFileUrl(mediaApiUrl, clip.thumbnail_path)}
                alt=""
                draggable={false}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover opacity-45"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            ) : (
              <span className="absolute inset-0 flex items-center justify-center text-sky-100/40">
                <Film className="size-3" />
              </span>
            )}
            {/* Left-edge trim: drag the start, keeping the right edge fixed. */}
            <span
              data-testid={`overlay-start-handle-${clip.id}`}
              className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize bg-black/25"
              onPointerDown={(event) => onBeginTimingDrag(event, clip, "resize-start")}
            />
            <span className="pointer-events-none absolute inset-x-2 bottom-0.5 z-10 truncate text-[8px] font-medium text-sky-50 drop-shadow">
              {label}
            </span>
            <span
              data-testid={`overlay-end-handle-${clip.id}`}
              className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize bg-black/25"
              onPointerDown={(event) => onBeginTimingDrag(event, clip, "resize")}
            />
          </button>
        );
      })}
    </>
  );
}
