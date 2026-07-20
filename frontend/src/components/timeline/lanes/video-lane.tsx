"use client";

import React, { useState } from "react";
import { Film, GripVertical, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTimeShort as formatTime } from "@/lib/utils";
import { segmentFileUrl } from "@/lib/media-url";
import { TimelineClipShell } from "@/components/timeline/timeline-primitives";
import type {
  CompositionClip,
  EffectiveBoundaryTransition,
  TransitionKind,
  TransitionSpec,
} from "@/types/composition-timeline";

// V1 — the magnetic main-video lane. Dumb presentational component: all state
// and handlers live in timeline-editor.tsx and arrive as props. Testids and
// data-attributes are identical to the pre-extraction inline lane so the
// existing Playwright specs keep passing.

export interface VideoLaneProps {
  clips: CompositionClip[];
  mediaApiUrl: string;
  pct: (sec: number) => string;
  widthPct: (sec: number) => string;
  selectedClipId: string | null;
  isPreviewActive: boolean;
  previewActiveIndex: number;
  compositionDragId: string | null;
  compositionDropTarget: { index: number; time: number } | null;
  transitionBoundaries: EffectiveBoundaryTransition[];
  transitionDragTarget: number | null;
  suppressTransitionClickRef: React.MutableRefObject<boolean>;
  onSelectClip: (clipId: string) => void;
  onJumpToIndex: (idx: number) => void;
  onClipDragStart: (clipId: string) => void;
  onClipDragEnd: () => void;
  onRollPointerDown: (event: React.PointerEvent<HTMLSpanElement>, idx: number) => void;
  onBoundaryChange: (clipId: string, next: TransitionSpec | null | undefined) => void;
  onBoundaryDragStart: (event: React.PointerEvent, originIdx: number, spec: TransitionSpec) => void;
}

export function VideoLane({
  clips,
  mediaApiUrl,
  pct,
  widthPct,
  selectedClipId,
  isPreviewActive,
  previewActiveIndex,
  compositionDragId,
  compositionDropTarget,
  transitionBoundaries,
  transitionDragTarget,
  suppressTransitionClickRef,
  onSelectClip,
  onJumpToIndex,
  onClipDragStart,
  onClipDragEnd,
  onRollPointerDown,
  onBoundaryChange,
  onBoundaryDragStart,
}: VideoLaneProps) {
  return (
    <>
      {clips.map((clip, idx) => {
        const isSelected = selectedClipId === clip.id;
        const isHighlighted = isPreviewActive && previewActiveIndex === idx;
        const blockLabel = clip.segment_keywords?.slice(0, 2).join(", ")
          || `${clip.kind === "intro" ? "Intro" : "Clip"} ${idx + 1}`;
        return (
          <TimelineClipShell
            key={clip.id}
            testId={`composition-clip-${clip.id}`}
            draggable
            className={`${clip.kind === "intro"
              ? "border-violet-300/75 bg-violet-400/15"
              : "border-lime-300/60 bg-lime-300/10"} overflow-visible ${isSelected || isHighlighted
              ? "z-10 ring-2 ring-white/80"
              : ""} ${compositionDragId === clip.id ? "opacity-45" : "cursor-grab active:cursor-grabbing"}`}
            style={{ left: pct(clip.timeline_start), width: widthPct(clip.timeline_duration) }}
            title={`${blockLabel} · output ${formatTime(clip.timeline_start)}–${formatTime(clip.timeline_start + clip.timeline_duration)} · source ${clip.start_time.toFixed(2)}–${clip.end_time.toFixed(2)}`}
            onClick={() => {
              if (isPreviewActive) {
                onJumpToIndex(idx);
              } else {
                onSelectClip(clip.id);
              }
            }}
            onDragStart={(event) => {
              onClipDragStart(clip.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", clip.id);
            }}
            onDragEnd={() => {
              onClipDragEnd();
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white/25">
              <Film className="size-4" />
            </div>
            {clip.thumbnail_path && (
              <img
                src={segmentFileUrl(mediaApiUrl, clip.thumbnail_path)}
                alt=""
                draggable={false}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover opacity-55"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            )}
            <span className="absolute left-1 top-1 z-10 flex items-center gap-1 text-[8px] font-semibold uppercase tracking-wide text-white/80">
              <GripVertical className="size-3" />
              {clip.kind === "intro" ? "Intro" : `V${idx + 1}`}
            </span>
            {clip.pinned && (
              <Pin className="absolute right-1 top-1 z-10 size-3 fill-current text-lime-200" />
            )}
            <span className="absolute inset-x-1 bottom-1 z-10 flex items-end justify-between gap-1 text-[9px] font-medium text-white">
              <span className="truncate drop-shadow">{blockLabel}</span>
              <span className="shrink-0 font-mono text-[8px] text-white/70">
                {clip.timeline_duration.toFixed(2)}s
              </span>
            </span>
            {idx < clips.length - 1 && (
              <span
                role="separator"
                aria-label={`Trim boundary after ${blockLabel}`}
                className="absolute inset-y-0 right-0 z-30 w-2 translate-x-1/2 cursor-col-resize border-x border-white/25 bg-white/20 opacity-70 transition hover:bg-white/70 group-hover:opacity-100"
                onPointerDown={(event) => onRollPointerDown(event, idx)}
              />
            )}
          </TimelineClipShell>
        );
      })}
      {/* Transitions: one marker per body-clip boundary. A boundary with
          an effective transition renders as a Premiere-style block sitting
          across the cut (width ∝ duration, draggable to another boundary);
          a cut boundary keeps the small dot. Skips the first clip (no
          previous clip) and any boundary INTO an intro clip. */}
      {clips.map((clip, idx) => {
        if (idx === 0 || clip.kind === "intro") return null;
        const effective = transitionBoundaries.find((b) => b.clipIndex === idx) ?? null;
        return (
          <BoundaryTransitionMarker
            key={`boundary-${clip.id}`}
            left={pct(clip.timeline_start)}
            width={effective ? widthPct(effective.durationMs / 1000) : null}
            override={clip.transitionIn}
            effective={effective}
            onChange={(next) => onBoundaryChange(clip.id, next)}
            onDragStart={effective
              ? (e) => onBoundaryDragStart(e, idx, { kind: effective.kind, durationMs: effective.durationMs })
              : undefined}
            suppressClickRef={suppressTransitionClickRef}
          />
        );
      })}
      {transitionDragTarget !== null && clips[transitionDragTarget] && (
        <span
          className="pointer-events-none absolute inset-y-0 z-50 w-0.5 -translate-x-1/2 bg-primary"
          style={{ left: pct(clips[transitionDragTarget].timeline_start) }}
        />
      )}
      {/* Premiere-style insertion indicator while dragging a clip (V1 reorder)
          or while an overlay clip is dragged over V1 to be inserted. */}
      {compositionDropTarget !== null && (
        <span
          data-testid="composition-drop-indicator"
          className="pointer-events-none absolute inset-y-0 z-50 w-0.5 -translate-x-1/2 bg-primary shadow-[0_0_6px_rgba(190,242,100,0.9)]"
          style={{ left: pct(compositionDropTarget.time) }}
        />
      )}
    </>
  );
}

const TRANSITION_DURATION_PRESETS: { value: number; label: string }[] = [
  { value: 200, label: "Fast" },
  { value: 350, label: "Normal" },
  { value: 500, label: "Slow" },
];

const TRANSITION_LABELS: Record<TransitionKind, string> = {
  fade: "Fade (dissolve)",
  dip_black: "Dip to black",
  flash_white: "Flash white",
};

/**
 * Marker on a body-clip boundary. `override` is the clip's raw `transitionIn`
 * (undefined = inherits the variant default, null = explicit cut, object =
 * explicit transition); `effective` is the same boundary post-guard from
 * `effectiveBoundaryTransitions` (what will actually render — may be null even
 * with an override, e.g. either side too short). A boundary with an effective
 * transition renders as a Premiere-style block across the cut (drag via
 * `onDragStart` to move it to another boundary); otherwise a small dot.
 */
function BoundaryTransitionMarker({
  left,
  width,
  override,
  effective,
  onChange,
  onDragStart,
  suppressClickRef,
}: {
  left: string;
  width: string | null;
  override: TransitionSpec | null | undefined;
  effective: EffectiveBoundaryTransition | null;
  onChange: (next: TransitionSpec | null | undefined) => void;
  onDragStart?: (event: React.PointerEvent) => void;
  suppressClickRef?: React.MutableRefObject<boolean>;
}) {
  const isOverride = override !== undefined;
  const isCut = override === null;
  const [pendingKind, setPendingKind] = useState<TransitionKind | "cut">(
    isCut ? "cut" : override?.kind ?? effective?.kind ?? "cut"
  );
  const [pendingDuration, setPendingDuration] = useState(override?.durationMs ?? effective?.durationMs ?? 350);

  const dotClass = isOverride
    ? isCut
      ? "border-white/70 bg-black" // explicit cut override
      : "border-primary bg-primary" // explicit transition override
    : effective
      ? "border-primary bg-primary/30" // inherited default, resolves to a transition
      : "border-white/40 bg-transparent"; // inherited default, resolves to a cut (or no default set)

  const title = isOverride
    ? (isCut ? "Cut (override)" : `${override ? TRANSITION_LABELS[override.kind] : ""} (override)`)
    : (effective ? `${TRANSITION_LABELS[effective.kind]} (variant default)` : "Cut (variant default)");
  // A pointer drag that engaged sets suppressClickRef; swallow the click that
  // follows pointerup so the popover only opens on a plain click.
  const onClickCapture = (event: React.MouseEvent) => {
    if (suppressClickRef?.current) {
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return;
        setPendingKind(isCut ? "cut" : override?.kind ?? effective?.kind ?? "cut");
        setPendingDuration(override?.durationMs ?? effective?.durationMs ?? 350);
      }}
    >
      <PopoverTrigger asChild>
        {effective ? (
          <button
            type="button"
            // Premiere-style block straddling the cut: width ∝ duration, sits
            // above the trim handle (z-40 > z-30). Drag moves it to another
            // boundary; click opens the popover.
            className="absolute inset-y-1 z-40 flex -translate-x-1/2 cursor-grab items-center justify-center overflow-hidden rounded border border-primary bg-primary/70 text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:cursor-grabbing"
            style={{ left, width: width ?? undefined, minWidth: 16 }}
            title={`${title} · ${effective.durationMs}ms — drag to another boundary`}
            aria-label="Edit or move transition at this boundary"
            onPointerDown={onDragStart}
            onClickCapture={onClickCapture}
          >
            <span className="text-[10px] leading-none">⋈</span>
          </button>
        ) : (
          <button
            type="button"
            // Sits at the TOP of the cut, NLE-style — centering it vertically put it
            // exactly over the trim handle's natural grab point and swallowed the
            // pointerdown, making boundary resize appear broken.
            className={`absolute top-1 z-40 size-2.5 -translate-x-1/2 rounded-full border transition hover:scale-125 ${dotClass}`}
            style={{ left }}
            title={title}
            aria-label="Edit transition at this boundary"
          />
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="center">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Transition</span>
          <Select value={pendingKind} onValueChange={(value) => {
            const kind = value as TransitionKind | "cut";
            setPendingKind(kind);
            if (kind === "cut") { onChange(null); return; }
            const durationMs = pendingKind === kind ? pendingDuration : kind === "flash_white" ? 200 : 350;
            setPendingDuration(durationMs);
            onChange({ kind, durationMs });
          }}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cut">Cut</SelectItem>
              <SelectItem value="fade">Fade (dissolve)</SelectItem>
              <SelectItem value="dip_black">Dip to black</SelectItem>
              <SelectItem value="flash_white">Flash white</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {pendingKind !== "cut" && (
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Duration</span>
            <Select value={String(pendingDuration)} onValueChange={(value) => {
              const durationMs = Number(value);
              setPendingDuration(durationMs);
              onChange({ kind: pendingKind, durationMs });
            }}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSITION_DURATION_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={String(preset.value)}>{preset.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!isOverride}
          onClick={() => onChange(undefined)}
        >
          Use variant default
        </Button>
      </PopoverContent>
    </Popover>
  );
}
