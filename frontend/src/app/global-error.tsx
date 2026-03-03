"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Global error caught:", error);
  }, [error]);

  return (
    <html lang="ro" className="dark">
      <body className="bg-background text-foreground min-h-screen flex items-center justify-center p-4">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/30">
              <svg
                className="w-8 h-8 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.268 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold">
              Something went wrong
            </h1>
            <p className="text-muted-foreground text-sm">
              An unexpected error occurred. You can try the action again or return home.
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
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="px-6 py-2.5 border border-border text-muted-foreground font-medium rounded-lg hover:bg-muted hover:text-foreground transition-colors inline-block"
            >
              Back home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
