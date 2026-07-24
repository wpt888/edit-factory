"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiPost, apiGet } from "@/lib/api";
import { useApiUrl } from "@/hooks/use-api-url";
import type { MatchPreview, InterstitialSlide } from "@/components/timeline-editor";
import type { SubtitleSettings } from "@/types/video-processing";
import type { AttentionTimeline } from "@/types/attention-timeline";
import type { CompositionClip, MusicSettings, TransitionSpec } from "@/types/composition-timeline";
import { resolveCompositionTransitions } from "@/types/composition-timeline";
import { SafeZoneOverlay, type SafeZoneType } from "@/components/safe-zone-overlay";

type PreviewPipOverlayConfig = {
  image_url: string;
  position?: string;
  size?: string;
  animation?: string;
};

interface VariantPreviewPlayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matches: MatchPreview[];
  videoTimeline?: CompositionClip[];
  /** Variant default transition — resolved into concrete transitionIn before posting. */
  defaultTransition?: TransitionSpec | null;
  pipelineId: string;
  variantIndex: number;
  scriptId: string;
  outputId: string;
  visualVersion?: string;
  title?: string;
  profileId: string;
  subtitleSettings?: SubtitleSettings;
  sourceVideoIds?: string[];
  minSegmentDuration?: number;
  wordsPerSubtitle?: number;
  ultraRapidIntro?: boolean;
  interstitialSlides?: InterstitialSlide[];
  attentionTimeline?: AttentionTimeline;
  pipOverlays?: Record<string, PreviewPipOverlayConfig>;
  enableDenoise?: boolean;
  denoiseStrength?: number;
  enableSharpen?: boolean;
  sharpenAmount?: number;
  enableColor?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  voiceVolume?: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  /** A2 background music — carried into the server-rendered preview. */
  music?: MusicSettings | null;
  // The caller can resolve the Meta style before posting. Keep visualVersion
  // for the preview key/segment offset without applying a second style overlay.
  applyMetaSubtitleStyle?: boolean;
  safeZone?: SafeZoneType | null;
  outputWidth?: number;
  outputHeight?: number;
}

export const VariantPreviewPlayer = memo(function VariantPreviewPlayer({
  open,
  onOpenChange,
  matches,
  videoTimeline = [],
  defaultTransition,
  pipelineId,
  variantIndex,
  scriptId,
  outputId,
  visualVersion,
  title,
  profileId,
  subtitleSettings,
  sourceVideoIds,
  minSegmentDuration = 3.0,
  wordsPerSubtitle = 2,
  ultraRapidIntro = true,
  interstitialSlides,
  attentionTimeline,
  pipOverlays,
  enableDenoise = false,
  denoiseStrength = 2.0,
  enableSharpen = false,
  sharpenAmount = 0.5,
  enableColor = false,
  brightness = 0.0,
  contrast = 1.0,
  saturation = 1.0,
  voiceVolume = 1.0,
  audioFadeIn = 0.0,
  audioFadeOut = 0.0,
  music = null,
  applyMetaSubtitleStyle = true,
  safeZone = null,
  outputWidth = 1080,
  outputHeight = 1920,
}: VariantPreviewPlayerProps) {
  const mediaApiUrl = useApiUrl();
  const [status, setStatus] = useState<string>("idle");
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [matchesFingerprint, setMatchesFingerprint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitations, setLimitations] = useState<string[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Bug #119: keep a ref to matches so the render effect always uses the latest value
  const matchesRef = useRef(matches);
  useEffect(() => { matchesRef.current = matches; }, [matches]);
  const videoTimelineRef = useRef(videoTimeline);
  useEffect(() => { videoTimelineRef.current = videoTimeline; }, [videoTimeline]);
  const defaultTransitionRef = useRef(defaultTransition);
  useEffect(() => { defaultTransitionRef.current = defaultTransition; }, [defaultTransition]);
  const musicRef = useRef(music);
  useEffect(() => { musicRef.current = music; }, [music]);

  // Stop progress tracking (SSE + polling fallback) on unmount or close
  const stopPolling = useCallback(() => {
    cancelledRef.current = true;
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  // Pause video and release media resources on unmount to prevent audio leak
  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    };
  }, []);

  // Start preview render when dialog opens
  useEffect(() => {
    if (!open || matches.length === 0) return;

    // M12: Reset cancelledRef when dialog reopens so polling works
    cancelledRef.current = false;

    const startRender = async () => {
      setStatus("processing");
      setProgress(0);
      setCurrentStep("Starting preview render...");
      setError(null);

      try {
        const resp = await apiPost(
          `/pipeline/render-preview/${pipelineId}/${variantIndex}`,
          {
            script_id: scriptId,
            output_id: outputId,
            match_overrides: matchesRef.current.map((m) => ({
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
              duration_override: m.duration_override,
              transforms: m.transforms,
            })),
            // Same resolution as the final render request: expand the variant
            // default into concrete per-boundary transitionIn (preview/render parity).
            composition_override: videoTimelineRef.current.length > 0
              ? resolveCompositionTransitions(videoTimelineRef.current, defaultTransitionRef.current)
              : undefined,
            source_video_ids: sourceVideoIds,
            min_segment_duration: minSegmentDuration,
            // Do not reconstruct this field-by-field. The Subtitle Style panel
            // owns the effective style (including Meta A/B and karaoke fields),
            // so the FFmpeg preview must receive that exact object.
            subtitle_settings: subtitleSettings ? { ...subtitleSettings } : undefined,
            words_per_subtitle: wordsPerSubtitle,
            ultra_rapid_intro: ultraRapidIntro,
            interstitial_slides: interstitialSlides?.filter((s) => s.imageUrl) ?? undefined,
            attention_timeline: attentionTimeline
              ? {
                  ...attentionTimeline,
                  script_id: scriptId,
                  output_id: outputId,
                }
              : undefined,
            pip_overlays: pipOverlays,
            enable_denoise: enableDenoise,
            denoise_strength: denoiseStrength,
            enable_sharpen: enableSharpen,
            sharpen_amount: sharpenAmount,
            enable_color: enableColor,
            brightness,
            contrast,
            saturation,
            voice_volume: voiceVolume,
            audio_fade_in: audioFadeIn,
            audio_fade_out: audioFadeOut,
            music: musicRef.current ?? undefined,
            visual_version: visualVersion,
            apply_meta_subtitle_style: applyMetaSubtitleStyle,
            output_width: outputWidth,
            output_height: outputHeight,
          }
        );

        // apiPost already throws on non-OK responses (FE-02: removed dead !resp.ok check)
        const result = await resp.json();
        if (
          (result.script_id && result.script_id !== scriptId)
          || (result.output_id && result.output_id !== outputId)
        ) {
          throw new Error("Preview render response belongs to another output.");
        }
        const fp = result.matches_fingerprint;
        setMatchesFingerprint(fp);

        if (result.status === "completed") {
          // Cache hit — video already ready
          setStatus("completed");
          setProgress(100);
          setCurrentStep("Preview ready");
          return;
        }

        if (cancelledRef.current) return; // Bug #133: check before starting tracking

        const query = new URLSearchParams({
          script_id: scriptId,
          output_id: outputId,
        });
        if (visualVersion) query.set("visual_version", visualVersion);
        const previewIdentityQuery = `?${query.toString()}`;

        const applyProgress = (statusData: {
          status?: string;
          progress?: number;
          current_step?: string;
          error?: string | null;
          preview_limitations?: string[] | null;
          script_id?: string;
          output_id?: string;
        }): boolean => {
          if (
            (statusData.script_id && statusData.script_id !== scriptId)
            || (statusData.output_id && statusData.output_id !== outputId)
          ) {
            setStatus("failed");
            setError("Preview render status belongs to another output.");
            stopPolling();
            return true;
          }
          setProgress(statusData.progress ?? 0);
          setCurrentStep(statusData.current_step ?? "");
          if (statusData.status === "completed") {
            setStatus("completed");
            if (statusData.preview_limitations) setLimitations(statusData.preview_limitations);
            stopPolling();
            return true;
          }
          if (statusData.status === "failed") {
            setStatus("failed");
            setError(statusData.error ?? "Preview render failed");
            stopPolling();
            return true;
          }
          return false;
        };

        // Fallback: setTimeout polling chain (FE-02) — used when SSE is unavailable
        const startPolling = () => {
          let pollAttempts = 0;
          const MAX_POLL_ATTEMPTS = 90; // 3 minutes at 2s interval
          const pollStatus = async () => {
            if (cancelledRef.current) return;
            pollAttempts++;
            if (pollAttempts > MAX_POLL_ATTEMPTS) {
              setStatus("failed");
              setError("Preview render timed out. Please try again.");
              return;
            }
            try {
              const statusResp = await apiGet(
                `/pipeline/preview-status/${pipelineId}/${variantIndex}${previewIdentityQuery}`
              );
              const statusData = await statusResp.json();
              if (applyProgress(statusData)) return;
            } catch {
              // Polling error — keep trying
            }
            // Re-schedule only if not cancelled
            if (!cancelledRef.current) {
              pollTimeoutRef.current = setTimeout(pollStatus, 2000);
            }
          };
          pollTimeoutRef.current = setTimeout(pollStatus, 2000);
        };

        // Primary: SSE progress stream (F2) — instant updates, no 2s polling
        try {
          const es = new EventSource(
            `${mediaApiUrl}/pipeline/preview-progress/${pipelineId}/${variantIndex}${previewIdentityQuery}`
          );
          eventSourceRef.current = es;
          let terminal = false;
          es.addEventListener("progress", (e) => {
            try {
              terminal = applyProgress(JSON.parse((e as MessageEvent).data)) || terminal;
            } catch {
              // Malformed event — ignore; polling fallback kicks in on error
            }
          });
          es.onerror = () => {
            es.close();
            if (eventSourceRef.current === es) eventSourceRef.current = null;
            if (!terminal && !cancelledRef.current) startPolling();
          };
        } catch {
          startPolling();
        }
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
        // Explicitly pause video to prevent audio leaking after dialog closes
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.removeAttribute("src");
          videoRef.current.load();
        }
        setStatus("processing");
        setProgress(0);
        setCurrentStep("");
        setError(null);
        setMatchesFingerprint(null);
        setLimitations([]);
        setVideoReady(false);
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, stopPolling]
  );

  const previewVideoUrl =
    status === "completed" && matchesFingerprint
      ? `${mediaApiUrl}/pipeline/preview-video/${pipelineId}/${variantIndex}?fp=${encodeURIComponent(matchesFingerprint)}&script_id=${encodeURIComponent(scriptId)}&output_id=${encodeURIComponent(outputId)}${visualVersion ? `&visual_version=${encodeURIComponent(visualVersion)}` : ""}`
      : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(96vw,1200px)] max-w-[1200px] sm:max-w-[1200px]">
        <DialogHeader>
          <DialogTitle>{title ?? `Variant ${variantIndex + 1} Preview`}</DialogTitle>
        </DialogHeader>

        <div
          className="relative mx-auto bg-black rounded-lg overflow-hidden flex items-center justify-center"
          style={{
            aspectRatio: `${outputWidth} / ${outputHeight}`,
            maxHeight: "75vh",
            width: `min(100%, calc(75vh * ${outputWidth} / ${outputHeight}))`,
          }}
        >
          {/* Loading state */}
          {status === "processing" && (
            <div className="flex flex-col items-center gap-3 px-4">
              <Loader2 className="size-8 animate-spin text-primary" />
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

          {/* Video player — wait for canplay before showing to avoid frame block */}
          {status === "completed" && previewVideoUrl && (
            <>
              {!videoReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Buffering video...</p>
                </div>
              )}
              <video
                ref={videoRef}
                key={matchesFingerprint}
                src={previewVideoUrl}
                controls
                playsInline
                preload="auto"
                className={`w-full h-full object-contain transition-opacity duration-200 ${videoReady ? "opacity-100" : "opacity-0"}`}
                onCanPlay={() => {
                  setVideoReady(true);
                  videoRef.current?.play().catch(() => {});
                }}
              />
              {safeZone && <SafeZoneOverlay type={safeZone} />}
            </>
          )}

        </div>

        {/* Preview limitations */}
        {status === "completed" && limitations.length > 0 && (
          <div className="text-xs text-muted-foreground space-y-0.5 mt-2">
            <p className="font-medium">Preview notes:</p>
            <ul className="list-disc list-inside">
              {limitations.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
