"use client";

import type { CSSProperties, HTMLAttributes, PointerEvent, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { TimelineRuler, TimelineZoomControls } from "@/components/timeline/timeline-primitives";

// Shared layout constants for every multi-track timeline (pipeline + segments),
// so the label gutter, end gutter and zoom bounds stay identical across pages.
export const TIMELINE_MIN_WIDTH = 480;
export const TIMELINE_MIN_ZOOM = 0.5;
export const TIMELINE_MAX_ZOOM = 20;
export const TIMELINE_LABEL_WIDTH = 136;
export const TIMELINE_END_GUTTER = 44;

export interface MultiTrackLane {
  /** Sticky left-gutter label. Must be unique — used as the React key. */
  label: string;
  /** Tailwind height class for the lane row, e.g. "h-16". */
  height: string;
  /** Optional control rendered on the right of the label gutter (e.g. an add button). */
  action?: ReactNode;
  /** Optional metadata rendered next to the label (e.g. "intro 2.0s"). */
  meta?: ReactNode;
  /** Positioned lane content — children use left/width as % of the lane axis. */
  content: ReactNode;
  /** Ref to the lane axis element (positioning + pointer math key off its rect). */
  axisRef?: Ref<HTMLDivElement>;
  /** Extra classes for the lane axis (gridlines, cursor, background). */
  axisClassName?: string;
  /** Extra props for the lane axis (pointer/mouse handlers, data-* flags). */
  axisProps?: HTMLAttributes<HTMLDivElement>;
  /** Draw the lime end-of-track marker at the right edge of the lane. */
  showEndLine?: boolean;
}

export interface MultiTrackTimelineProps {
  scrollRef?: Ref<HTMLDivElement>;
  /** Class for the scroll container (page-specific: full-height grid vs bordered card). */
  className?: string;
  containerProps?: HTMLAttributes<HTMLDivElement>;
  /**
   * Pixel width of every lane axis and the ruler. The caller owns the zoom model:
   * pipeline passes fitWidth × zoom (scrolls horizontally); segments passes fitWidth
   * (fixed width, zoom handled by narrowing the visible time window).
   */
  laneWidth: number;
  labelWidth?: number;
  endGutter?: number;
  ruler: {
    startTime?: number;
    duration: number;
    currentTime?: number;
    className?: string;
    style?: CSSProperties;
    onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  };
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomChange: (zoom: number) => void;
  onFit: () => void;
  lanes: MultiTrackLane[];
}

/**
 * Presentational shell shared by the pipeline (Step 3) and segments timelines.
 * It only lays out the grid — the caller supplies positioned lane content and
 * owns all zoom/scroll/scrub logic. This is the single source of truth for the
 * timeline's look: label gutter, ruler row, stacked lanes and end gutter.
 */
export function MultiTrackTimeline({
  scrollRef,
  className,
  containerProps,
  laneWidth,
  labelWidth = TIMELINE_LABEL_WIDTH,
  endGutter = TIMELINE_END_GUTTER,
  ruler,
  zoom,
  minZoom = TIMELINE_MIN_ZOOM,
  maxZoom = TIMELINE_MAX_ZOOM,
  onZoomChange,
  onFit,
  lanes,
}: MultiTrackTimelineProps) {
  return (
    <div ref={scrollRef} className={className} {...containerProps}>
      <div className="w-max min-w-full">
        {/* Time ruler and zoom controls for the shared track scale. */}
        <div className="flex">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-center justify-center border-r border-white/10 bg-[#111411] px-1"
            style={{ width: labelWidth }}
          >
            <TimelineZoomControls
              zoom={zoom}
              minZoom={minZoom}
              maxZoom={maxZoom}
              onZoomChange={onZoomChange}
              onFit={onFit}
            />
          </div>
          <TimelineRuler
            startTime={ruler.startTime}
            duration={ruler.duration}
            currentTime={ruler.currentTime}
            className={cn("shrink-0", ruler.className)}
            style={{ width: laneWidth, ...ruler.style }}
            onPointerDown={ruler.onPointerDown}
          />
          <div
            className="h-7 shrink-0 border-l border-white/5 bg-[#0d0f0d]"
            style={{ width: endGutter }}
            title="End gutter"
          />
        </div>

        {lanes.map((lane) => (
          <div key={lane.label} className="flex border-t border-white/5 bg-[#0d0f0d]">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center justify-between gap-1 border-r border-white/10 bg-[#111411] px-3 font-medium text-white/75"
              style={{ width: labelWidth }}
            >
              <span className="truncate">{lane.label}</span>
              {lane.meta}
              {lane.action}
            </div>
            <div
              ref={lane.axisRef}
              data-timeline-axis
              className={cn("relative shrink-0 select-none overflow-visible", lane.height, lane.axisClassName)}
              style={{ width: laneWidth }}
              {...lane.axisProps}
            >
              {lane.content}
              {lane.showEndLine && (
                <span className="pointer-events-none absolute inset-y-0 right-0 z-20 w-px bg-lime-300/70" />
              )}
            </div>
            <div
              className={cn("shrink-0 border-l border-white/5 bg-[#0a0c0a]", lane.height)}
              style={{ width: endGutter }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
