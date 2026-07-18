"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useApiUrl } from "@/hooks/use-api-url";
import { segmentFileUrl } from "@/lib/media-url";
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  Play,
  ArrowRight,
  Type,
  Volume2,
  Pause,
  RefreshCw,
  Film,
  Info,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { toast } from "sonner";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
import type { AttentionTimeline } from "@/types/attention-timeline";
import type { CompositionClip, TransitionKind, TransitionSpec } from "@/types/composition-timeline";
import { TimelineEditor, SegmentOption, InterstitialSlide } from "@/components/timeline-editor";
import { ThumbnailPicker, ThumbnailSelection } from "@/components/thumbnail-picker";
import { VariantPreviewPlayer } from "@/components/variant-preview-player";
import { RenderSettingsPanel } from "@/components/render-settings-panel";
import { SkipRenderDialog } from "@/components/dialogs/skip-render-dialog";
import {
  MatchPreview,
  PreviewData,
  PreviewKey,
  StyleKey,
  PreviewCard,
} from "../pipeline-types";
import { formatDuration, WORKSPACE_CARD_BG } from "../pipeline-utils";
import { SubtitleStylePreviewPanel } from "./subtitle-style-preview-panel";
import { WorkspaceSplit } from "./workspace-split";
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

/**
 * Timeline state contract consumed by the future CompositePreviewPlayer (F5).
 *
 * The precisely-typed fields below describe everything the Step 3 timeline
 * needs to render and edit a variant's preview: the per-variant preview data
 * (`previews`), the segment pool (`availableSegments`), interstitial slides,
 * thumbnails, the selected source videos, the stable per-key change handlers,
 * and the subtitle-style resolution helpers. Everything else stays loose
 * (`any`) via the index signature, matching the stage-2 ctx-bag pattern.
 */
type Step3Ctx = {
  previews: Record<PreviewKey, PreviewData>;
  previewCards: PreviewCard[];
  availableSegments: SegmentOption[];
  interstitialSlides: Record<PreviewKey, InterstitialSlide[]>;
  EMPTY_SLIDES: InterstitialSlide[];
  variantThumbnails: Record<PreviewKey, ThumbnailSelection>;
  setVariantThumbnails: Dispatch<SetStateAction<Record<PreviewKey, ThumbnailSelection>>>;
  selectedSourceIdsArray: string[];
  getMatchesChangeHandler: (previewKey: string) => (matches: MatchPreview[]) => void;
  getVideoTimelineChangeHandler: (previewKey: string) => (timeline: CompositionClip[]) => void;
  getDefaultTransitionChangeHandler: (previewKey: string) => (spec: TransitionSpec | null) => void;
  getInterstitialSlidesChangeHandler: (previewKey: string) => (slides: InterstitialSlide[]) => void;
  attentionTimelines: Record<PreviewKey, AttentionTimeline>;
  getAttentionTimelineChangeHandler: (previewKey: string) => (timeline: AttentionTimeline) => void;
  getPreviewSubtitleSettingsFor: (card: Pick<PreviewCard, "visualVersion">) => SubtitleSettings;
  getSubtitleSettingsFor: (styleKey: StyleKey) => SubtitleSettings;
  subtitleSettings: SubtitleSettings;
  subtitleOverrides: Partial<Record<StyleKey, SubtitleSettings>>;
  setSubtitleOverrides: Dispatch<SetStateAction<Partial<Record<StyleKey, SubtitleSettings>>>>;
  activeStyleKey: StyleKey;
  selectedVariants: Set<number>;
  userSubtitlePresets: UserSubtitlePreset[];
  setUserSubtitlePresets: Dispatch<SetStateAction<UserSubtitlePreset[]>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step3Preview({ ctx }: { ctx: any }) {
  const mediaApiUrl = useApiUrl();
  const {
    previewCards,
    selectedVariants,
    setStep,
    presetName,
    setPresetName,
    subtitleSettingsLoaded,
    metaMultiplication,
    subtitleSaveState,
    activeStyleKey,
    setActiveStyleKey,
    handleCopyVariantSubtitle,
    handleResetVariantSubtitle,
    savePresetDialogOpen,
    setSavePresetDialogOpen,
    userSubtitlePresets,
    setUserSubtitlePresets,
    subtitleOverrides,
    currentProfileIdRef,
    pipelineId,
    getSubtitleSettingsFor,
    getStylePreviewText,
    handleVariantSubtitleChange,
    previews,
    toggleVariant,
    handlePlayAudio,
    playingAudio,
    setPlayingAudio,
    audioRef,
    previewVariant,
    setPreviewVariant,
    handleRegenerateVariantAudio,
    regeneratingVariantAudio,
    variantThumbnails,
    setVariantThumbnails,
    thumbnailPickerKey,
    setThumbnailPickerKey,
    selectedSourceIdsArray,
    availableSegments,
    currentProfile,
    getPreviewSubtitleSettingsFor,
    interstitialSlides,
    attentionTimelines,
    EMPTY_SLIDES,
    getInterstitialSlidesChangeHandler,
    getAttentionTimelineChangeHandler,
    getMatchesChangeHandler,
    getVideoTimelineChangeHandler,
    getDefaultTransitionChangeHandler,
    buildPipOverlaysForMatches,
    handlePreviewPlayerClose,
    minSegmentDuration,
    setMinSegmentDuration,
    wordsPerSubtitle,
    ultraRapidIntro,
    setUltraRapidIntro,
    assemblyPreset,
    setAssemblyPreset,
    renderAdjust,
    setRenderAdjust,
    scheduleReassemblePreviews,
    savePresetName,
    setSavePresetName,
    savePresetError,
    setSavePresetError,
    savePresetSubmitting,
    handleSubmitSavePreset,
    previewError,
    renderSettings,
    setRenderSettings,
    existingRenderCount,
    setMetaMultiplication,
    scripts,
    setVariantStatuses,
    setIsRendering,
    handleRenderClick,
    isRendering,
    isCheckingRender,
    skipCheckResults,
    setSkipCheckResults,
    showSkipDialog,
    setShowSkipDialog,
    handleRender,
  }: Step3Ctx = ctx;

  // Which variant's full-screen editor modal is open (card.key), or null.
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);

  // Confine the maximized editor to the app work area (below the workspace
  // titlebar, right of the settings sidebar) instead of the whole screen.
  // Measuring <main> handles every mode for free — desktop titlebar or not,
  // sidebar collapsed/expanded, mobile — since <main> already starts past both.
  const [maximizedBounds, setMaximizedBounds] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);
  useEffect(() => {
    if (maximizedKey === null) return;
    const main = document.querySelector("main");
    if (!main) return;
    const measure = () => {
      const r = main.getBoundingClientRect();
      setMaximizedBounds({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [maximizedKey]);

  const previewProxySourceIdsKey = useMemo(() => Array.from(new Set(
    previewCards.flatMap((card) =>
      (previews[card.key]?.matches ?? [])
        .map((match) => match.source_video_id)
        .filter((sourceVideoId): sourceVideoId is string => Boolean(sourceVideoId))
    )
  )).sort().join(","), [previewCards, previews]);

  // This component only mounts while the workflow is in Step 3. Trigger proxy
  // generation now so seek-friendly media can be ready before Preview is played.
  useEffect(() => {
    if (!currentProfile?.id || !previewProxySourceIdsKey) return;

    const controller = new AbortController();
    apiPost(
      "/segments/source-videos/preview-proxies",
      { video_ids: previewProxySourceIdsKey.split(",") },
      { signal: controller.signal }
    ).catch((error) => {
      if (!controller.signal.aborted) {
        console.warn("[Step3Preview] Failed to start eager preview proxies", error);
      }
    });

    return () => controller.abort();
  }, [currentProfile?.id, previewProxySourceIdsKey]);

  const openRenderedPreview = (previewKey: PreviewKey) => {
    // The FFmpeg preview owns its rendered audio track. Stop the standalone
    // voice-over first so two variants cannot play over each other.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingAudio(null);
    setPreviewVariant(previewKey);
  };

  const activeSubtitleStyleKey: StyleKey = metaMultiplication
    ? activeStyleKey === "B" ? "B" : "A"
    : "default";
  const activeSubtitleStyleHasOverride = Boolean(
    subtitleOverrides[activeSubtitleStyleKey]
      && Object.keys(subtitleOverrides[activeSubtitleStyleKey] ?? {}).length > 0
  );
  const assemblyPresetHelp = ({
    keyword_strict: "Only uses clips whose keywords match the phrase, leaving uncertain phrases unmatched.",
    balanced: "Prefers keyword matches and safely rotates through the remaining footage.",
    max_variety: "Spreads usage across the full clip pool, including keyword matches.",
    shuffle: "Randomizes clip assignment per variant for stronger A/B variation.",
    ai_smart: "Uses Gemini to choose the best-fitting clip and falls back to keyword matching.",
  } as Record<string, string>)[String(assemblyPreset)] ?? "Controls how clips are assigned to phrases.";

  return (
          <div className="space-y-3 min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col min-[1280px]:gap-0 min-[1280px]:space-y-0">
            <div className="flex shrink-0 items-center justify-between min-[1280px]:hidden">
              {/* "Back to Scripts" lives in the pipeline toolbar; don't repeat it here. */}
              <div>
                <h2 className="font-heading text-2xl font-semibold">Preview & Select Variants</h2>
                <p className="text-sm text-muted-foreground">
                  {previewCards.filter(card => selectedVariants.has(card.baseIndex)).length} previews shown
                </p>
              </div>
            </div>

            {/*
              Step 3 is an editing workspace, not a sequence of form cards.
              Keep the controls in a persistent left inspector and leave the
              right-hand canvas for the variant timelines and previews.
            */}
            <WorkspaceSplit
              splitId="step3"
              fallbackClassName="grid items-start gap-3 min-[1180px]:grid-cols-[minmax(22rem,0.82fr)_minmax(0,1.6fr)] min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:items-stretch min-[1280px]:gap-px min-[1280px]:bg-border"
              groupClassName="h-auto min-h-0 flex-1"
              leftSizing={{ defaultSize: "34%", minSize: "18rem" }}
              rightSizing={{ minSize: "30%" }}
            >
              <aside
                className="flex min-w-0 flex-col gap-3 bg-background min-[1180px]:sticky min-[1180px]:top-4 min-[1280px]:static min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:gap-px min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain min-[1280px]:bg-border"
                data-testid="step3-inspector"
              >
            {/* Assembly controls affect clip selection, not final-file rendering. */}
            <Card
              className={`order-2 min-[1280px]:gap-3 min-[1280px]:rounded-none min-[1280px]:border-0 min-[1280px]:py-3 ${WORKSPACE_CARD_BG}`}
              data-testid="step3-assembly-settings"
            >
              <CardHeader className="min-[1280px]:px-4">
                <CardTitle className="text-lg">Assembly Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 min-[1280px]:px-4">
                {/* Assembly controls — how library segments get auto-assigned to phrases */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="assembly-preset">Assembly Preset</Label>
                    <InlineInfo label="About assembly presets">
                      {assemblyPresetHelp}
                    </InlineInfo>
                  </div>
                  <Select
                    value={assemblyPreset}
                    onValueChange={(v) => {
                      setAssemblyPreset(v as typeof assemblyPreset);
                      scheduleReassemblePreviews();
                    }}
                  >
                    <SelectTrigger id="assembly-preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keyword_strict" title="Only use segments whose keywords match the phrase — leaves phrases unmatched rather than guessing">
                        Keyword strict
                      </SelectItem>
                      <SelectItem value="balanced" title="Match by keyword when possible, fall back to rotation for the rest — the default">
                        Balanced
                      </SelectItem>
                      <SelectItem value="max_variety" title="Favor spreading usage across the whole segment pool, even for keyword matches">
                        Max variety
                      </SelectItem>
                      <SelectItem value="shuffle" title="Randomize segment assignment per variant, for maximum A/B difference">
                        Shuffle per variant
                      </SelectItem>
                      <SelectItem value="ai_smart" title="Gemini reads each phrase and picks the best-fitting segment from your library — falls back to keyword matching if AI is unavailable">
                        AI smart match
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="pacing">Pacing</Label>
                    <InlineInfo label="About pacing">
                      Choose how quickly the visual cuts change.
                    </InlineInfo>
                  </div>
                  <Select
                    value={String(minSegmentDuration)}
                    onValueChange={(value) => {
                      setMinSegmentDuration(Number(value));
                      scheduleReassemblePreviews();
                    }}
                  >
                    <SelectTrigger id="pacing" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">Fast (2s)</SelectItem>
                      <SelectItem value="3">Normal (3s)</SelectItem>
                      <SelectItem value="5">Slow (5s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-1">
                    <Label htmlFor="rapid-intro">Rapid intro (2s)</Label>
                    <InlineInfo label="About rapid intro">
                      Force the first shot to a snappy 2-second cut regardless of min shot length.
                    </InlineInfo>
                  </div>
                  <Switch
                    id="rapid-intro"
                    checked={ultraRapidIntro}
                    onCheckedChange={(checked) => {
                      setUltraRapidIntro(checked);
                      scheduleReassemblePreviews();
                    }}
                  />
                </div>
                </div>

              </CardContent>
            </Card>

            {/* Subtitle Style — one useful preview, switched between Meta versions. */}
            <Card className={`${!subtitleSettingsLoaded ? "opacity-60 pointer-events-none" : ""} order-1 min-[1280px]:gap-3 min-[1280px]:rounded-none min-[1280px]:border-0 min-[1280px]:py-3 ${WORKSPACE_CARD_BG}`}>
              <CardHeader className="pb-4 min-[1280px]:px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Type className="size-4" />
                      Subtitle Style
                      {!subtitleSettingsLoaded && <Loader2 className="size-3 animate-spin" />}
                    </CardTitle>
                    <InlineInfo label="About subtitle styles">
                      {metaMultiplication
                        ? "Switch between A and B to preview and edit each platform style. Changes are saved automatically and shared across all scripts."
                        : "This style applies to every variant in the pipeline and is saved automatically."}
                    </InlineInfo>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
                  {subtitleSaveState === "saving" && (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      <span>Saving…</span>
                    </>
                  )}
                  {subtitleSaveState === "saved" && (
                    <>
                      <CheckCircle className="size-3 text-success" />
                      <span>Saved</span>
                    </>
                  )}
                  {subtitleSaveState === "error" && (
                    <>
                      <AlertCircle className="size-3 text-red-600" />
                      <span className="text-red-600">Save failed</span>
                    </>
                  )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 min-[1280px]:px-4">
                {metaMultiplication && (
                  <div
                    role="tablist"
                    aria-label="Subtitle version"
                    className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1"
                    data-testid="subtitle-version-switch"
                  >
                    {(["A", "B"] as const).map((styleKey) => {
                      const isSelected = activeSubtitleStyleKey === styleKey;
                      const platform = styleKey === "A" ? "Instagram" : "Facebook";
                      return (
                        <Button
                          key={styleKey}
                          type="button"
                          role="tab"
                          aria-selected={isSelected}
                          aria-controls="subtitle-style-preview"
                          variant={isSelected ? "default" : "ghost"}
                          size="sm"
                          className="h-9 gap-2"
                          onClick={() => setActiveStyleKey(styleKey)}
                        >
                          <span className="font-semibold">{styleKey}</span>
                          <span className={isSelected ? "opacity-80" : "text-muted-foreground"}>
                            {platform}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                )}

                {/* Auxiliary controls for the active tab */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Copy from the other Meta version (only when Meta ON) */}
                  {metaMultiplication && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        const source: StyleKey = activeSubtitleStyleKey === "A" ? "B" : "A";
                        handleCopyVariantSubtitle(source, activeSubtitleStyleKey);
                      }}
                    >
                      Copy from {activeSubtitleStyleKey === "A" ? "B" : "A"}
                    </Button>
                  )}

                  {/* Reset to default — only meaningful when override exists */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!activeSubtitleStyleHasOverride}
                    onClick={() => handleResetVariantSubtitle(activeSubtitleStyleKey)}
                  >
                    Reset to default
                  </Button>

                  {/* Save current as named preset */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setSavePresetDialogOpen(true)}
                  >
                    Save as preset
                  </Button>
                </div>

                <div className="space-y-4">
                  <div
                    id="subtitle-style-preview"
                    role="tabpanel"
                    className="sticky top-0 z-10 bg-card pb-1"
                    data-testid="subtitle-sticky-preview"
                  >
                    <SubtitleStylePreviewPanel
                      key={activeSubtitleStyleKey}
                      styleKey={activeSubtitleStyleKey}
                      settings={getSubtitleSettingsFor(activeSubtitleStyleKey)}
                      hasOverride={activeSubtitleStyleHasOverride}
                      pipelineId={pipelineId ?? undefined}
                      previewCards={previewCards}
                      previewText={getStylePreviewText(activeSubtitleStyleKey)}
                    />
                  </div>

                  <div
                    data-testid="subtitle-style-variant-editor"
                  >
                    <SubtitleEditor
                      renderMode="settings-only"
                      settings={getSubtitleSettingsFor(activeSubtitleStyleKey)}
                      onSettingsChange={(newSettings) =>
                        handleVariantSubtitleChange(activeSubtitleStyleKey, newSettings)
                      }
                      showPreview={false}
                      compact={true}
                      userPresets={userSubtitlePresets}
                      onApplyUserPreset={(preset) => {
                        const presetSettings =
                          activeSubtitleStyleKey === "A"
                            ? preset.settingsA ?? preset.settings
                            : activeSubtitleStyleKey === "B"
                              ? preset.settingsB ?? preset.settings
                              : preset.settings;
                        const merged = mergeSubtitleStylePreservingPlacement(
                          getSubtitleSettingsFor(activeSubtitleStyleKey),
                          presetSettings,
                        );
                        handleVariantSubtitleChange(activeSubtitleStyleKey, merged);
                      }}
                      onDeleteUserPreset={async (preset) => {
                        const profileId = currentProfileIdRef.current;
                        if (!profileId) return;
                        try { await apiDelete(`/profiles/${profileId}/subtitle-presets/${preset.id}`); setUserSubtitlePresets((prev) => prev.filter((item) => item.id !== preset.id)); } catch (err) { console.error("Failed to delete preset:", err); }
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

              </aside>

              <section
                className="min-w-0 space-y-3 bg-background min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:space-y-0 min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain min-[1280px]:[&>[data-slot=card]]:gap-3 min-[1280px]:[&>[data-slot=card]]:rounded-none min-[1280px]:[&>[data-slot=card]]:border-0 min-[1280px]:[&>[data-slot=card]]:py-3 min-[1280px]:[&>[data-slot=card]>[data-slot=card-header]]:px-4 min-[1280px]:[&>[data-slot=card]>[data-slot=card-content]]:px-4"
                aria-label="Variant previews"
                data-testid="step3-variant-canvas"
              >
                <header
                  className="sticky top-0 z-10 hidden h-14 items-center border-b bg-background px-4 min-[1280px]:flex"
                  data-testid="step3-variant-header"
                >
                  <h2 className="flex items-center gap-2 text-sm font-semibold leading-none">
                    <Film className="size-4" />
                    Variant Previews
                  </h2>
                </header>

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 gap-3 min-[1280px]:gap-px min-[1280px]:bg-border min-[1480px]:grid-cols-2">
              {previewCards.map((card) => {
                const preview = previews[card.key];
                if (!preview) return null;

                return (
                  <Card key={card.key} className={`overflow-hidden min-[1280px]:gap-3 min-[1280px]:rounded-none min-[1280px]:border-0 min-[1280px]:py-3 ${WORKSPACE_CARD_BG}`}>
                    <CardHeader className="min-[1280px]:px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedVariants.has(card.baseIndex)}
                            onCheckedChange={() => toggleVariant(card.baseIndex)}
                          />
                          <CardTitle className="text-lg">
                            {card.label}
                            {card.metaPlatform && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {card.metaPlatform === "instagram" ? "Instagram" : "Facebook"}
                              </Badge>
                            )}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => pipelineId && handlePlayAudio(pipelineId, card.baseIndex)}
                            title={playingAudio === `${pipelineId}-${card.baseIndex}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${card.baseIndex}` ? (
                              <Pause className="size-4" />
                            ) : (
                              <Volume2 className="size-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => setMaximizedKey(card.key)}
                            title="Maximize editor — full-screen timeline for this variant"
                          >
                            <Maximize2 className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleRegenerateVariantAudio(card.baseIndex, card.key, card.visualVersion)}
                            disabled={regeneratingVariantAudio[card.baseIndex]}
                            title="Regenerate voiceover"
                          >
                            {regeneratingVariantAudio[card.baseIndex] ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <RefreshCw className="size-4" />
                            )}
                          </Button>
                          <Badge variant="secondary">
                            {formatDuration(preview.audio_duration)}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 min-[1280px]:px-4">
                      {preview.variety_warning && (
                        <Alert className="border-amber-500/50 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                          <AlertCircle className="size-4 text-amber-600" />
                          <AlertDescription>{preview.variety_warning.message}</AlertDescription>
                        </Alert>
                      )}
                      {/* Thumbnail selector (becomes first frame of rendered video) */}
                      {(() => {
                        const thumb = variantThumbnails[card.key];
                        const thumbUrl = thumb
                          ? segmentFileUrl(mediaApiUrl, thumb.imageUrl)
                          : null;
                        return (
                          <div className="flex items-center gap-3 pb-2 border-b">
                            {thumbUrl ? (
                              <button
                                onClick={() => setThumbnailPickerKey(card.key)}
                                className={`w-[54px] h-[96px] rounded overflow-hidden border-2 flex-shrink-0 hover:opacity-80 transition-opacity ${
                                  thumb?.isAutoSelected ? "border-border" : "border-primary"
                                }`}
                                title="Click to change thumbnail"
                              >
                                <img src={thumbUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                              </button>
                            ) : (
                              <div
                                onClick={() => setThumbnailPickerKey(card.key)}
                                className="w-[54px] h-[96px] rounded bg-muted border-2 border-dashed border-muted-foreground/30 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 flex-shrink-0"
                              >
                                <Film className="size-4 text-muted-foreground" />
                              </div>
                            )}
                            <div className="flex flex-col gap-1">
                              <span className="text-xs font-medium">Thumbnail</span>
                              <span className="text-xs text-muted-foreground">
                                {thumb ? (thumb.isAutoSelected ? "auto-selected" : "manual") : "none"}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs px-2 w-fit"
                                onClick={() => setThumbnailPickerKey(card.key)}
                              >
                                Change
                              </Button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Transitions V1: this variant's default transition, applied to
                          every body-clip boundary unless a boundary has its own override. */}
                      {(() => {
                        const spec = preview.defaultTransition ?? null;
                        const setSpec = getDefaultTransitionChangeHandler(card.key);
                        return (
                          <div className="flex items-center justify-between gap-4 pb-2 border-b">
                            <div className="flex items-center gap-1">
                              <Label htmlFor={`default-transition-${card.key}`}>Default transition</Label>
                              <InlineInfo label="About default transition">
                                Applied to every cut between clips in this variant, unless a boundary marker on the timeline overrides it.
                              </InlineInfo>
                            </div>
                            <div className="flex items-center gap-2">
                              <Select
                                value={spec?.kind ?? "none"}
                                onValueChange={(value) => {
                                  if (value === "none") { setSpec(null); return; }
                                  const kind = value as TransitionKind;
                                  setSpec({
                                    kind,
                                    durationMs: spec?.kind === kind ? spec.durationMs : kind === "flash_white" ? 200 : 350,
                                  });
                                }}
                              >
                                <SelectTrigger id={`default-transition-${card.key}`} className="w-36">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  <SelectItem value="dip_black">Dip to black</SelectItem>
                                  <SelectItem value="flash_white">Flash white</SelectItem>
                                </SelectContent>
                              </Select>
                              {spec && (
                                <Select
                                  value={String(spec.durationMs)}
                                  onValueChange={(value) => setSpec({ kind: spec.kind, durationMs: Number(value) })}
                                >
                                  <SelectTrigger className="w-28" aria-label="Transition duration">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="200">Fast</SelectItem>
                                    <SelectItem value="350">Normal</SelectItem>
                                    <SelectItem value="500">Slow</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Full timeline editor — uses this variant's effective subtitle style */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        introOffsetSec={preview.intro_offset_sec ?? 0}
                        introSegments={preview.intro_segments ?? []}
                        videoTimeline={preview.video_timeline ?? []}
                        sourceVideoIds={selectedSourceIdsArray}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={card.baseIndex}
                        subtitleSettings={getPreviewSubtitleSettingsFor(card)}
                        interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                        onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                        attentionTimeline={attentionTimelines[card.key] ?? { revision: 0, cues: [] }}
                        onAttentionTimelineChange={getAttentionTimelineChangeHandler(card.key)}
                        onMatchesChange={getMatchesChangeHandler(card.key)}
                        onVideoTimelineChange={getVideoTimelineChangeHandler(card.key)}
                        defaultTransition={preview.defaultTransition ?? null}
                        onDefaultTransitionChange={getDefaultTransitionChangeHandler(card.key)}
                        onRenderPreview={() => openRenderedPreview(card.key)}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Thumbnail picker dialog */}
            <ThumbnailPicker
              open={thumbnailPickerKey !== null}
              onOpenChange={(open) => { if (!open) setThumbnailPickerKey(null); }}
              currentThumbnail={thumbnailPickerKey ? variantThumbnails[thumbnailPickerKey] ?? null : null}
              matchedSegments={thumbnailPickerKey ? (previews[thumbnailPickerKey]?.matches ?? []) : []}
              usedImageUrls={new Set(
                Object.entries(variantThumbnails)
                  .filter(([key]) => key !== thumbnailPickerKey)
                  .map(([, sel]) => sel.imageUrl)
              )}
              onSelect={(segmentId, imageUrl) => {
                if (!thumbnailPickerKey) return;
                setVariantThumbnails(prev => ({
                  ...prev,
                  [thumbnailPickerKey]: { segmentId, imageUrl, isAutoSelected: false },
                }));
              }}
              onResetAuto={() => {
                if (!thumbnailPickerKey) return;
                // Clear manual selection — useEffect will re-auto-select
                setVariantThumbnails(prev => {
                  const next = { ...prev };
                  delete next[thumbnailPickerKey];
                  return next;
                });
              }}
            />

            {/* Variant preview player dialog */}
            {previewVariant !== null && pipelineId && currentProfile && (() => {
              const activeCard = previewCards.find(card => card.key === previewVariant);
              if (!activeCard) return null;
              // Match the render-time precedence rule: when the user has set
              // an explicit subtitle override for this Meta version, suppress
              // the visualVersion so the preview backend does NOT layer the
              // Meta profile on top. Otherwise the preview would show the
              // overlay while the final render does not — visible divergence.
              const _previewPipOverlays = buildPipOverlaysForMatches(previews[previewVariant]?.matches);
              return (
                <VariantPreviewPlayer
                  open={true}
                  onOpenChange={handlePreviewPlayerClose}
                  matches={previews[previewVariant]?.matches ?? []}
                  videoTimeline={previews[previewVariant]?.video_timeline ?? []}
                  defaultTransition={previews[previewVariant]?.defaultTransition ?? null}
                  pipelineId={pipelineId}
                  variantIndex={activeCard.baseIndex}
                  visualVersion={activeCard.visualVersion}
                  title={activeCard.label}
                  profileId={currentProfile.id}
                  subtitleSettings={getPreviewSubtitleSettingsFor(activeCard)}
                  applyMetaSubtitleStyle={false}
                  sourceVideoIds={selectedSourceIdsArray}
                  minSegmentDuration={minSegmentDuration}
                  wordsPerSubtitle={wordsPerSubtitle}
                  ultraRapidIntro={ultraRapidIntro}
                  interstitialSlides={interstitialSlides[previewVariant]}
                  attentionTimeline={attentionTimelines[previewVariant]}
                  pipOverlays={Object.keys(_previewPipOverlays).length > 0 ? _previewPipOverlays : undefined}
                  enableColor={renderAdjust.enableColor}
                  brightness={renderAdjust.brightness}
                  contrast={renderAdjust.contrast}
                  saturation={renderAdjust.saturation}
                  voiceVolume={renderAdjust.voiceVolume}
                  audioFadeIn={renderAdjust.audioFadeIn}
                  audioFadeOut={renderAdjust.audioFadeOut}
                />
              );
            })()}

            {/* The full editor must be a real modal surface. Keeping it inside
                the right workspace panel leaves the two card editors painted
                underneath it; their sticky lane headers use z-30 and can rise
                above a panel-local overlay. Dialog portals the active editor
                above the whole application and also owns focus, Escape, and
                scroll locking while the variant is maximized. */}
            {maximizedKey !== null && (() => {
              const card = previewCards.find((c) => c.key === maximizedKey);
              const preview = card ? previews[card.key] : null;
              if (!card || !preview) return null;
              return (
                <Dialog open onOpenChange={(open) => { if (!open) setMaximizedKey(null); }}>
                  <DialogContent
                    showCloseButton={false}
                    style={maximizedBounds ?? undefined}
                    className="flex max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-none"
                    data-testid="step3-full-editor"
                  >
                    <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <DialogTitle className="flex items-center gap-2 text-sm">
                          <Film className="size-4" />
                          <span>{card.label} — Full Editor</span>
                          {card.metaPlatform && (
                            <Badge variant="outline" className="text-xs">
                              {card.metaPlatform === "instagram" ? "Instagram" : "Facebook"}
                            </Badge>
                          )}
                        </DialogTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          onClick={() => setMaximizedKey(null)}
                          title="Minimize editor — back to the variant cards"
                        >
                          <Minimize2 className="size-4" />
                          <span className="sr-only">Minimize editor</span>
                        </Button>
                      </div>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <TimelineEditor
                        displayMode="full"
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        introOffsetSec={preview.intro_offset_sec ?? 0}
                        introSegments={preview.intro_segments ?? []}
                        videoTimeline={preview.video_timeline ?? []}
                        sourceVideoIds={selectedSourceIdsArray}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={card.baseIndex}
                        subtitleSettings={getPreviewSubtitleSettingsFor(card)}
                        interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                        onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                        attentionTimeline={attentionTimelines[card.key] ?? { revision: 0, cues: [] }}
                        onAttentionTimelineChange={getAttentionTimelineChangeHandler(card.key)}
                        onMatchesChange={getMatchesChangeHandler(card.key)}
                        onVideoTimelineChange={getVideoTimelineChangeHandler(card.key)}
                        defaultTransition={preview.defaultTransition ?? null}
                        onDefaultTransitionChange={getDefaultTransitionChangeHandler(card.key)}
                        onRenderPreview={() => openRenderedPreview(card.key)}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              );
            })()}

            {/* "Save as preset" dialog — captures shared default + any A/B overrides. */}
            <Dialog
              open={savePresetDialogOpen}
              onOpenChange={(open) => {
                setSavePresetDialogOpen(open);
                if (!open) {
                  setSavePresetName("");
                  setSavePresetError(null);
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Save subtitle preset</DialogTitle>
                  <DialogDescription>
                    Saves the shared default plus any explicit Meta A / Meta B
                    overrides. Applying the preset restores all of them at once.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div>
                    <Label htmlFor="preset-name-input" className="text-sm">Preset name</Label>
                    <Input
                      id="preset-name-input"
                      value={savePresetName}
                      onChange={(e) => {
                        setSavePresetName(e.target.value);
                        if (savePresetError) setSavePresetError(null);
                      }}
                      placeholder="e.g. Aggressive Red"
                      maxLength={80}
                      disabled={savePresetSubmitting}
                      className="mt-1"
                      autoFocus
                    />
                  </div>
                  {savePresetError && (
                    <Alert variant="destructive">
                      <AlertCircle className="size-4" />
                      <AlertDescription>{savePresetError}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setSavePresetDialogOpen(false)}
                    disabled={savePresetSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmitSavePreset}
                    disabled={savePresetSubmitting || !savePresetName.trim()}
                  >
                    {savePresetSubmitting && <Loader2 className="size-4 mr-2 animate-spin" />}
                    Save preset
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Render settings */}
            <RenderSettingsPanel
              settings={renderSettings}
              onChange={setRenderSettings}
              presetName={presetName}
              onPresetNameChange={setPresetName}
              adjustments={renderAdjust}
              onAdjustmentsChange={setRenderAdjust}
            />

            {/* Continue to existing renders (same pattern as Step 2's "already generated") */}
            {existingRenderCount > 0 && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const res = await apiGet(`/pipeline/status/${pipelineId}`);
                    const data = await res.json();
                    if (!data?.variants) return;
                    setMetaMultiplication(Boolean(data.meta_multiplication || (data.meta_variants?.length ?? 0) > 0));
                    const currentScriptCount = scripts.length;
                    const allVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
                    let rendered = allVars.filter(
                      (v: { status: string; variant_index: number; final_video_path?: string }) =>
                        v.status === "completed" &&
                        v.final_video_path &&
                        v.variant_index < currentScriptCount
                    );
                    // Auto-recover: if any completed variants failed library save, retry sync
                    const hasUnsaved = rendered.some((v: { library_saved?: boolean }) => v.library_saved === false);
                    if (hasUnsaved && pipelineId) {
                      try {
                        await apiPost(`/pipeline/sync-to-library/${pipelineId}`);
                        const res2 = await apiGet(`/pipeline/status/${pipelineId}`);
                        const data2 = await res2.json();
                        if (data2?.variants) {
                          const allVars2 = (data2.meta_variants?.length > 0 ? data2.meta_variants : data2.variants) || [];
                          rendered = allVars2.filter(
                            (v: { status: string; variant_index: number; final_video_path?: string }) =>
                              v.status === "completed" &&
                              v.final_video_path &&
                              v.variant_index < currentScriptCount
                          );
                        }
                      } catch {
                        // Sync failed — continue with original data, user can retry manually
                      }
                    }
                    setVariantStatuses(rendered);
                    setIsRendering(false);
                    setStep(4);
                  } catch {
                    toast.error("Failed to load existing renders");
                  }
                }}
                className="w-full"
                size="lg"
              >
                <ArrowRight className="size-4 mr-2" />
                Continue to Render Results (already rendered)
              </Button>
            )}

            {/* Render button */}
            <Button
              variant="cta"
              onClick={handleRenderClick}
              disabled={isRendering || isCheckingRender || selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              {isCheckingRender ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Play className="size-4 mr-2" />
              )}
              {isCheckingRender ? "Se verifica..." : isRendering ? "Rendering..." : `Render Selected (${selectedVariants.size}${metaMultiplication ? ` × 2 = ${selectedVariants.size * 2}` : ""})`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Free — renders on your machine
            </p>

            {/* Skip render dialog */}
            {skipCheckResults && (
              <SkipRenderDialog
                open={showSkipDialog}
                onClose={() => { setShowSkipDialog(false); setSkipCheckResults(null); }}
                checkResults={skipCheckResults}
                onConfirm={(skipVars) => handleRender(skipVars)}
              />
            )}
              </section>
            </WorkspaceSplit>
          </div>
  );
}

function InlineInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/info relative inline-flex items-center">
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 w-64 rounded-md border bg-popover px-3 py-2 text-xs font-normal leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/info:opacity-100 group-focus-within/info:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

function mergeSubtitleStylePreservingPlacement(
  currentSettings: SubtitleSettings,
  nextSettings: SubtitleSettings
): SubtitleSettings {
  return {
    ...currentSettings,
    ...nextSettings,
    positionY: currentSettings.positionY,
    position: currentSettings.position,
    marginV: currentSettings.marginV,
  };
}
