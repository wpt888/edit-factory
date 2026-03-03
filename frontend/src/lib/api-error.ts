import { toast } from "sonner";

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

/**
 * Centralized API error handler — converts any error type into a sonner toast.
 *
 * @param error - The caught error (unknown type)
 * @param context - Optional fallback message if no specific error message is available
 */
export function handleApiError(error: unknown, context?: string): void {
  if (error instanceof ApiError) {
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
    if (error.status >= 500) {
      toast.error("Server error. Try again later.");
      return;
    }
    if (error.detail) {
      toast.error(error.detail);
      return;
    }
  }

  toast.error(context || "An unexpected error occurred.");
}
