"use client";

import { useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useBatchPolling, type BatchStatus, type ProductJobStatus } from "@/hooks/use-batch-polling";
import { apiPost, API_URL } from "@/lib/api";
import { toast } from "sonner";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Film,
  RefreshCw,
} from "lucide-react";

// Status badge config
function getStatusBadge(status: ProductJobStatus["status"]) {
  switch (status) {
    case "queued":
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Clock className="h-3 w-3 mr-1" />
          Queued
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="secondary" className="text-blue-500">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-600 hover:bg-green-600 text-white">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
  }
}

function getProgressValue(job: ProductJobStatus): number {
  switch (job.status) {
    case "queued":
      return 0;
    case "processing": {
      const parsed = parseInt(job.progress);
      return isNaN(parsed) ? 10 : parsed;
    }
    case "completed":
      return 100;
    case "failed":
      return 0;
  }
}

// Per-product card
function ProductJobCard({ job }: { job: ProductJobStatus }) {
  const progressValue = getProgressValue(job);

  return (
    <Card className={job.status === "completed" ? "border-green-500/50" : job.status === "failed" ? "border-destructive/50" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-tight line-clamp-2">
            {job.title || job.product_id}
          </CardTitle>
          {getStatusBadge(job.status)}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Progress value={progressValue} className="h-1.5" />
        {job.status === "failed" && job.error && (
          <p className="text-xs text-destructive break-words">{job.error}</p>
        )}
        {job.status === "processing" && (
          <p className="text-xs text-muted-foreground">{job.progress}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Main content — reads search params
function BatchGenerateContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const batchId = searchParams.get("batch_id");

  const retryLoadingRef = useRef(false);

  const { startPolling, isPolling, batchStatus, productJobs, completedCount, failedCount, totalCount } =
    useBatchPolling({
      apiBaseUrl: API_URL,
      interval: 2000,
      onBatchComplete: (status: BatchStatus) => {
        if (status.failed === 0) {
          toast.success(`All ${status.total} videos generated successfully!`);
        } else {
          toast.warning(`${status.completed} of ${status.total} videos complete. ${status.failed} failed.`);
        }
      },
    });

  // Start polling when batch_id is present
  useEffect(() => {
    if (batchId) {
      startPolling(batchId);
    }
  }, [batchId, startPolling]);

  // Retry failed products
  const handleRetryFailed = async () => {
    if (retryLoadingRef.current) return;
    retryLoadingRef.current = true;

    const failedProductIds = productJobs
      .filter((j) => j.status === "failed")
      .map((j) => j.product_id);

    if (failedProductIds.length === 0) return;

    try {
      const res = await apiPost("/products/batch-generate", {
        product_ids: failedProductIds,
        voiceover_mode: "quick",
        tts_provider: "edge",
        duration_s: 30,
        encoding_preset: "tiktok",
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/batch-generate?batch_id=${data.batch_id}`);
      } else {
        const err = await res.json().catch(() => ({ detail: "Retry failed" }));
        toast.error(err.detail || "Retry failed");
      }
    } catch {
      toast.error("Network error retrying batch");
    } finally {
      retryLoadingRef.current = false;
    }
  };

  // Error state — no batch_id in URL
  if (!batchId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Film className="h-16 w-16 text-muted-foreground/30 mx-auto" />
          <h2 className="text-xl font-semibold">No Batch ID Found</h2>
          <p className="text-muted-foreground">
            This page requires a batch_id URL parameter.
          </p>
          <Link href="/products">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Products
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const overallProgress =
    totalCount > 0
      ? Math.round(((completedCount + failedCount) / totalCount) * 100)
      : 0;

  const isDone = batchStatus?.status === "completed";
  const allSucceeded = isDone && failedCount === 0;
  const someFailedAndDone = isDone && failedCount > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/products">
            <Button variant="ghost" size="sm" className="mb-4 -ml-2">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Products
            </Button>
          </Link>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Film className="h-8 w-8 text-primary" />
            Batch Generation
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-mono">
            Batch ID: {batchId}
          </p>
        </div>

        {/* Overall progress bar */}
        {batchStatus && (
          <div className="mb-8 p-6 bg-card border rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="font-semibold">
                  {completedCount} of {totalCount} complete
                  {failedCount > 0 && (
                    <span className="text-destructive ml-2">• {failedCount} failed</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isDone
                    ? allSucceeded
                      ? "All videos generated successfully"
                      : "Batch complete with some failures"
                    : isPolling
                    ? "Generating videos..."
                    : "Processing"}
                </p>
              </div>
              <div className="text-2xl font-bold text-primary">{overallProgress}%</div>
            </div>
            <Progress value={overallProgress} className="h-2" />

            {/* Completion actions */}
            {allSucceeded && (
              <div className="pt-2 flex gap-3">
                <Link href="/librarie">
                  <Button>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    View in Library
                  </Button>
                </Link>
              </div>
            )}

            {someFailedAndDone && (
              <div className="pt-2 flex gap-3">
                <Button
                  variant="destructive"
                  onClick={handleRetryFailed}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry {failedCount} Failed
                </Button>
                {completedCount > 0 && (
                  <Link href="/librarie">
                    <Button variant="outline">
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      View {completedCount} in Library
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading state — no status yet */}
        {!batchStatus && (
          <div className="flex items-center justify-center py-20">
            <div className="text-center space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">Loading batch status...</p>
            </div>
          </div>
        )}

        {/* Per-product card grid */}
        {productJobs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {productJobs.map((job) => (
              <ProductJobCard key={job.product_id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Page component — wraps content in Suspense (required by Next.js App Router for useSearchParams)
export default function BatchGeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <BatchGenerateContent />
    </Suspense>
  );
}
