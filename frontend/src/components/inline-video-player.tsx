"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useEffect, useRef, RefObject } from "react";

interface InlineVideoPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  title?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
}

export function InlineVideoPlayer({ open, onOpenChange, videoUrl, title, videoRef: externalRef }: InlineVideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || internalRef;

  useEffect(() => {
    if (open && videoRef.current) {
      videoRef.current.play().catch(() => {}); // Autoplay may be blocked
    }
    if (!open && videoRef.current) {
      videoRef.current.pause();
    }
  // Bug #170: videoRef is intentionally omitted — it's a stable ref that doesn't change
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] p-0 overflow-hidden bg-black border-none [&>button]:hidden">
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10 text-white hover:bg-white/20 h-8 w-8"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
          {title && (
            <div className="absolute top-2 left-3 z-10 text-white text-sm font-medium truncate max-w-[300px] bg-black/50 px-2 py-1 rounded">
              {title}
            </div>
          )}
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            className="w-full max-h-[80vh] object-contain"
            playsInline
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
