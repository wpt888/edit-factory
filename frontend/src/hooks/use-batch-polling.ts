"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface ProductJobStatus {
  product_id: string;
  job_id: string;
  title: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface BatchStatus {
  batch_id: string;
  status: "processing" | "completed";
  total: number;
  completed: number;
  failed: number;
  product_jobs: ProductJobStatus[];
}

interface UseBatchPollingOptions {
  /** Base API URL (e.g., "http://localhost:8000/api/v1") */
  apiBaseUrl: string;
  /** Polling interval in milliseconds (default: 2000) */
  interval?: number;
  /** Called when the entire batch finishes */
  onBatchComplete?: (batchStatus: BatchStatus) => void;
}

interface UseBatchPollingReturn {
  /** Start polling for a specific batch */
  startPolling: (batchId: string) => void;
  /** Stop polling */
  stopPolling: () => void;
  /** Whether polling is currently active */
  isPolling: boolean;
  /** Full batch status response */
  batchStatus: BatchStatus | null;
  /** Per-product job statuses */
  productJobs: ProductJobStatus[];
  /** Number of completed products */
  completedCount: number;
  /** Number of failed products */
  failedCount: number;
  /** Total number of products in batch */
  totalCount: number;
}

/**
 * Hook for polling batch generation status with per-product state
 */
export function useBatchPolling(options: UseBatchPollingOptions): UseBatchPollingReturn {
  const { apiBaseUrl, interval = 2000, onBatchComplete } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledRef = useRef(false);
  const currentBatchIdRef = useRef<string | null>(null);

  // Stop polling and cleanup
  const stopPolling = useCallback(() => {
    isCancelledRef.current = true;
    setIsPolling(false);

    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Main polling function
  const poll = useCallback(
    async (batchId: string) => {
      if (isCancelledRef.current) return;

      try {
        const response = await fetch(
          `${apiBaseUrl}/products/batch/${batchId}/status`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const status: BatchStatus = await response.json();
        setBatchStatus(status);

        if (status.status === "completed") {
          // All products finished (completed or failed)
          stopPolling();
          onBatchComplete?.(status);
        } else {
          // Still processing — schedule next poll
          pollingRef.current = setTimeout(() => poll(batchId), interval);
        }
      } catch (error) {
        console.error("Batch polling error:", error);
        // Retry on network errors with doubled interval
        if (!isCancelledRef.current) {
          pollingRef.current = setTimeout(() => poll(batchId), interval * 2);
        }
      }
    },
    [apiBaseUrl, interval, onBatchComplete, stopPolling]
  );

  // Start polling for a batch
  const startPolling = useCallback(
    (batchId: string) => {
      // If already polling a different batch, stop first
      if (currentBatchIdRef.current && currentBatchIdRef.current !== batchId) {
        stopPolling();
      }

      currentBatchIdRef.current = batchId;
      isCancelledRef.current = false;
      setIsPolling(true);
      setBatchStatus(null);

      // Start immediately
      poll(batchId);
    },
    [poll, stopPolling]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Derived values
  const productJobs = batchStatus?.product_jobs ?? [];
  const completedCount = batchStatus?.completed ?? 0;
  const failedCount = batchStatus?.failed ?? 0;
  const totalCount = batchStatus?.total ?? 0;

  return {
    startPolling,
    stopPolling,
    isPolling,
    batchStatus,
    productJobs,
    completedCount,
    failedCount,
    totalCount,
  };
}
