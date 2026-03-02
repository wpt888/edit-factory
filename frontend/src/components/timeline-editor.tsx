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
  List,
  LayoutPanelLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  ImageIcon,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { formatTimeShort as formatTime } from "@/lib/utils";
import type { SubtitleSettings } from "@/types/video-processing";

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

interface TimelineEditorProps {
  matches: MatchPreview[];
  audioDuration: number;
  sourceVideoIds: string[];
  availableSegments: SegmentOption[];
  onMatchesChange: (matches: MatchPreview[]) => void;
  profileId?: string;
  pipelineId?: string;
  variantIndex?: number;
  subtitleSettings?: SubtitleSettings;
  interstitialSlides?: InterstitialSlide[];
  onInterstitialSlidesChange?: (slides: InterstitialSlide[]) => void;
}


export function TimelineEditor({
  matches,
  audioDuration,
  sourceVideoIds: _sourceVideoIds,
  availableSegments,
  onMatchesChange,
  profileId,
  pipelineId,
  variantIndex,
  subtitleSettings,
  interstitialSlides = [],
  onInterstitialSlidesChange,
}: TimelineEditorProps) {
  // View mode: "timeline" (horizontal) or "list" (vertical)
  const [viewMode, setViewMode] = useState<"timeline" | "list">("timeline");

  // Dialog state (used for both unmatched assignment and swap)
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"same" | "all">("all");

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
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState(0);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewActiveIndex, setPreviewActiveIndex] = useState(0);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const isPreviewPlayingRef = useRef(false);
  const previewActiveIndexRef = useRef(0);
  const previewSegmentEndTimeRef = useRef<number | undefined>(undefined);
  const matchesRef = useRef(matches);
  const previewRafIdRef = useRef<number | null>(null);

  // Keep refs in sync (state → ref for use in callbacks)
  // Note: isPreviewPlayingRef is also set synchronously in togglePreviewPlayPause to avoid 1-frame stale reads
  useEffect(() => { isPreviewPlayingRef.current = isPreviewPlaying; }, [isPreviewPlaying]);
  useEffect(() => { previewActiveIndexRef.current = previewActiveIndex; }, [previewActiveIndex]);
  useEffect(() => { matchesRef.current = matches; }, [matches]);

  // Cleanup: pause all audio/video and stop rAF on unmount
  useEffect(() => {
    return () => {
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
      for (const vid of Object.values(previewVideoRefs.current)) {
        if (vid) vid.pause();
      }
    };
  }, []);

  // Unique source video IDs for video pooling
  const videoMatches = matches.filter((m) => m.segment_id && m.source_video_id);
  const uniqueSourceVideoIds = Array.from(
    new Set(videoMatches.map((m) => m.source_video_id!))
  );
  const videoIdsKey = uniqueSourceVideoIds.join(",");

  // Prune stale entries from previewVideoRefs when source video IDs change
  useEffect(() => {
    const validIds = new Set(uniqueSourceVideoIds);
    for (const key of Object.keys(previewVideoRefs.current)) {
      if (!validIds.has(key)) {
        const vid = previewVideoRefs.current[key];
        if (vid) vid.pause();
        delete previewVideoRefs.current[key];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIdsKey]);

  // Can we show the preview? Need pipelineId and at least one video match
  const canPreview = !!(pipelineId && variantIndex !== undefined && videoMatches.length > 0);

  // --- Continuous preview helpers (same pattern as VariantPreviewPlayer) ---

  const findActiveMatch = useCallback((time: number): number => {
    const ms = matchesRef.current;
    const idx = ms.findIndex((m) => m.srt_start <= time && time < m.srt_end);
    return idx >= 0 ? idx : previewActiveIndexRef.current;
  }, []);

  const syncPreviewVideo = useCallback((matchIdx: number) => {
    const match = matchesRef.current[matchIdx];
    if (!match?.source_video_id || match.segment_start_time == null) return;

    for (const vid of Object.values(previewVideoRefs.current)) {
      if (vid) vid.pause();
    }

    const activeVideo = previewVideoRefs.current[match.source_video_id];
    if (!activeVideo) return;

    activeVideo.currentTime = match.segment_start_time;

    // If this match belongs to a merge group, let the video play for the
    // full group duration instead of pausing at the individual segment end.
    if (match.merge_group_duration != null && match.segment_start_time != null) {
      previewSegmentEndTimeRef.current = match.segment_start_time + match.merge_group_duration;
    } else {
      previewSegmentEndTimeRef.current = match.segment_end_time ?? undefined;
    }

    if (isPreviewPlayingRef.current) {
      activeVideo.play().catch(() => {});
    }
  }, []);

  // rAF loop — tracks audio.currentTime at ~60fps for near-instant segment switching
  // This replaces timeupdate (which only fires ~4Hz) to eliminate ~250ms segment switch lag
  const startPreviewRafLoop = useCallback(() => {
    const loop = () => {
      const audio = previewAudioRef.current;
      if (!audio || !isPreviewPlayingRef.current) {
        previewRafIdRef.current = null;
        return;
      }
      const time = audio.currentTime;
      setPreviewCurrentTime(time);

      const newIdx = findActiveMatch(time);
      if (newIdx !== previewActiveIndexRef.current) {
        const ms = matchesRef.current;
        const oldGroup = ms[previewActiveIndexRef.current]?.merge_group;
        const newGroup = ms[newIdx]?.merge_group;
        // Only switch video when entering a DIFFERENT merge group (or no groups)
        const groupChanged = oldGroup === undefined || newGroup === undefined || oldGroup !== newGroup;

        setPreviewActiveIndex(newIdx);
        previewActiveIndexRef.current = newIdx;
        if (groupChanged) {
          syncPreviewVideo(newIdx);
        }
      }

      previewRafIdRef.current = requestAnimationFrame(loop);
    };
    if (previewRafIdRef.current != null) cancelAnimationFrame(previewRafIdRef.current);
    previewRafIdRef.current = requestAnimationFrame(loop);
  }, [findActiveMatch, syncPreviewVideo]);

  const stopPreviewRafLoop = useCallback(() => {
    if (previewRafIdRef.current != null) {
      cancelAnimationFrame(previewRafIdRef.current);
      previewRafIdRef.current = null;
    }
  }, []);

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
      for (const vid of Object.values(previewVideoRefs.current)) {
        if (vid) vid.pause();
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      stopPreviewRafLoop();
    };
  }, [isPreviewActive, stopPreviewRafLoop]);

  // Video segment_end_time enforcement
  useEffect(() => {
    if (!isPreviewActive) return;
    const handlers: Array<[HTMLVideoElement, () => void]> = [];

    for (const vid of Object.values(previewVideoRefs.current)) {
      if (!vid) continue;
      const handler = () => {
        if (
          previewSegmentEndTimeRef.current != null &&
          vid.currentTime >= previewSegmentEndTimeRef.current
        ) {
          vid.pause();
        }
      };
      vid.addEventListener("timeupdate", handler);
      handlers.push([vid, handler]);
    }

    return () => {
      handlers.forEach(([vid, h]) => vid.removeEventListener("timeupdate", h));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewActive, videoIdsKey]);

  const togglePreviewPlayPause = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;

    if (isPreviewPlayingRef.current) {
      audio.pause();
      stopPreviewRafLoop();
      for (const vid of Object.values(previewVideoRefs.current)) {
        if (vid) vid.pause();
      }
      // Set ref synchronously to prevent 1-frame stale read in rAF loop
      isPreviewPlayingRef.current = false;
      setIsPreviewPlaying(false);
    } else {
      // Set ref synchronously before starting rAF loop
      isPreviewPlayingRef.current = true;
      setIsPreviewPlaying(true);
      audio.play().catch(() => {});
      const match = matchesRef.current[previewActiveIndexRef.current];
      if (match?.source_video_id) {
        const vid = previewVideoRefs.current[match.source_video_id];
        if (vid) {
          vid.currentTime = match.segment_start_time ?? vid.currentTime;
          vid.play().catch(() => {});
        }
      }
      startPreviewRafLoop();
    }
  }, [startPreviewRafLoop, stopPreviewRafLoop]);

  const previewPrevSegment = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio || previewActiveIndexRef.current <= 0) return;
    const prevIdx = previewActiveIndexRef.current - 1;
    audio.currentTime = matchesRef.current[prevIdx].srt_start;
    setPreviewActiveIndex(prevIdx);
    previewActiveIndexRef.current = prevIdx;
    syncPreviewVideo(prevIdx);
  }, [syncPreviewVideo]);

  const previewNextSegment = useCallback(() => {
    const audio = previewAudioRef.current;
    if (!audio || previewActiveIndexRef.current >= matchesRef.current.length - 1) return;
    const nextIdx = previewActiveIndexRef.current + 1;
    audio.currentTime = matchesRef.current[nextIdx].srt_start;
    setPreviewActiveIndex(nextIdx);
    previewActiveIndexRef.current = nextIdx;
    syncPreviewVideo(nextIdx);
  }, [syncPreviewVideo]);

  const handlePreviewSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setPreviewCurrentTime(time);
    const newIdx = findActiveMatch(time);
    setPreviewActiveIndex(newIdx);
    previewActiveIndexRef.current = newIdx;
    syncPreviewVideo(newIdx);
  }, [findActiveMatch, syncPreviewVideo]);

  const handleSeekToSegment = useCallback((idx: number) => {
    if (!isPreviewActive) return;
    const audio = previewAudioRef.current;
    if (!audio) return;
    const match = matchesRef.current[idx];
    if (!match) return;
    audio.currentTime = match.srt_start;
    setPreviewCurrentTime(match.srt_start);
    setPreviewActiveIndex(idx);
    previewActiveIndexRef.current = idx;
    syncPreviewVideo(idx);
  }, [isPreviewActive, syncPreviewVideo]);

  const activatePreview = useCallback(() => {
    setIsPreviewActive(true);
    setPreviewActiveIndex(0);
    previewActiveIndexRef.current = 0;
    setPreviewCurrentTime(0);
    // Auto-play after a short delay to let audio element load
    setTimeout(() => {
      const audio = previewAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().then(() => {
          isPreviewPlayingRef.current = true;
          setIsPreviewPlaying(true);
          syncPreviewVideo(0);
          startPreviewRafLoop();
        }).catch(() => {});
      }
    }, 100);
  }, [syncPreviewVideo, startPreviewRafLoop]);

  const deactivatePreview = useCallback(() => {
    stopPreviewRafLoop();
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    for (const vid of Object.values(previewVideoRefs.current)) {
      if (vid) vid.pause();
    }
    isPreviewPlayingRef.current = false;
    setIsPreviewActive(false);
    setIsPreviewPlaying(false);
    setPreviewCurrentTime(0);
    setPreviewActiveIndex(0);
    previewActiveIndexRef.current = 0;
    previewSegmentEndTimeRef.current = undefined;
  }, [stopPreviewRafLoop]);

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

    const updatedMatches = matches.map((match, idx) => {
      if (idx === assigningIndex) {
        return {
          ...match,
          segment_id: segment.id,
          segment_keywords: segment.keywords,
          matched_keyword: segment.keywords[0] ?? null,
          confidence: 1.0,
          source_video_id: segment.source_video_id,
          segment_start_time: segment.start_time,
          segment_end_time: segment.end_time,
          thumbnail_path: segment.thumbnail_path,
          product_group: segment.product_group,
          is_auto_filled: false,
        };
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

  // --- Interstitial slide handlers ---

  const handleInsertSlide = (afterMatchIndex: number) => {
    if (!onInterstitialSlidesChange) return;
    const newSlide: InterstitialSlide = {
      id: Math.random().toString(36).slice(2, 10),
      afterMatchIndex,
      imageUrl: "",
      duration: 2.0,
      animation: "kenburns",
      kenBurnsDirection: "zoom-in",
      productTitle: "",
    };
    const updated = [...interstitialSlides, newSlide];
    onInterstitialSlidesChange(updated);
    setSelectedSlideId(newSlide.id);
    setSelectedBlockIndex(null);
  };

  const handleUpdateSlide = (slideId: string, changes: Partial<InterstitialSlide>) => {
    if (!onInterstitialSlidesChange) return;
    const updated = interstitialSlides.map((s) =>
      s.id === slideId ? { ...s, ...changes } : s
    );
    onInterstitialSlidesChange(updated);
  };

  const handleRemoveSlide = (slideId: string) => {
    if (!onInterstitialSlidesChange) return;
    const updated = interstitialSlides.filter((s) => s.id !== slideId);
    onInterstitialSlidesChange(updated);
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
    const endTime = match.segment_end_time;

    // Change src when source_video_id or start time changes (handles same-source segments)
    if (sourceVideoId && (sourceVideoId !== lastSourceVideoId.current || startTime !== lastStartTime.current) && profileId) {
      lastSourceVideoId.current = sourceVideoId;
      lastStartTime.current = startTime;
      video.src = `${API_URL}/segments/source-videos/${sourceVideoId}/stream?profile_id=${profileId}`;
      video.load();
    }

    const handleLoaded = () => {
      video.currentTime = startTime;
      video.play().catch(() => {});
    };

    const handleTimeUpdate = () => {
      if (endTime !== undefined && video.currentTime >= endTime) {
        video.pause();
      }
    };

    video.addEventListener("loadeddata", handleLoaded);
    video.addEventListener("timeupdate", handleTimeUpdate);

    // If video is already loaded (same source), just seek
    if (video.readyState >= 2) {
      video.currentTime = startTime;
      video.play().catch(() => {});
    }

    return () => {
      video.removeEventListener("loadeddata", handleLoaded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [viewMode, selectedBlockIndex, matches, profileId]);

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Film className="h-4 w-4 mr-2" />
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
  const totalDuration = audioDuration > 0
    ? audioDuration
    : matches.reduce((sum, m) => sum + (m.duration_override ?? (m.srt_end - m.srt_start)), 0);

  // Selected match for inline preview
  const selectedMatch = selectedBlockIndex !== null ? matches[selectedBlockIndex] : null;

  return (
    <>
      {/* View toggle + Play Preview */}
      <div className="flex items-center gap-1 mb-3">
        <Button
          variant={viewMode === "timeline" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setViewMode("timeline")}
        >
          <LayoutPanelLeft className="h-3.5 w-3.5" />
          Timeline
        </Button>
        <Button
          variant={viewMode === "list" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setViewMode("list")}
        >
          <List className="h-3.5 w-3.5" />
          List
        </Button>

        {canPreview && (
          <div className="ml-auto">
            {isPreviewActive ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={deactivatePreview}
              >
                <Square className="h-3 w-3" />
                Stop Preview
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950/30"
                onClick={activatePreview}
              >
                <Play className="h-3 w-3" />
                Play Preview
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Inline continuous preview player */}
      {isPreviewActive && pipelineId && variantIndex !== undefined && profileId && (
        <div className="rounded-lg border bg-card mb-3 overflow-hidden">
          {/* Hidden audio element */}
          <audio
            ref={previewAudioRef}
            src={`${API_URL}/pipeline/audio/${pipelineId}/${variantIndex}`}
            preload="auto"
          />

          {/* Video display with subtitle overlay */}
          <div
            className="relative mx-auto bg-black flex items-center justify-center"
            style={{ aspectRatio: "9/16", maxHeight: "360px" }}
          >
            {uniqueSourceVideoIds.map((sourceVideoId) => (
              <video
                key={sourceVideoId}
                ref={(el) => { previewVideoRefs.current[sourceVideoId] = el; }}
                src={`${API_URL}/segments/source-videos/${sourceVideoId}/stream?profile_id=${profileId}`}
                muted
                playsInline
                preload="auto"
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  display:
                    matches[previewActiveIndex]?.source_video_id === sourceVideoId
                      ? "block"
                      : "none",
                }}
              />
            ))}

            {/* No video fallback */}
            {!matches[previewActiveIndex]?.source_video_id && (
              <div className="flex items-center justify-center text-muted-foreground text-sm">
                No video for this segment
              </div>
            )}

            {/* Subtitle overlay — respects subtitleSettings if provided */}
            {matches[previewActiveIndex]?.srt_text && (
              <div
                className="absolute left-2 right-2 text-center pointer-events-none"
                style={{
                  top: `${subtitleSettings?.positionY ?? 85}%`,
                  transform: "translateY(-50%)",
                }}
              >
                <p
                  className="font-semibold px-2 py-1 inline-block"
                  style={{
                    fontFamily: subtitleSettings?.fontFamily ?? "var(--font-montserrat), Montserrat, sans-serif",
                    fontSize: `${Math.max(8, (subtitleSettings?.fontSize ?? 48) * 0.22)}px`,
                    color: subtitleSettings?.textColor ?? "#FFFFFF",
                    textShadow: subtitleSettings?.enableGlow
                      ? `0 1px 4px rgba(0,0,0,0.9), 0 0 ${subtitleSettings?.glowBlur ?? 8}px rgba(0,0,0,0.7)`
                      : "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)",
                    WebkitTextStroke: subtitleSettings?.outlineWidth
                      ? `${Math.max(0.5, subtitleSettings.outlineWidth * 0.3)}px ${subtitleSettings?.outlineColor ?? "#000000"}`
                      : undefined,
                  }}
                >
                  {matches[previewActiveIndex].srt_text}
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="px-3 py-2 space-y-1.5">
            {/* Progress bar */}
            <input
              type="range"
              min={0}
              max={previewDuration || 1}
              step={0.1}
              value={previewCurrentTime}
              onChange={handlePreviewSeek}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
            />

            {/* Time + segment info + buttons */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                {formatTime(previewCurrentTime)} / {formatTime(previewDuration || audioDuration)}
              </span>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={previewPrevSegment}
                  disabled={previewActiveIndex <= 0}
                  title="Previous segment"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8"
                  onClick={togglePreviewPlayPause}
                  title={isPreviewPlaying ? "Pause" : "Play"}
                >
                  {isPreviewPlaying ? (
                    <Pause className="h-4 w-4" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={previewNextSegment}
                  disabled={previewActiveIndex >= matches.length - 1}
                  title="Next segment"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </Button>
              </div>

              <span className="text-[11px] text-muted-foreground">
                {previewActiveIndex + 1}/{matches.length}
              </span>
            </div>
          </div>
        </div>
      )}

      {viewMode === "timeline" ? (
        /* ========== TIMELINE VIEW ========== */
        <div className="space-y-3">
          {/* Horizontal scrollable strip — grouped by merge_group */}
          <div className="overflow-x-auto rounded-md border bg-muted/30 p-2">
            <div className="flex items-stretch gap-0.5" style={{ minWidth: "100%" }}>
              {(() => {
                // Group consecutive matches by merge_group
                const groups: { groupId: number; groupDuration: number; matchIndices: number[] }[] = [];
                let currentGroup: typeof groups[0] | null = null;
                matches.forEach((match, idx) => {
                  const mg = match.merge_group;
                  if (mg !== undefined && currentGroup && currentGroup.groupId === mg) {
                    currentGroup.matchIndices.push(idx);
                  } else {
                    currentGroup = {
                      groupId: mg ?? idx,
                      groupDuration: match.merge_group_duration ?? (match.srt_end - match.srt_start),
                      matchIndices: [idx],
                    };
                    groups.push(currentGroup);
                  }
                });

                const elements: React.ReactNode[] = [];

                // Helper: render a "+" insertion button
                const renderInsertButton = (afterMatchIndex: number) => {
                  if (!onInterstitialSlidesChange) return null;
                  return (
                    <button
                      key={`insert-${afterMatchIndex}`}
                      onClick={() => handleInsertSlide(afterMatchIndex)}
                      className="flex-shrink-0 flex items-center justify-center w-5 h-[80px] rounded border border-dashed border-indigo-400 text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 transition-colors"
                      title={`Insert image slide ${afterMatchIndex === -1 ? "before first block" : "here"}`}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  );
                };

                // Helper: render an interstitial slide block
                const renderSlideBlock = (slide: InterstitialSlide) => {
                  const slideWidthPercent = totalDuration > 0 ? (slide.duration / totalDuration) * 100 : 5;
                  const isSlideSelected = selectedSlideId === slide.id;
                  return (
                    <div
                      key={`slide-${slide.id}`}
                      onClick={() => {
                        setSelectedSlideId(slide.id === selectedSlideId ? null : slide.id);
                        setSelectedBlockIndex(null);
                      }}
                      className={`
                        relative flex-shrink-0 rounded-md border-2 cursor-pointer
                        transition-all select-none overflow-hidden
                        border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20
                        ${isSlideSelected ? "ring-2 ring-indigo-500 ring-offset-1" : ""}
                      `}
                      style={{
                        width: `max(50px, ${slideWidthPercent}%)`,
                        height: "80px",
                      }}
                      title={slide.productTitle || "Image slide"}
                    >
                      {/* Background image thumbnail */}
                      {slide.imageUrl && (
                        <img
                          src={slide.imageUrl}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-40"
                          loading="lazy"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center justify-center h-full px-1 py-1 text-center">
                        <ImageIcon className="h-3 w-3 text-indigo-600 dark:text-indigo-400 mb-0.5" />
                        <span className="text-[10px] font-medium leading-tight text-indigo-700 dark:text-indigo-300">
                          {slide.duration.toFixed(1)}s
                        </span>
                        {slide.animation === "kenburns" && (
                          <span className="text-[9px] text-indigo-500 dark:text-indigo-400 leading-none mt-0.5">KB</span>
                        )}
                      </div>
                    </div>
                  );
                };

                // Insert "before first" button
                elements.push(renderInsertButton(-1));

                // Slides before the first group (afterMatchIndex === -1)
                interstitialSlides
                  .filter((s) => s.afterMatchIndex === -1)
                  .forEach((s) => elements.push(renderSlideBlock(s)));

                groups.forEach((group) => {
                  const firstIdx = group.matchIndices[0];
                  const lastIdx = group.matchIndices[group.matchIndices.length - 1];
                  const firstMatch = matches[firstIdx];
                  const isMulti = group.matchIndices.length > 1;
                  const groupDuration = group.groupDuration;
                  const widthPercent = totalDuration > 0 ? (groupDuration / totalDuration) * 100 : 10;

                  // Use first match for color/status
                  const isMatched = firstMatch.segment_id !== null && firstMatch.confidence > 0;
                  const isAutoFilled = firstMatch.is_auto_filled === true && firstMatch.segment_id !== null;
                  const isSelected = group.matchIndices.includes(selectedBlockIndex ?? -1);
                  const isPreviewHighlighted = isPreviewActive && group.matchIndices.includes(previewActiveIndex);

                  const borderColor = isMatched
                    ? "border-green-500"
                    : isAutoFilled
                    ? "border-blue-500"
                    : "border-amber-500";

                  const bgColor = isSelected
                    ? "bg-accent"
                    : isMatched
                    ? "bg-green-50 dark:bg-green-950/20"
                    : isAutoFilled
                    ? "bg-blue-50 dark:bg-blue-950/20"
                    : "bg-amber-50 dark:bg-amber-950/20";

                  // Combine texts for tooltip
                  const groupTexts = group.matchIndices.map(i => matches[i].srt_text).join(" ");

                  elements.push(
                    <div
                      key={`g-${group.groupId}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, firstIdx)}
                      onDragOver={(e) => handleDragOver(e, firstIdx)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, firstIdx)}
                      onDragEnd={handleDragEnd}
                      onClick={() => {
                        if (isPreviewActive) {
                          handleSeekToSegment(firstIdx);
                        } else {
                          setSelectedBlockIndex(firstIdx === selectedBlockIndex ? null : firstIdx);
                          setSelectedSlideId(null);
                        }
                      }}
                      className={`
                        relative flex-shrink-0 rounded-md border-2 cursor-pointer
                        transition-all select-none overflow-hidden
                        ${borderColor} ${bgColor}
                        ${isSelected && !isPreviewActive ? "ring-2 ring-primary ring-offset-1" : ""}
                        ${isPreviewHighlighted ? "ring-2 ring-green-400 ring-offset-1 animate-pulse" : ""}
                      `}
                      style={{
                        width: `max(${isMulti ? 90 : 60}px, ${widthPercent}%)`,
                        height: "80px",
                      }}
                      title={groupTexts}
                    >
                      {/* Thumbnail background */}
                      {firstMatch.thumbnail_path && (
                        <img
                          src={`${API_URL}/segments/files/${encodeURIComponent(firstMatch.thumbnail_path)}`}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover opacity-40"
                          loading="lazy"
                        />
                      )}
                      {/* Content overlay */}
                      <div className="relative z-10 flex flex-col items-center justify-center h-full px-1 py-1 text-center">
                        {isMulti ? (
                          <>
                            <span className="text-[10px] font-mono font-bold leading-none">
                              #{firstMatch.srt_index + 1}-{matches[group.matchIndices[group.matchIndices.length - 1]].srt_index + 1}
                            </span>
                            <span className="text-[10px] font-medium leading-tight mt-0.5">
                              {groupDuration.toFixed(1)}s
                            </span>
                            <span className="text-[9px] text-muted-foreground leading-tight mt-0.5 truncate max-w-full">
                              {group.matchIndices.length} phrases
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] font-mono font-bold leading-none">
                              #{firstMatch.srt_index + 1}
                            </span>
                            <span className="text-[10px] font-medium leading-tight mt-0.5 truncate max-w-full">
                              {groupDuration.toFixed(1)}s
                            </span>
                            <span className="text-[9px] text-muted-foreground leading-tight mt-0.5 truncate max-w-full">
                              {firstMatch.matched_keyword ?? (isAutoFilled ? "auto" : "?")}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );

                  // "+" button after this group
                  elements.push(renderInsertButton(lastIdx));

                  // Interstitial slides after this group
                  interstitialSlides
                    .filter((s) => s.afterMatchIndex === lastIdx)
                    .forEach((s) => elements.push(renderSlideBlock(s)));
                });

                return elements;
              })()}
            </div>
          </div>

          {/* Interstitial slide config panel (shown when a slide block is selected) */}
          {selectedSlideId !== null && (() => {
            const slide = interstitialSlides.find((s) => s.id === selectedSlideId);
            if (!slide) return null;
            return (
              <div className="rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    <ImageIcon className="h-4 w-4" />
                    Image Slide Config
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => handleRemoveSlide(slide.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </Button>
                </div>

                <div className="flex items-start gap-4">
                  {/* Image preview */}
                  <div className="flex-shrink-0 w-20 h-20 rounded border overflow-hidden bg-muted flex items-center justify-center">
                    {slide.imageUrl ? (
                      <img
                        src={slide.imageUrl}
                        alt="Product"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Image URL */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Image URL</label>
                      <input
                        type="text"
                        value={slide.imageUrl}
                        onChange={(e) => handleUpdateSlide(slide.id, { imageUrl: e.target.value })}
                        placeholder="https://..."
                        className="w-full h-7 text-xs px-2 rounded border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    {/* Duration */}
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Duration</label>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleUpdateSlide(slide.id, { duration: Math.max(0.5, slide.duration - 0.5) })}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-12 text-center text-xs font-mono tabular-nums">
                          {slide.duration.toFixed(1)}s
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => handleUpdateSlide(slide.id, { duration: Math.min(5.0, slide.duration + 0.5) })}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <input
                          type="range"
                          min={0.5}
                          max={5.0}
                          step={0.5}
                          value={slide.duration}
                          onChange={(e) => handleUpdateSlide(slide.id, { duration: parseFloat(e.target.value) })}
                          className="w-24 h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary accent-indigo-500"
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
                            className="h-6 text-xs pl-2 pr-6 rounded border bg-background text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          >
                            <option value="zoom-in">Zoom In</option>
                            <option value="zoom-out">Zoom Out</option>
                            <option value="pan-left">Pan Left</option>
                            <option value="pan-right">Pan Right</option>
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
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
                    <Film className="h-6 w-6 text-muted-foreground" />
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
                      className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {selectedMatch.matched_keyword}
                    </Badge>
                  )}

                  {/* Duration controls */}
                  <div className="flex items-center gap-1 text-xs">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => adjustDuration(selectedBlockIndex, -0.5)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-10 text-center font-mono tabular-nums">
                      {(selectedMatch.duration_override ?? (selectedMatch.srt_end - selectedMatch.srt_start)).toFixed(1)}s
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => adjustDuration(selectedBlockIndex, 0.5)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Swap button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleOpenDialog(selectedBlockIndex)}
                    disabled={availableSegments.length === 0}
                  >
                    <RefreshCw className="h-3 w-3" />
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
            {onInterstitialSlidesChange && (
              <div className="flex items-center px-3 py-1 bg-muted/20">
                <button
                  onClick={() => handleInsertSlide(-1)}
                  className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                >
                  <Plus className="h-3 w-3" />
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
                  className="group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-indigo-500 bg-indigo-50 dark:bg-indigo-950/20"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden border bg-muted flex items-center justify-center">
                    {slide.imageUrl ? (
                      <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-indigo-700 dark:text-indigo-300">
                    <div className="font-medium">Image Slide</div>
                    <div className="text-xs text-muted-foreground">{slide.duration.toFixed(1)}s · {slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-opacity"
                    onClick={() => handleRemoveSlide(slide.id)}
                    title="Remove slide"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            {matches.map((match, idx) => {
              const isMatched = match.segment_id !== null && match.confidence > 0;
              const isAutoFilled = match.is_auto_filled === true && match.segment_id !== null;
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
                      ? "border-l-green-500 bg-green-50 dark:bg-green-950/20"
                      : isAutoFilled
                      ? "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
                      : "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                  } ${isDragging ? "opacity-50" : ""} ${
                    isDragOver
                      ? "border-t-2 border-t-blue-500"
                      : "border-t-transparent"
                  } ${isInGroup ? "border-r-2 border-r-purple-400 dark:border-r-purple-600" : ""} ${
                    isGroupStart && isInGroup ? "rounded-tr-md" : ""
                  } ${isGroupEnd && isInGroup ? "rounded-br-md" : ""}`}
                >
                  {/* Drag handle */}
                  <div
                    className="flex-shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title="Drag to swap segment assignment"
                  >
                    <GripVertical className="h-4 w-4" />
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
                          className="text-[10px] font-mono bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1 rounded mr-0.5"
                          title={`Segment video: ${match.merge_group_duration.toFixed(1)}s (grupate)`}
                        >
                          {match.merge_group_duration.toFixed(1)}s
                        </span>
                      ) : null}
                      <span title="Subtitle duration">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={() => adjustDuration(idx, -0.5)}
                        title="Decrease duration by 0.5s"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span
                        className={`w-10 text-center font-mono tabular-nums ${
                          isDurationOverridden
                            ? "text-blue-600 dark:text-blue-400 font-semibold"
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
                        className="h-5 w-5"
                        onClick={() => adjustDuration(idx, 0.5)}
                        title="Increase duration by 0.5s"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Match status */}
                    <div className="flex items-center gap-2">
                      {isMatched ? (
                        <>
                          <Badge
                            variant="secondary"
                            className="text-xs bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 max-w-[90px]"
                          >
                            <CheckCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{match.matched_keyword}</span>
                          </Badge>
                          <span className="text-xs text-green-700 dark:text-green-400 font-medium">
                            {Math.round(match.confidence * 100)}%
                          </span>
                          {match.product_group && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1 border-purple-400 text-purple-600 dark:text-purple-300">
                              {match.product_group}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleOpenDialog(idx)}
                            disabled={availableSegments.length === 0}
                            title="Swap segment"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </>
                      ) : isAutoFilled ? (
                        <>
                          <Badge
                            variant="secondary"
                            className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 max-w-[90px]"
                          >
                            <Film className="h-3 w-3 mr-1 flex-shrink-0" />
                            <span className="truncate">{match.segment_keywords[0] ?? "auto"}</span>
                          </Badge>
                          <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            auto
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleOpenDialog(idx)}
                            disabled={availableSegments.length === 0}
                            title="Swap segment"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge
                            variant="outline"
                            className="text-xs border-amber-400 text-amber-700 dark:text-amber-300"
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Unmatched
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
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
                    className="group flex items-center gap-3 px-3 py-2.5 border-l-4 border-l-indigo-500 bg-indigo-50 dark:bg-indigo-950/20"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded overflow-hidden border bg-muted flex items-center justify-center">
                      {slide.imageUrl ? (
                        <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display="none"; }} />
                      ) : (
                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-sm text-indigo-700 dark:text-indigo-300">
                      <div className="font-medium">Image Slide</div>
                      <div className="text-xs text-muted-foreground">{slide.duration.toFixed(1)}s · {slide.animation === "kenburns" ? `Ken Burns (${slide.kenBurnsDirection ?? "zoom-in"})` : "Static"}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-opacity"
                      onClick={() => handleRemoveSlide(slide.id)}
                      title="Remove slide"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {/* "+" insert after this match */}
                {onInterstitialSlidesChange && (
                  <div className="flex items-center px-3 py-1 bg-muted/20">
                    <button
                      onClick={() => handleInsertSlide(idx)}
                      className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
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

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
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
                        <Film className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
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
    </>
  );
}
