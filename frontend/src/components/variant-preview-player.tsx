"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { API_URL } from "@/lib/api";
import type { MatchPreview } from "@/components/timeline-editor";

interface VariantPreviewPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchPreview[];
  pipelineId: string;
  variantIndex: number;
  profileId: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VariantPreviewPlayer({
  open,
  onOpenChange,
  matches,
  pipelineId,
  variantIndex,
  profileId,
}: VariantPreviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

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

  // Filter matches that have video data for sync
  const videoMatches = matches.filter(
    (m) => m.segment_id && m.source_video_id
  );

  // Get unique source video IDs for pooling video elements
  const uniqueSourceVideoIds = Array.from(
    new Set(videoMatches.map((m) => m.source_video_id!))
  );
  const videoIdsKey = uniqueSourceVideoIds.join(",");

  // Stable findActiveMatch — reads from ref, no activeMatchIndex dep
  const findActiveMatch = useCallback(
    (time: number): number => {
      const ms = matchesRef.current;
      const idx = ms.findIndex((m) => m.srt_start <= time && time < m.srt_end);
      return idx >= 0 ? idx : activeMatchIndexRef.current;
    },
    [] // stable — reads from refs
  );

  // Stable syncVideoToMatch — reads from refs, no isPlaying/activeMatchIndex deps
  const syncVideoToMatch = useCallback(
    (matchIdx: number) => {
      const match = matchesRef.current[matchIdx];
      if (!match?.source_video_id || match.segment_start_time == null) return;

      // Pause ALL videos first (fix: old video kept playing silently)
      for (const vid of Object.values(videoRefs.current)) {
        if (vid) vid.pause();
      }

      const activeVideo = videoRefs.current[match.source_video_id];
      if (!activeVideo) return;

      // Seek to segment start and set end boundary
      activeVideo.currentTime = match.segment_start_time;
      segmentEndTimeRef.current = match.segment_end_time ?? undefined;

      // Play if audio is playing (read from ref, not stale closure)
      if (isPlayingRef.current) {
        activeVideo.play().catch(() => {});
      }
    },
    [] // stable — reads from refs
  );

  // Single stable audio effect — no activeMatchIndex in deps
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const time = audio.currentTime;
      setCurrentTime(time);

      const newIdx = findActiveMatch(time);
      if (newIdx !== activeMatchIndexRef.current) {
        setActiveMatchIndex(newIdx);
        activeMatchIndexRef.current = newIdx;
        syncVideoToMatch(newIdx);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const onEnded = () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
      for (const vid of Object.values(videoRefs.current)) {
        if (vid) vid.pause();
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [findActiveMatch, syncVideoToMatch]); // both are stable (no deps)

  // Video timeupdate listeners for segment_end_time enforcement
  // Re-register only when the set of video elements changes
  useEffect(() => {
    const handlers: Array<[HTMLVideoElement, () => void]> = [];

    for (const vid of Object.values(videoRefs.current)) {
      if (!vid) continue;
      const handler = () => {
        if (
          segmentEndTimeRef.current != null &&
          vid.currentTime >= segmentEndTimeRef.current
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
  }, [videoIdsKey]);

  // Play/Pause toggle
  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlayingRef.current) {
      audio.pause();
      for (const vid of Object.values(videoRefs.current)) {
        if (vid) vid.pause();
      }
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      // Resume active video
      const match = matchesRef.current[activeMatchIndexRef.current];
      if (match?.source_video_id) {
        const vid = videoRefs.current[match.source_video_id];
        if (vid) {
          vid.currentTime = match.segment_start_time ?? vid.currentTime;
          vid.play().catch(() => {});
        }
      }
      setIsPlaying(true);
    }
  }, []);

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
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        for (const vid of Object.values(videoRefs.current)) {
          if (vid) vid.pause();
        }
        setIsPlaying(false);
        setCurrentTime(0);
        setActiveMatchIndex(0);
        activeMatchIndexRef.current = 0;
        segmentEndTimeRef.current = undefined;
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  const activeMatch = matches[activeMatchIndex];
  const fallbackDuration =
    matches.length > 0
      ? matches[matches.length - 1].srt_end - matches[0].srt_start
      : 0;
  const totalDuration = duration > 0 ? duration : fallbackDuration;

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
            <div className="absolute bottom-4 left-2 right-2 text-center pointer-events-none">
              <p
                className="text-white text-sm font-semibold px-2 py-1 inline-block"
                style={{
                  textShadow:
                    "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)",
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
            <Badge variant="outline" className="text-xs">
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
