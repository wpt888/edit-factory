"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiPost, apiGet, API_URL } from "@/lib/api";
import type { MatchPreview } from "@/components/timeline-editor";
import type { SubtitleSettings } from "@/types/video-processing";

interface VariantPreviewPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchPreview[];
  pipelineId: string;
  variantIndex: number;
  profileId: string;
  subtitleSettings?: SubtitleSettings;
  sourceVideoIds?: string[];
  minSegmentDuration?: number;
  wordsPerSubtitle?: number;
}

export function VariantPreviewPlayer({
  open,
  onOpenChange,
  matches,
  pipelineId,
  variantIndex,
  profileId,
  subtitleSettings,
  sourceVideoIds,
  minSegmentDuration = 3.0,
  wordsPerSubtitle = 2,
}: VariantPreviewPlayerProps) {
  const [status, setStatus] = useState<string>("idle");
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [matchesFingerprint, setMatchesFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Stop polling on unmount or close
  const stopPolling = useCallback(() => {
    cancelledRef.current = true;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Start preview render when dialog opens
  useEffect(() => {
    if (!open || matches.length === 0) return;

    const startRender = async () => {
      setStatus("processing");
      setProgress(0);
      setCurrentStep("Starting preview render...");
      setError(null);

      try {
        const resp = await apiPost(
          `/pipeline/render-preview/${pipelineId}/${variantIndex}`,
          {
            match_overrides: matches.map((m) => ({
              srt_index: m.srt_index,
              srt_text: m.srt_text,
              srt_start: m.srt_start,
              srt_end: m.srt_end,
              segment_id: m.segment_id,
              segment_keywords: m.segment_keywords,
              matched_keyword: m.matched_keyword,
              confidence: m.confidence,
              source_video_id: m.source_video_id,
              segment_start_time: m.segment_start_time,
              segment_end_time: m.segment_end_time,
              merge_group: m.merge_group,
              merge_group_duration: m.merge_group_duration,
            })),
            source_video_ids: sourceVideoIds,
            min_segment_duration: minSegmentDuration,
            subtitle_settings: subtitleSettings
              ? {
                  fontSize: subtitleSettings.fontSize,
                  fontFamily: subtitleSettings.fontFamily,
                  textColor: subtitleSettings.textColor,
                  outlineColor: subtitleSettings.outlineColor,
                  outlineWidth: subtitleSettings.outlineWidth,
                  positionY: subtitleSettings.positionY,
                  shadowDepth: subtitleSettings.shadowDepth,
                  enableGlow: subtitleSettings.enableGlow,
                  glowBlur: subtitleSettings.glowBlur,
                  adaptiveSizing: subtitleSettings.adaptiveSizing,
                }
              : undefined,
            words_per_subtitle: wordsPerSubtitle,
          }
        );

        // apiPost already throws on non-OK responses (FE-02: removed dead !resp.ok check)
        const result = await resp.json();
        const fp = result.matches_fingerprint;
        setMatchesFingerprint(fp);

        if (result.status === "completed") {
          // Cache hit — video already ready
          setStatus("completed");
          setProgress(100);
          setCurrentStep("Preview ready");
          return;
        }

        // Start polling for status using setTimeout chain to prevent overlapping polls (FE-02)
        if (cancelledRef.current) return; // Bug #133: check before starting poll
        cancelledRef.current = false;
        const pollStatus = async () => {
          if (cancelledRef.current) return;
          try {
            const statusResp = await apiGet(
              `/pipeline/preview-status/${pipelineId}/${variantIndex}`
            );
            const statusData = await statusResp.json();
            setProgress(statusData.progress ?? 0);
            setCurrentStep(statusData.current_step ?? "");

            if (statusData.status === "completed") {
              setStatus("completed");
              stopPolling();
              return;
            } else if (statusData.status === "failed") {
              setStatus("failed");
              setError(statusData.error ?? "Preview render failed");
              stopPolling();
              return;
            }
          } catch {
            // Polling error — keep trying
          }
          // Re-schedule only if not cancelled
          if (!cancelledRef.current) {
            pollRef.current = setTimeout(pollStatus, 2000);
          }
        };
        pollRef.current = setTimeout(pollStatus, 2000);
      } catch (err: unknown) {
        setStatus("failed");
        setError(err instanceof Error ? err.message : "Failed to start preview render");
      }
    };

    startRender();

    return () => {
      stopPolling();
    };
    // Bug #62: pipelineId and variantIndex are stable for the lifetime of the dialog;
    // other props (matches, sourceVideoIds, subtitleSettings) are captured at fire-time
    // and don't need to trigger re-renders. open is the only meaningful trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        stopPolling();
        setStatus("idle");
        setProgress(0);
        setCurrentStep("");
        setError(null);
        setMatchesFingerprint(null);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, stopPolling]
  );

  const previewVideoUrl =
    status === "completed"
      ? `${API_URL}/pipeline/preview-video/${pipelineId}/${variantIndex}`
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Variant {variantIndex + 1} Preview</DialogTitle>
        </DialogHeader>

        <div
          className="relative mx-auto bg-black rounded-lg overflow-hidden flex items-center justify-center"
          style={{ aspectRatio: "9/16", maxHeight: "450px" }}
        >
          {/* Loading state */}
          {status === "processing" && (
            <div className="flex flex-col items-center gap-3 px-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm text-white font-medium">
                  Rendering preview...
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {currentStep}
                </p>
              </div>
              {/* Progress bar */}
              <div className="w-full max-w-[200px]">
                <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.max(progress, 5)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-1">
                  {progress}%
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === "failed" && (
            <div className="flex flex-col items-center gap-2 px-4 text-center">
              <p className="text-sm text-red-400 font-medium">
                Preview failed
              </p>
              <p className="text-xs text-muted-foreground">
                {error}
              </p>
            </div>
          )}

          {/* Video player */}
          {status === "completed" && previewVideoUrl && (
            <video
              ref={videoRef}
              key={matchesFingerprint}
              src={previewVideoUrl}
              controls
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />
          )}

          {/* Idle state */}
          {status === "idle" && (
            <div className="flex items-center justify-center text-muted-foreground text-sm">
              Preparing preview...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
