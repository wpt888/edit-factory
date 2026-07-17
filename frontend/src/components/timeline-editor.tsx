"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
  Trash2,
  ChevronDown,
  Loader2,
  Maximize2,
  Pin,
  ScanLine,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { scaleSubtitlePx, scaleSubtitleFontPx, useSubtitlePreviewHeight } from "@/lib/subtitle-preview-scale";
import { formatTimeShort as formatTime } from "@/lib/utils";
import type { SubtitleSettings } from "@/types/video-processing";
import type { AttentionCue, AttentionTimeline } from "@/types/attention-timeline";
import { GenerateAiSegmentDialog } from "@/components/dialogs/generate-ai-segment-dialog";
import { Sparkles } from "lucide-react";

const compactPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(180px, 100%)",
  maxWidth: "100%",
};

const expandedPreviewFrameStyle: React.CSSProperties = {
  aspectRatio: "9 / 16",
  width: "min(421.875px, 100%)",
  maxWidth: "100%",
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
  source_video_path: string;
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
}

// Horizontal scale of the multi-track timeline's time axis.
// ponytail: fixed scale; add a zoom control if long videos make lanes cramped.
const TIMELINE_PX_PER_SEC = 48;

// Status colors shared by the storyboard strip and the multi-track Video lane.
function matchStatusStyle(match: MatchPreview, isSelected: boolean) {
  const isMatched = match.segment_id !== null && match.confidence > 0;
  const isAutoFilled = match.is_auto_filled === true && match.segment_id !== null;
  const isPinned = match.pinned === true;
  const isLowConfidence = isMatched && !isPinned && match.confidence < 0.5;
  const border = isMatched
    ? isLowConfidence
      ? "border-amber-400"
      : "border-success"
    : isAutoFilled
    ? "border-muted-foreground"
    : "border-amber-500";
  const bg = isSelected
    ? "bg-accent"
    : isMatched
    ? isLowConfidence
      ? "bg-amber-50/60 dark:bg-amber-950/10"
      : "bg-success/10"
    : isAutoFilled
    ? "bg-muted/50"
    : "bg-amber-50 dark:bg-amber-950/20";
  return { border, bg, isPinned };
}

interface TimelineEditorProps {
  matches: MatchPreview[];
  audioDuration: number;
  introOffsetSec?: number;
  introSegments?: IntroSegment[];
  sourceVideoIds: string[];
  availableSegments: SegmentOption[];
  onMatchesChange: (matches: MatchPreview[]) => void;
  profileId?: string;
  pipelineId?: string;
  variantIndex?: number;
  subtitleSettings?: SubtitleSettings;
  interstitialSlides?: InterstitialSlide[];
  onInterstitialSlidesChange?: (slides: InterstitialSlide[]) => void;
  attentionTimeline?: AttentionTimeline;
  onAttentionTimelineChange?: (timeline: AttentionTimeline) => void;
  /** Open the server-rendered preview for this exact variant. */
  onRenderPreview?: () => void;
  // "card" = compact in-card editor; "full" = the maximized modal editor
  // (bigger inline preview, everything else identical — same component reused).
  displayMode?: "card" | "full";
}


export function TimelineEditor({
  matches,
  audioDuration,
  introOffsetSec: requestedIntroOffsetSec = 0,
  introSegments = [],
  sourceVideoIds: _sourceVideoIds,
  availableSegments,
  onMatchesChange,
  profileId,
  pipelineId,
  variantIndex,
  subtitleSettings,
  interstitialSlides: legacyInterstitialSlides = [],
  onInterstitialSlidesChange,
  attentionTimeline,
  onAttentionTimelineChange,
  onRenderPreview,
  displayMode = "card",
}: TimelineEditorProps) {
  const cueBoundaryIndex = useCallback((startMs: number) => {
    let result = -1;
    matches.forEach((match, index) => {
      if (match.srt_end * 1000 <= startMs + 50) result = index;
    });
    return result;
  }, [matches]);

  const interstitialSlides = useMemo<InterstitialSlide[]>(() => {
    if (!attentionTimeline) return legacyInterstitialSlides;
    return attentionTimeline.cues.map((cue) => {
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
      };
    });
  }, [attentionTimeline, legacyInterstitialSlides, cueBoundaryIndex]);

  const emitSlides = useCallback((slides: InterstitialSlide[]) => {
    if (onAttentionTimelineChange && attentionTimeline) {
      const existing = new Map(attentionTimeline.cues.map((cue) => [cue.id, cue]));
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
        };
      });
      onAttentionTimelineChange({ ...attentionTimeline, cues });
      return;
    }
    onInterstitialSlidesChange?.(slides);
  }, [attentionTimeline, matches, onAttentionTimelineChange, onInterstitialSlidesChange]);

  const updateCueTiming = useCallback((cueId: string, startMs: number, durationMs: number) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    const maxMs = Math.max(1, audioDuration * 1000);
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionTimeline.cues.map(cue => cue.id === cueId ? {
        ...cue,
        startMs: Math.max(0, Math.min(Math.round(startMs), maxMs - 100)),
        durationMs: Math.max(100, Math.min(Math.round(durationMs), maxMs)),
      } : cue),
    });
  }, [attentionTimeline, audioDuration, onAttentionTimelineChange]);

  const updateCueLayer = useCallback((cueId: string, changes: Partial<AttentionCue["layers"][number]>) => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    onAttentionTimelineChange({
      ...attentionTimeline,
      cues: attentionTimeline.cues.map(cue => cue.id === cueId ? {
        ...cue,
        layers: cue.layers.map((layer, index) => index === 0 ? { ...layer, ...changes } : layer),
      } : cue),
    });
  }, [attentionTimeline, onAttentionTimelineChange]);

  const beginCueTimingDrag = useCallback((event: React.PointerEvent, cue: AttentionCue, edge: "move" | "resize") => {
    if (!attentionTimeline || !onAttentionTimelineChange) return;
    event.preventDefault();
    event.stopPropagation();
    const track = (event.currentTarget as HTMLElement).closest("[data-attention-track]") as HTMLElement | null;
    if (!track) return;
    const startX = event.clientX;
    const originalStart = cue.startMs;
    const originalDuration = cue.durationMs;
    const totalMs = Math.max(1, audioDuration * 1000);
    const snapPoints = matches.flatMap(match => [match.srt_start * 1000, match.srt_end * 1000]);
    const snap = (value: number, disabled: boolean) => {
      if (disabled) return value;
      const nearest = snapPoints.reduce((best, point) => Math.abs(point - value) < Math.abs(best - value) ? point : best, value);
      return Math.abs(nearest - value) <= 150 ? nearest : value;
    };
    const onMove = (moveEvent: PointerEvent) => {
      const deltaMs = (moveEvent.clientX - startX) / Math.max(1, track.clientWidth) * totalMs;
      if (edge === "resize") {
        const end = snap(originalStart + originalDuration + deltaMs, moveEvent.altKey);
        updateCueTiming(cue.id, originalStart, end - originalStart);
      } else {
        const start = snap(originalStart + deltaMs, moveEvent.altKey);
        updateCueTiming(cue.id, start, originalDuration);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [attentionTimeline, audioDuration, matches, onAttentionTimelineChange, updateCueTiming]);
  // Legacy restored previews may contain only an absolute source path. Those
  // paths are intentionally forbidden by the backend file endpoint, so never
  // enter intro mode unless every clip can use the scoped preview proxy.
  const introOffsetSec =
    requestedIntroOffsetSec > 0 &&
    introSegments.length > 0 &&
    introSegments.every((segment) => Boolean(segment.source_video_id))
      ? requestedIntroOffsetSec
      : 0;

  // The editor intentionally exposes one canonical view: the timeline.
  const [viewMode] = useState<"timeline" | "list">("timeline");

  // Dialog state (used for both unmatched assignment and swap)
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"same" | "all">("all");
  // D2: "Generate with AI" — capture the phrase text before the assign dialog
  // closes so the generation dialog keeps its prompt.
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [aiGenPrompt, setAiGenPrompt] = useState("");

  // Timeline view state
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSourceVideoId = useRef<string | null>(null);
  const lastStartTime = useRef<number | null>(null);

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // --- Inline continuous preview player state ---
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isPreviewBuffering, setIsPreviewBuffering] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);
  const [previewSlotMatchIndexes, setPreviewSlotMatchIndexes] = useState<Array<number | null>>([null, null]);
  const [isPreviewIntro, setIsPreviewIntro] = useState(false);
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
  const matchesRef = useRef(matches);
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
  useEffect(() => { matchesRef.current = matches; }, [matches]);

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

  // Matches that have a usable video segment (drives canPreview). The old
  // per-source video pool + prune effect are gone — we now use two fixed slots.
  const videoMatches = matches.filter((m) => m.segment_id && m.source_video_id);

  // Can we show the preview? Need pipelineId, profileId, and at least one video match
  const canPreview = !!(pipelineId && variantIndex !== undefined && profileId && videoMatches.length > 0);
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
    return `${API_URL}/segments/source-videos/${sourceVideoId}/preview-stream?profile_id=${profileId}`;
  }, [profileId]);

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
          setPreviewCurrentTime(holdAt);
        }
        previewRafIdRef.current = requestAnimationFrame(loop);
        return;
      }
      const time = audio.currentTime;
      const previewTime = time;
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
  }, [findActiveMatch, commitTransition, findNextTransitionIndex, finishIntroPlayback, prepareSlot, introOffsetSec, introSegments, playIntroAt]);

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
    if (!audio) return;
    setPreviewCurrentTime(time);
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
    const newIdx = findActiveMatch(audioTime);
    setPreviewActiveIndex(newIdx);
    previewActiveIndexRef.current = newIdx;
    preparedNextForIndexRef.current = null;
    // Scrub lands at an arbitrary audio time; seat the active slot at the
    // segment's start (video doesn't track sub-phrase position — same as before).
    seatActiveSlot(newIdx, isPreviewPlayingRef.current);
  }, [findActiveMatch, seatActiveSlot, introOffsetSec, playIntroAt]);

  const handlePreviewSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    seekPreviewToTime(parseFloat(e.target.value));
  }, [seekPreviewToTime]);

  const handleSeekToSegment = useCallback((idx: number) => {
    if (!isPreviewActive) return;
    jumpToIndex(idx);
  }, [isPreviewActive, jumpToIndex]);

  const activatePreview = useCallback(() => {
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
  }, [applySlotVisibility, findActiveMatch, introOffsetSec, introSegments.length, loadSlotSource, prepareIntroSlot, prepareSlot, seatActiveSlot, seekSlotTo, setSegmentEndBoundary, playAudioAndStartLoop]);

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

  // Filtered segments: proximity ±2 rule + source filter + keyword search
  const filteredSegments = useMemo(() => {
    let pool = availableSegments;

    // Source video filter
    if (sourceFilter === "same" && assigningIndex !== null) {
      const currentSourceId = matches[assigningIndex]?.source_video_id;
      if (currentSourceId) {
        pool = pool.filter(seg => seg.source_video_id === currentSourceId);
      }
    }

    // Proximity ±2: exclude segments already used at neighboring positions
    if (assigningIndex !== null) {
      const nearbySegmentIds = new Set<string>();
      for (let offset = -2; offset <= 2; offset++) {
        if (offset === 0) continue;
        const neighborIdx = assigningIndex + offset;
        if (neighborIdx >= 0 && neighborIdx < matches.length) {
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
  }, [availableSegments, assigningIndex, matches, searchQuery, sourceFilter]);

  // Count how many segments were excluded by proximity rule (for UI indicator)
  const proximityExcludedCount = useMemo(() => {
    if (assigningIndex === null) return 0;
    const nearbySegmentIds = new Set<string>();
    for (let offset = -2; offset <= 2; offset++) {
      if (offset === 0) continue;
      const neighborIdx = assigningIndex + offset;
      if (neighborIdx >= 0 && neighborIdx < matches.length) {
        const neighborId = matches[neighborIdx].segment_id;
        if (neighborId) nearbySegmentIds.add(neighborId);
      }
    }
    return availableSegments.filter(seg => nearbySegmentIds.has(seg.id)).length;
  }, [availableSegments, assigningIndex, matches]);


  // --- Dialog handlers ---

  const handleOpenDialog = (matchIndex: number) => {
    setAssigningIndex(matchIndex);
    setSearchQuery("");
  };

  const handleCloseDialog = () => {
    setAssigningIndex(null);
    setSearchQuery("");
    setSourceFilter("all");
  };

  const handleSelectSegment = (segment: SegmentOption) => {
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

  const handleInsertSlide = (afterMatchIndex: number) => {
    if (!onInterstitialSlidesChange && !onAttentionTimelineChange) return;
    const newSlide: InterstitialSlide = {
      id: crypto.randomUUID(),
      afterMatchIndex,
      imageUrl: "",
      duration: 2.0,
      animation: "kenburns",
      kenBurnsDirection: "zoom-in",
      productTitle: "",
    };
    const updated = [...interstitialSlides, newSlide];
    emitSlides(updated);
    setSelectedSlideId(newSlide.id);
    setSelectedBlockIndex(null);
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

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Film className="size-4 mr-2" />
        No SRT phrases to display.
      </div>
    );
  }

  // Determine dialog title based on context
  const isSwapMode =
    assigningIndex !== null &&
    matches[assigningIndex]?.segment_id !== null;
  const dialogTitle = isSwapMode ? "Swap Segment" : "Select Segment";
  const dialogSubLabel = isSwapMode ? "Swapping segment for phrase" : "Assigning to phrase";

  // Calculate total duration for proportional widths in timeline view
  const bodyDuration = audioDuration > 0
    ? audioDuration
    : matches.reduce((sum, m) => sum + (m.duration_override ?? (m.srt_end - m.srt_start)), 0);
  const totalDuration = bodyDuration;
  const previewTotalDuration = previewDuration || audioDuration;

  // Selected match for inline preview
  const selectedMatch = selectedBlockIndex !== null ? matches[selectedBlockIndex] : null;

  const renderPreviewSubtitleOverlay = (minimumFontSize: number, containerHeight: number) => {
    const subtitleText = matches[previewActiveIndex]?.srt_text;
    if (!subtitleText || containerHeight <= 0) return null;

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
        <p
          className="inline-block px-2 py-1 font-semibold leading-tight"
          style={{
            fontFamily: subtitleSettings?.fontFamily ?? "var(--font-montserrat), Montserrat, sans-serif",
            fontSize: `${fontSize}px`,
            color: subtitleSettings?.textColor ?? "#FFFFFF",
            opacity,
            textShadow: `${baseShadow}${glowShadow}`,
            WebkitTextStroke: outlineWidth > 0
              ? `${outlineWidth}px ${subtitleSettings?.outlineColor ?? "#000000"}`
              : undefined,
            paintOrder: "stroke fill",
            letterSpacing: `${letterSpacing}px`,
          }}
        >
          {subtitleText}
        </p>
      </div>
    );
  };

  const renderAttentionOverlays = () => {
    if (!attentionTimeline) return null;
    const nowMs = previewCurrentTime * 1000;
    return attentionTimeline.cues.flatMap((cue) => {
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
              objectFit: layer.fit, zIndex: 10 + layer.zIndex,
              animationDuration: `${duration}ms`,
              ["--attention-intensity" as string]: layer.animation.intensity,
            }}
          />
        );
      });
    });
  };

  return (
    <>
      {/* Preload audio as soon as preview is possible — mounted before isPreviewActive
          so it has time to load before user clicks Play Preview */}
      {canPreview && (
        <audio
          ref={previewAudioRef}
          src={`${API_URL}/pipeline/audio/${pipelineId}/${variantIndex}`}
          preload="auto"
          style={{ display: "none" }}
        />
      )}

      {/* Inline continuous preview player */}
      {canPreview && pipelineId && variantIndex !== undefined && profileId && (
        <>
          {!isPreviewExpanded && (
            <div className="rounded-lg border bg-card mb-3 overflow-hidden">
              {/* Video display with subtitle overlay */}
              <div
                ref={compactPreviewMeasurement.ref}
                className="group relative mx-auto bg-black flex items-center justify-center"
                style={displayMode === "full" ? expandedPreviewFrameStyle : compactPreviewFrameStyle}
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
                        activeSlot === slot && (isPreviewIntro || matches[previewActiveIndex]?.source_video_id)
                          ? 1
                          : 0,
                      zIndex: activeSlot === slot ? 1 : 0,
                      transform: previewVideoTransform(
                        matches[previewSlotMatchIndexes[slot] ?? -1]?.transforms
                      ),
                    }}
                  />
                ))}

                {!isPreviewActive && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/35">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="size-12 rounded-full shadow-lg"
                      onClick={activatePreview}
                      aria-label="Play preview"
                      title="Play preview"
                    >
                      <Play className="size-5 fill-current" />
                    </Button>
                    <span className="text-[11px] text-white/75">Play preview</span>
                  </div>
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
                {!isPreviewIntro && !matches[previewActiveIndex]?.source_video_id && (
                  <div className="flex items-center justify-center text-muted-foreground text-sm">
                    No video for this segment
                  </div>
                )}

                {/* Subtitle overlay — respects subtitleSettings if provided */}
                {renderAttentionOverlays()}
                {showSafeArea && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-[6%] top-[8%] bottom-[8%] z-[1] rounded border border-dashed border-white/25" />
                )}
                {renderPreviewSubtitleOverlay(8, compactPreviewMeasurement.height)}
              </div>

              {/* Controls */}
              <div className="px-3 py-2 space-y-1.5">
                {/* Progress bar */}
                <input
                  type="range"
                  min={0}
                  max={previewTotalDuration || 1}
                  step={0.1}
                  value={previewCurrentTime}
                  onChange={handlePreviewSeek}
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
                      className="size-7"
                      onClick={previewNextSegment}
                      disabled={!isPreviewActive || previewActiveIndex >= matches.length - 1}
                      title="Next segment"
                    >
                      <SkipForward className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={`size-7 ${showSafeArea ? "bg-primary/10 text-primary" : ""}`}
                      onClick={() => setShowSafeArea((visible) => !visible)}
                      aria-pressed={showSafeArea}
                      aria-label={`${showSafeArea ? "Hide" : "Show"} Safe Area`}
                      title={`${showSafeArea ? "Hide" : "Show"} Safe Area`}
                    >
                      <ScanLine className="size-3.5" />
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
                    {previewActiveIndex + 1}/{matches.length}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Dialog open={isPreviewExpanded} onOpenChange={setIsPreviewExpanded}>
            <DialogContent className="w-[min(96vw,1200px)] max-w-[1200px] p-0 overflow-hidden">
              <DialogHeader className="px-6 pt-6 pb-0">
                <DialogTitle>Expanded Preview</DialogTitle>
              </DialogHeader>
              <div className="px-6 pb-6">
                <div className="rounded-lg border bg-card overflow-hidden">
                  <div
                    ref={expandedPreviewMeasurement.ref}
                    className="group relative mx-auto bg-black flex items-center justify-center"
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
                            activeSlot === slot && (isPreviewIntro || matches[previewActiveIndex]?.source_video_id)
                              ? 1
                              : 0,
                          zIndex: activeSlot === slot ? 1 : 0,
                          transform: previewVideoTransform(
                            matches[previewSlotMatchIndexes[slot] ?? -1]?.transforms
                          ),
                        }}
                      />
                    ))}

                    {!isPreviewActive && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/35">
                        <Button
                          variant="secondary"
                          size="icon"
                          className="size-14 rounded-full shadow-lg"
                          onClick={activatePreview}
                          aria-label="Play preview"
                          title="Play preview"
                        >
                          <Play className="size-6 fill-current" />
                        </Button>
                        <span className="text-xs text-white/75">Play preview</span>
                      </div>
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

                    {!isPreviewIntro && !matches[previewActiveIndex]?.source_video_id && (
                      <div className="flex items-center justify-center text-muted-foreground text-sm">
                        No video for this segment
                      </div>
                    )}

                    {renderAttentionOverlays()}
                    {showSafeArea && (
                      <div aria-hidden="true" className="pointer-events-none absolute inset-x-[6%] top-[8%] bottom-[8%] z-[1] rounded border border-dashed border-white/25" />
                    )}
                    {renderPreviewSubtitleOverlay(10, expandedPreviewMeasurement.height)}
                  </div>

                  <div className="px-4 py-3 space-y-2">
                    <input
                      type="range"
                      min={0}
                      max={previewTotalDuration || 1}
                      step={0.1}
                      value={previewCurrentTime}
                      onChange={handlePreviewSeek}
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
                          disabled={!isPreviewActive || previewActiveIndex >= matches.length - 1}
                          title="Next segment"
                        >
                          <SkipForward className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`size-8 ${showSafeArea ? "bg-primary/10 text-primary" : ""}`}
                          onClick={() => setShowSafeArea((visible) => !visible)}
                          aria-pressed={showSafeArea}
                          aria-label={`${showSafeArea ? "Hide" : "Show"} Safe Area`}
                          title={`${showSafeArea ? "Hide" : "Show"} Safe Area`}
                        >
                          <ScanLine className="size-4" />
                        </Button>
                      </div>

                      <span className="text-xs text-muted-foreground">
                        {previewActiveIndex + 1}/{matches.length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {viewMode === "timeline" ? (
        /* ========== TIMELINE VIEW ========== */
        <div className="space-y-3">
          {attentionTimeline && totalDuration > 0 && (() => {
            /* ========== MULTI-TRACK TIMELINE ==========
               One shared time axis (0..totalDuration — the voiceover clock).
               Every lane positions blocks as a % of that axis, so rows stay
               aligned by construction; the grid scrolls horizontally as one. */
            const pct = (sec: number) => `${(Math.min(Math.max(sec, 0), totalDuration) / totalDuration) * 100}%`;
            const widthPct = (sec: number) => `${(Math.max(sec, 0) / totalDuration) * 100}%`;
            const laneMinWidth = Math.max(480, Math.round(totalDuration * TIMELINE_PX_PER_SEC));
            const tickStep = totalDuration > 120 ? 5 : 1;
            const ticks: number[] = [];
            for (let s = 0; s <= Math.floor(totalDuration); s += tickStep) ticks.push(s);
            const sfxCues = attentionTimeline.cues.filter(cue => cue.sfxAssetId || cue.sfxUrl);
            const playhead = isPreviewActive ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-20 w-px bg-primary"
                style={{ left: pct(previewCurrentTime) }}
              />
            ) : null;

            const canInsertSlide = !!(onInterstitialSlidesChange || onAttentionTimelineChange);
            const lanes: { label: string; height: string; attention?: boolean; action?: React.ReactNode; content: React.ReactNode }[] = [
              {
                label: "Video",
                height: "h-14",
                content: (
                  <>
                    {introOffsetSec > 0 && (
                      <div
                        className="absolute inset-y-1 flex items-center overflow-hidden rounded border-2 border-violet-500 bg-violet-500/15 px-1 text-[9px] font-medium text-violet-700 dark:text-violet-300"
                        style={{ left: 0, width: pct(introOffsetSec) }}
                        title={`Rapid intro over soundtrack (${introOffsetSec.toFixed(1)}s)`}
                      >
                        <span className="truncate">Rapid intro</span>
                      </div>
                    )}
                    {/* One clip block per phrase (NLE semantics). Phrases sharing
                        one source (same merge_group) render as separate, abutting
                        blocks with a subtle "linked" tint — the data model keeps
                        merge_group; only the visual is per-phrase. */}
                    {matches.map((match, idx) => {
                      const start = Math.max(match.srt_start, introOffsetSec);
                      const end = match.srt_end;
                      if (end - start <= 0.001) return null;
                      const isSelected = selectedBlockIndex === idx;
                      const isHighlighted = isPreviewActive && previewActiveIndex === idx;
                      const status = matchStatusStyle(match, isSelected);
                      const mg = match.merge_group;
                      const linkedPrev = mg != null && idx > 0 && matches[idx - 1].merge_group === mg;
                      const linkedNext = mg != null && idx < matches.length - 1 && matches[idx + 1].merge_group === mg;
                      const words = match.srt_text.trim().split(/\s+/);
                      const blockLabel = match.matched_keyword?.trim()
                        || `${words.slice(0, 3).join(" ")}${words.length > 3 ? "..." : ""}`;
                      return (
                        <button
                          type="button"
                          key={`clip-${match.srt_index}`}
                          className={`absolute inset-y-1 overflow-hidden border-2 text-left ${status.border} ${status.bg} ${isSelected || isHighlighted ? "z-10 ring-1 ring-primary" : ""} ${linkedPrev ? "rounded-l-none" : "rounded-l"} ${linkedNext ? "rounded-r-none" : "rounded-r"}`}
                          style={{ left: pct(start), width: widthPct(end - start) }}
                          title={`${match.srt_text}${linkedPrev || linkedNext ? " · linked (shares one source clip)" : ""}`}
                          onClick={() => {
                            if (isPreviewActive) {
                              handleSeekToSegment(idx);
                            } else {
                              setSelectedBlockIndex(idx === selectedBlockIndex ? null : idx);
                              setSelectedSlideId(null);
                            }
                          }}
                        >
                          {match.thumbnail_path && (
                            <img
                              src={`${API_URL}/segments/files/${encodeURIComponent(match.thumbnail_path.split("/").pop() ?? "")}`}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover opacity-50"
                            />
                          )}
                          {(linkedPrev || linkedNext) && (
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-chart-2/70" />
                          )}
                          {status.isPinned && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleTogglePin(idx); }}
                              className="absolute right-0.5 top-0.5 z-20 text-primary transition-colors hover:text-muted-foreground"
                              title="Pinned — manually assigned, click to unpin"
                            >
                              <Pin className="size-3 fill-current" />
                            </button>
                          )}
                          <span className="absolute inset-x-1 bottom-0.5 z-10 truncate text-[9px] font-medium text-foreground">
                            {blockLabel}
                          </span>
                        </button>
                      );
                    })}
                  </>
                ),
              },
              {
                label: "Attention images",
                height: "h-9",
                attention: true,
                action: canInsertSlide ? (
                  <button
                    type="button"
                    onClick={() => handleInsertSlide(selectedBlockIndex ?? -1)}
                    className="shrink-0 rounded p-0.5 text-primary transition-colors hover:bg-primary/10"
                    title="Add attention image (drag it on the lane to position)"
                    aria-label="Add attention image"
                  >
                    <Plus className="size-3" />
                  </button>
                ) : null,
                content: (
                  <>
                    {attentionTimeline.cues.length === 0 && (
                      <div className="absolute inset-0 flex items-center px-2 text-muted-foreground/60">
                        No attention images — use the + on this lane to add one, then drag to position
                      </div>
                    )}
                    {attentionTimeline.cues.map(cue => (
                      <button
                        type="button"
                        key={cue.id}
                        className="absolute inset-y-1 min-w-3 cursor-grab overflow-hidden rounded bg-primary/70 px-1 text-left text-primary-foreground active:cursor-grabbing"
                        style={{ left: pct(cue.startMs / 1000), width: widthPct(cue.durationMs / 1000) }}
                        onPointerDown={(event) => beginCueTimingDrag(event, cue, "move")}
                        onClick={() => setSelectedSlideId(cue.id)}
                        title="Drag to move. Hold Alt to disable subtitle snapping."
                      >
                        {cue.layers.length} image{cue.layers.length === 1 ? "" : "s"}
                        <span
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/20"
                          onPointerDown={(event) => beginCueTimingDrag(event, cue, "resize")}
                        />
                      </button>
                    ))}
                  </>
                ),
              },
              {
                label: "Subtitles",
                height: "h-8",
                content: matches.map((match, idx) => (
                  <button
                    type="button"
                    key={match.srt_index}
                    className="absolute inset-y-1 overflow-hidden rounded border border-foreground/15 bg-foreground/5 px-1 text-left leading-tight hover:bg-foreground/10"
                    style={{ left: pct(match.srt_start), width: widthPct(Math.max(0.05, match.srt_end - match.srt_start)) }}
                    title={match.srt_text}
                    onClick={() => { if (isPreviewActive) handleSeekToSegment(idx); }}
                  >
                    {match.srt_text}
                  </button>
                )),
              },
              {
                label: "Voiceover",
                height: "h-7",
                content: (
                  <>
                    <div
                      className="absolute inset-y-1 left-0 rounded bg-emerald-500/20 bg-[repeating-linear-gradient(90deg,transparent_0_3px,currentColor_3px_4px)] text-emerald-500/30"
                      style={{ width: pct(audioDuration) }}
                    />
                    <span className="absolute left-1 top-1/2 z-10 -translate-y-1/2 text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
                      TTS voiceover · {formatTime(audioDuration)}
                    </span>
                  </>
                ),
              },
              ...(sfxCues.length > 0 ? [{
                label: "SFX",
                height: "h-7",
                content: sfxCues.map(cue => (
                  <div
                    key={cue.id}
                    className="absolute inset-y-1 w-2 rounded bg-amber-500"
                    style={{ left: pct(cue.startMs / 1000) }}
                    title="Attention SFX"
                  />
                )),
              }] : []),
            ];

            // Lane order = visual stacking order, top lane = topmost layer
            // (Premiere semantics): Subtitles > Attention images > Video, then
            // the audio lanes. This matches the preview z-index (subtitles z-50 >
            // attention z-10+ > video z-0/1) and the backend burn-in order.
            const laneOrder = ["Subtitles", "Attention images", "Video", "Voiceover", "SFX"];
            const orderedLanes = [...lanes].sort(
              (a, b) => laneOrder.indexOf(a.label) - laneOrder.indexOf(b.label)
            );

            return (
              <div
                className="overflow-x-auto rounded-md border bg-card text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                tabIndex={0}
                aria-label="Multi-track timeline"
                aria-keyshortcuts="Space"
                title="Click to seek. Space plays or pauses."
                onPointerDownCapture={focusTimelineKeyboardScope}
                onKeyDown={handleTimelineKeyDown}
              >
                <div className="w-max min-w-full">
                  {/* Time ruler — click to seek while the preview is active */}
                  <div className="flex">
                    <div className="sticky left-0 z-30 flex w-28 shrink-0 items-center border-r bg-card px-2 font-medium text-muted-foreground">
                      Time
                    </div>
                    <div
                      className={`relative h-6 flex-1 ${isPreviewActive ? "cursor-pointer" : ""}`}
                      style={{ minWidth: laneMinWidth }}
                      title={isPreviewActive ? "Click to seek" : undefined}
                      onClick={(event) => {
                        if (!isPreviewActive) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
                        seekPreviewToTime(ratio * totalDuration);
                      }}
                    >
                      {ticks.map(s => (
                        <React.Fragment key={s}>
                          <div
                            className={`absolute bottom-0 w-px ${s % 5 === 0 ? "h-2.5 bg-foreground/40" : "h-1.5 bg-foreground/20"}`}
                            style={{ left: pct(s) }}
                          />
                          {s % 5 === 0 && totalDuration - s > 0.4 && (
                            <span className="absolute top-0 pl-0.5 text-[8px] leading-none text-muted-foreground" style={{ left: pct(s) }}>
                              {s}s
                            </span>
                          )}
                        </React.Fragment>
                      ))}
                      {playhead}
                    </div>
                  </div>
                  {orderedLanes.map(lane => (
                    <div key={lane.label} className="flex border-t">
                      <div className="sticky left-0 z-30 flex w-28 shrink-0 items-center justify-between gap-1 border-r bg-card px-2 font-medium">
                        <span className="truncate">{lane.label}</span>
                        {lane.action}
                      </div>
                      <div
                        className={`relative flex-1 ${lane.height}`}
                        style={{ minWidth: laneMinWidth }}
                        {...(lane.attention ? { "data-attention-track": "" } : {})}
                      >
                        {lane.content}
                        {playhead}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Interstitial slide config panel (shown when a slide block is selected) */}
          {selectedSlideId !== null && (() => {
            const slide = interstitialSlides.find((s) => s.id === selectedSlideId);
            if (!slide) return null;
            return (
              <div className="rounded-md border border-primary/25 bg-primary/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ImageIcon className="size-4 text-primary" />
                    Image Slide Config
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

                <div className="flex items-start gap-4">
                  {/* Image preview */}
                  <div className="flex-shrink-0 size-20 rounded border overflow-hidden bg-muted flex items-center justify-center">
                    {slide.imageUrl ? (
                      <img
                        src={slide.imageUrl}
                        alt="Product"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <ImageIcon className="size-6 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Image URL */}
                    <div className="space-y-1">
                      <div className="flex gap-1 text-[10px] text-muted-foreground" role="tablist" aria-label="Asset picker">
                        {['Gallery', 'Upload', 'Products', 'Generate with AI', 'URL'].map(name => <span key={name} className={`rounded px-1.5 py-0.5 ${name === 'URL' ? 'bg-muted text-foreground' : ''}`}>{name}</span>)}
                      </div>
                      <label className="text-xs font-medium text-muted-foreground">Image URL (advanced)</label>
                      <input
                        type="text"
                        value={slide.imageUrl}
                        onChange={(e) => handleUpdateSlide(slide.id, { imageUrl: e.target.value })}
                        placeholder="https://..."
                        className="w-full h-7 text-xs px-2 rounded border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    {attentionTimeline?.cues.find(cue => cue.id === slide.id)?.layers[0] && (() => {
                      const layer = attentionTimeline.cues.find(cue => cue.id === slide.id)!.layers[0];
                      return (
                        <div className="grid grid-cols-3 gap-2 rounded border p-2">
                          {(["x", "y", "width", "height"] as const).map(field => (
                            <label key={field} className="space-y-0.5 text-[10px] uppercase text-muted-foreground">
                              {field}
                              <Input type="number" min={0} max={1} step={0.01} className="h-7 text-xs" value={layer[field]}
                                onChange={event => updateCueLayer(slide.id, { [field]: Math.max(0, Math.min(1, Number(event.target.value))) })} />
                            </label>
                          ))}
                          <label className="space-y-0.5 text-[10px] uppercase text-muted-foreground">Layer
                            <Input type="number" min={0} max={1000} className="h-7 text-xs" value={layer.zIndex}
                              onChange={event => updateCueLayer(slide.id, { zIndex: Number(event.target.value) })} />
                          </label>
                          <label className="space-y-0.5 text-[10px] uppercase text-muted-foreground">Fit
                            <select className="h-7 w-full rounded border bg-background px-1 text-xs" value={layer.fit}
                              onChange={event => updateCueLayer(slide.id, { fit: event.target.value as "contain" | "cover" })}>
                              <option value="contain">Contain</option><option value="cover">Cover</option>
                            </select>
                          </label>
                        </div>
                      );
                    })()}

                    {/* Duration */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Duration</label>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => handleUpdateSlide(slide.id, { duration: Math.max(0.5, slide.duration - 0.5) })}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-12 text-center text-xs font-mono tabular-nums">
                          {slide.duration.toFixed(1)}s
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5"
                          onClick={() => handleUpdateSlide(slide.id, { duration: Math.min(5.0, slide.duration + 0.5) })}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <input
                          type="range"
                          min={0.5}
                          max={5.0}
                          step={0.5}
                          value={slide.duration}
                          onChange={(e) => handleUpdateSlide(slide.id, { duration: parseFloat(e.target.value) })}
                          className="w-24 h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
                        />
                      </div>
                    </div>

                    {/* Animation toggle */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Animation</label>
                      <div className="flex gap-1">
                        <Button
                          variant={slide.animation === "static" ? "default" : "outline"}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => handleUpdateSlide(slide.id, { animation: "static" })}
                        >
                          Static
                        </Button>
                        <Button
                          variant={slide.animation === "kenburns" ? "default" : "outline"}
                          size="sm"
                          className="h-6 text-xs px-2"
                          onClick={() => handleUpdateSlide(slide.id, { animation: "kenburns" })}
                        >
                          Ken Burns
                        </Button>
                      </div>
                    </div>

                    {/* Ken Burns direction */}
                    {slide.animation === "kenburns" && (
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Direction</label>
                        <div className="relative">
                          <select
                            value={slide.kenBurnsDirection ?? "zoom-in"}
                            onChange={(e) => handleUpdateSlide(slide.id, { kenBurnsDirection: e.target.value as InterstitialSlide["kenBurnsDirection"] })}
                            className="h-6 text-xs pl-2 pr-6 rounded border bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="zoom-in">Zoom In</option>
                            <option value="zoom-out">Zoom Out</option>
                            <option value="pan-left">Pan Left</option>
                            <option value="pan-right">Pan Right</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Inline preview panel (shown when a segment block is selected) */}
          {selectedBlockIndex !== null && selectedMatch && (
            <div className="rounded-md border bg-card p-4 space-y-3">
              <div className="flex items-start gap-4">
                {/* Video preview */}
                {selectedMatch.source_video_id && profileId ? (
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
                )}

                {/* Details */}
                <div className="flex-1 min-w-0 space-y-2">
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
        <div className="max-h-[500px] overflow-y-auto rounded-md border">
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
        open={assigningIndex !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {assigningIndex !== null && (
            <div className="space-y-3">
              {/* Phrase being assigned */}
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {dialogSubLabel}
                </span>
                <p className="mt-0.5 font-medium">
                  &ldquo;{matches[assigningIndex]?.srt_text}&rdquo;
                </p>
              </div>

              {/* D2: generate a fresh clip with AI when no footage fits */}
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
                onClick={() => {
                  setAiGenPrompt(matches[assigningIndex]?.srt_text ?? "");
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
      <GenerateAiSegmentDialog
        open={aiGenOpen}
        onOpenChange={setAiGenOpen}
        initialPrompt={aiGenPrompt}
        onGenerated={(seg) => handleSelectSegment(seg)}
      />
    </>
  );
}
