import { toast } from "sonner";

export const BLIPOST_BILLING_URL = "https://blipost.com/billing";

/**
 * Structured API error with HTTP status, detail message, and timeout flag.
 */
export class ApiError extends Error {
  status: number;
  detail: string;
  isTimeout: boolean;

  constructor(status: number, detail: string, isTimeout = false) {
    super(detail || `HTTP error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.isTimeout = isTimeout;
  }
}

function stringifyApiDetail(detail: unknown): string {
  if (typeof detail === "string") {
    const trimmed = detail.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return stringifyApiDetail(JSON.parse(trimmed));
      } catch {
        // The backend detail is not JSON after all; show it as plain text.
      }
    }
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const loc = Array.isArray(record.loc) ? record.loc.join(".") : "";
          const msg = typeof record.msg === "string" ? record.msg : JSON.stringify(item);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join(" | ");
  }
  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.msg === "string") return record.msg;
    return JSON.stringify(detail);
  }
  return detail == null ? "" : String(detail);
}

/**
 * Centralized API error handler — converts any error type into a sonner toast.
 *
 * @param error - The caught error (unknown type)
 * @param context - Optional fallback message if no specific error message is available
 */
export function handleApiError(error: unknown, context?: string): void {
  if (error instanceof ApiError) {
    if (error.status === 402) {
      toast.error(
        stringifyApiDetail(error.detail)
          || "You do not have enough Blipost credits for this operation.",
        {
          description: "The operation was not started. Add credits to continue.",
          duration: 12_000,
          action: {
            label: "Manage credits",
            onClick: () => window.open(BLIPOST_BILLING_URL, "_blank", "noopener,noreferrer"),
          },
        },
      );
      return;
    }
    if (error.status === 429) {
      toast.error("Too many requests. Try again later.");
      return;
    }
    if (error.status === 413) {
      toast.error("File is too large.");
      return;
    }
    if (error.status === 409) {
      toast.error("Operation in progress. Wait for completion.");
      return;
    }
    if (error.isTimeout) {
      toast.error("Request timed out. Try again.");
      return;
    }
    if (error.status === 0) {
      toast.error("Network error. Check your connection.");
      return;
    }
    if (error.status >= 500) {
      toast.error("Server error. Try again later.");
      return;
    }
    if (error.detail) {
      toast.error(stringifyApiDetail(error.detail));
      return;
    }
  }

  toast.error(context || "An unexpected error occurred.");
}
