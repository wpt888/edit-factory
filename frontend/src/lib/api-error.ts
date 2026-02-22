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
      toast.error("Prea multe cereri. Incearca mai tarziu.");
      return;
    }
    if (error.status === 413) {
      toast.error("Fisierul este prea mare.");
      return;
    }
    if (error.status === 409) {
      toast.error("Operatiune in curs. Asteapta finalizarea.");
      return;
    }
    if (error.isTimeout) {
      toast.error("Cererea a expirat. Incearca din nou.");
      return;
    }
    if (error.status >= 500) {
      toast.error("Eroare de server. Incearca mai tarziu.");
      return;
    }
    if (error.detail) {
      toast.error(error.detail);
      return;
    }
  }

  toast.error(context || "A aparut o eroare neasteptata.");
}
