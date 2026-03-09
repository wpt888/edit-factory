"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Upload,
  CheckCircle,
  Download,
  ArrowLeft,
  ArrowRight,
  X,
  Zap,
  Package,
  Mic,
  Film,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { apiPost, apiGet, apiFetch, API_URL } from "@/lib/api";
import { STYLE_PRESETS } from "@/types/pipeline-presets";
import type { StylePreset } from "@/types/pipeline-presets";
import { toast } from "sonner";

// Map preset icon names to lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  zap: Zap,
  package: Package,
  mic: Mic,
  film: Film,
  sparkles: Sparkles,
};

// Derive a script prompt from preset
function presetToPrompt(preset: StylePreset): string {
  const prompts: Record<string, string> = {
    energetic_short: "Create an energetic, fast-paced short video with punchy transitions",
    product_showcase: "Create a professional product showcase video highlighting key features",
    calm_narration: "Create a calm, storytelling video with warm narration",
    quick_demo: "Create a punchy tutorial-style demo that gets to the point fast",
    cinematic: "Create a dramatic, cinematic video with polished delivery",
  };
  return prompts[preset.id] || `Create a ${preset.name.toLowerCase()} style video`;
}

interface VariantResult {
  variant_index: number;
  status: "not_started" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  current_step: string;
  final_video_path?: string;
  clip_id?: string;
  error?: string;
}

interface SimplePipelineProps {
  onSwitchToAdvanced: () => void;
}

export function SimplePipeline({ onSwitchToAdvanced }: SimplePipelineProps) {
  // Step state
  const [simpleStep, setSimpleStep] = useState<1 | 2 | 3>(1);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [completedVariants, setCompletedVariants] = useState<VariantResult[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // File handling
  const handleFileSelect = useCallback((file: File) => {
    const validTypes = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi)$/i)) {
      setError("Please select a video file (MP4, WebM, MOV)");
      return;
    }
    setUploadedFile(file);
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const removeFile = useCallback(() => {
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Poll pipeline status
  const startPolling = useCallback((pipId: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await apiGet(`/pipeline/status/${pipId}`);
        const data = await res.json();
        const variants: VariantResult[] = data.variants || [];
        const rendered = variants.filter((v) => v.status !== "not_started");

        if (!isMountedRef.current) return;
        setCompletedVariants(rendered);

        const allDone = rendered.length > 0 && rendered.every(
          (v) => v.status === "completed" || v.status === "failed" || v.status === "cancelled"
        );

        if (allDone) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setIsProcessing(false);
        }
      } catch {
        // Silently continue polling
      }
    }, 3000);
  }, []);

  // Generate: create project, upload video, generate script, start render
  const handleGenerate = useCallback(async () => {
    if (!uploadedFile || !selectedPreset) return;

    const preset = STYLE_PRESETS.find((p) => p.id === selectedPreset);
    if (!preset) return;

    setIsProcessing(true);
    setError(null);
    setCompletedVariants([]);

    try {
      // Step A: Create project
      const timestamp = new Date().toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      });
      const projectRes = await apiPost("/library/projects", {
        name: `Simple - ${preset.name} - ${timestamp}`,
        description: `Auto-generated via Simple Mode with ${preset.name} preset`,
        target_duration: 60,
      });
      const projectData = await projectRes.json();
      const newProjectId = projectData.id;
      if (!isMountedRef.current) return;
      setProjectId(newProjectId);

      // Step B: Upload video to project
      const formData = new FormData();
      formData.append("video", uploadedFile);
      formData.append("variant_count", String(preset.params.variant_count));
      await apiFetch(`/library/projects/${newProjectId}/generate`, {
        method: "POST",
        body: formData,
        timeout: 300_000,
      });
      if (!isMountedRef.current) return;

      // Step C: Generate scripts via pipeline
      const genRes = await apiPost("/pipeline/generate", {
        idea: presetToPrompt(preset),
        variant_count: preset.params.variant_count,
        provider: "gemini",
      }, { timeout: 300_000 });
      const genData = await genRes.json();
      const newPipelineId = genData.pipeline_id;
      if (!isMountedRef.current) return;
      setPipelineId(newPipelineId);

      // Step D: Start render with preset params
      const allVariants = Array.from(
        { length: preset.params.variant_count },
        (_, i) => i
      );
      await apiPost(`/pipeline/render/${newPipelineId}`, {
        variant_indices: allVariants,
        preset_name: preset.params.preset_name,
        elevenlabs_model: preset.params.elevenlabs_model,
        voice_settings: {
          stability: preset.params.voice_stability,
          similarity_boost: preset.params.voice_similarity,
          speed: preset.params.voice_speed,
        },
        words_per_subtitle: preset.params.words_per_subtitle,
        min_segment_duration: preset.params.min_segment_duration,
        ultra_rapid_intro: preset.params.ultra_rapid_intro,
      }, { timeout: 600_000 });

      if (!isMountedRef.current) return;

      // Move to step 3 and start polling
      setSimpleStep(3);
      startPolling(newPipelineId);
    } catch (err) {
      if (!isMountedRef.current) return;
      setIsProcessing(false);
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
      toast.error("Generation failed", { description: message });
    }
  }, [uploadedFile, selectedPreset, startPolling]);

  // Download a single variant
  const handleDownload = useCallback((variant: VariantResult) => {
    if (!variant.final_video_path) return;
    const url = `${API_URL.replace(/\/api\/v1$/, "")}/api/v1/library/clips/${variant.clip_id}/download`;
    window.open(url, "_blank");
  }, []);

  // Download all completed variants
  const handleDownloadAll = useCallback(() => {
    completedVariants
      .filter((v) => v.status === "completed" && v.clip_id)
      .forEach((v) => handleDownload(v));
  }, [completedVariants, handleDownload]);

  // Reset to start over
  const handleStartOver = useCallback(() => {
    setSimpleStep(1);
    setUploadedFile(null);
    setSelectedPreset(null);
    setIsProcessing(false);
    setError(null);
    setProjectId(null);
    setPipelineId(null);
    setCompletedVariants([]);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // Overall progress for step 3
  const overallProgress = useMemo(() => {
    if (completedVariants.length === 0) return 0;
    const total = completedVariants.reduce((sum, v) => sum + (v.progress || 0), 0);
    return Math.round(total / completedVariants.length);
  }, [completedVariants]);

  const completedCount = completedVariants.filter((v) => v.status === "completed").length;
  const failedCount = completedVariants.filter((v) => v.status === "failed").length;

  // Step indicators
  const steps = [
    { num: 1, label: "Upload" },
    { num: 2, label: "Choose Style" },
    { num: 3, label: "Download" },
  ];

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                simpleStep === s.num
                  ? "bg-primary text-primary-foreground"
                  : simpleStep > s.num
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {simpleStep > s.num ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <span className="h-4 w-4 flex items-center justify-center text-xs">{s.num}</span>
              )}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 ${simpleStep > s.num ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-lg p-3 flex items-center gap-2">
          <X className="h-4 w-4 shrink-0" />
          <span className="text-sm">{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Step 1: Upload */}
      {simpleStep === 1 && (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Upload Your Video</CardTitle>
            <CardDescription>
              Select the video you want to transform into social media content
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                isDragOver
                  ? "border-primary bg-primary/5"
                  : uploadedFile
                  ? "border-primary/50 bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />
              {uploadedFile ? (
                <div className="space-y-2">
                  <CheckCircle className="h-10 w-10 mx-auto text-primary" />
                  <p className="font-medium">{uploadedFile.name}</p>
                  <p className="text-sm text-muted-foreground">{formatSize(uploadedFile.size)}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile();
                    }}
                  >
                    <X className="h-4 w-4 mr-1" /> Remove
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                  <p className="font-medium">Drop your video here or click to browse</p>
                  <p className="text-sm text-muted-foreground">MP4, WebM, or MOV</p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => setSimpleStep(2)}
                disabled={!uploadedFile}
              >
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Choose Style */}
      {simpleStep === 2 && (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Choose a Style</CardTitle>
            <CardDescription>
              Pick a style that matches the feel you want for your video
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {STYLE_PRESETS.map((preset) => {
                const IconComp = ICON_MAP[preset.icon] || Sparkles;
                const isSelected = selectedPreset === preset.id;
                return (
                  <div
                    key={preset.id}
                    className={`rounded-lg border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/30"
                    }`}
                    onClick={() => setSelectedPreset(preset.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-md ${isSelected ? "bg-primary/10" : "bg-muted"}`}>
                        <IconComp className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{preset.name}</p>
                          {isSelected && (
                            <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{preset.description}</p>
                        <Badge variant="secondary" className="mt-2 text-xs">
                          {preset.params.variant_count} variant{preset.params.variant_count > 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setSimpleStep(1)} disabled={isProcessing}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!selectedPreset || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-1" /> Generate
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Download */}
      {simpleStep === 3 && (
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {isProcessing ? "Processing Your Video" : "Your Videos Are Ready"}
            </CardTitle>
            <CardDescription>
              {isProcessing
                ? "Sit back while we create your videos. This usually takes a few minutes."
                : `${completedCount} video${completedCount !== 1 ? "s" : ""} ready for download`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar during processing */}
            {isProcessing && (
              <div className="space-y-2">
                <Progress value={overallProgress} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">{overallProgress}% complete</p>
              </div>
            )}

            {/* Variant results */}
            <div className="space-y-2">
              {completedVariants.map((v) => (
                <div
                  key={v.variant_index}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      v.status === "completed"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : v.status === "failed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {v.variant_index + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">Variant {v.variant_index + 1}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.status === "completed"
                          ? "Ready to download"
                          : v.status === "failed"
                          ? v.error || "Processing failed"
                          : v.current_step || "Processing..."}
                      </p>
                    </div>
                  </div>
                  <div>
                    {v.status === "completed" && v.clip_id ? (
                      <Button size="sm" variant="outline" onClick={() => handleDownload(v)}>
                        <Download className="h-4 w-4 mr-1" /> Download
                      </Button>
                    ) : v.status === "processing" ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {v.progress}%
                      </div>
                    ) : v.status === "failed" ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : null}
                  </div>
                </div>
              ))}

              {/* Show spinner if no variants are visible yet but processing */}
              {isProcessing && completedVariants.length === 0 && (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span className="text-sm">Starting up...</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={handleStartOver} disabled={isProcessing}>
                <RotateCcw className="h-4 w-4 mr-1" /> Start Over
              </Button>
              {completedCount > 1 && (
                <Button onClick={handleDownloadAll}>
                  <Download className="h-4 w-4 mr-1" /> Download All ({completedCount})
                </Button>
              )}
            </div>

            {failedCount > 0 && !isProcessing && (
              <p className="text-sm text-muted-foreground text-center">
                {failedCount} variant{failedCount > 1 ? "s" : ""} failed.{" "}
                <button
                  className="text-primary underline hover:no-underline"
                  onClick={onSwitchToAdvanced}
                >
                  Switch to Advanced mode
                </button>{" "}
                for more control.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
