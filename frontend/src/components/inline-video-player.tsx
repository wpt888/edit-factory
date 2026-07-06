"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { X, ShieldCheck, RefreshCw, Loader2 } from "lucide-react";
import { useEffect, useRef, RefObject } from "react";

interface InlineVideoPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string;
  title?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  scriptText?: string | null;
  // QC verification
  qcVerified?: boolean;
  onToggleQc?: () => void;
  // Regenerate voice-over
  hasVoiceover?: boolean;
  onRegenerateVoiceover?: () => void;
  regeneratingVoiceover?: boolean;
}

export function InlineVideoPlayer({
  open, onOpenChange, videoUrl, title, videoRef: externalRef, scriptText,
  qcVerified, onToggleQc, hasVoiceover, onRegenerateVoiceover, regeneratingVoiceover,
}: InlineVideoPlayerProps) {
  const internalRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalRef || internalRef;

  useEffect(() => {
    // Pause when dialog closes (autoPlay attribute handles play on open)
    if (!open && videoRef.current) {
      videoRef.current.pause();
    }
  // Bug #170: videoRef is intentionally omitted — it's a stable ref that doesn't change
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !open) return;

    // Force a fresh media load when the regenerated file URL changes while the dialog stays open.
    el.pause();
    el.load();
    void el.play().catch(() => {
      // Ignore autoplay rejections; user can press play manually.
    });
  // videoRef is a stable ref object; reloading depends on the URL and dialog state only.
  }, [videoUrl, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px] max-h-[85vh] p-0 overflow-hidden bg-black border-none [&>button]:hidden">
        <VisuallyHidden><DialogTitle>{title || "Video player"}</DialogTitle></VisuallyHidden>
        <div className="relative flex flex-col max-h-[85vh]">
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
            key={videoUrl}
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            className="w-full max-h-[60vh] object-contain flex-shrink"
            playsInline
          />
          {/* Action bar: QC checkbox + Regenerate voice-over */}
          {(onToggleQc || (hasVoiceover && onRegenerateVoiceover)) && (
            <div className="bg-card border-t border-border px-4 py-2.5 flex items-center justify-between gap-3">
              {onToggleQc && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={qcVerified || false}
                    onCheckedChange={() => onToggleQc()}
                    className="h-5 w-5 border-2 border-primary data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                  />
                  <label
                    className={`text-sm cursor-pointer select-none flex items-center gap-1.5 ${
                      qcVerified ? "text-primary font-medium" : "text-muted-foreground"
                    }`}
                    onClick={() => onToggleQc()}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {qcVerified ? "Verificat QC ✓" : "Verificare QC"}
                  </label>
                </div>
              )}
              {hasVoiceover && onRegenerateVoiceover && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  onClick={() => onRegenerateVoiceover()}
                  disabled={regeneratingVoiceover}
                >
                  {regeneratingVoiceover ? (
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                  )}
                  {regeneratingVoiceover ? "Regenerating..." : "Regenerate voice-over"}
                </Button>
              )}
            </div>
          )}
          {scriptText && (
            <div className="bg-card border-t border-border px-4 py-3 max-h-[30vh] overflow-y-auto">
              <p className="text-[11px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">Script</p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{scriptText}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
