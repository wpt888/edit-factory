"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  CheckCircle,
  AlertTriangle,
  Search,
  Film,
  GripVertical,
  RefreshCw,
  Clock,
  Plus,
  Minus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ImageIcon,
  Images,
  Layers3,
  Trash2,
  Loader2,
  Maximize2,
  Pin,
  Music,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { useApiUrl } from "@/hooks/use-api-url";
import { segmentFileUrl } from "@/lib/media-url";
import { scaleSubtitlePx, scaleSubtitleFontPx, useSubtitlePreviewHeight } from "@/lib/subtitle-preview-scale";
import { stripAssTags, computeKaraokeWordTimings, activeKaraokeWordIndex } from "@/lib/karaoke-word-timing";
import { formatTimeShort as formatTime } from "@/lib/utils";
import type { SubtitleSettings, SegmentTransform } from "@/types/video-processing";
import { DEFAULT_SEGMENT_TRANSFORM } from "@/types/video-processing";
import { SegmentTransformPanel } from "@/components/segment-transform-panel";
import type { AttentionCue, AttentionTimeline } from "@/types/attention-timeline";
import type { CompositionClip, MusicSettings, TransitionSpec, OverlayBox } from "@/types/composition-timeline";
import { effectiveBoundaryTransitions, DEFAULT_OVERLAY_BOX, isOverlayClip } from "@/types/composition-timeline";
import { MusicInspector } from "@/components/timeline/music-inspector";
import { GenerateAiSegmentDialog } from "@/components/dialogs/generate-ai-segment-dialog";
import {
  TimelineWaveform,
} from "@/components/timeline/timeline-primitives";
import {
  MultiTrackTimeline,
  TIMELINE_MIN_WIDTH,
  TIMELINE_MIN_ZOOM,
  TIMELINE_MAX_ZOOM,
  TIMELINE_LABEL_WIDTH,
  TIMELINE_END_GUTTER,
} from "@/components/timeline/multi-track-timeline";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AttentionAssetPickerDialog } from "@/components/dialogs/attention-asset-picker-dialog";
import {
  fitCompositionToDuration,
  reflowComposition,
  buildLegacyComposition,
  rollCompositionBoundary as rollCompositionBoundaryPure,
} from "@/lib/composition-reflow";
import {
  VideoClipDragPreview,
  VideoLane,
  type VideoClipDragPreviewState,
} from "@/components/timeline/lanes/video-lane";
import { ImageLane } from "@/components/timeline/lanes/image-lane";
import { OverlayLane } from "@/components/timeline/lanes/overlay-lane";
import { deriveTracks, cuesOnTrack } from "@/components/timeline/timeline-tracks";
import { TimelineTrackControls } from "@/components/timeline/timeline-track-controls";
import { SafeZoneOverlay, type SafeZoneType } from "@/components/safe-zone-overlay";

// Fill the card width; the vh term caps the 9:16 frame at ~45vh tall — maximize for a big view.
const compactPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(100%, calc(45vh * 9 / 16))",
  maxWidth: "100%",
};

const expandedPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(421.875px, 100%)",
  maxWidth: "100%",
};

// Fit the 9:16 program monitor inside both dimensions of its size container.
// Using container units keeps the frame portrait even when the maximized
// editor is much wider than it is tall.
const fullPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(100cqw, calc(100cqh * 9 / 16))",
  maxWidth: "100%",
  maxHeight: "100%",
};

const RENDER_WIDTH = 1080;
const RENDER_HEIGHT = 1920;

function previewVideoTransform(transforms: Record<string, unknown> | null | undefined): string | undefined {
  if (!transforms) return undefined;
  const numberValue = (value: unknown, fallback: number) => {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const scale = numberValue(transforms.scale, 1);
  const panX = numberValue(transforms.pan_x, 0);
  const panY = numberValue(transforms.pan_y, 0);
  if (Math.abs(scale - 1) < 0.01 && panX === 0 && panY === 0) return undefined;
  return `translate(${-panX / RENDER_WIDTH * 100}%, ${-panY / RENDER_HEIGHT * 100}%) scale(${scale})`;
}
// Start staging before the current media window reaches its seam. Shorter
// windows stage immediately; longer windows are re-checked by the rAF loop
// until they enter this lead-time window.
const PREVIEW_STAGE_LEAD_SECONDS = 3;

// MatchPreview interface (mirrors pipeline/page.tsx)
export interface MatchPreview {
  srt_index: number;
  srt_text: string;
  srt_start: number;
  srt_end: number;
  segment_id: string | null;
  segment_keywords: string[];
  matched_keyword: string | null;
  confidence: number;
  duration_override?: number;  // User-adjusted duration in seconds
  is_auto_filled?: boolean;  // Backend auto-filled from random segment pool
  product_group?: string | null;
  source_video_id?: string;
  segment_start_time?: number;
  segment_end_time?: number;
  thumbnail_path?: string;
  merge_group?: number;
  merge_group_duration?: number;
  transforms?: Record<string, unknown> | null;
  explanation?: string;  // Human-readable reason this segment was assigned
  pinned?: boolean;  // User manually locked this assignment — assembly won't reassign it
}

interface PreviewSubtitleOverlayTextProps {
  match: MatchPreview;
  subtitleSettings?: SubtitleSettings;
  /** Coarse clock (throttled to >0.1s), used only while paused/scrubbing. */
  previewCurrentTime: number;
  /** Master clock ref — read directly at rAF rate while karaoke+playing. */
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  /** Shared style (font, outline, shadow, letter-spacing, opacity...) minus color. */
  textStyle: React.CSSProperties;
}

// Renders the active subtitle phrase. When karaoke is enabled AND the audio
// is playing, this component runs its OWN rAF loop reading audio.currentTime
// directly so per-word highlighting is smooth — WITHOUT forcing the ~5000
// line parent TimelineEditor to re-render at 60fps (only this small subtree
// re-renders, and only when the active word index actually changes). When
// karaoke is off, no rAF loop runs at all — behavior is identical to before.
const PreviewSubtitleOverlayText = memo(function PreviewSubtitleOverlayText({
  match,
  subtitleSettings,
  previewCurrentTime,
  audioRef,
  isPlaying,
  textStyle,
}: PreviewSubtitleOverlayTextProps) {
  const karaoke = subtitleSettings?.karaoke ?? false;
  const karaokeStyle = subtitleSettings?.karaokeStyle ?? "color";
  const textColor = subtitleSettings?.textColor ?? "#FFFFFF";
  const highlightColor = subtitleSettings?.highlightColor ?? "#FFFF00";
  const highlightBgColor = subtitleSettings?.highlightBgColor ?? "#A3E635";

  const cleanedText = useMemo(() => stripAssTags(match.srt_text), [match.srt_text]);
  const wordTimings = useMemo(
    () => (karaoke ? computeKaraokeWordTimings(cleanedText, match.srt_start, match.srt_end) : []),
    [karaoke, cleanedText, match.srt_start, match.srt_end]
  );

  const [rafWordIndex, setRafWordIndex] = useState(-1);
  useEffect(() => {
    if (!karaoke || !isPlaying || wordTimings.length === 0) return;
    let rafId: number;
    const tick = () => {
      const time = audioRef.current?.currentTime ?? 0;
      const idx = activeKaraokeWordIndex(wordTimings, time);
      setRafWordIndex((prev) => (prev === idx ? prev : idx));
      rafId = requestAnimationFrame(tick);
    };
    tick(); // compute immediately — avoid a 1-frame flash of stale state
    return () => cancelAnimationFrame(rafId);
  }, [karaoke, isPlaying, wordTimings, audioRef]);

  if (!karaoke || wordTimings.length === 0) {
    return (
      <p className="inline-block px-2 py-1 font-semibold leading-tight" style={{ ...textStyle, color: textColor }}>
        {cleanedText}
      </p>
    );
  }

  // While paused/scrubbing the rAF loop above doesn't run — fall back to the
  // parent's (coarser but accurate-when-static) clock instead.
  const activeIndex = isPlaying ? rafWordIndex : activeKaraokeWordIndex(wordTimings, previewCurrentTime);

  return (
    <p className="inline-block px-2 py-1 font-semibold leading-tight" style={textStyle}>
      {wordTimings.map((timing, index) => {
        if (karaokeStyle === "box") {
          const isActive = index === activeIndex;
          return (
            <React.Fragment key={index}>
              {index > 0 ? " " : ""}
              <span
                style={{
                  color: isActive ? highlightColor : textColor,
                  backgroundColor: isActive ? highlightBgColor : "transparent",
                  padding: "0.08em 0.18em",
                  borderRadius: "2px",
                  transition: "color 120ms linear, background-color 120ms linear",
                }}
              >
                {timing.word}
              </span>
            </React.Fragment>
          );
        }
        const isSung = index <= activeIndex;
        return (
          <span
            key={index}
            style={{
              color: isSung ? highlightColor : textColor,
              transition: "color 120ms linear",
            }}
          >
            {index > 0 ? " " : ""}{timing.word}
          </span>
        );
      })}
    </p>
  );
});

export interface SegmentOption {
  id: string;
  keywords: string[];
  source_video_id: string;
  duration: number;
  product_group?: string | null;
  start_time?: number;
  end_time?: number;
  thumbnail_path?: string;
  transforms?: Record<string, unknown> | null;
}

export interface IntroSegment {
  source_video_path?: string;
  source_video_id?: string;
  start_time: number;
  end_time: number;
  timeline_start: number;
  timeline_duration: number;
}

export interface InterstitialSlide {
  id: string;                    // Unique ID
  afterMatchIndex: number;       // Insert after this match index (-1 = before first)
  imageUrl: string;              // Product image URL
  duration: number;              // Seconds (default 2.0, range 0.5-5.0)
  animation: "static" | "kenburns"; // Ken Burns or static (default "kenburns")
  kenBurnsDirection?: "zoom-in" | "zoom-out" | "pan-left" | "pan-right"; // Default "zoom-in"
  productTitle?: string;         // For display in timeline
  track?: number;                // Attention timeline track (2 = V2, ...); legacy path ignores it
}

type AttentionAssetTarget = { kind: "layer"; cueId: string; layerId: string };

const EMPTY_ATTENTION_CUES: AttentionCue[] = [];

interface TimelineEditorProps {
  matches: MatchPreview[];
  audioDuration: number;
  introOffsetSec?: number;
  introSegments?: IntroSegment[];
  videoTimeline?: CompositionClip[];
  sourceVideoIds: string[];
  availableSegments: SegmentOption[];
  onMatchesChange: (matches: MatchPreview[]) => void;
  onVideoTimelineChange?: (timeline: CompositionClip[]) => void;
  /** Transitions V1: this variant's default transition (null/absent = hard cuts).
   *  The setter lives in step3-preview.tsx's Assembly Settings control, not here —
   *  this editor only reads it to resolve boundary markers/preview fades. */
  defaultTransition?: TransitionSpec | null;
  profileId?: string;
  pipelineId?: string;
  variantIndex?: number;
  subtitleSettings?: SubtitleSettings;
  interstitialSlides?: InterstitialSlide[];
  onInterstitialSlidesChange?: (slides: InterstitialSlide[]) => void;
  attentionTimeline?: AttentionTimeline;
  onAttentionTimelineChange?: (timeline: AttentionTimeline) => void;
  /** A2 background music for this variant (null/absent = none). */
  music?: MusicSettings | null;
  onMusicChange?: (music: MusicSettings | null) => void;
  /** Open the server-rendered preview for this exact variant. */
  onRenderPreview?: () => void;
  /** Optional platform guide displayed over every Step 3 program monitor. */
  safeZone?: SafeZoneType | null;
  /** Optional compact control anchored in the card player's empty top-left gutter. */
  previewTopLeftAccessory?: React.ReactNode;
  // "card" = compact in-card editor; "full" = the maximized modal editor
  // (bigger inline preview, everything else identical — same component reused).
  displayMode?: "card" | "full";
}


export function TimelineEditor({
  matches,
  audioDuration,
  introOffsetSec: requestedIntroOffsetSec = 0,
  introSegments = [],
  videoTimeline = [],
  sourceVideoIds: _sourceVideoIds,
  availableSegments,
  onMatchesChange,
  onVideoTimelineChange,
  defaultTransition = null,
  profileId,
  pipelineId,
  variantIndex,
  subtitleSettings,
  interstitialSlides: legacyInterstitialSlides = [],
  onInterstitialSlidesChange,
  attentionTimeline,
  onAttentionTimelineChange,
  music = null,
  onMusicChange,
  onRenderPreview,
  safeZone = null,
  previewTopLeftAccessory,
  displayMode = "card",
}: TimelineEditorProps) {
  const mediaApiUrl = useApiUrl();
  const attentionCues = attentionTimeline?.cues ?? EMPTY_ATTENTION_CUES;
  const [attentionAssetTarget, setAttentionAssetTarget] = useState<AttentionAssetTarget | null>(null);

  const cueBoundaryIndex = useCallback((startMs: number) => {
    let result = -1;
    matches.forEach((match, index) => {
      if (match.srt_end * 1000 <= startMs + 50) result = index;
    });
    return result;
  }, [matches]);

  const interstitialSlides = useMemo<InterstitialSlide[]>(() => {
    if (!attentionTimeline) return legacyInterstitialSlides;
    return attentionCues.map((cue) => {
      const layer = cue.layers[0];
      const preset = layer?.animation.preset ?? "static";
      return {
        id: cue.id,
        afterMatchIndex: cueBoundaryIndex(cue.startMs),
        imageUrl: layer?.assetUrl ?? layer?.assetId ?? "",
        duration: cue.durationMs / 1000,
        animation: preset === "static" ? "static" : "kenburns",
        kenBurnsDirection: preset === "zoom" ? "zoom-in" : undefined,
        productTitle: "Attention overlay",
        track: cue.track,
      };
    });
  }, [attentionCues, attentionTimeline, legacyInterstitialSlides, cueBoundaryIndex]);

  const emitSlides = useCallback((slides: InterstitialSlide[]) => {
    if (onAttentionTimelineChange && attentionTimeline) {
      const existing = new Map(attentionCues.map((cue) => [cue.id, cue]));
      const cues: AttentionCue[] = slides.map((slide) => {
        const old = existing.get(slide.id);
        const boundary = slide.afterMatchIndex < 0
          ? 0
          : Math.round((matches[slide.afterMatchIndex]?.srt_end ?? 0) * 1000);
        const assetUrl = slide.imageUrl;
        return {
          id: slide.id,
          startMs: old?.startMs ?? boundary,
          durationMs: Math.round(slide.duration * 1000),
          layers: old?.layers?.length ? old.layers.map((layer, index) => index === 0 ? {
            ...layer,
            assetId: assetUrl || layer.assetId,
            assetUrl: assetUrl || layer.assetUrl,
            animation: {
              ...layer.animation,
              preset: slide.animation === "static" ? "static" : "zoom",
            },
          } : layer) : [{
            id: crypto.randomUUID(),
            assetId: assetUrl || `pending:${slide.id}`,
            assetUrl: assetUrl || undefined,
            x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 1, fit: "contain",
            animation: {
              preset: slide.animation === "static" ? "static" : "zoom",
              enterMs: 250, exitMs: 200, delayMs: 0, intensity: 1,
            },
          }],
          sfxAssetId: old?.sfxAssetId,
          sfxUrl: old?.sfxUrl,
          sfxVolumeDb: old?.sfxVolumeDb ?? 0,
          templateId: old?.templateId,
          zone: old?.zone ?? "behind",
          track: slide.track ?? old?.track ?? 2,
        };
      });
      onAttentionTimelineChange({ ...attentionTimeline, cues });
      return;
    }
    onInterstitialSlidesChange?.(slides);
  }, [attentionCues, attentionTimeline, matches, onAttentionTimelineChange, onInterstitialSlidesChange]);

  const updateCueTiming = useCallback((cueId: string, startMs: number, durationMs: number, track?: number) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    const maxMs = Math.max(1, audioDuration * 1000);
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionCues.map(cue => cue.id === cueId ? {
        ...cue,
        startMs: Math.max(0, Math.min(Math.round(startMs), maxMs - 100)),
        durationMs: Math.max(100, Math.min(Math.round(durationMs), maxMs)),
        ...(track != null ? { track } : {}),
      } : cue),
    });
  }, [attentionCues, attentionTimeline, audioDuration, onAttentionTimelineChange]);

  const updateCueLayer = useCallback((
    cueId: string,
    layerId: string,
    changes: Partial<AttentionCue["layers"][number]>,
  ) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionCues.map(cue => cue.id === cueId ? {
        ...cue,
        layers: cue.layers.map(layer => layer.id === layerId ? { ...layer, ...changes } : layer),
      } : cue),
    });
  }, [attentionCues, attentionTimeline, onAttentionTimelineChange]);

  const addCueLayer = useCallback((cueId: string) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    const cue = attentionCues.find(item => item.id === cueId);
    if (!cue || cue.layers.length >= 20) return;
    const previous = cue.layers[cue.layers.length - 1];
    const layerId = crypto.randomUUID();
    const width = previous?.width ?? 0.8;
    const height = previous?.height ?? 0.8;
    const maxX = Math.max(0, 1 - width);
    const maxY = Math.max(0, 1 - height);
    const nextLayer: AttentionCue["layers"][number] = {
      id: layerId,
      assetId: `pending:${layerId}`,
      x: Math.min(maxX, (previous?.x ?? 0.1) + 0.03),
      y: Math.min(maxY, (previous?.y ?? 0.1) + 0.03),
      width,
      height,
      zIndex: Math.max(0, ...cue.layers.map(layer => layer.zIndex)) + 1,
      fit: previous?.fit ?? "contain",
      animation: {
        ...(previous?.animation ?? {
          preset: "pop",
          enterMs: 250,
          exitMs: 200,
          delayMs: 0,
          intensity: 1,
        }),
        delayMs: cue.layers.length * 120,
      },
    };
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionCues.map(item => item.id === cueId
        ? { ...item, layers: [...item.layers, nextLayer] }
        : item),
    });
    setAttentionAssetTarget({ kind: "layer", cueId, layerId });
  }, [attentionCues, attentionTimeline, onAttentionTimelineChange]);

  const removeCueLayer = useCallback((cueId: string, layerId: string) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionCues.map(cue => cue.id === cueId && cue.layers.length > 1
        ? { ...cue, layers: cue.layers.filter(layer => layer.id !== layerId) }
        : cue),
    });
  }, [attentionCues, attentionTimeline, onAttentionTimelineChange]);

  const updateCueZone = useCallback((cueId: string, zone: "behind" | "front") => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionCues.map(cue => cue.id === cueId ? { ...cue, zone } : cue),
    });
  }, [attentionCues, attentionTimeline, onAttentionTimelineChange]);

  const selectAttentionAsset = useCallback((url: string) => {
    if (!attentionAssetTarget) return;
    updateCueLayer(attentionAssetTarget.cueId, attentionAssetTarget.layerId, {
      assetId: url,
      assetUrl: url,
    });
  }, [attentionAssetTarget, updateCueLayer]);

  // Current displayed composition, for cue-drag snapping (this callback is
  // defined above displayedComposition's declaration; assigned each render below).
  const displayedCompositionRef = useRef<CompositionClip[]>([]);
  const beginCueTimingDrag = useCallback((event: React.PointerEvent, cue: AttentionCue, edge: "move" | "resize" | "resize-start") => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    event.preventDefault();
    event.stopPropagation();
    const track = (event.currentTarget as HTMLElement).closest("[data-attention-track]") as HTMLElement | null;
    if (!track) return;
    const startX = event.clientX;
    const originalStart = cue.startMs;
    const originalDuration = cue.durationMs;
    const totalMs = Math.max(1, audioDuration * 1000);
    // Snap to subtitle boundaries AND V1 clip boundaries. The composition is
    // read through a ref because this callback is defined above its declaration.
    const snapPoints = [
      ...matches.flatMap(match => [match.srt_start * 1000, match.srt_end * 1000]),
      ...displayedCompositionRef.current.flatMap(clip => [
        clip.timeline_start * 1000,
        (clip.timeline_start + clip.timeline_duration) * 1000,
      ]),
    ];
    const snap = (value: number, disabled: boolean) => {
      if (disabled) return value;
      const nearest = snapPoints.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best, value);
      return Math.abs(nearest - value) <= 150 ? nearest : value;
    };
    const originTrack = cue.track ?? 2;
    const onMove = (moveEvent: PointerEvent) => {
      const deltaMs = (moveEvent.clientX - startX) / Math.max(1, track.clientWidth) * totalMs;
      if (edge === "resize") {
        const end = snap(originalStart + originalDuration + deltaMs, moveEvent.altKey);
        updateCueTiming(cue.id, originalStart, end - originalStart);
      } else if (edge === "resize-start") {
        // Left-edge trim: move the start, keep the right edge (start+duration)
        // fixed; never let the clip shrink below 100ms.
        const rightEdge = originalStart + originalDuration;
        const start = Math.min(snap(originalStart + deltaMs, moveEvent.altKey), rightEdge - 100);
        updateCueTiming(cue.id, start, rightEdge - start);
      } else {
        const start = snap(originalStart + deltaMs, moveEvent.altKey);
        // Vertical: whichever image lane the cursor is over sets the draft
        // track; dropping outside any image lane keeps the origin track.
        const laneEl = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest('[data-track-kind="video"][data-track-index]') as HTMLElement | null;
        const hovered = laneEl ? Number(laneEl.getAttribute("data-track-index")) : NaN;
        if (Number.isFinite(hovered) && hovered >= 2) {
          updateCueTiming(cue.id, start, originalDuration, hovered);
        } else {
          // Audio, subtitle, and V1 are incompatible attention-image targets.
          updateCueTiming(cue.id, originalStart, originalDuration, originTrack);
        }
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const onUp = () => cleanup();
    const onCancel = () => {
      cleanup();
      updateCueTiming(cue.id, originalStart, originalDuration, originTrack);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [attentionTimeline, audioDuration, matches, onAttentionTimelineChange, updateCueTiming]);

  // Full source, thumbnail-enriched, before the magnetic/overlay split.
  // Composition clips ship without thumbnail_path (old saved timelines never
  // had one; the backend serializer resolves it by source-path equality, which
  // yields null). Backfill from the segment pool — by segment_id when present,
  // else by same source video + nearest source start — so the lanes show
  // previews instead of bare Film icons.
  const enrichedTimeline = useMemo(() => {
    const source = videoTimeline.length > 0
      ? videoTimeline
      : buildLegacyComposition(matches, introSegments, availableSegments, audioDuration);
    const thumbFor = (clip: CompositionClip): string | null | undefined => {
      if (clip.thumbnail_path) return clip.thumbnail_path;
      if (clip.segment_id) {
        const byId = availableSegments.find((seg) => seg.id === clip.segment_id);
        if (byId?.thumbnail_path) return byId.thumbnail_path;
      }
      const nearest = availableSegments
        .filter((seg) => seg.thumbnail_path
          && (!clip.source_video_id || seg.source_video_id === clip.source_video_id))
        .sort((a, b) => Math.abs((a.start_time ?? 0) - clip.start_time)
          - Math.abs((b.start_time ?? 0) - clip.start_time))[0];
      return nearest?.thumbnail_path ?? clip.thumbnail_path;
    };
    return source.map((clip) => {
      const thumbnail_path = thumbFor(clip);
      return thumbnail_path === clip.thumbnail_path ? clip : { ...clip, thumbnail_path };
    });
  }, [audioDuration, availableSegments, introSegments, matches, videoTimeline]);

  // The magnetic V1 sequence stays gapless. A generated legacy composition
  // initially follows the voiceover, but user edits own their output duration.
  const composition = useMemo(() => {
    const magnetic = enrichedTimeline
      .filter((clip) => !isOverlayClip(clip))
      .sort((a, b) => a.timeline_start - b.timeline_start);
    return videoTimeline.length > 0
      ? reflowComposition(magnetic)
      : fitCompositionToDuration(magnetic, audioDuration);
  }, [audioDuration, enrichedTimeline, videoTimeline.length]);

  // Free video overlays (track >= 2): absolute timeline_start, never reflowed.
  const overlayClips = useMemo(() =>
    enrichedTimeline
      .filter(isOverlayClip)
      .sort((a, b) => (a.track ?? 2) - (b.track ?? 2) || a.timeline_start - b.timeline_start),
    [enrichedTimeline]);

  const [compositionDraft, setCompositionDraft] = useState<CompositionClip[] | null>(null);
  const [overlayDraft, setOverlayDraft] = useState<CompositionClip[] | null>(null);
  const displayedComposition = compositionDraft ?? composition;
  const displayedOverlays = overlayDraft ?? overlayClips;
  displayedCompositionRef.current = displayedComposition;

  useEffect(() => {
    setCompositionDraft(null);
    setOverlayDraft(null);
  }, [videoTimeline]);

  // Persist V1 gaplessly without forcing its right edge to the voiceover end.
  // Overlay clips retain their absolute positions.
  const emitTimeline = useCallback((clips: CompositionClip[]) => {
    setCompositionDraft(null);
    setOverlayDraft(null);
    onVideoTimelineChange?.(reflowComposition(clips));
  }, [onVideoTimelineChange]);

  // V1 edits hand a magnetic-only array; append the current overlays so they
  // survive the save/undo round-trip.
  const commitComposition = useCallback((nextMagnetic: CompositionClip[]) => {
    emitTimeline([...nextMagnetic, ...overlayClips]);
  }, [emitTimeline, overlayClips]);

  // Legacy restored previews may contain only an absolute source path. Those
  // paths are intentionally forbidden by the backend file endpoint, so never
  // enter intro mode unless every clip can use the scoped preview proxy.
  // Canonical compositions play intro clips through the same clip engine as
  // every other cut. The old special intro player remains disabled so the four
  // micro-clips are no longer collapsed into one opaque timeline block.
  const introOffsetSec = composition.length > 0
    ? 0
    : requestedIntroOffsetSec > 0 &&
      introSegments.length > 0 &&
      introSegments.every((segment) => Boolean(segment.source_video_id))
      ? requestedIntroOffsetSec
      : 0;

  // The editor intentionally exposes one canonical view: the timeline.
  const [viewMode] = useState<"timeline" | "list">("timeline");

  // Full-editor workspace sizing. The maximized editor behaves like an NLE:
  // the inspector/program boundary and the program/timeline boundary can both
  // be dragged, while card mode keeps its original flow layout.
  const fullLayoutRef = useRef<HTMLDivElement>(null);
  const [fullInspectorWidth, setFullInspectorWidth] = useState(320);
  const [fullTimelineHeight, setFullTimelineHeight] = useState(260);
  const compactPreviewStageRef = useRef<HTMLDivElement>(null);
  const compactPreviewAccessoryRef = useRef<HTMLDivElement>(null);
  const [compactPreviewAccessoryPosition, setCompactPreviewAccessoryPosition] = useState({ x: 12, y: 12 });

  const clampCompactPreviewAccessory = useCallback((x: number, y: number) => {
    const stage = compactPreviewStageRef.current;
    const accessory = compactPreviewAccessoryRef.current;
    if (!stage || !accessory) return { x, y };

    const inset = 8;
    return {
      x: Math.min(Math.max(inset, x), Math.max(inset, stage.clientWidth - accessory.offsetWidth - inset)),
      y: Math.min(Math.max(inset, y), Math.max(inset, stage.clientHeight - accessory.offsetHeight - inset)),
    };
  }, []);

  const beginCompactPreviewAccessoryDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = compactPreviewAccessoryPosition;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      setCompactPreviewAccessoryPosition(clampCompactPreviewAccessory(
        startPosition.x + moveEvent.clientX - startX,
        startPosition.y + moveEvent.clientY - startY,
      ));
    };
    const onUp = () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [clampCompactPreviewAccessory, compactPreviewAccessoryPosition]);

  useEffect(() => {
    const stage = compactPreviewStageRef.current;
    if (!stage || !previewTopLeftAccessory) return;

    const keepInsideStage = () => {
      setCompactPreviewAccessoryPosition((position) => clampCompactPreviewAccessory(position.x, position.y));
    };
    keepInsideStage();
    const observer = new ResizeObserver(keepInsideStage);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [clampCompactPreviewAccessory, previewTopLeftAccessory]);

  const beginFullLayoutResize = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    axis: "inspector" | "timeline",
  ) => {
    if (displayMode !== "full") return;
    event.preventDefault();

    const bounds = fullLayoutRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startInspectorWidth = fullInspectorWidth;
    const startTimelineHeight = fullTimelineHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = axis === "inspector" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: PointerEvent) => {
      if (axis === "inspector") {
        const maxWidth = Math.max(240, Math.min(640, bounds.width - 360));
        setFullInspectorWidth(Math.min(maxWidth, Math.max(220, startInspectorWidth + moveEvent.clientX - startX)));
        return;
      }

      const maxHeight = Math.max(180, Math.min(640, bounds.height - 180));
      setFullTimelineHeight(Math.min(maxHeight, Math.max(140, startTimelineHeight - (moveEvent.clientY - startY))));
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }, [displayMode, fullInspectorWidth, fullTimelineHeight]);

  // Dialog state (used for both unmatched assignment and swap)
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [assigningClipId, setAssigningClipId] = useState<string | null>(null);
  const [isAddingCompositionClip, setIsAddingCompositionClip] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"same" | "all">("all");
  // D2: "Generate with AI" — capture the phrase text before the assign dialog
  // closes so the generation dialog keeps its prompt.
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [aiGenPrompt, setAiGenPrompt] = useState("");

  // Timeline view state
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  // A2 music selection — mutually exclusive with clip/slide/block selection.
  const [selectedMusic, setSelectedMusic] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSourceVideoId = useRef<string | null>(null);
  const lastStartTime = useRef<number | null>(null);

  // The maximized editor uses the same fit -> zoom -> pan model as the source
  // footage timeline. A single scroll viewport and lane width drive every
  // track, so subtitles, attention assets, video and audio never drift apart.
  const multiTrackScrollRef = useRef<HTMLDivElement>(null);
  const timelineDurationRef = useRef(0.05);
  const timelineLaneWidthRef = useRef(TIMELINE_MIN_WIDTH);
  const timelineSeekRafRef = useRef<number | null>(null);
  const pendingTimelineSeekRef = useRef<number | null>(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  // ponytail: session-only; persist count if users ask. Extra image tracks the
  // user added this session via "Add video track". deriveTracks also grows the
  // count to fit any cue whose track exceeds the current max.
  const [minimumVideoTrackCount, setMinimumVideoTrackCount] = useState(2);
  const [minimumAudioTrackCount, setMinimumAudioTrackCount] = useState(2);
  const [hiddenVideoTracks, setHiddenVideoTracks] = useState<Set<number>>(() => new Set());
  const [mutedAudioTracks, setMutedAudioTracks] = useState<Set<number>>(() => new Set());
  const [trackHeights, setTrackHeights] = useState<Record<string, number>>({});
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(TIMELINE_MIN_WIDTH + TIMELINE_LABEL_WIDTH);

  const toggleVideoTrackVisibility = useCallback((trackIndex: number) => {
    setHiddenVideoTracks((current) => {
      const next = new Set(current);
      if (next.has(trackIndex)) next.delete(trackIndex);
      else next.add(trackIndex);
      return next;
    });
  }, []);

  const toggleAudioTrackMute = useCallback((trackIndex: number) => {
    setMutedAudioTracks((current) => {
      const next = new Set(current);
      if (next.has(trackIndex)) next.delete(trackIndex);
      else next.add(trackIndex);
      return next;
    });
  }, []);

  useEffect(() => {
    const viewport = multiTrackScrollRef.current;
    if (!viewport) return;
    const updateWidth = () => setTimelineViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [attentionTimeline, displayMode, viewMode]);

  useEffect(() => () => {
    if (timelineSeekRafRef.current !== null) cancelAnimationFrame(timelineSeekRafRef.current);
  }, []);

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [compositionDragId, setCompositionDragId] = useState<string | null>(null);
  const [videoClipDragPreview, setVideoClipDragPreview] = useState<VideoClipDragPreviewState | null>(null);
  const suppressCompositionClickRef = useRef(false);
  // Premiere-style insertion point while dragging a clip: index in
  // displayedComposition + the boundary time where the indicator line sits.
  const [compositionDropTarget, setCompositionDropTarget] = useState<{ index: number; time: number } | null>(null);
  const setLiveCompositionDropTarget = (target: { index: number; time: number } | null) => {
    setCompositionDropTarget(target);
  };

  // --- Inline continuous preview player state ---
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewBuffering, setIsPreviewBuffering] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);
  const [previewSlotMatchIndexes, setPreviewSlotMatchIndexes] = useState<Array<number | null>>([null, null]);
  const [isPreviewIntro, setIsPreviewIntro] = useState(false);
  const [previewAudioSrc, setPreviewAudioSrc] = useState<string | null>(null);
  const [isPreviewAudioLoading, setIsPreviewAudioLoading] = useState(false);
  const [previewAudioLoadFailed, setPreviewAudioLoadFailed] = useState(false);
  const [voiceoverPeaks, setVoiceoverPeaks] = useState<number[]>([]);

  // Playback time is intentionally committed to React at only ~10 Hz because
  // this editor is expensive to render. Move the timeline cursor separately on
  // every animation frame so it remains visually continuous. A single inherited
  // CSS variable drives the ruler and every lane without triggering React work.
  const updateTimelinePlayheadDOM = useCallback((time: number) => {
    const timeline = multiTrackScrollRef.current;
    if (!timeline) return;
    const duration = Math.max(0.001, timelineDurationRef.current);
    const ratio = Math.max(0, Math.min(1, time / duration));
    timeline.style.setProperty(
      "--timeline-playhead-x",
      `${ratio * timelineLaneWidthRef.current}px`,
    );
  }, []);
  const playbackMatches = useMemo<MatchPreview[]>(() => displayedComposition.map((clip, index) => ({
    srt_index: index,
    srt_text: clip.segment_keywords?.slice(0, 3).join(", ") || `${clip.kind === "intro" ? "Intro" : "Clip"} ${index + 1}`,
    srt_start: clip.timeline_start,
    srt_end: clip.timeline_start + clip.timeline_duration,
    segment_id: clip.segment_id ?? null,
    segment_keywords: clip.segment_keywords ?? [],
    matched_keyword: clip.segment_keywords?.[0] ?? null,
    confidence: clip.segment_id ? 1 : 0,
    source_video_id: clip.source_video_id ?? undefined,
    segment_start_time: clip.start_time,
    segment_end_time: clip.end_time,
    thumbnail_path: clip.thumbnail_path ?? undefined,
    merge_group: index,
    merge_group_duration: clip.timeline_duration,
    transforms: clip.transforms,
    pinned: clip.pinned,
  })), [displayedComposition]);
  const compactPreviewMeasurement = useSubtitlePreviewHeight<HTMLDivElement>();
  const expandedPreviewMeasurement = useSubtitlePreviewHeight<HTMLDivElement>();
  // Which of the two ping-pong <video> slots is currently visible/playing (0 or 1).
  const [activeSlot, setActiveSlot] = useState(0);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  // Ping-pong double-buffer: two fixed <video> slots instead of one element per
  // source. The active slot plays the current segment (visible); the idle slot is
  // pre-seeked & paused on the NEXT segment, so a boundary crossing is a pure
  // visibility swap — no async seek at the seam (that seek was the stutter cause).
  const previewSlotRefs = useRef<(HTMLVideoElement | null)[]>([null, null]);
  // The compact player and expanded dialog share these two logical slots. During
  // the dialog exit animation, React can mount the compact video before it calls
  // the old dialog video's ref with `null`. Only clear a ref if that old element
  // still owns the slot; otherwise the newly-mounted compact player loses its
  // video element and remains black.
  const setPreviewSlotRef = useCallback((slot: number, element: HTMLVideoElement | null) => {
    if (element || previewSlotRefs.current[slot] === element) {
      previewSlotRefs.current[slot] = element;
    }
  }, []);

  // ── Transitions V1: instant-preview fade overlay ──────────────────────────
  // Effective boundaries after the same guards the backend applies, so the
  // instant preview can never show a fade the render would strip.
  const transitionBoundaries = useMemo(
    () => effectiveBoundaryTransitions(displayedComposition, defaultTransition),
    [displayedComposition, defaultTransition],
  );
  // One overlay div per preview mount (compact + expanded dialog). Opacity is
  // written imperatively from the audio clock every frame — React state at the
  // 100–300ms half-fade scale would be far too coarse. Detached nodes are
  // pruned lazily inside the tick.
  const transitionOverlayElsRef = useRef(new Set<HTMLDivElement>());
  const registerTransitionOverlay = useCallback((el: HTMLDivElement | null) => {
    if (el) transitionOverlayElsRef.current.add(el);
  }, []);
  // "fade" (cross dissolve) preview: true when the tick has dimmed the active
  // video slot over the idle one, so it knows to restore opacities afterwards.
  const crossfadeActiveRef = useRef(false);
  useEffect(() => {
    const els = transitionOverlayElsRef.current;
    const restoreSlots = () => {
      if (!crossfadeActiveRef.current) return;
      const activeEl = previewSlotRefs.current[activeSlotRef.current];
      const idleEl = previewSlotRefs.current[activeSlotRef.current ^ 1];
      if (activeEl) activeEl.style.opacity = "1";
      if (idleEl) idleEl.style.opacity = "0";
      crossfadeActiveRef.current = false;
    };
    const clear = () => {
      els.forEach((el) => { el.style.opacity = "0"; });
      restoreSlots();
    };
    if (!isPreviewActive || transitionBoundaries.length === 0) {
      clear();
      return;
    }
    let raf = 0;
    const tick = () => {
      // The TTS audio element is the master clock — it also holds the scrub
      // position while paused, so pause/scrub render the correct opacity.
      const t = previewAudioRef.current?.currentTime ?? 0;
      let opacity = 0;
      let color = "#000";
      let crossfade: { progress: number; clipIndex: number } | null = null;
      for (const boundary of transitionBoundaries) {
        if (boundary.kind === "fade") {
          // Cross dissolve: no color overlay. Fade the ACTIVE slot out over the
          // idle slot, which the ping-pong player keeps paused on the incoming
          // clip's first frame. ponytail: the preview dissolves in the window
          // BEFORE the boundary (where the prepared idle frame exists); the
          // render dissolves just after it — imperceptible at 150–600ms.
          const d = boundary.durationMs / 1000;
          if (t >= boundary.time - d && t < boundary.time) {
            crossfade = {
              progress: (t - (boundary.time - d)) / d,
              clipIndex: boundary.clipIndex,
            };
            break;
          }
        } else {
          const half = boundary.durationMs / 2000;
          if (t >= boundary.time - half && t <= boundary.time + half) {
            opacity = t < boundary.time
              ? (t - (boundary.time - half)) / half
              : 1 - (t - boundary.time) / half;
            color = boundary.kind === "flash_white" ? "#fff" : "#000";
            break;
          }
        }
      }
      const idleSlot = activeSlotRef.current ^ 1;
      const idleState = slotStateRef.current[idleSlot];
      if (crossfade && idleState.ready && idleState.preparedForIndex === crossfade.clipIndex) {
        const activeEl = previewSlotRefs.current[activeSlotRef.current];
        const idleEl = previewSlotRefs.current[idleSlot];
        if (activeEl && idleEl) {
          activeEl.style.opacity = String(1 - crossfade.progress);
          idleEl.style.opacity = "1"; // revealed behind (z-index stays below)
          crossfadeActiveRef.current = true;
        }
      } else {
        // Idle slot not prepared for this boundary (e.g. scrubbed here while
        // paused) → hard cut in the preview; the render still dissolves.
        restoreSlots();
      }
      const clamped = String(Math.max(0, Math.min(1, opacity)));
      els.forEach((el) => {
        if (!el.isConnected) { els.delete(el); return; }
        el.style.opacity = clamped;
        el.style.backgroundColor = color;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clear(); };
  }, [isPreviewActive, transitionBoundaries]);
  const activeSlotRef = useRef(0);
  const slotStateRef = useRef<Array<{
    sourceVideoId: string | null;   // source currently loaded into the slot
    segmentStartTime: number | null; // last offset the slot was seeked to
    preparedForIndex: number | null; // matches[] index this slot is staged for
    ready: boolean;                  // seeked + decoded → safe to show/play seamlessly
  }>>([
    { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false },
    { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false },
  ]);
  // Target currently assigned to the idle slot. Re-arm only when the actual
  // next cut changes, while readiness is validated on every frame.
  const preparedNextForIndexRef = useRef<number | null>(null);
  // Invalidates late seek callbacks when a slot is repurposed before an async
  // load/seek finishes (most likely after a fallback transition).
  const slotPreparationIdRef = useRef([0, 0]);
  const introSlotStateRef = useRef<Array<{
    preparedForIndex: number | null;
    preparationId: number;
    ready: boolean;
  }>>([
    { preparedForIndex: null, preparationId: 0, ready: false },
    { preparedForIndex: null, preparationId: 0, ready: false },
  ]);
  const isPreviewPlayingRef = useRef(false);
  const isPreviewActiveRef = useRef(false);
  const previewActiveIndexRef = useRef(0);
  const previewSegmentEndTimeRef = useRef<number | undefined>(undefined);
  const previewSegmentStartTimeRef = useRef<number | undefined>(undefined);
  const pendingCanPlayRef = useRef<(() => void) | null>(null);
  const matchesRef = useRef(playbackMatches);
  const previewRafIdRef = useRef<number | null>(null);
  const seekGraceTimestampRef = useRef(0);
  const lastReportedTimeRef = useRef(0);
  const activationIdRef = useRef(0);
  const activationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introActiveIndexRef = useRef(-1);
  const introHeldTimelineTimeRef = useRef<number | null>(null);
  const isPreviewIntroRef = useRef(false);

  // Keep refs in sync (state → ref for use in callbacks)
  // Note: isPreviewPlayingRef is also set synchronously in togglePreviewPlayPause to avoid 1-frame stale reads
  useEffect(() => { isPreviewPlayingRef.current = isPreviewPlaying; }, [isPreviewPlaying]);
  useEffect(() => { isPreviewActiveRef.current = isPreviewActive; }, [isPreviewActive]);
  useEffect(() => { isPreviewIntroRef.current = isPreviewIntro; }, [isPreviewIntro]);
  useEffect(() => { previewActiveIndexRef.current = previewActiveIndex; }, [previewActiveIndex]);
  useEffect(() => {
    matchesRef.current = playbackMatches;
    if (previewActiveIndexRef.current >= playbackMatches.length) {
      previewActiveIndexRef.current = Math.max(0, playbackMatches.length - 1);
      setPreviewActiveIndex(previewActiveIndexRef.current);
    }
  }, [playbackMatches]);

  // Cleanup: pause all audio/video and stop rAF on unmount
  useEffect(() => {
    return () => {
      activationIdRef.current++; // invalidate any pending async activation work
      if (activationTimeoutRef.current != null) {
        clearTimeout(activationTimeoutRef.current);
        activationTimeoutRef.current = null;
      }
      if (previewRafIdRef.current != null) {
        cancelAnimationFrame(previewRafIdRef.current);
        previewRafIdRef.current = null;
      }
      const audio = previewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      for (const vid of previewSlotRefs.current) {
        if (vid) vid.pause();
      }
    };
  }, []);

  useEffect(() => {
    if (!isPreviewActive) {
      setIsPreviewExpanded(false);
    }
  }, [isPreviewActive]);

  // Matches the client-side stitcher can actually play (drives canPreview).
  // Playback streams by source_video_id and seeks by segment_start_time;
  // segment_id is only a library reference the player never touches. Requiring
  // it here wrongly blanked the preview for older pipelines whose saved timeline
  // stored source_video_id without segment_id. The old per-source video pool +
  // prune effect are gone — we now use two fixed slots.
  const videoMatches = playbackMatches.filter((m) => m.source_video_id && m.segment_start_time != null);

  // Can we show the preview? Need pipelineId, profileId, and at least one video match
  const canPreview = !!(pipelineId && variantIndex !== undefined && profileId && videoMatches.length > 0);

  // The audio endpoint requires a Supabase bearer token. Native <audio> requests
  // cannot attach that header, so loading the API URL directly returns 401 and
  // freezes the master preview clock at 0:00. Fetch it through the authenticated
  // API client, then let the media element play the resulting local blob URL.
  useEffect(() => {
    if (!canPreview || !pipelineId || variantIndex === undefined) {
      setPreviewAudioSrc(null);
      setVoiceoverPeaks([]);
      setIsPreviewAudioLoading(false);
      setPreviewAudioLoadFailed(false);
      return;
    }

    const controller = new AbortController();
    const audioElement = previewAudioRef.current;
    let objectUrl: string | null = null;
    setPreviewAudioSrc(null);
    setVoiceoverPeaks([]);
    setIsPreviewAudioLoading(true);
    setPreviewAudioLoadFailed(false);

    apiGet(`/pipeline/audio/${pipelineId}/${variantIndex}`, {
      signal: controller.signal,
      cache: "no-store",
      memoryCache: false,
    })
      .then((response) => response.blob())
      .then(async (blob) => {
        if (controller.signal.aborted) return;
        if (blob.size === 0) throw new Error("Preview audio response was empty");
        objectUrl = URL.createObjectURL(blob);
        setPreviewAudioSrc(objectUrl);
        setIsPreviewAudioLoading(false);

        try {
          const AudioContextClass = window.AudioContext
            ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextClass) return;
          const context = new AudioContextClass();
          try {
            const decoded = await context.decodeAudioData(await blob.arrayBuffer());
            if (controller.signal.aborted) return;
            const channel = decoded.getChannelData(0);
            const bucketCount = 220;
            const bucketSize = Math.max(1, Math.floor(channel.length / bucketCount));
            const peaks = Array.from({ length: bucketCount }, (_, bucketIndex) => {
              const start = bucketIndex * bucketSize;
              const end = Math.min(channel.length, start + bucketSize);
              let peak = 0;
              for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
                peak = Math.max(peak, Math.abs(channel[sampleIndex]));
              }
              return Math.min(1, peak * 1.35);
            });
            setVoiceoverPeaks(peaks);
          } finally {
            await context.close().catch(() => undefined);
          }
        } catch (waveformError) {
          console.warn("[TimelineEditor] Could not decode the voiceover waveform", waveformError);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[TimelineEditor] Could not load authenticated preview audio", error);
        setPreviewAudioLoadFailed(true);
        setIsPreviewAudioLoading(false);
      });

    return () => {
      controller.abort();
      if (audioElement && objectUrl && audioElement.src === objectUrl) {
        audioElement.pause();
        audioElement.removeAttribute("src");
        audioElement.load();
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canPreview, pipelineId, variantIndex]);
  // Next index that triggers a REAL video cut (different merge group than the
  // segment at `curIdx`). Phrases inside one merge group share a single video
  // segment, so they never become a staging target — the picture stays put while
  // only the subtitle advances.
  const findNextTransitionIndex = useCallback((curIdx: number): number | null => {
    const ms = matchesRef.current;
    const cur = ms[curIdx];
    for (let i = curIdx + 1; i < ms.length; i += 1) {
      const m = ms[i];
      if (!m) continue;
      const sameGroup =
        cur &&
        m.merge_group != null &&
        cur.merge_group != null &&
        m.merge_group === cur.merge_group;
      if (!sameGroup) return i;
    }
    return null;
  }, []);
  const getPreviewStreamUrl = useCallback((sourceVideoId: string) => {
    if (!profileId) return "";
    return `${mediaApiUrl}/segments/source-videos/${sourceVideoId}/preview-stream?profile_id=${profileId}`;
  }, [mediaApiUrl, profileId]);

  // --- Continuous (live, client-side) preview helpers ---
  // NOTE: this is a client-side segment stitcher driven by the TTS audio clock,
  // NOT the same as VariantPreviewPlayer (which plays one server-rendered mp4).

  const findActiveMatch = useCallback((time: number): number => {
    const ms = matchesRef.current;
    const idx = ms.findIndex((m) => m.srt_start <= time && time < m.srt_end);
    return idx >= 0 ? idx : previewActiveIndexRef.current;
  }, []);

  // Compute the active segment's end boundary (cap by merge_group_duration if set).
  const setSegmentEndBoundary = useCallback((match: MatchPreview | undefined) => {
    if (match?.merge_group_duration != null && match.segment_start_time != null) {
      const mergeEnd = match.segment_start_time + match.merge_group_duration;
      previewSegmentEndTimeRef.current = match.segment_end_time != null
        ? Math.min(mergeEnd, match.segment_end_time)
        : mergeEnd;
    } else {
      previewSegmentEndTimeRef.current = match?.segment_end_time ?? undefined;
    }
    previewSegmentStartTimeRef.current = match?.segment_start_time ?? undefined;
  }, []);

  // Point a slot's <video> at a source, reloading only when it actually changes
  // (keeps the warm buffer for the common same-source case).
  const loadSlotSource = useCallback((slot: number, sourceVideoId: string) => {
    const el = previewSlotRefs.current[slot];
    const st = slotStateRef.current[slot];
    if (!el) return;
    if (st.sourceVideoId !== sourceVideoId) {
      el.pause();
      el.src = getPreviewStreamUrl(sourceVideoId);
      el.load();
      st.sourceVideoId = sourceVideoId;
      st.segmentStartTime = null;
    }
  }, [getPreviewStreamUrl]);

  // Seek a slot's <video> to `targetTime` while paused; invoke onReady once the
  // frame at that time is decoded (so it can be shown/played with no seam).
  const seekSlotTo = useCallback((slot: number, targetTime: number, onReady: () => void) => {
    const el = previewSlotRefs.current[slot];
    if (!el) return;
    const doSeek = () => {
      if (el.readyState >= 2 && Math.abs(el.currentTime - targetTime) < 0.05) {
        onReady();
        return;
      }
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        onReady();
      };
      el.addEventListener("seeked", onSeeked);
      el.currentTime = targetTime;
    };
    if (el.readyState >= 1) {
      doSeek();
    } else {
      const onMeta = () => {
        el.removeEventListener("loadedmetadata", onMeta);
        doSeek();
      };
      el.addEventListener("loadedmetadata", onMeta);
    }
  }, []);

  // Stage the IDLE slot for a future segment: load + pre-seek + mark ready. The
  // slot stays PAUSED — a paused, seeked video already paints its target frame,
  // so committing later is just a visibility flip + play (no seek at the seam).
  const prepareSlot = useCallback((slot: number, idx: number): boolean => {
    const match = matchesRef.current[idx];
    const el = previewSlotRefs.current[slot];
    if (!el || !match?.source_video_id || match.segment_start_time == null) return false;
    const st = slotStateRef.current[slot];
    const preparationId = ++slotPreparationIdRef.current[slot];
    setPreviewSlotMatchIndexes((current) => {
      const next = [...current];
      next[slot] = idx;
      return next;
    });
    st.preparedForIndex = idx;
    st.ready = false;
    loadSlotSource(slot, match.source_video_id);
    const targetTime = match.segment_start_time;
    seekSlotTo(slot, targetTime, () => {
      if (
        slotPreparationIdRef.current[slot] !== preparationId ||
        st.preparedForIndex !== idx
      ) return;
      st.segmentStartTime = targetTime;
      st.ready = true;
    });
    return true;
  }, [loadSlotSource, seekSlotTo]);

  // Make the ACTIVE slot show segment `idx` via a direct seek — the one acceptable
  // seek, used for startup, explicit user jumps, and re-staging after a remount.
  // Does NOT own previewActiveIndex; callers set that.
  const seatActiveSlot = useCallback((idx: number, shouldPlay: boolean) => {
    const match = matchesRef.current[idx];
    const slot = activeSlotRef.current;
    const el = previewSlotRefs.current[slot];
    setSegmentEndBoundary(match);
    // Only the active slot ever plays — keep the idle one paused.
    const idleEl = previewSlotRefs.current[slot ^ 1];
    if (idleEl) idleEl.pause();
    slotPreparationIdRef.current[slot ^ 1] += 1;
    slotStateRef.current[slot ^ 1].ready = false;
    if (!el || !match?.source_video_id || match.segment_start_time == null) {
      if (el) el.pause(); // no video for this segment → fallback UI shows
      return;
    }
    loadSlotSource(slot, match.source_video_id);
    const targetTime = match.segment_start_time;
    const st = slotStateRef.current[slot];
    const preparationId = ++slotPreparationIdRef.current[slot];
    setPreviewSlotMatchIndexes((current) => {
      const next = [...current];
      next[slot] = idx;
      return next;
    });
    st.preparedForIndex = idx;
    seekGraceTimestampRef.current = performance.now();
    seekSlotTo(slot, targetTime, () => {
      if (
        slotPreparationIdRef.current[slot] !== preparationId ||
        st.preparedForIndex !== idx
      ) return;
      st.segmentStartTime = targetTime;
      st.ready = true;
      if (shouldPlay && isPreviewPlayingRef.current) {
        el.play().catch(() => {});
      }
    });
  }, [loadSlotSource, seekSlotTo, setSegmentEndBoundary]);

  // Apply the visibility swap IMPERATIVELY (no React-render delay) by toggling
  // opacity/z-index. Both <video> layers stay display:block so the incoming
  // (idle) slot keeps a live GPU layer + decoded frame — Chromium tears down and
  // throttles `display:none` videos, which is what made the seam freeze.
  const applySlotVisibility = useCallback((newActive: number) => {
    const a = previewSlotRefs.current[newActive];
    const b = previewSlotRefs.current[newActive ^ 1];
    if (a) { a.style.opacity = "1"; a.style.zIndex = "1"; }
    if (b) { b.style.opacity = "0"; b.style.zIndex = "0"; }
  }, []);

  // Automatic boundary transition: swap to the pre-staged idle slot (no seek).
  // Owns advancing previewActiveIndex. Falls back to a direct seat if the idle
  // slot wasn't ready in time (very short segment / slow load) — never worse
  // than the pre-fix behavior.
  const commitTransition = useCallback((nextIdx: number) => {
    const previousIdx = previewActiveIndexRef.current;
    const match = matchesRef.current[nextIdx];

    // Advance index/state + boundary first, so subtitle + counter track the
    // picture even when the next segment has no video.
    setPreviewActiveIndex(nextIdx);
    previewActiveIndexRef.current = nextIdx;
    setSegmentEndBoundary(match);

    if (!match?.source_video_id || match.segment_start_time == null) {
      for (const vid of previewSlotRefs.current) { if (vid) vid.pause(); }
      return;
    }

    const idleSlot = activeSlotRef.current ^ 1;
    const st = slotStateRef.current[idleSlot];
    if (st.preparedForIndex === nextIdx && st.ready) {
      // Seamless: idle slot already decoded the first frame at the right offset.
      const newEl = previewSlotRefs.current[idleSlot];
      const oldEl = previewSlotRefs.current[activeSlotRef.current];
      activeSlotRef.current = idleSlot;
      // Flip visibility imperatively FIRST (instant, GPU-composited) — the idle
      // slot already holds its decoded first frame, so this paints with no gap.
      applySlotVisibility(idleSlot);
      setActiveSlot(idleSlot);
      // seekGraceTimestampRef now covers the play()/clock-resync moment so the
      // end-enforcement loop doesn't pause the freshly-shown slot a frame early.
      seekGraceTimestampRef.current = performance.now();
      if (isPreviewPlayingRef.current) newEl?.play().catch(() => {});
      if (oldEl) oldEl.pause();
      st.ready = false; // consumed
    } else {
      // Staging missed the deadline — degrade to seeking the active slot in place.
      const previousMatch = matchesRef.current[previousIdx];
      const previousDuration = previousMatch
        ? Math.max(0, previousMatch.srt_end - previousMatch.srt_start)
        : null;
      console.warn("[TimelineEditor] Preview transition fallback used live seek", {
        previousIndex: previousIdx,
        nextIndex: nextIdx,
        previousDuration,
        idlePreparedForIndex: st.preparedForIndex,
        idleReady: st.ready,
      });
      seatActiveSlot(nextIdx, true);
    }
  }, [setSegmentEndBoundary, seatActiveSlot, applySlotVisibility]);

  // rAF loop — tracks audio.currentTime at ~60fps for near-instant segment switching
  // This replaces timeupdate (which only fires ~4Hz) to eliminate ~250ms segment switch lag
  const prepareIntroSlot = useCallback((
    slot: number,
    index: number,
    onReady?: () => void,
  ): boolean => {
    const segment = introSegments[index];
    const video = previewSlotRefs.current[slot];
    if (!segment?.source_video_id || !video) return false;

    const st = slotStateRef.current[slot];
    const preparationId = ++slotPreparationIdRef.current[slot];
    const introState = {
      preparedForIndex: index,
      preparationId,
      ready: false,
    };
    introSlotStateRef.current[slot] = introState;
    st.sourceVideoId = null;
    st.segmentStartTime = null;
    st.preparedForIndex = null;
    st.ready = false;

    video.pause();
    video.src = getPreviewStreamUrl(segment.source_video_id);
    video.load();
    seekSlotTo(slot, segment.start_time, () => {
      if (
        slotPreparationIdRef.current[slot] !== preparationId ||
        introSlotStateRef.current[slot] !== introState
      ) return;
      st.segmentStartTime = segment.start_time;
      introState.ready = true;
      onReady?.();
    });
    return true;
  }, [getPreviewStreamUrl, introSegments, seekSlotTo]);

  // Switch the ultra-rapid intro only to an already decoded slot. If the next
  // 0.5s clip is still seeking, keep the previous frame visible and let the
  // intro clock wait instead of consuming the clip behind a black frame.
  const playIntroAt = useCallback((time: number): boolean => {
    const index = introSegments.findIndex((segment) =>
      segment.timeline_start <= time && time < segment.timeline_start + segment.timeline_duration
    );
    if (index < 0) return false;

    if (introActiveIndexRef.current === index) {
      const activeVideo = previewSlotRefs.current[activeSlotRef.current];
      if (isPreviewPlayingRef.current && activeVideo?.paused) {
        activeVideo.play().catch(() => {});
      }
      return true;
    }

    const nextSlot = activeSlotRef.current ^ 1;
    const nextState = introSlotStateRef.current[nextSlot];
    if (
      nextState.preparedForIndex !== index ||
      nextState.preparationId !== slotPreparationIdRef.current[nextSlot] ||
      !nextState.ready
    ) {
      previewSlotRefs.current[activeSlotRef.current]?.pause();
      setIsPreviewBuffering(true);
      if (
        nextState.preparedForIndex !== index ||
        nextState.preparationId !== slotPreparationIdRef.current[nextSlot]
      ) {
        prepareIntroSlot(nextSlot, index);
      }
      return false;
    }

    const previousSlot = activeSlotRef.current;
    const nextVideo = previewSlotRefs.current[nextSlot];
    const previousVideo = previewSlotRefs.current[previousSlot];
    introActiveIndexRef.current = index;
    activeSlotRef.current = nextSlot;
    applySlotVisibility(nextSlot);
    setActiveSlot(nextSlot);
    setIsPreviewBuffering(false);
    if (isPreviewPlayingRef.current) nextVideo?.play().catch(() => {});
    previousVideo?.pause();
    nextState.ready = false;

    const followingIntroIndex = index + 1;
    if (followingIntroIndex < introSegments.length) {
      prepareIntroSlot(previousSlot, followingIntroIndex);
    } else {
      prepareSlot(previousSlot, findActiveMatch(introOffsetSec));
    }
    return true;
  }, [applySlotVisibility, findActiveMatch, introOffsetSec, introSegments, prepareIntroSlot, prepareSlot]);

  const finishIntroPlayback = useCallback((audio: HTMLAudioElement): boolean => {
    const bodyIndex = findActiveMatch(Math.max(audio.currentTime, introOffsetSec));
    const bodyMatch = matchesRef.current[bodyIndex];
    const previousSlot = activeSlotRef.current;

    if (bodyMatch?.source_video_id && bodyMatch.segment_start_time != null) {
      const bodySlot = previousSlot ^ 1;
      const bodyState = slotStateRef.current[bodySlot];
      if (
        bodyState.preparedForIndex !== bodyIndex ||
        !bodyState.ready
      ) {
        previewSlotRefs.current[previousSlot]?.pause();
        audio.pause();
        setIsPreviewBuffering(true);
        if (bodyState.preparedForIndex !== bodyIndex) {
          prepareSlot(bodySlot, bodyIndex);
        }
        return false;
      }

      setSegmentEndBoundary(bodyMatch);
      activeSlotRef.current = bodySlot;
      applySlotVisibility(bodySlot);
      setActiveSlot(bodySlot);
      setPreviewActiveIndex(bodyIndex);
      previewActiveIndexRef.current = bodyIndex;
      seekGraceTimestampRef.current = performance.now();
      previewSlotRefs.current[bodySlot]?.play().catch(() => {});
      previewSlotRefs.current[previousSlot]?.pause();
      bodyState.ready = false;
    } else {
      previewSlotRefs.current[previousSlot]?.pause();
    }

    isPreviewIntroRef.current = false;
    setIsPreviewIntro(false);
    introActiveIndexRef.current = -1;
    introHeldTimelineTimeRef.current = null;
    setIsPreviewBuffering(false);
    audio.loop = false;
    audio.muted = false;
    if (audio.paused) {
      audio.play().catch(() => {
        isPreviewPlayingRef.current = false;
        setIsPreviewPlaying(false);
      });
    }
    return true;
  }, [applySlotVisibility, findActiveMatch, introOffsetSec, prepareSlot, setSegmentEndBoundary]);

  const startPreviewRafLoop = useCallback(() => {
    const loop = () => {
      const audio = previewAudioRef.current;
      if (!audio || !isPreviewPlayingRef.current) {
        previewRafIdRef.current = null;
        return;
      }
      if (isPreviewIntroRef.current) {
        const heldTimelineTime = introHeldTimelineTimeRef.current;
        if (heldTimelineTime != null) {
          updateTimelinePlayheadDOM(heldTimelineTime);
          setPreviewCurrentTime(heldTimelineTime);
          if (playIntroAt(heldTimelineTime + 0.001)) {
            introHeldTimelineTimeRef.current = null;
            if (isPreviewPlayingRef.current && audio.paused) {
              audio.play().catch(() => {
                isPreviewPlayingRef.current = false;
                setIsPreviewPlaying(false);
              });
            }
          }
          previewRafIdRef.current = requestAnimationFrame(loop);
          return;
        }

        const introTime = Math.min(introOffsetSec, audio.currentTime);
        updateTimelinePlayheadDOM(introTime);
        const introMatchIndex = findActiveMatch(introTime);
        if (introMatchIndex !== previewActiveIndexRef.current) {
          setPreviewActiveIndex(introMatchIndex);
          previewActiveIndexRef.current = introMatchIndex;
        }
        if (introTime >= introOffsetSec) {
          setPreviewCurrentTime(introOffsetSec);
          finishIntroPlayback(audio);
        } else if (playIntroAt(introTime)) {
          setPreviewCurrentTime(introTime);
        } else {
          const pendingSegment = introSegments.find((segment) =>
            segment.timeline_start <= introTime &&
            introTime < segment.timeline_start + segment.timeline_duration
          );
          const holdAt = pendingSegment?.timeline_start ?? introTime;
          introHeldTimelineTimeRef.current = holdAt;
          audio.pause();
          updateTimelinePlayheadDOM(holdAt);
          setPreviewCurrentTime(holdAt);
        }
        previewRafIdRef.current = requestAnimationFrame(loop);
        return;
      }
      const time = audio.currentTime;
      const previewTime = time;
      updateTimelinePlayheadDOM(previewTime);
      if (Math.abs(previewTime - lastReportedTimeRef.current) > 0.1) {
        lastReportedTimeRef.current = previewTime;
        setPreviewCurrentTime(previewTime);
      }

      const newIdx = findActiveMatch(time);
      const curIdx = previewActiveIndexRef.current;
      if (newIdx !== curIdx) {
        // Detect merge-group siblings against the OLD index BEFORE advancing.
        const prev = matchesRef.current[curIdx];
        const cur = matchesRef.current[newIdx];
        const sameMergeGroup =
          prev &&
          cur &&
          prev.merge_group != null &&
          cur.merge_group != null &&
          prev.merge_group === cur.merge_group;
        if (sameMergeGroup) {
          // Within a merge group: advance the subtitle/counter, keep the frame.
          setPreviewActiveIndex(newIdx);
          previewActiveIndexRef.current = newIdx;
        } else {
          // Real cut: swap to the pre-staged idle slot (no seek at the seam).
          commitTransition(newIdx);
        }
      }
      // Stage by remaining media time and re-check the target every frame. This
      // also avoids re-seeking for subtitle-only changes inside a merge group.
      const settledIdx = previewActiveIndexRef.current;
      const nextIdx = findNextTransitionIndex(settledIdx);
      if (preparedNextForIndexRef.current !== nextIdx) {
        preparedNextForIndexRef.current = null;
      }
      if (nextIdx != null) {
        const activeVideo = previewSlotRefs.current[activeSlotRef.current];
        const segmentStart = previewSegmentStartTimeRef.current;
        const segmentEnd = previewSegmentEndTimeRef.current;
        const hasMediaWindow =
          activeVideo != null &&
          segmentStart != null &&
          segmentEnd != null &&
          Number.isFinite(activeVideo.currentTime);
        const nextCutTime = matchesRef.current[nextIdx]?.srt_start ?? time;
        const timeUntilNextCut = Math.max(0, nextCutTime - time);
        const remaining = hasMediaWindow
          ? Math.min(segmentEnd - activeVideo.currentTime, timeUntilNextCut)
          : timeUntilNextCut;
        const shouldStage = remaining <= PREVIEW_STAGE_LEAD_SECONDS;

        if (shouldStage) {
          const idleSlot = activeSlotRef.current ^ 1;
          const idleState = slotStateRef.current[idleSlot];
          if (idleState.preparedForIndex === nextIdx) {
            // Ready or still loading: keep validating this exact target on each
            // frame without issuing duplicate seeks.
            preparedNextForIndexRef.current = nextIdx;
          } else if (prepareSlot(idleSlot, nextIdx)) {
            preparedNextForIndexRef.current = nextIdx;
          }
        }
      }

      previewRafIdRef.current = requestAnimationFrame(loop);
    };
    if (previewRafIdRef.current != null) cancelAnimationFrame(previewRafIdRef.current);
    previewRafIdRef.current = requestAnimationFrame(loop);
  }, [findActiveMatch, commitTransition, findNextTransitionIndex, finishIntroPlayback, prepareSlot, introOffsetSec, introSegments, playIntroAt, updateTimelinePlayheadDOM]);

  const stopPreviewRafLoop = useCallback(() => {
    if (previewRafIdRef.current != null) {
      cancelAnimationFrame(previewRafIdRef.current);
      previewRafIdRef.current = null;
    }
  }, []);

  // Make the master audio clock authoritative: start the rAF loop ONLY once
  // play() actually resolves. Chromium flips `audio.paused` to false
  // synchronously the instant play() is called — even while that promise is
  // still pending or about to reject (e.g. the click-primed muted/looping
  // play() being interrupted by our currentTime reset). The old startup code
  // gated the real play() on `if (audio.paused)`, saw false, skipped it, then
  // started the loop against a clock frozen at 0 — the "playhead stuck at 0:00,
  // no segment ever advances" bug. Playing unconditionally and clearing the
  // playing state on rejection means the UI never claims to be playing dead audio.
  const playAudioAndStartLoop = useCallback((audio: HTMLAudioElement, activationId?: number) => {
    audio.play().then(() => {
      if (activationId != null && activationIdRef.current !== activationId) return; // stale — Stop pressed
      if (!isPreviewPlayingRef.current) return; // paused meanwhile
      startPreviewRafLoop();
    }).catch(() => {
      isPreviewPlayingRef.current = false;
      setIsPreviewPlaying(false);
      stopPreviewRafLoop();
    });
  }, [startPreviewRafLoop, stopPreviewRafLoop]);

  // Audio metadata + ended events (no timeupdate — rAF replaces it)
  useEffect(() => {
    if (!isPreviewActive) return;
    const audio = previewAudioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setPreviewDuration(audio.duration);
    };

    const onEnded = () => {
      setIsPreviewPlaying(false);
      isPreviewPlayingRef.current = false;
      stopPreviewRafLoop();
      for (const vid of previewSlotRefs.current) {
        if (vid) vid.pause();
      }
    };

    const onError = () => {
      console.warn("[timeline-editor] Audio error during preview");
      setIsPreviewPlaying(false);
      isPreviewPlayingRef.current = false;
      stopPreviewRafLoop();
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.onerror = null;
      stopPreviewRafLoop();
    };
  }, [isPreviewActive, stopPreviewRafLoop]);

  // Video segment_end_time enforcement via rAF (60fps instead of timeupdate's ~4Hz).
  // This prevents the ~250ms overshoot that timeupdate allows past segment boundaries.
  const segmentEnforceRafRef = useRef<number | null>(null);
  const segmentEnforceTimeoutRef = useRef<number | null>(null); // Bug #134

  useEffect(() => {
    if (!isPreviewActive) return;

    const enforceLoop = () => {
      // When paused, use a slow setTimeout poll instead of tight rAF to save CPU.
      // Bug #134: Use separate timeout ref to avoid overwriting rAF ref
      if (!isPreviewPlayingRef.current) {
        segmentEnforceTimeoutRef.current = window.setTimeout(() => {
          segmentEnforceTimeoutRef.current = null;
          segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);
        }, 100);
        return;
      }
      // Skip enforcement during seek grace period — async seek hasn't
      // completed yet, so currentTime is stale from the previous segment.
      const inGrace = performance.now() - seekGraceTimestampRef.current < 200;
      if (!inGrace) {
        // Only the active slot plays; the idle slot is intentionally paused.
        const vid = previewSlotRefs.current[activeSlotRef.current];
        if (
          vid &&
          !vid.paused &&
          previewSegmentEndTimeRef.current != null &&
          vid.currentTime >= previewSegmentEndTimeRef.current
        ) {
          // Mirror the render engine: a segment shorter than its phrase slot is
          // LOOPED there (use_loop), so wrap to the in-point instead of freezing
          // on the last frame — the freeze read as stutter at every seam.
          const loopStart = previewSegmentStartTimeRef.current;
          if (loopStart != null) {
            seekGraceTimestampRef.current = performance.now();
            vid.currentTime = loopStart;
          } else {
            vid.pause();
          }
        }
      }
      segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);
    };
    segmentEnforceRafRef.current = requestAnimationFrame(enforceLoop);

    return () => {
      if (segmentEnforceRafRef.current != null) {
        cancelAnimationFrame(segmentEnforceRafRef.current);
        segmentEnforceRafRef.current = null;
      }
      // Bug #134: clear separate timeout ref
      if (segmentEnforceTimeoutRef.current != null) {
        clearTimeout(segmentEnforceTimeoutRef.current);
        segmentEnforceTimeoutRef.current = null;
      }
    };
  }, [isPreviewActive]);

  const togglePreviewPlayPause = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (isPreviewPlayingRef.current) {
      audio.pause();
      stopPreviewRafLoop();
      for (const vid of previewSlotRefs.current) {
        if (vid) vid.pause();
      }
      // Set ref synchronously to prevent 1-frame stale read in rAF loop
      isPreviewPlayingRef.current = false;
      setIsPreviewPlaying(false);
    } else {
      // Set ref synchronously before starting rAF loop
      isPreviewPlayingRef.current = true;
      setIsPreviewPlaying(true);
      // Re-seat the active slot on the current segment (a single seek is fine on
      // an explicit resume) and force the idle slot to re-stage next rAF tick.
      preparedNextForIndexRef.current = null;
      if (isPreviewIntro) {
        // The intro is visual-only: resume the voiceover from the same timeline
        // position so it remains audible under the rapid shots. The intro branch
        // deliberately pauses/holds the audio, so it can't use the play-then-loop
        // helper — keep its own play + loop start.
        audio.loop = false;
        audio.muted = false;
        audio.play().catch(() => {
          isPreviewPlayingRef.current = false;
          setIsPreviewPlaying(false);
        });
        introHeldTimelineTimeRef.current = null;
        if (!playIntroAt(audio.currentTime)) {
          audio.pause();
          introHeldTimelineTimeRef.current = audio.currentTime;
        }
        startPreviewRafLoop();
      } else {
        audio.loop = false;
        audio.muted = false;
        seatActiveSlot(previewActiveIndexRef.current, true);
        // Start the clock loop only after play() confirms — never against a
        // clock that isn't actually advancing (root fix for the frozen playhead).
        playAudioAndStartLoop(audio);
      }
    }
  }, [startPreviewRafLoop, stopPreviewRafLoop, seatActiveSlot, isPreviewIntro, playIntroAt, playAudioAndStartLoop]);

  const restartPreviewFromZero = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.pause();
    for (const video of previewSlotRefs.current) video?.pause();
    audio.currentTime = 0;
    setPreviewCurrentTime(0);
    setPreviewActiveIndex(0);
    previewActiveIndexRef.current = 0;
    preparedNextForIndexRef.current = null;
    const hasIntro = introOffsetSec > 0 && introSegments.length > 0;
    isPreviewPlayingRef.current = true;
    setIsPreviewPlaying(true);
    isPreviewIntroRef.current = hasIntro;
    setIsPreviewIntro(hasIntro);
    if (hasIntro) playIntroAt(0);
    else seatActiveSlot(0, false);
    audio.play().catch(() => {
      isPreviewPlayingRef.current = false;
      setIsPreviewPlaying(false);
    });
    if (!hasIntro) seatActiveSlot(0, true);
    startPreviewRafLoop();
  }, [introOffsetSec, introSegments.length, playIntroAt, seatActiveSlot, startPreviewRafLoop]);

  // Discrete user jump (prev/next, scrub-to-segment, segment click). A single
  // direct seek on the active slot is visually acceptable here; ping-pong only
  // needs to be seamless for AUTOMATIC boundary crossings.
  const jumpToIndex = useCallback((idx: number) => {
    const audio = previewAudioRef.current;
    const match = matchesRef.current[idx];
    if (!audio || !match) return;
    audio.loop = false;
    audio.muted = false;
    audio.currentTime = match.srt_start;
    const jumpsIntoIntro = match.srt_start < introOffsetSec && introSegments.length > 0;
    isPreviewIntroRef.current = jumpsIntoIntro;
    setIsPreviewIntro(jumpsIntoIntro);
    introHeldTimelineTimeRef.current = null;
    if (jumpsIntoIntro) {
      if (!playIntroAt(match.srt_start)) {
        audio.pause();
        introHeldTimelineTimeRef.current = match.srt_start;
      }
    }
    if (isPreviewPlayingRef.current && audio.paused && introHeldTimelineTimeRef.current == null) {
      audio.play().catch(() => {
        isPreviewPlayingRef.current = false;
        setIsPreviewPlaying(false);
      });
    }
    setPreviewCurrentTime(match.srt_start);
    setPreviewActiveIndex(idx);
    previewActiveIndexRef.current = idx;
    preparedNextForIndexRef.current = null;
    if (!jumpsIntoIntro) {
      seatActiveSlot(idx, isPreviewPlayingRef.current);
    }
  }, [introOffsetSec, introSegments.length, playIntroAt, seatActiveSlot]);

  const previewPrevSegment = useCallback(() => {
    if (previewActiveIndexRef.current <= 0) return;
    jumpToIndex(previewActiveIndexRef.current - 1);
  }, [jumpToIndex]);

  const previewNextSegment = useCallback(() => {
    if (previewActiveIndexRef.current >= matchesRef.current.length - 1) return;
    jumpToIndex(previewActiveIndexRef.current + 1);
  }, [jumpToIndex]);

  const seekPreviewToTime = useCallback((time: number) => {
    const audio = previewAudioRef.current;
    setPreviewCurrentTime(time);
    const newIdx = findActiveMatch(time);
    setPreviewActiveIndex(newIdx);
    previewActiveIndexRef.current = newIdx;

    // The timeline cursor is an editor control, so it must remain movable even
    // before the preview player has been activated. Keep the pending position in
    // React state without trying to seat media slots that are not mounted yet.
    if (!audio || !isPreviewActive) return;
    if (time < introOffsetSec) {
      audio.currentTime = time;
      audio.loop = false;
      audio.muted = false;
      if (isPreviewPlayingRef.current) {
        audio.play().catch(() => {
          isPreviewPlayingRef.current = false;
          setIsPreviewPlaying(false);
        });
      } else {
        audio.pause();
      }
      isPreviewIntroRef.current = true;
      setIsPreviewIntro(true);
      introHeldTimelineTimeRef.current = null;
      if (!playIntroAt(time)) {
        audio.pause();
        introHeldTimelineTimeRef.current = time;
      }
      const introMatchIndex = findActiveMatch(time);
      setPreviewActiveIndex(introMatchIndex);
      previewActiveIndexRef.current = introMatchIndex;
      return;
    }
    isPreviewIntroRef.current = false;
    setIsPreviewIntro(false);
    introHeldTimelineTimeRef.current = null;
    const audioTime = time;
    audio.loop = false;
    audio.muted = false;
    audio.currentTime = audioTime;
    if (isPreviewPlayingRef.current && audio.paused) {
      audio.play().catch(() => {
        isPreviewPlayingRef.current = false;
        setIsPreviewPlaying(false);
      });
    }
    preparedNextForIndexRef.current = null;
    // Scrub lands at an arbitrary audio time; seat the active slot at the
    // segment's start (video doesn't track sub-phrase position — same as before).
    seatActiveSlot(newIdx, isPreviewPlayingRef.current);
  }, [findActiveMatch, isPreviewActive, seatActiveSlot, introOffsetSec, playIntroAt]);

  const compositionEnd = displayedComposition.reduce(
    (maximum, clip) => Math.max(maximum, clip.timeline_start + clip.timeline_duration),
    0,
  );
  const subtitleEnd = matches.reduce((maximum, match) => Math.max(maximum, match.srt_end), 0);
  const attentionEnd = (attentionTimeline?.cues ?? []).reduce(
    (maximum, cue) => Math.max(maximum, (cue.startMs + cue.durationMs) / 1000),
    0,
  );
  const timelineDuration = Math.max(audioDuration, compositionEnd, subtitleEnd, attentionEnd, 0.05);
  timelineDurationRef.current = timelineDuration;

  useEffect(() => {
    updateTimelinePlayheadDOM(previewCurrentTime);
  }, [previewCurrentTime, timelineDuration, timelineZoom, updateTimelinePlayheadDOM]);

  const scheduleTimelineSeek = useCallback((time: number) => {
    pendingTimelineSeekRef.current = Math.max(0, Math.min(timelineDuration, time));
    if (timelineSeekRafRef.current !== null) return;
    timelineSeekRafRef.current = requestAnimationFrame(() => {
      timelineSeekRafRef.current = null;
      const pending = pendingTimelineSeekRef.current;
      pendingTimelineSeekRef.current = null;
      if (pending !== null) seekPreviewToTime(pending);
    });
  }, [seekPreviewToTime, timelineDuration]);

  const beginMultiTrackScrub = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (timelineDuration <= 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-timeline-block]")) return;
    const axis = (event.currentTarget as HTMLElement).closest("[data-timeline-axis]") as HTMLElement | null;
    if (!axis) return;

    event.preventDefault();
    const seekAt = (clientX: number) => {
      const rect = axis.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      scheduleTimelineSeek(ratio * timelineDuration);
    };
    seekAt(event.clientX);

    const handleMove = (moveEvent: PointerEvent) => seekAt(moveEvent.clientX);
    const handleUp = (upEvent: PointerEvent) => {
      seekAt(upEvent.clientX);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  }, [scheduleTimelineSeek, timelineDuration]);

  const setTimelineZoomAt = useCallback((nextZoom: number, clientX?: number) => {
    const viewport = multiTrackScrollRef.current;
    const normalizedZoom = Math.max(TIMELINE_MIN_ZOOM, Math.min(TIMELINE_MAX_ZOOM, nextZoom));
    if (!viewport) {
      setTimelineZoom(normalizedZoom);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const fitWidth = Math.max(
      TIMELINE_MIN_WIDTH,
      viewport.clientWidth - TIMELINE_LABEL_WIDTH - TIMELINE_END_GUTTER,
    );
    const oldLaneWidth = fitWidth * timelineZoom;
    const newLaneWidth = fitWidth * normalizedZoom;
    const localX = Math.min(rect.width, Math.max(TIMELINE_LABEL_WIDTH, (clientX ?? rect.left + rect.width / 2) - rect.left));
    const contentX = viewport.scrollLeft + localX - TIMELINE_LABEL_WIDTH;
    const timeRatio = Math.min(1, Math.max(0, contentX / Math.max(1, oldLaneWidth)));

    setTimelineZoom(normalizedZoom);
    requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, TIMELINE_LABEL_WIDTH + timeRatio * newLaneWidth - localX);
    });
  }, [timelineZoom]);

  useEffect(() => {
    const viewport = multiTrackScrollRef.current;
    if (!viewport || viewMode !== "timeline") return;
    const handleWheel = (event: WheelEvent) => {
      // Merely crossing the timeline while scrolling the preview page must not
      // hijack the page scroll. A pointer-down focuses this viewport (or one of
      // its controls), explicitly opting the user into timeline wheel controls.
      if (!viewport.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        viewport.scrollLeft += event.deltaX || event.deltaY;
        return;
      }
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setTimelineZoomAt(timelineZoom * factor, event.clientX);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [attentionTimeline, setTimelineZoomAt, timelineZoom, viewMode]);

  const handlePreviewSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    seekPreviewToTime(parseFloat(e.target.value));
  }, [seekPreviewToTime]);

  const activatePreview = useCallback(() => {
    if (!previewAudioSrc) return;

    // Call play() synchronously from the click handler. Chromium can reject a
    // first play() made later from canplay/seek callbacks because the transient
    // user activation has expired. Keep this authorized playback muted and
    // looping while the first video frame is prepared, then restart/unmute it.
    const primedAudio = previewAudioRef.current;
    if (primedAudio) {
      primedAudio.currentTime = 0;
      primedAudio.loop = true;
      primedAudio.muted = true;
      primedAudio.play().catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn("[TimelineEditor] Could not prime preview audio from the user gesture", error);
        }
      });
    }

    // Increment activation ID — any pending async work from previous activations
    // will check this and bail out if it's stale (prevents audio restarting after Stop).
    const thisActivation = ++activationIdRef.current;
    if (activationTimeoutRef.current != null) {
      clearTimeout(activationTimeoutRef.current);
      activationTimeoutRef.current = null;
    }

    seekGraceTimestampRef.current = performance.now();
    setIsPreviewActive(true);
    setPreviewActiveIndex(0);
    previewActiveIndexRef.current = 0;
    setPreviewCurrentTime(0);

    // Wait for React to mount the audio element, then wait for it to be playable.
    // Uses requestAnimationFrame to wait for the next render, then checks readyState.
    let attempts = 0;
    const tryStart = () => {
      if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
      const audio = previewAudioRef.current;
      if (!audio) {
        // Audio not mounted yet — retry next frame (React render pending)
        // Bug #117: cap retries to prevent infinite rAF loop on unmount
        if (++attempts > 100) return;
        requestAnimationFrame(tryStart);
        return;
      }

      const beginPlayback = () => {
        if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
        if (
          introOffsetSec > 0 &&
          introSegments.length > 0 &&
          !previewSlotRefs.current[0]
        ) {
          if (++attempts <= 100) requestAnimationFrame(beginPlayback);
          return;
        }
        audio.currentTime = 0;
        isPreviewPlayingRef.current = true;
        setIsPreviewPlaying(true);
        seekGraceTimestampRef.current = performance.now();

        // Reset the ping-pong slots for this activation. The <video> elements
        // were freshly (re)mounted, so slot 0 starts blank and must be loaded.
        activeSlotRef.current = 0;
        setActiveSlot(0);
        preparedNextForIndexRef.current = null;
        slotStateRef.current[0] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
        slotStateRef.current[1] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
        introSlotStateRef.current[0] = { preparedForIndex: null, preparationId: 0, ready: false };
        introSlotStateRef.current[1] = { preparedForIndex: null, preparationId: 0, ready: false };

        const firstMatch = matchesRef.current[0];

        if (introOffsetSec > 0 && introSegments.length > 0) {
          isPreviewIntroRef.current = true;
          setIsPreviewIntro(true);
          introActiveIndexRef.current = -1;
          introHeldTimelineTimeRef.current = null;
          setIsPreviewBuffering(true);

          let introStarted = false;
          const startIntroClock = () => {
            if (introStarted || activationIdRef.current !== thisActivation) return;
            introStarted = true;
            if (activationTimeoutRef.current != null) {
              clearTimeout(activationTimeoutRef.current);
              activationTimeoutRef.current = null;
            }
            introActiveIndexRef.current = 0;
            activeSlotRef.current = 0;
            applySlotVisibility(0);
            setActiveSlot(0);
            setIsPreviewBuffering(false);
            previewSlotRefs.current[0]?.play().catch(() => {});
            audio.currentTime = 0;
            audio.loop = false;
            audio.muted = false;
            playAudioAndStartLoop(audio, thisActivation);
          };

          prepareIntroSlot(0, 0, startIntroClock);
          if (introSegments.length > 1) {
            prepareIntroSlot(1, 1);
          } else {
            prepareSlot(1, findActiveMatch(introOffsetSec));
          }
          activationTimeoutRef.current = setTimeout(() => {
            activationTimeoutRef.current = null;
            if (introStarted || activationIdRef.current !== thisActivation) return;
            introStarted = true;
            console.warn("[TimelineEditor] Rapid intro media timed out; continuing with the body");
            isPreviewIntroRef.current = false;
            setIsPreviewIntro(false);
            setIsPreviewBuffering(false);
            audio.currentTime = 0;
            audio.loop = false;
            audio.muted = false;
            seatActiveSlot(0, true);
            playAudioAndStartLoop(audio, thisActivation);
          }, 5000);
          return;
        }

        // Start the audio + rAF loop. The loop stages the first cut when the
        // current media window enters its remaining-time lead window.
        const startAudioAndLoop = () => {
          if (activationIdRef.current !== thisActivation) return; // stale — user clicked Stop
          audio.currentTime = 0;
          audio.loop = false;
          audio.muted = false;
          // Only start the rAF clock loop once play() resolves — the loop reads
          // audio.currentTime as the master clock, so it must never spin against
          // a clock that isn't advancing (root fix for the frozen playhead).
          playAudioAndStartLoop(audio, thisActivation);
        };

        // Pre-seek the first segment into the ACTIVE slot BEFORE starting audio —
        // prevents an initial black-frame stall. This is the one unavoidable seek.
        if (firstMatch?.source_video_id && firstMatch.segment_start_time != null) {
          const targetTime = firstMatch.segment_start_time;
          setSegmentEndBoundary(firstMatch);
          loadSlotSource(0, firstMatch.source_video_id);
          slotStateRef.current[0].preparedForIndex = 0;
          let started = false;
          const onReady = () => {
            if (started) return;
            started = true;
            if (activationTimeoutRef.current != null) {
              clearTimeout(activationTimeoutRef.current);
              activationTimeoutRef.current = null;
            }
            if (activationIdRef.current !== thisActivation) return; // stale
            const el = previewSlotRefs.current[0];
            slotStateRef.current[0].segmentStartTime = targetTime;
            slotStateRef.current[0].ready = true;
            if (el && isPreviewPlayingRef.current) el.play().catch(() => {});
            startAudioAndLoop();
          };
          seekSlotTo(0, targetTime, onReady);
          // Safety timeout: don't block forever if the video fails to load.
          activationTimeoutRef.current = setTimeout(() => {
            activationTimeoutRef.current = null;
            if (activationIdRef.current !== thisActivation) return; // stale
            if (started) return;
            onReady();
          }, 3000);
        } else {
          startAudioAndLoop();
        }
      };

      // FE-12: Handle audio load errors gracefully
      audio.onerror = () => {
        console.warn("[TimelineEditor] Audio failed to load for preview playback");
        isPreviewPlayingRef.current = false;
        setIsPreviewPlaying(false);
        setIsPreviewActive(false);
      };

      if (audio.readyState >= 2) {
        // Already loaded (cached) — play immediately
        beginPlayback();
      } else {
        // Wait for audio to be playable
        const onCanPlay = () => {
          pendingCanPlayRef.current = null;
          audio.removeEventListener("canplay", onCanPlay);
          beginPlayback();
        };
        pendingCanPlayRef.current = onCanPlay;
        audio.addEventListener("canplay", onCanPlay);
        // Safety: if audio loads very fast between checks
        if (audio.readyState >= 2) {
          audio.removeEventListener("canplay", onCanPlay);
          beginPlayback();
        }
      }
    };
    requestAnimationFrame(tryStart);
  }, [applySlotVisibility, findActiveMatch, introOffsetSec, introSegments.length, loadSlotSource, prepareIntroSlot, prepareSlot, previewAudioSrc, seatActiveSlot, seekSlotTo, setSegmentEndBoundary, playAudioAndStartLoop]);

  const deactivatePreview = useCallback(() => {
    // Invalidate any pending async work from activatePreview (rAF retries, timeouts, event listeners)
    activationIdRef.current++;
    if (activationTimeoutRef.current != null) {
      clearTimeout(activationTimeoutRef.current);
      activationTimeoutRef.current = null;
    }
    stopPreviewRafLoop();
    const audio = previewAudioRef.current;
    if (audio) {
      audio.onerror = null;
      if (pendingCanPlayRef.current) {
        audio.removeEventListener("canplay", pendingCanPlayRef.current);
        pendingCanPlayRef.current = null;
      }
      audio.pause();
      audio.currentTime = 0;
      audio.loop = false;
      audio.muted = false;
    }
    for (const vid of previewSlotRefs.current) {
      if (vid) vid.pause();
    }
    isPreviewPlayingRef.current = false;
    setIsPreviewActive(false);
    setIsPreviewPlaying(false);
    setIsPreviewBuffering(false);
    setPreviewCurrentTime(0);
    isPreviewIntroRef.current = false;
    setIsPreviewIntro(false);
    introActiveIndexRef.current = -1;
    introHeldTimelineTimeRef.current = null;
    setPreviewActiveIndex(0);
    previewActiveIndexRef.current = 0;
    previewSegmentEndTimeRef.current = undefined;
    previewSegmentStartTimeRef.current = undefined;
    // Reset ping-pong state (slot <video> elements unmount with the preview block).
    activeSlotRef.current = 0;
    setActiveSlot(0);
    preparedNextForIndexRef.current = null;
    slotStateRef.current[0] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
    slotStateRef.current[1] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
    introSlotStateRef.current[0] = { preparedForIndex: null, preparationId: 0, ready: false };
    introSlotStateRef.current[1] = { preparedForIndex: null, preparationId: 0, ready: false };
  }, [stopPreviewRafLoop]);

  const focusTimelineKeyboardScope = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [contenteditable='true'], [role='button']")) return;
    event.currentTarget.focus({ preventScroll: true });
  }, []);

  const handleTimelineKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== " "
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.target !== event.currentTarget
    ) return;

    // Space scrolls the page when the scrub surface owns no keyboard action.
    // Once the user clicks the timeline, keep the shortcut scoped to this editor.
    event.preventDefault();
    if (event.repeat) return;
    if (isPreviewActive) togglePreviewPlayPause();
    else activatePreview();
  }, [activatePreview, isPreviewActive, togglePreviewPlayPause]);

  const handlePreviewSeekKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      event.key !== " "
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) return;

    // A focused range input otherwise lets Space scroll the page. Keep focus on
    // the seek control, but make the player shortcut behave like the Play button.
    event.preventDefault();
    if (event.repeat) return;
    if (isPreviewActive) togglePreviewPlayPause();
    else activatePreview();
  }, [activatePreview, isPreviewActive, togglePreviewPlayPause]);

  // Expanding/collapsing moves the preview into a different DOM subtree, so the
  // two <video> slots remount blank. Re-seat the active slot + re-stage the idle
  // one after the new elements bind their refs.
  useEffect(() => {
    if (!isPreviewActive) return;
    const raf = requestAnimationFrame(() => {
      if (!isPreviewActiveRef.current) return;
      slotStateRef.current[0] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
      slotStateRef.current[1] = { sourceVideoId: null, segmentStartTime: null, preparedForIndex: null, ready: false };
      introSlotStateRef.current[0] = { preparedForIndex: null, preparationId: 0, ready: false };
      introSlotStateRef.current[1] = { preparedForIndex: null, preparationId: 0, ready: false };
      activeSlotRef.current = activeSlot; // keep ref aligned with the visible slot
      preparedNextForIndexRef.current = null;
      seatActiveSlot(previewActiveIndexRef.current, isPreviewPlayingRef.current);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewExpanded]);

  // Seat the current segment's first frame while the preview is idle, so the
  // player shows a real frame instead of a black rectangle before Play. The
  // thumbnail_path <img> overlay is best-effort — its JPG is often missing or
  // still generating — so the paused video frame is the reliable poster.
  // activatePreview() fully resets the slots, so this never fights playback.
  // ponytail: eagerly loads one preview stream per visible card; if that ever
  // costs too much, gate on an IntersectionObserver so only on-screen cards seat.
  useEffect(() => {
    if (isPreviewActive) return;
    const match = playbackMatches[previewActiveIndex];
    if (!match?.source_video_id || match.segment_start_time == null || !profileId) return;
    const raf = requestAnimationFrame(() => {
      if (isPreviewActiveRef.current) return;
      activeSlotRef.current = activeSlot;
      seatActiveSlot(previewActiveIndex, false);
    });
    return () => cancelAnimationFrame(raf);
  }, [isPreviewActive, playbackMatches, previewActiveIndex, profileId, activeSlot, seatActiveSlot]);

  // Filtered segments: proximity ±2 rule + source filter + keyword search
  const filteredSegments = useMemo(() => {
    let pool = availableSegments;
    const assigningClipIndex = assigningClipId === null
      ? -1
      : displayedComposition.findIndex((clip) => clip.id === assigningClipId);

    // Source video filter
    if (sourceFilter === "same" && (assigningIndex !== null || assigningClipIndex >= 0)) {
      const currentSourceId = assigningClipIndex >= 0
        ? displayedComposition[assigningClipIndex]?.source_video_id
        : matches[assigningIndex!]?.source_video_id;
      if (currentSourceId) {
        pool = pool.filter(seg => seg.source_video_id === currentSourceId);
      }
    }

    // Proximity ±2: exclude segments already used at neighboring positions
    if (assigningIndex !== null || assigningClipIndex >= 0) {
      const nearbySegmentIds = new Set<string>();
      for (let offset = -2; offset <= 2; offset++) {
        if (offset === 0) continue;
        const neighborIdx = (assigningClipIndex >= 0 ? assigningClipIndex : assigningIndex!) + offset;
        if (assigningClipIndex >= 0 && neighborIdx >= 0 && neighborIdx < displayedComposition.length) {
          const neighborId = displayedComposition[neighborIdx].segment_id;
          if (neighborId) nearbySegmentIds.add(neighborId);
        } else if (assigningClipIndex < 0 && neighborIdx >= 0 && neighborIdx < matches.length) {
          const neighborId = matches[neighborIdx].segment_id;
          if (neighborId) nearbySegmentIds.add(neighborId);
        }
      }
      pool = pool.filter(seg => !nearbySegmentIds.has(seg.id));
    }

    // Keyword search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      pool = pool.filter(seg => seg.keywords.some(kw => kw.toLowerCase().includes(q)));
    }

    return pool;
  }, [availableSegments, assigningClipId, assigningIndex, displayedComposition, matches, searchQuery, sourceFilter]);

  // Count how many segments were excluded by proximity rule (for UI indicator)
  const proximityExcludedCount = useMemo(() => {
    const assigningClipIndex = assigningClipId === null
      ? -1
      : displayedComposition.findIndex((clip) => clip.id === assigningClipId);
    if (assigningIndex === null && assigningClipIndex < 0) return 0;
    const nearbySegmentIds = new Set<string>();
    for (let offset = -2; offset <= 2; offset++) {
      if (offset === 0) continue;
      const neighborIdx = (assigningClipIndex >= 0 ? assigningClipIndex : assigningIndex!) + offset;
      if (assigningClipIndex >= 0 && neighborIdx >= 0 && neighborIdx < displayedComposition.length) {
        const neighborId = displayedComposition[neighborIdx].segment_id;
        if (neighborId) nearbySegmentIds.add(neighborId);
      } else if (assigningClipIndex < 0 && neighborIdx >= 0 && neighborIdx < matches.length) {
        const neighborId = matches[neighborIdx].segment_id;
        if (neighborId) nearbySegmentIds.add(neighborId);
      }
    }
    return availableSegments.filter(seg => nearbySegmentIds.has(seg.id)).length;
  }, [availableSegments, assigningClipId, assigningIndex, displayedComposition, matches]);


  // --- Dialog handlers ---

  const handleOpenDialog = (matchIndex: number) => {
    setIsAddingCompositionClip(false);
    setAssigningIndex(matchIndex);
    setAssigningClipId(null);
    setSearchQuery("");
  };

  const handleOpenClipDialog = (clipId: string) => {
    setIsAddingCompositionClip(false);
    setAssigningClipId(clipId);
    setAssigningIndex(null);
    setSearchQuery("");
  };

  const handleOpenAddClipDialog = () => {
    setIsAddingCompositionClip(true);
    setAssigningClipId(null);
    setAssigningIndex(null);
    setSearchQuery("");
  };

  const handleCloseDialog = () => {
    setIsAddingCompositionClip(false);
    setAssigningIndex(null);
    setAssigningClipId(null);
    setSearchQuery("");
    setSourceFilter("all");
  };

  const handleSelectSegment = (segment: SegmentOption) => {
    if (isAddingCompositionClip) {
      const sourceStart = segment.start_time ?? 0;
      const sourceEnd = segment.end_time ?? sourceStart + Math.max(0.05, segment.duration);
      const timelineStart = displayedComposition.reduce(
        (maximum, clip) => Math.max(maximum, clip.timeline_start + clip.timeline_duration),
        0,
      );
      commitComposition([...displayedComposition, {
        id: crypto.randomUUID(),
        kind: "body",
        segment_id: segment.id,
        segment_keywords: segment.keywords,
        source_video_id: segment.source_video_id,
        thumbnail_path: segment.thumbnail_path,
        product_group: segment.product_group,
        start_time: sourceStart,
        end_time: Math.max(sourceStart + 0.05, sourceEnd),
        timeline_start: timelineStart,
        timeline_duration: Math.max(0.05, sourceEnd - sourceStart),
        transforms: segment.transforms,
        pinned: true,
      }]);
      handleCloseDialog();
      return;
    }
    if (assigningClipId !== null) {
      const sourceStart = segment.start_time ?? 0;
      const sourceEnd = segment.end_time ?? sourceStart + Math.max(0.05, segment.duration);
      const updated = displayedComposition.map((clip) => clip.id === assigningClipId
        ? {
            ...clip,
            segment_id: segment.id,
            segment_keywords: segment.keywords,
            source_video_id: segment.source_video_id,
            thumbnail_path: segment.thumbnail_path,
            product_group: segment.product_group,
            start_time: sourceStart,
            end_time: Math.max(sourceStart + 0.05, sourceEnd),
            transforms: segment.transforms,
            pinned: true,
          }
        : clip);
      commitComposition(updated);
      handleCloseDialog();
      return;
    }
    if (assigningIndex === null) return;

    // When swapping a segment, propagate to ALL entries in the same merge group.
    // The render collapse uses the first entry's segment for the whole group,
    // so all entries must agree for preview and render to match.
    const targetGroup = matches[assigningIndex]?.merge_group;
    const segmentFields = {
      segment_id: segment.id,
      segment_keywords: segment.keywords,
      matched_keyword: segment.keywords[0] ?? null,
      confidence: 1.0,
      source_video_id: segment.source_video_id,
      segment_start_time: segment.start_time,
      segment_end_time: segment.end_time,
      thumbnail_path: segment.thumbnail_path,
      product_group: segment.product_group,
      transforms: segment.transforms,
      is_auto_filled: false,
      pinned: true,
    };

    const updatedMatches = matches.map((match, idx) => {
      // Update the clicked entry AND all entries in the same merge group
      if (idx === assigningIndex) {
        return { ...match, ...segmentFields };
      }
      if (targetGroup != null && match.merge_group === targetGroup) {
        return { ...match, ...segmentFields };
      }
      return match;
    });

    onMatchesChange(updatedMatches);
    handleCloseDialog();
  };

  const rollCompositionBoundary = useCallback((
    clips: CompositionClip[],
    leftIndex: number,
    requestedDelta: number,
  ) => rollCompositionBoundaryPure(clips, leftIndex, requestedDelta, availableSegments),
  [availableSegments]);

  const beginCompositionRoll = (
    event: React.PointerEvent<HTMLSpanElement>,
    leftIndex: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const axis = event.currentTarget.closest("[data-timeline-axis]") as HTMLElement | null;
    if (!axis || timelineDuration <= 0) return;
    const startX = event.clientX;
    const original = displayedComposition.map((clip) => ({ ...clip }));
    let latest = original;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const update = (clientX: number) => {
      const delta = (clientX - startX) / Math.max(1, axis.clientWidth) * timelineDuration;
      latest = rollCompositionBoundary(original, leftIndex, delta);
      setCompositionDraft(latest);
    };
    const finish = (upEvent: PointerEvent) => {
      update(upEvent.clientX);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      commitComposition(latest);
    };
    const cancel = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setCompositionDraft(null);
    };
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const resizeCompositionEnd = useCallback((requestedDuration: number) => {
    if (displayedComposition.length === 0) return displayedComposition;
    const lastIndex = displayedComposition.length - 1;
    return reflowComposition(displayedComposition.map((clip, index) => index === lastIndex
      ? {
          ...clip,
          timeline_duration: Math.max(0.1, Math.min(3600, requestedDuration)),
          pinned: true,
        }
      : clip));
  }, [displayedComposition]);

  const beginCompositionEndResize = (
    event: React.PointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const axis = event.currentTarget.closest("[data-timeline-axis]") as HTMLElement | null;
    const lastClip = displayedComposition.at(-1);
    if (!axis || !lastClip) return;
    const startX = event.clientX;
    const originalDuration = lastClip.timeline_duration;
    const dragScaleDuration = Math.max(0.05, timelineDurationRef.current);
    let latest = displayedComposition;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const update = (clientX: number) => {
      const delta = (clientX - startX) / Math.max(1, axis.clientWidth) * dragScaleDuration;
      latest = resizeCompositionEnd(originalDuration + delta);
      setCompositionDraft(latest);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const finish = (upEvent: PointerEvent) => {
      update(upEvent.clientX);
      cleanup();
      commitComposition(latest);
    };
    const cancel = () => {
      cleanup();
      setCompositionDraft(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  const moveCompositionClip = useCallback((clipId: string, direction: -1 | 1) => {
    const currentIndex = displayedComposition.findIndex((clip) => clip.id === clipId);
    if (currentIndex < 0) return;
    const kind = displayedComposition[currentIndex].kind;
    let targetIndex = currentIndex + direction;
    while (
      targetIndex >= 0 &&
      targetIndex < displayedComposition.length &&
      displayedComposition[targetIndex].kind !== kind
    ) {
      targetIndex += direction;
    }
    if (targetIndex < 0 || targetIndex >= displayedComposition.length) return;
    const updated = [...displayedComposition];
    const [moved] = updated.splice(currentIndex, 1);
    updated.splice(targetIndex, 0, moved);
    commitComposition(updated);
  }, [commitComposition, displayedComposition]);

  // Pointer-driven video move. Unlike native HTML drag-and-drop, this keeps a
  // real clip preview under the cursor and works consistently while playback is
  // active. V1 remains magnetic; upper video tracks use absolute positioning.
  // Audio/subtitle lanes are deliberately invalid targets.
  const beginCompositionClipDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    clip: CompositionClip,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const originAxis = event.currentTarget.closest("[data-magnetic-lane]") as HTMLElement | null;
    if (!originAxis) return;

    const pointerStartX = event.clientX;
    const pointerStartY = event.clientY;
    const total = Math.max(0.05, timelineDurationRef.current);
    const originRect = originAxis.getBoundingClientRect();
    const pointerTime = ((event.clientX - originRect.left) / Math.max(1, originRect.width)) * total;
    const grabOffset = Math.max(0, Math.min(clip.timeline_duration, pointerTime - clip.timeline_start));
    const sourceIndex = displayedComposition.findIndex((candidate) => candidate.id === clip.id);
    if (sourceIndex < 0) return;

    const snapPoints = [
      ...matches.flatMap((match) => [match.srt_start, match.srt_end]),
      ...displayedComposition.flatMap((candidate) => [
        candidate.timeline_start,
        candidate.timeline_start + candidate.timeline_duration,
      ]),
    ];
    const snapStart = (value: number, disabled: boolean) => {
      if (disabled) return value;
      const nearest = snapPoints.reduce(
        (best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best,
        value,
      );
      return Math.abs(nearest - value) <= 0.15 ? nearest : value;
    };
    const clampToFreeTrack = (requestedStart: number, targetTrack: number) => {
      const duration = clip.timeline_duration;
      const maximumStart = Math.max(0, total - duration);
      const requested = Math.max(0, Math.min(maximumStart, requestedStart));
      const siblings = displayedOverlays
        .filter((candidate) => candidate.id !== clip.id && (candidate.track ?? 2) === targetTrack)
        .sort((a, b) => a.timeline_start - b.timeline_start);
      const candidates: number[] = [requested, 0, maximumStart];
      for (const sibling of siblings) {
        candidates.push(sibling.timeline_start - duration, sibling.timeline_start + sibling.timeline_duration);
      }
      const fits = (start: number) => siblings.every((sibling) => (
        start + duration <= sibling.timeline_start + 0.0001
        || start >= sibling.timeline_start + sibling.timeline_duration - 0.0001
      ));
      return candidates
        .map((candidate) => Math.max(0, Math.min(maximumStart, candidate)))
        .filter(fits)
        .sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested))[0] ?? requested;
    };

    type DragTarget = { targetTrack: number; timelineStart: number; insertIndex?: number };
    let armed = false;
    let latestTarget: DragTarget | null = null;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const update = (moveEvent: PointerEvent) => {
      if (!armed && Math.hypot(moveEvent.clientX - pointerStartX, moveEvent.clientY - pointerStartY) < 4) return;
      if (!armed) {
        armed = true;
        suppressCompositionClickRef.current = true;
        setCompositionDragId(clip.id);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      moveEvent.preventDefault();

      const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const magneticAxis = element?.closest("[data-magnetic-lane]") as HTMLElement | null;
      const magneticEndGutter = element?.closest("[data-magnetic-end-gutter]") as HTMLElement | null;
      const freeVideoAxis = element?.closest('[data-track-kind="video"][data-track-index]') as HTMLElement | null;

      if (magneticAxis || magneticEndGutter) {
        const introCount = displayedComposition.filter((candidate) => candidate.kind === "intro").length;
        const time = magneticEndGutter
          ? total
          : Math.min(total, Math.max(0, (
              (moveEvent.clientX - magneticAxis!.getBoundingClientRect().left)
              / Math.max(1, magneticAxis!.getBoundingClientRect().width)
            ) * total));
        let insertIndex = magneticEndGutter
          ? displayedComposition.length
          : displayedComposition.filter((candidate) => (
              candidate.timeline_start + candidate.timeline_duration / 2 < time
            )).length;
        insertIndex = clip.kind === "intro"
          ? Math.min(insertIndex, introCount)
          : Math.max(insertIndex, introCount);
        const boundaryTime = insertIndex >= displayedComposition.length
          ? displayedComposition.reduce(
              (maximum, candidate) => Math.max(maximum, candidate.timeline_start + candidate.timeline_duration),
              0,
            )
          : displayedComposition[insertIndex].timeline_start;
        const timelineStart = Math.max(0, Math.min(total - clip.timeline_duration, time - grabOffset));
        latestTarget = { targetTrack: 1, timelineStart, insertIndex };
        setLiveCompositionDropTarget({ index: insertIndex, time: boundaryTime });
        setVideoClipDragPreview({ clip, targetTrack: 1, timelineStart });
        return;
      }

      if (freeVideoAxis) {
        const hoveredTrack = Number(freeVideoAxis.getAttribute("data-track-index"));
        if (Number.isFinite(hoveredTrack) && hoveredTrack >= 2) {
          const rect = freeVideoAxis.getBoundingClientRect();
          const time = ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * total;
          const timelineStart = clampToFreeTrack(
            snapStart(time - grabOffset, moveEvent.altKey),
            clampOverlayTrack(hoveredTrack),
          );
          latestTarget = { targetTrack: clampOverlayTrack(hoveredTrack), timelineStart };
          setLiveCompositionDropTarget(null);
          setVideoClipDragPreview({ clip, targetTrack: latestTarget.targetTrack, timelineStart });
          return;
        }
      }

      // Incompatible lane (audio, subtitles, or outside the timeline): make the
      // invalid drop explicit and preserve the clip's original position.
      latestTarget = null;
      setLiveCompositionDropTarget(null);
      setVideoClipDragPreview(null);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setCompositionDragId(null);
      setLiveCompositionDropTarget(null);
      setVideoClipDragPreview(null);
      if (armed) {
        window.setTimeout(() => {
          suppressCompositionClickRef.current = false;
        }, 0);
      }
    };
    const finish = (upEvent: PointerEvent) => {
      if (armed) update(upEvent);
      const target = latestTarget;
      cleanup();
      if (!armed || !target) return;
      if (target.targetTrack >= 2) {
        convertClipToOverlay(clip.id, target.targetTrack, target.timelineStart);
        return;
      }
      const insertIndex = target.insertIndex;
      if (insertIndex == null || insertIndex === sourceIndex || insertIndex === sourceIndex + 1) return;
      const updated = [...displayedComposition];
      const [moved] = updated.splice(sourceIndex, 1);
      updated.splice(insertIndex > sourceIndex ? insertIndex - 1 : insertIndex, 0, moved);
      commitComposition(updated);
    };
    const cancel = () => cleanup();
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cancel();
    };
    window.addEventListener("pointermove", update, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKeyDown);
  };

  // ── Phase C: free video overlays (V2..Vn) ──────────────────────────────────
  const MAX_FREE_OVERLAYS = 50;
  const OVERLAY_TRACKS = [2, 3, 4] as const;
  const clampOverlayTrack = (track: number) => Math.min(4, Math.max(2, Math.round(track)));

  // Boundary index in the magnetic sequence for an absolute output time (used
  // when converting an overlay back into V1). Mirrors the pointer target math.
  const magneticInsertionAt = (timeSec: number) => {
    const introCount = displayedComposition.filter((clip) => clip.kind === "intro").length;
    const raw = displayedComposition.filter(
      (clip) => clip.timeline_start + clip.timeline_duration / 2 < timeSec,
    ).length;
    return Math.max(raw, introCount);
  };

  // V1 clip block → overlay track: keep its absolute timeline_start, default the
  // box to full-frame contain, force body/no-transition; V1 reflows closed.
  const convertClipToOverlay = (clipId: string, trackIndex: number, timelineStart?: number) => {
    const clip = displayedComposition.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    if (overlayClips.length >= MAX_FREE_OVERLAYS) {
      toast.error(`Overlay limit reached (${MAX_FREE_OVERLAYS} free clips).`);
      return;
    }
    const { transitionIn: _drop, ...rest } = clip;
    const overlay: CompositionClip = {
      ...rest,
      kind: "body",
      track: clampOverlayTrack(trackIndex),
      timeline_start: timelineStart ?? clip.timeline_start,
      overlay_box: { ...DEFAULT_OVERLAY_BOX },
    };
    const nextMagnetic = displayedComposition.filter((candidate) => candidate.id !== clipId);
    emitTimeline([...nextMagnetic, ...overlayClips, overlay]);
    setSelectedClipId(overlay.id);
  };

  // Overlay clip → V1: strip overlay fields, splice into the magnetic sequence at
  // the boundary the cursor is over, reflow closed.
  const convertOverlayToMagnetic = (clipId: string, insertIndex: number) => {
    const clip = overlayClips.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const { track: _t, overlay_box: _b, transitionIn: _tr, ...rest } = clip;
    const magnetic: CompositionClip = { ...rest, kind: "body" };
    const nextMagnetic = [...displayedComposition];
    nextMagnetic.splice(Math.min(insertIndex, nextMagnetic.length), 0, magnetic);
    const nextOverlays = overlayClips.filter((candidate) => candidate.id !== clipId);
    emitTimeline([...nextMagnetic, ...nextOverlays]);
    setSelectedClipId(magnetic.id);
  };

  // Inspector writes for a selected overlay (box/fit/track). Routed through the
  // same persist path as every other edit.
  const updateOverlayClip = (clipId: string, patch: Partial<CompositionClip>) => {
    emitTimeline([
      ...displayedComposition,
      ...overlayClips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    ]);
  };
  const removeOverlayClip = (clipId: string) => {
    emitTimeline([...displayedComposition, ...overlayClips.filter((clip) => clip.id !== clipId)]);
    if (selectedClipId === clipId) setSelectedClipId(null);
  };

  // Pointer-drag an overlay clip: move (with vertical track change / drop-to-V1),
  // or trim either edge. Snaps to subtitle boundaries + V1 cuts (Alt disables);
  // clamps to no-overlap with siblings on the target track; min duration 0.05s.
  const beginOverlayTimingDrag = (
    event: React.PointerEvent,
    clip: CompositionClip,
    edge: "move" | "resize" | "resize-start",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const laneEl = (event.currentTarget as HTMLElement).closest("[data-track-index]") as HTMLElement | null;
    if (!laneEl) return;
    const startX = event.clientX;
    const total = Math.max(0.05, timelineDurationRef.current);
    const originStart = clip.timeline_start;
    const originDur = clip.timeline_duration;
    const originSrcStart = clip.start_time;
    const originSrcEnd = clip.end_time;
    const originTrack = clip.track ?? 2;
    const originRect = laneEl.getBoundingClientRect();
    const pointerTime = ((event.clientX - originRect.left) / Math.max(1, originRect.width)) * total;
    const grabOffset = Math.max(0, Math.min(originDur, pointerTime - originStart));
    const snapPts = [
      ...matches.flatMap((m) => [m.srt_start, m.srt_end]),
      ...displayedComposition.flatMap((c) => [c.timeline_start, c.timeline_start + c.timeline_duration]),
    ];
    const snap = (value: number, disabled: boolean) => {
      if (disabled) return value;
      const nearest = snapPts.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), value);
      return Math.abs(nearest - value) <= 0.15 ? nearest : value;
    };
    // Clamp `start` (for `dur`) into the gap around the origin on `trackIdx` so a
    // moved/trimmed overlay never overlaps a sibling.
    const clampStart = (start: number, dur: number, trackIdx: number) => {
      let lo = 0;
      let hi = Math.max(0, total - dur);
      for (const s of displayedOverlays) {
        if (s.id === clip.id || (s.track ?? 2) !== trackIdx) continue;
        const sStart = s.timeline_start;
        const sEnd = s.timeline_start + s.timeline_duration;
        if (sEnd <= originStart) lo = Math.max(lo, sEnd);
        else if (sStart >= originStart + originDur) hi = Math.min(hi, sStart - dur);
      }
      return Math.max(lo, Math.min(hi, Math.max(0, start)));
    };

    let pendingV1: { index: number; time: number } | null = null;
    let draftTrack = originTrack;
    let latest: CompositionClip[] = displayedOverlays;
    let validMoveTarget = edge !== "move";
    const setClip = (patch: Partial<CompositionClip>) => {
      latest = displayedOverlays.map((o) => (o.id === clip.id ? { ...o, ...patch } : o));
      setOverlayDraft(latest);
    };

    const onMove = (moveEvent: PointerEvent) => {
      const deltaSec = (moveEvent.clientX - startX) / Math.max(1, laneEl.clientWidth) * total;
      // Which lane is the cursor over? Magnetic V1 → convert target; image track → track change.
      const el = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
      const overV1 = el?.closest("[data-magnetic-lane]") as HTMLElement | null;
      const overImage = el?.closest('[data-track-kind="video"][data-track-index]') as HTMLElement | null;

      if (edge === "move" && overV1) {
        // Hovering the V1 lane: show the magnetic insertion indicator instead of
        // repositioning the overlay; a drop here converts it into V1.
        const rect = overV1.getBoundingClientRect();
        const t = Math.min(total, Math.max(0, ((moveEvent.clientX - rect.left) / Math.max(1, rect.width)) * total));
        const index = magneticInsertionAt(t);
        const time = index >= displayedComposition.length ? total : displayedComposition[index].timeline_start;
        pendingV1 = { index, time };
        validMoveTarget = true;
        setLiveCompositionDropTarget({ index, time });
        setVideoClipDragPreview({
          clip,
          targetTrack: 1,
          timelineStart: Math.max(0, Math.min(total - originDur, t - grabOffset)),
        });
        return;
      }
      pendingV1 = null;
      setLiveCompositionDropTarget(null);
      setVideoClipDragPreview(null);

      if (edge === "resize") {
        const dur = Math.max(0.05, snap(originStart + originDur + deltaSec, moveEvent.altKey) - originStart);
        const start = clampStart(originStart, dur, draftTrack);
        setClip({ timeline_start: start, timeline_duration: dur, end_time: originSrcStart + dur, track: draftTrack });
      } else if (edge === "resize-start") {
        const rightEdge = originStart + originDur;
        const start = Math.max(0, Math.min(snap(originStart + deltaSec, moveEvent.altKey), rightEdge - 0.05));
        const srcStart = Math.max(0, originSrcStart + (start - originStart));
        setClip({ timeline_start: start, timeline_duration: rightEdge - start, start_time: srcStart, end_time: originSrcEnd, track: draftTrack });
      } else {
        // move: horizontal reposition + vertical track change over an image lane.
        const hovered = overImage ? Number(overImage.getAttribute("data-track-index")) : NaN;
        if (!Number.isFinite(hovered) || hovered < 2) {
          validMoveTarget = false;
          latest = displayedOverlays;
          setOverlayDraft(displayedOverlays);
          return;
        }
        validMoveTarget = true;
        draftTrack = clampOverlayTrack(hovered);
        const start = clampStart(snap(originStart + deltaSec, moveEvent.altKey), originDur, draftTrack);
        setClip({ timeline_start: start, track: draftTrack });
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setLiveCompositionDropTarget(null);
      setVideoClipDragPreview(null);
    };
    const onUp = () => {
      cleanup();
      if (pendingV1) {
        convertOverlayToMagnetic(clip.id, pendingV1.index);
        return;
      }
      if (!validMoveTarget) {
        setOverlayDraft(null);
        return;
      }
      emitTimeline([...displayedComposition, ...latest]);
    };
    const onCancel = () => {
      cleanup();
      setOverlayDraft(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const nudgeCompositionSource = (clipId: string, edge: "in" | "out", delta: number) => {
    const clip = displayedComposition.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const library = availableSegments.find((segment) => segment.id === clip.segment_id);
    const minimumStart = library?.start_time ?? 0;
    const maximumEnd = library?.end_time ?? Math.max(clip.end_time, clip.end_time + Math.max(0, delta));
    const updated = displayedComposition.map((candidate) => {
      if (candidate.id !== clipId) return candidate;
      if (edge === "in") {
        return {
          ...candidate,
          start_time: Math.min(
            candidate.end_time - 0.05,
            Math.max(minimumStart, candidate.start_time + delta),
          ),
          pinned: true,
        };
      }
      return {
        ...candidate,
        end_time: Math.max(
          candidate.start_time + 0.05,
          Math.min(maximumEnd, candidate.end_time + delta),
        ),
        pinned: true,
      };
    });
    commitComposition(updated);
  };

  // Transitions V1: boundary popover writes. `next === undefined` clears the
  // override so the clip inherits the variant default again (the sentinel the
  // data model already uses); `null` is an explicit hard-cut override; an
  // object is an explicit transition override. Routed through the same
  // commitComposition path as every other clip edit, so save/undo see it.
  const setBoundaryTransition = useCallback((clipId: string, next: TransitionSpec | null | undefined) => {
    const updated = displayedComposition.map((candidate) => {
      if (candidate.id !== clipId) return candidate;
      if (next === undefined) {
        const { transitionIn: _drop, ...rest } = candidate;
        return rest;
      }
      return { ...candidate, transitionIn: next };
    });
    commitComposition(updated);
  }, [commitComposition, displayedComposition]);

  // Premiere-style transition move: drag a boundary's transition block to
  // another boundary. The origin becomes an explicit cut so the transition
  // visibly *moves* (not duplicates) even when it came from the variant
  // default. A sub-threshold drag is treated as a click → popover opens.
  const [transitionDragTarget, setTransitionDragTarget] = useState<number | null>(null);
  const suppressTransitionClickRef = useRef(false);
  const beginTransitionDrag = (
    event: React.PointerEvent,
    originIdx: number,
    spec: TransitionSpec,
  ) => {
    if (event.button !== 0) return;
    const axis = (event.currentTarget as HTMLElement).closest("[data-timeline-axis]") as HTMLElement | null;
    if (!axis || timelineDuration <= 0) return;
    const startX = event.clientX;
    const rect = axis.getBoundingClientRect();
    const eligible = displayedComposition
      .map((clip, idx) => ({ idx, time: clip.timeline_start, kind: clip.kind }))
      .filter((b) => b.idx > 0 && b.kind !== "intro");
    if (eligible.length === 0) return;
    let target = originIdx;
    let engaged = false;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    const update = (clientX: number) => {
      if (!engaged && Math.abs(clientX - startX) < 5) return;
      if (!engaged) {
        engaged = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      const t = ((clientX - rect.left) / Math.max(1, rect.width)) * timelineDuration;
      let best = eligible[0];
      for (const b of eligible) {
        if (Math.abs(b.time - t) < Math.abs(best.time - t)) best = b;
      }
      target = best.idx;
      setTransitionDragTarget(best.idx);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setTransitionDragTarget(null);
    };
    const finish = (upEvent: PointerEvent) => {
      update(upEvent.clientX);
      cleanup();
      if (!engaged) return; // plain click → let the popover open
      suppressTransitionClickRef.current = true;
      if (target === originIdx) return;
      const fromId = displayedComposition[originIdx].id;
      const toId = displayedComposition[target].id;
      commitComposition(displayedComposition.map((candidate) => {
        if (candidate.id === fromId) return { ...candidate, transitionIn: null };
        if (candidate.id === toId) return { ...candidate, transitionIn: spec };
        return candidate;
      }));
    };
    const cancel = () => cleanup();
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };

  // --- Drag-and-drop handlers ---

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear if leaving the row entirely (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...matches];

    // Swap segment assignments between dragged and dropped positions
    // SRT text/timing stays in place — only the segment mapping moves
    const dragSegment = {
      segment_id: updated[dragIndex].segment_id,
      segment_keywords: updated[dragIndex].segment_keywords,
      matched_keyword: updated[dragIndex].matched_keyword,
      confidence: updated[dragIndex].confidence,
      is_auto_filled: updated[dragIndex].is_auto_filled,
      product_group: updated[dragIndex].product_group,
      source_video_id: updated[dragIndex].source_video_id,
      segment_start_time: updated[dragIndex].segment_start_time,
      segment_end_time: updated[dragIndex].segment_end_time,
      thumbnail_path: updated[dragIndex].thumbnail_path,
      transforms: updated[dragIndex].transforms,
      pinned: true,
    };
    const dropSegment = {
      segment_id: updated[dropIndex].segment_id,
      segment_keywords: updated[dropIndex].segment_keywords,
      matched_keyword: updated[dropIndex].matched_keyword,
      confidence: updated[dropIndex].confidence,
      is_auto_filled: updated[dropIndex].is_auto_filled,
      product_group: updated[dropIndex].product_group,
      source_video_id: updated[dropIndex].source_video_id,
      segment_start_time: updated[dropIndex].segment_start_time,
      segment_end_time: updated[dropIndex].segment_end_time,
      thumbnail_path: updated[dropIndex].thumbnail_path,
      transforms: updated[dropIndex].transforms,
      pinned: true,
    };

    updated[dragIndex] = { ...updated[dragIndex], ...dropSegment };
    updated[dropIndex] = { ...updated[dropIndex], ...dragSegment };

    onMatchesChange(updated);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  // --- Duration adjustment handlers ---

  const adjustDuration = (index: number, delta: number) => {
    const match = matches[index];
    const naturalDuration = match.srt_end - match.srt_start;
    const currentDuration = match.duration_override ?? naturalDuration;
    const newDuration = Math.max(0.5, Math.min(10, currentDuration + delta));
    const updated = [...matches];
    updated[index] = { ...updated[index], duration_override: newDuration };
    onMatchesChange(updated);
  };

  // --- Trim (in/out point) adjustment ---
  // Nudges segment_start_time / segment_end_time within the source video.
  // Propagates to the whole merge group (render collapse uses the first entry's
  // segment for the group), same as handleSelectSegment.

  const adjustTrim = (index: number, edge: "in" | "out", delta: number) => {
    const match = matches[index];
    if (!match?.segment_id) return;
    const start = match.segment_start_time ?? 0;
    const end = match.segment_end_time ?? start + 0.5;

    // Clamp within the segment's library bounds when known.
    const lib = availableSegments.find((s) => s.id === match.segment_id);
    const minStart = lib?.start_time ?? 0;
    const maxEnd = lib?.end_time ?? end + 10;

    let newStart = start;
    let newEnd = end;
    if (edge === "in") {
      // Keep at least a 0.5s window and stay within library bounds.
      newStart = Math.min(Math.max(minStart, start + delta), end - 0.5);
    } else {
      newEnd = Math.max(Math.min(maxEnd, end + delta), start + 0.5);
    }
    if (newStart === start && newEnd === end) return;

    const targetGroup = match.merge_group;
    const updated = matches.map((m, idx) => {
      if (idx === index || (targetGroup != null && m.merge_group === targetGroup)) {
        return {
          ...m,
          segment_start_time: newStart,
          segment_end_time: newEnd,
          pinned: true,
        };
      }
      return m;
    });
    onMatchesChange(updated);
  };

  // --- Pin handlers ---
  // Manual swaps/drags pin an assignment so re-running assembly won't touch it.
  // Users can click the pin indicator to release it back to auto-assignment.

  const handleTogglePin = (index: number) => {
    const updated = [...matches];
    updated[index] = { ...updated[index], pinned: !updated[index].pinned };
    onMatchesChange(updated);
  };

  // --- Interstitial slide handlers ---

  const handleInsertSlide = (afterMatchIndex: number, track?: number) => {
    if (!onInterstitialSlidesChange && !onAttentionTimelineChange) return;
    const newSlide: InterstitialSlide = {
      id: crypto.randomUUID(),
      afterMatchIndex,
      imageUrl: "",
      duration: 2.0,
      animation: "kenburns",
      kenBurnsDirection: "zoom-in",
      productTitle: "",
      track,
    };
    const updated = [...interstitialSlides, newSlide];
    emitSlides(updated);
    setSelectedSlideId(newSlide.id);
    setSelectedBlockIndex(null);
    setSelectedClipId(null);
  };

  const handleUpdateSlide = (slideId: string, changes: Partial<InterstitialSlide>) => {
    if (!onInterstitialSlidesChange && !onAttentionTimelineChange) return;
    const updated = interstitialSlides.map((s) =>
      s.id === slideId ? { ...s, ...changes } : s
    );
    emitSlides(updated);
  };

  const handleRemoveSlide = (slideId: string) => {
    if (!onInterstitialSlidesChange && !onAttentionTimelineChange) return;
    const updated = interstitialSlides.filter((s) => s.id !== slideId);
    emitSlides(updated);
    if (selectedSlideId === slideId) setSelectedSlideId(null);
  };

  // --- Video preview effect for timeline view ---
  useEffect(() => {
    if (viewMode !== "timeline" || selectedBlockIndex === null) return;
    const match = matches[selectedBlockIndex];
    if (!match || !videoRef.current) return;

    const video = videoRef.current;
    const sourceVideoId = match.source_video_id;
    const startTime = match.segment_start_time ?? 0;
    // Respect merge_group_duration — don't play beyond what the render will use.
    // Without this, a 5s segment plays fully even if only 2.8s is needed.
    let endTime = match.segment_end_time;
    if (match.merge_group_duration != null && match.segment_start_time != null) {
      const mergeEnd = match.segment_start_time + match.merge_group_duration;
      // If segment_end_time exists, cap by it. If not, use mergeEnd alone.
      endTime = endTime != null ? Math.min(mergeEnd, endTime) : mergeEnd;
    }

    // Change src when source_video_id or start time changes (handles same-source segments)
    if (sourceVideoId && (sourceVideoId !== lastSourceVideoId.current || startTime !== lastStartTime.current) && profileId) {
      lastSourceVideoId.current = sourceVideoId;
      lastStartTime.current = startTime;
      video.src = getPreviewStreamUrl(sourceVideoId);
      video.load();
    }

    // rAF enforcement loop (60fps) replaces timeupdate (4Hz) to prevent ~250ms overshoot
    let enforcementRaf: number | null = null;
    const enforceEnd = () => {
      if (endTime !== undefined && video.currentTime >= endTime) {
        video.pause();
        enforcementRaf = null;
        return;
      }
      enforcementRaf = requestAnimationFrame(enforceEnd);
    };

    // FE-13: Start enforcement once — triggered by play, not duplicated outside.
    const startPlayAndEnforce = () => {
      video.currentTime = startTime;
      video.play().catch(() => {});
      // Cancel any previous enforcement before starting new one
      if (enforcementRaf != null) cancelAnimationFrame(enforcementRaf);
      enforcementRaf = requestAnimationFrame(enforceEnd);
    };

    const handleLoaded = () => {
      startPlayAndEnforce();
    };

    video.addEventListener("loadeddata", handleLoaded);

    // If video is already loaded (same source), just seek and play
    if (video.readyState >= 2) {
      startPlayAndEnforce();
    }

    return () => {
      video.removeEventListener("loadeddata", handleLoaded);
      if (enforcementRaf != null) cancelAnimationFrame(enforcementRaf);
      video.pause();
    };
  }, [viewMode, selectedBlockIndex, matches, profileId, getPreviewStreamUrl]);

  if (matches.length === 0 && composition.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Film className="size-4 mr-2" />
        No SRT phrases to display.
      </div>
    );
  }

  // Determine dialog title based on context
  const isSwapMode =
    (assigningIndex !== null && matches[assigningIndex]?.segment_id !== null) ||
    (assigningClipId !== null && displayedComposition.some(
      (clip) => clip.id === assigningClipId && Boolean(clip.segment_id),
    ));
  const dialogTitle = isAddingCompositionClip ? "Add Video Clip" : isSwapMode ? "Swap Segment" : "Select Segment";
  const dialogSubLabel = isAddingCompositionClip
    ? "Adding to V1"
    : assigningClipId !== null
      ? "Replacing timeline clip"
      : isSwapMode ? "Swapping segment for phrase" : "Assigning to phrase";

  // Calculate total duration for proportional widths in timeline view
  const bodyDuration = timelineDuration;
  const totalDuration = bodyDuration;
  const previewTotalDuration = previewDuration || audioDuration;

  // Selected match for inline preview
  const selectedMatch = selectedBlockIndex !== null ? matches[selectedBlockIndex] : null;
  const selectedClip = selectedClipId === null
    ? null
    : displayedComposition.find((clip) => clip.id === selectedClipId) ?? null;
  const selectedOverlay = selectedClipId === null
    ? null
    : displayedOverlays.find((clip) => clip.id === selectedClipId) ?? null;
  const monitorHighestVideoTrack = Math.max(
    2,
    minimumVideoTrackCount,
    ...attentionCues.map((cue) => cue.track ?? 2),
    ...displayedOverlays.map((clip) => clip.track ?? 2),
  );
  const monitorSubtitleTrack = monitorHighestVideoTrack + 1;

  const renderPreviewSubtitleOverlay = (minimumFontSize: number, containerHeight: number) => {
    if (subtitleSettings?.enabled === false) return null;
    if (hiddenVideoTracks.has(monitorSubtitleTrack)) return null;
    const activeMatch = matches.find(
      (match) => match.srt_start <= previewCurrentTime && previewCurrentTime < match.srt_end,
    ) ?? null;
    if (!activeMatch?.srt_text || containerHeight <= 0) return null;

    const fontSize = scaleSubtitleFontPx(
      subtitleSettings?.fontSize ?? 48,
      containerHeight,
      minimumFontSize
    );
    const outlineWidth = scaleSubtitlePx(
      subtitleSettings?.outlineWidth ?? 3,
      containerHeight,
      0
    );
    const shadowDepth = scaleSubtitlePx(
      subtitleSettings?.shadowDepth ?? 0,
      containerHeight,
      0
    );
    const glowBlur = scaleSubtitlePx(
      subtitleSettings?.glowBlur ?? 0,
      containerHeight,
      0
    );
    const letterSpacing = scaleSubtitlePx(
      subtitleSettings?.letterSpacing ?? 0,
      containerHeight,
      -Infinity
    );
    const opacity = Math.max(0, Math.min(100, subtitleSettings?.opacity ?? 100)) / 100;
    const baseShadow = shadowDepth > 0
      ? `0 ${shadowDepth}px ${Math.max(1, shadowDepth * 2)}px ${subtitleSettings?.shadowColor ?? "#000000"}`
      : "0 1px 3px rgba(0,0,0,0.85)";
    const glowShadow = subtitleSettings?.enableGlow && glowBlur > 0
      ? `, 0 0 ${glowBlur}px ${subtitleSettings?.outlineColor ?? "#000000"}`
      : "";
    const positionY = subtitleSettings?.positionY ?? 85;
    const positionStyle: React.CSSProperties = positionY <= 20
      ? { top: `${positionY}%` }
      : { top: `${positionY}%`, transform: "translateY(-50%)" };

    return (
      <div
        className="absolute left-2 right-2 z-[50] pointer-events-none"
        style={{ ...positionStyle, textAlign: subtitleSettings?.horizontalAlignment ?? "center" }}
      >
        <PreviewSubtitleOverlayText
          match={activeMatch}
          subtitleSettings={subtitleSettings}
          previewCurrentTime={previewCurrentTime}
          audioRef={previewAudioRef}
          isPlaying={isPreviewPlaying}
          textStyle={{
            fontFamily: subtitleSettings?.fontFamily ?? "var(--font-montserrat), Montserrat, sans-serif",
            fontSize: `${fontSize}px`,
            opacity,
            textShadow: `${baseShadow}${glowShadow}`,
            WebkitTextStroke: outlineWidth > 0
              ? `${outlineWidth}px ${subtitleSettings?.outlineColor ?? "#000000"}`
              : undefined,
            paintOrder: "stroke fill",
            letterSpacing: `${letterSpacing}px`,
          }}
        />
      </div>
    );
  };

  const renderAttentionOverlays = () => {
    if (!attentionTimeline) return null;
    const nowMs = previewCurrentTime * 1000;
    return attentionCues.flatMap((cue) => {
      if (hiddenVideoTracks.has(cue.track ?? 2)) return [];
      if (nowMs < cue.startMs || nowMs >= cue.startMs + cue.durationMs) return [];
      return cue.layers.map((layer) => {
        const url = layer.assetUrl || layer.assetId;
        const localMs = nowMs - cue.startMs - layer.animation.delayMs;
        if (!url || localMs < 0) return null;
        const duration = Math.max(1, cue.durationMs - layer.animation.delayMs);
        return (
          <img
            key={`${cue.id}:${layer.id}`}
            src={url}
            alt=""
            className={`pointer-events-none absolute attention-${layer.animation.preset}`}
            style={{
              left: `${layer.x * 100}%`, top: `${layer.y * 100}%`,
              width: `${layer.width * 100}%`, height: `${layer.height * 100}%`,
              objectFit: layer.fit,
              opacity: layer.opacity ?? 1,
              // Front zone always sits above subtitles (60+); behind-zone cues
              // stack by track so a higher image track composites in front.
              zIndex: (cue.zone === "front" ? 60 : 10 + ((cue.track ?? 2) - 2) * 20) + layer.zIndex,
              animationDuration: `${duration}ms`,
              ["--attention-intensity" as string]: layer.animation.intensity,
            }}
          />
        );
      });
    });
  };

  // Phase C preview: positioned box overlays for free video clips. Fallback
  // variant — no live <video> (that would need syncing into the delicate V1
  // double-buffer engine); a poster thumbnail + outline placed by overlay_box
  // stands in, and the server-rendered preview gives full fidelity. The active
  // clip (window contains the playhead) is filled; the selected clip always
  // shows a dashed outline so its placement is visible while editing.
  const renderOverlayClipBoxes = () => {
    if (displayedOverlays.length === 0) return null;
    const now = previewCurrentTime;
    return displayedOverlays.map((clip) => {
      if (hiddenVideoTracks.has(clip.track ?? 2)) return null;
      const active = now >= clip.timeline_start && now < clip.timeline_start + clip.timeline_duration;
      const isSelected = selectedClipId === clip.id;
      if (!active && !isSelected) return null;
      const box = clip.overlay_box ?? DEFAULT_OVERLAY_BOX;
      const thumb = clip.thumbnail_path ? segmentFileUrl(mediaApiUrl, clip.thumbnail_path) : null;
      return (
        <div
          key={`overlay-box-${clip.id}`}
          data-testid={`overlay-preview-${clip.id}`}
          className={`pointer-events-none absolute overflow-hidden ${
            isSelected ? "ring-2 ring-sky-300" : "ring-1 ring-sky-300/50"
          } ${active ? "" : "border border-dashed border-sky-300/70"}`}
          style={{
            left: `${box.x * 100}%`, top: `${box.y * 100}%`,
            width: `${box.width * 100}%`, height: `${box.height * 100}%`,
            // Composite over V1 (z 1) and behind-zone cues; higher track in front.
            zIndex: 30 + ((clip.track ?? 2) - 2) * 2,
            opacity: active ? 1 : 0.45,
          }}
        >
          {active && thumb && (
            <img src={thumb} alt="" className="h-full w-full" style={{ objectFit: box.fit }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
          )}
        </div>
      );
    });
  };

  return (
    /* In "full" mode the root is an NLE grid with two draggable splitters:
       inspector | program monitor above, timeline below. The nested containers
       use `display: contents` so their panels become direct grid items; card
       mode keeps the original flow layout. */
    <div
      ref={displayMode === "full" ? fullLayoutRef : undefined}
      className={
        displayMode === "full"
          ? "grid h-full min-h-0 overflow-hidden bg-border"
          : "contents"
      }
      style={displayMode === "full" ? {
        gridTemplateColumns: `${fullInspectorWidth}px 2px minmax(0, 1fr)`,
        gridTemplateRows: `auto minmax(0, 1fr) 2px ${fullTimelineHeight}px`,
      } : undefined}
    >
      {/* Preload audio as soon as preview is possible — mounted before isPreviewActive
          so it has time to load before user clicks Play Preview */}
      {canPreview && (
        <audio
          ref={previewAudioRef}
          src={previewAudioSrc ?? undefined}
          muted={mutedAudioTracks.has(1)}
          preload="auto"
          style={{ display: "none" }}
        />
      )}

      {displayMode === "full" && (
        <>
          <div
            role="separator"
            aria-label="Resize clip settings panel"
            aria-orientation="vertical"
            aria-valuenow={Math.round(fullInspectorWidth)}
            tabIndex={0}
            className="relative z-30 col-start-2 row-start-2 cursor-col-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2"
            onPointerDown={(event) => beginFullLayoutResize(event, "inspector")}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setFullInspectorWidth((width) => Math.min(640, Math.max(220, width + (event.key === "ArrowRight" ? 16 : -16))));
            }}
          />
          <div
            role="separator"
            aria-label="Resize timeline panel"
            aria-orientation="horizontal"
            aria-valuenow={Math.round(fullTimelineHeight)}
            tabIndex={0}
            className="relative z-30 col-span-3 row-start-3 cursor-row-resize bg-border transition-colors hover:bg-primary focus-visible:bg-primary focus-visible:outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2"
            onPointerDown={(event) => beginFullLayoutResize(event, "timeline")}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              setFullTimelineHeight((height) => Math.min(640, Math.max(140, height + (event.key === "ArrowUp" ? 16 : -16))));
            }}
          />
        </>
      )}

      {/* Inline continuous preview player */}
      {canPreview && pipelineId && variantIndex !== undefined && profileId && (
        <>
          {!isPreviewExpanded && (
            <div
              className={`relative bg-card overflow-hidden ${
                displayMode === "full"
                  ? "col-start-3 row-start-2 flex min-h-0 flex-col"
                  : /* -mt-3 collapses against CardContent's space-y-3 so the player
                       sits flush under the divider line of the row above; negative
                       mx bleeds through CardContent's px-6 / px-4 padding. */
                    "-mt-3 -mx-6 min-[1280px]:-mx-4"
              }`}
            >
              <div
                ref={displayMode === "card" ? compactPreviewStageRef : undefined}
                data-testid={displayMode === "card" ? "compact-preview-stage" : undefined}
                className={`relative flex justify-center overflow-hidden ${displayMode === "full" ? "min-h-0 flex-1 items-center" : ""}`}
                style={displayMode === "full" ? { containerType: "size" } : undefined}
              >
                {/* Video display with subtitle overlay */}
                <div
                  ref={compactPreviewMeasurement.ref}
                  data-testid={displayMode === "full" ? "full-preview-frame" : undefined}
                  className={`group relative isolate flex items-center justify-center overflow-hidden bg-black ${
                    displayMode === "full" ? "shrink-0" : ""
                  }`}
                  style={displayMode === "full" ? fullPreviewFrameStyle : compactPreviewFrameStyle}
                >
                  {/* Ping-pong double-buffer: two fixed slots; src set imperatively in
                      prepareSlot/seatActiveSlot. Visibility follows the active slot. */}
                  {[0, 1].map((slot) => (
                  <video
                    key={`slot-${slot}`}
                    ref={(el) => setPreviewSlotRef(slot, el)}
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 w-full h-full object-cover"
                    onWaiting={() => setIsPreviewBuffering(true)}
                    onPlaying={() => setIsPreviewBuffering(false)}
                    onSeeked={() => setIsPreviewBuffering(false)}
                    style={{
                      display: "block",
                      opacity:
                        !hiddenVideoTracks.has(1) && activeSlot === slot && (isPreviewIntro || playbackMatches[previewActiveIndex]?.source_video_id)
                          ? 1
                          : 0,
                      zIndex: activeSlot === slot ? 1 : 0,
                      transform: previewVideoTransform(
                        matches[previewSlotMatchIndexes[slot] ?? -1]?.transforms
                      ),
                    }}
                  />
                  ))}

                {/* Transitions V1: instant-preview fade overlay, above video/thumbnail,
                    below attention cues (z>=10) and subtitles (z-50). */}
                <div ref={registerTransitionOverlay} aria-hidden className="pointer-events-none absolute inset-0 z-[5]" style={{ opacity: 0 }} />

                {!isPreviewActive && (
                  <>
                    {!hiddenVideoTracks.has(1) && playbackMatches[previewActiveIndex]?.thumbnail_path && (
                      <img
                        src={segmentFileUrl(mediaApiUrl, playbackMatches[previewActiveIndex].thumbnail_path!)}
                        alt=""
                        className="absolute inset-0 z-[5] h-full w-full object-cover"
                        onError={(event) => { event.currentTarget.style.display = "none"; }}
                      />
                    )}
                    {isPreviewAudioLoading && (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                        <Loader2 className="size-6 animate-spin text-white" />
                      </div>
                    )}
                  </>
                )}

                {onRenderPreview && (
                  <Button
                    variant="secondary"
                    size="icon"
                    className="pointer-events-none absolute right-2 top-2 z-20 size-8 opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                    onClick={() => {
                      if (isPreviewActive) deactivatePreview();
                      onRenderPreview();
                    }}
                    aria-label="Open rendered preview"
                    title="Open rendered preview"
                  >
                    <Film className="size-4" />
                  </Button>
                )}

                {/* Buffering indicator */}
                {isPreviewBuffering && isPreviewPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
                    <Loader2 className="size-6 animate-spin text-white" />
                  </div>
                )}

                {/* No video fallback */}
                {!isPreviewIntro && !playbackMatches[previewActiveIndex]?.source_video_id && (
                  <div className="flex items-center justify-center text-muted-foreground text-sm">
                    No video for this segment
                  </div>
                )}

                {/* Subtitle overlay — respects subtitleSettings if provided */}
                {renderOverlayClipBoxes()}
                {renderAttentionOverlays()}
                {safeZone && <SafeZoneOverlay type={safeZone} />}
                  {renderPreviewSubtitleOverlay(8, compactPreviewMeasurement.height)}
                </div>

                {displayMode === "card" && previewTopLeftAccessory && (
                  <div
                    ref={compactPreviewAccessoryRef}
                    className="absolute z-20"
                    style={{
                      left: compactPreviewAccessoryPosition.x,
                      top: compactPreviewAccessoryPosition.y,
                    }}
                    onPointerDown={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("[data-preview-accessory-drag-handle]")) {
                        beginCompactPreviewAccessoryDrag(event);
                      }
                    }}
                  >
                    {previewTopLeftAccessory}
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className={`shrink-0 space-y-1.5 px-3 py-2 ${displayMode === "full" ? "mx-auto w-full max-w-xl" : ""}`}>
                {/* Progress bar */}
                <input
                  type="range"
                  aria-label="Preview position"
                  aria-keyshortcuts="Space"
                  min={0}
                  max={previewTotalDuration || 1}
                  step={0.1}
                  value={previewCurrentTime}
                  onChange={handlePreviewSeek}
                  onKeyDown={handlePreviewSeekKeyDown}
                  disabled={!isPreviewActive}
                  className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary disabled:cursor-default disabled:opacity-45"
                />

                {/* Time + segment info + buttons */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                    {formatTime(previewCurrentTime)} / {formatTime(previewTotalDuration)}
                  </span>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={isPreviewActive ? restartPreviewFromZero : activatePreview}
                      disabled={!isPreviewActive && (isPreviewAudioLoading || !previewAudioSrc)}
                      title="Replay from beginning"
                      aria-label="Replay from beginning"
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={previewPrevSegment}
                      disabled={!isPreviewActive || previewActiveIndex <= 0}
                      title="Previous segment"
                    >
                      <SkipBack className="size-3.5" />
                    </Button>
                    <Button
                      variant="default"
                      size="icon"
                      className="size-8"
                      onClick={isPreviewActive ? togglePreviewPlayPause : activatePreview}
                      disabled={!isPreviewActive && (isPreviewAudioLoading || !previewAudioSrc)}
                      title={previewAudioLoadFailed ? "Preview audio could not be loaded" : isPreviewPlaying ? "Pause" : "Play"}
                      aria-label={isPreviewPlaying ? "Pause preview" : "Play preview"}
                    >
                      {isPreviewPlaying ? (
                        <Pause className="size-4" />
                      ) : (
                        <Play className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={previewNextSegment}
                      disabled={!isPreviewActive || previewActiveIndex >= playbackMatches.length - 1}
                      title="Next segment"
                    >
                      <SkipForward className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => setIsPreviewExpanded(true)}
                      title="Expand preview"
                    >
                      <Maximize2 className="size-3.5" />
                    </Button>
                  </div>

                  <span className="text-[11px] text-muted-foreground">
                    {previewActiveIndex + 1}/{playbackMatches.length}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Dialog open={isPreviewExpanded} onOpenChange={setIsPreviewExpanded}>
            <DialogContent className="w-[min(96vw,1200px)] max-w-[1200px] sm:max-w-[1200px] p-0 overflow-hidden">
              <DialogHeader className="px-6 pt-6 pb-0">
                <DialogTitle>Expanded Preview</DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-6">
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div
                    ref={expandedPreviewMeasurement.ref}
                    className="group relative isolate mx-auto flex items-center justify-center overflow-hidden bg-black"
                    style={expandedPreviewFrameStyle}
                  >
                    {/* Ping-pong double-buffer (expanded view) — same two slots,
                        re-staged when this dialog mounts (see isPreviewExpanded effect). */}
                    {[0, 1].map((slot) => (
                      <video
                        key={`expanded-slot-${slot}`}
                        ref={(el) => setPreviewSlotRef(slot, el)}
                        muted
                        playsInline
                        preload="auto"
                        className="absolute inset-0 w-full h-full object-cover"
                        onWaiting={() => setIsPreviewBuffering(true)}
                        onPlaying={() => setIsPreviewBuffering(false)}
                        onSeeked={() => setIsPreviewBuffering(false)}
                        style={{
                          display: "block",
                          opacity:
                            !hiddenVideoTracks.has(1) && activeSlot === slot && (isPreviewIntro || playbackMatches[previewActiveIndex]?.source_video_id)
                              ? 1
                              : 0,
                          zIndex: activeSlot === slot ? 1 : 0,
                          transform: previewVideoTransform(
                            matches[previewSlotMatchIndexes[slot] ?? -1]?.transforms
                          ),
                        }}
                      />
                    ))}

                    {/* Transitions V1: instant-preview fade overlay (expanded view). */}
                    <div ref={registerTransitionOverlay} aria-hidden className="pointer-events-none absolute inset-0 z-[5]" style={{ opacity: 0 }} />

                    {!isPreviewActive && (
                      <>
                        {!hiddenVideoTracks.has(1) && playbackMatches[previewActiveIndex]?.thumbnail_path && (
                          <img
                            src={segmentFileUrl(mediaApiUrl, playbackMatches[previewActiveIndex].thumbnail_path!)}
                            alt=""
                            className="absolute inset-0 z-[5] h-full w-full object-cover"
                            onError={(event) => { event.currentTarget.style.display = "none"; }}
                          />
                        )}
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/35">
                          <Button
                            variant="secondary"
                            size="icon"
                            className="size-14 rounded-full shadow-lg"
                            onClick={activatePreview}
                            disabled={isPreviewAudioLoading || !previewAudioSrc}
                            aria-label="Play preview"
                            title={previewAudioLoadFailed ? "Preview audio could not be loaded" : undefined}
                          >
                            {isPreviewAudioLoading
                              ? <Loader2 className="size-6 animate-spin" />
                              : <Play className="size-6 fill-current" />}
                          </Button>
                        </div>
                      </>
                    )}

                    {onRenderPreview && (
                      <Button
                        variant="secondary"
                        size="icon"
                        className="pointer-events-none absolute right-3 top-3 z-20 size-9 opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                        onClick={() => {
                          if (isPreviewActive) deactivatePreview();
                          onRenderPreview();
                        }}
                        aria-label="Open rendered preview"
                        title="Open rendered preview"
                      >
                        <Film className="size-4" />
                      </Button>
                    )}

                    {isPreviewBuffering && isPreviewPlaying && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-10">
                        <Loader2 className="size-8 animate-spin text-white" />
                      </div>
                    )}

                    {!isPreviewIntro && !playbackMatches[previewActiveIndex]?.source_video_id && (
                      <div className="flex items-center justify-center text-muted-foreground text-sm">
                        No video for this segment
                      </div>
                    )}

                    {renderOverlayClipBoxes()}
                    {renderAttentionOverlays()}
                    {safeZone && <SafeZoneOverlay type={safeZone} />}
                    {renderPreviewSubtitleOverlay(10, expandedPreviewMeasurement.height)}
                  </div>

                  <div className="px-4 py-3 space-y-2">
                    <input
                      type="range"
                      aria-label="Preview position"
                      aria-keyshortcuts="Space"
                      min={0}
                      max={previewTotalDuration || 1}
                      step={0.1}
                      value={previewCurrentTime}
                      onChange={handlePreviewSeek}
                      onKeyDown={handlePreviewSeekKeyDown}
                      disabled={!isPreviewActive}
                      className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary disabled:cursor-default disabled:opacity-45"
                    />

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground font-mono tabular-nums">
                        {formatTime(previewCurrentTime)} / {formatTime(previewTotalDuration)}
                      </span>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={isPreviewActive ? restartPreviewFromZero : activatePreview}
                          disabled={!isPreviewActive && (isPreviewAudioLoading || !previewAudioSrc)}
                          title="Replay from beginning"
                          aria-label="Replay from beginning"
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={previewPrevSegment}
                          disabled={!isPreviewActive || previewActiveIndex <= 0}
                          title="Previous segment"
                        >
                          <SkipBack className="size-4" />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          className="size-9"
                          onClick={isPreviewActive ? togglePreviewPlayPause : activatePreview}
                          disabled={!isPreviewActive && (isPreviewAudioLoading || !previewAudioSrc)}
                          title={isPreviewPlaying ? "Pause" : "Play"}
                        >
                          {isPreviewPlaying ? (
                            <Pause className="size-4" />
                          ) : (
                            <Play className="size-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={previewNextSegment}
                          disabled={!isPreviewActive || previewActiveIndex >= playbackMatches.length - 1}
                          title="Next segment"
                        >
                          <SkipForward className="size-4" />
                        </Button>
                      </div>

                      <span className="text-xs text-muted-foreground">
                        {previewActiveIndex + 1}/{playbackMatches.length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Full editor: center pane fallback when this variant has no playable media. */}
      {displayMode === "full" && !canPreview && (
          <div className="col-start-3 row-start-2 flex min-h-0 flex-col items-center justify-center gap-3 overflow-hidden bg-card">
            <span className="px-4 text-center text-sm text-muted-foreground">
              Preview unavailable for this variant
            </span>
          </div>
        )}

      {/* Full editor: left inspector placeholder when nothing is selected */}
      {displayMode === "full" &&
        (viewMode !== "timeline" ||
          (selectedSlideId === null && !selectedClip && !selectedOverlay && !selectedMusic && (selectedBlockIndex === null || !selectedMatch))) && (
          <div className="col-start-1 row-start-2 min-h-0 overflow-y-auto bg-card p-4">
            <p className="text-center text-sm text-muted-foreground">Select a clip on the timeline to edit its settings here</p>
          </div>
        )}

      {viewMode === "timeline" ? (
        /* ========== TIMELINE VIEW ========== */
        <div className={displayMode === "full" ? "contents" : "space-y-3"}>
          {totalDuration > 0 && (() => {
            /* ========== MULTI-TRACK TIMELINE ==========
               One shared time axis (0..totalDuration — the voiceover clock).
               Every lane positions blocks as a % of that axis, so rows stay
               aligned by construction; the grid scrolls horizontally as one. */
            const pct = (sec: number) => `${(Math.min(Math.max(sec, 0), totalDuration) / totalDuration) * 100}%`;
            const widthPct = (sec: number) => `${(Math.max(sec, 0) / totalDuration) * 100}%`;
            const fitLaneWidth = Math.max(
              TIMELINE_MIN_WIDTH,
              timelineViewportWidth - TIMELINE_LABEL_WIDTH - TIMELINE_END_GUTTER,
            );
            const laneWidth = Math.round(fitLaneWidth * timelineZoom);
            timelineLaneWidthRef.current = laneWidth;
            const smoothPlayheadStyle: React.CSSProperties = {
              left: 0,
              transform: "translate3d(var(--timeline-playhead-x, 0px), 0, 0)",
              willChange: "transform",
            };
            const sfxCues = attentionCues.filter(cue => cue.sfxAssetId || cue.sfxUrl);

            const canInsertSlide = !!(onInterstitialSlidesChange || onAttentionTimelineChange);
            const overlayTrackIndices = displayedOverlays.map((clip) => clip.track ?? 2);
            const tracks = deriveTracks(attentionCues, minimumVideoTrackCount, overlayTrackIndices);
            const highestOverlayTrack = tracks.video[0]?.index ?? 2;
            const subtitleTrackIndex = highestOverlayTrack + 1;
            const baseAudioTrackCount = sfxCues.length > 0 ? 3 : 2;
            const highestAudioTrack = Math.max(baseAudioTrackCount, minimumAudioTrackCount);
            const addVideoTrack = () => {
              setMinimumVideoTrackCount((count) => Math.max(count, highestOverlayTrack) + 1);
            };
            const removeVideoTrack = (trackIndex: number) => {
              const hasCues = cuesOnTrack(attentionCues, trackIndex).length > 0;
              const hasOverlays = displayedOverlays.some((clip) => (clip.track ?? 2) === trackIndex);
              const isHighestSessionTrack = trackIndex === highestOverlayTrack
                && trackIndex === minimumVideoTrackCount
                && trackIndex > 2;
              if (hasCues || hasOverlays || !isHighestSessionTrack) return;
              setMinimumVideoTrackCount((count) => Math.max(2, count - 1));
            };
            const addAudioTrack = () => {
              setMinimumAudioTrackCount((count) => Math.max(count, highestAudioTrack) + 1);
            };
            const removeAudioTrack = (trackIndex: number) => {
              const isHighestEmptySessionTrack = trackIndex === highestAudioTrack
                && trackIndex === minimumAudioTrackCount
                && trackIndex > baseAudioTrackCount;
              if (!isHighestEmptySessionTrack) return;
              setMinimumAudioTrackCount((count) => Math.max(2, count - 1));
            };
            const trackControls = ({
              id,
              kind,
              index,
              addMedia,
              addMediaUnavailable,
              canDelete = false,
              deleteUnavailable,
              onDelete,
            }: {
              id: string;
              kind: "video" | "audio";
              index: number;
              addMedia?: () => void;
              addMediaUnavailable?: string;
              canDelete?: boolean;
              deleteUnavailable?: string;
              onDelete?: () => void;
            }) => {
              const monitored = kind === "video"
                ? !hiddenVideoTracks.has(index)
                : !mutedAudioTracks.has(index);
              return (
                <TimelineTrackControls
                  id={id}
                  kind={kind}
                  monitored={monitored}
                  onMonitorChange={() => kind === "video"
                      ? toggleVideoTrackVisibility(index)
                      : toggleAudioTrackMute(index)}
                  addMedia={addMedia}
                  addMediaUnavailable={addMediaUnavailable}
                  onAddTrack={kind === "video" ? addVideoTrack : addAudioTrack}
                  canDelete={canDelete}
                  deleteUnavailable={deleteUnavailable}
                  onDelete={onDelete}
                />
              );
            };
            // Image tracks Vn..V2, top-to-bottom (V1 is the magnetic video lane).
            const imageTracks = tracks.video.filter((track) => !track.magnetic);
            type LaneDef = {
              label: string;
              description?: string;
              height: string;
              heightPx?: number;
              onHeightChange?: (height: number) => void;
              attention?: boolean;
              trackKind?: "video" | "audio";
              trackIndex?: number;
              magneticLane?: boolean;
              stub?: boolean;
              action?: React.ReactNode;
              meta?: React.ReactNode;
              content: React.ReactNode;
              endGutterProps?: React.HTMLAttributes<HTMLDivElement> & {
                "data-magnetic-end-gutter"?: string;
              };
            };
            const lanes: LaneDef[] = [
              // Subtitles — burned in above everything, always the top lane.
              {
                label: `V${subtitleTrackIndex}`,
                description: "Subtitles",
                height: "h-8",
                trackKind: "video",
                action: trackControls({
                  id: `V${subtitleTrackIndex}`,
                  kind: "video",
                  index: subtitleTrackIndex,
                  addMediaUnavailable: "Subtitle blocks are generated from the transcript",
                  deleteUnavailable: "The subtitle track is required",
                }),
                content: matches.map((match) => (
                  <button
                    type="button"
                    key={match.srt_index}
                    data-timeline-block
                    className="absolute inset-y-1 overflow-hidden rounded border border-foreground/15 bg-foreground/5 px-1 text-left leading-tight hover:bg-foreground/10"
                    style={{ left: pct(match.srt_start), width: widthPct(Math.max(0.05, match.srt_end - match.srt_start)) }}
                    title={match.srt_text}
                    onClick={() => { if (isPreviewActive) seekPreviewToTime(match.srt_start); }}
                  >
                    {match.srt_text}
                  </button>
                )),
              },
              // Image tracks Vn..V2 (z-order: higher track composites in front).
              ...imageTracks.map((track): LaneDef => ({
                label: `V${track.index}`,
                height: "h-9",
                attention: true,
                trackKind: "video",
                trackIndex: track.index,
                action: trackControls({
                  id: track.id,
                  kind: "video",
                  index: track.index,
                  addMedia: canInsertSlide ? () => handleInsertSlide(selectedBlockIndex ?? -1, track.index) : undefined,
                  addMediaUnavailable: "Media insertion is unavailable for this timeline",
                  canDelete: track.index === minimumVideoTrackCount
                    && track.index === highestOverlayTrack
                    && track.index > 2
                    && cuesOnTrack(attentionCues, track.index).length === 0
                    && displayedOverlays.every((clip) => (clip.track ?? 2) !== track.index),
                  deleteUnavailable: "Move or remove this track's clips before deleting it",
                  onDelete: () => removeVideoTrack(track.index),
                }),
                content: (
                  <>
                    <ImageLane
                      cues={cuesOnTrack(attentionCues, track.index)}
                      trackIndex={track.index}
                      pct={pct}
                      widthPct={widthPct}
                      onBeginTimingDrag={beginCueTimingDrag}
                      onSelectCue={(cueId) => {
                        setSelectedSlideId(cueId);
                        setSelectedClipId(null);
                        setSelectedBlockIndex(null);
                        setSelectedMusic(false);
                      }}
                      showEmptyHint={track.index === 2 && displayedOverlays.every((o) => (o.track ?? 2) !== 2)}
                    />
                    <OverlayLane
                      clips={displayedOverlays.filter((o) => (o.track ?? 2) === track.index)}
                      mediaApiUrl={mediaApiUrl}
                      pct={pct}
                      widthPct={widthPct}
                      selectedClipId={selectedClipId}
                      onSelectClip={(clipId) => {
                        setSelectedClipId(clipId === selectedClipId ? null : clipId);
                        setSelectedSlideId(null);
                        setSelectedBlockIndex(null);
                        setSelectedMusic(false);
                      }}
                      onBeginTimingDrag={beginOverlayTimingDrag}
                    />
                    {videoClipDragPreview?.targetTrack === track.index && (
                      <VideoClipDragPreview
                        preview={videoClipDragPreview}
                        mediaApiUrl={mediaApiUrl}
                        left={pct(videoClipDragPreview.timelineStart)}
                        width={widthPct(videoClipDragPreview.clip.timeline_duration)}
                      />
                    )}
                  </>
                ),
              })),
              // V1 — the magnetic main-video lane.
              {
                label: "V1",
                description: "Main video",
                height: "h-16",
                trackKind: "video",
                magneticLane: true,
                action: trackControls({
                  id: "V1",
                  kind: "video",
                  index: 1,
                  addMedia: availableSegments.length > 0 ? handleOpenAddClipDialog : undefined,
                  addMediaUnavailable: "No video segments are available",
                  deleteUnavailable: "The main video track is required",
                }),
                endGutterProps: {
                  "aria-label": "Drop clip at end of V1",
                  "data-magnetic-end-gutter": "",
                },
                content: (
                  <VideoLane
                    clips={displayedComposition}
                    mediaApiUrl={mediaApiUrl}
                    pct={pct}
                    widthPct={widthPct}
                    selectedClipId={selectedClipId}
                    isPreviewActive={isPreviewActive}
                    previewActiveIndex={previewActiveIndex}
                    compositionDragId={compositionDragId}
                    compositionDropTarget={compositionDropTarget}
                    dragPreview={videoClipDragPreview}
                    transitionBoundaries={transitionBoundaries}
                    transitionDragTarget={transitionDragTarget}
                    suppressTransitionClickRef={suppressTransitionClickRef}
                    onSelectClip={(clipId) => {
                      setSelectedClipId(clipId === selectedClipId ? null : clipId);
                      setSelectedBlockIndex(null);
                      setSelectedSlideId(null);
                      setSelectedMusic(false);
                    }}
                    onJumpToIndex={jumpToIndex}
                    onClipPointerDown={beginCompositionClipDrag}
                    suppressClipClickRef={suppressCompositionClickRef}
                    onRollPointerDown={beginCompositionRoll}
                    onEndResizePointerDown={beginCompositionEndResize}
                    onBoundaryChange={setBoundaryTransition}
                    onBoundaryDragStart={beginTransitionDrag}
                  />
                ),
              },
              // A1 — the TTS voiceover waveform.
              {
                label: "A1",
                description: "Voiceover",
                height: "h-10",
                trackKind: "audio",
                trackIndex: 1,
                action: trackControls({
                  id: "A1",
                  kind: "audio",
                  index: 1,
                  addMediaUnavailable: "A1 is generated from the project voiceover",
                }),
                content: (
                  <>
                    <div
                      className="absolute inset-y-1 left-0 overflow-hidden rounded-sm border border-emerald-300/35 bg-emerald-400/10"
                      style={{ width: pct(audioDuration) }}
                    >
                      <TimelineWaveform peaks={voiceoverPeaks} className="inset-y-1 opacity-90" />
                    </div>
                    <span
                      className="absolute inset-y-0 w-px bg-emerald-200"
                      style={{ left: pct(audioDuration) }}
                      title={`Voiceover ends at ${formatTime(audioDuration)}`}
                    />
                  </>
                ),
              },
              // A2 — background music. A single full-width block spanning the
              // whole timeline when a track is set; empty lane + "+" otherwise.
              {
                label: "A2",
                description: "Music",
                height: "h-8",
                trackKind: "audio",
                trackIndex: 2,
                stub: !onMusicChange,
                action: trackControls({
                  id: "A2",
                  kind: "audio",
                  index: 2,
                  addMedia: onMusicChange ? () => {
                      setSelectedMusic(true);
                      setSelectedClipId(null);
                      setSelectedSlideId(null);
                      setSelectedBlockIndex(null);
                    } : undefined,
                  addMediaUnavailable: "Music editing is unavailable",
                }),
                content: !onMusicChange ? (
                  <div className="absolute inset-0 flex items-center px-2 text-muted-foreground/40">
                    Music — coming soon
                  </div>
                ) : music ? (
                  <button
                    type="button"
                    data-testid="music-block"
                    onClick={() => {
                      setSelectedMusic(true);
                      setSelectedClipId(null);
                      setSelectedSlideId(null);
                      setSelectedBlockIndex(null);
                    }}
                    className={`absolute inset-y-1 left-0 flex items-center gap-1 overflow-hidden rounded-sm border px-1.5 text-left text-[9px] text-amber-100 transition ${
                      selectedMusic ? "border-amber-300 ring-1 ring-amber-300" : "border-amber-300/40"
                    }`}
                    style={{
                      width: "100%",
                      // Fade ramps drawn as amber gradients at each end.
                      background:
                        "linear-gradient(90deg, rgba(251,191,36,0.05), rgba(251,191,36,0.22) 6%, rgba(251,191,36,0.22) 94%, rgba(251,191,36,0.05)), rgba(251,191,36,0.10)",
                    }}
                    title={music.label || "Background music"}
                  >
                    <Music className="size-3 shrink-0 text-amber-300" />
                    <span className="truncate">{music.label || "Music"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="music-lane-empty"
                    onClick={() => {
                      setSelectedMusic(true);
                      setSelectedClipId(null);
                      setSelectedSlideId(null);
                      setSelectedBlockIndex(null);
                    }}
                    className="absolute inset-0 flex items-center px-2 text-left text-[9px] text-muted-foreground/50 hover:text-amber-200"
                  >
                    Add background music
                  </button>
                ),
              },
              ...Array.from({ length: Math.max(0, highestAudioTrack - 2) }, (_, offset): LaneDef => {
                const index = offset + 3;
                const isSfxTrack = index === 3 && sfxCues.length > 0;
                const canDelete = index === highestAudioTrack
                  && index === minimumAudioTrackCount
                  && index > baseAudioTrackCount;
                return {
                  label: `A${index}`,
                  description: isSfxTrack ? "Sound effects" : "Audio",
                  height: "h-7",
                  trackKind: "audio",
                  trackIndex: index,
                  action: trackControls({
                    id: `A${index}`,
                    kind: "audio",
                    index,
                    addMediaUnavailable: isSfxTrack
                      ? "Sound effects are attached to attention cues"
                      : "No audio media is assigned to this track",
                    canDelete,
                    deleteUnavailable: isSfxTrack
                      ? "The sound-effects track contains clips"
                      : "Only the highest empty audio track can be deleted",
                    onDelete: () => removeAudioTrack(index),
                  }),
                  content: isSfxTrack ? sfxCues.map(cue => (
                    <div
                      key={cue.id}
                      className="absolute inset-y-1 w-2 rounded bg-amber-500"
                      style={{ left: pct(cue.startMs / 1000) }}
                      title="Attention SFX"
                    />
                  )) : null,
                };
              }),
            ];

            // Lane order top-to-bottom = z-order (top lane composites in front),
            // built directly: subtitle Vn > overlay Vn..V2 > V1 (magnetic
            // video) > A1 voiceover > A2 music > A3 SFX. Mirrors the preview z-index
            // and the backend burn-in order.

            return (
              <MultiTrackTimeline
                scrollRef={multiTrackScrollRef}
                className={`timeline-horizontal-scrollbar-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${displayMode === "full"
                  ? "col-span-3 row-start-4 h-full min-h-0"
                  : "-mx-6 min-[1280px]:-mx-4 max-h-[45vh] border-y border-white/10"}`}
                containerProps={{
                  tabIndex: 0,
                  "aria-label": "Multi-track timeline",
                  "aria-keyshortcuts": "Space",
                  title: "Click to activate timeline controls. Then scroll to zoom around the cursor or Shift+scroll to pan.",
                  onPointerDownCapture: focusTimelineKeyboardScope,
                  onKeyDown: handleTimelineKeyDown,
                }}
                laneWidth={laneWidth}
                ruler={{
                  duration: totalDuration,
                  className: "cursor-ew-resize",
                  onPointerDown: beginMultiTrackScrub,
                }}
                playhead={{ style: smoothPlayheadStyle }}
                zoom={timelineZoom}
                minZoom={TIMELINE_MIN_ZOOM}
                maxZoom={TIMELINE_MAX_ZOOM}
                onZoomChange={(zoom) => setTimelineZoomAt(zoom)}
                onFit={() => {
                  setTimelineZoom(1);
                  if (multiTrackScrollRef.current) multiTrackScrollRef.current.scrollLeft = 0;
                }}
                lanes={lanes.map((lane) => {
                  const standardHeight = lane.label.startsWith("A") ? 44 : 48;
                  return {
                    label: lane.label,
                    description: lane.description,
                    height: lane.height,
                    heightPx: trackHeights[lane.label] ?? standardHeight,
                    onHeightChange: (height: number) => setTrackHeights((current) => ({
                      ...current,
                      [lane.label]: height,
                    })),
                    action: lane.action,
                    meta: lane.meta,
                    axisClassName: lane.stub
                      ? "opacity-60"
                      : "cursor-ew-resize bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[length:5%_100%]",
                    axisProps: lane.stub ? {} : {
                      title: "Drag to move the playhead",
                      onPointerDown: beginMultiTrackScrub,
                      ...(lane.attention ? { "data-attention-track": "" } : {}),
                      ...(lane.trackKind ? { "data-track-kind": lane.trackKind } : {}),
                      ...(lane.trackKind === "video" && lane.trackIndex != null
                        ? { "data-track-index": lane.trackIndex }
                        : {}),
                      ...(lane.magneticLane ? {
                        "data-magnetic-lane": "",
                        "data-track-kind": "video",
                      } : {}),
                    },
                    endGutterProps: lane.endGutterProps,
                    showEndLine: !lane.stub,
                    content: lane.content,
                  };
                })}
              />
            );
          })()}

          {selectedMusic && onMusicChange && (
            <MusicInspector
              music={music}
              onChange={onMusicChange}
              displayMode={displayMode}
            />
          )}

          {selectedClip && (() => {
            const clipIndex = displayedComposition.findIndex((clip) => clip.id === selectedClip.id);
            const previousSameKind = displayedComposition
              .slice(0, clipIndex)
              .some((clip) => clip.kind === selectedClip.kind);
            const nextSameKind = displayedComposition
              .slice(clipIndex + 1)
              .some((clip) => clip.kind === selectedClip.kind);
            const commitRoll = (leftIndex: number, delta: number) => {
              commitComposition(rollCompositionBoundary(displayedComposition, leftIndex, delta));
            };
            const commitRightEdge = (delta: number) => {
              commitComposition(resizeCompositionEnd(selectedClip.timeline_duration + delta));
            };
            return (
              <div
                className={displayMode === "full"
                  ? "col-start-1 row-start-2 min-h-0 space-y-4 overflow-y-auto bg-[#111411] p-4 text-white"
                  : "space-y-4 rounded-md border border-lime-300/25 bg-[#111411] p-4 text-white"}
                data-testid="composition-clip-inspector"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                      <Film className="size-3.5" />
                      Clip settings
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">
                      {selectedClip.segment_keywords?.slice(0, 3).join(", ") || `Clip ${clipIndex + 1}`}
                    </p>
                  </div>
                  <Badge className={selectedClip.kind === "intro"
                    ? "border-violet-300/40 bg-violet-400/15 text-violet-200"
                    : "border-lime-300/40 bg-lime-400/15 text-lime-200"}
                  >
                    {selectedClip.kind === "intro" ? "Rapid intro" : "Body"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <span className="block text-[9px] uppercase tracking-wide text-white/45">Output</span>
                    <span className="font-mono text-white/85">
                      {formatTime(selectedClip.timeline_start)}–{formatTime(selectedClip.timeline_start + selectedClip.timeline_duration)}
                    </span>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <span className="block text-[9px] uppercase tracking-wide text-white/45">Duration</span>
                    <span className="font-mono text-white/85">{selectedClip.timeline_duration.toFixed(2)}s</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Arrange</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Move earlier"
                      aria-label="Move earlier"
                      className="size-8 border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                      disabled={!previousSameKind}
                      onClick={() => moveCompositionClip(selectedClip.id, -1)}
                    >
                      <SkipBack className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Move later"
                      aria-label="Move later"
                      className="size-8 border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                      disabled={!nextSameKind}
                      onClick={() => moveCompositionClip(selectedClip.id, 1)}
                    >
                      <SkipForward className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      title="Swap footage"
                      aria-label="Swap footage"
                      className="size-8 bg-lime-300 text-black hover:bg-lime-200"
                      onClick={() => handleOpenClipDialog(selectedClip.id)}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Roll edit output boundary</span>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-white/65">Left edge</span>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white" disabled={clipIndex <= 0}
                          onClick={() => commitRoll(clipIndex - 1, -0.1)}>−0.1</Button>
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white" disabled={clipIndex <= 0}
                          onClick={() => commitRoll(clipIndex - 1, 0.1)}>+0.1</Button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-white/65">Right edge</span>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white"
                          disabled={clipIndex >= displayedComposition.length - 1 && selectedClip.timeline_duration <= 0.1}
                          onClick={() => clipIndex < displayedComposition.length - 1 ? commitRoll(clipIndex, -0.1) : commitRightEdge(-0.1)}>−0.1</Button>
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white"
                          onClick={() => clipIndex < displayedComposition.length - 1 ? commitRoll(clipIndex, 0.1) : commitRightEdge(0.1)}>+0.1</Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Source trim</span>
                  {(["in", "out"] as const).map((edge) => (
                    <div key={edge} className="flex items-center justify-between gap-2">
                      <span className="text-xs capitalize text-white/65">
                        {edge} · {(edge === "in" ? selectedClip.start_time : selectedClip.end_time).toFixed(2)}s
                      </span>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white"
                          onClick={() => nudgeCompositionSource(selectedClip.id, edge, -0.1)}>−0.1</Button>
                        <Button variant="outline" size="sm" className="h-7 border-white/15 bg-white/5 px-2 text-white"
                          onClick={() => nudgeCompositionSource(selectedClip.id, edge, 0.1)}>+0.1</Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="dark border-t border-white/10 pt-3" data-testid="clip-transform-panel">
                  <SegmentTransformPanel
                    transforms={{ ...DEFAULT_SEGMENT_TRANSFORM, ...(selectedClip.transforms as Partial<SegmentTransform> | null ?? {}) }}
                    isOverride={!!selectedClip.transforms && Object.keys(selectedClip.transforms).length > 0}
                    onChange={(next) => {
                      commitComposition(displayedComposition.map((clip) =>
                        clip.id === selectedClip.id ? { ...clip, transforms: next as unknown as Record<string, unknown> } : clip
                      ));
                    }}
                  />
                </div>
              </div>
            );
          })()}

          {/* Overlay clip inspector (free video overlay on V2..Vn). */}
          {selectedOverlay && (() => {
            const box = selectedOverlay.overlay_box ?? DEFAULT_OVERLAY_BOX;
            const setBox = (next: Partial<OverlayBox>) =>
              updateOverlayClip(selectedOverlay.id, { overlay_box: { ...box, ...next } });
            const presets: { label: string; box: OverlayBox }[] = [
              { label: "Full frame", box: { x: 0, y: 0, width: 1, height: 1, fit: box.fit } },
              { label: "Top left", box: { x: 0.03, y: 0.05, width: 0.4, height: 0.4, fit: box.fit } },
              { label: "Top right", box: { x: 0.57, y: 0.05, width: 0.4, height: 0.4, fit: box.fit } },
              { label: "Bottom left", box: { x: 0.03, y: 0.55, width: 0.4, height: 0.4, fit: box.fit } },
              { label: "Bottom right", box: { x: 0.57, y: 0.55, width: 0.4, height: 0.4, fit: box.fit } },
              { label: "Center 50%", box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5, fit: box.fit } },
            ];
            return (
              <div
                className={displayMode === "full"
                  ? "col-start-1 row-start-2 min-h-0 space-y-4 overflow-y-auto bg-[#0c1216] p-4 text-white"
                  : "space-y-4 rounded-md border border-sky-300/25 bg-[#0c1216] p-4 text-white"}
                data-testid="overlay-clip-inspector"
              >
                <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-200/70">
                      <Film className="size-3.5" />
                      Video overlay
                    </div>
                    <p className="mt-1 truncate text-sm font-medium">
                      {selectedOverlay.segment_keywords?.slice(0, 3).join(", ") || "Overlay clip"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => removeOverlayClip(selectedOverlay.id)}
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <span className="block text-[9px] uppercase tracking-wide text-white/45">Output</span>
                    <span className="font-mono text-white/85">
                      {formatTime(selectedOverlay.timeline_start)}–{formatTime(selectedOverlay.timeline_start + selectedOverlay.timeline_duration)}
                    </span>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <span className="block text-[9px] uppercase tracking-wide text-white/45">Source</span>
                    <span className="font-mono text-white/85">{selectedOverlay.start_time.toFixed(2)}–{selectedOverlay.end_time.toFixed(2)}s</span>
                  </div>
                </div>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Track</span>
                  <div className="flex gap-1">
                    {OVERLAY_TRACKS.map((t) => (
                      <Button
                        key={t}
                        variant="outline"
                        size="sm"
                        className={`h-7 flex-1 border-white/15 px-2 ${
                          (selectedOverlay.track ?? 2) === t ? "bg-sky-400/30 text-white" : "bg-white/5 text-white/70"
                        }`}
                        onClick={() => updateOverlayClip(selectedOverlay.id, { track: t })}
                      >
                        V{t}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 border-t border-white/10 pt-3">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Placement</span>
                  <div className="flex flex-wrap gap-1">
                    {presets.map((preset) => (
                      <Button
                        key={preset.label}
                        variant="outline"
                        size="sm"
                        className="h-7 border-white/15 bg-white/5 px-2 text-[11px] text-white/80 hover:bg-white/10"
                        onClick={() => setBox(preset.box)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["x", "y", "width", "height"] as const).map((field) => (
                      <label key={field} className="space-y-0.5 text-[9px] uppercase text-white/45">
                        {field}
                        <Input
                          type="number"
                          min={field === "width" || field === "height" ? 0.01 : 0}
                          max={1}
                          step={0.01}
                          className="h-7 bg-black/20 text-xs text-white"
                          value={box[field]}
                          onChange={(event) => setBox({
                            [field]: Math.max(field === "width" || field === "height" ? 0.01 : 0, Math.min(1, Number(event.target.value))),
                          })}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex rounded-md border border-white/15 bg-white/5 p-0.5">
                    {(["contain", "cover"] as const).map((fit) => (
                      <button
                        key={fit}
                        type="button"
                        className={`flex-1 rounded px-2 py-1 text-[11px] capitalize transition ${
                          box.fit === fit ? "bg-sky-400/30 text-white" : "text-white/60 hover:text-white"
                        }`}
                        onClick={() => setBox({ fit })}
                      >
                        {fit}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="dark border-t border-white/10 pt-3" data-testid="overlay-transform-panel">
                  <SegmentTransformPanel
                    transforms={{ ...DEFAULT_SEGMENT_TRANSFORM, ...(selectedOverlay.transforms as Partial<SegmentTransform> | null ?? {}) }}
                    isOverride={!!selectedOverlay.transforms && Object.keys(selectedOverlay.transforms).length > 0}
                    onChange={(next) => updateOverlayClip(selectedOverlay.id, { transforms: next as unknown as Record<string, unknown> })}
                  />
                </div>
              </div>
            );
          })()}

          {/* Attention cue config panel (shown when an attention block is selected) */}
          {selectedSlideId !== null && (() => {
            const slide = interstitialSlides.find((s) => s.id === selectedSlideId);
            const cue = attentionCues.find(item => item.id === selectedSlideId);
            if (!slide || !cue) return null;
            return (
              <div
                className={displayMode === "full"
                  ? "col-start-1 row-start-2 min-h-0 space-y-3 overflow-y-auto bg-card p-4"
                  : "space-y-3 rounded-md border border-primary/25 bg-primary/10 p-4"}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Layers3 className="size-4 text-primary" />
                    Attention cue · {cue.layers.length} image{cue.layers.length === 1 ? "" : "s"}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveSlide(slide.id)}
                  >
                    <Trash2 className="size-3" />
                    Remove
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-md border bg-background/60 p-2">
                  <div>
                    <p className="text-xs font-medium">Subtitle layer</p>
                    <p className="text-[10px] text-muted-foreground">Choose whether images composite below or above captions.</p>
                  </div>
                  <div className="flex rounded-md border bg-muted/30 p-0.5">
                    {(["behind", "front"] as const).map(zone => (
                      <button
                        key={zone}
                        type="button"
                        className={`rounded px-2 py-1 text-[11px] capitalize transition ${
                          (cue.zone ?? "behind") === zone ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => updateCueZone(cue.id, zone)}
                      >
                        {zone === "front" ? "In front" : "Behind"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {cue.layers.map((layer, layerIndex) => {
                    const layerUrl = layer.assetUrl || layer.assetId;
                    return (
                      <div key={layer.id} className="space-y-2 rounded-md border bg-background/50 p-2" data-testid={`attention-layer-${layerIndex}`}>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted"
                            onClick={() => setAttentionAssetTarget({ kind: "layer", cueId: cue.id, layerId: layer.id })}
                            title="Choose from Gallery or Upload"
                          >
                            {layerUrl && !layerUrl.startsWith("pending:")
                              ? <img src={layerUrl} alt="" className="h-full w-full object-cover" />
                              : <ImageIcon className="size-5 text-muted-foreground" />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">Image {layerIndex + 1}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5 text-[10px] text-destructive"
                                disabled={cue.layers.length === 1}
                                onClick={() => removeCueLayer(cue.id, layer.id)}
                              >
                                Remove
                              </Button>
                            </div>
                            <button
                              type="button"
                              className="mt-1 text-[10px] font-medium text-primary hover:underline"
                              onClick={() => setAttentionAssetTarget({ kind: "layer", cueId: cue.id, layerId: layer.id })}
                            >
                              Gallery / Upload
                            </button>
                          </div>
                        </div>

                        <Input
                          value={layerUrl.startsWith("pending:") ? "" : layerUrl}
                          onChange={(event) => updateCueLayer(cue.id, layer.id, {
                            assetId: event.target.value || `pending:${layer.id}`,
                            assetUrl: event.target.value || undefined,
                          })}
                          placeholder="Image URL (advanced)"
                          className="h-7 text-xs"
                        />

                        <div className="grid grid-cols-3 gap-1.5">
                          {(["x", "y", "width", "height"] as const).map(field => (
                            <label key={field} className="space-y-0.5 text-[9px] uppercase text-muted-foreground">
                              {field}
                              <Input
                                type="number"
                                min={field === "width" || field === "height" ? 0.01 : 0}
                                max={1}
                                step={0.01}
                                className="h-7 text-xs"
                                value={layer[field]}
                                onChange={(event) => updateCueLayer(cue.id, layer.id, {
                                  [field]: Math.max(field === "width" || field === "height" ? 0.01 : 0, Math.min(1, Number(event.target.value))),
                                })}
                              />
                            </label>
                          ))}
                          <label className="space-y-0.5 text-[9px] uppercase text-muted-foreground">
                            Delay ms
                            <Input
                              type="number"
                              min={0}
                              max={60000}
                              step={20}
                              className="h-7 text-xs"
                              value={layer.animation.delayMs}
                              onChange={(event) => updateCueLayer(cue.id, layer.id, {
                                animation: { ...layer.animation, delayMs: Math.max(0, Number(event.target.value)) },
                              })}
                            />
                          </label>
                          <label className="space-y-0.5 text-[9px] uppercase text-muted-foreground">
                            Fit
                            <select
                              className="h-7 w-full rounded border bg-background px-1 text-xs"
                              value={layer.fit}
                              onChange={(event) => updateCueLayer(cue.id, layer.id, { fit: event.target.value as "contain" | "cover" })}
                            >
                              <option value="contain">Contain</option>
                              <option value="cover">Cover</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full gap-1 border-primary/40 text-primary"
                  disabled={cue.layers.length >= 20}
                  onClick={() => addCueLayer(cue.id)}
                >
                  <Plus className="size-3.5" />
                  + image to this moment
                </Button>

                <div className="flex items-center gap-2 border-t pt-3">
                  <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Duration</label>
                  <Button variant="ghost" size="icon" className="size-5"
                    onClick={() => handleUpdateSlide(slide.id, { duration: Math.max(0.5, slide.duration - 0.5) })}>
                    <Minus className="size-3" />
                  </Button>
                  <span className="w-12 text-center text-xs font-mono tabular-nums">{slide.duration.toFixed(1)}s</span>
                  <Button variant="ghost" size="icon" className="size-5"
                    onClick={() => handleUpdateSlide(slide.id, { duration: Math.min(5.0, slide.duration + 0.5) })}>
                    <Plus className="size-3" />
                  </Button>
                  <input
                    type="range"
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    value={slide.duration}
                    onChange={(event) => handleUpdateSlide(slide.id, { duration: Number(event.target.value) })}
                    className="h-1.5 min-w-0 flex-1 appearance-none rounded-lg bg-secondary accent-primary"
                  />
                </div>
              </div>
            );
          })()}

          {/* Inline preview panel (shown when a segment block is selected) */}
          {selectedBlockIndex !== null && selectedMatch && (
            <div
              className={displayMode === "full"
                ? "col-start-1 row-start-2 min-h-0 space-y-3 overflow-y-auto bg-card p-4"
                : "space-y-3 rounded-md border bg-card p-4"}
            >
              <div className={`flex gap-4 ${displayMode === "full" ? "flex-col" : "items-start"}`}>
                {/* Card mode keeps the source monitor used during quick edits.
                    Full mode already has a dedicated program monitor in the
                    center pane, so a second player in the inspector is visually
                    ambiguous and wastes most of the inspector width. */}
                {displayMode !== "full" && (
                  selectedMatch.source_video_id && profileId ? (
                    <div className="flex-shrink-0 w-48 rounded overflow-hidden bg-black">
                      <video
                        ref={videoRef}
                        className="w-full h-auto"
                        controls
                        muted
                      />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 w-48 h-28 rounded bg-muted flex items-center justify-center">
                      <Film className="size-6 text-muted-foreground" />
                    </div>
                  )
                )}

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-2">
                  {displayMode === "full" && (
                    <div className="flex items-center gap-2 border-b pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Film className="size-3.5" />
                      Clip settings
                    </div>
                  )}
                  <div className="text-sm font-medium">
                    #{selectedMatch.srt_index + 1}: {selectedMatch.srt_text}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatTime(selectedMatch.srt_start)} – {formatTime(selectedMatch.srt_end)}
                  </div>

                  {/* Keyword badge */}
                  {selectedMatch.matched_keyword && (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-success/10 text-success border-success/20"
                    >
                      <CheckCircle className="size-3 mr-1" />
                      {selectedMatch.matched_keyword}
                    </Badge>
                  )}

                  {/* Duration controls */}
                  <div className="flex items-center gap-1 text-xs">
                    <Clock className="size-3 text-muted-foreground" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      onClick={() => adjustDuration(selectedBlockIndex, -0.5)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span className="w-10 text-center font-mono tabular-nums">
                      {(selectedMatch.duration_override ?? (selectedMatch.srt_end - selectedMatch.srt_start)).toFixed(1)}s
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      onClick={() => adjustDuration(selectedBlockIndex, 0.5)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>

                  {/* Trim controls (in/out points within the source segment).
                      Stacked rows — the selected-block panel is too narrow for
                      a single-line In/Out readout. */}
                  {selectedMatch.segment_id && (
                    <div className="space-y-0.5 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground w-7">In</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => adjustTrim(selectedBlockIndex, "in", -0.5)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => adjustTrim(selectedBlockIndex, "in", 0.5)}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <span className="font-mono tabular-nums">
                          {(selectedMatch.segment_start_time ?? 0).toFixed(1)}s
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground w-7">Out</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => adjustTrim(selectedBlockIndex, "out", -0.5)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => adjustTrim(selectedBlockIndex, "out", 0.5)}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <span className="font-mono tabular-nums">
                          {(selectedMatch.segment_end_time ?? 0).toFixed(1)}s
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        Trim ({Math.max(0, (selectedMatch.segment_end_time ?? 0) - (selectedMatch.segment_start_time ?? 0)).toFixed(1)}s)
                      </div>
                    </div>
                  )}

                  {/* Swap button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleOpenDialog(selectedBlockIndex)}
                    disabled={availableSegments.length === 0}
                  >
                    <RefreshCw className="size-3" />
                    {selectedMatch.segment_id ? "Swap Segment" : "Assign Segment"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ========== LIST VIEW ========== */
        <div
          className={displayMode === "full"
            ? "col-span-3 row-start-4 h-full min-h-0 overflow-y-auto bg-card"
            : "max-h-[500px] overflow-y-auto rounded-md border"}
        >
          <div className="divide-y">
            {/* "+" insert before first row */}
            {(onInterstitialSlidesChange || onAttentionTimelineChange) && (
              <div className="flex items-center px-3 py-1 bg-muted/20">
                <button
                  onClick={() => handleInsertSlide(-1)}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="size-3" />
                  <span>Insert slide before</span>
                </button>
              </div>
            )}
            {/* Interstitial slides at the top (afterMatchIndex === -1) */}
            {interstitialSlides
              .filter((s) => s.afterMatchIndex === -1)
              .map((slide) => (
                <div
                  key={`list-slide-${slide.id}`}
                  className="group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-primary bg-primary/10"
                >
                  <div className="flex-shrink-0 size-10 rounded overflow-hidden border bg-muted flex items-center justify-center">
                    {slide.imageUrl ? (
                      <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-foreground">
                    <div className="font-medium">Image Slide</div>
                    <div className="text-xs text-muted-foreground">{slide.duration.toFixed(1)}s · {slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-opacity"
                    onClick={() => handleRemoveSlide(slide.id)}
                    title="Remove slide"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              ))}
            {matches.map((match, idx) => {
              const isMatched = match.segment_id !== null && match.confidence > 0;
              const isAutoFilled = match.is_auto_filled === true && match.segment_id !== null;
              const isPinned = match.pinned === true;
              const isLowConfidence = isMatched && !isPinned && match.confidence < 0.5;
              const isDragging = dragIndex === idx;
              const isDragOver = dragOverIndex === idx && dragIndex !== idx;
              const displayText =
                match.srt_text.length > 60
                  ? match.srt_text.substring(0, 60) + "..."
                  : match.srt_text;
              const naturalDuration = match.srt_end - match.srt_start;
              const displayDuration = match.duration_override ?? naturalDuration;
              const isDurationOverridden =
                match.duration_override !== undefined &&
                Math.abs(match.duration_override - naturalDuration) > 0.05;

              // Merge group info: check if this entry is first/last in its group
              const mg = match.merge_group;
              const prevMg = idx > 0 ? matches[idx - 1].merge_group : undefined;
              const nextMg = idx < matches.length - 1 ? matches[idx + 1].merge_group : undefined;
              const isGroupStart = mg !== undefined && mg !== prevMg;
              const isGroupEnd = mg !== undefined && mg !== nextMg;
              const isInGroup = mg !== undefined && (mg === prevMg || mg === nextMg);

              // Slides and insert button after this match
              const slidesAfter = interstitialSlides.filter((s) => s.afterMatchIndex === idx);

              return (
                <React.Fragment key={idx}>
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, idx)}
                  onDragEnd={handleDragEnd}
                  className={`group flex items-center gap-3 px-3 py-2.5 min-h-[48px] border-l-4 transition-colors select-none ${
                    isMatched
                      ? isLowConfidence
                        ? "border-l-amber-400 bg-amber-50/60 dark:bg-amber-950/10"
                        : "border-l-success bg-success/10"
                      : isAutoFilled
                      ? "border-l-muted-foreground bg-muted/50"
                      : "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                  } ${isDragging ? "opacity-50" : ""} ${
                    isDragOver
                      ? "border-t-2 border-t-primary"
                      : "border-t-transparent"
                  } ${isInGroup ? "border-r-2 border-r-chart-2" : ""} ${
                    isGroupStart && isInGroup ? "rounded-tr-md" : ""
                  } ${isGroupEnd && isInGroup ? "rounded-br-md" : ""}`}
                >
                  {/* Drag handle */}
                  <div
                    className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title="Drag to swap segment assignment"
                  >
                    <GripVertical className="size-4" />
                  </div>

                  {/* Left: Index + time range */}
                  <div className="flex-shrink-0 text-xs text-muted-foreground w-24 space-y-0.5">
                    <div className="font-mono font-semibold text-foreground">
                      #{match.srt_index + 1}
                    </div>
                    <div>
                      {formatTime(match.srt_start)} – {formatTime(match.srt_end)}
                    </div>
                  </div>

                  {/* Center: SRT text */}
                  <div
                    className="flex-1 min-w-0 text-sm"
                    title={match.srt_text}
                  >
                    {displayText}
                  </div>

                  {/* Right: Duration + Match status (stacked) */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-1">
                    {/* Duration adjustment control */}
                    <div className="flex items-center gap-1 text-xs">
                      {isGroupStart && isInGroup && match.merge_group_duration ? (
                        <span
                          className="text-[10px] font-mono bg-chart-2/15 text-chart-2 px-1 rounded mr-0.5"
                          title={`Segment video: ${match.merge_group_duration.toFixed(1)}s (grupate)`}
                        >
                          {match.merge_group_duration.toFixed(1)}s
                        </span>
                      ) : null}
                      <span title="Subtitle duration">
                        <Clock className="size-3 text-muted-foreground" />
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        onClick={() => adjustDuration(idx, -0.5)}
                        title="Decrease duration by 0.5s"
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span
                        className={`w-10 text-center font-mono tabular-nums ${
                          isDurationOverridden
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground"
                        }`}
                        title={
                          isDurationOverridden
                            ? `Adjusted from ${naturalDuration.toFixed(1)}s`
                            : "Natural SRT duration"
                        }
                      >
                        {displayDuration.toFixed(1)}s
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5"
                        onClick={() => adjustDuration(idx, 0.5)}
                        title="Increase duration by 0.5s"
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>

                    {/* Match status */}
                    <div className="flex items-center gap-2">
                      {isMatched ? (
                        <>
                          {isPinned && (
                            <button
                              type="button"
                              onClick={() => handleTogglePin(idx)}
                              className="text-primary hover:text-muted-foreground transition-colors flex-shrink-0"
                              title="Pinned — manually assigned, click to unpin"
                            >
                              <Pin className="size-3 fill-current" />
                            </button>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-xs bg-success/10 text-success border-success/20 max-w-[90px]"
                            title={match.explanation}
                          >
                            <CheckCircle className="size-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{match.matched_keyword}</span>
                          </Badge>
                          <span
                            className={`text-xs font-medium ${
                              isLowConfidence
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-success"
                            }`}
                            title={match.explanation ?? (isLowConfidence ? "Low-confidence match" : undefined)}
                          >
                            {Math.round(match.confidence * 100)}%
                          </span>
                          {match.product_group && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 border-chart-2/60 text-chart-2">
                              {match.product_group}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleOpenDialog(idx)}
                            disabled={availableSegments.length === 0}
                            title="Swap segment"
                          >
                            <RefreshCw className="size-3" />
                          </Button>
                        </>
                      ) : isAutoFilled ? (
                        <>
                          {isPinned && (
                            <button
                              type="button"
                              onClick={() => handleTogglePin(idx)}
                              className="text-primary hover:text-muted-foreground transition-colors flex-shrink-0"
                              title="Pinned — manually assigned, click to unpin"
                            >
                              <Pin className="size-3 fill-current" />
                            </button>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-xs border-primary/25 bg-primary/10 text-foreground max-w-[90px]"
                            title={match.explanation}
                          >
                            <Film className="size-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{match.segment_keywords[0] ?? "auto"}</span>
                          </Badge>
                          <span
                            className="text-xs text-primary font-medium cursor-help"
                            title={match.explanation ?? "Auto-filled from the segment pool (no keyword match)"}
                          >
                            auto
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleOpenDialog(idx)}
                            disabled={availableSegments.length === 0}
                            title="Swap segment"
                          >
                            <RefreshCw className="size-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge
                            variant="outline"
                            className="text-xs border-amber-400 text-amber-700 dark:text-amber-300"
                          >
                            <AlertTriangle className="size-3 mr-1" />
                            Unmatched
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-primary text-primary hover:bg-primary/10"
                            onClick={() => handleOpenDialog(idx)}
                            disabled={availableSegments.length === 0}
                          >
                            Select Segment
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {/* Slides after this match */}
                {slidesAfter.map((slide) => (
                  <div
                    key={`list-slide-${slide.id}`}
                    className="group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-primary bg-primary/10"
                  >
                    <div className="flex-shrink-0 size-10 rounded overflow-hidden border bg-muted flex items-center justify-center">
                      {slide.imageUrl ? (
                        <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                      ) : (
                        <ImageIcon className="size-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-sm text-foreground">
                      <div className="font-medium">Image Slide</div>
                      <div className="text-xs text-muted-foreground">{slide.duration.toFixed(1)}s · {slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 transition-opacity"
                      onClick={() => handleRemoveSlide(slide.id)}
                      title="Remove slide"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
                {/* "+" insert after this match */}
                {(onInterstitialSlidesChange || onAttentionTimelineChange) && (
                  <div className="flex items-center px-3 py-1 bg-muted/20">
                    <button
                      onClick={() => handleInsertSlide(idx)}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                      <Plus className="size-3" />
                      <span>Insert slide after</span>
                    </button>
                  </div>
                )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Segment assignment / swap dialog */}
      <Dialog
        open={isAddingCompositionClip || assigningIndex !== null || assigningClipId !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {(isAddingCompositionClip || assigningIndex !== null || assigningClipId !== null) && (
            <div className="space-y-3">
              {/* Phrase being assigned */}
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {dialogSubLabel}
                </span>
                <p className="mt-0.5 font-medium">
                  &ldquo;{isAddingCompositionClip
                    ? "New clip at the end of V1"
                    : assigningClipId !== null
                    ? displayedComposition.find((clip) => clip.id === assigningClipId)?.segment_keywords?.join(", ") || "Timeline clip"
                    : matches[assigningIndex!]?.srt_text}&rdquo;
                </p>
              </div>

              {/* D2: generate a fresh clip with AI when no footage fits */}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => {
                  setAiGenPrompt(isAddingCompositionClip
                    ? ""
                    : assigningClipId !== null
                    ? displayedComposition.find((clip) => clip.id === assigningClipId)?.segment_keywords?.join(" ") ?? ""
                    : matches[assigningIndex!]?.srt_text ?? "");
                  setAiGenOpen(true);
                }}
              >
                <Sparkles className="size-3.5" />
                Generate with AI
              </Button>

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search segments by keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {/* Source filter tabs + proximity indicator */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  <Button
                    variant={sourceFilter === "all" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSourceFilter("all")}
                  >
                    All sources
                  </Button>
                  <Button
                    variant={sourceFilter === "same" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSourceFilter("same")}
                  >
                    Same source
                  </Button>
                </div>
                {proximityExcludedCount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {proximityExcludedCount} nearby excluded
                  </span>
                )}
              </div>

              {/* Segment list */}
              <ScrollArea className="max-h-[300px] rounded-md border">
                <div className="divide-y">
                  {filteredSegments.length === 0 ? (
                    <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                      {availableSegments.length === 0
                        ? "No segments available for selected sources."
                        : "No segments match your search."}
                    </div>
                  ) : (
                    filteredSegments.map((seg) => (
                      <button
                        key={seg.id}
                        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-accent transition-colors"
                        onClick={() => handleSelectSegment(seg)}
                      >
                        <Film className="size-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap gap-1">
                            {seg.keywords.slice(0, 5).map((kw) => (
                              <Badge
                                key={kw}
                                variant="secondary"
                                className="text-xs"
                              >
                                {kw}
                              </Badge>
                            ))}
                            {seg.keywords.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{seg.keywords.length - 5}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {seg.duration > 0
                              ? `Duration: ${seg.duration.toFixed(1)}s`
                              : ""}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* D2: AI segment generation — on success, assign the new clip to the phrase */}
      <AttentionAssetPickerDialog
        open={attentionAssetTarget !== null}
        onOpenChange={(open) => { if (!open) setAttentionAssetTarget(null); }}
        onSelect={selectAttentionAsset}
      />

      <GenerateAiSegmentDialog
        open={aiGenOpen}
        onOpenChange={setAiGenOpen}
        initialPrompt={aiGenPrompt}
        onGenerated={(seg) => handleSelectSegment(seg)}
      />
    </div>
  );
}
