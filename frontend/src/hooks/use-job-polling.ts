"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Job } from "@/types/video-processing";

export function extractProgress(job: Job): number {
  const raw = job.progress;
  // Handle numeric progress directly (Bug #110)
  if (typeof raw === "number") {
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
  if (!raw) {
    if (job.status === "processing") return 10;
    if (job.status === "completed") return 100;
    return 0;
  }
  // Try numeric string first
  const num = parseInt(raw);
  if (!isNaN(num) && num >= 0 && num <= 100) return num;

  // Try fraction pattern "2/5"
  const fractionMatch = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (fractionMatch) {
    const [, done, total] = fractionMatch;
    if (parseInt(total) === 0) return 0;
    return Math.round((parseInt(done) / parseInt(total)) * 100);
  }

  // Try percentage pattern "50%"
  const pctMatch = raw.match(/(\d+)%/);
  if (pctMatch) return parseInt(pctMatch[1]);

  // Status-based fallback
  if (job.status === "processing") return 10;
  if (job.status === "completed") return 100;
  return 0;
}

interface UseJobPollingOptions {
  /** Polling interval in milliseconds (default: 2000) — used only for SSE fallback polling */
  interval?: number;
  /** Called on each progress update */
  onProgress?: (progress: number, status: string, job: Job) => void;
  /** Called when job completes successfully */
  onComplete?: (result: Job["result"]) => void;
  /** Called when job fails */
  onError?: (error: string) => void;
}

interface UseJobPollingReturn {
  /** Start SSE streaming (or polling fallback) for a specific job */
  startPolling: (jobId: string) => void;
  /** Stop SSE streaming (or polling) */
  stopPolling: () => void;
  /** Current streaming/polling state */
  isPolling: boolean;
  /** Current job data */
  currentJob: Job | null;
  /** Current progress (0-100) */
  progress: number;
  /** Current status text */
  statusText: string;
  /** Elapsed time since polling started */
  elapsedTime: number;
  /** Estimated time remaining (calculated) */
  estimatedRemaining: string;
}

/**
 * Hook for real-time job progress via Server-Sent Events (SSE).
 *
 * Uses EventSource to open a single persistent connection to /jobs/{jobId}/stream.
 * Falls back to setTimeout-based polling if EventSource is not available (SSR, old browsers).
 *
 * Interface is backward-compatible with the previous polling implementation —
 * all consumers (library page, product-video page, progress-tracker) work unchanged.
 */
export function useJobPolling(options: UseJobPollingOptions): UseJobPollingReturn {
  const {
    interval = 2000,
    onProgress,
    onComplete,
    onError,
  } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedRemaining, setEstimatedRemaining] = useState("");

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledRef = useRef(false);
  const sseReconnectCountRef = useRef(0);
  const MAX_SSE_RECONNECTS = 20;

  // Use refs for callbacks to avoid stale closures
  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Calculate ETA based on progress and elapsed time
  const calculateETA = useCallback((currentProgress: number, elapsed: number) => {
    // Guard against near-zero division (Bug #113)
    if (currentProgress <= 15 || elapsed < 5) {
      return "Calculating...";
    }

    const progressDone = currentProgress - 10; // Subtract initial 10%
    const timePerPercent = elapsed / progressDone;
    const remainingProgress = 100 - currentProgress;
    const estimatedSeconds = Math.round(timePerPercent * remainingProgress);

    if (estimatedSeconds < 60) {
      return `~${estimatedSeconds}s`;
    }
    const minutes = Math.floor(estimatedSeconds / 60);
    const seconds = estimatedSeconds % 60;
    return `~${minutes}m ${seconds}s`;
  }, []);

  // Cleanup SSE connection and timers
  const cleanup = useCallback(() => {
    isCancelledRef.current = true;
    setIsPolling(false);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  // Exported stopPolling calls cleanup internally
  const stopPolling = useCallback(() => {
    cleanup();
  }, [cleanup]);

  // ─── Polling fallback (for SSR / browsers without EventSource) ───────────

  const pollFallbackRef = useRef<(jobId: string) => void>(() => {});

  const pollFallback = useCallback(
    async (jobId: string) => {
      if (isCancelledRef.current) return;

      try {
        // Dynamic import to avoid issues during SSR
        // apiFetch already throws ApiError on non-2xx (Bug #68)
        const { apiFetch } = await import("@/lib/api");
        const response = await apiFetch(`/jobs/${jobId}`);

        const job: Job = await response.json();
        setCurrentJob(job);

        const progressNum = extractProgress(job);
        setProgress(progressNum);
        setStatusText(job.status);

        const elapsed = startTimeRef.current
          ? Math.floor((Date.now() - startTimeRef.current) / 1000)
          : 0;
        setEstimatedRemaining(calculateETA(progressNum, elapsed));
        onProgressRef.current?.(progressNum, job.status, job);

        if (job.status === "completed") {
          setProgress(100);
          onCompleteRef.current?.(job.result);
          cleanup();
        } else if (job.status === "failed") {
          onErrorRef.current?.(job.error || "Job failed");
          cleanup();
        } else if (
          job.status === "processing" ||
          job.status === "pending"
        ) {
          pollingRef.current = setTimeout(() => pollFallback(jobId), interval);
        }
      } catch (error) {
        const apiModule = await import("@/lib/api");
        apiModule.handleApiError(error, "Error updating status");
        if (!isCancelledRef.current) {
          pollingRef.current = setTimeout(
            () => pollFallback(jobId),
            interval * 2
          );
        }
      }
    },
    [interval, calculateETA, cleanup]
  );
  pollFallbackRef.current = pollFallback;

  // ─── SSE implementation ───────────────────────────────────────────────────

  const startSSE = useCallback((jobId: string) => {
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
    const url = `${apiBase}/jobs/${jobId}/stream`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("progress", (e: MessageEvent) => {
      if (isCancelledRef.current) return;
      sseReconnectCountRef.current = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (parseErr) {
        console.warn("[useJobPolling] Failed to parse SSE progress data:", parseErr);
        return;
      }
      const job: Job = {
        job_id: data.job_id,
        status: data.status,
        progress: data.progress,
        error: data.error,       // Include error/result fields (Bug #44)
        result: data.result,
      };
      setCurrentJob(job);
      const progressNum = extractProgress(job);
      setProgress(progressNum);
      setStatusText(data.status);
      const elapsed = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : 0;
      setEstimatedRemaining(calculateETA(progressNum, elapsed));
      onProgressRef.current?.(progressNum, data.status, job);
    });

    eventSource.addEventListener("completed", (e: MessageEvent) => {
      if (isCancelledRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (parseErr) {
        console.warn("[useJobPolling] Failed to parse SSE completed data:", parseErr);
        return;
      }
      setProgress(100);
      setStatusText("completed");
      onCompleteRef.current?.(data.result);
      cleanup();
    });

    eventSource.addEventListener("failed", (e: MessageEvent) => {
      if (isCancelledRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(e.data);
      } catch (parseErr) {
        console.warn("[useJobPolling] Failed to parse SSE failed data:", parseErr);
        return;
      }
      onErrorRef.current?.(data.error || "Job failed");
      cleanup();
    });

    // heartbeat events are intentionally ignored — they just keep the connection alive

    eventSource.onerror = () => {
      sseReconnectCountRef.current++;
      if (sseReconnectCountRef.current > MAX_SSE_RECONNECTS) {
        console.error("[useJobPolling] SSE max reconnects reached, falling back to polling");
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        pollFallbackRef.current(jobId);
        return;
      }
      if (!isCancelledRef.current) {
        console.warn(`[useJobPolling] SSE reconnect attempt ${sseReconnectCountRef.current}/${MAX_SSE_RECONNECTS}`);
      }
    };
  }, [calculateETA, cleanup]);

  // ─── Start (SSE preferred, polling fallback) ─────────────────────────────

  const startPolling = useCallback(
    (jobId: string) => {
      // Reset state from any previous session
      isCancelledRef.current = false;
      setCurrentJob(null);
      setIsPolling(true);
      setProgress(10);
      setStatusText("pending");
      setElapsedTime(0);
      setEstimatedRemaining("Calculating...");
      startTimeRef.current = Date.now();

      // Clear any existing elapsed timer before creating new one
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      // Elapsed time counter (kept running throughout job)
      elapsedIntervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedTime(
            Math.floor((Date.now() - startTimeRef.current) / 1000)
          );
        }
      }, 1000);

      if (typeof EventSource !== "undefined") {
        // SSE path — primary implementation
        startSSE(jobId);
      } else {
        // Fallback path for SSR or very old browsers
        console.warn(
          "[useJobPolling] EventSource not available, falling back to polling"
        );
        pollFallback(jobId);
      }
    },
    [startSSE, pollFallback]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    startPolling,
    stopPolling,
    isPolling,
    currentJob,
    progress,
    statusText,
    elapsedTime,
    estimatedRemaining,
  };
}

/**
 * Format elapsed time as mm:ss
 */
export function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
