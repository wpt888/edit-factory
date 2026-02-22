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
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet, apiPost, handleApiError } from "@/lib/api";
import {
  Loader2,
  Sparkles,
  AlertCircle,
  CheckCircle,
  XCircle,
  Play,
  Download,
  Film,
  ArrowLeft,
  ArrowRight,
  Workflow,
} from "lucide-react";
import { usePolling } from "@/hooks";
import { EmptyState } from "@/components/empty-state";

// TypeScript interfaces
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

interface PreviewData {
  audio_duration: number;
  srt_content: string;
  matches: MatchPreview[];
  total_phrases: number;
  matched_count: number;
  unmatched_count: number;
}

interface VariantStatus {
  variant_index: number;
  status: "not_started" | "processing" | "completed" | "failed";
  progress: number;
  current_step: string;
  final_video_path?: string;
  error?: string;
}

export default function PipelinePage() {
  // Step tracking
  const [step, setStep] = useState(1);

  // Step 1: Input
  const [idea, setIdea] = useState("");
  const [context, setContext] = useState("");
  const [variantCount, setVariantCount] = useState(3);
  const [provider, setProvider] = useState("gemini");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2: Scripts
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [scripts, setScripts] = useState<string[]>([]);

  // Step 3: Preview
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Record<number, PreviewData>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [elevenlabsModel, setElevenlabsModel] = useState("eleven_flash_v2_5");

  // Step 4: Render
  const [selectedVariants, setSelectedVariants] = useState<Set<number>>(new Set());
  const [isRendering, setIsRendering] = useState(false);
  const [variantStatuses, setVariantStatuses] = useState<VariantStatus[]>([]);
  const [presetName, setPresetName] = useState("TikTok");

  // Format helpers
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

  const countWords = (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  };

  // Poll render status via usePolling
  const renderStatusEndpoint = useMemo(
    () => (pipelineId ? `/pipeline/status/${pipelineId}` : ""),
    [pipelineId]
  );

  const { startPolling: startRenderPolling, stopPolling: stopRenderPolling } = usePolling<{
    variants: VariantStatus[];
  }>({
    endpoint: renderStatusEndpoint,
    interval: 2000,
    enabled: false,
    onData: (data) => {
      const variants = data.variants || [];
      setVariantStatuses(variants);
      const allComplete = variants.every(
        (v) => v.status === "completed" || v.status === "failed"
      );
      if (allComplete && variants.length > 0) {
        stopRenderPolling();
        setIsRendering(false);
      }
    },
    onError: (err) => {
      handleApiError(err, "Eroare la actualizarea statusului pipeline");
    },
  });

  // Start/stop render polling when isRendering/step changes
  useEffect(() => {
    if (pipelineId && isRendering && step === 4) {
      startRenderPolling();
    } else {
      stopRenderPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, isRendering, step]);

  // Step 1: Generate scripts
  const handleGenerate = async () => {
    if (!idea.trim()) return;

    setError(null);
    setIsGenerating(true);

    try {
      const res = await apiPost("/pipeline/generate", {
        idea: idea.trim(),
        context: context.trim() || undefined,
        variant_count: variantCount,
        provider,
      });

      if (res.ok) {
        const data = await res.json();
        setPipelineId(data.pipeline_id);
        setScripts(data.scripts || []);
        setStep(2);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to generate scripts",
        }));
        setError(errorData.detail || "Failed to generate scripts");
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea scripturilor");
      setError("Network error. Please check if the backend is running.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Step 2: Preview all matches
  const handlePreviewAll = async () => {
    if (!pipelineId) return;

    setPreviewError(null);
    const newPreviews: Record<number, PreviewData> = {};

    for (let i = 0; i < scripts.length; i++) {
      setPreviewingIndex(i);
      try {
        const res = await apiPost(`/pipeline/preview/${pipelineId}/${i}`, {
          elevenlabs_model: elevenlabsModel,
        });

        if (res.ok) {
          const data = await res.json();
          newPreviews[i] = data;
        } else {
          const errorData = await res.json().catch(() => ({
            detail: `Failed to preview variant ${i + 1}`,
          }));
          setPreviewError(errorData.detail || `Failed to preview variant ${i + 1}`);
          setPreviewingIndex(null);
          return;
        }
      } catch (err) {
        handleApiError(err, "Eroare la previzualizarea variantelor");
        setPreviewError("Network error. Please check if the backend is running.");
        setPreviewingIndex(null);
        return;
      }
    }

    setPreviews(newPreviews);
    setPreviewingIndex(null);

    // Select all variants by default
    const allIndices = new Set(scripts.map((_, i) => i));
    setSelectedVariants(allIndices);

    setStep(3);
  };

  // Step 3: Render selected variants
  const handleRender = async () => {
    if (!pipelineId || selectedVariants.size === 0) return;

    setIsRendering(true);
    setVariantStatuses([]);

    try {
      const res = await apiPost(`/pipeline/render/${pipelineId}`, {
        variant_indices: Array.from(selectedVariants),
        preset_name: presetName,
        elevenlabs_model: elevenlabsModel,
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
        setVariantStatuses(data.variants || []);
        setStep(4);
      } else {
        const errorData = await res.json().catch(() => ({
          detail: "Failed to start render",
        }));
        setPreviewError(errorData.detail || "Failed to start render");
        setIsRendering(false);
      }
    } catch (err) {
      handleApiError(err, "Eroare la generarea variantelor");
      setPreviewError("Network error. Please check if the backend is running.");
      setIsRendering(false);
    }
  };

  // Reset all state
  const resetPipeline = () => {
    setStep(1);
    setIdea("");
    setContext("");
    setVariantCount(3);
    setProvider("gemini");
    setError(null);
    setPipelineId(null);
    setScripts([]);
    setPreviews({});
    setPreviewError(null);
    setSelectedVariants(new Set());
    setIsRendering(false);
    setVariantStatuses([]);
  };

  // Toggle variant selection
  const toggleVariant = (index: number) => {
    setSelectedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Film className="h-8 w-8 text-primary" />
            Multi-Variant Pipeline
          </h1>
          <p className="text-muted-foreground mt-2">
            End-to-end workflow: generate scripts → preview matches → batch render
          </p>
        </div>

        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {[
              { num: 1, label: "Idea Input" },
              { num: 2, label: "Review Scripts" },
              { num: 3, label: "Preview Matches" },
              { num: 4, label: "Render Videos" },
            ].map((s, index) => (
              <div key={s.num} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                      step === s.num
                        ? "bg-primary text-primary-foreground"
                        : step > s.num
                        ? "bg-green-600 text-white"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {step > s.num ? <CheckCircle className="h-5 w-5" /> : s.num}
                  </div>
                  <p
                    className={`text-xs mt-2 ${
                      step === s.num ? "font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </p>
                </div>
                {index < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 ${
                      step > s.num ? "bg-green-600" : "bg-secondary"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step 1 — Idea Input */}
        {step === 1 && (
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Video Idea</CardTitle>
                <CardDescription>
                  Describe your video idea and configure generation options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Idea textarea */}
                <div className="space-y-2">
                  <Label htmlFor="idea">Video Idea *</Label>
                  <Textarea
                    id="idea"
                    placeholder="Describe your video idea..."
                    rows={5}
                    value={idea}
                    onChange={(e) => setIdea(e.target.value)}
                    className="resize-y"
                  />
                </div>

                {/* Context textarea */}
                <div className="space-y-2">
                  <Label htmlFor="context">Context (Optional)</Label>
                  <Textarea
                    id="context"
                    placeholder="Product/brand context..."
                    rows={3}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    className="resize-y"
                  />
                </div>

                {/* Configuration row */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Variant count */}
                  <div className="space-y-2">
                    <Label htmlFor="variant-count">Variants</Label>
                    <Select
                      value={variantCount.toString()}
                      onValueChange={(val) => setVariantCount(parseInt(val))}
                    >
                      <SelectTrigger id="variant-count">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <SelectItem key={n} value={n.toString()}>
                            {n} {n === 1 ? "variant" : "variants"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* AI Provider */}
                  <div className="space-y-2">
                    <Label htmlFor="provider">AI Provider</Label>
                    <Select value={provider} onValueChange={setProvider}>
                      <SelectTrigger id="provider">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gemini">Gemini 2.5 Flash</SelectItem>
                        <SelectItem value="claude">Claude Sonnet 4</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Error display */}
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Generate button */}
                <Button
                  onClick={handleGenerate}
                  disabled={!idea.trim() || isGenerating}
                  className="w-full"
                  size="lg"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Scripts
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 2 — Review Scripts */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Review Scripts ({scripts.length})</h2>
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Input
              </Button>
            </div>

            {/* ElevenLabs model selector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">TTS Configuration</CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>

            {/* Scripts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scripts.map((script, index) => {
                const wordCount = countWords(script);
                const estimatedDuration = Math.round(wordCount / 2.5);

                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">Script {index + 1}</CardTitle>
                        <Badge variant="outline">
                          {wordCount} words (~{estimatedDuration}s)
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        value={script}
                        onChange={(e) => {
                          const newScripts = [...scripts];
                          newScripts[index] = e.target.value;
                          setScripts(newScripts);
                        }}
                        rows={6}
                        className="resize-y font-mono text-sm"
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Preview All button */}
            <Button
              onClick={handlePreviewAll}
              disabled={previewingIndex !== null}
              className="w-full"
              size="lg"
            >
              {previewingIndex !== null ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Previewing variant {previewingIndex + 1} of {scripts.length}...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Preview All Matches
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 3 — Preview & Select */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">
                Preview & Select Variants ({selectedVariants.size} selected)
              </h2>
              <Button variant="outline" onClick={() => setStep(2)}>
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

            {/* Variant preview grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {scripts.map((script, index) => {
                const preview = previews[index];
                if (!preview) return null;

                const topMatches = preview.matches.slice(0, 3);

                return (
                  <Card key={index}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedVariants.has(index)}
                            onCheckedChange={() => toggleVariant(index)}
                          />
                          <CardTitle className="text-lg">Variant {index + 1}</CardTitle>
                        </div>
                        <Badge variant="secondary">
                          {formatDuration(preview.audio_duration)}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Match summary */}
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
                      </div>

                      {/* Top matches */}
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-muted-foreground">
                          Top 3 Matches:
                        </p>
                        {topMatches.map((match, mIndex) => {
                          const isMatched = match.confidence > 0;
                          const textPreview =
                            match.srt_text.length > 40
                              ? match.srt_text.substring(0, 40) + "..."
                              : match.srt_text;

                          return (
                            <div
                              key={mIndex}
                              className="p-2 border rounded text-xs space-y-1"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-muted-foreground flex-1">
                                  {textPreview}
                                </p>
                                {isMatched ? (
                                  <Badge variant="default" className="text-xs">
                                    {Math.round(match.confidence * 100)}%
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive" className="text-xs">
                                    No match
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Error display */}
            {previewError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{previewError}</AlertDescription>
              </Alert>
            )}

            {/* Render button */}
            <Button
              onClick={handleRender}
              disabled={selectedVariants.size === 0}
              className="w-full"
              size="lg"
            >
              <Play className="h-4 w-4 mr-2" />
              Render Selected ({selectedVariants.size})
            </Button>
          </div>
        )}

        {/* Step 4 — Render Progress */}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Render Progress</h2>
              <Button variant="outline" onClick={resetPipeline}>
                <Sparkles className="h-4 w-4 mr-2" />
                Start New Pipeline
              </Button>
            </div>

            {/* Variant status grid */}
            {variantStatuses.length === 0 ? (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="Niciun pipeline"
                description="Configureaza un pipeline pentru a genera video-uri."
              />
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {variantStatuses.map((status) => (
                <Card key={status.variant_index}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        Variant {status.variant_index + 1}
                      </CardTitle>
                      <Badge
                        variant={
                          status.status === "completed"
                            ? "default"
                            : status.status === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {status.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-semibold">{status.progress}%</span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${status.progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Current step */}
                    <p className="text-sm text-muted-foreground">{status.current_step}</p>

                    {/* Download button */}
                    {status.status === "completed" && status.final_video_path && (
                      <Button variant="outline" className="w-full" asChild>
                        <a
                          href={`http://localhost:8000/api/v1/library/files/${encodeURIComponent(
                            status.final_video_path
                          )}`}
                          download
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Download Video
                        </a>
                      </Button>
                    )}

                    {/* Error message */}
                    {status.status === "failed" && status.error && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{status.error}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
