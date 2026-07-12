"use client";

import { memo } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Sparkles,
  CheckCircle,
  Play,
  ChevronRight,
  Search,
  ChevronDown,
  X,
  Volume2,
  Pause,
  Info,
  Library,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import {
  useDebouncedInput,
  formatDuration,
  countWords,
  WORDS_PER_SECOND,
  analyzeGroupTags,
} from "../pipeline-utils";

// ── ScriptCard — memo'd to avoid re-rendering all cards on every keystroke ──

export interface ProductGroupInfo {
  id: string;
  label: string;
  color: string | null;
  source_video_id: string;
  segments_count: number;
}

export interface TtsResultInfo {
  audio_duration: number;
  generating: boolean;
  stale: boolean;
  srt_content?: string;
  script_word_count?: number;
  srt_word_count?: number;
}

export interface ScriptCardProps {
  index: number;
  script: string;
  isApproved: boolean;
  ttsResult: TtsResultInfo | undefined;
  totalSegmentDuration: number;
  productGroups: ProductGroupInfo[];
  groupTagSearch: string;
  isRegenerating: boolean;
  regeneratingAllScripts: boolean;
  scriptsCount: number;
  playingTtsVariant: number | null;
  ttsAudioDuration: number;
  ttsAudioProgress: number;
  ttsAudioRef: React.RefObject<HTMLAudioElement | null>;
  ttsSeekingRef: React.MutableRefObject<boolean>;
  srtPreviewOpen: boolean;
  libraryMatch: { asset_id: string; audio_duration: number } | undefined;
  pipelineId: string | null;
  onScriptChange: (index: number, value: string) => void;
  onDelete: (index: number) => void;
  onRegenerate: (index: number) => void;
  onGenerateTts: (index: number) => void;
  onPlayTts: (index: number) => void;
  onUseLibraryTts: (index: number) => void;
  onInsertGroupTag: (index: number, label: string) => void;
  onApprove: (index: number, approved: boolean) => void;
  onToggleSrtPreview: (index: number) => void;
  onGroupTagSearchChange: (value: string) => void;
  setTtsAudioProgress: (value: number) => void;
}

export const ScriptCard = memo(function ScriptCard({
  index,
  script,
  isApproved,
  ttsResult,
  totalSegmentDuration,
  productGroups,
  groupTagSearch,
  isRegenerating,
  regeneratingAllScripts,
  scriptsCount,
  playingTtsVariant,
  ttsAudioDuration,
  ttsAudioProgress,
  ttsAudioRef,
  ttsSeekingRef,
  srtPreviewOpen,
  libraryMatch,
  pipelineId,
  onScriptChange,
  onDelete,
  onRegenerate,
  onGenerateTts,
  onPlayTts,
  onUseLibraryTts,
  onInsertGroupTag,
  onApprove,
  onToggleSrtPreview,
  onGroupTagSearchChange,
  setTtsAudioProgress,
}: ScriptCardProps) {
  // Local draft for instant typing — debounced sync to parent
  const { draft, updateDraft, flushDraft } = useDebouncedInput(script, (value) => onScriptChange(index, value), 300);

  // Compute from local draft so badges update instantly while typing
  const wordCount = countWords(draft);
  const estimatedDuration = Math.round(wordCount / WORDS_PER_SECOND);
  const charCount = draft.replace(/\[([^\[\]]+)\]/g, "").length;

  return (
    <Card className={`transition-colors ${isApproved ? "border-success/40 bg-success/5" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-lg">
              Script {index + 1}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {wordCount} words (~{formatDuration(estimatedDuration)})
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {charCount} chars
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground hover:text-primary"
              title="Regenerate this script with AI"
              onClick={() => onRegenerate(index)}
              disabled={isRegenerating || regeneratingAllScripts}
            >
              {isRegenerating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 mr-1" />
              )}
              {isRegenerating ? "Regenerating..." : "Regenerate"}
            </Button>
            {scriptsCount > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Delete script"
                onClick={() => onDelete(index)}
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
        <Textarea
          id={`script-textarea-${index}`}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onBlur={(e) => flushDraft(e.target.value)}
          rows={10}
          className="resize-y font-mono text-sm"
        />

        {/* Insert Group Tag — searchable button grid */}
        {productGroups.length > 0 && (() => {
          const tagStates = analyzeGroupTags(draft);
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
                    onChange={(e) => onGroupTagSearchChange(e.target.value)}
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
                      onClick={() => onInsertGroupTag(index, g.label)}
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
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: g.color }}
                        />
                      )}
                      {g.label}
                      <span className="text-muted-foreground">({g.segments_count})</span>
                      {isPaired && <CheckCircle className="h-3 w-3 text-success flex-shrink-0" />}
                      {isOpen && <span className="text-amber-600 font-bold flex-shrink-0">…</span>}
                    </button>
                  );
                })}
              </div>
              {tagStates.length > 0 && (
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Open</span>
                  <span className="inline-flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 text-success" /> Paired</span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Per-script TTS controls */}
        <div className="flex flex-wrap items-center gap-2">
          {ttsResult?.generating ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </Button>
          ) : ttsResult && !ttsResult.stale ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPlayTts(index)}
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
                {formatDuration(ttsResult.audio_duration)}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGenerateTts(index)}
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
              onClick={() => onGenerateTts(index)}
            >
              <Volume2 className="h-3.5 w-3.5 mr-1.5" />
              {ttsResult?.stale ? "Regenerate Voice-over" : "Generate Voice-over"}
            </Button>
          )}
          {ttsResult?.stale && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
              Script changed — audio outdated
            </Badge>
          )}
          {libraryMatch && !ttsResult && (
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-muted-foreground border-muted-foreground/30 hover:bg-muted"
              onClick={() => onUseLibraryTts(index)}
            >
              <Library className="h-3.5 w-3.5 mr-1.5" />
              Use Library Audio ({formatDuration(libraryMatch.audio_duration)})
            </Button>
          )}
          {ttsResult && !ttsResult.generating && !ttsResult.stale && (
            <div className="ml-auto flex items-center gap-2 rounded-md border border-success/20 bg-success/10 px-2.5 py-1">
              <Checkbox
                id={`approve-script-${index}`}
                checked={isApproved}
                onCheckedChange={(checked) => onApprove(index, checked === true)}
                className="h-4.5 w-4.5 border-success data-[state=checked]:border-success data-[state=checked]:bg-success"
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
        {ttsResult?.srt_content && !ttsResult?.generating && !ttsResult?.stale && (
          <div className="mt-2">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => onToggleSrtPreview(index)}
            >
              {srtPreviewOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Subtitle Preview
              <span className="text-muted-foreground">
                — Script: {ttsResult.script_word_count} words | SRT: {ttsResult.srt_word_count} words
              </span>
              {ttsResult.script_word_count != null && ttsResult.srt_word_count != null && ttsResult.script_word_count! > ttsResult.srt_word_count! && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                  {ttsResult.script_word_count! - ttsResult.srt_word_count!} words missing
                </Badge>
              )}
            </button>
            {srtPreviewOpen && (
              <pre className="mt-1.5 p-2 bg-muted/50 rounded text-[11px] font-mono max-h-48 overflow-y-auto whitespace-pre-wrap border">
                {ttsResult.srt_content}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
});
