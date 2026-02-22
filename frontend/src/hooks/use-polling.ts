"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";

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

  const clearPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const stopPolling = useCallback(() => {
    isCancelledRef.current = true;
    clearPolling();
    setIsPolling(false);
  }, [clearPolling]);

  const startPolling = useCallback(() => {
    if (isCancelledRef.current) {
      isCancelledRef.current = false;
    }
    clearPolling();
    currentIntervalRef.current = interval;
    setIsPolling(true);
    setError(null);

    const poll = async () => {
      if (isCancelledRef.current) return;

      try {
        const response = await apiFetch(endpoint);
        const result: T = await response.json();
        setData(result);
        setError(null);
        // Reset interval on success
        currentIntervalRef.current = interval;
        onData?.(result);

        if (shouldStop?.(result)) {
          stopPolling();
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        onError?.(error);
        // Double interval on error (exponential backoff, max 30s)
        currentIntervalRef.current = Math.min(currentIntervalRef.current * 2, 30000);
        clearPolling();
        if (!isCancelledRef.current) {
          intervalRef.current = setInterval(poll, currentIntervalRef.current);
        }
        return;
      }

      if (!isCancelledRef.current && intervalRef.current !== null) {
        // Still running — interval handles the next call
      }
    };

    // Run immediately, then on interval
    poll();
    intervalRef.current = setInterval(poll, currentIntervalRef.current);
  }, [endpoint, interval, onData, onError, shouldStop, stopPolling, clearPolling]);

  // Auto-start when enabled becomes true or endpoint changes
  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, endpoint]);

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
