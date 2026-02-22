"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Check,
  X,
  Play,
  Download,
  RefreshCw,
  Film,
  Upload,
  Loader2,
  CheckCircle2,
  Clock,
  Scissors,
  Share2,
  Pencil,
  FolderOpen,
  FileText,
  Wand2,
  Timer,
  Volume2,
  VolumeX,
  Settings,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { API_URL } from "@/lib/api";
import { Clip, Project, Segment } from "./types";

// Format time as mm:ss
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// Get Postiz publishing status badge
function getPostizStatusBadge(clip: Clip) {
  const status = clip.postiz_status || "not_sent";
  switch (status) {
    case "sent":
      return {
        color: "bg-green-500 text-white",
        label: "Trimis",
        icon: <CheckCircle2 className="h-3 w-3 mr-1" />,
      };
    case "scheduled":
      return {
        color: "bg-blue-500 text-white",
        label: "Programat",
        icon: <Clock className="h-3 w-3 mr-1" />,
      };
    case "not_sent":
    default:
      return {
        color: "bg-muted text-muted-foreground",
        label: "Netrimis",
        icon: null,
      };
  }
}

// Invisible component that polls a single clip status using usePolling
function ClipStatusPoller({
  clipId,
  onStatusUpdate,
  onComplete,
}: {
  clipId: string;
  onStatusUpdate: (clip: Clip) => void;
  onComplete: () => void;
}) {
  usePolling<{ clip: Clip }>({
    endpoint: `/library/clips/${clipId}`,
    interval: 2000,
    enabled: true,
    onData: (data) => {
      onStatusUpdate(data.clip);
      if (
        data.clip.final_status === "completed" ||
        data.clip.final_status === "failed"
      ) {
        onComplete();
      }
    },
    shouldStop: (data) =>
      data.clip.final_status === "completed" || data.clip.final_status === "failed",
  });
  return null; // Invisible component, just for polling
}

interface ClipGalleryProps {
  selectedProject: Project | null;
  clips: Clip[];
  selectedClip: Clip | null;
  generating: boolean;
  generationProgress: {
    percentage: number;
    currentStep: string | null;
    estimatedRemaining: number | null;
  } | null;
  elapsedTime: number;
  generationMode: "ai" | "segments";
  setGenerationMode: (mode: "ai" | "segments") => void;
  projectSegments: Segment[];
  setProjectSegments: (segments: Segment[] | ((prev: Segment[]) => Segment[])) => void;
  variantCount: number;
  setVariantCount: (count: number) => void;
  uploadVideo: File | null;
  setUploadVideo: (file: File | null) => void;
  localVideoPath: string;
  setLocalVideoPath: (path: string) => void;
  // Workflow state
  workflowMode: "video_only" | "with_audio";
  setWorkflowMode: (mode: "video_only" | "with_audio") => void;
  scriptText: string;
  setScriptText: (text: string) => void;
  generateTts: boolean;
  setGenerateTts: (v: boolean) => void;
  muteSourceVoice: boolean;
  setMuteSourceVoice: (v: boolean) => void;
  durationMode: "auto" | "manual";
  setDurationMode: (mode: "auto" | "manual") => void;
  manualDuration: number;
  setManualDuration: (v: number) => void;
  ttsPreviewDuration: number | null;
  setTtsPreviewDuration: (v: number | null) => void;
  selectionMode: "random" | "sequential" | "weighted";
  setSelectionMode: (mode: "random" | "sequential" | "weighted") => void;
  targetDuration: number;
  // Rename state
  renamingClipId: string | null;
  setRenamingClipId: (id: string | null) => void;
  renameValue: string;
  setRenameValue: (v: string) => void;
  // Rendering state
  rendering: boolean;
  setRendering: (v: boolean) => void;
  renderingClipIds: string[];
  setRenderingClipIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  // Event handlers
  onSelectClip: (clip: Clip) => void;
  onGenerateAI: () => void;
  onGenerateSegments: () => void;
  onCancelGeneration: () => void;
  onToggleSelection: (clipId: string, selected: boolean) => void;
  onDeleteClip: (clip: Clip) => void;
  onOpenSegmentModal: () => void;
  onOpenPostizModal: (clip: Clip) => void;
  onOpenBulkPostizModal: () => void;
  onRenameClip: (clipId: string, newName: string) => void;
  onResetProject: () => void;
  onClipStatusUpdate: (clip: Clip) => void;
}

export function ClipGallery({
  selectedProject,
  clips,
  selectedClip,
  generating,
  generationProgress,
  elapsedTime,
  generationMode,
  setGenerationMode,
  projectSegments,
  setProjectSegments,
  variantCount,
  setVariantCount,
  uploadVideo,
  setUploadVideo,
  localVideoPath,
  setLocalVideoPath,
  workflowMode,
  setWorkflowMode,
  scriptText,
  setScriptText,
  generateTts,
  setGenerateTts,
  muteSourceVoice,
  setMuteSourceVoice,
  durationMode,
  setDurationMode,
  manualDuration,
  setManualDuration,
  ttsPreviewDuration,
  setTtsPreviewDuration,
  selectionMode,
  setSelectionMode,
  targetDuration,
  renamingClipId,
  setRenamingClipId,
  renameValue,
  setRenameValue,
  rendering,
  setRendering,
  renderingClipIds,
  setRenderingClipIds,
  onSelectClip,
  onGenerateAI,
  onGenerateSegments,
  onCancelGeneration,
  onToggleSelection,
  onDeleteClip,
  onOpenSegmentModal,
  onOpenPostizModal,
  onOpenBulkPostizModal,
  onRenameClip,
  onResetProject,
  onClipStatusUpdate,
}: ClipGalleryProps) {
  const handleClipComplete = (clipId: string) => {
    setRenderingClipIds((prev) => prev.filter((id) => id !== clipId));
    if (renderingClipIds.length <= 1) {
      setRendering(false);
    }
  };

  if (!selectedProject) {
    return (
      <Card className="bg-card border-border h-full flex items-center justify-center">
        <div className="text-center py-12">
          <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Selectează un proiect sau creează unul nou</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Invisible clip status pollers — one per rendering clip */}
      {renderingClipIds.map((clipId) => (
        <ClipStatusPoller
          key={clipId}
          clipId={clipId}
          onStatusUpdate={onClipStatusUpdate}
          onComplete={() => handleClipComplete(clipId)}
        />
      ))}

      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-foreground">
              {selectedProject.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              {/* Segment mode button */}
              <Button
                onClick={onOpenSegmentModal}
                variant="outline"
                className="border-primary text-primary hover:bg-primary/10"
              >
                <Scissors className="h-4 w-4 mr-2" />
                Segmente
                {projectSegments.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {projectSegments.length}
                  </Badge>
                )}
              </Button>
              <Button
                onClick={onOpenBulkPostizModal}
                disabled={clips.filter((c) => c.final_video_path).length === 0}
                variant="outline"
                className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Postiz ({clips.filter((c) => c.final_video_path).length})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Draft state */}
          {selectedProject.status === "draft" && (
            <div className="border-2 border-dashed border-border rounded-lg p-8">
              {/* Generation Mode Toggle */}
              <div className="flex justify-center mb-6">
                <div className="inline-flex rounded-lg border border-border p-1 bg-muted/50">
                  <button
                    onClick={() => setGenerationMode("ai")}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      generationMode === "ai"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Film className="h-4 w-4 inline-block mr-2" />
                    Video + AI
                  </button>
                  <button
                    onClick={() => setGenerationMode("segments")}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      generationMode === "segments"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Scissors className="h-4 w-4 inline-block mr-2" />
                    Din Segmente
                  </button>
                </div>
              </div>

              {/* AI Mode - Upload Video */}
              {generationMode === "ai" && (
                <div className="text-center">
                  <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-foreground mb-4">
                    Încarcă un video sursă pentru a genera clipuri
                  </p>
                  <div className="flex flex-col items-center gap-4">
                    <Input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setUploadVideo(e.target.files?.[0] || null)}
                      className="max-w-md bg-muted/50"
                    />
                    <div className="flex items-center gap-4 w-full max-w-md">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-muted-foreground text-sm">SAU</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="w-full max-w-md">
                      <Label className="text-muted-foreground text-xs mb-1 block">
                        Cale video local (pentru teste):
                      </Label>
                      <Input
                        type="text"
                        placeholder="C:\path\to\video.mp4"
                        value={localVideoPath}
                        onChange={(e) => setLocalVideoPath(e.target.value)}
                        className="bg-muted/50 text-sm"
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <Label className="text-foreground">Variante:</Label>
                      <Input
                        type="number"
                        min={1}
                        max={10}
                        value={variantCount}
                        onChange={(e) => setVariantCount(parseInt(e.target.value) || 3)}
                        className="w-20 bg-muted/50"
                      />
                    </div>
                    <Button
                      onClick={onGenerateAI}
                      disabled={(!uploadVideo && !localVideoPath) || generating}
                    >
                      {generating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generare...
                        </>
                      ) : (
                        <>
                          <Film className="h-4 w-4 mr-2" />
                          Generează Clipuri
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Segments Mode */}
              {generationMode === "segments" && (
                <div className="space-y-6">
                  <div className="text-center border-b pb-4">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Scissors className="h-6 w-6 text-primary" />
                      <h3 className="text-lg font-semibold">Generare din Segmente</h3>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Pașii: 1. Selectează segmente → 2. Alege opțiuni → 3. Generează
                    </p>
                  </div>

                  {/* Selected Segments List */}
                  <div className="bg-muted/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        Segmente Selectate ({projectSegments.length})
                      </h4>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={onOpenSegmentModal}>
                          <Plus className="h-4 w-4 mr-1" />
                          Adaugă
                        </Button>
                        {projectSegments.length > 0 && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setProjectSegments([]);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Șterge Tot
                          </Button>
                        )}
                      </div>
                    </div>

                    {projectSegments.length === 0 ? (
                      <div className="text-center py-6 border-2 border-dashed border-muted-foreground/30 rounded-lg">
                        <Scissors className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-muted-foreground">Niciun segment selectat</p>
                        <Button
                          variant="link"
                          onClick={onOpenSegmentModal}
                          className="mt-2"
                        >
                          Click pentru a selecta segmente →
                        </Button>
                      </div>
                    ) : (
                      <div className="max-h-48 overflow-y-auto space-y-2">
                        {projectSegments.map((segment) => (
                          <div
                            key={segment.id}
                            className="flex items-center justify-between p-2 bg-background rounded border"
                          >
                            <div className="flex items-center gap-3">
                              <Film className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-sm font-medium">
                                  {segment.source_video_name || "Video"}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {formatTime(segment.start_time)} -{" "}
                                  {formatTime(segment.end_time)} (
                                  {segment.duration?.toFixed(1)}s)
                                </p>
                              </div>
                              {segment.keywords && segment.keywords.length > 0 && (
                                <div className="flex gap-1">
                                  {segment.keywords.slice(0, 2).map((kw) => (
                                    <Badge key={kw} variant="secondary" className="text-xs">
                                      {kw}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => {
                                setProjectSegments((prev) =>
                                  prev.filter((s) => s.id !== segment.id)
                                );
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Generating state */}
          {(selectedProject.status === "generating" || generating) && (
            <div className="py-8 px-4">
              <div className="max-w-md mx-auto space-y-6">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
                  <p className="text-foreground font-medium text-lg">Se generează clipurile...</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Progress</span>
                    <span className="font-mono">{generationProgress?.percentage || 0}%</span>
                  </div>
                  <Progress value={generationProgress?.percentage || 0} className="h-3" />
                </div>

                {generationProgress?.currentStep && (
                  <div className="bg-muted/50 rounded-lg p-3">
                    <p className="text-sm text-muted-foreground">Pas curent:</p>
                    <p className="text-foreground font-medium truncate">
                      {generationProgress.currentStep}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 text-center">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mb-1">
                      <Clock className="h-4 w-4" />
                      <span>Timp trecut</span>
                    </div>
                    <p className="text-foreground font-mono text-xl">
                      {formatTime(elapsedTime)}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mb-1">
                      <Clock className="h-4 w-4" />
                      <span>Timp estimat</span>
                    </div>
                    <p className="text-foreground font-mono text-xl">
                      {generationProgress?.estimatedRemaining
                        ? formatTime(generationProgress.estimatedRemaining)
                        : "--:--"}
                    </p>
                  </div>
                </div>

                <div className="text-center pt-2">
                  <Button
                    variant="outline"
                    onClick={onCancelGeneration}
                    className="text-destructive border-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Oprește Generarea
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Empty state — option to reset to draft */}
          {clips.length === 0 && !generating && selectedProject.status !== "draft" && (
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Film className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-foreground mb-2">
                Nu există clipuri în acest proiect
              </p>
              <p className="text-muted-foreground text-sm mb-4">
                Toate clipurile au fost șterse. Resetează proiectul pentru a genera clipuri noi.
              </p>
              <Button onClick={onResetProject}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Resetează pentru Generare Nouă
              </Button>
            </div>
          )}

          {/* Clips grid */}
          {(selectedProject.status === "ready_for_triage" ||
            selectedProject.status === "processing_finals" ||
            selectedProject.status === "completed" ||
            selectedProject.status === "failed" ||
            selectedProject.status === "draft") &&
            clips.length > 0 &&
            !generating && (
              <div className="grid grid-cols-3 gap-4 max-h-[calc(100vh-350px)] overflow-y-auto">
                {clips.map((clip) => (
                  <div
                    key={clip.id}
                    onClick={() => onSelectClip(clip)}
                    className={`relative rounded-lg overflow-hidden cursor-pointer transition-all ${
                      selectedClip?.id === clip.id
                        ? "ring-2 ring-primary"
                        : "hover:ring-1 hover:ring-border"
                    } ${clip.is_selected ? "ring-2 ring-primary" : ""}`}
                  >
                    {/* Thumbnail or placeholder */}
                    <div className="aspect-[9/16] bg-muted relative">
                      {clip.thumbnail_path ? (
                        <img
                          src={`${API_URL}/library/files/${encodeURIComponent(
                            clip.thumbnail_path
                          )}?v=${clip.id}`}
                          alt={clip.variant_name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}

                      {/* Selection checkbox */}
                      {clip.is_selected && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleSelection(clip.id, false);
                          }}
                          className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer bg-primary text-primary-foreground shadow-md"
                        >
                          <Check className="h-4 w-4" />
                        </div>
                      )}

                      {/* Postiz publishing status badge */}
                      {(() => {
                        const postizBadge = getPostizStatusBadge(clip);
                        return (
                          <Badge
                            className={`absolute top-2 right-2 ${postizBadge.color}`}
                          >
                            {postizBadge.icon}
                            {postizBadge.label}
                          </Badge>
                        );
                      })()}

                      {/* Duration */}
                      {clip.duration && (
                        <span className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs px-2 py-1 rounded">
                          {Math.floor(clip.duration)}s
                        </span>
                      )}

                      {/* Actions overlay */}
                      <div className="absolute inset-0 bg-background/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            const videoPath = clip.final_video_path || clip.raw_video_path;
                            if (videoPath) {
                              window.open(
                                `${API_URL}/library/files/${encodeURIComponent(
                                  videoPath
                                )}?v=${clip.id}`,
                                "_blank"
                              );
                            }
                          }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                        {clip.final_video_path && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(
                                  `${API_URL}/library/files/${encodeURIComponent(
                                    clip.final_video_path || ""
                                  )}?download=true&v=${clip.id}`,
                                  "_blank"
                                );
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-none hover:from-pink-600 hover:to-purple-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenPostizModal(clip);
                              }}
                            >
                              <Share2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteClip(clip);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Clip info with rename */}
                    <div className="p-2 bg-card">
                      {renamingClipId === clip.id ? (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="h-6 text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onRenameClip(clip.id, renameValue);
                              } else if (e.key === "Escape") {
                                setRenamingClipId(null);
                                setRenameValue("");
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => onRenameClip(clip.id, renameValue)}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0"
                            onClick={() => {
                              setRenamingClipId(null);
                              setRenameValue("");
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingClipId(clip.id);
                            setRenameValue(
                              clip.variant_name || `Varianta ${clip.variant_index}`
                            );
                          }}
                          title="Click pentru a redenumi"
                        >
                          <p className="text-foreground text-sm truncate flex-1">
                            {clip.variant_name || `Varianta ${clip.variant_index}`}
                          </p>
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

          {/* Workflow Steps Panel */}
          {projectSegments.length > 0 && !generating && selectedProject.status !== "generating" && (
            <div className="mt-6 border-t pt-6 space-y-4">
              {/* STEP 1: Script & Audio */}
              <div className="bg-secondary/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-secondary/50 flex items-center justify-center">
                      <FileText className="h-4 w-4 text-secondary-foreground" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground text-sm">Pas 1: Script & Audio</h4>
                      <p className="text-xs text-muted-foreground">Opțional - pentru voiceover sincronizat</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="workflow-mode" className="text-xs">Cu Audio</Label>
                      <Switch
                        id="workflow-mode"
                        checked={workflowMode === "with_audio"}
                        onCheckedChange={(checked) => {
                          setWorkflowMode(checked ? "with_audio" : "video_only");
                          if (checked) {
                            setDurationMode("auto");
                          } else {
                            setDurationMode("manual");
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-2 border-l pl-3 border-border/50">
                      <VolumeX className="h-4 w-4 text-orange-400" />
                      <Label htmlFor="mute-source" className="text-xs cursor-pointer whitespace-nowrap">
                        Elimină vocea sursă
                      </Label>
                      <Switch
                        id="mute-source"
                        checked={muteSourceVoice}
                        onCheckedChange={setMuteSourceVoice}
                      />
                    </div>
                  </div>
                </div>

                {workflowMode === "with_audio" && (
                  <div className="space-y-3 mt-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs text-muted-foreground">Script pentru voiceover</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          disabled
                          title="Coming soon"
                        >
                          <Wand2 className="h-3 w-3 mr-1" />
                          Generează cu AI
                        </Button>
                      </div>
                      <Textarea
                        value={scriptText}
                        onChange={(e) => setScriptText(e.target.value)}
                        placeholder="Scrie textul pentru voiceover aici..."
                        className="min-h-[80px] text-sm resize-y"
                      />
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">
                          {scriptText.length} caractere
                          {scriptText.length > 0 && (
                            <span className="text-primary ml-1">
                              (~{Math.ceil(scriptText.length / 150)}s audio)
                            </span>
                          )}
                        </span>
                        {scriptText.length > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => {
                              const estimatedDuration = Math.ceil(scriptText.length / 150);
                              setTtsPreviewDuration(estimatedDuration);
                              setDurationMode("auto");
                            }}
                          >
                            <Timer className="h-3 w-3 mr-1" />
                            Setează durată auto
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 p-2 bg-background/50 rounded">
                      <div className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4 text-muted-foreground" />
                        <Label htmlFor="generate-tts" className="text-xs cursor-pointer">
                          Generează TTS
                        </Label>
                        <Switch
                          id="generate-tts"
                          checked={generateTts}
                          onCheckedChange={setGenerateTts}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* STEP 2: Duration Control */}
              <div className="bg-secondary/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-secondary/50 flex items-center justify-center">
                      <Timer className="h-4 w-4 text-secondary-foreground" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground text-sm">Pas 2: Durată Video</h4>
                      <p className="text-xs text-muted-foreground">
                        {durationMode === "auto" ? "Determinată de audio" : "Setată manual"}
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={durationMode === "auto" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {targetDuration}s
                  </Badge>
                </div>

                <div className="space-y-3">
                  <ToggleGroup
                    type="single"
                    value={durationMode}
                    onValueChange={(value) => {
                      if (value) setDurationMode(value as "auto" | "manual");
                    }}
                    variant="outline"
                    size="sm"
                    spacing={0}
                  >
                    <ToggleGroupItem value="manual" className="text-xs">
                      Manual
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="auto"
                      disabled={!scriptText || scriptText.length === 0}
                      className="text-xs"
                    >
                      Auto (din script)
                    </ToggleGroupItem>
                  </ToggleGroup>

                  {durationMode === "manual" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Durată țintă</Label>
                        <span className="text-sm font-mono">{manualDuration}s</span>
                      </div>
                      <Slider
                        value={[manualDuration]}
                        onValueChange={([v]) => setManualDuration(v)}
                        min={5}
                        max={120}
                        step={1}
                        className="w-full"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>5s</span>
                        <span>120s</span>
                      </div>
                    </div>
                  )}

                  {durationMode === "auto" && ttsPreviewDuration && (
                    <div className="p-2 bg-primary/10 rounded text-xs text-primary">
                      Video-ul va fi tăiat la {ttsPreviewDuration}s pentru a se potrivi cu audio-ul
                    </div>
                  )}
                </div>
              </div>

              {/* STEP 3: Segment Generation Panel */}
              <div className="bg-secondary/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <Scissors className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground text-sm">Pas 3: Generare Video</h4>
                      <p className="text-xs text-muted-foreground">
                        {projectSegments.length} segmente • Durată țintă: {targetDuration}s
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={onOpenSegmentModal}>
                    <Settings className="h-4 w-4 mr-1" />
                    Editează
                  </Button>
                </div>

                {/* Segment list preview */}
                <div className="mb-4 max-h-32 overflow-y-auto space-y-1">
                  {projectSegments.slice(0, 5).map((seg) => (
                    <div
                      key={seg.id}
                      className="flex items-center justify-between text-sm p-2 bg-background/50 rounded"
                    >
                      <span className="truncate">{seg.source_video_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTime(seg.start_time)} - {formatTime(seg.end_time)}
                      </span>
                    </div>
                  ))}
                  {projectSegments.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center">
                      ... și încă {projectSegments.length - 5} segmente
                    </p>
                  )}
                </div>

                {/* Generation options */}
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Variante:</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={variantCount}
                      onChange={(e) => setVariantCount(parseInt(e.target.value) || 6)}
                      className="w-16 h-8"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Mod:</Label>
                    <Select
                      value={selectionMode}
                      onValueChange={(v) =>
                        setSelectionMode(v as "random" | "sequential" | "weighted")
                      }
                    >
                      <SelectTrigger className="w-28 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="random">Aleator</SelectItem>
                        <SelectItem value="sequential">Secvențial</SelectItem>
                        <SelectItem value="weighted">Ponderat</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Generate button */}
                <Button
                  onClick={onGenerateSegments}
                  size="lg"
                  variant="default"
                  className="w-full font-semibold py-6 shadow-md hover:shadow-lg transition-shadow"
                >
                  <Play className="h-5 w-5 mr-2" />
                  GENEREAZĂ {variantCount} VARIANTE DIN SEGMENTE
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
