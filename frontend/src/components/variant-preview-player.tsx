"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Pause, SkipBack, SkipForward, RefreshCw, Search, Film } from "lucide-react";
import { API_URL } from "@/lib/api";
import { formatTimeShort as formatTime } from "@/lib/utils";
import type { MatchPreview, SegmentOption } from "@/components/timeline-editor";
import type { SubtitleSettings } from "@/types/video-processing";

interface VariantPreviewPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchPreview[];
  pipelineId: string;
  variantIndex: number;
  profileId: string;
  subtitleSettings?: SubtitleSettings;
  availableSegments?: SegmentOption[];
  onMatchSwap?: (matchIndex: number, newSegment: SegmentOption) => void;
}

export function VariantPreviewPlayer({
  open,
  onOpenChange,
  matches,
  pipelineId,
  variantIndex,
  profileId,
  subtitleSettings,
  availableSegments,
  onMatchSwap,
}: VariantPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const prevMatchesRef = useRef(matches);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

  // Swap popover state
  const [swapPopoverOpen, setSwapPopoverOpen] = useState(false);
  const [swapSearchQuery, setSwapSearchQuery] = useState("");

  // Refs for stable closures — avoid stale captures in event listeners
  const isPlayingRef = useRef(false);
  const activeMatchIndexRef = useRef(0);
  const segmentEndTimeRef = useRef<number | undefined>(undefined);
  const matchesRef = useRef(matches);

  // Keep refs in sync with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    activeMatchIndexRef.current = activeMatchIndex;
  }, [activeMatchIndex]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  // Clean stale video refs when matches prop changes
  useEffect(() => {
    if (prevMatchesRef.current !== matches) {
      const currentIds = new Set(
        matches.filter((m) => m.source_video_id).map((m) => m.source_video_id!)
      );
      for (const id of Object.keys(videoRefs.current)) {
        if (!currentIds.has(id)) {
          delete videoRefs.current[id];
        }
      }
      prevMatchesRef.current = matches;
    }
  }, [matches]);

  // Filter matches that have video data for sync
  const videoMatches = matches.filter(
    (m) => m.segment_id && m.source_video_id
  );

  // Get unique source video IDs for pooling video elements
  const uniqueSourceVideoIds = Array.from(
    new Set(videoMatches.map((m) => m.source_video_id!))
  );
  const videoIdsKey = uniqueSourceVideoIds.join(",");

  // Swap: filtered segments with proximity ±2 rule
  const swapFilteredSegments = useMemo(() => {
    if (!availableSegments || activeMatchIndex === null) return [];
    let pool = availableSegments;

    // Proximity ±2: exclude segments already used at neighboring positions
    const nearbySegmentIds = new Set<string>();
    for (let offset = -2; offset <= 2; offset++) {
      if (offset === 0) continue;
      const neighborIdx = activeMatchIndex + offset;
      if (neighborIdx >= 0 && neighborIdx < matches.length) {
        const neighborId = matches[neighborIdx].segment_id;
        if (neighborId) nearbySegmentIds.add(neighborId);
      }
    }
    pool = pool.filter(seg => !nearbySegmentIds.has(seg.id));

    // Keyword search filter
    if (swapSearchQuery.trim()) {
      const q = swapSearchQuery.toLowerCase();
      pool = pool.filter(seg => seg.keywords.some(kw => kw.toLowerCase().includes(q)));
    }

    return pool;
  }, [availableSegments, activeMatchIndex, matches, swapSearchQuery]);

  // Stable findActiveMatch — reads from ref, no activeMatchIndex dep
  const findActiveMatch = useCallback(
    (time: number): number => {
      const ms = matchesRef.current;
      const idx = ms.findIndex((m) => m.srt_start <= time && time < m.srt_end);
      return idx >= 0 ? idx : activeMatchIndexRef.current;
    },
    [] // stable — reads from refs
  );

  // Pre-seek the next segment's video so it's ready when we transition
  const preSeekNext = useCallback((afterIdx: number) => {
    const nextIdx = afterIdx + 1;
    const ms = matchesRef.current;
    if (nextIdx >= ms.length) return;

    const nextMatch = ms[nextIdx];
    if (!nextMatch?.source_video_id || nextMatch.segment_start_time == null) return;

    // Only pre-seek if it's a different source video than the current one
    const currentMatch = ms[afterIdx];
    if (nextMatch.source_video_id === currentMatch?.source_video_id) return;

    const nextVideo = videoRefs.current[nextMatch.source_video_id];
    if (nextVideo) {
      nextVideo.currentTime = nextMatch.segment_start_time;
    }
  }, []);

  // Stable syncVideoToMatch — seeks incoming, waits for seeked, then switches
  const syncVideoToMatch = useCallback(
    (matchIdx: number) => {
      const match = matchesRef.current[matchIdx];
      if (!match?.source_video_id || match.segment_start_time == null) return;

      const incomingVideo = videoRefs.current[match.source_video_id];
      if (!incomingVideo) return;

      // Find the outgoing video (from the previous active match)
      const prevIdx = activeMatchIndexRef.current;
      const prevMatch = matchesRef.current[prevIdx];
      const outgoingVideo = prevMatch?.source_video_id
        ? videoRefs.current[prevMatch.source_video_id]
        : null;

      // CRITICAL: always use the DB segment_end_time as the hard boundary
      // so the preview never plays past the user-defined segment end
      segmentEndTimeRef.current = match.segment_end_time ?? undefined;


      const finishSwitch = () => {
        // Update active match (triggers React re-render for display toggle)
        setActiveMatchIndex(matchIdx);
        activeMatchIndexRef.current = matchIdx;
        pendingSyncIdxRef.current = -1; // Clear seek-storm guard

        if (isPlayingRef.current) {
          incomingVideo.play().catch(() => {});
        }

        // Pause outgoing AFTER incoming is visible and playing
        if (outgoingVideo && outgoingVideo !== incomingVideo) {
          outgoingVideo.pause();
        }

        // Pre-seek the next segment's video
        preSeekNext(matchIdx);
      };

      // Check if video is already at the right position (pre-seeked)
      const alreadySeeked =
        Math.abs(incomingVideo.currentTime - match.segment_start_time) < 0.05;

      if (alreadySeeked) {
        finishSwitch();
      } else {
        // Seek and wait for seeked event before switching
        const onSeeked = () => {
          incomingVideo.removeEventListener("seeked", onSeeked);
          finishSwitch();
        };
        incomingVideo.addEventListener("seeked", onSeeked);
        incomingVideo.currentTime = match.segment_start_time;
      }
    },
    [preSeekNext] // preSeekNext is stable
  );

  // rAF ref for cleanup
  const rafIdRef = useRef<number | null>(null);
  // Guard against seek-storm: tracks which index syncVideoToMatch was last called with
  const pendingSyncIdxRef = useRef<number>(-1);

  // rAF loop — tracks audio.currentTime at ~60fps for near-instant segment detection
  const startRafLoop = useCallback(() => {
    const loop = () => {
      const audio = audioRef.current;
      if (!audio || !isPlayingRef.current) {
        rafIdRef.current = null;
        return;
      }

      const time = audio.currentTime;
      setCurrentTime(time);

      const newIdx = findActiveMatch(time);
      if (newIdx !== activeMatchIndexRef.current) {
        // Guard against seek-storm: syncVideoToMatch updates activeMatchIndexRef
        // only after seeked event fires. Prevent re-calling on every rAF frame
        // by checking if we already initiated a sync for this index.
        if (newIdx !== pendingSyncIdxRef.current) {
          pendingSyncIdxRef.current = newIdx;
          syncVideoToMatch(newIdx);
        }
      }

      rafIdRef.current = requestAnimationFrame(loop);
    };
    // Cancel any existing loop before starting a new one
    if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(loop);
  }, [findActiveMatch, syncVideoToMatch]);

  const stopRafLoop = useCallback(() => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Audio metadata + ended events (no timeupdate — rAF replaces it)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const onEnded = () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
      stopRafLoop();
      for (const vid of Object.values(videoRefs.current)) {
        if (vid) vid.pause();
      }
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      stopRafLoop();
    };
  }, [stopRafLoop]);

  // Video segment_end_time enforcement via rAF (60fps instead of timeupdate's ~4Hz).
  // This prevents ~250ms overshoot past segment boundaries.
  const segmentEnforceRafRef = useRef<number | null>(null);

  useEffect(() => {
    const enforceLoop = () => {
      // Keep loop alive even when paused — prevents it from dying
      // and never restarting when user resumes playback.
      if (isPlayingRef.current) {
        for (const vid of Object.values(videoRefs.current)) {
          if (!vid || vid.paused) continue;
          if (
            segmentEndTimeRef.current != null &&
            vid.currentTime >= segmentEndTimeRef.current
          ) {
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIdsKey]);

  // Play/Pause toggle
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlayingRef.current) {
      audio.pause();
      stopRafLoop();
      for (const vid of Object.values(videoRefs.current)) {
        if (vid) vid.pause();
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      setIsPlaying(true);
      isPlayingRef.current = true;
      audio.play().catch(() => {});
      // Resume active video — always seek to segment_start_time to prevent
      // playing from wherever the video was left (which could be outside the segment)
      const match = matchesRef.current[activeMatchIndexRef.current];
      if (match?.source_video_id && match.segment_start_time != null) {
        const vid = videoRefs.current[match.source_video_id];
        if (vid) {
          segmentEndTimeRef.current = match.segment_end_time ?? undefined;
          vid.currentTime = match.segment_start_time;
          vid.play().catch(() => {});
        }
      }
      startRafLoop();
    }
  }, [startRafLoop, stopRafLoop]);

  // Seek to previous segment
  const prevSegment = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || activeMatchIndexRef.current <= 0) return;

    const prevIdx = activeMatchIndexRef.current - 1;
    audio.currentTime = matchesRef.current[prevIdx].srt_start;
    setActiveMatchIndex(prevIdx);
    activeMatchIndexRef.current = prevIdx;
    syncVideoToMatch(prevIdx);
  }, [syncVideoToMatch]);

  // Seek to next segment
  const nextSegment = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || activeMatchIndexRef.current >= matchesRef.current.length - 1)
      return;

    const nextIdx = activeMatchIndexRef.current + 1;
    audio.currentTime = matchesRef.current[nextIdx].srt_start;
    setActiveMatchIndex(nextIdx);
    activeMatchIndexRef.current = nextIdx;
    syncVideoToMatch(nextIdx);
  }, [syncVideoToMatch]);

  // Seek via progress bar
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;

      const time = parseFloat(e.target.value);
      audio.currentTime = time;
      setCurrentTime(time);

      const newIdx = findActiveMatch(time);
      setActiveMatchIndex(newIdx);
      activeMatchIndexRef.current = newIdx;
      syncVideoToMatch(newIdx);
    },
    [findActiveMatch, syncVideoToMatch]
  );

  // Pause everything on dialog close
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        stopRafLoop();
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        for (const vid of Object.values(videoRefs.current)) {
          if (vid) vid.pause();
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        setCurrentTime(0);
        setActiveMatchIndex(0);
        activeMatchIndexRef.current = 0;
        segmentEndTimeRef.current = undefined;
        setSwapPopoverOpen(false);
        setSwapSearchQuery("");
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, stopRafLoop]
  );

  const handleSwapSelect = useCallback(
    (seg: SegmentOption) => {
      if (onMatchSwap) {
        onMatchSwap(activeMatchIndex, seg);
      }
      setSwapPopoverOpen(false);
      setSwapSearchQuery("");
    },
    [activeMatchIndex, onMatchSwap]
  );

  const activeMatch = matches[activeMatchIndex];
  const fallbackDuration =
    matches.length > 0
      ? matches[matches.length - 1].srt_end - matches[0].srt_start
      : 0;
  const totalDuration = duration > 0 ? duration : fallbackDuration;

  const canSwap = !!availableSegments && availableSegments.length > 0 && !!onMatchSwap;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Variant {variantIndex + 1} Preview</DialogTitle>
        </DialogHeader>

        {/* Audio element (hidden) */}
        <audio
          ref={audioRef}
          src={`${API_URL}/pipeline/audio/${pipelineId}/${variantIndex}`}
          preload="auto"
        />

        {/* Video display with subtitle overlay */}
        <div
          className="relative mx-auto bg-black rounded-lg overflow-hidden flex items-center justify-center"
          style={{ aspectRatio: "9/16", maxHeight: "400px" }}
        >
          {/* Video elements (one per unique source video, toggled via React display) */}
          {uniqueSourceVideoIds.map((sourceVideoId) => (
            <video
              key={sourceVideoId}
              ref={(el) => {
                videoRefs.current[sourceVideoId] = el;
              }}
              src={`${API_URL}/segments/source-videos/${sourceVideoId}/stream?profile_id=${profileId}`}
              muted
              playsInline
              preload="auto"
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                display:
                  activeMatch?.source_video_id === sourceVideoId
                    ? "block"
                    : "none",
              }}
            />
          ))}

          {/* No video fallback */}
          {!activeMatch?.source_video_id && (
            <div className="flex items-center justify-center text-muted-foreground text-sm">
              No video for this segment
            </div>
          )}

          {/* Subtitle overlay */}
          {activeMatch?.srt_text && (
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
                  fontSize: `${Math.max(10, (subtitleSettings?.fontSize ?? 48) * 0.28)}px`,
                  color: subtitleSettings?.textColor ?? "#FFFFFF",
                  textShadow: subtitleSettings?.enableGlow
                    ? `0 1px 4px rgba(0,0,0,0.9), 0 0 ${subtitleSettings?.glowBlur ?? 8}px rgba(0,0,0,0.7)`
                    : "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)",
                  WebkitTextStroke: subtitleSettings?.outlineWidth
                    ? `${Math.max(0.5, subtitleSettings.outlineWidth * 0.3)}px ${subtitleSettings?.outlineColor ?? "#000000"}`
                    : undefined,
                }}
              >
                {activeMatch.srt_text}
              </p>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <input
            type="range"
            min={0}
            max={totalDuration || 1}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-secondary accent-primary"
          />

          {/* Time display */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
            <span>
              Segment {activeMatchIndex + 1}/{matches.length}
              {activeMatch?.matched_keyword && (
                <> &quot;{activeMatch.matched_keyword}&quot;</>
              )}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline" className="text-xs max-w-[120px] truncate">
              {activeMatch?.srt_text
                ? activeMatch.srt_text.slice(0, 30) +
                  (activeMatch.srt_text.length > 30 ? "..." : "")
                : "—"}
            </Badge>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={prevSegment}
                disabled={activeMatchIndex <= 0}
                title="Previous segment"
              >
                <SkipBack className="h-4 w-4" />
              </Button>

              <Button
                variant="default"
                size="icon"
                className="h-10 w-10"
                onClick={togglePlayPause}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={nextSegment}
                disabled={activeMatchIndex >= matches.length - 1}
                title="Next segment"
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            {/* Swap button with popover */}
            {canSwap && (
              <Popover
                open={swapPopoverOpen}
                onOpenChange={(open) => {
                  setSwapPopoverOpen(open);
                  if (!open) setSwapSearchQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    title="Swap segment"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="end">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Swap segment {activeMatchIndex + 1}
                    </p>

                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search keywords..."
                        value={swapSearchQuery}
                        onChange={(e) => setSwapSearchQuery(e.target.value)}
                        className="pl-7 h-8 text-xs"
                        autoFocus
                      />
                    </div>

                    {/* Segment list */}
                    <ScrollArea className="max-h-[200px]">
                      <div className="divide-y">
                        {swapFilteredSegments.length === 0 ? (
                          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                            No segments available
                          </div>
                        ) : (
                          swapFilteredSegments.map((seg) => (
                            <button
                              key={seg.id}
                              className="w-full flex items-start gap-2 px-2 py-1.5 text-left hover:bg-accent transition-colors rounded-sm"
                              onClick={() => handleSwapSelect(seg)}
                            >
                              <Film className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap gap-0.5">
                                  {seg.keywords.slice(0, 3).map((kw) => (
                                    <Badge
                                      key={kw}
                                      variant="secondary"
                                      className="text-[10px] px-1 py-0"
                                    >
                                      {kw}
                                    </Badge>
                                  ))}
                                  {seg.keywords.length > 3 && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                                      +{seg.keywords.length - 3}
                                    </Badge>
                                  )}
                                </div>
                                {seg.duration > 0 && (
                                  <p className="text-[10px] text-muted-foreground">
                                    {seg.duration.toFixed(1)}s
                                  </p>
                                )}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
