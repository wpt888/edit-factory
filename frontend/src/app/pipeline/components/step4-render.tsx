"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiGet, apiPost, apiDelete, API_URL, handleApiError } from "@/lib/api";
import {
  Sparkles,
  AlertCircle,
  CheckCircle,
  Download,
  Workflow,
  X,
  Trash2,
  AlertTriangle,
  Share2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PipelineSchedule } from "@/components/pipeline/pipeline-schedule";
import { PipelineCaptionGenerator } from "@/components/pipeline/pipeline-caption-generator";
import type { VariantStatus } from "../pipeline-types";
import type { Dispatch, SetStateAction } from "react";

// Mirrors the inline confirmDialog state shape in PipelinePage (page.tsx).
type ConfirmDialogState = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant: "destructive" | "default";
  onConfirm: () => void;
  loading?: boolean;
};

// Loose ctx-bag type (F4): only the fields that need contextual typing for the
// inline callbacks below are typed precisely; everything else stays `any`.
type Step4Ctx = {
  variantStatuses: VariantStatus[];
  setVariantStatuses: Dispatch<SetStateAction<VariantStatus[]>>;
  setConfirmDialog: Dispatch<SetStateAction<ConfirmDialogState>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Step4Render({ ctx }: { ctx: any }) {
  const {
    isRendering,
    handleCancelRender,
    setConfirmDialog,
    resetPipeline,
    variantStatuses,
    setVariantStatuses,
    pipelineId,
    setIsRendering,
    handleRemakeVariant,
    getVideoCacheBust,
    setPublishVariant,
    scripts,
    contextProducts,
    setContextProducts,
    setGeneratedCaptions,
    setGeneratedYoutubeTitles,
    generatedCaptions,
    generatedYoutubeTitles,
    libraryProjectId,
  }: Step4Ctx = ctx;
  return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">Render Progress</h2>
              <div className="flex gap-2">
                {isRendering && (
                  <Button variant="destructive" onClick={handleCancelRender}>
                    <X className="h-4 w-4 mr-2" />
                    Stop Render
                  </Button>
                )}
                <Button variant="outline" onClick={() => {
                  if (isRendering) {
                    setConfirmDialog({
                      open: true,
                      title: "Render in progress",
                      description: "A render is in progress. Are you sure you want to start a new pipeline?",
                      confirmLabel: "Start new pipeline",
                      variant: "destructive",
                      onConfirm: () => {
                        setConfirmDialog((prev) => ({ ...prev, open: false }));
                        handleCancelRender();
                        resetPipeline();
                      },
                    });
                  } else {
                    resetPipeline();
                  }
                }}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Start New Pipeline
                </Button>
              </div>
            </div>

            {/* Variant status grid */}
            {variantStatuses.length === 0 ? (
              <EmptyState
                icon={<Workflow className="h-6 w-6" />}
                title="No pipeline"
                description="Configure a pipeline to generate videos."
              />
            ) : null}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {variantStatuses.map((status, statusIdx) => (
                <Card key={status.visual_version ? `${status.variant_index}_${status.visual_version}` : `${status.variant_index}_${statusIdx}`}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">
                        Variant {status.variant_index + 1}
                        {status.visual_version && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            {status.visual_version} — {status.meta_platform === "instagram" ? "Instagram" : status.meta_platform === "facebook" ? "Facebook" : status.meta_platform}
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {status.current_step === "Existing render used" ? (
                          <Badge variant="default" className="bg-primary text-primary-foreground hover:bg-primary/80">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Cached
                          </Badge>
                        ) : (
                          <Badge
                            variant={
                              status.status === "completed"
                                ? "default"
                                : status.status === "failed" || status.status === "cancelled"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {status.status}
                          </Badge>
                        )}
                        {(status.status === "processing" || status.status === "not_started") && isRendering && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={async () => {
                              // Build job_key matching the backend render_jobs dict key:
                              //   - "N_A" / "N_B" when this card is a Meta visual version
                              //   - "N" for standard (non-Meta) renders
                              // Sending the full job_key ensures Stop targets THIS card
                              // only, not the paired A/B version of the same script.
                              const jobKey = status.visual_version
                                ? `${status.variant_index}_${status.visual_version}`
                                : `${status.variant_index}`;
                              try {
                                await apiPost(`/pipeline/${pipelineId}/cancel/${encodeURIComponent(jobKey)}`, {});
                                setVariantStatuses(prev =>
                                  prev.map(v => {
                                    const matches = status.visual_version
                                      ? v.variant_index === status.variant_index && v.visual_version === status.visual_version
                                      : v.variant_index === status.variant_index && !v.visual_version;
                                    return matches
                                      ? { ...v, status: "cancelled" as const, current_step: "Cancelled by user", progress: 0 }
                                      : v;
                                  })
                                );
                                toast.success(
                                  status.visual_version
                                    ? `Variant ${status.variant_index + 1} (${status.visual_version}) cancelled`
                                    : `Variant ${status.variant_index + 1} cancelled`
                                );
                                // If all variants are now done, stop polling
                                const updatedStatuses = variantStatuses.map(v => {
                                  const matches = status.visual_version
                                    ? v.variant_index === status.variant_index && v.visual_version === status.visual_version
                                    : v.variant_index === status.variant_index && !v.visual_version;
                                  return matches
                                    ? { ...v, status: "cancelled" as const }
                                    : v;
                                });
                                const allDone = updatedStatuses.every(
                                  v => v.status === "completed" || v.status === "failed" || v.status === "cancelled"
                                );
                                if (allDone) {
                                  setIsRendering(false);
                                }
                              } catch (err) {
                                handleApiError(err, "Failed to cancel variant");
                              }
                            }}
                          >
                            <X className="h-3 w-3 mr-1" />
                            Stop
                          </Button>
                        )}
                        {status.status === "completed" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            title="Remake with different segments"
                            onClick={() => handleRemakeVariant(status.variant_index, status.visual_version)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        {(status.status === "completed" || status.status === "failed" || status.status === "cancelled") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setConfirmDialog({
                                open: true,
                                title: "Delete variant",
                                description: `Are you sure you want to delete Variant ${status.variant_index + 1}? This will remove it from the list${status.clip_id ? " and delete the clip from the library" : ""}.`,
                                confirmLabel: "Delete",
                                variant: "destructive",
                                onConfirm: async () => {
                                  try {
                                    if (status.clip_id) {
                                      await apiDelete(`/library/clips/${status.clip_id}`);
                                    }
                                    setVariantStatuses(prev =>
                                      prev.filter(v =>
                                        status.visual_version
                                          ? !(v.variant_index === status.variant_index && v.visual_version === status.visual_version)
                                          : !(v.variant_index === status.variant_index && !v.visual_version)
                                      )
                                    );
                                    toast.success(`Variant ${status.variant_index + 1} deleted`);
                                  } catch (err) {
                                    console.error("Failed to delete variant:", err);
                                    toast.error("Failed to delete variant");
                                  }
                                  setConfirmDialog(prev => ({ ...prev, open: false }));
                                },
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Progress bar */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-semibold">
                          {status.progress >= 100 && status.status === "processing"
                            ? "Finalizing..."
                            : `${Math.round(status.progress)}%`}
                        </span>
                      </div>
                      <div className="w-full bg-secondary rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${status.progress >= 100 && status.status === "processing" ? 99 : status.progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Current step */}
                    <p className="text-sm text-muted-foreground">{status.current_step}</p>

                    {/* Render fingerprint (debug: unique per render parameters) */}
                    {status.render_fingerprint && (
                      <p className="text-xs font-mono text-muted-foreground/60">
                        Render ID: {status.render_fingerprint}
                      </p>
                    )}

                    {/* Inline video player + download button */}
                    {status.status === "completed" && status.final_video_path && (
                      <div className="space-y-3">
                        <video
                          key={`video-${status.variant_index}${status.visual_version ? `_${status.visual_version}` : ""}-${getVideoCacheBust(status.variant_index, status.visual_version)}`}
                          controls
                          className="w-full rounded-md bg-black max-h-64 object-contain"
                          poster={
                            status.thumbnail_path
                              ? `${API_URL}/library/files/${encodeURIComponent(status.thumbnail_path)}`
                              : undefined
                          }
                          preload="auto"
                          src={`${API_URL}/library/files/${encodeURIComponent(status.final_video_path)}?v=${getVideoCacheBust(status.variant_index, status.visual_version)}`}
                        />
                        <Button variant="outline" className="w-full" asChild>
                          <a
                            href={`${API_URL}/library/files/${encodeURIComponent(
                              status.final_video_path
                            )}?v=${getVideoCacheBust(status.variant_index, status.visual_version)}&download=true`}
                            download
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Download Video
                          </a>
                        </Button>
                        {status.clip_id && (
                          <Button
                            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={() => setPublishVariant(status)}
                          >
                            <Share2 className="h-4 w-4 mr-2" />
                            Publish to Social Media
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Library save warning */}
                    {status.status === "completed" && status.library_saved === false && (
                      <Alert className="border-yellow-500/50 bg-yellow-500/10">
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                          Video rendered successfully, but was not saved to the library.
                          {status.library_error && <span className="block text-xs mt-1 opacity-75">{status.library_error}</span>}
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-yellow-700 dark:text-yellow-400 underline ml-1"
                            onClick={async () => {
                              // BUG-FE-32: Guard against null pipelineId
                              if (!pipelineId) return;
                              try {
                                await apiPost(`/pipeline/sync-to-library/${pipelineId}`);
                                const res = await apiGet(`/pipeline/status/${pipelineId}`);
                                const data = await res.json();
                                if (data?.variants) {
                                  const srcVars = (data.meta_variants?.length > 0 ? data.meta_variants : data.variants) || [];
                                  const renderedVariants = srcVars.filter((v: VariantStatus) => v.status !== "not_started");
                                  setVariantStatuses(renderedVariants);
                                }
                              } catch {
                                // ignore — user can retry
                              }
                            }}
                          >
                            Retry save
                          </Button>
                        </AlertDescription>
                      </Alert>
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

            {/* Captions — rendered directly (not as captionSlot) to avoid remounting on poll updates */}
            {pipelineId && variantStatuses.length > 0 && (
              <PipelineCaptionGenerator
                pipelineId={pipelineId}
                completedClips={variantStatuses.map(v => ({
                  clip_id: v.clip_id || `pending-${v.variant_index}${v.visual_version ? `_${v.visual_version}` : ""}`,
                  variant_index: v.variant_index,
                  final_video_path: v.final_video_path || "",
                  thumbnail_path: v.thumbnail_path,
                  visual_version: v.visual_version,
                }))}
                scripts={scripts}
                contextProducts={contextProducts}
                onProductsChange={setContextProducts}
                onCaptionsGenerated={setGeneratedCaptions}
                onYoutubeTitlesGenerated={setGeneratedYoutubeTitles}
                initialCaptions={generatedCaptions}
                initialYoutubeTitles={generatedYoutubeTitles}
              />
            )}

            {/* Schedule & Publish — calendar then schedule form */}
            <PipelineSchedule
              completedClips={variantStatuses
                .filter(v => v.status === "completed" && v.clip_id)
                .map(v => ({
                  clip_id: v.clip_id!,
                  variant_index: v.variant_index,
                  final_video_path: v.final_video_path || "",
                  thumbnail_path: v.thumbnail_path,
                  visual_version: v.visual_version,
                }))}
              initialCaptions={generatedCaptions}
              projectId={libraryProjectId ?? undefined}
              allLibrarySaved={
                variantStatuses.filter(v => v.status === "completed").length > 0 &&
                variantStatuses
                  .filter(v => v.status === "completed")
                  .every(v => v.library_saved === true)
              }
            />
          </div>
  );
}
