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
import { Slider } from "@/components/ui/slider";
import { apiPost, apiPatch, API_URL, handleApiError } from "@/lib/api";
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
  Film,
  Clock,
  List,
  LayoutGrid,
  Info,
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
import type { Dispatch, SetStateAction } from "react";
import type { PreviewData, PreviewKey, Voice } from "../pipeline-types";

// Mirrors the inline ttsResults state shape in PipelinePage (page.tsx).
type TtsResult = {
  audio_duration: number;
  generating: boolean;
  stale: boolean;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step2TTS({ ctx }: { ctx: any }) {
  const {
    step2HeaderRef,
    scripts,
    setScripts,
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
    sourceVideosLoading,
    selectedSourceIds,
    handleSelectAllSources,
    handleDeselectAllSources,
    sourceVideoSearch,
    setSourceVideoSearch,
    sourceVideoViewMode,
    setSourceVideoViewMode,
    handleSourceToggle,
    metaMultiplication,
    handleMetaMultiplicationChange,
    previewCards,
    isGenerating,
    previewingIndex,
    isRendering,
    isResettingUsage,
    setIsResettingUsage,
    handlePreviewAll,
  }: Step2Ctx = ctx;
  return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 ref={step2HeaderRef} className="text-2xl font-semibold scroll-mt-20">Review Scripts ({scripts.length})</h2>
              <div className="flex items-center gap-2">
                {regeneratingAllScripts ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelRegenerateAllScripts}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />
                    Stop Scripts ({(regeneratingAllScriptsIndex ?? 0) + 1}/{scripts.length})
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateAllScripts}
                    disabled={scripts.length === 0 || regeneratingAll || Object.values(regeneratingScript).some(Boolean)}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />Regenerate All Scripts
                  </Button>
                )}
                {regeneratingAll ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelRegenerateAll}
                  >
                    <X className="h-3.5 w-3.5 mr-1.5" />
                    Stop ({(regeneratingAllIndex ?? 0) + 1}/{scripts.length})
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateAllTts}
                    disabled={scripts.length === 0 || Object.values(ttsResults).some(r => r.generating)}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Regenerate All Voice-overs
                  </Button>
                )}
                <Button variant="outline" onClick={() => { setStep(1); setPreviewError(null); }}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Input
                </Button>
              </div>
            </div>

            {/* ElevenLabs model selector */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">TTS Configuration</CardTitle>
                <ElevenCreditsBadge
                  credits={elevenCredits}
                  loading={elevenCreditsLoading}
                  error={elevenCreditsError}
                  onRefresh={fetchElevenCredits}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                {elevenCredits?.last_error && (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs">
                      ElevenLabs error: {elevenCredits.last_error}
                    </AlertDescription>
                  </Alert>
                )}
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
                      variant={voiceId === defaultVoiceId ? "outline" : "secondary"}
                      size="icon"
                      onClick={handleSetDefaultVoice}
                      disabled={!voiceId || voiceId === "default" || voiceId === defaultVoiceId || savingDefault}
                      title={voiceId === defaultVoiceId ? "This is your default voice" : "Set as default voice"}
                    >
                      {savingDefault ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Star className={`h-4 w-4 ${voiceId === defaultVoiceId ? "fill-yellow-400 text-yellow-400" : ""}`} />
                      )}
                    </Button>
                  </div>
                  {defaultVoiceId && (
                    <p className="text-xs text-muted-foreground">
                      Default: {voices.find(v => v.voice_id === defaultVoiceId)?.name || "Saved voice"}
                    </p>
                  )}
                </div>

                {/* Voice Settings */}
                <div className="border-t pt-4 space-y-4">
                  <p className="text-sm font-medium">Voice Settings</p>

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

                  <div className="flex items-center gap-2">
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

                  <div className="border-t pt-3 space-y-1.5">
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

                  <div className="border-t pt-3 space-y-1.5">
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

                  <div className="border-t pt-3">
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

            {/* Scripts list — single column so each sentence has room */}
            <div className="grid grid-cols-1 gap-4">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / WORDS_PER_SECOND);

                return (
                  <Card key={index} className={`transition-colors ${approvedScripts.has(index) ? "border-green-500 bg-green-50/50 dark:bg-green-950/20" : ""}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {ttsResults[index] && !ttsResults[index].generating && !ttsResults[index].stale && (
                            <Checkbox
                              id={`approve-header-${index}`}
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
                              className="h-5 w-5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
                            />
                          )}
                          <CardTitle className="text-lg">
                            Script {index + 1}
                            {approvedScripts.has(index) && (
                              <CheckCircle className="inline-block h-4 w-4 ml-2 text-green-600" />
                            )}
                          </CardTitle>
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
                              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 mr-1" />
                            )}
                            {regeneratingScript[index] ? "Regenerating..." : "Regenerate"}
                          </Button>
                          {scripts.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title="Delete script"
                              onClick={() => {
                                const newScripts = scripts.filter((_, i) => i !== index);
                                setScripts(newScripts);
                                if (pipelineId) saveScriptsToBackend(pipelineId, newScripts);
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
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    {totalSegmentDuration > 0 && estimatedDuration > totalSegmentDuration && (
                      <div className="px-6 pb-2">
                        <Alert className="border-muted-foreground/50 bg-muted/50">
                          <Info className="h-4 w-4 text-muted-foreground" />
                          <AlertDescription className="text-muted-foreground text-sm">
                            Script exceeds available video material ({Math.round(totalSegmentDuration)}s) by ~{estimatedDuration - Math.round(totalSegmentDuration)}s. Segments will be repeated to cover the difference.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    <CardContent className="space-y-3">
                      <DebouncedTextarea
                        id={`script-textarea-${index}`}
                        value={script}
                        onCommit={(nextValue) => handleScriptCommit(index, nextValue)}
                        rows={10}
                        className="resize-y font-mono text-sm [field-sizing:fixed]"
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
                                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
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
                                        ? "ring-2 ring-green-400 bg-green-50 dark:bg-green-950/30 border-green-300"
                                        : "border-border"
                                    }`}
                                  >
                                    {g.color && (
                                      <span
                                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                        style={{ backgroundColor: g.color }}
                                      />
                                    )}
                                    {g.label}
                                    <span className="text-muted-foreground">({g.segments_count})</span>
                                    {isPaired && <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />}
                                    {isOpen && <span className="text-amber-600 font-bold flex-shrink-0">…</span>}
                                  </button>
                                );
                              })}
                            </div>
                            {tagStates.length > 0 && (
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Open</span>
                                <span className="inline-flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 text-green-600" /> Paired</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Per-script TTS controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {ttsResults[index]?.generating ? (
                          <Button variant="outline" size="sm" disabled>
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                            Generating...
                          </Button>
                        ) : ttsResults[index] && !ttsResults[index].stale ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePlayTts(index)}
                            >
                              {playingTtsVariant === index ? (
                                <><Pause className="h-3.5 w-3.5 mr-1.5" />Pause</>
                              ) : (
                                <><Play className="h-3.5 w-3.5 mr-1.5" />Play</>
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
                                  className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-primary shadow-sm border-2 border-background"
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
                              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                              Regenerate
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleGenerateTts(index)}
                          >
                            <Volume2 className="h-3.5 w-3.5 mr-1.5" />
                            {ttsResults[index]?.stale ? "Regenerate Voice-over" : "Generate Voice-over"}
                          </Button>
                        )}
                        {ttsResults[index]?.stale && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            Script changed — audio outdated
                          </Badge>
                        )}
                        {libraryMatches[index] && !ttsResults[index] && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs text-muted-foreground border-muted-foreground/30 hover:bg-muted"
                            onClick={() => handleUseLibraryTts(index)}
                          >
                            <Library className="h-3.5 w-3.5 mr-1.5" />
                            Use Library Audio ({formatDuration(libraryMatches[index].audio_duration)})
                          </Button>
                        )}
                        {ttsResults[index] && !ttsResults[index].generating && !ttsResults[index].stale && (
                          <div className="ml-auto flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-2.5 py-1 dark:border-green-900 dark:bg-green-950/30">
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
                              className="h-4.5 w-4.5 border-green-500 data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600"
                            />
                            <Label
                              htmlFor={`approve-script-${index}`}
                              className="cursor-pointer text-xs font-medium text-green-700 dark:text-green-300"
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
                            {srtPreviewOpen[index] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Subtitle Preview
                            <span className="text-muted-foreground">
                              — Script: {ttsResults[index].script_word_count} words | SRT: {ttsResults[index].srt_word_count} words
                            </span>
                            {ttsResults[index].script_word_count != null && ttsResults[index].srt_word_count != null && ttsResults[index].script_word_count! > ttsResults[index].srt_word_count! && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
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

            {/* Source Video Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Film className="h-4 w-4" />
                      Source Videos
                    </CardTitle>
                    <CardDescription>
                      {sourceVideos.length <= 1
                        ? "Source video for segment matching"
                        : `Select which videos to match segments from (${selectedSourceIds.size} of ${sourceVideos.length} selected)`}
                    </CardDescription>
                  </div>
                  {sourceVideos.length > 1 && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeselectAllSources}
                        disabled={selectedSourceIds.size === 0}
                      >
                        Deselect All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSelectAllSources}
                        disabled={selectedSourceIds.size === sourceVideos.length}
                      >
                        Select All
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {sourceVideosLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading source videos...
                  </div>
                ) : sourceVideos.length === 0 ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      No source videos uploaded yet. Go to the Segments page to add source videos before previewing.
                    </AlertDescription>
                  </Alert>
                ) : sourceVideos.length === 1 ? (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <CheckCircle className="h-4 w-4 text-primary flex-shrink-0" />
                    {sourceVideos[0].thumbnail_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${API_URL}/segments/files/${encodeURIComponent(sourceVideos[0].thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                        alt=""
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                        <Film className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{sourceVideos[0].name}</p>
                    </div>
                    {sourceVideos[0].duration && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">
                        <Clock className="h-3 w-3 mr-1" />
                        {formatDuration(sourceVideos[0].duration)}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {sourceVideos[0].segments_count} segments
                    </Badge>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {sourceVideos.length > 3 && (
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search videos by name..."
                            value={sourceVideoSearch}
                            onChange={(e) => setSourceVideoSearch(e.target.value)}
                            className="pl-9 pr-9"
                          />
                          {sourceVideoSearch && (
                            <button
                              onClick={() => setSourceVideoSearch("")}
                              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="flex items-center border rounded-md">
                        <button
                          onClick={() => setSourceVideoViewMode("list")}
                          className={`p-2 transition-colors ${sourceVideoViewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          title="List view"
                        >
                          <List className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setSourceVideoViewMode("grid")}
                          className={`p-2 transition-colors ${sourceVideoViewMode === "grid" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          title="Grid view"
                        >
                          <LayoutGrid className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto pr-1">
                      {sourceVideoViewMode === "list" ? (
                        <div className="space-y-2">
                          {sourceVideos
                            .filter(video => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                            .map(video => (
                            <div
                              key={video.id}
                              className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors ${
                                selectedSourceIds.has(video.id)
                                  ? "bg-primary/5 border-primary/30"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleSourceToggle(video.id)}
                            >
                              <Checkbox
                                checked={selectedSourceIds.has(video.id)}
                                onCheckedChange={() => handleSourceToggle(video.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              {video.thumbnail_path ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`${API_URL}/segments/files/${encodeURIComponent(video.thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                                  alt=""
                                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              ) : (
                                <div className="w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0">
                                  <Film className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{video.name}</p>
                              </div>
                              {video.duration && (
                                <Badge variant="outline" className="text-xs flex-shrink-0">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatDuration(video.duration)}
                                </Badge>
                              )}
                              <Badge variant="secondary" className="text-xs flex-shrink-0">
                                {video.segments_count} segments
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {sourceVideos
                            .filter(video => !sourceVideoSearch.trim() || video.name.toLowerCase().includes(sourceVideoSearch.toLowerCase()))
                            .map(video => (
                            <div
                              key={video.id}
                              className={`relative p-2 rounded-lg border cursor-pointer transition-colors ${
                                selectedSourceIds.has(video.id)
                                  ? "bg-primary/5 border-primary/30"
                                  : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleSourceToggle(video.id)}
                            >
                              <div className="absolute top-1 left-1 z-10">
                                <Checkbox
                                  checked={selectedSourceIds.has(video.id)}
                                  onCheckedChange={() => handleSourceToggle(video.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-background/80"
                                />
                              </div>
                              <div className="aspect-video rounded overflow-hidden bg-muted mb-1.5">
                                {video.thumbnail_path ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={`${API_URL}/segments/files/${encodeURIComponent(video.thumbnail_path?.split('/').pop() || 'placeholder.png')}`}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLImageElement).src = ""; (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Film className="h-6 w-6 text-muted-foreground" />
                                  </div>
                                )}
                              </div>
                              <p className="text-xs font-medium truncate">{video.name}</p>
                              <div className="flex items-center gap-1 mt-1">
                                {video.duration && (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                                    {formatDuration(video.duration)}
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-[10px] px-1 py-0">
                                  {video.segments_count} seg
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground pt-2 border-t">
                      Total segments available: {sourceVideos.filter(v => selectedSourceIds.has(v.id)).reduce((sum, v) => sum + v.segments_count, 0)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Existing TTS banner */}
            {(() => {
              const ttsCount = Object.values(ttsResults).filter(r => !r.generating && !r.stale).length;
              if (ttsCount === 0) return null;
              return (
                <Alert className="border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-green-800 dark:text-green-300">
                      {ttsCount === scripts.length
                        ? "All scripts have voice-over generated"
                        : `${ttsCount} of ${scripts.length} scripts have voice-over. The remaining ${scripts.length - ttsCount} will be generated automatically.`}
                    </span>
                    {selectedSourceIds.size === 0 && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Select a video clip with segments above ↑
                      </span>
                    )}
                  </AlertDescription>
                </Alert>
              );
            })()}

            {/* Reset segment diversity + Preview All button */}
            {(() => {
              const readyTtsCount = Object.values(ttsResults).filter(r => !r.generating && !r.stale).length;
              const allTtsReady = readyTtsCount === scripts.length && scripts.length > 0;
              const previewTargetCount = allTtsReady ? previewCards.length : scripts.length;
              return (
                <div className="space-y-2">
                  <div className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="meta-multiplication-step2"
                        checked={metaMultiplication}
                        onCheckedChange={(checked) => void handleMetaMultiplicationChange(checked === true)}
                      />
                      <Label htmlFor="meta-multiplication-step2" className="text-sm cursor-pointer font-medium">
                        Meta Multiplication before preview
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      {metaMultiplication
                        ? `Preview-ul va genera ${previewCards.length} variante (${scripts.length} scripturi × 2 versiuni Meta).`
                        : "Activează dacă vrei să vezi separat preview-urile Instagram și Facebook înainte de render."}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground hover:text-foreground"
                    disabled={isGenerating || previewingIndex !== null || isRendering || isResettingUsage}
                    onClick={async () => {
                      if (!confirm("Resetezi diversitatea segmentelor? Următoarele preview-uri vor putea reutiliza toate segmentele.")) return;
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
                        toast.success("Diversitatea segmentelor a fost resetată");
                      } catch (err) {
                        handleApiError(err, "Eroare la resetarea diversității");
                      } finally {
                        setIsResettingUsage(false);
                      }
                    }}
                  >
                    {isResettingUsage ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {isResettingUsage ? "Se resetează..." : "Resetează diversitatea segmentelor"}
                  </Button>
                  <Button
                    onClick={handlePreviewAll}
                    disabled={isGenerating || previewingIndex !== null || isRendering || sourceVideos.length === 0 || selectedSourceIds.size === 0}
                    className="w-full"
                    size="lg"
                  >
                    {/* BUG-FE-35: Counter is safe — previewingIndex is only non-null during batched generation when scripts.length > 0 */}
                    {previewingIndex !== null ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {allTtsReady
                          ? `Generating preview ${previewingIndex + 1} of ${previewTargetCount}...`
                          : `Generating voice-over ${(previewCards[previewingIndex]?.baseIndex ?? previewingIndex) + 1} of ${previewTargetCount}...`}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {allTtsReady ? "Generate Previews" : "Generate Voice-Overs"}
                      </>
                    )}
                  </Button>
                </div>
              );
            })()}
            {/* Approval status */}
            {scripts.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className={`font-medium ${approvedScripts.size === scripts.length ? "text-green-600" : "text-muted-foreground"}`}>
                  {approvedScripts.size === 0
                    ? "No scripts approved yet — listen and check the ones you like"
                    : approvedScripts.size === scripts.length
                    ? `All ${scripts.length} scripts approved`
                    : `${approvedScripts.size} of ${scripts.length} scripts approved`}
                </span>
                {approvedScripts.size > 0 && approvedScripts.size < scripts.length && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => setApprovedScripts(new Set(scripts.map((_, i) => i)))}
                  >
                    Approve all
                  </Button>
                )}
              </div>
            )}
            {Object.keys(previews).length > 0 && (
              <Button
                variant="default"
                onClick={() => { setStep(3); setPreviewError(null); }}
                className="w-full bg-green-600 hover:bg-green-700 text-white"
                size="lg"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Voice-overs ready — Continue to Preview
              </Button>
            )}
            {sourceVideos.length > 0 && selectedSourceIds.size === 0 && (
              <p className="text-xs text-destructive text-center">Select at least one source video above</p>
            )}
          </div>
  );
}
