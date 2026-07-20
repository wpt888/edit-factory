"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, CheckCircle2, Maximize2, ScanLine, X } from "lucide-react";
import {
  SubtitleSettings,
  SubtitleLine,
  FONT_OPTIONS,
  COLOR_PRESETS,
  VideoInfo,
  CAPTION_PRESETS,
  CaptionPreset,
  UserSubtitlePreset,
} from "@/types/video-processing";
import { apiPost } from "@/lib/api";
import {
  scaleSubtitlePx,
  scaleSubtitleFontPx,
  SUBTITLE_REFERENCE_HEIGHT,
  useSubtitlePreviewHeight,
} from "@/lib/subtitle-preview-scale";
import { stripAssTags } from "@/lib/karaoke-word-timing";

// Bug #126: stable default to avoid invalidating useMemo on every render
const DEFAULT_VIDEO_INFO: VideoInfo = { width: 1080, height: SUBTITLE_REFERENCE_HEIGHT, duration: 0, fps: 30, aspect_ratio: "9:16", is_vertical: true };

function InspectorSectionHeader({ title, summary }: { title: string; summary: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className="font-medium text-foreground">{title}</span>
      <span className="truncate text-xs font-normal text-muted-foreground">{summary}</span>
    </span>
  );
}

interface SubtitleEditorProps {
  /** Current subtitle settings */
  settings: SubtitleSettings;
  /** Called when settings change */
  onSettingsChange: (settings: SubtitleSettings) => void;
  /** Subtitle lines (SRT parsed) */
  subtitleLines?: SubtitleLine[];
  /** Called when subtitle lines change */
  onLinesChange?: (lines: SubtitleLine[]) => void;
  /** Show live preview */
  showPreview?: boolean;
  /** Preview height in pixels */
  previewHeight?: number;
  /** Optional viewport cap used by persistent editor previews */
  previewMaxViewportHeight?: number;
  /** Video info for correct aspect ratio preview */
  videoInfo?: VideoInfo;
  /** Loading state for video info */
  isLoadingVideoInfo?: boolean;
  /** Custom class name */
  className?: string;
  /** Compact mode (no preview, minimal spacing) */
  compact?: boolean;
  /** Pipeline ID for FFmpeg frame preview */
  pipelineId?: string;
  /** Variant index for FFmpeg frame preview */
  variantIndex?: number;
  /** Text sent to the FFmpeg preview endpoint when subtitle lines are not available */
  previewText?: string;
  /**
   * Optional Meta visual version label ("A" or "B"). When set and the active
   * variant has NO explicit user override, the FFmpeg preview endpoint will
   * apply the corresponding Meta profile overlay (Instagram/Facebook). The
   * caller decides whether to pass this — typically only when there is no
   * override for the current key, to mirror the render-time precedence rule.
   */
  visualVersion?: string;
  /**
   * Controls which sub-panels the component renders.
   *   "full"          — preview + settings side-by-side (current default).
   *   "preview-only"  — just the live preview panel, no settings controls.
   *                     Used by the pipeline page to show an always-on B
   *                     preview while the user edits A (and vice-versa).
   *   "settings-only" — just the style controls, no preview. The pipeline
   *                     page uses this for the active-tab editor; the
   *                     preview is rendered separately via two
   *                     "preview-only" instances so both Meta versions
   *                     stay visible simultaneously.
   *
   * Defaults to "full" so existing call sites keep working unchanged.
   */
  renderMode?: "full" | "preview-only" | "settings-only";
  previewInteractive?: boolean;
  userPresets?: UserSubtitlePreset[];
  onApplyUserPreset?: (preset: UserSubtitlePreset) => void;
  onDeleteUserPreset?: (preset: UserSubtitlePreset) => void;
}

export function SubtitleEditor({
  settings,
  onSettingsChange,
  subtitleLines = [],
  onLinesChange,
  showPreview = true,
  previewHeight = 600,
  previewMaxViewportHeight,
  videoInfo = DEFAULT_VIDEO_INFO,
  isLoadingVideoInfo = false,
  className = "",
  compact = false,
  pipelineId,
  variantIndex = 0,
  previewText,
  visualVersion,
  renderMode = "full",
  previewInteractive = false,
  userPresets = [],
  onApplyUserPreset,
  onDeleteUserPreset,
}: SubtitleEditorProps) {
  const previewMeasurement = useSubtitlePreviewHeight<HTMLDivElement>();
  // Track which preset is currently selected (null = manual/custom)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // FFmpeg frame preview state
  const [ffmpegPreviewUrl, setFfmpegPreviewUrl] = useState<string | null>(null);
  const [ffmpegBackgroundUrl, setFfmpegBackgroundUrl] = useState<string | null>(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [showSafeArea, setShowSafeArea] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearch, setFontSearch] = useState("");
  const [fontAccessError, setFontAccessError] = useState<string | null>(null);
  const ffmpegTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevFingerprint = useRef("");

  const loadSystemFonts = () => {
    const listFonts = window.editFactory?.listSystemFonts;
    if (!listFonts) return;
    setFontAccessError(null);
    listFonts()
      .then((fonts) => setSystemFonts(
        [...new Set(fonts.map((font) => font.family).filter(Boolean))]
          .filter((family) => !FONT_OPTIONS.some((font) => font.value === family))
          .sort((a, b) => a.localeCompare(b)),
      ))
      .catch(() => setFontAccessError("System font access was denied. Use the font picker again to retry."));
  };
  const latestSettingsRef = useRef(settings);
  // Monotonic request id — any response whose id is not the latest is
  // discarded so a slow earlier render can't overwrite a newer one.
  const requestSeq = useRef(0);
  const latestAppliedSeq = useRef(0);
  const previewOverlayText = previewText?.trim()
    || (subtitleLines.length > 0 ? subtitleLines[0].text : "")
    || "Sample subtitle text";
  const karaokePreviewWords = useMemo(
    () => stripAssTags(previewOverlayText)
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    [previewOverlayText],
  );
  const karaokePreviewKey = karaokePreviewWords.join("\u0000");
  const [karaokePreviewWordIndex, setKaraokePreviewWordIndex] = useState(0);

  // A still FFmpeg frame cannot demonstrate word-level timing. Cycle the
  // local overlay while Karaoke is enabled; final renders continue to use the
  // real ElevenLabs timings embedded in the generated ASS file.
  useEffect(() => {
    if (!settings.karaoke || karaokePreviewWords.length === 0) {
      setKaraokePreviewWordIndex(0);
      return;
    }

    setKaraokePreviewWordIndex(0);
    const timer = window.setInterval(() => {
      setKaraokePreviewWordIndex((current) =>
        current >= karaokePreviewWords.length - 1 ? 0 : current + 1
      );
    }, 600);
    return () => window.clearInterval(timer);
  }, [settings.karaoke, karaokePreviewKey, karaokePreviewWords.length]);

  // Legacy settings may store a full CSS font stack ("var(--font-x), X, sans-serif");
  // show the first real family name in the picker instead of the raw stack.
  const displayFontName = (() => {
    const raw = settings.fontFamily || "Montserrat";
    const first = raw
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .find((part) => part && !part.startsWith("var("));
    return first || raw;
  })();
  const normalizedFontSearch = fontSearch.trim().toLocaleLowerCase();
  const filteredCuratedFonts = FONT_OPTIONS.filter(({ label }) =>
    label.toLocaleLowerCase().includes(normalizedFontSearch)
  );
  const filteredSystemFonts = systemFonts.filter((family) =>
    family.toLocaleLowerCase().includes(normalizedFontSearch)
  );

  // Debounced FFmpeg frame preview fetch.
  //
  // Radix slider fires onValueChange continuously during drag. The CSS
  // overlay below updates immediately, while this effect refreshes the
  // expensive FFmpeg preview shortly after the user stops moving.
  useEffect(() => {
    if (!pipelineId) return;

    // Karaoke needs motion, so its preview uses the clean FFmpeg background
    // plus the animated local overlay below instead of a baked still frame.
    if (settings.karaoke) {
      if (ffmpegTimer.current) clearTimeout(ffmpegTimer.current);
      setFfmpegLoading(false);
      return;
    }

    // Include visualVersion in the fingerprint so toggling between Meta
    // versions triggers a new preview render even when settings are identical.
    const fingerprint =
      JSON.stringify(settings) +
      "|v=" + (visualVersion || "") +
      "|t=" + previewOverlayText;
    if (fingerprint === prevFingerprint.current) return;

    if (ffmpegTimer.current) clearTimeout(ffmpegTimer.current);
    setFfmpegLoading(true);

    ffmpegTimer.current = setTimeout(async () => {
      prevFingerprint.current = fingerprint;
      const mySeq = ++requestSeq.current;

      try {
        const versionQuery = visualVersion ? `?visual_version=${encodeURIComponent(visualVersion)}` : "";
        const resp = await apiPost(
          `/pipeline/subtitle-frame-preview/${pipelineId}/${variantIndex}${versionQuery}`,
          {
            subtitle_settings: settings,
            sample_text: previewOverlayText,
            include_subtitles: true,
          },
          { timeout: 20000 }
        );
        const blob = await resp.blob();

        // Out-of-order guard: a newer request has superseded this one.
        if (mySeq < latestAppliedSeq.current) {
          return;
        }
        latestAppliedSeq.current = mySeq;

        setFfmpegPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("FFmpeg frame preview failed:", err);
        }
      } finally {
        // Only clear the spinner when the latest-seen request has resolved.
        if (mySeq >= requestSeq.current) setFfmpegLoading(false);
      }
    }, 50);

    return () => {
      if (ffmpegTimer.current) clearTimeout(ffmpegTimer.current);
    };
  }, [settings, pipelineId, previewOverlayText, variantIndex, visualVersion]);

  // Stable clean frame used as the live-edit background. The accurate FFmpeg
  // preview image already contains text, so overlaying local text on it causes
  // duplicate subtitles while dragging sliders.
  useEffect(() => {
    if (!pipelineId) return;

    let cancelled = false;

    (async () => {
      try {
        const resp = await apiPost(
          `/pipeline/subtitle-frame-preview/${pipelineId}/${variantIndex}`,
          {
            subtitle_settings: {},
            sample_text: "",
            include_subtitles: false,
          },
          { timeout: 20000 }
        );
        const blob = await resp.blob();
        if (cancelled) return;

        setFfmpegBackgroundUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          console.warn("FFmpeg clean preview frame failed:", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pipelineId, variantIndex]);

  // Mirror the active blob URL into a ref so the unmount cleanup below can
  // read the *latest* value — a plain state capture with [] deps would freeze
  // at the initial null and leak the final URL.
  const ffmpegPreviewUrlRef = useRef<string | null>(null);
  const ffmpegBackgroundUrlRef = useRef<string | null>(null);
  useEffect(() => {
    ffmpegPreviewUrlRef.current = ffmpegPreviewUrl;
  }, [ffmpegPreviewUrl]);
  useEffect(() => {
    ffmpegBackgroundUrlRef.current = ffmpegBackgroundUrl;
  }, [ffmpegBackgroundUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (ffmpegPreviewUrlRef.current) URL.revokeObjectURL(ffmpegPreviewUrlRef.current);
      if (ffmpegBackgroundUrlRef.current) URL.revokeObjectURL(ffmpegBackgroundUrlRef.current);
    };
  }, []);

  useEffect(() => {
    latestSettingsRef.current = settings;
  }, [settings]);

  const emitSettingsChange = (nextSettings: SubtitleSettings) => {
    latestSettingsRef.current = nextSettings;
    onSettingsChange(nextSettings);
  };

  // Update a single setting (manual change clears preset selection)
  const updateSetting = <K extends keyof SubtitleSettings>(
    key: K,
    value: SubtitleSettings[K]
  ) => {
    setSelectedPresetId(null);
    emitSettingsChange({ ...latestSettingsRef.current, [key]: value });
  };

  const mergePresetSettings = (
    currentSettings: SubtitleSettings,
    presetSettings: SubtitleSettings
  ): SubtitleSettings => ({
    ...currentSettings,
    ...presetSettings,
    positionY: currentSettings.positionY,
    position: currentSettings.position,
    marginV: currentSettings.marginV,
  });

  // Apply a preset's settings all at once
  const applyPreset = (preset: CaptionPreset) => {
    setSelectedPresetId(preset.id);
    emitSettingsChange(mergePresetSettings(latestSettingsRef.current, preset.settings));
  };

  // Update a subtitle line
  const updateSubtitleLine = (id: number, text: string) => {
    if (!onLinesChange) return;
    const updated = subtitleLines.map((line) =>
      line.id === id ? { ...line, text } : line
    );
    onLinesChange(updated);
  };

  // Preview calculations
  const previewDimensions = useMemo(() => {
    const safeWidth = videoInfo.width || 1080;
    const safeHeight = videoInfo.height || SUBTITLE_REFERENCE_HEIGHT;
    const aspectRatio = safeWidth / safeHeight;

    if (videoInfo.is_vertical) {
      return {
        width: previewHeight * aspectRatio,
        height: previewHeight,
      };
    }
    return {
      width: previewHeight,
      height: previewHeight / aspectRatio,
    };
  }, [videoInfo, previewHeight]);

  const measuredPreviewDimensions = {
    ...previewDimensions,
    height: previewMeasurement.height || previewDimensions.height,
  };

  const renderLocalSubtitleOverlay = (
    dimensions: { height: number },
    className = ""
  ) => {
    const fontSize = scaleSubtitleFontPx(settings.fontSize, dimensions.height);
    const outlineWidth = scaleSubtitlePx(settings.outlineWidth, dimensions.height, 0);
    const shadowDepth = scaleSubtitlePx(settings.shadowDepth ?? 0, dimensions.height, 0);
    const glowBlur = scaleSubtitlePx(settings.glowBlur ?? 0, dimensions.height, 0);
    const letterSpacing = scaleSubtitlePx(settings.letterSpacing ?? 0, dimensions.height, -Infinity);
    const opacity = Math.max(0, Math.min(100, settings.opacity ?? 100)) / 100;
    const baseShadow =
      shadowDepth > 0
        ? `0 ${shadowDepth}px ${Math.max(1, shadowDepth * 2)}px ${settings.shadowColor ?? "#000000"}`
        : "0 1px 3px rgba(0,0,0,0.85)";
    const glowShadow =
      settings.enableGlow && glowBlur > 0
        ? `, 0 0 ${glowBlur}px ${settings.outlineColor}`
        : "";
    const textStyle: CSSProperties = {
      fontFamily: settings.fontFamily,
      fontSize: `${fontSize}px`,
      color: settings.textColor,
      opacity,
      textShadow: `${baseShadow}${glowShadow}`,
      WebkitTextStroke:
        outlineWidth > 0 ? `${outlineWidth}px ${settings.outlineColor}` : undefined,
      paintOrder: "stroke fill",
      letterSpacing: `${letterSpacing}px`,
    };
    const positionStyle: CSSProperties =
      settings.positionY <= 20
        ? { top: `${settings.positionY}%` }
        : { top: `${settings.positionY}%`, transform: "translateY(-50%)" };

    const updatePositionFromPointer = (clientY: number, preview: HTMLElement) => {
      const rect = preview.getBoundingClientRect();
      if (!rect.height) return;
      updateSetting("positionY", Math.round(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))));
    };
    return (
      <div
        className={`absolute left-2 right-2 z-[2] ${previewInteractive ? "cursor-grab active:cursor-grabbing touch-none" : "pointer-events-none"} ${className}`}
        style={{ ...positionStyle, textAlign: settings.horizontalAlignment ?? "center" }}
        onPointerDown={previewInteractive ? (event) => { const preview = event.currentTarget.parentElement; if (preview) { event.currentTarget.setPointerCapture(event.pointerId); updatePositionFromPointer(event.clientY, preview); } } : undefined}
        onPointerMove={previewInteractive ? (event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const preview = event.currentTarget.parentElement; if (preview) updatePositionFromPointer(event.clientY, preview); } : undefined}
      >
        <p
          className="inline-block px-2 py-1 font-semibold leading-tight"
          style={textStyle}
          data-testid={settings.karaoke ? "karaoke-preview-overlay" : undefined}
        >
          {settings.karaoke && karaokePreviewWords.length > 0
            ? karaokePreviewWords.map((word, index) => {
                const isActive = index === karaokePreviewWordIndex;
                if (settings.karaokeStyle === "box") {
                  return (
                    <span key={`${index}-${word}`} data-karaoke-state={isActive ? "highlighted" : "pending"}>
                      {index > 0 ? " " : ""}
                      <span
                        style={{
                          color: isActive ? settings.highlightColor ?? "#FFFF00" : settings.textColor,
                          backgroundColor: isActive ? settings.highlightBgColor ?? "#A3E635" : "transparent",
                          padding: "0.08em 0.18em",
                          borderRadius: "2px",
                          transition: "color 120ms linear, background-color 120ms linear",
                        }}
                      >
                        {word}
                      </span>
                    </span>
                  );
                }
                return (
                  <span
                    key={`${index}-${word}`}
                    data-karaoke-state={index <= karaokePreviewWordIndex ? "highlighted" : "pending"}
                    style={{
                      color: index <= karaokePreviewWordIndex
                        ? settings.highlightColor ?? "#FFFF00"
                        : settings.textColor,
                      transition: "color 120ms linear",
                    }}
                  >
                    {index > 0 ? " " : ""}{word}
                  </span>
                );
              })
            : previewOverlayText}
        </p>
      </div>
    );
  };

  // The preview panel rendered as a standalone block
  const previewPanel = showPreview ? (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Label className="text-base font-semibold">Live Preview</Label>
        <div className="flex items-center gap-2">
          {isLoadingVideoInfo && (
            <span className="text-xs text-muted-foreground">Loading...</span>
          )}
          <Button
            type="button"
            variant={showSafeArea ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 px-2.5"
            onClick={() => setShowSafeArea((visible) => !visible)}
            aria-pressed={showSafeArea}
            title={`${showSafeArea ? "Hide" : "Show"} Safe Area`}
          >
            <ScanLine className="size-3.5" />
            Safe Area
          </Button>
        </div>
      </div>

      <div className="flex justify-center">
        <div
          ref={previewMeasurement.ref}
          className="relative bg-black rounded-lg overflow-hidden border-2 border-border shadow-xl"
          style={{
            width: previewMaxViewportHeight
              ? `min(${previewDimensions.width}px, ${previewMaxViewportHeight * (previewDimensions.width / previewDimensions.height)}dvh)`
              : `${previewDimensions.width}px`,
            height: previewMaxViewportHeight
              ? `min(${previewDimensions.height}px, ${previewMaxViewportHeight}dvh)`
              : `${previewDimensions.height}px`,
          }}
        >
          {settings.karaoke ? (
            <>
              {ffmpegBackgroundUrl ? (
                <img
                  src={ffmpegBackgroundUrl}
                  alt="Subtitle preview"
                  className="absolute inset-0 w-full h-full object-contain rounded-lg"
                />
              ) : (
                <div className="absolute inset-0 bg-muted" />
              )}
              {renderLocalSubtitleOverlay(measuredPreviewDimensions)}
            </>
          ) : !ffmpegLoading && ffmpegPreviewUrl ? (
            <img
              src={ffmpegPreviewUrl}
              alt="Subtitle preview"
              className="absolute inset-0 w-full h-full object-contain rounded-lg"
            />
          ) : ffmpegBackgroundUrl ? (
            <>
              <img
                src={ffmpegBackgroundUrl}
                alt="Subtitle preview"
                className="absolute inset-0 w-full h-full object-contain rounded-lg"
              />
              {renderLocalSubtitleOverlay(measuredPreviewDimensions)}
            </>
          ) : (
            <>
              {/* Gradient background simulating video */}
              <div className="absolute inset-0 bg-muted" />
              {renderLocalSubtitleOverlay(measuredPreviewDimensions)}
            </>
          )}
          {ffmpegLoading && (
            <div className="absolute top-2 right-2">
              <Loader2 className="size-4 animate-spin text-white/60" />
            </div>
          )}
          {showSafeArea && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-[6%] top-[8%] bottom-[8%] z-[1] rounded border border-dashed border-white/25" />
          )}
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="absolute top-2 left-2 z-10 rounded bg-black/60 hover:bg-black/80 p-1.5 text-white/80 hover:text-white transition"
            title="Expand preview"
            aria-label="Expand preview"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-[min(95vw,900px)] sm:max-w-[min(95vw,900px)] p-0 bg-black border-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Subtitle Preview (Fullscreen)</DialogTitle>
            <DialogDescription>Enlarged subtitle preview view</DialogDescription>
          </DialogHeader>
          <div
            className="relative bg-black rounded-lg overflow-hidden mx-auto"
            style={{
              aspectRatio: `${videoInfo.width || 1080} / ${videoInfo.height || SUBTITLE_REFERENCE_HEIGHT}`,
              height: "min(85vh, 900px)",
              containerType: "size",
            }}
          >
            {settings.karaoke ? (
              <>
                {ffmpegBackgroundUrl ? (
                  <img
                    src={ffmpegBackgroundUrl}
                    alt="Subtitle preview"
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 bg-muted" />
                )}
                {renderLocalSubtitleOverlay({ height: 900 })}
              </>
            ) : !ffmpegLoading && ffmpegPreviewUrl ? (
              <img
                src={ffmpegPreviewUrl}
                alt="Subtitle preview"
                className="absolute inset-0 w-full h-full object-contain"
              />
            ) : ffmpegBackgroundUrl ? (
              <>
                <img
                  src={ffmpegBackgroundUrl}
                  alt="Subtitle preview"
                  className="absolute inset-0 w-full h-full object-contain"
                />
                {renderLocalSubtitleOverlay({ height: 900 })}
              </>
            ) : (
              <>
                <div className="absolute inset-0 bg-muted" />
                {renderLocalSubtitleOverlay({ height: 900 })}
              </>
            )}
            {showSafeArea && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-[6%] top-[8%] bottom-[8%] z-[1] rounded border border-dashed border-white/25" />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Info */}
      <div className="text-center space-y-1">
        <p className="text-xs text-muted-foreground">
          Font: {settings.fontSize}px | Outline: {settings.outlineWidth}px | Y: {settings.positionY}%
        </p>
        {pipelineId && (
          settings.karaoke ? (
            <Badge variant="outline" className="text-[10px] text-success border-success/30">
              <CheckCircle2 className="size-3 mr-1" />
              Animated Karaoke preview
            </Badge>
          ) : ffmpegPreviewUrl ? (
            <Badge variant="outline" className="text-[10px] text-success border-success/30">
              <CheckCircle2 className="size-3 mr-1" />
              Accurate preview
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
              Rendering preview
            </Badge>
          )
        )}
      </div>
    </div>
  ) : null;

  // The settings controls panel
  const settingsPanel = (
    <Accordion
      type="multiple"
      defaultValue={["text"]}
      className="w-full border-y border-border/70"
      data-testid="subtitle-settings-accordion"
    >
      <AccordionItem value="presets" data-testid="subtitle-section-presets">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader
            title="Style Presets"
            summary={`${CAPTION_PRESETS.length} built-in${userPresets.length ? ` · ${userPresets.length} saved` : ""}`}
          />
        </AccordionTrigger>
        <AccordionContent className="px-1.5 pb-2 pt-0.5">
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
          {[
            ...CAPTION_PRESETS.map((preset) => ({ preset, userPreset: undefined as UserSubtitlePreset | undefined })),
            ...userPresets.map((userPreset) => ({
              preset: {
                ...userPreset,
                id: `user-${userPreset.id}`,
                description: "Saved subtitle preset",
                previewStyle: { backgroundColor: "#18181b", textSample: "Sample Text" },
              },
              userPreset,
            })),
          ].map(({ preset, userPreset }) => {
            const isSelected = selectedPresetId === preset.id;
            const outlineShadow = `-1px -1px 0 ${preset.settings.outlineColor}, 1px -1px 0 ${preset.settings.outlineColor}, -1px 1px 0 ${preset.settings.outlineColor}, 1px 1px 0 ${preset.settings.outlineColor}`;
            const glowShadow = preset.settings.enableGlow && preset.settings.glowBlur
              ? `, 0 0 ${preset.settings.glowBlur}px ${preset.settings.outlineColor}`
              : "";
            return (
              <button
                key={preset.id}
                onClick={() => {
                  if (userPreset) {
                    setSelectedPresetId(preset.id);
                    onApplyUserPreset?.(userPreset);
                  } else {
                    applyPreset(preset);
                  }
                }}
                className={`relative h-16 cursor-pointer overflow-hidden rounded border transition-all hover:opacity-90 ${
                  isSelected
                    ? "ring-2 ring-primary border-primary"
                    : "border-border hover:border-muted-foreground/50"
                }`}
                style={{ backgroundColor: preset.previewStyle.backgroundColor }}
                title={preset.description}
              >
                <div className="absolute inset-0 flex items-center justify-center px-2">
                  <span
                    className="font-bold text-sm leading-tight"
                    style={{
                      fontFamily: preset.settings.fontFamily,
                      color: preset.settings.textColor,
                      opacity: (preset.settings.opacity ?? 100) / 100,
                      textShadow: outlineShadow + glowShadow,
                    }}
                  >
                    {preset.previewStyle.textSample}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-0.5"><span className="text-[10px] text-white/80 font-medium">{preset.name}</span></div>
                {userPreset && onDeleteUserPreset && <span role="button" tabIndex={0} aria-label={`Delete ${preset.name}`} className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-destructive" onClick={(event) => { event.stopPropagation(); onDeleteUserPreset(userPreset); }}><X className="size-3" /></span>}
              </button>
            );
          })}
        </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="text" data-testid="subtitle-section-text">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader title="Text" summary={`${displayFontName} · ${settings.fontSize}px`} />
        </AccordionTrigger>
        <AccordionContent className="space-y-1.5 px-1.5 pb-2 pt-0.5">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <Label>Font</Label>
            <Select value={settings.fontFamily} onValueChange={(value) => updateSetting("fontFamily", value)}>
              <SelectTrigger className="h-7 w-44 bg-muted/50" style={{ fontFamily: settings.fontFamily }}>
                {/* children override: always show the stored font, even when its SelectItem isn't mounted (system fonts load on demand). Legacy settings may store a full CSS stack — display the first real family name. */}
                <SelectValue placeholder="Montserrat">{displayFontName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <div className="p-2">
                  <Input
                    value={fontSearch}
                    onChange={(event) => setFontSearch(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                    placeholder="Search fonts..."
                    aria-label="Search fonts"
                  />
                </div>
                {/* phantom item so an unlisted stored font stays selectable until system fonts load */}
                {settings.fontFamily &&
                  !FONT_OPTIONS.some((font) => font.value === settings.fontFamily) &&
                  !systemFonts.includes(settings.fontFamily) && (
                    <SelectItem value={settings.fontFamily} style={{ fontFamily: settings.fontFamily }}>
                      {displayFontName}
                    </SelectItem>
                  )}
                {filteredCuratedFonts.map((font) => (
                  <SelectItem key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                    {font.label}
                  </SelectItem>
                ))}
                {filteredSystemFonts.map((family) => (
                  <SelectItem key={`system-${family}`} value={family} style={{ fontFamily: family }}>
                    {family} (System)
                  </SelectItem>
                ))}
                {filteredCuratedFonts.length === 0 && filteredSystemFonts.length === 0 && (
                  <p className="px-2 pb-2 text-xs text-muted-foreground">No fonts found.</p>
                )}
              </SelectContent>
            </Select>
          </div>
          {typeof window !== "undefined" && window.editFactory?.listSystemFonts && (
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={loadSystemFonts}>
                {systemFonts.length ? "Refresh system fonts" : "Load system fonts"}
              </Button>
            </div>
          )}
          {fontAccessError && <p className="text-xs text-amber-500">{fontAccessError}</p>}
          {!FONT_OPTIONS.some((font) => font.value === settings.fontFamily) &&
            systemFonts.length > 0 && !systemFonts.includes(settings.fontFamily) && (
              <p className="text-xs text-amber-500">
                Font {settings.fontFamily} is unavailable on this computer; Montserrat will be used.
              </p>
            )}

          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Font Size</Label>
            <Slider value={[settings.fontSize]} onValueChange={([value]) => updateSetting("fontSize", value)} min={12} max={200} step={1} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.fontSize}px</span>
          </div>
          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Letter Spacing</Label>
            <Slider value={[settings.letterSpacing ?? 0]} onValueChange={([value]) => updateSetting("letterSpacing", value)} min={-2} max={10} step={0.5} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.letterSpacing ?? 0}px</span>
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2"><Label>Adaptive Sizing</Label><p className="truncate text-[11px] text-muted-foreground">Auto-reduce for long text</p></div>
            <Switch checked={settings.adaptiveSizing ?? false} onCheckedChange={(checked) => updateSetting("adaptiveSizing", checked)} />
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="color-stroke" data-testid="subtitle-section-color-stroke">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader title="Color & Stroke" summary={`${settings.textColor} · ${settings.outlineWidth}px`} />
        </AccordionTrigger>
        <AccordionContent className="space-y-1.5 px-1.5 pb-2 pt-0.5">
          <ColorPicker label="Text Color" value={settings.textColor} onChange={(value) => updateSetting("textColor", value)} />
          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Opacity</Label>
            <Slider value={[settings.opacity ?? 100]} onValueChange={([value]) => updateSetting("opacity", value)} min={0} max={100} step={5} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.opacity ?? 100}%</span>
          </div>
          <ColorPicker label="Outline Color" value={settings.outlineColor} onChange={(value) => updateSetting("outlineColor", value)} />
          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Outline Width</Label>
            <Slider value={[settings.outlineWidth]} onValueChange={([value]) => updateSetting("outlineWidth", value)} min={0} max={10} step={1} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.outlineWidth}px</span>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="position" data-testid="subtitle-section-position">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader title="Position" summary={`${settings.horizontalAlignment ?? "center"} · Y ${settings.positionY}%`} />
        </AccordionTrigger>
        <AccordionContent className="space-y-1.5 px-1.5 pb-2 pt-0.5">
          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Vertical Position (Y)</Label>
            <Slider value={[settings.positionY]} onValueChange={([value]) => updateSetting("positionY", value)} min={5} max={95} step={1} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.positionY}%</span>
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <Label>Horizontal Alignment</Label>
            <Select
              value={settings.horizontalAlignment ?? "center"}
              onValueChange={(value) => updateSetting("horizontalAlignment", value as "left" | "center" | "right")}
            >
              <SelectTrigger className="h-7 w-40 bg-muted/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="center">Center</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="background-shadow" data-testid="subtitle-section-background-shadow">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader
            title="Background & Shadow"
            summary={`${(settings.borderStyle ?? 1) === 3 ? "Box" : "Outline"} · Shadow ${settings.shadowDepth ?? 0}px`}
          />
        </AccordionTrigger>
        <AccordionContent className="space-y-1.5 px-1.5 pb-2 pt-0.5">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <Label>Border Style</Label>
            <Select
              value={String(settings.borderStyle ?? 1)}
              onValueChange={(value) => updateSetting("borderStyle", Number(value))}
            >
              <SelectTrigger className="h-7 w-44 bg-muted/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Outline + Shadow</SelectItem>
                <SelectItem value="3">Box Background</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
            <Label>Shadow Depth</Label>
            <Slider value={[settings.shadowDepth ?? 0]} onValueChange={([value]) => updateSetting("shadowDepth", value)} min={0} max={4} step={1} />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.shadowDepth ?? 0}px</span>
          </div>
          {(settings.shadowDepth ?? 0) > 0 && (
            <ColorPicker
              label="Shadow Color"
              value={settings.shadowColor ?? "#000000"}
              onChange={(value) => updateSetting("shadowColor", value)}
            />
          )}
          <div className="flex min-h-7 items-center justify-between gap-2">
            <Label>Glow Effect</Label>
            <Switch checked={settings.enableGlow ?? false} onCheckedChange={(checked) => updateSetting("enableGlow", checked)} />
          </div>
          {settings.enableGlow && (
            <div className="grid min-h-6 grid-cols-[7rem_1fr_auto] items-center gap-2">
              <Label>Glow Blur</Label>
              <Slider value={[settings.glowBlur ?? 0]} onValueChange={([value]) => updateSetting("glowBlur", value)} min={0} max={10} step={1} />
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{settings.glowBlur ?? 0}px</span>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="karaoke" data-testid="subtitle-section-karaoke">
        <AccordionTrigger className="h-8 rounded-none px-1.5 py-0 hover:no-underline">
          <InspectorSectionHeader
            title="Karaoke"
            summary={settings.karaoke ? `On · ${settings.karaokeStyle === "box" ? "Background box" : "Color sweep"}` : "Off"}
          />
        </AccordionTrigger>
        <AccordionContent className="space-y-1.5 px-1.5 pb-2 pt-0.5">
          <div className="flex min-h-7 items-center justify-between gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <Label>Karaoke Highlight</Label>
              <p className="truncate text-[11px] text-muted-foreground">Synced word highlight</p>
            </div>
            <Switch checked={settings.karaoke ?? false} onCheckedChange={(checked) => updateSetting("karaoke", checked)} />
          </div>
          {settings.karaoke && (
            <>
              <div className="flex min-h-7 items-center justify-between gap-2">
                <Label>Highlight Style</Label>
                <Select
                  value={settings.karaokeStyle ?? "color"}
                  onValueChange={(value) => updateSetting("karaokeStyle", value as "color" | "box")}
                >
                  <SelectTrigger className="h-7 w-44 bg-muted/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="color">Color sweep</SelectItem>
                    <SelectItem value="box">Background box</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ColorPicker
                label="Active Word Color"
                value={settings.highlightColor ?? "#FFFF00"}
                onChange={(value) => updateSetting("highlightColor", value)}
              />
              {settings.karaokeStyle === "box" && (
                <ColorPicker
                  label="Highlight Background"
                  value={settings.highlightBgColor ?? "#A3E635"}
                  onChange={(value) => updateSetting("highlightBgColor", value)}
                />
              )}
            </>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  // ── Render mode branching ─────────────────────────────────────────────
  // "preview-only" — just the live preview, no settings controls or lines
  // editor. Used by the pipeline page to stack two always-on previews (A/B)
  // side-by-side without duplicating the settings panel.
  if (renderMode === "preview-only") {
    return (
      <div className={className}>
        {previewPanel}
      </div>
    );
  }

  // "settings-only" — just the style controls (and the subtitle lines editor
  // if the caller provides one). No preview. The pipeline page uses this for
  // the active-tab editor; the preview(s) are rendered separately via
  // "preview-only" instances so both A and B stay visible.
  if (renderMode === "settings-only") {
    return (
      <div className={className}>
        <div className={`space-y-${compact ? "3" : "6"}`}>
          {settingsPanel}
        </div>

        {onLinesChange && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold">Subtitle Editor</h3>
                {subtitleLines.length > 0 && (
                  <Badge variant="secondary">{subtitleLines.length} lines</Badge>
                )}
              </div>

              <SubtitleLinesEditor
                subtitleLines={subtitleLines}
                onUpdateLine={updateSubtitleLine}
              />
            </div>
          </>
        )}
      </div>
    );
  }

  // "full" (default) — preserves the exact layout from before this refactor.
  return (
    <div className={className}>
      {/* Side-by-side layout: Preview (left, sticky) + Settings (right, scrollable) */}
      {showPreview && !compact ? (
        <div className="flex gap-6 items-start">
          {/* Left: Sticky preview */}
          <div className="sticky top-4 flex-shrink-0">
            {previewPanel}
          </div>

          {/* Right: Scrollable settings */}
          <div className="flex-1 min-w-0">
            {settingsPanel}
          </div>
        </div>
      ) : (
        /* Compact or no-preview: vertical stack as before */
        <div className={`space-y-${compact ? "3" : "6"}`}>
          {settingsPanel}
        </div>
      )}

      {/* Subtitle Lines Editor */}
      {onLinesChange && (
        <>
          <Separator />
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold">Subtitle Editor</h3>
              {subtitleLines.length > 0 && (
                <Badge variant="secondary">{subtitleLines.length} lines</Badge>
              )}
            </div>

            <SubtitleLinesEditor
              subtitleLines={subtitleLines}
              onUpdateLine={updateSubtitleLine}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SubtitleLinesEditor({
  subtitleLines,
  onUpdateLine,
}: {
  subtitleLines: SubtitleLine[];
  onUpdateLine: (id: number, text: string) => void;
}) {
  const [editingLine, setEditingLine] = useState<SubtitleLine | null>(null);

  if (subtitleLines.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Upload an SRT file to edit subtitles</p>
        <p className="text-sm mt-1">or let AI generate them automatically</p>
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-[300px] border rounded-lg">
        <div className="p-4 space-y-2">
          {subtitleLines.map((line) => (
            <div
              key={line.id}
              className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex justify-between items-start gap-2 mb-2">
                <Badge variant="outline" className="text-xs">
                  #{line.id}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {line.start} {"\u2192"} {line.end}
                </span>
              </div>
              <button
                className="w-full text-left text-sm hover:text-primary transition-colors"
                onClick={() => setEditingLine(line)}
              >
                {line.text}
              </button>
            </div>
          ))}
        </div>
      </ScrollArea>

      <Dialog open={editingLine !== null} onOpenChange={(open) => { if (!open) setEditingLine(null); }}>
        {editingLine && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Subtitle #{editingLine.id}</DialogTitle>
              <DialogDescription>
                {editingLine.start} {"\u2192"} {editingLine.end}
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={editingLine.text}
              onChange={(e) => {
                setEditingLine({ ...editingLine, text: e.target.value });
                onUpdateLine(editingLine.id, e.target.value);
              }}
              className="min-h-[100px]"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingLine(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

// Color Picker sub-component
interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-7 w-40 justify-start gap-2 px-2 font-mono text-xs">
            <div
              className="size-4 rounded-sm border"
              style={{ backgroundColor: value }}
            />
            {value}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="space-y-3">
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  className="size-8 rounded border-2 hover:scale-110 transition-transform"
                  style={{
                    backgroundColor: color,
                    borderColor: value === color ? "hsl(var(--primary))" : "transparent",
                  }}
                  onClick={() => onChange(color)}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                type="color"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-12 h-10 p-1 cursor-pointer"
              />
              <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="flex-1"
                placeholder="#FFFFFF"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
