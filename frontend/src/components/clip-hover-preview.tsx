"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { API_URL } from "@/lib/api";

interface ClipHoverPreviewProps {
  thumbnailPath?: string;
  videoPath: string;
  clipId: string;
  alt: string;
  children?: React.ReactNode;
}

export function ClipHoverPreview({ thumbnailPath, videoPath, clipId, alt, children }: ClipHoverPreviewProps) {
  const [showVideo, setShowVideo] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = useCallback(() => {
    hoverTimerRef.current = setTimeout(() => {
      setShowVideo(true);
    }, 500);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setShowVideo(false);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  // Play/pause video based on showVideo state
  useEffect(() => {
    if (showVideo && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
    if (!showVideo && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [showVideo]);

  const videoUrl = `${API_URL}/library/files/${encodeURIComponent(videoPath)}?v=${clipId}`;
  const thumbUrl = thumbnailPath
    ? `${API_URL}/library/files/${encodeURIComponent(thumbnailPath)}?v=${clipId}`
    : undefined;

  return (
    <div
      className="aspect-[9/16] bg-muted relative group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Thumbnail image — always rendered, hidden when video playing */}
      {thumbUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbUrl}
          alt={alt}
          className={`w-full h-full object-cover ${showVideo ? "opacity-0" : "opacity-100"} transition-opacity`}
        />
      ) : (
        <div className={`w-full h-full flex items-center justify-center ${showVideo ? "opacity-0" : "opacity-100"}`}>
          {/* Film icon placeholder rendered by parent */}
        </div>
      )}

      {/* Video preview — rendered on hover after 500ms delay */}
      {showVideo && (
        <video
          ref={videoRef}
          src={videoUrl}
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          preload="none"
        />
      )}

      {/* Overlay children (badges, hover actions, etc.) */}
      {children}
    </div>
  );
}
