"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { cn, formatTimeShort } from "@/lib/utils";

const fallbackMajorStepFor = (duration: number) => {
  if (duration > 300) return 30;
  if (duration > 120) return 10;
  if (duration > 45) return 5;
  return 1;
};

const TIMELINE_TICK_STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 15, 30, 60, 120, 300,
] as const;

const RULER_LABEL_MIN_SPACING_PX = 48;

/**
 * Choose a labelled ruler interval from both time and available pixels.
 * Fine tick marks can remain dense for accurate scrubbing, while timestamp
 * labels never collapse into an unreadable run of digits.
 */
export function timelineMajorStepFor(duration: number, axisWidth: number): number {
  const safeDuration = Math.max(0.001, duration);
  const pixelsPerSecond = Math.max(1, axisWidth) / safeDuration;
  const desiredStep = RULER_LABEL_MIN_SPACING_PX / pixelsPerSecond;
  return TIMELINE_TICK_STEPS.find((step) => step >= desiredStep)
    ?? Math.ceil(desiredStep / 300) * 300;
}

/**
 * Keep ruler subdivisions roughly 6px apart. The clock therefore becomes
 * progressively finer as the user zooms in, down to 10ms, without turning a
 * fit-to-window timeline into an unreadable picket fence.
 */
export function timelineMinorStepFor(duration: number, axisWidth: number): number {
  const safeDuration = Math.max(0.001, duration);
  const pixelsPerSecond = Math.max(1, axisWidth) / safeDuration;
  const desiredStep = 6 / pixelsPerSecond;
  return TIMELINE_TICK_STEPS.find((step) => step >= desiredStep)
    ?? Math.ceil(desiredStep / 300) * 300;
}

export function TimelineRuler({
  duration,
  startTime = 0,
  axisWidth,
  className,
  style,
  onPointerDown,
}: {
  duration: number;
  startTime?: number;
  axisWidth?: number;
  className?: string;
  style?: CSSProperties;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const safeDuration = Math.max(0.001, duration);
  const resolvedAxisWidth = axisWidth
    ?? (typeof style?.width === "number" ? style.width : 0);
  const majorStep = resolvedAxisWidth > 0
    ? timelineMajorStepFor(safeDuration, resolvedAxisWidth)
    : fallbackMajorStepFor(safeDuration);
  const minorStep = resolvedAxisWidth > 0
    ? timelineMinorStepFor(safeDuration, resolvedAxisWidth)
    : majorStep >= 10 ? majorStep / 5 : majorStep >= 5 ? 1 : 0.5;
  const ticks: number[] = [];
  const tickCount = Math.ceil(safeDuration / minorStep);
  for (let index = 0; index < tickCount; index += 1) {
    ticks.push(Number((index * minorStep).toFixed(6)));
  }

  return (
    <div
      className={cn("relative h-7 select-none border-b border-white/5 bg-[#111411]", className)}
      style={style}
      onPointerDown={onPointerDown}
      data-timeline-axis
      data-timeline-ruler
      data-timeline-ruler-minor-step={minorStep}
      data-timeline-ruler-major-step={majorStep}
    >
      {ticks.map((value) => {
        const isMajor = Math.abs(value / majorStep - Math.round(value / majorStep)) < 0.001;
        const distanceFromEndPx = resolvedAxisWidth > 0
          ? (safeDuration - value) / safeDuration * resolvedAxisWidth
          : Number.POSITIVE_INFINITY;
        const showLabel = isMajor && distanceFromEndPx >= RULER_LABEL_MIN_SPACING_PX;
        return (
          <span
            key={value.toFixed(3)}
            className={cn(
              "absolute bottom-0 w-px bg-white/20",
              isMajor ? "h-3 bg-white/35" : "h-1.5",
            )}
            style={{ left: `${value / safeDuration * 100}%` }}
            data-timeline-ruler-tick={isMajor ? "major" : "minor"}
            data-timeline-time={value}
          >
            {showLabel && (
              <span
                className="absolute bottom-3 left-1 whitespace-nowrap font-mono text-[9px] text-white/55"
                data-timeline-ruler-label
              >
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
    <ResponsiveWaveformCanvas peaks={peaks} className={className} />
  );
}

function ResponsiveWaveformCanvas({
  peaks,
  className,
}: {
  peaks: number[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      const requestedScale = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(requestedScale, 32767 / width, 32767 / height);
      canvas.width = Math.max(1, Math.floor(width * scale));
      canvas.height = Math.max(1, Math.floor(height * scale));

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "rgba(110, 231, 183, 0.78)";

      // Keep bars close to 2px at every zoom level. Zooming therefore reveals
      // more source detail instead of stretching the same handful of peaks.
      const barCount = Math.max(1, Math.min(peaks.length, Math.ceil(width / 2)));
      const barWidth = width / barCount;
      const gap = Math.min(0.75, barWidth * 0.25);

      for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
        const sourceStart = Math.floor(barIndex / barCount * peaks.length);
        const sourceEnd = Math.max(
          sourceStart + 1,
          Math.ceil((barIndex + 1) / barCount * peaks.length),
        );
        let peak = 0;
        for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
          peak = Math.max(peak, peaks[sourceIndex] ?? 0);
        }
        const barHeight = Math.max(1, Math.min(height, peak * height));
        context.fillRect(
          barIndex * barWidth,
          (height - barHeight) / 2,
          Math.max(0.5, barWidth - gap),
          barHeight,
        );
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [peaks]);

  return (
    <canvas
      ref={canvasRef}
      className={cn("pointer-events-none absolute inset-0 size-full", className)}
      aria-hidden="true"
    />
  );
}

export function TimelineAudioTrackSurface({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-timeline-audio-surface
      className={cn(
        "absolute inset-y-0 left-0 overflow-hidden border-y border-emerald-300/15 bg-emerald-400/5",
        className,
      )}
      style={style}
    >
      {children}
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
  dataDensity,
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
  dataDensity?: "marker" | "compact" | "standard" | "detailed";
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-timeline-block
      data-segment-id={dataSegmentId}
      data-testid={testId}
      data-clip-density={dataDensity}
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
