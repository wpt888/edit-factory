"use client";

import { useSyncExternalStore } from "react";
import { API_URL, getApiUrl } from "@/lib/api";

const subscribeToApiHost = () => () => undefined;

/**
 * Resolve the loopback API after hydration so native media requests use the
 * same hostname as the page and receive the desktop media-session cookie.
 */
export function useApiUrl() {
  return useSyncExternalStore(subscribeToApiHost, getApiUrl, () => API_URL);
}
