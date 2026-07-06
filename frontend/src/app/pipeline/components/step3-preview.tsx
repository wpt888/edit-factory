"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiGet, apiPost, apiDelete, API_URL } from "@/lib/api";
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  ArrowLeft,
  ArrowRight,
  Type,
  Trash2,
  Volume2,
  Pause,
  Eye,
  RefreshCw,
  Film,
} from "lucide-react";
import { toast } from "sonner";
import { SubtitleEditor } from "@/components/video-processing/subtitle-editor";
import { SubtitleSettings, UserSubtitlePreset } from "@/types/video-processing";
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
  toStyleKey,
  PreviewCard,
} from "../pipeline-types";
import { formatDuration } from "../pipeline-utils";
import { SubtitleStylePreviewPanel } from "./subtitle-style-preview-panel";
import type { Dispatch, SetStateAction } from "react";

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
  getInterstitialSlidesChangeHandler: (previewKey: string) => (slides: InterstitialSlide[]) => void;
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
  const {
    previewCards,
    selectedVariants,
    setStep,
    setPreviewError,
    presetName,
    setPresetName,
    subtitleSettingsLoaded,
    metaMultiplication,
    subtitleSaveState,
    activeStyleKey,
    setActiveStyleKey,
    handleCopyVariantSubtitle,
    activeStyleHasOverride,
    handleResetVariantSubtitle,
    savePresetDialogOpen,
    setSavePresetDialogOpen,
    userSubtitlePresets,
    setUserSubtitlePresets,
    subtitleSettings,
    setSubtitleSettings,
    scheduleProfileSubtitleSave,
    subtitleOverrides,
    setSubtitleOverrides,
    scheduleOverridesSave,
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
    EMPTY_SLIDES,
    getInterstitialSlidesChangeHandler,
    getMatchesChangeHandler,
    buildPipOverlaysForMatches,
    handlePreviewPlayerClose,
    minSegmentDuration,
    wordsPerSubtitle,
    ultraRapidIntro,
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
  return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">
                Preview & Select Variants ({previewCards.filter(card => selectedVariants.has(card.baseIndex)).length} previews shown)
              </h2>
              <Button variant="outline" onClick={() => { setStep(2); setPreviewError(null); }}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Scripts
              </Button>
            </div>

            {/* Preset selector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Render Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="preset">Export Preset</Label>
                  <Select value={presetName} onValueChange={setPresetName}>
                    <SelectTrigger id="preset">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TikTok">TikTok (1080x1920)</SelectItem>
                      <SelectItem value="Instagram Reels">
                        Instagram Reels (1080x1920)
                      </SelectItem>
                      <SelectItem value="YouTube Shorts">
                        YouTube Shorts (1080x1920)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Subtitle Style — per-Meta-version editor.
                Meta OFF: one panel, one preview, no tabs.
                Meta ON:  two tabs (A/B), two always-on previews, one active settings panel. */}
            <Card className={!subtitleSettingsLoaded ? "opacity-60 pointer-events-none" : ""}>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Type className="h-4 w-4" />
                  Subtitle Style
                  {!subtitleSettingsLoaded && <Loader2 className="h-3 w-3 animate-spin" />}
                </CardTitle>
                <CardDescription>
                  {metaMultiplication
                    ? "Pick A or B — each Meta version has its own style, shared across all scripts. Both live previews stay visible so you can compare A and B as you edit."
                    : "Customize subtitles once — the style applies to every variant in this pipeline."}
                </CardDescription>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {subtitleSaveState === "saving" && (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Saving automatically…</span>
                    </>
                  )}
                  {subtitleSaveState === "saved" && (
                    <>
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span>Saved automatically. This style will remain available for the next pipeline too.</span>
                    </>
                  )}
                  {subtitleSaveState === "error" && (
                    <>
                      <AlertCircle className="h-3 w-3 text-red-600" />
                      <span>Save failed. The changes are still visible here, but they were not confirmed on the server yet.</span>
                    </>
                  )}
                  {subtitleSaveState === "idle" && (
                    <span>Every subtitle edit is saved automatically. No manual save is required.</span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Auxiliary controls for the active tab */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Copy from the other Meta version (only when Meta ON) */}
                  {metaMultiplication && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => {
                        const source: StyleKey = activeStyleKey === "A" ? "B" : "A";
                        handleCopyVariantSubtitle(source, activeStyleKey);
                      }}
                    >
                      Copy from {activeStyleKey === "A" ? "B" : "A"}
                    </Button>
                  )}

                  {/* Reset to default — only meaningful when override exists */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!activeStyleHasOverride}
                    onClick={() => handleResetVariantSubtitle(activeStyleKey)}
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

                  {/* Apply existing preset */}
                  {userSubtitlePresets.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 text-xs">
                          Apply preset…
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
                        {userSubtitlePresets.map(preset => (
                          <DropdownMenuItem
                            key={preset.id}
                            className="flex items-center justify-between gap-2"
                            onClick={() => {
                              // Apply the whole preset: shared default plus any
                              // per-Meta-variant overrides stored at save time.
                              // Tabs the preset doesn't specify get their
                              // override cleared so they fall back to default.
                              const mergedDefault = mergeSubtitleStylePreservingPlacement(
                                subtitleSettings,
                                preset.settings
                              );
                              setSubtitleSettings(mergedDefault);
                              scheduleProfileSubtitleSave(mergedDefault);

                              setSubtitleOverrides(prev => {
                                const next: typeof prev = {};
                                if (preset.settingsA) {
                                  next["A"] = mergeSubtitleStylePreservingPlacement(
                                    prev["A"] ? { ...subtitleSettings, ...prev["A"] } : subtitleSettings,
                                    preset.settingsA
                                  );
                                }
                                if (preset.settingsB) {
                                  next["B"] = mergeSubtitleStylePreservingPlacement(
                                    prev["B"] ? { ...subtitleSettings, ...prev["B"] } : subtitleSettings,
                                    preset.settingsB
                                  );
                                }
                                scheduleOverridesSave(next);
                                return next;
                              });
                            }}
                          >
                            <span className="truncate">{preset.name}</span>
                            <button
                              className="ml-2 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const profileId = currentProfileIdRef.current;
                                if (!profileId) return;
                                try {
                                  await apiDelete(`/profiles/${profileId}/subtitle-presets/${preset.id}`);
                                  setUserSubtitlePresets(prev => prev.filter(p => p.id !== preset.id));
                                } catch (err) {
                                  console.error("Failed to delete preset:", err);
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {/* Status hint */}
                  <span className="text-xs text-muted-foreground ml-auto">
                    Editing:{" "}
                    <span className="font-medium text-foreground">
                      {activeStyleKey === "default"
                        ? "all variants"
                        : `${activeStyleKey} (${activeStyleKey === "A" ? "Instagram" : "Facebook"})`}
                    </span>
                  </span>
                </div>

                {/* Preview + settings layout.
                    Meta OFF: single "default" preview + settings panel.
                    Meta ON:  two always-on previews (A and B) + settings panel for the active tab. */}
                <div className="flex gap-4 items-start flex-wrap">
                  {metaMultiplication ? (
                    <>
                      <SubtitleStylePreviewPanel
                        styleKey="A"
                        settings={getSubtitleSettingsFor("A")}
                        hasOverride={
                          !!subtitleOverrides.A && Object.keys(subtitleOverrides.A).length > 0
                        }
                        pipelineId={pipelineId ?? undefined}
                        previewCards={previewCards}
                        isActive={activeStyleKey === "A"}
                        onSelect={() => setActiveStyleKey("A")}
                        previewText={getStylePreviewText("A")}
                      />
                      <SubtitleStylePreviewPanel
                        styleKey="B"
                        settings={getSubtitleSettingsFor("B")}
                        hasOverride={
                          !!subtitleOverrides.B && Object.keys(subtitleOverrides.B).length > 0
                        }
                        pipelineId={pipelineId ?? undefined}
                        previewCards={previewCards}
                        isActive={activeStyleKey === "B"}
                        onSelect={() => setActiveStyleKey("B")}
                        previewText={getStylePreviewText("B")}
                      />
                    </>
                  ) : (
                    <SubtitleStylePreviewPanel
                      styleKey="default"
                      settings={getSubtitleSettingsFor("default")}
                      hasOverride={activeStyleHasOverride}
                      pipelineId={pipelineId ?? undefined}
                      previewCards={previewCards}
                      isActive={true}
                      onSelect={() => setActiveStyleKey("default")}
                      previewText={getStylePreviewText("default")}
                    />
                  )}

                  {/* Active-tab settings panel (no preview — previews are rendered above) */}
                  <div className="flex-1 min-w-[320px]">
                    <SubtitleEditor
                      renderMode="settings-only"
                      settings={getSubtitleSettingsFor(activeStyleKey)}
                      onSettingsChange={(newSettings) =>
                        handleVariantSubtitleChange(activeStyleKey, newSettings)
                      }
                      showPreview={false}
                      compact={false}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {previewCards.map((card) => {
                const preview = previews[card.key];
                if (!preview) return null;

                return (
                  <Card key={card.key} className="overflow-hidden">
                    <CardHeader>
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
                            className="h-8 w-8"
                            onClick={() => pipelineId && handlePlayAudio(pipelineId, card.baseIndex)}
                            title={playingAudio === `${pipelineId}-${card.baseIndex}` ? "Stop audio" : "Play voiceover"}
                          >
                            {playingAudio === `${pipelineId}-${card.baseIndex}` ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Volume2 className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              // Stop any playing audio before opening preview player
                              if (audioRef.current) {
                                audioRef.current.pause();
                                audioRef.current = null;
                              }
                              setPlayingAudio(null);
                              setPreviewVariant(card.key);
                            }}
                            title="High-fidelity preview (FFmpeg render — slower; use the instant player in the timeline below for editing)"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleRegenerateVariantAudio(card.baseIndex, card.key, card.visualVersion)}
                            disabled={regeneratingVariantAudio[card.baseIndex]}
                            title="Regenerate voiceover"
                          >
                            {regeneratingVariantAudio[card.baseIndex] ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Badge variant="secondary">
                            {formatDuration(preview.audio_duration)}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Match summary counts */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          <span className="font-semibold">{preview.matched_count}</span>
                          <span className="text-muted-foreground">matched</span>
                        </div>
                        <div className="flex items-center gap-1 text-red-600">
                          <XCircle className="h-4 w-4" />
                          <span className="font-semibold">{preview.unmatched_count}</span>
                          <span className="text-muted-foreground">unmatched</span>
                        </div>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {preview.total_phrases} phrases total
                        </span>
                      </div>

                      {/* Thumbnail selector (becomes first frame of rendered video) */}
                      {(() => {
                        const thumb = variantThumbnails[card.key];
                        const thumbUrl = thumb
                          ? `${API_URL}/segments/files/${encodeURIComponent(thumb.imageUrl.split("/").pop() || thumb.imageUrl)}`
                          : null;
                        return (
                          <div className="flex items-center gap-3 pb-2 border-b">
                            {thumbUrl ? (
                              <button
                                onClick={() => setThumbnailPickerKey(card.key)}
                                className={`w-[54px] h-[96px] rounded overflow-hidden border-2 flex-shrink-0 hover:opacity-80 transition-opacity ${
                                  thumb?.isAutoSelected ? "border-green-500/50" : "border-primary"
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
                                <Film className="h-4 w-4 text-muted-foreground" />
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

                      {/* Full timeline editor — uses this variant's effective subtitle style */}
                      <TimelineEditor
                        matches={preview.matches}
                        audioDuration={preview.audio_duration}
                        sourceVideoIds={selectedSourceIdsArray}
                        availableSegments={availableSegments}
                        profileId={currentProfile?.id}
                        pipelineId={pipelineId ?? undefined}
                        variantIndex={card.baseIndex}
                        subtitleSettings={getPreviewSubtitleSettingsFor(card)}
                        interstitialSlides={interstitialSlides[card.key] ?? EMPTY_SLIDES}
                        onInterstitialSlidesChange={getInterstitialSlidesChangeHandler(card.key)}
                        onMatchesChange={getMatchesChangeHandler(card.key)}
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
              const _activeStyleKey = toStyleKey(activeCard);
              const _activeOverride = subtitleOverrides[_activeStyleKey];
              const _hasOverride = !!_activeOverride && Object.keys(_activeOverride).length > 0;
              const _previewPipOverlays = buildPipOverlaysForMatches(previews[previewVariant]?.matches);
              return (
                <VariantPreviewPlayer
                  open={true}
                  onOpenChange={handlePreviewPlayerClose}
                  matches={previews[previewVariant]?.matches ?? []}
                  pipelineId={pipelineId}
                  variantIndex={activeCard.baseIndex}
                  visualVersion={_hasOverride ? undefined : activeCard.visualVersion}
                  title={activeCard.label}
                  profileId={currentProfile.id}
                  subtitleSettings={getSubtitleSettingsFor(_activeStyleKey)}
                  sourceVideoIds={selectedSourceIdsArray}
                  minSegmentDuration={minSegmentDuration}
                  wordsPerSubtitle={wordsPerSubtitle}
                  ultraRapidIntro={ultraRapidIntro}
                  interstitialSlides={interstitialSlides[previewVariant]}
                  pipOverlays={Object.keys(_previewPipOverlays).length > 0 ? _previewPipOverlays : undefined}
                />
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
                      <AlertCircle className="h-4 w-4" />
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
                    {savePresetSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save preset
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Render settings */}
            <RenderSettingsPanel
              settings={renderSettings}
              onChange={setRenderSettings}
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
                <ArrowRight className="h-4 w-4 mr-2" />
                Continue to Render Results (already rendered)
              </Button>
            )}

            {/* Render button */}
            <Button
              onClick={handleRenderClick}
              disabled={isRendering || isCheckingRender || selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              {isCheckingRender ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {isCheckingRender ? "Se verifica..." : isRendering ? "Rendering..." : `Render Selected (${selectedVariants.size}${metaMultiplication ? ` × 2 = ${selectedVariants.size * 2}` : ""})`}
            </Button>

            {/* Skip render dialog */}
            {skipCheckResults && (
              <SkipRenderDialog
                open={showSkipDialog}
                onClose={() => { setShowSkipDialog(false); setSkipCheckResults(null); }}
                checkResults={skipCheckResults}
                onConfirm={(skipVars, _renderVars) => handleRender(skipVars)}
              />
            )}
          </div>
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
