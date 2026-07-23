"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
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
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiPost, apiPatch, handleApiError } from "@/lib/api";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  X,
  Star,
  Play,
  Pause,
  Volume2,
  Library,
  AlertTriangle,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Search,
  Info,
  PencilLine,
  FileText,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DebouncedTextarea,
  formatDuration,
  countWords,
  WORDS_PER_SECOND,
  analyzeGroupTags,
} from "../pipeline-utils";
import { ElevenCreditsBadge } from "./eleven-credits-badge";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useRef, useState } from "react";
import type { PreviewData, PreviewKey, Voice } from "../pipeline-types";
import { SourceVideosCard } from "./source-videos-card";
import { WorkspaceSplit } from "./workspace-split";
import { WorkspacePanelHeader } from "./workspace-panel-header";

// Mirrors the inline ttsResults state shape in PipelinePage (page.tsx).
type TtsResult = {
  audio_duration: number;
  generating: boolean;
  stale: boolean;
  status?: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  current_step?: string;
  error?: string | null;
  srt_content?: string;
  script_word_count?: number;
  srt_word_count?: number;
};

// Loose ctx-bag type (F4): only the fields that need contextual typing for the
// inline callbacks below are typed precisely; everything else stays `any`.
type Step2Ctx = {
  scripts: string[];
  voices: Voice[];
  ttsResults: Record<number, TtsResult>;
  setTtsResults: Dispatch<SetStateAction<Record<number, TtsResult>>>;
  setLibraryMatches: Dispatch<SetStateAction<Record<number, { asset_id: string; audio_duration: number }>>>;
  setPreviews: Dispatch<SetStateAction<Record<PreviewKey, PreviewData>>>;
  setSrtPreviewOpen: Dispatch<SetStateAction<Record<number, boolean>>>;
  setApprovedScripts: Dispatch<SetStateAction<Set<number>>>;
  setSelectedVariants: Dispatch<SetStateAction<Set<number>>>;
  productGroups: Array<{
    id: string;
    label: string;
    color: string | null;
    source_video_id: string;
    segments_count: number;
  }>;
  sourceVideos: Array<{
    id: string;
    name: string;
    thumbnail_path: string | null;
    duration: number | null;
    segments_count: number;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

function StepActionIcon({
  label,
  onClick,
  disabled,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`size-8 ${destructive ? "text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground"}`}
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step2TTS({ ctx }: { ctx: any }) {
  const {
    step2HeaderRef,
    scripts,
    setScripts,
    scriptNames,
    setScriptNames,
    handleScriptNameChange,
    handleScriptNameCommit,
    regeneratingAllScripts,
    regeneratingAllScriptsIndex,
    handleRegenerateAllScripts,
    handleCancelRegenerateAllScripts,
    regeneratingAll,
    regeneratingAllIndex,
    handleRegenerateAllTts,
    handleCancelRegenerateAll,
    regeneratingScript,
    handleRegenerateScript,
    ttsResults,
    setTtsResults,
    setStep,
    previewError,
    setPreviewError,
    elevenCredits,
    elevenCreditsLoading,
    elevenCreditsError,
    fetchElevenCredits,
    elevenlabsModel,
    setElevenlabsModel,
    voiceId,
    setVoiceId,
    voices,
    voicesLoading,
    defaultVoiceId,
    handleSetDefaultVoice,
    savingDefault,
    voiceSpeed,
    setVoiceSpeed,
    voiceStability,
    setVoiceStability,
    voiceSimilarity,
    setVoiceSimilarity,
    voiceStyle,
    setVoiceStyle,
    voiceSpeakerBoost,
    setVoiceSpeakerBoost,
    userChangedVoiceRef,
    wordsPerSubtitle,
    setWordsPerSubtitle,
    minSegmentDuration,
    setMinSegmentDuration,
    ultraRapidIntro,
    setUltraRapidIntro,
    assemblyPreset,
    setAssemblyPreset,
    approvedScripts,
    setApprovedScripts,
    pipelineId,
    saveScriptsToBackend,
    libraryMatches,
    setLibraryMatches,
    previews,
    setPreviews,
    srtPreviewOpen,
    setSrtPreviewOpen,
    setSelectedVariants,
    totalSegmentDuration,
    handleScriptCommit,
    productGroups,
    groupTagSearch,
    setGroupTagSearch,
    insertGroupTag,
    handlePlayTts,
    playingTtsVariant,
    ttsAudioDuration,
    ttsAudioProgress,
    setTtsAudioProgress,
    ttsAudioRef,
    ttsSeekingRef,
    handleGenerateTts,
    handleUseLibraryTts,
    sourceVideos,
    selectedSourceIds,
    metaMultiplication,
    handleMetaMultiplicationChange,
    previewCards,
    isGenerating,
    previewingIndex,
    isRendering,
    isResettingUsage,
    setIsResettingUsage,
    handlePreviewAll,
    pipelineLayout,
  }: Step2Ctx = ctx;
  const workspaceLayout = pipelineLayout !== "guided";
  const assemblyPresetHelp = ({
    keyword_strict: "Only uses clips whose keywords match the phrase, leaving uncertain phrases unmatched.",
    balanced: "Prefers keyword matches and safely rotates through the remaining footage.",
    max_variety: "Spreads usage across the full clip pool, including keyword matches.",
    shuffle: "Randomizes clip assignment per variant for stronger A/B variation.",
    ai_smart: "Uses Gemini to choose the best-fitting clip and falls back to keyword matching.",
  } as Record<string, string>)[String(assemblyPreset)] ?? "Controls how clips are assigned to phrases.";

  // Voice audition: play the selected voice's ElevenLabs preview sample inline,
  // so users can hear a voice BEFORE generating TTS (was: no preview at all).
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null);
  const [auditioningVoiceId, setAuditioningVoiceId] = useState<string | null>(null);

  const stopAudition = () => {
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause();
      auditionAudioRef.current = null;
    }
    setAuditioningVoiceId(null);
  };

  const handleAuditionVoice = () => {
    // Toggle off if the same voice is already playing.
    if (auditioningVoiceId === voiceId) {
      stopAudition();
      return;
    }
    stopAudition();
    const v = (voices as Voice[]).find((x) => x.voice_id === voiceId);
    if (!v?.preview_url) {
      toast.error("This voice has no preview sample");
      return;
    }
    const audio = new Audio(v.preview_url);
    auditionAudioRef.current = audio;
    setAuditioningVoiceId(voiceId);
    audio.onended = stopAudition;
    audio.onerror = () => {
      stopAudition();
      toast.error("Nu am putut reda sample-ul vocii");
    };
    audio.play().catch(() => stopAudition());
  };

  const renderStepActions = () => (
    <TooltipProvider>
      <div
        className="flex items-center justify-end gap-1"
        data-testid="step2-secondary-actions"
        role="toolbar"
        aria-label="Script review actions"
      >
        {regeneratingAllScripts ? (
          <StepActionIcon
            label={`Stop script regeneration (${(regeneratingAllScriptsIndex ?? 0) + 1} of ${scripts.length})`}
            onClick={handleCancelRegenerateAllScripts}
            destructive
          >
            <X className="size-4" />
          </StepActionIcon>
        ) : (
          <StepActionIcon
            label="Regenerate all scripts"
            onClick={handleRegenerateAllScripts}
            disabled={scripts.length === 0 || regeneratingAll || Object.values(regeneratingScript).some(Boolean)}
          >
            <Sparkles className="size-4" />
          </StepActionIcon>
        )}
        {regeneratingAll ? (
          <StepActionIcon
            label={`Stop voice-over regeneration (${(regeneratingAllIndex ?? 0) + 1} of ${scripts.length})`}
            onClick={handleCancelRegenerateAll}
            destructive
          >
            <X className="size-4" />
          </StepActionIcon>
        ) : (
          <StepActionIcon
            label="Regenerate all voice-overs"
            onClick={handleRegenerateAllTts}
            disabled={scripts.length === 0 || Object.values(ttsResults).some((result) => result.generating)}
          >
            <RefreshCw className="size-4" />
          </StepActionIcon>
        )}
        <StepActionIcon
          label="Back to Idea"
          onClick={() => { setStep(1); setPreviewError(null); }}
        >
          <ArrowLeft className="size-4" />
        </StepActionIcon>
      </div>
    </TooltipProvider>
  );

  return (
          <div
            className={workspaceLayout
              ? "w-full space-y-3 min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col min-[1280px]:gap-0 min-[1280px]:space-y-0"
              : "w-full space-y-4"
            }
            data-testid="step2-workspace"
            data-layout={pipelineLayout}
          >
            <div className={`flex flex-wrap items-center justify-between gap-3 ${workspaceLayout ? "min-[1280px]:hidden" : ""}`}>
              <div>
                <h2 ref={step2HeaderRef} className="font-heading text-2xl font-semibold">Review Scripts</h2>
                <p className="text-sm text-muted-foreground">
                  {scripts.length} {scripts.length === 1 ? "script" : "scripts"}
                </p>
              </div>
            </div>

            <WorkspaceSplit
              splitId="step2"
              enabled={workspaceLayout}
              fallbackClassName={workspaceLayout
                ? "grid items-start gap-3 min-[1180px]:grid-cols-[minmax(25rem,0.88fr)_minmax(0,1.6fr)] min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:items-stretch min-[1280px]:gap-px min-[1280px]:bg-border"
                : "grid grid-cols-1 gap-4"
              }
              groupClassName="h-auto min-h-0 flex-1"
              leftSizing={{ defaultSize: "35%", minSize: "20rem" }}
              rightSizing={{ minSize: "30%" }}
            >
              <aside
                className={workspaceLayout
                  ? "flex min-w-0 flex-col gap-3 bg-background min-[1180px]:sticky min-[1180px]:top-4 min-[1280px]:static min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:gap-0 min-[1280px]:divide-y min-[1280px]:divide-border min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain"
                  : "flex min-w-0 flex-col gap-4"
                }
                data-testid="step2-inspector"
              >
                <SourceVideosCard ctx={ctx} workspace={workspaceLayout} />

            {/* ElevenLabs model selector */}
            <Card variant={workspaceLayout ? "workspace" : "default"} className="gap-0 overflow-hidden py-0 min-[1280px]:py-0">
              <WorkspacePanelHeader
                icon={Settings2}
                title="TTS"
                titleAccessory={(
                  <span className="hidden min-[1600px]:inline">Configuration</span>
                )}
                data-testid="step2-tts-header"
                actions={<ElevenCreditsBadge
                  credits={elevenCredits}
                  loading={elevenCreditsLoading}
                  error={elevenCreditsError}
                  onRefresh={fetchElevenCredits}
                />}
              />
              <CardContent className={`space-y-5 pt-5 ${workspaceLayout ? "min-[1280px]:pb-4" : ""}`}>
                {elevenCredits?.last_error && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">
                      ElevenLabs error: {elevenCredits.last_error}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="grid grid-cols-1 gap-4 min-[640px]:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tts-model">ElevenLabs Model</Label>
                  <Select value={elevenlabsModel} onValueChange={setElevenlabsModel}>
                    <SelectTrigger id="tts-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eleven_flash_v2_5">
                        Flash v2.5 (Fastest, 32 langs)
                      </SelectItem>
                      <SelectItem value="eleven_turbo_v2_5">
                        Turbo v2.5 (Balanced)
                      </SelectItem>
                      <SelectItem value="eleven_multilingual_v2">
                        Multilingual v2 (Best quality)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tts-voice">Voice</Label>
                  <div className="flex gap-2">
                    <Select value={voiceId} onValueChange={setVoiceId}>
                      <SelectTrigger id="tts-voice" disabled={voicesLoading} className="flex-1">
                        <SelectValue placeholder={voicesLoading ? "Loading voices..." : "Select a voice"} />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const custom = voices.filter(v => v.category && v.category !== "premade");
                          const premade = voices.filter(v => !v.category || v.category === "premade");
                          return (
                            <>
                              {custom.length > 0 && (
                                <>
                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">My Voices</div>
                                  {custom.map((voice) => (
                                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                      {voice.name}{voice.language ? ` (${voice.language})` : ""}{voice.voice_id === defaultVoiceId ? " \u2605" : ""}
                                    </SelectItem>
                                  ))}
                                </>
                              )}
                              {premade.length > 0 && (
                                <>
                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Library</div>
                                  {premade.map((voice) => (
                                    <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                      {voice.name}{voice.language ? ` (${voice.language})` : ""}{voice.voice_id === defaultVoiceId ? " \u2605" : ""}
                                    </SelectItem>
                                  ))}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleAuditionVoice}
                      disabled={!voiceId || voiceId === "default"}
                      title={auditioningVoiceId === voiceId ? "Stop" : "Preview a voice sample"}
                    >
                      {auditioningVoiceId === voiceId ? (
                        <Pause className="size-4" />
                      ) : (
                        <Volume2 className="size-4" />
                      )}
                    </Button>
                    <Button
                      variant={voiceId === defaultVoiceId ? "outline" : "secondary"}
                      size="icon"
                      onClick={handleSetDefaultVoice}
                      disabled={!voiceId || voiceId === "default" || voiceId === defaultVoiceId || savingDefault}
                      title={voiceId === defaultVoiceId ? "This is your default voice" : "Set as default voice"}
                    >
                      {savingDefault ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Star className={`size-4 ${voiceId === defaultVoiceId ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      )}
                    </Button>
                  </div>
                  {defaultVoiceId && (
                    <p className="text-xs text-muted-foreground">
                      Default: {voices.find(v => v.voice_id === defaultVoiceId)?.name || "Saved voice"}
                    </p>
                  )}
                </div>
                </div>

                {/* Voice Settings */}
                <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                  <p className="text-sm font-medium">Voice Settings</p>
                  <div className="grid grid-cols-1 gap-x-5 gap-y-4 min-[640px]:grid-cols-2">

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Speed</Label>
                      <span className="text-xs text-muted-foreground">{voiceSpeed.toFixed(2)}x</span>
                    </div>
                    <Slider
                      value={[voiceSpeed]}
                      onValueChange={([v]) => { userChangedVoiceRef.current = true; setVoiceSpeed(v); }}
                      min={0.7} max={1.2} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0.7x</span>
                      <span>1.2x</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Stability</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceStability * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceStability]}
                      onValueChange={([v]) => { userChangedVoiceRef.current = true; setVoiceStability(v); }}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Similarity</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceSimilarity * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceSimilarity]}
                      onValueChange={([v]) => { userChangedVoiceRef.current = true; setVoiceSimilarity(v); }}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Style Exaggeration</Label>
                      <span className="text-xs text-muted-foreground">{Math.round(voiceStyle * 100)}%</span>
                    </div>
                    <Slider
                      value={[voiceStyle]}
                      onValueChange={([v]) => { userChangedVoiceRef.current = true; setVoiceStyle(v); }}
                      min={0} max={1} step={0.01}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0%</span>
                      <span>100%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">High values increase latency</p>
                  </div>
                  </div>

                  <div className="flex items-center gap-2 rounded-md bg-background/60 px-3 py-2.5">
                    <Checkbox
                      id="speaker-boost"
                      checked={voiceSpeakerBoost}
                      onCheckedChange={(checked) => { userChangedVoiceRef.current = true; setVoiceSpeakerBoost(checked === true); }}
                    />
                    <Label htmlFor="speaker-boost" className="text-xs">
                      Speaker Boost
                    </Label>
                    <span className="text-[10px] text-muted-foreground">Enhances voice clarity</span>
                  </div>

                  <div className="border-t pt-4">
                    <p className="mb-3 text-sm font-medium">Timing &amp; subtitles</p>
                    <div className="grid grid-cols-1 gap-x-5 gap-y-4 min-[640px]:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Words per subtitle</Label>
                      <span className="text-xs text-muted-foreground">{wordsPerSubtitle}</span>
                    </div>
                    <Slider
                      value={[wordsPerSubtitle]}
                      onValueChange={([v]) => setWordsPerSubtitle(v)}
                      min={1} max={4} step={1}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1</span>
                      <span>4</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Fewer words = more dynamic subtitles (TikTok style)</p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <Label className="text-xs">Minimum segment duration (sec)</Label>
                      <span className="text-xs text-muted-foreground">{minSegmentDuration}s</span>
                    </div>
                    <Slider
                      value={[minSegmentDuration]}
                      onValueChange={([v]) => setMinSegmentDuration(v)}
                      min={0.5} max={5} step={0.5}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0.5s</span>
                      <span>5s</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Video segments won&apos;t change faster than this duration</p>
                  </div>
                    </div>
                  </div>

                  <div className="rounded-md border bg-background/60 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="ultra-rapid-intro"
                        checked={ultraRapidIntro}
                        onCheckedChange={(checked) => setUltraRapidIntro(checked === true)}
                      />
                      <Label htmlFor="ultra-rapid-intro" className="text-xs cursor-pointer">
                        Ultra-fast sequences at the start
                      </Label>
                    </div>
                    {ultraRapidIntro && (
                      <p className="text-[10px] text-muted-foreground mt-1 ml-6">
                        The first ~2 seconds will contain 3-4 very short sequences (0.5s) from the best moments
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

              </aside>

              <section
                className={workspaceLayout
                  ? "min-w-0 bg-background min-[1280px]:flex min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:flex-col min-[1280px]:overflow-hidden"
                  : "min-w-0"
                }
                aria-label="Script and voice-over editor"
                data-testid="step2-script-canvas"
              >
                <WorkspacePanelHeader
                  icon={FileText}
                  title="Review Scripts"
                  titleAccessory={(
                    <span className="text-xs font-normal text-muted-foreground">
                      {scripts.length} {scripts.length === 1 ? "script" : "scripts"}
                    </span>
                  )}
                  className={workspaceLayout ? "hidden min-[1280px]:flex" : "hidden"}
                  data-testid="step2-review-header"
                />

                <div
                  className="flex h-12 shrink-0 items-center justify-end border-b border-border bg-surface-panel px-3"
                  data-testid="step2-action-dock"
                >
                  {renderStepActions()}
                </div>

                <div className={`space-y-3 ${workspaceLayout ? "min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:overflow-y-auto min-[1280px]:overscroll-contain min-[1280px]:p-3" : ""}`}>

            {/* Scripts list — single column so each sentence has room */}
            <div className="grid grid-cols-1">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / WORDS_PER_SECOND);

                return (
                  <Card key={index} className={`rounded-none border-x-0 border-t-0 bg-transparent py-0 transition-colors first:border-t ${approvedScripts.has(index) ? "border-b-success/40 bg-success/[0.035]" : ""}`}>
                    <CardHeader className="px-4 pb-2 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="group/name flex min-w-0 items-center gap-1.5">
                          <PencilLine className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-focus-within/name:text-primary group-hover/name:text-muted-foreground" />
                          <Input
                            value={scriptNames[index] ?? `Script ${index + 1}`}
                            onChange={(event) => handleScriptNameChange(index, event.target.value)}
                            onBlur={() => handleScriptNameCommit(index)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                            }}
                            maxLength={80}
                            aria-label={`Name for script ${index + 1}`}
                            title="Rename script"
                            className="h-8 min-w-[8rem] max-w-[22rem] border-transparent bg-transparent px-1.5 text-lg font-semibold shadow-none hover:border-border/70 focus-visible:border-border focus-visible:ring-2"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {wordCount} words (~{formatDuration(estimatedDuration)})
                          </Badge>
                          <Badge variant="outline" className="text-muted-foreground">
                            {script.replace(/\[([^\[\]]+)\]/g, "").length} chars
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-muted-foreground hover:text-primary"
                            title="Regenerate this script with AI"
                            onClick={() => handleRegenerateScript(index)}
                            disabled={regeneratingScript[index] || regeneratingAllScripts}
                          >
                            {regeneratingScript[index] ? (
                              <Loader2 className="size-3.5 mr-1 animate-spin" />
                            ) : (
                              <Sparkles className="size-3.5 mr-1" />
                            )}
                            {regeneratingScript[index] ? "Regenerating..." : "Regenerate"}
                          </Button>
                          {scripts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 text-muted-foreground hover:text-destructive"
                              title="Delete script"
                              onClick={() => {
                                const newScripts = scripts.filter((_, i) => i !== index);
                                const newScriptNames = scriptNames.filter((_: string, i: number) => i !== index);
                                setScripts(newScripts);
                                setScriptNames(newScriptNames);
                                if (pipelineId) saveScriptsToBackend(pipelineId, newScripts, newScriptNames);
                                // Remap ttsResults: remove deleted index, shift higher indices down
                                setTtsResults(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                    // ki === index is dropped
                                  }
                                  return next;
                                });
                                // Remap libraryMatches: remove deleted index, shift higher indices down
                                setLibraryMatches(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap previews: remove deleted index, shift higher indices down
                                setPreviews(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap srtPreviewOpen: remove deleted index, shift higher indices down
                                setSrtPreviewOpen(prev => {
                                  const next: typeof prev = {};
                                  for (const [k, v] of Object.entries(prev)) {
                                    const ki = Number(k);
                                    if (ki < index) next[ki] = v;
                                    else if (ki > index) next[ki - 1] = v;
                                  }
                                  return next;
                                });
                                // Remap approvedScripts: remove deleted index, shift higher indices down
                                setApprovedScripts(prev => {
                                  const next = new Set<number>();
                                  for (const ki of prev) {
                                    if (ki < index) next.add(ki);
                                    else if (ki > index) next.add(ki - 1);
                                  }
                                  return next;
                                });
                                // Remap selectedVariants: remove deleted index, shift higher indices down
                                setSelectedVariants(prev => {
                                  const next = new Set<number>();
                                  for (const ki of prev) {
                                    if (ki < index) next.add(ki);
                                    else if (ki > index) next.add(ki - 1);
                                  }
                                  return next;
                                });
                              }}
                            >
                              <X className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    {totalSegmentDuration > 0 && estimatedDuration > totalSegmentDuration && (
                      <div className="px-4 pb-2">
                        <Alert className="border-muted-foreground/50 bg-muted/50">
                          <Info className="size-4 text-muted-foreground" />
                          <AlertDescription className="text-muted-foreground text-sm">
                            Script exceeds available video material ({Math.round(totalSegmentDuration)}s) by ~{estimatedDuration - Math.round(totalSegmentDuration)}s. Segments will be repeated to cover the difference.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    <CardContent className="space-y-3 px-4 pb-4">
                      <DebouncedTextarea
                        id={`script-textarea-${index}`}
                        value={script}
                        onCommit={(nextValue) => handleScriptCommit(index, nextValue)}
                        rows={10}
                        className="resize-y border-0 bg-muted/45 font-sans text-sm shadow-none [field-sizing:fixed] focus-visible:bg-muted/55 focus-visible:ring-1"
                      />

                      {/* Insert Group Tag — searchable button grid */}
                      {productGroups.length > 0 && (() => {
                        const tagStates = analyzeGroupTags(script);
                        const filtered = productGroups.filter(
                          (g) => !groupTagSearch.trim() || g.label.toLowerCase().includes(groupTagSearch.toLowerCase())
                        );
                        return (
                          <div className="space-y-1.5">
                            {productGroups.length > 4 && (
                              <div className="relative w-48">
                                <Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" />
                                <Input
                                  placeholder="Filter groups..."
                                  value={groupTagSearch}
                                  onChange={(e) => setGroupTagSearch(e.target.value)}
                                  className="h-7 pl-7 text-xs"
                                />
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {filtered.map((g) => {
                                const state = tagStates.find((t) => t.label === g.label);
                                const isOpen = state?.isOpen ?? false;
                                const isPaired = state?.isPaired ?? false;
                                return (
                                  <button
                                    key={g.id}
                                    type="button"
                                    onClick={() => insertGroupTag(index, g.label)}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors hover:bg-accent ${
                                      isOpen
                                        ? "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-300"
                                        : isPaired
                                        ? "ring-2 ring-success/50 bg-success/10 border-success/30"
                                        : "border-border"
                                    }`}
                                  >
                                    {g.color && (
                                      <span
                                        className="inline-block size-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: g.color }}
                                      />
                                    )}
                                    {g.label}
                                    <span className="text-muted-foreground">({g.segments_count})</span>
                                    {isPaired && <CheckCircle className="size-3 text-success flex-shrink-0" />}
                                    {isOpen && <span className="text-amber-600 font-bold flex-shrink-0">…</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {tagStates.length > 0 && (
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-400 inline-block" /> Open</span>
                                <span className="inline-flex items-center gap-1"><CheckCircle className="size-2.5 text-success" /> Paired</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Per-script TTS controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {ttsResults[index]?.generating ? (
                          <div
                            className="min-w-[14rem] max-w-sm flex-1 rounded-md border bg-muted/30 px-3 py-2"
                            data-testid={`tts-progress-${index}`}
                          >
                            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                              <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                                <span className="truncate">{ttsResults[index].current_step || "Generating voice-over"}</span>
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {Math.round(ttsResults[index].progress || 0)}%
                              </span>
                            </div>
                            <Progress value={ttsResults[index].progress || 0} className="h-1.5" />
                          </div>
                        ) : (ttsResults[index]?.audio_duration || 0) > 0 && !ttsResults[index].stale ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePlayTts(index)}
                            >
                              {playingTtsVariant === index ? (
                                <><Pause className="size-3.5 mr-1.5" />Pause</>
                              ) : (
                                <><Play className="size-3.5 mr-1.5" />Play</>
                              )}
                            </Button>
                            {playingTtsVariant === index && ttsAudioDuration > 0 && (
                              <div
                                className="relative h-5 flex-1 min-w-[100px] max-w-[200px] cursor-pointer group select-none"
                                onMouseDown={(e) => {
                                  const bar = e.currentTarget;
                                  const seek = (clientX: number) => {
                                    const rect = bar.getBoundingClientRect();
                                    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                                    setTtsAudioProgress(pct * ttsAudioDuration);
                                    if (ttsAudioRef.current) ttsAudioRef.current.currentTime = pct * ttsAudioDuration;
                                  };
                                  ttsSeekingRef.current = true;
                                  seek(e.clientX);
                                  const onMove = (ev: MouseEvent) => seek(ev.clientX);
                                  const onUp = () => {
                                    ttsSeekingRef.current = false;
                                    document.removeEventListener('mousemove', onMove);
                                    document.removeEventListener('mouseup', onUp);
                                  };
                                  document.addEventListener('mousemove', onMove);
                                  document.addEventListener('mouseup', onUp);
                                }}
                              >
                                <div className="absolute top-1/2 -translate-y-1/2 w-full h-1 rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${(ttsAudioProgress / ttsAudioDuration) * 100}%` }}
                                  />
                                </div>
                                <div
                                  className="absolute top-1/2 -translate-y-1/2 size-3 rounded-full bg-primary shadow-sm border-2 border-background"
                                  style={{ left: `calc(${(ttsAudioProgress / ttsAudioDuration) * 100}% - 6px)` }}
                                />
                                <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                                  {Math.floor(ttsAudioProgress / 60)}:{String(Math.floor(ttsAudioProgress % 60)).padStart(2, '0')} / {Math.floor(ttsAudioDuration / 60)}:{String(Math.floor(ttsAudioDuration % 60)).padStart(2, '0')}
                                </span>
                              </div>
                            )}
                            <Badge variant="secondary" className="text-xs">
                              {formatDuration(ttsResults[index].audio_duration)}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleGenerateTts(index)}
                              title="Regenerate voice-over with current settings"
                            >
                              <RefreshCw className="size-3.5 mr-1.5" />
                              Regenerate
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateTts(index)}
                          >
                            <Volume2 className="size-3.5 mr-1.5" />
                            {ttsResults[index]?.stale ? "Regenerate Voice-over" : "Generate Voice-over"}
                          </Button>
                        )}
                        {ttsResults[index]?.stale && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Script changed — audio outdated
                          </Badge>
                        )}
                        {ttsResults[index]?.error && !ttsResults[index]?.generating && (
                          <span className="text-xs text-destructive" role="alert">
                            {ttsResults[index].error}
                          </span>
                        )}
                        {libraryMatches[index] && !ttsResults[index] && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                            onClick={() => handleUseLibraryTts(index)}
                          >
                            <Library className="size-3.5 mr-1.5" />
                            Use Library Audio ({formatDuration(libraryMatches[index].audio_duration)})
                          </Button>
                        )}
                        {(ttsResults[index]?.audio_duration || 0) > 0 && !ttsResults[index].generating && !ttsResults[index].stale && (
                          <div className="ml-auto flex items-center gap-2 rounded-md border border-success/20 bg-success/10 px-2.5 py-1">
                            <Checkbox
                              id={`approve-script-${index}`}
                              checked={approvedScripts.has(index)}
                              onCheckedChange={(checked) => {
                                const approved = checked === true;
                                setApprovedScripts(prev => {
                                  const next = new Set(prev);
                                  if (approved) next.add(index);
                                  else next.delete(index);
                                  return next;
                                });
                                if (pipelineId) {
                                  apiPatch(`/pipeline/${pipelineId}/tts-approve/${index}`, { approved }).catch(() => {});
                                }
                              }}
                              className="size-4.5 border-success data-[state=checked]:border-success data-[state=checked]:bg-success"
                            />
                            <Label
                              htmlFor={`approve-script-${index}`}
                              className="cursor-pointer text-xs font-medium text-success"
                            >
                              Approve voice-over
                            </Label>
                          </div>
                        )}
                      </div>

                      {/* SRT Subtitle Preview */}
                      {ttsResults[index]?.srt_content && !ttsResults[index]?.generating && !ttsResults[index]?.stale && (
                        <div className="mt-2">
                          <button
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setSrtPreviewOpen(prev => ({ ...prev, [index]: !prev[index] }))}
                          >
                            {srtPreviewOpen[index] ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                            Subtitle Preview
                            <span className="text-muted-foreground">
                              — Script: {ttsResults[index].script_word_count} words | SRT: {ttsResults[index].srt_word_count} words
                            </span>
                            {ttsResults[index].script_word_count != null && ttsResults[index].srt_word_count != null && ttsResults[index].script_word_count! > ttsResults[index].srt_word_count! && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                                <AlertTriangle className="size-2.5 mr-0.5" />
                                {ttsResults[index].script_word_count! - ttsResults[index].srt_word_count!} words missing
                              </Badge>
                            )}
                          </button>
                          {srtPreviewOpen[index] && (
                            <pre className="mt-1.5 p-2 bg-muted/50 rounded text-[11px] font-mono max-h-48 overflow-y-auto whitespace-pre-wrap border">
                              {ttsResults[index].srt_content}
                            </pre>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Compact status and action dock */}
            {(() => {
              const ttsCount = scripts.filter((_, i) => { const r = ttsResults[i]; return !!r && r.audio_duration > 0 && !r.generating && !r.stale; }).length;
              const allTtsReady = ttsCount === scripts.length && scripts.length > 0;
              const previewTargetCount = allTtsReady ? previewCards.length : scripts.length;
              const hasPreviews = Object.keys(previews).length > 0;
              const approvalText = approvedScripts.size === 0
                ? "No scripts approved yet"
                : approvedScripts.size === scripts.length
                  ? `All ${scripts.length} scripts approved`
                  : `${approvedScripts.size} of ${scripts.length} scripts approved`;

              return (
                <Card className="gap-0 overflow-hidden py-0" data-testid="step2-action-panel">
                  <CardContent className="grid gap-3 p-3 lg:grid-cols-2 2xl:grid-cols-[minmax(15rem,0.9fr)_minmax(0,1fr)_minmax(16rem,0.8fr)]">
                    <div
                      className="rounded-md border bg-background/60 px-3 py-2.5"
                      data-testid="step2-assembly-preset"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="assembly-preset-step2" className="text-sm font-medium">
                          Assembly Preset
                        </Label>
                        <Select
                          value={assemblyPreset}
                          onValueChange={(value) => setAssemblyPreset(value as typeof assemblyPreset)}
                        >
                          <SelectTrigger id="assembly-preset-step2" className="w-40 shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="keyword_strict">Keyword strict</SelectItem>
                            <SelectItem value="balanced">Balanced</SelectItem>
                            <SelectItem value="max_variety">Max variety</SelectItem>
                            <SelectItem value="shuffle">Shuffle per variant</SelectItem>
                            <SelectItem value="ai_smart">AI smart match</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {assemblyPresetHelp} Applied when previews are generated.
                      </p>
                    </div>
                    <div className="rounded-md border bg-background/60 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="meta-multiplication-step2"
                          checked={metaMultiplication}
                          onCheckedChange={(checked) => void handleMetaMultiplicationChange(checked === true)}
                        />
                        <Label htmlFor="meta-multiplication-step2" className="cursor-pointer text-sm font-medium">
                          Meta Multiplication before preview
                        </Label>
                      </div>
                      <p className="ml-6 mt-1 text-xs text-muted-foreground">
                        {metaMultiplication
                          ? `The preview will generate ${previewCards.length} variants (${scripts.length} scripts × 2 Meta versions).`
                          : "Enable this to preview Instagram and Facebook separately before rendering."}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-col justify-center gap-1.5 rounded-md border bg-muted/20 px-3 py-2.5 text-sm lg:col-span-2 2xl:col-span-1">
                      <div className={`flex items-center gap-2 font-medium ${allTtsReady ? "text-success" : "text-muted-foreground"}`}>
                        {allTtsReady ? <CheckCircle className="size-4 shrink-0" /> : <Volume2 className="size-4 shrink-0" />}
                        <span>
                          {ttsCount === 0
                            ? "Voice-overs not generated yet"
                            : allTtsReady
                              ? "All voice-overs are ready"
                              : `${ttsCount} of ${scripts.length} voice-overs ready`}
                        </span>
                      </div>
                      {selectedSourceIds.size === 0 && (
                        <span className="pl-6 text-xs text-amber-600 dark:text-amber-400">
                          Select at least one source video above
                        </span>
                      )}
                    </div>
                  </CardContent>

                  <CardFooter className="flex-col gap-3 border-t bg-muted/30 p-3 [.border-t]:pt-3 sm:flex-row sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <CheckCircle className={`size-4 shrink-0 ${approvedScripts.size === scripts.length ? "text-success" : "text-muted-foreground"}`} />
                      <span className={`truncate font-medium ${approvedScripts.size === scripts.length ? "text-success" : "text-muted-foreground"}`}>
                        {approvalText}
                      </span>
                      {approvedScripts.size > 0 && approvedScripts.size < scripts.length && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => setApprovedScripts(new Set(scripts.map((_, i) => i)))}
                        >
                          Approve all
                        </Button>
                      )}
                    </div>

                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        disabled={isGenerating || previewingIndex !== null || isRendering || isResettingUsage}
                        onClick={async () => {
                          if (!confirm("Reset segment diversity? Upcoming previews will be able to reuse all segments.")) return;
                          setIsResettingUsage(true);
                          try {
                            const filterIds = selectedSourceIds.size > 0 ? Array.from(selectedSourceIds) : undefined;
                            if (filterIds && filterIds.length > 0) {
                              for (const svId of filterIds) {
                                await apiPost("/segments/reset-usage", { source_video_id: svId });
                              }
                            } else {
                              await apiPost("/segments/reset-usage", {});
                            }
                            toast.success("Segment diversity has been reset");
                          } catch (err) {
                            handleApiError(err, "Failed to reset segment diversity");
                          } finally {
                            setIsResettingUsage(false);
                          }
                        }}
                      >
                        {isResettingUsage ? (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 size-3.5" />
                        )}
                        {isResettingUsage ? "Resetting..." : "Reset diversity"}
                      </Button>
                      <Button
                        onClick={handlePreviewAll}
                        disabled={isGenerating || previewingIndex !== null || isRendering || sourceVideos.length === 0 || selectedSourceIds.size === 0}
                        variant={hasPreviews ? "outline" : "default"}
                        size="sm"
                      >
                        {/* BUG-FE-35: Counter is safe — previewingIndex is only non-null during batched generation when scripts.length > 0 */}
                        {previewingIndex !== null ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            {allTtsReady
                              ? `Generating preview ${previewingIndex + 1} of ${previewTargetCount}...`
                              : `Generating voice-over ${(previewCards[previewingIndex]?.baseIndex ?? previewingIndex) + 1} of ${previewTargetCount}...`}
                          </>
                        ) : (
                          <>
                            <Sparkles className="mr-2 size-4" />
                            {allTtsReady ? "Generate Previews" : "Generate Voice-Overs"}
                          </>
                        )}
                      </Button>
                      {hasPreviews && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            setPreviewError(null);
                            setStep(3);
                          }}
                          disabled={previewingIndex !== null || isGenerating || isRendering}
                        >
                          <CheckCircle className="mr-2 size-4" />
                          Continue to Preview
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>
              );
            })()}
                </div>
              </section>
            </WorkspaceSplit>
          </div>
  );
}
