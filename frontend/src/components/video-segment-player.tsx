"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Scissors,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface Segment {
  id?: string;
  start_time: number;
  end_time: number;
  keywords: string[];
  isTemp?: boolean; // For segment being created
}

interface VideoSegmentPlayerProps {
  videoUrl: string;
  duration: number;
  segments: Segment[];
  onSegmentCreate: (start: number, end: number) => void;
  onSegmentClick?: (segment: Segment) => void;
  currentSegment?: Segment;
}

export function VideoSegmentPlayer({
  videoUrl,
  duration,
  segments,
  onSegmentCreate,
  onSegmentClick,
  currentSegment,
}: VideoSegmentPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Marking state
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [isMarking, setIsMarking] = useState(false);

  // Scrubbing state (drag on timeline)
  const [isScrubbing, setIsScrubbing] = useState(false);
  const wasPlayingBeforeScrub = useRef(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Timeline zoom state
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = fit all, higher = zoomed in
  const [scrollOffset, setScrollOffset] = useState(0); // 0-1 range for panning
  const timelineRef = useRef<HTMLDivElement>(null);

  // Calculate visible timeline range based on zoom (guard against duration = 0)
  const safeDuration = duration || 1; // Prevent division by zero
  const visibleDuration = safeDuration / zoomLevel;
  const maxOffset = Math.max(0, 1 - (1 / zoomLevel));
  const visibleStart = scrollOffset * safeDuration;
  const visibleEnd = visibleStart + visibleDuration;

  // Format time as mm:ss.ms
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const ms = Math.floor((time % 1) * 100);
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  // Play/Pause toggle
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      // Catch the promise to prevent "play interrupted by pause" error
      videoRef.current.play().catch(() => {
        // Silently ignore - this happens when play is interrupted by pause
      });
    }
  }, [isPlaying]);

  // Seek to time
  const seekTo = useCallback((time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
  }, [duration]);

  // Frame navigation
  const frameStep = useCallback((direction: number) => {
    if (!videoRef.current) return;
    const fps = 30; // Assume 30fps
    const step = direction / fps;
    seekTo(currentTime + step);
  }, [currentTime, seekTo]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error("Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  // Listen for fullscreen changes (e.g., user presses Escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Mark segment (toggle start/end with C key)
  const toggleMark = useCallback(() => {
    if (markStart === null) {
      // Set start point
      setMarkStart(currentTime);
      setIsMarking(true);
    } else {
      // Set end point and create segment
      const start = markStart;
      const end = currentTime;

      if (end > start) {
        onSegmentCreate(start, end);
      } else if (start > end) {
        // User went backwards, swap
        onSegmentCreate(end, start);
      }

      // Reset marking
      setMarkStart(null);
      setIsMarking(false);
    }
  }, [markStart, currentTime, onSegmentCreate]);

  // Cancel marking
  const cancelMark = useCallback(() => {
    setMarkStart(null);
    setIsMarking(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ": // Space - Play/Pause
          e.preventDefault();
          togglePlay();
          break;
        case "c": // C - Toggle mark start/end
          e.preventDefault();
          toggleMark();
          break;
        case "i": // I - Set In point
          e.preventDefault();
          setMarkStart(currentTime);
          setIsMarking(true);
          break;
        case "o": // O - Set Out point
          e.preventDefault();
          if (markStart !== null && currentTime > markStart) {
            onSegmentCreate(markStart, currentTime);
            setMarkStart(null);
            setIsMarking(false);
          }
          break;
        case "escape": // Escape - Cancel marking
          e.preventDefault();
          cancelMark();
          break;
        case "arrowleft":
          e.preventDefault();
          if (e.shiftKey) {
            seekTo(currentTime - 5); // 5 seconds back
          } else {
            frameStep(-1); // Frame back
          }
          break;
        case "arrowright":
          e.preventDefault();
          if (e.shiftKey) {
            seekTo(currentTime + 5); // 5 seconds forward
          } else {
            frameStep(1); // Frame forward
          }
          break;
        case "j": // Slow down
          e.preventDefault();
          setPlaybackRate((prev) => Math.max(0.25, prev - 0.25));
          break;
        case "k": // Normal speed
          e.preventDefault();
          setPlaybackRate(1);
          break;
        case "l": // Speed up
          e.preventDefault();
          setPlaybackRate((prev) => Math.min(2, prev + 0.25));
          break;
        case "f": // Fullscreen
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleMark, cancelMark, currentTime, markStart, seekTo, frameStep, onSegmentCreate, toggleFullscreen]);

  // Video event handlers with smooth playhead updates
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animationFrameId: number | null = null;

    // Use requestAnimationFrame for smooth playhead updates during playback
    const updateTimeSmooth = () => {
      if (video && !video.paused) {
        setCurrentTime(video.currentTime);
        animationFrameId = requestAnimationFrame(updateTimeSmooth);
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      // Start smooth updates
      animationFrameId = requestAnimationFrame(updateTimeSmooth);
    };

    const handlePause = () => {
      setIsPlaying(false);
      // Stop animation frame and do final update
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      setCurrentTime(video.currentTime);
    };

    // Also update on seeking (when user drags slider)
    const handleSeeking = () => setCurrentTime(video.currentTime);
    const handleSeeked = () => setCurrentTime(video.currentTime);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("seeked", handleSeeked);

    // Initial time sync
    setCurrentTime(video.currentTime);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, []);

  // Update playback rate
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Update volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Calculate segment position on timeline (accounting for zoom)
  const getSegmentStyle = (segment: Segment) => {
    // Convert to zoomed coordinates
    const segStart = ((segment.start_time - visibleStart) / visibleDuration) * 100;
    const segEnd = ((segment.end_time - visibleStart) / visibleDuration) * 100;
    const left = Math.max(0, segStart);
    const right = Math.min(100, segEnd);
    const width = right - left;

    // Hide if completely outside visible range
    if (segEnd < 0 || segStart > 100) {
      return { left: '0%', width: '0%', display: 'none' };
    }

    return { left: `${left}%`, width: `${width}%` };
  };

  // Handle timeline wheel zoom - using native event for proper preventDefault
  // Store zoom state in refs for use in native event handler
  const zoomStateRef = useRef({ zoomLevel, safeDuration, visibleStart, visibleDuration });
  useEffect(() => {
    zoomStateRef.current = { zoomLevel, safeDuration, visibleStart, visibleDuration };
  }, [zoomLevel, safeDuration, visibleStart, visibleDuration]);

  // Native wheel event handler (attached with passive: false)
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const handleWheel = (e: WheelEvent) => {
      // ALWAYS prevent default and stop propagation on timeline
      e.preventDefault();
      e.stopPropagation();

      const { zoomLevel: currentZoom, safeDuration: duration, visibleStart: vStart, visibleDuration: vDuration } = zoomStateRef.current;

      const rect = timeline.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;

      // Calculate new zoom level
      const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(1, Math.min(20, currentZoom * zoomDelta));

      if (newZoom !== currentZoom && duration > 0) {
        const newVisibleDuration = duration / newZoom;
        const newMaxOffset = Math.max(0, 1 - (1 / newZoom));
        const mouseTime = vStart + (mouseX * vDuration);
        const newVisibleStart = mouseTime - (mouseX * newVisibleDuration);
        const newOffset = Math.max(0, Math.min(newMaxOffset, newVisibleStart / duration));

        setZoomLevel(newZoom);
        setScrollOffset(newOffset);
      }
    };

    // Attach with passive: false to allow preventDefault
    timeline.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      timeline.removeEventListener('wheel', handleWheel);
    };
  }, []); // Empty deps - we use refs for current values

  // Current marking visualization (accounting for zoom)
  const getCurrentMarkStyle = () => {
    if (markStart === null) return null;

    const markEnd = currentTime;
    const actualStart = Math.min(markStart, markEnd);
    const actualEnd = Math.max(markStart, markEnd);

    // Convert to zoomed coordinates
    const left = ((actualStart - visibleStart) / visibleDuration) * 100;
    const right = ((actualEnd - visibleStart) / visibleDuration) * 100;

    // Clamp to visible range
    const clampedLeft = Math.max(0, left);
    const clampedRight = Math.min(100, right);
    const width = clampedRight - clampedLeft;

    if (width <= 0) return null;

    return {
      left: `${clampedLeft}%`,
      width: `${width}%`,
    };
  };

  // Get playhead position (accounting for zoom)
  const getPlayheadPosition = () => {
    const pos = ((currentTime - visibleStart) / visibleDuration) * 100;
    return Math.max(-1, Math.min(101, pos)); // Allow slight overflow for visibility
  };

  // Get mark start position (accounting for zoom)
  const getMarkStartPosition = () => {
    if (markStart === null) return null;
    const pos = ((markStart - visibleStart) / visibleDuration) * 100;
    if (pos < -1 || pos > 101) return null;
    return pos;
  };

  // Calculate time from mouse position on timeline
  const getTimeFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const timeline = timelineRef.current;
    if (!timeline) return null;
    const rect = timeline.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return visibleStart + (percent * visibleDuration);
  }, [visibleStart, visibleDuration]);

  // Start scrubbing on mousedown
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsScrubbing(true);
    wasPlayingBeforeScrub.current = isPlaying;

    // Pause during scrub for smoother experience
    if (videoRef.current && isPlaying) {
      videoRef.current.pause();
    }

    // Seek to clicked position
    const time = getTimeFromMouseEvent(e);
    if (time !== null) seekTo(time);
  }, [isPlaying, getTimeFromMouseEvent, seekTo]);

  // Update position during scrub
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseEvent(e);
      if (time !== null) seekTo(time);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      // Resume playback if was playing before scrub
      if (wasPlayingBeforeScrub.current && videoRef.current) {
        videoRef.current.play().catch(() => {
          // Silently ignore - play interrupted
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, getTimeFromMouseEvent, seekTo]);

  // Handle segment click
  const handleSegmentClick = (e: React.MouseEvent, segment: Segment) => {
    e.stopPropagation(); // Prevent timeline seek
    onSegmentClick?.(segment);
  };

  // Handle segment mousedown - allows scrubbing to start even when clicking on a segment
  const handleSegmentMouseDown = (e: React.MouseEvent) => {
    // Let the event bubble up to the timeline for scrubbing
    // Don't stop propagation - we want timeline to handle it
  };

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {/* Video */}
      <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full object-contain"
          onClick={togglePlay}
        />

        {/* Marking indicator */}
        {isMarking && (
          <div className="absolute top-4 left-4 z-10">
            <Badge variant="destructive" className="animate-pulse">
              <Scissors className="w-3 h-3 mr-1" />
              Marking... Press C to set end point
            </Badge>
          </div>
        )}

        {/* Current time overlay */}
        <div className="absolute bottom-4 left-4 z-10 bg-black/70 px-2 py-1 rounded text-white font-mono text-sm">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        {/* Playback speed indicator */}
        {playbackRate !== 1 && (
          <div className="absolute bottom-4 right-4 z-10 bg-black/70 px-2 py-1 rounded text-white font-mono text-sm">
            {playbackRate}x
          </div>
        )}
      </div>

      {/* Timeline with segments */}
      <div
        ref={timelineRef}
        className={`relative h-16 bg-muted rounded-md overflow-hidden select-none ${isScrubbing ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        onMouseDown={handleTimelineMouseDown}
      >
        {/* Time scale markers - pointer-events-none so clicks pass through to timeline */}
        <div className="absolute top-0 left-0 right-0 h-4 bg-background/50 flex items-center text-[10px] text-muted-foreground font-mono pointer-events-none">
          {Array.from({ length: Math.min(10, Math.ceil(visibleDuration / 5) + 1) }).map((_, i) => {
            const time = visibleStart + (i * visibleDuration / Math.min(10, Math.ceil(visibleDuration / 5)));
            const pos = (i / Math.min(10, Math.ceil(visibleDuration / 5))) * 100;
            return (
              <span
                key={i}
                className="absolute"
                style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
              >
                {formatTime(time)}
              </span>
            );
          })}
        </div>

        {/* Segment markers - clickable with higher z-index, transparent during scrubbing */}
        {segments.map((segment, idx) => {
          const style = getSegmentStyle(segment);
          if (style.display === 'none') return null;
          return (
            <div
              key={segment.id || idx}
              className={`absolute top-4 bottom-0 transition-all z-20 border-l-2 border-r-2 ${
                isScrubbing
                  ? "pointer-events-none"
                  : "cursor-pointer"
              } ${
                currentSegment?.id === segment.id
                  ? "bg-primary/60 border-primary"
                  : "bg-green-500/50 hover:bg-green-500/70 border-green-600"
              }`}
              style={style}
              onClick={(e) => handleSegmentClick(e, segment)}
              title={`${formatTime(segment.start_time)} - ${formatTime(segment.end_time)}\n${segment.keywords.join(", ")}`}
            >
              {/* Segment label */}
              {parseFloat(style.width || '0') > 5 && (
                <span className="absolute top-0.5 left-1 text-[9px] text-white font-medium truncate max-w-full">
                  {segment.keywords[0] || 'segment'}
                </span>
              )}
            </div>
          );
        })}

        {/* Current marking range */}
        {getCurrentMarkStyle() && (
          <div
            className="absolute top-4 bottom-0 bg-yellow-500/40 border-2 border-yellow-500 border-dashed z-10"
            style={getCurrentMarkStyle()!}
          />
        )}

        {/* Start mark point */}
        {getMarkStartPosition() !== null && (
          <div
            className="absolute top-4 bottom-0 w-1 bg-yellow-500 z-30"
            style={{ left: `${getMarkStartPosition()}%` }}
          />
        )}

        {/* Playhead with draggable handle */}
        {getPlayheadPosition() >= 0 && getPlayheadPosition() <= 100 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-40"
            style={{ left: `${getPlayheadPosition()}%`, pointerEvents: 'none' }}
          >
            {/* Top handle - draggable */}
            <div
              className="absolute -top-1 -left-2 w-4 h-4 bg-red-500 rounded-full shadow-md cursor-grab active:cursor-grabbing hover:scale-110 transition-transform"
              style={{ pointerEvents: 'auto' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleTimelineMouseDown(e);
              }}
            />
            {/* Line is not interactive */}
            <div className="absolute top-3 bottom-0 left-0 w-0.5 bg-red-500" />
            {/* Bottom arrow */}
            <div className="absolute -bottom-0.5 -left-1 w-2 h-2 bg-red-500 rotate-45" style={{ pointerEvents: 'none' }} />
          </div>
        )}

        {/* Zoom indicator */}
        {zoomLevel > 1 && (
          <div className="absolute bottom-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-white font-mono z-50">
            {zoomLevel.toFixed(1)}x zoom
          </div>
        )}
      </div>

      {/* Zoom controls */}
      {zoomLevel > 1 && (
        <div className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
          <span>Timeline:</span>
          <Slider
            value={[scrollOffset * 100]}
            min={0}
            max={maxOffset * 100}
            step={0.1}
            onValueChange={([val]) => setScrollOffset(val / 100)}
            className="flex-1 max-w-xs"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => { setZoomLevel(1); setScrollOffset(0); }}
          >
            Reset Zoom
          </Button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-2">
        {/* Play/Pause */}
        <Button variant="ghost" size="icon" onClick={togglePlay}>
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>

        {/* Skip buttons */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => seekTo(currentTime - 5)}
          title="5 seconds back (Shift+Left)"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => seekTo(currentTime + 5)}
          title="5 seconds forward (Shift+Right)"
        >
          <SkipForward className="h-4 w-4" />
        </Button>

        {/* Time display */}
        <div className="text-xs font-mono text-muted-foreground whitespace-nowrap">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Volume control with slider */}
        <div className="flex items-center gap-1 group">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMuted(!isMuted)}
            className="h-8 w-8"
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <div className="w-20 opacity-60 group-hover:opacity-100 transition-opacity">
            <Slider
              value={[isMuted ? 0 : volume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([val]) => {
                setVolume(val / 100);
                if (val > 0) setIsMuted(false);
              }}
              className="cursor-pointer [&_[role=slider]]:bg-blue-500 [&_[role=slider]]:border-blue-600 [&_.relative]:bg-blue-200 [&_[data-orientation=horizontal]>[data-orientation=horizontal]]:bg-blue-500"
            />
          </div>
        </div>

        {/* Speed */}
        <select
          value={playbackRate}
          onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
          className="bg-muted border border-border rounded px-2 py-1 text-sm"
        >
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1">1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
        </select>

        {/* Mark button */}
        <Button
          variant={isMarking ? "destructive" : "outline"}
          size="sm"
          onClick={toggleMark}
          className="gap-1"
        >
          <Scissors className="h-4 w-4" />
          {isMarking ? "Set End (C)" : "Mark (C)"}
        </Button>

        {/* Fullscreen button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          title="Fullscreen (F)"
          className="h-8 w-8"
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Keyboard shortcuts help */}
      <div className="text-xs text-muted-foreground px-2 flex flex-wrap gap-x-4 gap-y-1">
        <span><kbd className="px-1 bg-muted rounded">Space</kbd> Play/Pause</span>
        <span><kbd className="px-1 bg-muted rounded">C</kbd> Toggle Mark</span>
        <span><kbd className="px-1 bg-muted rounded">I</kbd>/<kbd className="px-1 bg-muted rounded">O</kbd> In/Out</span>
        <span><kbd className="px-1 bg-muted rounded">←</kbd>/<kbd className="px-1 bg-muted rounded">→</kbd> Frame</span>
        <span><kbd className="px-1 bg-muted rounded">Shift+←</kbd>/<kbd className="px-1 bg-muted rounded">→</kbd> 5s</span>
        <span><kbd className="px-1 bg-muted rounded">J</kbd>/<kbd className="px-1 bg-muted rounded">K</kbd>/<kbd className="px-1 bg-muted rounded">L</kbd> Speed</span>
        <span><kbd className="px-1 bg-muted rounded">F</kbd> Fullscreen</span>
        <span><kbd className="px-1 bg-muted rounded">Esc</kbd> Cancel/Exit</span>
        <span><kbd className="px-1 bg-muted rounded">Scroll</kbd> Zoom Timeline</span>
      </div>
    </div>
  );
}
