"use client";

// NOTE: For job-specific polling, prefer useJobPolling which uses SSE.
// This hook is for generic endpoints (e.g., assembly status, product status)
// that do not yet have SSE streaming counterparts.

import { useState, useRef, useCallback, useEffect } from "react";
import { apiGet } from "@/lib/api";

export interface UsePollingOptions<T> {
  /** API endpoint to poll (relative path, e.g., "/assembly/status/123") */
  endpoint: string;
  /** Polling interval in milliseconds (default: 3000) */
  interval?: number;
  /** Whether polling should start automatically (default: false) */
  enabled?: boolean;
  /** Called on each successful data response */
  onData?: (data: T) => void;
  /** Called on fetch error */
  onError?: (error: Error) => void;
  /** Return true to stop polling after a successful response */
  shouldStop?: (data: T) => boolean;
}

export interface UsePollingReturn<T> {
  /** Latest data received from the endpoint */
  data: T | null;
  /** Whether polling is currently active */
  isPolling: boolean;
  /** Latest error (if any) */
  error: Error | null;
  /** Start polling */
  startPolling: () => void;
  /** Stop polling */
  stopPolling: () => void;
}

/**
 * Generic polling hook for any endpoint.
 *
 * Designed as a primitive to replace inline setInterval patterns.
 * For job-status polling (with ETA, progress bars), use useJobPolling instead.
 */
export function usePolling<T>(options: UsePollingOptions<T>): UsePollingReturn<T> {
  const {
    endpoint,
    interval = 3000,
    enabled = false,
    onData,
    onError,
    shouldStop,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCancelledRef = useRef(false);
  const currentIntervalRef = useRef(interval);

  // Refs for callbacks to avoid stale closures in the poll loop
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const shouldStopRef = useRef(shouldStop);
  shouldStopRef.current = shouldStop;

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    isCancelledRef.current = true;
    clearPolling();
    setIsPolling(false);
  }, [clearPolling]);

  const startPolling = useCallback(() => {
    // Always reset cancelled flag unconditionally so polling can restart
    // even if stopPolling was called before (FE-03)
    isCancelledRef.current = false;
    clearPolling();
    currentIntervalRef.current = interval;
    setIsPolling(true);
    setError(null);

    const poll = async () => {
      if (isCancelledRef.current) return;

      try {
        const response = await apiGet(endpoint);
        if (isCancelledRef.current) return;
        const result: T = await response.json();
        setData(result);
        setError(null);
        // Reset interval on success
        currentIntervalRef.current = interval;
        onDataRef.current?.(result);

        if (shouldStopRef.current?.(result)) {
          stopPolling();
          return;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onErrorRef.current?.(error);
        // Double interval on error (exponential backoff, max 30s)
        currentIntervalRef.current = Math.min(currentIntervalRef.current * 2, 30000);
      }

      // Schedule next poll after current one completes (avoids double-poll)
      if (!isCancelledRef.current) {
        intervalRef.current = setTimeout(poll, currentIntervalRef.current) as unknown as NodeJS.Timeout;
      }
    };

    // Run immediately, then schedule next after completion
    poll();
  }, [endpoint, interval, stopPolling, clearPolling]);

  // Auto-start when enabled becomes true or endpoint changes
  // startPolling internally calls clearPolling, so old polls are cleaned up (Bug #114)
  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }
    return () => {
      isCancelledRef.current = true;
      clearPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, endpoint, interval]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isCancelledRef.current = true;
      clearPolling();
    };
  }, [clearPolling]);

  return {
    data,
    isPolling,
    error,
    startPolling,
    stopPolling,
  };
}
