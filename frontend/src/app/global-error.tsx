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
      <body className="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
        <div className="max-w-lg w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-red-900/30 flex items-center justify-center border border-red-800">
              <svg
                className="w-8 h-8 text-red-400"
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
            <h1 className="text-2xl font-bold text-white">
              Ceva nu a mers bine
            </h1>
            <p className="text-gray-400 text-sm">
              A aparut o eroare neasteptata. Poti incerca sa reiei actiunea sau sa te intorci acasa.
            </p>
          </div>

          {error.message && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-left">
              <p className="text-xs text-gray-500 mb-1 uppercase tracking-wide">Detalii eroare</p>
              <code className="text-red-400 text-sm break-all">{error.message}</code>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={reset}
              className="px-6 py-2.5 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-100 transition-colors"
            >
              Incearca din nou
            </button>
            <a
              href="/"
              className="px-6 py-2.5 border border-gray-600 text-gray-300 font-medium rounded-lg hover:bg-gray-800 hover:text-white transition-colors inline-block"
            >
              Inapoi acasa
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
