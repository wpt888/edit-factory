"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Job } from "@/types/video-processing";

interface UseJobPollingOptions {
  /** Base API URL (e.g., "http://localhost:8001/api/v1") */
  apiBaseUrl: string;
  /** Polling interval in milliseconds (default: 2000) */
  interval?: number;
  /** Called on each progress update */
  onProgress?: (progress: number, status: string, job: Job) => void;
  /** Called when job completes successfully */
  onComplete?: (result: Job["result"]) => void;
  /** Called when job fails */
  onError?: (error: string) => void;
}

interface UseJobPollingReturn {
  /** Start polling for a specific job */
  startPolling: (jobId: string) => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Current polling state */
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
 * Hook for polling job status with ETA calculation
 */
export function useJobPolling(options: UseJobPollingOptions): UseJobPollingReturn {
  const {
    apiBaseUrl,
    interval = 2000,
    onProgress,
    onComplete,
    onError
  } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [currentJob, setCurrentJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [estimatedRemaining, setEstimatedRemaining] = useState("");

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledRef = useRef(false);

  // Calculate ETA based on progress and elapsed time
  const calculateETA = useCallback((currentProgress: number, elapsed: number) => {
    if (currentProgress <= 10 || elapsed < 5) {
      return "Calculez...";
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

  // Stop polling and cleanup
  const stopPolling = useCallback(() => {
    isCancelledRef.current = true;
    setIsPolling(false);

    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  // Main polling function
  const poll = useCallback(async (jobId: string) => {
    if (isCancelledRef.current) return;

    try {
      const response = await fetch(`${apiBaseUrl}/jobs/${jobId}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const job: Job = await response.json();
      setCurrentJob(job);

      // Parse progress
      const progressNum = parseInt(job.progress) || 0;
      setProgress(progressNum);
      setStatusText(job.status);

      // Calculate ETA
      const elapsed = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : 0;
      setEstimatedRemaining(calculateETA(progressNum, elapsed));

      // Notify progress callback
      onProgress?.(progressNum, job.status, job);

      if (job.status === "completed") {
        stopPolling();
        setProgress(100);
        onComplete?.(job.result);
      } else if (job.status === "failed") {
        stopPolling();
        onError?.(job.error || "Job failed");
      } else if (job.status === "processing" || job.status === "pending") {
        // Continue polling
        pollingRef.current = setTimeout(() => poll(jobId), interval);
      }
    } catch (error) {
      console.error("Polling error:", error);
      // Retry on network errors
      if (!isCancelledRef.current) {
        pollingRef.current = setTimeout(() => poll(jobId), interval * 2);
      }
    }
  }, [apiBaseUrl, interval, calculateETA, onProgress, onComplete, onError, stopPolling]);

  // Start polling for a job
  const startPolling = useCallback((jobId: string) => {
    // Reset state
    isCancelledRef.current = false;
    setIsPolling(true);
    setProgress(10);
    setStatusText("pending");
    setElapsedTime(0);
    setEstimatedRemaining("Calculez...");
    startTimeRef.current = Date.now();

    // Start elapsed time counter
    elapsedIntervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    }, 1000);

    // Start polling
    poll(jobId);
  }, [poll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

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
