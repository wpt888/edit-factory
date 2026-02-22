"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiGet, apiPost } from "@/lib/api";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  Download,
  Film,
  Move,
  Layers,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { EmptyState } from "@/components/empty-state";
import { SegmentTransformPanel } from "@/components/segment-transform-panel";
import type { SegmentTransform } from "@/types/video-processing";
import { DEFAULT_SEGMENT_TRANSFORM } from "@/types/video-processing";
import { apiPut } from "@/lib/api";

interface MatchPreview {
  srt_index: number;
  srt_text: string;
  srt_start: number;
  srt_end: number;
  segment_id: string | null;
  segment_keywords: string[];
  matched_keyword: string | null;
  confidence: number;
}

interface PreviewResponse {
  audio_duration: number;
  srt_content: string;
  matches: MatchPreview[];
  total_phrases: number;
  matched_count: number;
  unmatched_count: number;
}

interface RenderStatus {
  status: "processing" | "completed" | "failed";
  progress: number;
  current_step: string;
  final_video_path?: string;
  error?: string;
}

export default function AssemblyPage() {
  // Input state
  const [scriptText, setScriptText] = useState("");
  const [elevenlabsModel, setElevenlabsModel] = useState("eleven_flash_v2_5");
  const [presetName, setPresetName] = useState("TikTok");

  // Preview state
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Transform override state
  const [transformingMatchIdx, setTransformingMatchIdx] = useState<number | null>(null);
  const [matchTransforms, setMatchTransforms] = useState<Record<string, SegmentTransform>>({});

  // Render state
  const [isRendering, setIsRendering] = useState(false);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatus | null>(null);

  // Poll render status via usePolling
  const renderStatusEndpoint = useMemo(
    () => (renderJobId ? `/assembly/status/${renderJobId}` : ""),
    [renderJobId]
  );

  const { startPolling: startRenderPolling, stopPolling: stopRenderPolling } = usePolling<RenderStatus>({
    endpoint: renderStatusEndpoint,
    interval: 2000,
    enabled: false,
    onData: (data) => {
      setRenderStatus(data);
      if (data.status === "completed" || data.status === "failed") {
        stopRenderPolling();
        setIsRendering(false);
      }
    },
    onError: (err) => {
      console.error("Error polling render status:", err);
    },
  });

  // Start/stop render polling when renderJobId changes
  useEffect(() => {
    if (renderJobId && renderStatus?.status !== "completed" && renderStatus?.status !== "failed") {
      startRenderPolling();
    } else {
      stopRenderPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderJobId]);

  const handlePreview = async () => {
    if (!scriptText.trim()) return;

    setPreviewError(null);
    setIsPreviewLoading(true);
    setPreviewData(null);

    try {
      const res = await apiPost("/assembly/preview", {
        script_text: scriptText.trim(),
        elevenlabs_model: elevenlabsModel,
      });

      if (res.ok) {
        const data = await res.json();
        setPreviewData(data);
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to preview matches" }));
        setPreviewError(errorData.detail || "Failed to preview matches");
      }
    } catch (err) {
      console.error("Error previewing matches:", err);
      setPreviewError("Network error. Please check if the backend is running.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleRender = async () => {
    if (!previewData) return;

    setIsRendering(true);
    setRenderStatus(null);
    setRenderJobId(null);

    try {
      const res = await apiPost("/assembly/render", {
        script_text: scriptText.trim(),
        elevenlabs_model: elevenlabsModel,
        preset_name: presetName,
        subtitle_settings: {
          enable_subtitles: true,
          font_size: 24,
          outline_width: 2,
          position_y: 0.8,
        },
        video_filters: {
          enable_denoise: false,
          enable_sharpen: false,
          enable_color_enhancement: false,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setRenderJobId(data.job_id);
        setRenderStatus({ status: "processing", progress: 0, current_step: "Starting..." });
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Failed to start render" }));
        setPreviewError(errorData.detail || "Failed to start render");
        setIsRendering(false);
      }
    } catch (err) {
      console.error("Error starting render:", err);
      setPreviewError("Network error. Please check if the backend is running.");
      setIsRendering(false);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Film className="h-8 w-8 text-primary" />
            Script-to-Video Assembly
          </h1>
          <p className="text-muted-foreground mt-2">
            Match your script to video segments and render the final video
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Script Input */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Script Input</CardTitle>
                <CardDescription>
                  Enter your script and configure TTS settings
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Script textarea */}
                <div className="space-y-2">
                  <Label htmlFor="script">Script Text *</Label>
                  <Textarea
                    id="script"
                    placeholder="Paste or type your script here..."
                    rows={10}
                    value={scriptText}
                    onChange={(e) => setScriptText(e.target.value)}
                    className="resize-y font-mono text-sm"
                  />
                </div>

                {/* ElevenLabs model selector */}
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

                {/* Error display */}
                {previewError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{previewError}</AlertDescription>
                  </Alert>
                )}

                {/* Preview button */}
                <Button
                  onClick={handlePreview}
                  disabled={!scriptText.trim() || isPreviewLoading}
                  className="w-full"
                  size="lg"
                >
                  {isPreviewLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Previewing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Preview Matches
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Preview & Render */}
          <div className="space-y-6">
            {!previewData ? (
              // Empty state
              <EmptyState
                icon={<Layers className="h-6 w-6" />}
                title="Niciun assembly"
                description="Creeaza un assembly pentru a combina segmente."
              />
            ) : (
              <>
                {/* Summary stats */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Match Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Audio Duration</p>
                        <p className="text-2xl font-bold">{formatDuration(previewData.audio_duration)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total Phrases</p>
                        <p className="text-2xl font-bold">{previewData.total_phrases}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Matched</p>
                        <p className="text-2xl font-bold text-green-600">{previewData.matched_count}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Unmatched</p>
                        <p className="text-2xl font-bold text-red-600">{previewData.unmatched_count}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Match list */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Segment Matches</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3 max-h-[400px] overflow-y-auto">
                      {previewData.matches.map((match, index) => {
                        const isMatched = match.confidence > 0;
                        const textPreview = match.srt_text.length > 50
                          ? match.srt_text.substring(0, 50) + "..."
                          : match.srt_text;
                        const segKey = match.segment_id || `unmatched-${index}`;
                        const hasOverride = !!matchTransforms[segKey];

                        return (
                          <div
                            key={index}
                            className="p-3 border rounded-lg space-y-2 text-sm"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="font-medium">#{match.srt_index}</p>
                                <p className="text-muted-foreground">{textPreview}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatTime(match.srt_start)} - {formatTime(match.srt_end)}
                                </p>
                              </div>
                              <div className="ml-2 flex items-center gap-1">
                                {isMatched && (
                                  <Button
                                    variant={hasOverride ? "default" : "ghost"}
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => setTransformingMatchIdx(transformingMatchIdx === index ? null : index)}
                                    title="Segment transforms"
                                  >
                                    <Move className="h-3 w-3" />
                                  </Button>
                                )}
                                {isMatched ? (
                                  <Badge variant="default" className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3" />
                                    {match.matched_keyword} ({Math.round(match.confidence * 100)}%)
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="flex items-center gap-1">
                                    <XCircle className="h-3 w-3" />
                                    No match
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {/* Transform panel (inline) */}
                            {transformingMatchIdx === index && isMatched && match.segment_id && (
                              <div className="pt-2 border-t">
                                <SegmentTransformPanel
                                  transforms={matchTransforms[segKey] || { ...DEFAULT_SEGMENT_TRANSFORM }}
                                  onChange={(t) => setMatchTransforms((prev) => ({ ...prev, [segKey]: t }))}
                                  onSave={async (t) => {
                                    try {
                                      await apiPut(`/segments/${match.segment_id}/transforms`, t);
                                      setMatchTransforms((prev) => ({ ...prev, [segKey]: t }));
                                      setTransformingMatchIdx(null);
                                    } catch (err) {
                                      console.error("Failed to save transforms:", err);
                                    }
                                  }}
                                  isOverride={true}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Render section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Render Video</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Export preset selector */}
                    <div className="space-y-2">
                      <Label htmlFor="preset">Export Preset</Label>
                      <Select value={presetName} onValueChange={setPresetName}>
                        <SelectTrigger id="preset">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TikTok">TikTok (1080x1920)</SelectItem>
                          <SelectItem value="Instagram Reels">Instagram Reels (1080x1920)</SelectItem>
                          <SelectItem value="YouTube Shorts">YouTube Shorts (1080x1920)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Render button */}
                    <Button
                      onClick={handleRender}
                      disabled={isRendering}
                      className="w-full"
                      size="lg"
                    >
                      {isRendering ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Rendering...
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4 mr-2" />
                          Assemble & Render
                        </>
                      )}
                    </Button>

                    {/* Render progress */}
                    {renderStatus && (
                      <div className="space-y-3 pt-4 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Progress</span>
                          <Badge
                            variant={
                              renderStatus.status === "completed"
                                ? "default"
                                : renderStatus.status === "failed"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {renderStatus.status}
                          </Badge>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full bg-secondary rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all"
                            style={{ width: `${renderStatus.progress}%` }}
                          />
                        </div>

                        <p className="text-sm text-muted-foreground">
                          {renderStatus.current_step}
                        </p>

                        {/* Completed - download link */}
                        {renderStatus.status === "completed" && renderStatus.final_video_path && (
                          <Button variant="outline" className="w-full" asChild>
                            <a
                              href={`http://localhost:8000/api/v1/library/files/${encodeURIComponent(renderStatus.final_video_path)}`}
                              download
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download Video
                            </a>
                          </Button>
                        )}

                        {/* Failed - error message */}
                        {renderStatus.status === "failed" && renderStatus.error && (
                          <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{renderStatus.error}</AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
