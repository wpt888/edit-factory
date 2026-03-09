"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  Loader2,
  CheckCircle,
  XCircle,
  X,
  RefreshCw,
  Play,
  Trash2,
} from "lucide-react";
import { apiPost, apiGet, apiFetch } from "@/lib/api";

// --- Types ---

type QueueItemStatus = "waiting" | "processing" | "done" | "failed";

interface QueueItem {
  id: string;
  file: File;
  status: QueueItemStatus;
  progress: number;
  error?: string;
  projectId?: string;
  clipCount?: number;
}

interface BatchUploadQueueProps {
  variantCount?: number;
}

// --- Helpers ---

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: QueueItemStatus) {
  switch (status) {
    case "waiting":
      return (
        <Badge variant="secondary" className="text-xs">
          Waiting
        </Badge>
      );
    case "processing":
      return (
        <Badge className="text-xs bg-blue-600">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case "done":
      return (
        <Badge className="text-xs bg-green-600">
          <CheckCircle className="h-3 w-3 mr-1" />
          Done
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-xs">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
  }
}

// --- Component ---

export function BatchUploadQueue({ variantCount = 3 }: BatchUploadQueueProps) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const processingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Queue summary ---
  const summary = {
    waiting: queue.filter((q) => q.status === "waiting").length,
    processing: queue.filter((q) => q.status === "processing").length,
    done: queue.filter((q) => q.status === "done").length,
    failed: queue.filter((q) => q.status === "failed").length,
  };

  // --- Add files to queue ---
  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const validTypes = ["video/mp4", "video/webm", "video/quicktime"];
      const newItems: QueueItem[] = [];

      for (const file of Array.from(files)) {
        if (!validTypes.includes(file.type)) continue;
        // Skip duplicates (same name + size)
        const isDuplicate = queue.some(
          (q) => q.file.name === file.name && q.file.size === file.size
        );
        if (isDuplicate) continue;

        newItems.push({
          id: crypto.randomUUID(),
          file,
          status: "waiting",
          progress: 0,
        });
      }

      if (newItems.length > 0) {
        setQueue((prev) => [...prev, ...newItems]);
      }
    },
    [queue]
  );

  // --- Drag-and-drop handlers ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  // --- File input handler ---
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files);
        e.target.value = "";
      }
    },
    [addFiles]
  );

  // --- Remove / Retry ---
  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const retryItem = useCallback((id: string) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.id === id
          ? { ...q, status: "waiting" as const, progress: 0, error: undefined }
          : q
      )
    );
  }, []);

  const clearCompleted = useCallback(() => {
    setQueue((prev) => prev.filter((q) => q.status !== "done"));
  }, []);

  // --- Process queue sequentially ---
  const processQueue = useCallback(async () => {
    processingRef.current = true;
    setIsProcessing(true);

    try {
      // Get snapshot of waiting items
      let waitingIds: string[] = [];
      setQueue((prev) => {
        waitingIds = prev
          .filter((q) => q.status === "waiting")
          .map((q) => q.id);
        return prev;
      });

      for (const itemId of waitingIds) {
        if (!processingRef.current) break;

        // Get current item from queue
        let currentItem: QueueItem | undefined;
        setQueue((prev) => {
          currentItem = prev.find((q) => q.id === itemId);
          return prev;
        });

        if (!currentItem || currentItem.status !== "waiting") continue;

        // Set status to processing
        setQueue((prev) =>
          prev.map((q) =>
            q.id === itemId ? { ...q, status: "processing" as const, progress: 5 } : q
          )
        );

        try {
          // 1. Create project
          const projectRes = await apiPost("/library/projects", {
            name: `Batch - ${currentItem.file.name}`,
            description: "Batch uploaded",
          });
          const projectData = await projectRes.json();
          const projectId = projectData.id || projectData.project_id;

          setQueue((prev) =>
            prev.map((q) =>
              q.id === itemId ? { ...q, projectId, progress: 15 } : q
            )
          );

          // 2. Upload + generate raw clips
          const formData = new FormData();
          formData.append("video", currentItem.file);
          formData.append("variant_count", variantCount.toString());

          const genRes = await apiFetch(
            `/library/projects/${projectId}/generate-raw`,
            {
              method: "POST",
              body: formData,
            }
          );
          const genData = await genRes.json();
          const jobId = genData.job_id;

          setQueue((prev) =>
            prev.map((q) =>
              q.id === itemId ? { ...q, progress: 30 } : q
            )
          );

          // 3. Poll job status
          if (jobId) {
            let done = false;
            while (!done && processingRef.current) {
              await new Promise((r) => setTimeout(r, 3000));

              try {
                const statusRes = await apiGet(`/jobs/${jobId}`);
                const statusData = await statusRes.json();
                const jobStatus = statusData.status;
                const jobProgress = statusData.progress ?? 0;

                // Map job progress (0-100) to our range (30-95)
                const mappedProgress = 30 + Math.round(jobProgress * 0.65);

                setQueue((prev) =>
                  prev.map((q) =>
                    q.id === itemId ? { ...q, progress: mappedProgress } : q
                  )
                );

                if (jobStatus === "completed" || jobStatus === "complete") {
                  const clipCount = statusData.data?.clip_count ?? statusData.data?.clips?.length ?? 0;
                  setQueue((prev) =>
                    prev.map((q) =>
                      q.id === itemId
                        ? { ...q, status: "done" as const, progress: 100, clipCount }
                        : q
                    )
                  );
                  done = true;
                } else if (jobStatus === "failed" || jobStatus === "error") {
                  const errorMsg = statusData.data?.error || statusData.error || "Processing failed";
                  setQueue((prev) =>
                    prev.map((q) =>
                      q.id === itemId
                        ? { ...q, status: "failed" as const, error: errorMsg }
                        : q
                    )
                  );
                  done = true;
                }
              } catch {
                // Poll error — keep trying unless cancelled
              }
            }
          } else {
            // No job ID — mark done immediately (sync processing)
            setQueue((prev) =>
              prev.map((q) =>
                q.id === itemId
                  ? { ...q, status: "done" as const, progress: 100 }
                  : q
              )
            );
          }
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Upload failed";
          setQueue((prev) =>
            prev.map((q) =>
              q.id === itemId
                ? { ...q, status: "failed" as const, error: errorMsg }
                : q
            )
          );
        }
      }
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  }, [variantCount]);

  const cancelProcessing = useCallback(() => {
    processingRef.current = false;
  }, []);

  const hasWaiting = summary.waiting > 0;
  const hasDone = summary.done > 0;

  return (
    <div className="space-y-4 mt-4">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${
            isDragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/50"
          }
        `}
      >
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag and drop video files here, or click to browse
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Accepts MP4, WebM, QuickTime
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/mp4,video/webm,video/quicktime"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Controls */}
      {queue.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {summary.waiting} waiting, {summary.processing} processing,{" "}
            {summary.done} done, {summary.failed} failed
          </p>
          <div className="flex items-center gap-2">
            {hasDone && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompleted}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear Completed
              </Button>
            )}
            {isProcessing ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={cancelProcessing}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            ) : (
              hasWaiting && (
                <Button size="sm" onClick={processQueue}>
                  <Play className="h-3.5 w-3.5 mr-1" />
                  Start Processing
                </Button>
              )
            )}
          </div>
        </div>
      )}

      {/* Queue list */}
      {queue.map((item) => (
        <Card key={item.id}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {item.file.name}
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatFileSize(item.file.size)}
                  </span>
                  {statusBadge(item.status)}
                  {item.status === "done" && item.clipCount !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {item.clipCount} clips
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {item.status === "processing" && (
                  <Progress value={item.progress} className="h-1.5 mt-2" />
                )}

                {/* Error message */}
                {item.status === "failed" && item.error && (
                  <p className="text-xs text-destructive mt-1">{item.error}</p>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1">
                {item.status === "waiting" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => removeItem(item.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                {item.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => retryItem(item.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
