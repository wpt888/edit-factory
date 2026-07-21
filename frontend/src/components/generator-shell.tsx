"use client";

import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";

interface GeneratorShellProps {
  title: ReactNode;
  description: ReactNode;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  progress?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Shared document shell for AI generators. Image and video generation use the
 * same width, header rhythm, progress position, and surface hierarchy.
 */
export function GeneratorShell({
  title,
  description,
  icon,
  eyebrow,
  actions,
  progress,
  children,
  className,
}: GeneratorShellProps) {
  return (
    <main
      data-slot="generator-shell"
      className={cn("mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8", className)}
    >
      {eyebrow && (
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          {eyebrow}
        </div>
      )}
      <PageHeader icon={icon} title={title} description={description} actions={actions} />
      {progress}
      {children}
    </main>
  );
}
