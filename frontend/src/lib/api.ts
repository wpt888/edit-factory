/**
 * API client with authentication support.
 * Automatically adds Authorization header from Supabase session.
 */

import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

/**
 * Get the current session's access token.
 */
async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Make an authenticated API request.
 *
 * @param endpoint - API endpoint (e.g., "/library/projects")
 * @param options - Fetch options (method, body, etc.)
 * @returns Response from the API
 */
export async function apiFetch(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { skipAuth = false, headers: customHeaders, ...restOptions } = options;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...customHeaders,
  };

  // Add auth header if not skipped
  if (!skipAuth) {
    const token = await getAccessToken();
    if (token) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
    }
  }

  const url = endpoint.startsWith("http") ? endpoint : `${API_URL}${endpoint}`;

  return fetch(url, {
    ...restOptions,
    headers,
  });
}

/**
 * Make an authenticated GET request.
 */
export async function apiGet(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  return apiFetch(endpoint, { ...options, method: "GET" });
}

/**
 * Make an authenticated POST request.
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
 * Make an authenticated PATCH request.
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
 * Make an authenticated PUT request.
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
 * Make an authenticated DELETE request.
 */
export async function apiDelete(
  endpoint: string,
  options: FetchOptions = {}
): Promise<Response> {
  return apiFetch(endpoint, { ...options, method: "DELETE" });
}

export { API_URL };
