"use client";

import type { CSSProperties, DragEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cn, formatTimeShort } from "@/lib/utils";

const majorStepFor = (duration: number) => {
  if (duration > 300) return 30;
  if (duration > 120) return 10;
  if (duration > 45) return 5;
  return 1;
};

export function TimelineRuler({
  duration,
  startTime = 0,
  currentTime,
  playheadStyle,
  className,
  style,
  onPointerDown,
}: {
  duration: number;
  startTime?: number;
  currentTime?: number;
  playheadStyle?: CSSProperties;
  className?: string;
  style?: CSSProperties;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const safeDuration = Math.max(0.001, duration);
  const majorStep = majorStepFor(safeDuration);
  const minorStep = majorStep >= 10 ? majorStep / 5 : majorStep >= 5 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let value = 0; value < safeDuration - 0.001; value += minorStep) {
    ticks.push(value);
  }

  return (
    <div
      className={cn("relative h-7 select-none border-b border-white/5 bg-[#111411]", className)}
      style={style}
      onPointerDown={onPointerDown}
      data-timeline-axis
    >
      {ticks.map((value) => {
        const isMajor = Math.abs(value / majorStep - Math.round(value / majorStep)) < 0.001;
        return (
          <span
            key={value.toFixed(3)}
            className={cn(
              "absolute bottom-0 w-px bg-white/20",
              isMajor ? "h-3 bg-white/35" : "h-1.5",
            )}
            style={{ left: `${value / safeDuration * 100}%` }}
          >
            {isMajor && (
              <span className="absolute bottom-3 left-1 whitespace-nowrap font-mono text-[9px] text-white/55">
                {formatTimeShort(startTime + value)}
              </span>
            )}
          </span>
        );
      })}

      <span className="absolute inset-y-0 right-0 w-px bg-lime-300/80" />
      <span className="absolute bottom-3 right-1 font-mono text-[9px] font-semibold text-lime-200">
        {formatTimeShort(startTime + duration)}
      </span>

      {currentTime !== undefined && (
        <span
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-rose-400"
          style={{
            left: `${Math.max(0, Math.min(1, (currentTime - startTime) / safeDuration)) * 100}%`,
            ...playheadStyle,
          }}
        />
      )}
    </div>
  );
}

export function TimelineWaveform({
  peaks,
  className,
  colorClassName = "bg-emerald-300/75",
}: {
  peaks: number[];
  className?: string;
  colorClassName?: string;
}) {
  // Not-yet-decoded state: a solid strip, not placeholder bars — dozens of
  // flat rounded bars read as a broken dotted line at lane height.
  if (peaks.length === 0) {
    return (
      <div className={cn("absolute inset-0 flex items-center overflow-hidden", className)} aria-hidden="true">
        <div className={cn("h-0.5 w-full rounded-full opacity-40", colorClassName)} />
      </div>
    );
  }
  return (
    <div className={cn("absolute inset-0 flex items-center gap-px overflow-hidden", className)} aria-hidden="true">
      {peaks.map((peak, index) => (
        <span
          key={index}
          className={cn("min-w-px flex-1 rounded-full", colorClassName)}
          style={{ height: `${Math.max(8, Math.min(100, peak * 100))}%` }}
        />
      ))}
    </div>
  );
}

export function TimelineZoomControls({
  zoom,
  minZoom = 0.5,
  maxZoom = 20,
  onZoomChange,
  onFit,
  className,
}: {
  zoom: number;
  minZoom?: number;
  maxZoom?: number;
  onZoomChange: (zoom: number) => void;
  onFit: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        className="grid h-6 w-6 place-items-center rounded text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        onClick={() => onZoomChange(Math.max(minZoom, zoom / 1.25))}
        disabled={zoom <= minZoom + 0.001}
        title="Zoom out"
        aria-label="Zoom timeline out"
      >
        <ZoomOut className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="min-w-12 rounded px-1.5 py-1 font-mono text-[9px] text-white/65 transition hover:bg-white/10 hover:text-white"
        onClick={onFit}
        title="Fit complete timeline"
        aria-label="Fit the full timeline"
      >
        {zoom.toFixed(2)}x
      </button>
      <button
        type="button"
        className="grid h-6 w-6 place-items-center rounded text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-30"
        onClick={() => onZoomChange(Math.min(maxZoom, zoom * 1.25))}
        disabled={zoom >= maxZoom - 0.001}
        title="Zoom in"
        aria-label="Zoom timeline in"
      >
        <ZoomIn className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TimelineClipShell({
  children,
  className,
  style,
  title,
  draggable,
  onClick,
  onMouseDown,
  onPointerDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dataSegmentId,
  testId,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  draggable?: boolean;
  onClick?: () => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
  dataSegmentId?: string;
  testId?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-timeline-block
      data-segment-id={dataSegmentId}
      data-testid={testId}
      className={cn(
        "group absolute inset-y-1 overflow-hidden rounded-sm border border-lime-300/55 bg-lime-300/10 text-left text-white shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-lime-300/80",
        className,
      )}
      style={style}
      title={title}
      draggable={draggable}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onPointerDown={onPointerDown}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && onClick) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}
