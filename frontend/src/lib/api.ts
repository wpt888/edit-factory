/**
 * Simple API client for local development.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Make an API request.
 * Automatically injects X-Profile-Id header from localStorage if available.
 */
export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { headers: customHeaders, ...restOptions } = options;

  // Auto-inject profile ID from localStorage (SSR-safe)
  const profileId =
    typeof window !== "undefined"
      ? localStorage.getItem("editai_current_profile_id")
      : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(profileId && { "X-Profile-Id": profileId }),
    ...customHeaders, // Custom headers can override
  };

  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

  return fetch(url, {
    ...restOptions,
    headers,
  });
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

export { API_URL };
