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
import { Type, Loader2, CheckCircle2, Maximize2 } from "lucide-react";
import {
  SubtitleSettings,
  SubtitleLine,
  FONT_OPTIONS,
  COLOR_PRESETS,
  VideoInfo,
  CAPTION_PRESETS,
  CaptionPreset,
} from "@/types/video-processing";
import { apiPost } from "@/lib/api";
import {
  scaleSubtitlePx,
  SUBTITLE_REFERENCE_HEIGHT,
} from "@/lib/subtitle-preview-scale";

// Bug #126: stable default to avoid invalidating useMemo on every render
const DEFAULT_VIDEO_INFO: VideoInfo = { width: 1080, height: SUBTITLE_REFERENCE_HEIGHT, duration: 0, fps: 30, aspect_ratio: "9:16", is_vertical: true };

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
}

export function SubtitleEditor({
  settings,
  onSettingsChange,
  subtitleLines = [],
  onLinesChange,
  showPreview = true,
  previewHeight = 600,
  videoInfo = DEFAULT_VIDEO_INFO,
  isLoadingVideoInfo = false,
  className = "",
  compact = false,
  pipelineId,
  variantIndex = 0,
  previewText,
  visualVersion,
  renderMode = "full",
}: SubtitleEditorProps) {
  // Track which preset is currently selected (null = manual/custom)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  // FFmpeg frame preview state
  const [ffmpegPreviewUrl, setFfmpegPreviewUrl] = useState<string | null>(null);
  const [ffmpegBackgroundUrl, setFfmpegBackgroundUrl] = useState<string | null>(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
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

  // Debounced FFmpeg frame preview fetch.
  //
  // Radix slider fires onValueChange continuously during drag. The CSS
  // overlay below updates immediately, while this effect refreshes the
  // expensive FFmpeg preview shortly after the user stops moving.
  useEffect(() => {
    if (!pipelineId) return;

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

  const renderLocalSubtitleOverlay = (
    dimensions: { height: number },
    className = ""
  ) => {
    const fontSize = Math.max(8, scaleSubtitlePx(settings.fontSize, dimensions.height));
    const outlineWidth = Math.max(0, scaleSubtitlePx(settings.outlineWidth, dimensions.height));
    const shadowDepth = Math.max(0, scaleSubtitlePx(settings.shadowDepth ?? 0, dimensions.height));
    const glowBlur = Math.max(0, scaleSubtitlePx(settings.glowBlur ?? 0, dimensions.height));
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
    };
    const positionStyle: CSSProperties =
      settings.positionY <= 20
        ? { top: `${settings.positionY}%` }
        : { top: `${settings.positionY}%`, transform: "translateY(-50%)" };

    return (
      <div
        className={`absolute left-2 right-2 z-[2] text-center pointer-events-none ${className}`}
        style={positionStyle}
      >
        <p className="inline-block px-2 py-1 font-semibold leading-tight" style={textStyle}>
          {previewOverlayText}
        </p>
      </div>
    );
  };

  // The preview panel rendered as a standalone block
  const previewPanel = showPreview ? (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <Label className="text-base font-semibold">Live Preview</Label>
        {isLoadingVideoInfo && (
          <span className="text-xs text-muted-foreground">Loading...</span>
        )}
      </div>

      <div className="flex justify-center">
        <div
          className="relative bg-black rounded-lg overflow-hidden border-2 border-border shadow-xl"
          style={{
            width: `${previewDimensions.width}px`,
            height: `${previewDimensions.height}px`,
          }}
        >
          {!ffmpegLoading && ffmpegPreviewUrl ? (
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
              {renderLocalSubtitleOverlay(previewDimensions)}
            </>
          ) : (
            <>
              {/* Gradient background simulating video */}
              <div className="absolute inset-0 bg-muted" />
              {renderLocalSubtitleOverlay(previewDimensions)}
            </>
          )}
          {ffmpegLoading && (
            <div className="absolute top-2 right-2">
              <Loader2 className="h-4 w-4 animate-spin text-white/60" />
            </div>
          )}
          <button
            type="button"
            onClick={() => setFullscreenOpen(true)}
            className="absolute top-2 left-2 z-10 rounded bg-black/60 hover:bg-black/80 p-1.5 text-white/80 hover:text-white transition"
            title="Expand preview"
            aria-label="Expand preview"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="max-w-[min(95vw,900px)] p-0 bg-black border-0">
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
            {!ffmpegLoading && ffmpegPreviewUrl ? (
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Info */}
      <div className="text-center space-y-1">
        <p className="text-xs text-muted-foreground">
          Font: {settings.fontSize}px | Outline: {settings.outlineWidth}px | Y: {settings.positionY}%
        </p>
        {pipelineId && (
          ffmpegPreviewUrl ? (
            <Badge variant="outline" className="text-[10px] text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
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
    <div className={`space-y-${compact ? "3" : "4"}`}>
      {/* Style Presets Section */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Style Presets</h3>
          <p className="text-xs text-muted-foreground">Click a preset to apply</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {CAPTION_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            const outlineShadow = `-1px -1px 0 ${preset.settings.outlineColor}, 1px -1px 0 ${preset.settings.outlineColor}, -1px 1px 0 ${preset.settings.outlineColor}, 1px 1px 0 ${preset.settings.outlineColor}`;
            const glowShadow = preset.settings.enableGlow && preset.settings.glowBlur
              ? `, 0 0 ${preset.settings.glowBlur}px ${preset.settings.outlineColor}`
              : "";
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className={`relative h-20 rounded-lg cursor-pointer transition-all hover:opacity-90 overflow-hidden border-2 ${
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
                      textShadow: outlineShadow + glowShadow,
                    }}
                  >
                    {preset.previewStyle.textSample}
                  </span>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-0.5">
                  <span className="text-[10px] text-white/80 font-medium">{preset.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Separator />

      {/* Style Settings */}
      {!compact && (
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Subtitle Style</h3>
        </div>
      )}

      {/* Font Size */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Font Size</Label>
          <span className="text-sm text-muted-foreground">{settings.fontSize}px</span>
        </div>
        <Slider
          value={[settings.fontSize]}
          onValueChange={([value]) => updateSetting("fontSize", value)}
          min={12}
          max={200}
          step={1}
          className="w-full"
        />
      </div>

      {/* Opacity */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Opacity</Label>
          <span className="text-sm text-muted-foreground">{settings.opacity ?? 100}%</span>
        </div>
        <Slider
          value={[settings.opacity ?? 100]}
          onValueChange={([value]) => updateSetting("opacity", value)}
          min={0}
          max={100}
          step={5}
          className="w-full"
        />
      </div>

      {/* Font Family */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Font</Label>
          {typeof window !== "undefined" && window.editFactory?.listSystemFonts && (
            <Button type="button" variant="ghost" size="sm" onClick={loadSystemFonts}>
              {systemFonts.length ? "Refresh system fonts" : "Load system fonts"}
            </Button>
          )}
        </div>
        <Select
          value={settings.fontFamily}
          onValueChange={(value) => updateSetting("fontFamily", value)}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_OPTIONS.map((font) => (
              <SelectItem
                key={font.value}
                value={font.value}
                style={{ fontFamily: font.value }}
              >
                {font.label}
              </SelectItem>
            ))}
            {systemFonts.map((family) => (
              <SelectItem key={`system-${family}`} value={family} style={{ fontFamily: family }}>
                {family} (System)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fontAccessError && <p className="text-xs text-amber-500">{fontAccessError}</p>}
        {!FONT_OPTIONS.some((font) => font.value === settings.fontFamily) &&
          systemFonts.length > 0 && !systemFonts.includes(settings.fontFamily) && (
            <p className="text-xs text-amber-500">
              Font {settings.fontFamily} is unavailable on this computer; Montserrat will be used.
            </p>
          )}
      </div>

      {/* Colors Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Text Color */}
        <ColorPicker
          label="Text Color"
          value={settings.textColor}
          onChange={(value) => updateSetting("textColor", value)}
        />

        {/* Outline Color */}
        <ColorPicker
          label="Outline Color"
          value={settings.outlineColor}
          onChange={(value) => updateSetting("outlineColor", value)}
        />
      </div>

      {/* Outline Width */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Outline Width</Label>
          <span className="text-sm text-muted-foreground">{settings.outlineWidth}px</span>
        </div>
        <Slider
          value={[settings.outlineWidth]}
          onValueChange={([value]) => updateSetting("outlineWidth", value)}
          min={0}
          max={10}
          step={1}
          className="w-full"
        />
      </div>

      {/* Position Y */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <Label>Vertical Position (Y)</Label>
          <span className="text-sm text-muted-foreground">{settings.positionY}%</span>
        </div>
        <Slider
          value={[settings.positionY]}
          onValueChange={([value]) => updateSetting("positionY", value)}
          min={5}
          max={95}
          step={1}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          0% = sus, 50% = centru, 100% = jos
        </p>
      </div>

      <Separator />

      {/* Shadow Settings */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Shadow</h4>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <Label>Shadow Depth</Label>
            <span className="text-sm text-muted-foreground">{settings.shadowDepth ?? 0}px</span>
          </div>
          <Slider
            value={[settings.shadowDepth ?? 0]}
            onValueChange={([value]) => updateSetting("shadowDepth", value)}
            min={0}
            max={4}
            step={1}
            className="w-full"
          />
        </div>

        {(settings.shadowDepth ?? 0) > 0 && (
          <ColorPicker
            label="Shadow Color"
            value={settings.shadowColor ?? "#000000"}
            onChange={(value) => updateSetting("shadowColor", value)}
          />
        )}
      </div>

      {/* Glow Settings */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Glow Effect</h4>
          <Switch
            checked={settings.enableGlow ?? false}
            onCheckedChange={(checked) => updateSetting("enableGlow", checked)}
          />
        </div>

        {settings.enableGlow && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>Glow Blur</Label>
              <span className="text-sm text-muted-foreground">{settings.glowBlur ?? 0}px</span>
            </div>
            <Slider
              value={[settings.glowBlur ?? 0]}
              onValueChange={([value]) => updateSetting("glowBlur", value)}
              min={0}
              max={10}
              step={1}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Outline becomes semi-transparent for glow effect
            </p>
          </div>
        )}
      </div>

      {/* Border Style */}
      <div className="space-y-2">
        <Label>Border Style</Label>
        <Select
          value={String(settings.borderStyle ?? 1)}
          onValueChange={(value) => updateSetting("borderStyle", Number(value))}
        >
          <SelectTrigger className="bg-muted/50">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Outline + Shadow</SelectItem>
            <SelectItem value="3">Box Background</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Adaptive Sizing */}
      <div className="flex items-center justify-between">
        <div>
          <Label>Adaptive Sizing</Label>
          <p className="text-xs text-muted-foreground">
            Auto-reduce font for long text
          </p>
        </div>
        <Switch
          checked={settings.adaptiveSizing ?? false}
          onCheckedChange={(checked) => updateSetting("adaptiveSizing", checked)}
        />
      </div>
    </div>
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
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2">
            <div
              className="w-5 h-5 rounded border"
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
                  className="w-8 h-8 rounded border-2 hover:scale-110 transition-transform"
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
