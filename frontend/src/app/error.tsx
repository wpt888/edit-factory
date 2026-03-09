"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("Route error caught:", error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold">Something went wrong</h2>
          <p className="text-muted-foreground text-sm">
            An error occurred while loading this page.
          </p>
        </div>

        {error.message && (
          <div className="bg-muted border border-border rounded-lg p-4 text-left">
            <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Error details</p>
            <code className="text-destructive text-sm break-all">{error.message}</code>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-2.5 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-6 py-2.5 border border-border text-muted-foreground font-medium rounded-lg hover:bg-muted hover:text-foreground transition-colors inline-block"
          >
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}
