"use client";

import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

// Error boundary prevents the entire page from going white on unexpected render errors.
interface PipelineErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PipelineErrorBoundary extends Component<{ children: ReactNode }, PipelineErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PipelineErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PipelinePage] Unhandled render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-muted-foreground text-center max-w-md">
            The pipeline page encountered an unexpected error. Please refresh the page to try again.
          </p>
          <p className="text-xs text-muted-foreground font-mono">{this.state.error?.message}</p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
