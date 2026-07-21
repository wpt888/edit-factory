/**
 * Simple API client for local development.
 * Automatically injects Supabase JWT token into every request.
 */

import { ApiError } from "./api-error";
import { createClient } from "@/lib/supabase/client";

export { ApiError, handleApiError } from "./api-error";

const DESKTOP_API_URL = "http://127.0.0.1:8000/api/v1";
const API_URL = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true"
  ? DESKTOP_API_URL
  : process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

/**
 * Keep the desktop frontend and loopback API on the same hostname.
 *
 * Browsers treat `localhost` and `127.0.0.1` as different sites. When the
 * developer opens Next on `localhost` but API/media URLs stay pinned to
 * `127.0.0.1`, Chromium withholds the HttpOnly source-media cookie from native
 * `<video>` / `<img>` requests and the preview turns black with a 401.
 */
export function getApiUrl() {
  if (
    process.env.NEXT_PUBLIC_DESKTOP_MODE === "true"
    && typeof window !== "undefined"
    && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ) {
    return `http://${window.location.hostname}:8000/api/v1`;
  }
  return API_URL;
}

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes — video uploads can be large

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
  timeout?: number;
  retry?: number;
  /** Reuse a successful GET response for the lifetime of this renderer. */
  memoryCache?: boolean;
}

// Pages are unmounted during App Router navigation, but the API client module
// remains alive in the Electron renderer. Cache read-only responses here rather
// than in each page so returning to any section can immediately reuse data
// already loaded for the current profile. Stale-while-revalidate: a cache hit
// is served instantly and refreshed in the background, so polling loops see
// updates one cycle late instead of never. Mutations clear the cache below.
const getResponseCache = new Map<string, Response>();
const revalidatingKeys = new Set<string>();
// ponytail: coarse cap, wholesale clear; LRU if any page ever holds >200 distinct GETs
const CACHE_MAX_ENTRIES = 200;

const VOLATILE_GET_PATH = /(?:\/(?:[^/?]*status|progress|health|logs|events)(?:[/?]|$)|\/segments\/source-videos(?:\/[^/?]+)?(?:\?|$))/i;

function activeProfileId() {
  return typeof window !== "undefined"
    ? localStorage.getItem("editai_current_profile_id") || "default"
    : "server";
}

function getCacheKey(endpoint: string) {
  const base = getApiUrl().replace(/\/+$/, "");
  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint}`;
  return `${activeProfileId()}::${url}`;
}

function canUseMemoryCache(endpoint: string, options: FetchOptions) {
  return options.memoryCache !== false
    && options.cache !== "no-store"
    // Cache-busted URLs (`?_t=Date.now()`) are unique per call: caching them
    // can never hit and would only grow the map (pipeline audio blobs).
    && !/[?&]_t=/.test(endpoint)
    && !VOLATILE_GET_PATH.test(endpoint);
}

function storeCachedResponse(cacheKey: string, response: Response) {
  if (getResponseCache.size >= CACHE_MAX_ENTRIES) getResponseCache.clear();
  getResponseCache.set(cacheKey, response);
}

/** Refresh a cached GET in the background; keeps the last good data on failure. */
function revalidateInBackground(
  endpoint: string,
  options: FetchOptions,
  cacheKey: string
) {
  if (revalidatingKeys.has(cacheKey)) return;
  revalidatingKeys.add(cacheKey);
  // Drop the caller's signal: the component may unmount (and abort) while the
  // background refresh is still useful for the next visit.
  const rest = { ...options };
  delete rest.signal;
  apiFetch(endpoint, { ...rest, method: "GET" })
    .then((response) => storeCachedResponse(cacheKey, response))
    .catch(() => {})
    .finally(() => revalidatingKeys.delete(cacheKey));
}

/** Clears session-only GET data after a write, preventing stale page restores. */
export function invalidateApiMemoryCache() {
  getResponseCache.clear();
}

/**
 * Make an API request.
 * Automatically injects X-Profile-Id header from localStorage if available.
 * Supports timeout (default 30s) and throws ApiError on non-2xx responses.
 */
export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { headers: customHeaders, skipAuth, timeout = DEFAULT_TIMEOUT_MS, retry: _retry, memoryCache: _memoryCache, signal: existingSignal, ...restOptions } = options;

  // Covers the few callers that use apiFetch directly instead of apiPost/
  // apiPatch/etc. A failed write may still clear the cache; that is safe and
  // ensures the next read is authoritative.
  if ((restOptions.method || "GET").toUpperCase() !== "GET") {
    invalidateApiMemoryCache();
  }

  // Auto-inject profile ID from localStorage (SSR-safe)
  const profileId =
    typeof window !== "undefined"
      ? localStorage.getItem("editai_current_profile_id")
      : null;

  // Auto-inject Supabase JWT token (unless skipAuth is set)
  let authHeader: Record<string, string> = {};
  if (!skipAuth && typeof window !== "undefined") {
    try {
      const supabase = createClient();
      // Race getSession against a 3-second timeout to prevent hanging requests
      // when Supabase is unreachable or token refresh stalls
      const sessionResult = await Promise.race([
        supabase.auth.getSession(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (sessionResult && "data" in sessionResult) {
        const { data } = sessionResult;
        if (data.session?.access_token) {
          authHeader = { Authorization: `Bearer ${data.session.access_token}` };
        }
      }
    } catch {
      // If session retrieval fails, proceed without auth header
    }
  }

  const headers: HeadersInit = {
    ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),
    ...(profileId && { "X-Profile-Id": profileId }),
    ...authHeader,
    ...customHeaders, // Custom headers can override
  };

  // Prevent double-slash when API_URL has trailing slash (Bug #154)
  const base = getApiUrl().replace(/\/+$/, "");
  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint}`;

  // Use caller-provided signal if given, otherwise create a manual timeout via AbortController
  // (manual approach has broader browser compatibility than AbortSignal.timeout)
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal;

  if (existingSignal) {
    signal = existingSignal;
  } else {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller!.abort(), timeout);
    signal = controller.signal;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers,
      signal,
      // Required for the desktop's HttpOnly source-media session cookie.
      // The frontend and backend use different localhost ports, so the fetch
      // is cross-origin even though both services are on the same machine.
      credentials: restOptions.credentials ?? "include",
    });
  } catch (err) {
    const fetchErr = err as Error;
    if (fetchErr.name === "AbortError") {
      if (existingSignal?.aborted) {
        throw new ApiError(0, "Request aborted", false);
      }
      throw new ApiError(0, "Request timed out", true);
    }
    if (fetchErr.name === "TimeoutError") {
      throw new ApiError(0, "Request timed out", true);
    }
    // Wrap network TypeError in ApiError for consistent error handling (Bug #109)
    if (fetchErr instanceof TypeError) {
      throw new ApiError(0, fetchErr.message || "Network error", true);
    }
    throw fetchErr;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let detail: unknown = "";
    try {
      const body = await response.clone().json();
      detail = body?.detail ?? body?.message ?? "";
    } catch {
      // If body is not JSON, leave detail empty
    }
    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : JSON.stringify(detail),
      false
    );
  }

  return response;
}

/**
 * Make a GET request.
 */
export async function apiGet(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const cacheable = canUseMemoryCache(endpoint, options);
  const cacheKey = cacheable ? getCacheKey(endpoint) : null;
  const cached = cacheKey ? getResponseCache.get(cacheKey) : undefined;
  if (cacheKey && cached) {
    revalidateInBackground(endpoint, options, cacheKey);
    return cached.clone();
  }

  const response = await apiFetch(endpoint, { ...options, method: "GET" });
  if (cacheKey) storeCachedResponse(cacheKey, response.clone());
  return response;
}

/**
 * Make a GET request with automatic retry on transient errors.
 * Retries up to 2 times with a 1-second delay between attempts.
 * Does NOT retry on 4xx client errors.
 */
export async function apiGetWithRetry(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const maxRetries = options.retry ?? 2;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiGet(endpoint, options);
    } catch (err) {
      lastError = err;

      // Do not retry on client errors (4xx)
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err;
      }

      // Do not retry on the last attempt
      if (attempt < maxRetries) {
        if (options.signal?.aborted) throw new ApiError(0, "Request aborted", false);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

/**
 * Make a POST request.
 */
export async function apiPost<T = unknown>(
  endpoint: string,
  body?: T,
  options: FetchOptions = {}
): Promise<Response> {
  invalidateApiMemoryCache();
  return apiFetch(endpoint, {
    ...options,
    method: "POST",
    // Use !== checks to allow falsy values like 0, "", false (Bug #108)
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a PATCH request.
 */
export async function apiPatch<T = unknown>(
  endpoint: string,
  body?: T,
  options: FetchOptions = {}
): Promise<Response> {
  invalidateApiMemoryCache();
  return apiFetch(endpoint, {
    ...options,
    method: "PATCH",
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a PUT request.
 */
export async function apiPut<T = unknown>(
  endpoint: string,
  body?: T,
  options: FetchOptions = {}
): Promise<Response> {
  invalidateApiMemoryCache();
  return apiFetch(endpoint, {
    ...options,
    method: "PUT",
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a DELETE request.
 */
export async function apiDelete(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  invalidateApiMemoryCache();
  return apiFetch(endpoint, { ...options, method: "DELETE" });
}

/**
 * Upload FormData (sets correct multipart headers automatically).
 */
export async function apiUpload(
  endpoint: string,
  formData: FormData,
  options: FetchOptions = {}
): Promise<Response> {
  invalidateApiMemoryCache();
  return apiFetch(endpoint, {
    ...options,
    method: "POST",
    body: formData,
  });
}

export { API_URL };
