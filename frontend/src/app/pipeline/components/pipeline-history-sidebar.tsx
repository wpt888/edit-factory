"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Clock,
  ChevronRight,
  Trash2,
  Volume2,
  Pause,
} from "lucide-react";
import type { PipelineListItem } from "../pipeline-types";
import type { Dispatch, SetStateAction } from "react";
import { WorkspacePanelHeader } from "./workspace-panel-header";

// Loose ctx-bag type: only fields needing contextual typing for inline
// callbacks are typed precisely; everything else stays `any`.
type PipelineHistorySidebarCtx = {
  historyPipelines: PipelineListItem[];
  historyScripts: string[];
  setExpandedIdeas: Dispatch<SetStateAction<Set<string>>>;
  setHistorySelectedScripts: Dispatch<SetStateAction<Set<number>>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function PipelineHistorySidebar({ ctx }: { ctx: any }) {
  const {
    step,
    historyLoading,
    historyPipelines,
    selectedHistoryId,
    setSelectedHistoryId,
    editingNameId,
    setEditingNameId,
    editingNameValue,
    setEditingNameValue,
    handleSavePipelineName,
    expandedIdeas,
    setExpandedIdeas,
    handleDeletePipeline,
    fetchHistoryScripts,
    historyScriptsLoading,
    historyImporting,
    setPipelineId,
    setScripts,
    historyScripts,
    setHistoryScripts,
    formatScript,
    buildRestoredTts,
    historyTtsInfo,
    historyTtsJobs,
    historyPreviewInfo,
    setTtsResults,
    setApprovedScripts,
    setPipelineName,
    setIdea,
    setProvider,
    setVariantCount,
    setTargetScriptDuration,
    historyContextProducts,
    historyTemplateSettings,
    applyPipelineTemplateSettings,
    setContextProducts,
    setSelectedSourceIds,
    restoreSourceSelection,
    setStep,
    setPreviewError,
    setHistorySelectedScripts,
    historySelectedScripts,
    handleHistoryImport,
    setPreviews,
    playingAudio,
    handlePlayAudio,
  }: PipelineHistorySidebarCtx = ctx;
  const isEditingWorkspace = step >= 1 && step <= 3;

  return (
          <div
            className={`w-full min-w-0 bg-background ${isEditingWorkspace ? "min-[1280px]:h-full min-[1280px]:min-h-0" : ""}`}
            data-testid="pipeline-history-sidebar"
          >
            <Card variant={isEditingWorkspace ? "workspace" : "default"} className={isEditingWorkspace
              ? "gap-0 py-0 min-[1280px]:h-full min-[1280px]:min-h-0 min-[1280px]:py-0"
              : "gap-0 py-0 min-[1280px]:sticky min-[1280px]:top-16"
            }>
              <WorkspacePanelHeader
                icon={Clock}
                title="Script History"
                data-testid="pipeline-history-header"
              />
              <CardContent className={`max-h-[28rem] space-y-2 overflow-y-auto py-3 min-[1280px]:max-h-[calc(100vh-5rem)] ${
                isEditingWorkspace ? "min-[1280px]:min-h-0 min-[1280px]:flex-1 min-[1280px]:max-h-none min-[1280px]:px-3 min-[1280px]:py-3" : ""
              }`}>
                {historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : historyPipelines.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No pipelines yet</p>
                ) : (
                  historyPipelines.map((item) => (
                    <div key={item.pipeline_id} className="space-y-2">
                      <div
                        className={`w-full text-left p-3 rounded-lg border transition-colors hover:bg-accent ${
                          selectedHistoryId === item.pipeline_id ? "border-foreground/20 bg-accent" : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {editingNameId === item.pipeline_id ? (
                              <input
                                autoFocus
                                className="text-sm font-semibold w-full bg-transparent border-b border-primary outline-none px-0 py-0.5"
                                value={editingNameValue}
                                onChange={(e) => setEditingNameValue(e.target.value)}
                                onBlur={() => handleSavePipelineName(item.pipeline_id, editingNameValue)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); handleSavePipelineName(item.pipeline_id, editingNameValue); }
                                  if (e.key === "Escape") { setEditingNameId(null); }
                                }}
                                maxLength={200}
                                placeholder="Script set name..."
                              />
                            ) : (
                              <p
                                className={`text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors ${
                                  item.name ? "" : "text-muted-foreground/50 italic"
                                }`}
                                title={item.name || "Click to add a name"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNameId(item.pipeline_id);
                                  setEditingNameValue(item.name || "");
                                }}
                              >
                                {item.name || "Add name..."}
                              </p>
                            )}
                            <p
                              className={`text-sm text-muted-foreground cursor-pointer ${
                                expandedIdeas.has(item.pipeline_id) ? "whitespace-pre-wrap break-words" : "truncate"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedIdeas(prev => {
                                  const next = new Set(prev);
                                  if (next.has(item.pipeline_id)) next.delete(item.pipeline_id);
                                  else next.add(item.pipeline_id);
                                  return next;
                                });
                              }}
                              title={expandedIdeas.has(item.pipeline_id) ? "Click to collapse" : item.idea}
                            >
                              {expandedIdeas.has(item.pipeline_id)
                                ? item.idea
                                : item.idea.length > 50 ? item.idea.substring(0, 50) + "..." : item.idea
                              }
                            </p>
                            {item.idea.length > 50 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedIdeas(prev => {
                                    const next = new Set(prev);
                                    if (next.has(item.pipeline_id)) next.delete(item.pipeline_id);
                                    else next.add(item.pipeline_id);
                                    return next;
                                  });
                                }}
                                className="text-[11px] text-muted-foreground hover:text-lime mt-0.5 transition-colors"
                              >
                                {expandedIdeas.has(item.pipeline_id) ? "Show less" : "Show more"}
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => handleDeletePipeline(item.pipeline_id, e)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleDeletePipeline(item.pipeline_id, e); } }}
                              className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Delete pipeline"
                            >
                              <Trash2 className="size-3.5" />
                            </span>
                            <ChevronRight
                              className={`size-4 transition-transform cursor-pointer ${
                                selectedHistoryId === item.pipeline_id ? "rotate-90" : ""
                              }`}
                              onClick={() => fetchHistoryScripts(item.pipeline_id)}
                            />
                          </div>
                        </div>
                        <div
                          className="flex items-center gap-2 mt-1 cursor-pointer"
                          onClick={() => fetchHistoryScripts(item.pipeline_id)}
                        >
                          <Badge variant="outline" className="text-xs">{item.provider}</Badge>
                          {(item.generation_job?.status === "queued" || item.generation_job?.status === "processing") && (
                            <Badge variant="secondary" className="text-xs">
                              Generating {Math.round(item.generation_job.progress || 0)}%
                            </Badge>
                          )}
                          {item.generation_job?.status === "failed" && (
                            <Badge variant="destructive" className="text-xs">Generation failed</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {item.variant_count} scripts
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                        </div>
                      </div>

                      {/* Expanded: show scripts with checkboxes */}
                      {selectedHistoryId === item.pipeline_id && (
                        <div className="ml-2 pl-3 border-l border-border space-y-2">
                          {historyScriptsLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : (
                            <>
                              <div className="flex gap-2 pb-1 sticky top-0 bg-background z-10">
                                <Button
                                  size="sm"
                                  className="flex-1"
                                  disabled={historyImporting}
                                  onClick={() => {
                                    // Reuse existing pipeline directly (no duplicate creation)
                                    if (!selectedHistoryId) return;
                                    setPipelineId(selectedHistoryId);
                                    setScripts(historyScripts.map(formatScript));
                                    // Carry over TTS results: prefer tts_info (Step 2) over preview_info (Step 3)
                                    const restored2 = buildRestoredTts(historyTtsInfo, historyPreviewInfo, historyScripts.length, historyTtsJobs);
                                    setTtsResults(restored2.tts);
                                    if (restored2.approved.size > 0) setApprovedScripts(restored2.approved);
                                    // Restore pipeline metadata for "Back to Input"
                                    const histItem = historyPipelines.find(p => p.pipeline_id === selectedHistoryId);
                                    if (histItem) {
                                      if (histItem.name) setPipelineName(histItem.name);
                                      if (histItem.idea) setIdea(histItem.idea);
                                      if (histItem.provider) setProvider(histItem.provider);
                                      if (histItem.variant_count) setVariantCount(histItem.variant_count);
                                      if (histItem.target_script_duration) setTargetScriptDuration(histItem.target_script_duration);
                                    }
                                    setContextProducts(historyContextProducts);
                                    if (historyTemplateSettings) {
                                      applyPipelineTemplateSettings(historyTemplateSettings, selectedHistoryId);
                                    }
                                    // Restore source video selection so product groups load
                                    setSelectedSourceIds(new Set());
                                    restoreSourceSelection(selectedHistoryId);
                                    setStep(2);
                                    setPreviewError(null);
                                    setSelectedHistoryId(null);
                                    setHistoryScripts([]);
                                    setHistorySelectedScripts(new Set());
                                    setPreviews({});
                                    setPreviewError(null);
                                  }}
                                >
                                  {historyImporting ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    "Load All"
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="flex-1"
                                  disabled={historySelectedScripts.size === 0 || historyImporting}
                                  onClick={handleHistoryImport}
                                >
                                  Load Selected ({historySelectedScripts.size})
                                </Button>
                              </div>
                              {historyScripts.map((script, idx) => {
                                const previewInf = historyPreviewInfo[String(idx)];
                                const hasAudio = previewInf?.has_audio;
                                const audioKey = `${item.pipeline_id}-${idx}`;
                                const isPlaying = playingAudio === audioKey;

                                return (
                                  <div key={idx} className="flex items-start gap-2">
                                    <Checkbox
                                      checked={historySelectedScripts.has(idx)}
                                      onCheckedChange={() => {
                                        setHistorySelectedScripts(prev => {
                                          const next = new Set(prev);
                                          if (next.has(idx)) next.delete(idx);
                                          else next.add(idx);
                                          return next;
                                        });
                                      }}
                                      className="mt-0.5"
                                    />
                                    <p className="text-xs text-muted-foreground line-clamp-3 flex-1">
                                      {script}
                                    </p>
                                    {hasAudio && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handlePlayAudio(item.pipeline_id, idx); }}
                                        className={`flex items-center gap-1 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                          isPlaying
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-primary/90 text-primary-foreground hover:bg-primary"
                                        }`}
                                        title={isPlaying ? "Pause audio" : "Play audio preview"}
                                      >
                                        {isPlaying ? (
                                          <Pause className="size-3" />
                                        ) : (
                                          <Volume2 className="size-3" />
                                        )}
                                        <span>{previewInf.audio_duration.toFixed(1)}s</span>
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

          </div>
  );
}
