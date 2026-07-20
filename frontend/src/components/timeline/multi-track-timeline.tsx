"use client";

import type { CSSProperties, HTMLAttributes, PointerEvent, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { TimelineRuler, TimelineZoomControls } from "@/components/timeline/timeline-primitives";

// Shared layout constants for every multi-track timeline,
// so the label gutter, end gutter and zoom bounds stay identical across pages.
export const TIMELINE_MIN_WIDTH = 480;
export const TIMELINE_MIN_ZOOM = 0.5;
export const TIMELINE_MAX_ZOOM = 20;
export const TIMELINE_LABEL_WIDTH = 136;
export const TIMELINE_END_GUTTER = 44;

export interface MultiTrackLane {
  /** Sticky left-gutter label. Must be unique — used as the React key. */
  label: string;
  /** Human-readable purpose exposed without polluting the compact track id. */
  description?: string;
  /** Tailwind height class for the lane row, e.g. "h-16". */
  height: string;
  /** Optional controlled pixel height. Used by resizable editor tracks. */
  heightPx?: number;
  /** Enables the row-resize handle in the right end gutter. */
  onHeightChange?: (height: number) => void;
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
  /** Optional interaction props for the free space after the lane's end marker. */
  endGutterProps?: HTMLAttributes<HTMLDivElement>;
  /** Draw the lime end-of-track marker at the right edge of the lane. */
  showEndLine?: boolean;
}

export interface MultiTrackTimelineProps {
  scrollRef?: Ref<HTMLDivElement>;
  /** Sizing and scroll-container layout classes. Visual chrome is owned by this shell. */
  className?: string;
  containerProps?: HTMLAttributes<HTMLDivElement> & { "data-testid"?: string };
  /**
   * Pixel width of every lane axis and the ruler. The caller owns the zoom model:
   * pipeline passes fitWidth × zoom (scrolls horizontally); segments passes fitWidth
   * (fixed width, zoom handled by narrowing the visible time window).
   */
  laneWidth: number;
  ruler: {
    startTime?: number;
    duration: number;
    currentTime?: number;
    playheadStyle?: CSSProperties;
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
 * Presentational shell shared by the pipeline, segments and template timelines.
 * It only lays out the grid — the caller supplies positioned lane content and
 * owns all zoom/scroll/scrub logic. This is the single source of truth for the
 * timeline's look: label gutter, ruler row, stacked lanes and end gutter.
 */
export function MultiTrackTimeline({
  scrollRef,
  className,
  containerProps,
  laneWidth,
  ruler,
  zoom,
  minZoom = TIMELINE_MIN_ZOOM,
  maxZoom = TIMELINE_MAX_ZOOM,
  onZoomChange,
  onFit,
  lanes,
}: MultiTrackTimelineProps) {
  const beginLaneResize = (
    event: PointerEvent<HTMLButtonElement>,
    lane: MultiTrackLane,
  ) => {
    if (!lane.onHeightChange) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const startHeight = lane.heightPx ?? event.currentTarget.parentElement?.parentElement?.getBoundingClientRect().height ?? 40;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      lane.onHeightChange?.(Math.max(28, Math.min(160, startHeight + moveEvent.clientY - startY)));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  return (
    <div
      ref={scrollRef}
      className={cn("isolate overflow-auto bg-[#0d0f0d] text-[10px] text-white", className)}
      {...containerProps}
    >
      <div className="w-max min-w-full">
        {/* Time ruler and zoom controls for the shared track scale. Sticky so it
            stays pinned when the lane stack scrolls vertically (card mode). */}
        <div className="sticky top-0 z-50 flex bg-[#0d0f0d]">
          <div
            className="sticky left-0 z-40 flex shrink-0 items-center justify-center border-r border-white/10 bg-[#111411] px-1"
            style={{ width: TIMELINE_LABEL_WIDTH }}
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
            playheadStyle={ruler.playheadStyle}
            className={cn("shrink-0", ruler.className)}
            style={{ width: laneWidth, ...ruler.style }}
            onPointerDown={ruler.onPointerDown}
          />
          <div
            className="h-7 shrink-0 border-l border-white/5 bg-[#0d0f0d]"
            style={{ width: TIMELINE_END_GUTTER }}
            title="End gutter"
          />
        </div>

        {lanes.map((lane) => (
          <div
            key={lane.label}
            className="flex border-t border-white/5 bg-[#0d0f0d]"
            style={lane.heightPx ? { height: lane.heightPx } : undefined}
          >
            <div
              className="sticky left-0 z-40 flex shrink-0 items-center justify-between gap-1 border-r border-white/10 bg-[#111411] px-3 font-medium text-white/75"
              style={{ width: TIMELINE_LABEL_WIDTH }}
            >
              <span
                className="truncate"
                title={lane.description}
                aria-label={lane.description ? `${lane.label}: ${lane.description}` : lane.label}
              >
                {lane.label}
              </span>
              {lane.meta}
              {lane.action}
            </div>
            <div
              ref={lane.axisRef}
              data-timeline-axis
              className={cn("relative shrink-0 select-none overflow-visible", lane.heightPx ? "h-full" : lane.height, lane.axisClassName)}
              style={{ width: laneWidth }}
              {...lane.axisProps}
            >
              {lane.content}
              {lane.showEndLine && (
                <span className="pointer-events-none absolute inset-y-0 right-0 z-20 w-px bg-lime-300/70" />
              )}
            </div>
            <div
              className={cn("relative shrink-0 border-l border-white/5 bg-[#0a0c0a]", lane.heightPx ? "h-full" : lane.height)}
              style={{ width: TIMELINE_END_GUTTER }}
              {...lane.endGutterProps}
            >
              {lane.onHeightChange && (
                <button
                  type="button"
                  role="separator"
                  aria-label={`Resize ${lane.label} track height`}
                  aria-orientation="horizontal"
                  aria-valuenow={Math.round(lane.heightPx ?? 40)}
                  onPointerDown={(event) => beginLaneResize(event, lane)}
                  className="absolute inset-x-0 bottom-0 z-30 h-2 cursor-row-resize border-b border-transparent transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
                  title={`Drag to resize ${lane.label}`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
