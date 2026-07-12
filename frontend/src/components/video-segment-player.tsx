"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { API_URL, apiGet } from "@/lib/api";
import { formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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
  AudioLines,
  Mic,
  Loader2,
  Layers,
  HelpCircle,
  ZoomIn,
  ZoomOut,
  Locate,
  ChevronsLeft,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Segment {
  id?: string;
  start_time: number;
  end_time: number;
  keywords: string[];
  thumbnail_path?: string;
  isTemp?: boolean; // For segment being created
}

interface VoiceRegion {
  start: number;
  end: number;
  duration: number;
  confidence: number;
}

interface SegmentTransformPreview {
  rotation: number;
  scale: number;
  pan_x: number;
  pan_y: number;
  flip_h: boolean;
  flip_v: boolean;
  opacity: number;
}

interface ProductGroup {
  id: string;
  source_video_id: string;
  label: string;
  start_time: number;
  end_time: number;
  color: string | null;
  segments_count: number;
  created_at: string;
}

interface VideoSegmentPlayerProps {
  videoUrl: string;
  duration: number;
  segments: Segment[];
  onSegmentCreate: (start: number, end: number) => void;
  onSegmentClick?: (segment: Segment) => void;
  onGroupCreate?: (start: number, end: number) => void;
  onSegmentResize?: (segmentId: string, newStart: number, newEnd: number) => void;
  currentSegment?: Segment;
  sourceVideoId?: string;
  activeTransforms?: SegmentTransformPreview;
  profileId?: string;
  productGroups?: ProductGroup[];
  showGroupBands?: boolean;
  fps?: number;
  videoWidth?: number;
  videoHeight?: number;
  timelineThumbnailUrl?: string;
}

export function VideoSegmentPlayer({
  videoUrl,
  duration,
  segments,
  onSegmentCreate,
  onSegmentClick,
  onGroupCreate,
  onSegmentResize,
  currentSegment,
  sourceVideoId,
  activeTransforms,
  profileId,
  productGroups = [],
  showGroupBands = true,
  fps = 30,
  videoWidth,
  videoHeight,
  timelineThumbnailUrl,
}: VideoSegmentPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Waveform state
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [voiceRegions, setVoiceRegions] = useState<VoiceRegion[]>([]);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [showWaveform, setShowWaveform] = useState(true);
  const [showVoiceOverlay, setShowVoiceOverlay] = useState(false);
  const [resizeCounter, setResizeCounter] = useState(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Marking state
  const [markStart, setMarkStart] = useState<number | null>(null);
  const [isMarking, setIsMarking] = useState(false);

  // Group marking state
  const [groupMarkStart, setGroupMarkStart] = useState<number | null>(null);
  const [isGroupMarking, setIsGroupMarking] = useState(false);

  // Scrubbing state (drag on timeline)
  const [isScrubbing, setIsScrubbing] = useState(false); // CSS cursor class + scrub useEffect gate
  const wasPlayingBeforeScrub = useRef(false);

  // Scrub optimization refs — bypass React re-renders during scrubbing
  const isScrubbingRef = useRef(false);
  const playheadRef = useRef<HTMLDivElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const seekRafRef = useRef<number | null>(null);
  const isSeekingRef = useRef(false);
  const queuedSeekRef = useRef<number | null>(null);

  // Segment resize state
  const [resizingInfo, setResizingInfo] = useState<{
    segmentId: string;
    edge: 'start' | 'end';
    originalStart: number;
    originalEnd: number;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ start: number; end: number } | null>(null);
  const resizePreviewRef = useRef<{ start: number; end: number } | null>(null);
  const wasPlayingBeforeResize = useRef(false);

  // Track which video IDs we've already fetched voice data for
  const voiceFetchedRef = useRef<Set<string>>(new Set());

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Timeline zoom state
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = fit all, higher = zoomed in
  const [scrollOffset, setScrollOffset] = useState(0); // 0-1 range for panning
  const timelineRef = useRef<HTMLDivElement>(null);

  // Video preview zoom state
  const [videoZoom, setVideoZoom] = useState(1);
  const [videoPanX, setVideoPanX] = useState(0);
  const [videoPanY, setVideoPanY] = useState(0);
  const [isDraggingVideo, setIsDraggingVideo] = useState(false);
  const videoDragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Calculate visible timeline range based on zoom (guard against duration = 0)
  const safeDuration = duration || 1; // Prevent division by zero
  const visibleDuration = safeDuration / zoomLevel;
  const maxOffset = Math.max(0, 1 - (1 / zoomLevel));
  const visibleStart = scrollOffset * safeDuration;
  const visibleEnd = visibleStart + visibleDuration;

  const sourceAspectRatio = videoWidth && videoHeight
    ? `${videoWidth} / ${videoHeight}`
    : "16 / 9";

  const timelineFrames = useMemo(() => {
    const frameCount = 12;
    const candidates = segments
      .filter((segment) => segment.thumbnail_path)
      .map((segment) => ({
        ...segment,
        thumbnailUrl: `${API_URL}/segments/files/${encodeURIComponent(
          segment.thumbnail_path!.split(/[\\/]/).pop() || segment.thumbnail_path!
        )}`,
      }));

    return Array.from({ length: frameCount }, (_, index) => {
      const time = visibleStart + ((index + 0.5) / frameCount) * visibleDuration;
      const exact = candidates.find(
        (segment) => time >= segment.start_time && time <= segment.end_time
      );
      if (exact) return exact.thumbnailUrl;

      const nearest = candidates.reduce<(typeof candidates)[number] | null>(
        (closest, segment) => {
          if (!closest) return segment;
          const midpoint = (segment.start_time + segment.end_time) / 2;
          const closestMidpoint = (closest.start_time + closest.end_time) / 2;
          return Math.abs(midpoint - time) < Math.abs(closestMidpoint - time)
            ? segment
            : closest;
        },
        null
      );
      return nearest?.thumbnailUrl || timelineThumbnailUrl || null;
    });
  }, [segments, timelineThumbnailUrl, visibleDuration, visibleStart]);

  // Stable refs for scrub callbacks (avoids re-registering window listeners on zoom)
  const visibleStartRef = useRef(visibleStart);
  const visibleDurationRef = useRef(visibleDuration);
  visibleStartRef.current = visibleStart;
  visibleDurationRef.current = visibleDuration;

  // Format time - imported from utils

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

  // Seek to time (used for non-scrub seeks: clicks, keyboard, segment select)
  const seekTo = useCallback((time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(time, duration));
  }, [duration]);

  // rAF-gated + seeked-gated seek for scrubbing (prevents decoder queue backlog)
  const throttledSeek = useCallback((time: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(time, duration));

    if (isSeekingRef.current) {
      queuedSeekRef.current = clamped;
      return;
    }

    pendingSeekRef.current = clamped;
    if (seekRafRef.current === null) {
      seekRafRef.current = requestAnimationFrame(() => {
        seekRafRef.current = null;
        if (pendingSeekRef.current !== null && videoRef.current) {
          isSeekingRef.current = true;
          videoRef.current.currentTime = pendingSeekRef.current;
          pendingSeekRef.current = null;
        }
      });
    }
  }, [duration]);

  // Direct DOM playhead update — zero React re-renders
  const updatePlayheadDOM = useCallback((time: number) => {
    currentTimeRef.current = time;
    if (playheadRef.current) {
      const pos = ((time - visibleStartRef.current) / visibleDurationRef.current) * 100;
      const clamped = Math.max(-1, Math.min(101, pos));
      playheadRef.current.style.left = `${clamped}%`;
      playheadRef.current.style.display = (clamped >= 0 && clamped <= 100) ? '' : 'none';
    }
  }, []);

  // Go to beginning — seek to 0 and reset zoom/scroll
  const goToBeginning = useCallback(() => {
    seekTo(0);
    setZoomLevel(1);
    setScrollOffset(0);
  }, [seekTo]);

  // Frame navigation (Bug #63: use videoRef.currentTime to avoid deps on state)
  const frameStep = useCallback((direction: number) => {
    if (!videoRef.current) return;
    const step = direction / fps;
    seekTo(videoRef.current.currentTime + step);
  }, [seekTo, fps]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error("Fullscreen error:", err); // Bug #168: not an API error
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  }, []);

  // Video zoom helpers
  const videoZoomIn = useCallback(() => {
    setVideoZoom((prev) => Math.min(5, prev * 1.2));
  }, []);
  const videoZoomOut = useCallback(() => {
    setVideoZoom((prev) => {
      const next = Math.max(1, prev / 1.2);
      if (next <= 1.05) { setVideoPanX(0); setVideoPanY(0); return 1; }
      return next;
    });
  }, []);
  const videoZoomFit = useCallback(() => {
    setVideoZoom(1); setVideoPanX(0); setVideoPanY(0);
  }, []);

  // Video preview wheel zoom
  useEffect(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY < 0) {
        setVideoZoom((prev) => Math.min(5, prev * 1.1));
      } else {
        setVideoZoom((prev) => {
          const next = Math.max(1, prev / 1.1);
          if (next <= 1.05) { setVideoPanX(0); setVideoPanY(0); return 1; }
          return next;
        });
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Video drag-to-pan
  useEffect(() => {
    if (!isDraggingVideo) return;
    const handleMouseMove = (e: MouseEvent) => {
      setVideoPanX(videoDragStart.current.panX + (e.clientX - videoDragStart.current.x));
      setVideoPanY(videoDragStart.current.panY + (e.clientY - videoDragStart.current.y));
    };
    const handleMouseUp = () => setIsDraggingVideo(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingVideo]);

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
    const exactTime = videoRef.current?.currentTime ?? currentTime;
    if (markStart === null) {
      // Set start point
      setMarkStart(exactTime);
      setIsMarking(true);
    } else {
      // Set end point and create segment
      const start = markStart;
      const end = exactTime;

      if (end > start) {
        onSegmentCreate(start, end);
      } else if (start > end) {
        // User went backwards, swap
        onSegmentCreate(end, start);
      }

      // Pause video at the end point
      if (videoRef.current && !videoRef.current.paused) {
        videoRef.current.pause();
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
    setGroupMarkStart(null);
    setIsGroupMarking(false);
  }, []);

  // Toggle group mark (G key)
  const toggleGroupMark = useCallback(() => {
    if (!onGroupCreate) return;
    const exactTime = videoRef.current?.currentTime ?? currentTime;
    if (groupMarkStart === null) {
      // Cancel any segment marking in progress
      setMarkStart(null);
      setIsMarking(false);
      // Set group start
      setGroupMarkStart(exactTime);
      setIsGroupMarking(true);
    } else {
      const start = groupMarkStart;
      const end = exactTime;
      if (end > start) {
        onGroupCreate(start, end);
      } else if (start > end) {
        onGroupCreate(end, start);
      }
      setGroupMarkStart(null);
      setIsGroupMarking(false);
    }
  }, [groupMarkStart, currentTime, onGroupCreate]);

  // Refs for values used in keyboard handler to avoid re-registering on every frame
  const currentTimeRef = useRef(currentTime);
  // Only sync from state when NOT scrubbing — during scrub, updatePlayheadDOM owns this ref
  if (!isScrubbingRef.current) {
    currentTimeRef.current = currentTime;
  }
  const markStartRef = useRef(markStart);
  markStartRef.current = markStart;

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
          setMarkStart(videoRef.current?.currentTime ?? currentTimeRef.current);
          setIsMarking(true);
          break;
        case "o": // O - Set Out point
          e.preventDefault();
          {
            const outTime = videoRef.current?.currentTime ?? currentTimeRef.current;
            if (markStartRef.current !== null && outTime > markStartRef.current) {
              onSegmentCreate(markStartRef.current, outTime);
              setMarkStart(null);
              setIsMarking(false);
            }
          }
          break;
        case "escape": // Escape - Cancel marking
          e.preventDefault();
          cancelMark();
          break;
        case "arrowleft":
          e.preventDefault();
          if (e.shiftKey) {
            seekTo(currentTimeRef.current - 5); // 5 seconds back
          } else {
            frameStep(-1); // Frame back
          }
          break;
        case "arrowright":
          e.preventDefault();
          if (e.shiftKey) {
            seekTo(currentTimeRef.current + 5); // 5 seconds forward
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
        case "g": // G - Toggle group mark start/end
          e.preventDefault();
          toggleGroupMark();
          break;
        case "f": // Fullscreen
          e.preventDefault();
          toggleFullscreen();
          break;
        case "+":
        case "=": // Video zoom in
          e.preventDefault();
          videoZoomIn();
          break;
        case "-": // Video zoom out
          e.preventDefault();
          videoZoomOut();
          break;
        case "0": // Video zoom fit
          e.preventDefault();
          videoZoomFit();
          break;
        case "home": // Go to beginning
          e.preventDefault();
          goToBeginning();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleMark, toggleGroupMark, cancelMark, seekTo, frameStep, onSegmentCreate, toggleFullscreen, videoZoomIn, videoZoomOut, videoZoomFit, goToBeginning]);

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

    // During scrubbing, suppress state updates — playhead is driven via DOM ref
    const handleSeeking = () => {
      if (isScrubbingRef.current) return;
      setCurrentTime(video.currentTime);
    };

    // Seeked: drain the seek queue during scrubbing, else sync state
    const handleSeeked = () => {
      isSeekingRef.current = false;
      if (isScrubbingRef.current) {
        if (queuedSeekRef.current !== null) {
          const next = queuedSeekRef.current;
          queuedSeekRef.current = null;
          throttledSeek(next);
        }
        return;
      }
      setCurrentTime(video.currentTime);
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("seeking", handleSeeking);
    video.addEventListener("seeked", handleSeeked);

    // Initial time sync
    setCurrentTime(video.currentTime);
    currentTimeRef.current = video.currentTime;

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("seeking", handleSeeking);
      video.removeEventListener("seeked", handleSeeked);
    };
  }, [throttledSeek]);

  // Auto-scroll timeline to follow the playhead when zoomed in during playback
  useEffect(() => {
    if (zoomLevel <= 1 || !isPlaying) return;
    // If playhead is outside visible range, scroll to keep it visible
    if (currentTime > visibleEnd || currentTime < visibleStart) {
      // Place playhead at ~10% from the left edge for look-ahead
      const targetStart = currentTime - (visibleDuration * 0.1);
      const newOffset = Math.max(0, Math.min(maxOffset, targetStart / safeDuration));
      setScrollOffset(newOffset);
    }
  }, [currentTime, zoomLevel, isPlaying, visibleStart, visibleEnd, visibleDuration, maxOffset, safeDuration]);

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

  // Calculate segment position on timeline (accounting for zoom + resize preview)
  const getSegmentStyle = (segment: Segment) => {
    // Use preview times if this segment is being resized
    let startTime = segment.start_time;
    let endTime = segment.end_time;
    if (resizingInfo && resizePreview && segment.id === resizingInfo.segmentId) {
      startTime = resizePreview.start;
      endTime = resizePreview.end;
    }

    // Convert to zoomed coordinates
    const segStart = ((startTime - visibleStart) / visibleDuration) * 100;
    const segEnd = ((endTime - visibleStart) / visibleDuration) * 100;
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

  // Get group marking range style (purple band)
  const getGroupMarkStyle = () => {
    if (groupMarkStart === null) return null;
    const markEnd = currentTime;
    const actualStart = Math.min(groupMarkStart, markEnd);
    const actualEnd = Math.max(groupMarkStart, markEnd);
    const left = ((actualStart - visibleStart) / visibleDuration) * 100;
    const right = ((actualEnd - visibleStart) / visibleDuration) * 100;
    const clampedLeft = Math.max(0, left);
    const clampedRight = Math.min(100, right);
    const width = clampedRight - clampedLeft;
    if (width <= 0) return null;
    return { left: `${clampedLeft}%`, width: `${width}%` };
  };

  // Get group mark start position
  const getGroupMarkStartPosition = () => {
    if (groupMarkStart === null) return null;
    const pos = ((groupMarkStart - visibleStart) / visibleDuration) * 100;
    if (pos < -1 || pos > 101) return null;
    return pos;
  };

  // Calculate time from mouse position on timeline (stable identity via refs)
  const getTimeFromMouseEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const timeline = timelineRef.current;
    if (!timeline) return null;
    const rect = timeline.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return visibleStartRef.current + (percent * visibleDurationRef.current);
  }, []);

  // Start scrubbing on mousedown
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isScrubbingRef.current = true;
    setIsScrubbing(true); // CSS cursor class only
    wasPlayingBeforeScrub.current = isPlaying;

    // Pause during scrub for smoother experience
    if (videoRef.current && isPlaying) {
      videoRef.current.pause();
    }

    // Instant visual feedback + throttled video seek
    const time = getTimeFromMouseEvent(e);
    if (time !== null) {
      updatePlayheadDOM(time);
      throttledSeek(time);
    }
  }, [isPlaying, getTimeFromMouseEvent, updatePlayheadDOM, throttledSeek]);

  // Update position during scrub
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseEvent(e);
      if (time !== null) {
        updatePlayheadDOM(time);
        throttledSeek(time);
      }
    };

    const handleMouseUp = () => {
      isScrubbingRef.current = false;

      // Cancel any pending rAF and clear seek queue
      if (seekRafRef.current) {
        cancelAnimationFrame(seekRafRef.current);
        seekRafRef.current = null;
      }
      pendingSeekRef.current = null;
      queuedSeekRef.current = null;
      isSeekingRef.current = false;

      // Final precise seek + sync React state
      seekTo(currentTimeRef.current);
      setCurrentTime(currentTimeRef.current);
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
  }, [isScrubbing, getTimeFromMouseEvent, throttledSeek, updatePlayheadDOM, seekTo]);

  // Segment resize drag logic
  const startResize = useCallback((e: React.MouseEvent, segment: Segment, edge: 'start' | 'end') => {
    if (!segment.id || !onSegmentResize) return;
    e.stopPropagation();
    e.preventDefault();
    wasPlayingBeforeResize.current = isPlaying;
    if (videoRef.current && isPlaying) {
      videoRef.current.pause();
    }
    setResizingInfo({
      segmentId: segment.id,
      edge,
      originalStart: segment.start_time,
      originalEnd: segment.end_time,
    });
    const initial = { start: segment.start_time, end: segment.end_time };
    setResizePreview(initial);
    resizePreviewRef.current = initial;
  }, [isPlaying, onSegmentResize]);

  useEffect(() => {
    if (!resizingInfo) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = getTimeFromMouseEvent(e);
      if (time === null) return;
      const clampedTime = Math.max(0, Math.min(safeDuration, time));

      setResizePreview(prev => {
        if (!prev) return prev;
        const MIN_GAP = 0.1;
        let updated: { start: number; end: number };
        if (resizingInfo.edge === 'start') {
          const newStart = Math.min(clampedTime, prev.end - MIN_GAP);
          updated = { start: newStart, end: prev.end };
        } else {
          const newEnd = Math.max(clampedTime, prev.start + MIN_GAP);
          updated = { start: prev.start, end: newEnd };
        }
        resizePreviewRef.current = updated;
        return updated;
      });

      seekTo(clampedTime);
    };

    const handleMouseUp = () => {
      const finalPreview = resizePreviewRef.current;
      if (finalPreview && onSegmentResize) {
        onSegmentResize(resizingInfo.segmentId, finalPreview.start, finalPreview.end);
      }
      setResizingInfo(null);
      setResizePreview(null);
      resizePreviewRef.current = null;
      if (wasPlayingBeforeResize.current && videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizingInfo, getTimeFromMouseEvent, seekTo, safeDuration, onSegmentResize]);

  // Fetch waveform data when sourceVideoId changes + reset voice data
  useEffect(() => {
    if (!sourceVideoId) return;
    let cancelled = false;
    setWaveformLoading(true);
    apiGet(`/segments/source-videos/${sourceVideoId}/waveform?samples=1200${profileId ? `&profile_id=${profileId}` : ''}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data?.waveform) setWaveformData(data.waveform); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWaveformLoading(false); });
    return () => {
      cancelled = true;
      setVoiceRegions([]);
      setShowVoiceOverlay(false);
      voiceFetchedRef.current.delete(sourceVideoId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceVideoId, profileId]);

  // Fetch voice detection data when enabled
  useEffect(() => {
    if (!sourceVideoId || !showVoiceOverlay) {
      return;
    }

    // Don't refetch if we already fetched for this video
    if (voiceFetchedRef.current.has(sourceVideoId)) return;

    let cancelled = false;
    setVoiceLoading(true);
    voiceFetchedRef.current.add(sourceVideoId);

    apiGet(`/segments/source-videos/${sourceVideoId}/voice-detection`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.voice_segments) {
          setVoiceRegions(data.voice_segments);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setVoiceLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceVideoId, showVoiceOverlay]);

  // ResizeObserver for timeline redraws
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const observer = new ResizeObserver(() => {
      setResizeCounter((c) => c + 1);
    });
    observer.observe(timeline);

    return () => observer.disconnect();
  }, []);

  // Canvas waveform rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const timeline = timelineRef.current;
    if (!canvas || !timeline || waveformData.length === 0 || !showWaveform) return;

    const rect = timeline.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, rect.width - 16);
    const height = 40;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const totalSamples = waveformData.length;
    const sampleDuration = safeDuration / totalSamples;

    // Build a set of voice time ranges for quick lookup
    const voiceActive = showVoiceOverlay && voiceRegions.length > 0;

    // Determine which samples are visible
    const startSample = Math.floor((visibleStart / safeDuration) * totalSamples);
    const endSample = Math.ceil((visibleEnd / safeDuration) * totalSamples);
    const visibleSampleCount = endSample - startSample;

    if (visibleSampleCount <= 0) return;

    // Normalize: find the peak amplitude in visible range so waveform uses full height
    let peakAmplitude = 0;
    for (let i = 0; i < visibleSampleCount; i++) {
      const sampleIdx = startSample + i;
      if (sampleIdx >= 0 && sampleIdx < totalSamples) {
        peakAmplitude = Math.max(peakAmplitude, waveformData[sampleIdx]);
      }
    }
    const normFactor = peakAmplitude > 0 ? 1 / peakAmplitude : 1;

    const barWidth = Math.max(1, width / visibleSampleCount);

    for (let i = 0; i < visibleSampleCount; i++) {
      const sampleIdx = startSample + i;
      if (sampleIdx < 0 || sampleIdx >= totalSamples) continue;

      const amplitude = waveformData[sampleIdx] * normFactor;
      const barHeight = Math.max(1, amplitude * height * 0.86);
      const x = i * barWidth;
      const y = (height - barHeight) / 2;
      const sampleTime = sampleIdx * sampleDuration;
      const isSavedSegment = segments.some(
        (segment) => sampleTime >= segment.start_time && sampleTime <= segment.end_time
      );

      // Check if this sample falls within a voice region
      let isVoice = false;
      if (voiceActive) {
        for (const region of voiceRegions) {
          if (sampleTime >= region.start && sampleTime <= region.end) {
            isVoice = true;
            break;
          }
        }
      }

      ctx.fillStyle = isVoice
        ? "rgba(245, 158, 11, 0.7)"  // amber for voice
        : isSavedSegment
          ? "rgba(231, 255, 75, 0.78)" // lime only inside saved ranges
          : "rgba(161, 161, 170, 0.62)"; // neutral waveform elsewhere

      ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
    }
  }, [waveformData, visibleStart, visibleEnd, voiceRegions, showWaveform, showVoiceOverlay, resizeCounter, safeDuration, segments]);

  // Handle segment click
  const handleSegmentClick = (e: React.MouseEvent, segment: Segment) => {
    e.stopPropagation(); // Prevent timeline seek
    seekTo(segment.start_time);
    onSegmentClick?.(segment);
  };

  // Build video transform style combining active transforms + preview zoom/pan
  // All transforms (scale, rotation, pan, flip) use CSS transform inside a clipping resolution frame
  const videoStyle = useMemo<React.CSSProperties>(() => {
    const transforms: string[] = [];
    if (activeTransforms) {
      // Order: translate → rotate → scale → flip (pan operates in original coordinate space)
      if (activeTransforms.pan_x || activeTransforms.pan_y)
        transforms.push(`translate(${activeTransforms.pan_x}px, ${activeTransforms.pan_y}px)`);
      if (activeTransforms.rotation) transforms.push(`rotate(${activeTransforms.rotation}deg)`);
      if (activeTransforms.scale !== 1.0) transforms.push(`scale(${activeTransforms.scale})`);
      if (activeTransforms.flip_h) transforms.push("scaleX(-1)");
      if (activeTransforms.flip_v) transforms.push("scaleY(-1)");
    }
    // Video zoom (preview zoom, separate from segment transforms)
    if (videoZoom !== 1) transforms.push(`scale(${videoZoom})`);
    if (videoPanX || videoPanY) transforms.push(`translate(${videoPanX}px, ${videoPanY}px)`);

    return {
      transform: transforms.length > 0 ? transforms.join(" ") : undefined,
      transformOrigin: 'center center',
      opacity: activeTransforms?.opacity,
      transition: (isDraggingVideo || activeTransforms) ? undefined : "transform 0.15s ease, opacity 0.15s ease",
    };
  }, [activeTransforms, videoZoom, videoPanX, videoPanY, isDraggingVideo]);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-border/80 bg-card/60 p-2 shadow-sm">
      <ResizablePanelGroup id="source-video-timeline-layout" orientation="vertical" className="min-h-0">
      <ResizablePanel id="source-video-preview" defaultSize="68%" minSize={160} className="min-h-0">
      {/* Source video with playback controls integrated into the picture. */}
      <div
        ref={videoContainerRef}
        className={`group relative flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black shadow-inner ${videoZoom > 1 ? (isDraggingVideo ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
      >
        <div
          className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
        onMouseDown={(e) => {
          if (videoZoom > 1) {
            e.preventDefault();
            setIsDraggingVideo(true);
            videoDragStart.current = { x: e.clientX, y: e.clientY, panX: videoPanX, panY: videoPanY };
          }
        }}
      >
          {/*
            Keep a fixed source-resolution frame inside the available preview area.
            Transforming a video that is `w-full h-full` also transforms its
            letterbox area, which makes a portrait source appear to fill the
            entire editor at higher scales. The inner frame remains unscaled,
            so its edges always show the actual output bounds.
          */}
          <div
            className="relative h-full max-w-full overflow-hidden bg-black ring-1 ring-white/15"
            style={{ aspectRatio: sourceAspectRatio }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="h-full w-full object-contain"
              onClick={() => {
                if (!isDraggingVideo) togglePlay();
              }}
              style={videoStyle}
            />
          </div>
        </div>

        {isMarking && (
          <div className="absolute left-3 top-3 z-20">
            <Badge variant="destructive" className="animate-pulse gap-1 text-xs shadow-lg">
              <Scissors className="h-3 w-3" />
              Marking segment · C to finish
            </Badge>
          </div>
        )}

        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          {videoZoom > 1 && (
            <span className="rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {Math.round(videoZoom * 100)}%
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); videoZoomFit(); }}
            title="Fit video (0)"
          >
            <Locate className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); videoZoomIn(); }}
            title="Zoom video in (+)"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 bg-black/55 text-white hover:bg-black/80 hover:text-white"
            onClick={(e) => { e.stopPropagation(); videoZoomOut(); }}
            title="Zoom video out (-)"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div data-player-controls className="z-20 flex h-10 w-full flex-shrink-0 items-center gap-2 border-t border-white/10 bg-black px-3 text-white">
          <button type="button" onClick={togglePlay} className="grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-white/15" aria-label={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
          </button>
          <span className="min-w-[92px] whitespace-nowrap font-mono text-[11px] text-white/80">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="flex-1" />
          <button type="button" onClick={() => setIsMuted(!isMuted)} className="grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-white/15" aria-label={isMuted ? "Unmute" : "Mute"}>
            {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            min={0}
            max={100}
            step={1}
            onValueChange={([value]) => { setVolume(value / 100); if (value > 0) setIsMuted(false); }}
            className="w-16"
            aria-label="Volume"
          />
          <select value={playbackRate} onChange={(e) => setPlaybackRate(parseFloat(e.target.value))} className="h-7 rounded border border-white/15 bg-black/50 px-1 text-[11px] text-white outline-none hover:bg-black/75" aria-label="Playback speed">
            <option value="0.5">0.5x</option>
            <option value="0.75">0.75x</option>
            <option value="1">1x</option>
            <option value="1.25">1.25x</option>
            <option value="1.5">1.5x</option>
            <option value="2">2x</option>
          </select>
          <button type="button" onClick={toggleFullscreen} className="grid h-7 w-7 place-items-center rounded-sm transition-colors hover:bg-white/15" aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
      </ResizablePanel>

      <ResizableHandle orientation="vertical" withHandle />

      <ResizablePanel id="source-video-timeline" defaultSize={190} minSize={150} maxSize="55%" className="min-h-0">
      <div className="flex h-full min-h-0 flex-col gap-1 pt-1">
      {/* Filmstrip timeline: time ruler, source frames, waveform and numbered ranges. */}
      <div
        ref={timelineRef}
        className={`relative min-h-[108px] flex-1 overflow-hidden rounded-xl border border-border/80 bg-background/80 px-2 shadow-inner select-none ${isScrubbing ? 'cursor-grabbing' : 'cursor-crosshair'}`}
        onMouseDown={handleTimelineMouseDown}
        aria-label="Source video timeline"
      >
        {/* Time scale markers */}
        <div className="absolute left-2 right-2 top-1 h-6 font-mono text-[9px] text-muted-foreground pointer-events-none">
          {Array.from({ length: 7 }, (_, index) => {
            const time = visibleStart + (index / 6) * visibleDuration;
            const position = (index / 6) * 100;
            return (
              <span
                key={`${time.toFixed(3)}-${index}`}
                className="absolute top-0"
                style={{
                  left: `${position}%`,
                  transform: index === 0 ? undefined : index === 6 ? "translateX(-100%)" : "translateX(-50%)",
                }}
              >
                {formatTime(time)}
              </span>
            );
          })}
        </div>

        {/* Source frames */}
        <div className="absolute left-2 right-2 top-7 flex h-11 overflow-hidden rounded-t-md border border-white/10 bg-black/80 pointer-events-none">
          {timelineFrames.map((frameUrl, index) => (
            <div
              key={`${frameUrl || "empty"}-${index}`}
              className="h-full flex-1 border-r border-black/35 bg-gradient-to-br from-zinc-800 to-zinc-950 bg-cover bg-center last:border-r-0"
              style={frameUrl ? {
                backgroundImage: `linear-gradient(rgba(0,0,0,.1), rgba(0,0,0,.24)), url("${frameUrl}")`,
              } : undefined}
            />
          ))}
        </div>

        {/* Waveform lane */}
        <div className="absolute left-2 right-2 top-[72px] h-10 overflow-hidden rounded-b-md border-x border-b border-white/10 bg-zinc-950/95 pointer-events-none">
          {showWaveform && waveformData.length === 0 && !waveformLoading && (
            <div className="absolute inset-0 opacity-25" style={{
              backgroundImage: "repeating-linear-gradient(90deg, transparent 0 5px, rgba(255,255,255,.22) 5px 6px)",
            }} />
          )}
        </div>

        {/* Waveform canvas */}
        {showWaveform && waveformData.length > 0 && (
          <canvas
            ref={canvasRef}
            className="absolute left-2 right-2 top-[72px] z-[5] h-10 pointer-events-none"
          />
        )}

        {/* Product group bands */}
        {showGroupBands && productGroups.map((group) => {
          const bandStart = ((group.start_time - visibleStart) / visibleDuration) * 100;
          const bandEnd = ((group.end_time - visibleStart) / visibleDuration) * 100;
          const left = Math.max(0, bandStart);
          const right = Math.min(100, bandEnd);
          const width = right - left;
          if (width <= 0 || bandEnd < 0 || bandStart > 100) return null;
          const color = group.color || "var(--chart-2)";
          return (
            <div
              key={group.id}
              className="absolute bottom-[21px] z-[8] h-1 pointer-events-none"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: color,
              }}
              title={`${group.label} (${group.segments_count} segments)`}
            >
              {width > 4 && (
                <span
                  className="absolute -top-3.5 left-0.5 text-[8px] font-bold truncate drop-shadow"
                  style={{ color, maxWidth: `${width}%` }}
                >
                  {group.label}
                </span>
              )}
            </div>
          );
        })}

        {/* Segment markers */}
        {segments.map((segment, segmentIndex) => {
          const style = getSegmentStyle(segment);
          if (style.display === 'none') return null;
          const isBeingResized = resizingInfo?.segmentId === segment.id;
          const displayStart = isBeingResized && resizePreview ? resizePreview.start : segment.start_time;
          const displayEnd = isBeingResized && resizePreview ? resizePreview.end : segment.end_time;
          return (
            <div
              key={segment.id || `seg-${segment.start_time}-${segment.end_time}`}
              className={`absolute top-7 z-20 h-[84px] cursor-pointer rounded-[5px] border-2 ${
                isBeingResized ? '' : 'transition-[background-color,box-shadow]'
              } ${
                currentSegment?.id === segment.id
                  ? "border-primary bg-primary/20 shadow-[0_0_14px_rgba(210,255,46,0.3)]"
                  : "border-primary/90 bg-primary/10 hover:bg-primary/20"
              }`}
              style={style}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => handleSegmentClick(e, segment)}
              title={`${formatTime(displayStart)} - ${formatTime(displayEnd)}\n${segment.keywords.join(", ")}`}
            >
              <span className="absolute -top-[19px] left-1/2 grid h-[19px] min-w-[19px] -translate-x-1/2 place-items-center rounded-[5px] bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground shadow-sm">
                {segmentIndex + 1}
              </span>
              {parseFloat(style.width || '0') > 4 && (
                <span className="absolute -bottom-[20px] left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] font-medium text-primary">
                  {formatTime(displayStart)} – {formatTime(displayEnd)}
                </span>
              )}
              {/* Resize drag handles */}
              {onSegmentResize && segment.id && (
                <>
                  <div
                    className="absolute inset-y-0 left-0 z-30 w-2 cursor-col-resize hover:bg-white/20"
                    onMouseDown={(e) => startResize(e, segment, 'start')}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div
                    className="absolute inset-y-0 right-0 z-30 w-2 cursor-col-resize hover:bg-white/20"
                    onMouseDown={(e) => startResize(e, segment, 'end')}
                    onClick={(e) => e.stopPropagation()}
                  />
                </>
              )}
              {/* Time tooltip during resize */}
              {isBeingResized && resizePreview && (
                <div className="absolute -top-7 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] text-white shadow-lg">
                  {formatTime(resizePreview.start)} – {formatTime(resizePreview.end)}
                </div>
              )}
            </div>
          );
        })}

        {/* Current marking range */}
        {getCurrentMarkStyle() && (
          <div
            className="absolute top-7 z-10 h-[84px] rounded border-2 border-dashed border-amber-400 bg-amber-400/20"
            style={getCurrentMarkStyle()!}
          />
        )}

        {/* Start mark point */}
        {getMarkStartPosition() !== null && (
          <div
            className="absolute top-6 z-30 h-[88px] w-0.5 bg-amber-400"
            style={{ left: `${getMarkStartPosition()}%` }}
          />
        )}

        {/* Group marking range (purple) */}
        {getGroupMarkStyle() && (
          <div
            className="absolute top-7 z-10 h-[84px] rounded border-2 border-dashed border-chart-2 bg-chart-2/20"
            style={getGroupMarkStyle()!}
          >
            <span className="absolute left-1 top-0.5 text-[9px] font-medium text-foreground">Group</span>
          </div>
        )}

        {/* Group mark start point */}
        {getGroupMarkStartPosition() !== null && (
          <div
            className="absolute top-6 z-30 h-[88px] w-0.5 bg-chart-2"
            style={{ left: `${getGroupMarkStartPosition()}%` }}
          />
        )}

        {/* Playhead — always rendered so playheadRef is available during scrubbing.
            Visibility controlled via style to allow updatePlayheadDOM to work even when
            the playhead starts off-screen and scrubs into view. */}
        <div
          ref={playheadRef}
          className="absolute top-5 bottom-4 z-40 w-px bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]"
          style={{
            left: `${getPlayheadPosition()}%`,
            pointerEvents: 'none',
            display: (getPlayheadPosition() >= 0 && getPlayheadPosition() <= 100) ? '' : 'none',
          }}
        >
          <div
            className="absolute -left-1.5 -top-0.5 h-3 w-3 cursor-grab rounded-full border-2 border-zinc-900 bg-white shadow active:cursor-grabbing"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={(e) => { e.stopPropagation(); handleTimelineMouseDown(e); }}
          />
        </div>

        {/* Zoom indicator + inline zoom controls */}
        {zoomLevel > 1 && (
          <div className="absolute bottom-0 right-1 z-50 flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5">
            <Slider
              value={[scrollOffset * 100]}
              min={0}
              max={maxOffset * 100}
              step={0.1}
              onValueChange={([val]) => setScrollOffset(val / 100)}
              className="w-20"
              onMouseDown={(e) => e.stopPropagation()}
            />
            <button
              className="font-mono text-[9px] text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); setZoomLevel(1); setScrollOffset(0); }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {zoomLevel.toFixed(1)}x
            </button>
          </div>
        )}
      </div>

      {/* Secondary editing controls stay quiet under the visual timeline. */}
      <div className="flex min-h-8 flex-shrink-0 flex-wrap items-center gap-1 border-t border-border/60 px-1 pt-1">
        <div className="mr-2 flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted-foreground">
          <span className="h-2.5 w-2.5 rounded-[3px] bg-primary" />
          Saved segment
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goToBeginning} title="Go to beginning (Home)">
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => seekTo((videoRef.current?.currentTime ?? 0) - 5)} title="5 seconds back">
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => seekTo((videoRef.current?.currentTime ?? 0) + 5)} title="5 seconds forward">
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant={showWaveform ? "default" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowWaveform(!showWaveform)}
          disabled={waveformData.length === 0 && !waveformLoading}
          title="Waveform"
        >
          {waveformLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant={showVoiceOverlay ? "default" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowVoiceOverlay(!showVoiceOverlay)}
          disabled={!sourceVideoId}
          title="Voice detection"
        >
          {voiceLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            const nextZoom = Math.max(1, zoomLevel / 1.25);
            setZoomLevel(nextZoom);
            setScrollOffset((offset) => Math.min(offset, Math.max(0, 1 - 1 / nextZoom)));
          }}
          disabled={zoomLevel <= 1}
          title="Zoom timeline out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setZoomLevel((level) => Math.min(20, level * 1.25))}
          disabled={zoomLevel >= 20}
          title="Zoom timeline in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div className="flex-1" />
        <Button
          variant={isMarking ? "destructive" : "outline"}
          size="sm"
          onClick={toggleMark}
          className="h-7 gap-1 px-2 text-xs"
        >
          <Scissors className="h-3 w-3" />
          {isMarking ? "End (C)" : "Mark (C)"}
        </Button>
        {onGroupCreate && (
          <Button
            variant={isGroupMarking ? "destructive" : "outline"}
            size="sm"
            onClick={toggleGroupMark}
            className="h-7 gap-1 px-2 text-xs"
          >
            <Layers className="h-3 w-3" />
            {isGroupMarking ? "End (G)" : "Group (G)"}
          </Button>
        )}

        {/* Keyboard shortcuts - popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Keyboard shortcuts (?)">
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-xs" side="top" align="end">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span><kbd className="px-1 bg-muted rounded text-[10px]">Space</kbd> Play/Pause</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">C</kbd> Mark Segment</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">G</kbd> Mark Group</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">I</kbd>/<kbd className="px-1 bg-muted rounded text-[10px]">O</kbd> In/Out</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">←</kbd>/<kbd className="px-1 bg-muted rounded text-[10px]">→</kbd> Frame step</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">Shift+←/→</kbd> 5s jump</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">J/K/L</kbd> Speed</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">F</kbd> Fullscreen</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">+/-</kbd> Video zoom</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">0</kbd> Fit video</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">Del</kbd> Delete</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">Esc</kbd> Cancel</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">Scroll</kbd> Timeline zoom</span>
              <span><kbd className="px-1 bg-muted rounded text-[10px]">[/]</kbd> Panels</span>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      </div>
      </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
