/**
 * Simple API client for local development.
 */

import { ApiError } from "./api-error";

export { ApiError, handleApiError } from "./api-error";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

const DEFAULT_TIMEOUT_MS = 30000;

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
  timeout?: number;
  retry?: number;
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
  const { headers: customHeaders, timeout = DEFAULT_TIMEOUT_MS, retry: _retry, signal: existingSignal, ...restOptions } = options;

  // Auto-inject profile ID from localStorage (SSR-safe)
  const profileId =
    typeof window !== "undefined"
      ? localStorage.getItem("editai_current_profile_id")
      : null;

  const headers: HeadersInit = {
    ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),
    ...(profileId && { "X-Profile-Id": profileId }),
    ...customHeaders, // Custom headers can override
  };

  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

  // Use caller-provided signal if given, otherwise create a timeout signal
  const signal = existingSignal ?? AbortSignal.timeout(timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      ...restOptions,
      headers,
      signal,
    });
  } catch (err) {
    const fetchErr = err as Error;
    if (fetchErr.name === "TimeoutError" || fetchErr.name === "AbortError") {
      throw new ApiError(0, "Request timed out", true);
    }
    throw fetchErr;
  }

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = body?.detail ?? body?.message ?? "";
    } catch {
      // If body is not JSON, leave detail empty
    }
    throw new ApiError(response.status, detail, false);
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
  return apiFetch(endpoint, { ...options, method: "GET" });
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
  return apiFetch(endpoint, {
    ...options,
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
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
  return apiFetch(endpoint, {
    ...options,
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
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
  return apiFetch(endpoint, {
    ...options,
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make a DELETE request.
 */
export async function apiDelete(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
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
  return apiFetch(endpoint, {
    ...options,
    method: "POST",
    body: formData,
  });
}

export { API_URL };
