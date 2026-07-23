"use client";

import { Sparkles } from "lucide-react";

import {
  attentionAnimationLabel,
  type AttentionAnimationPreset,
} from "@/types/attention-timeline";

export function AttentionEntranceOverlay({
  preset,
  enterMs,
  clipDurationMs,
  offsetMs = 0,
  testId,
}: {
  preset: AttentionAnimationPreset;
  enterMs: number;
  clipDurationMs: number;
  offsetMs?: number;
  testId?: string;
}) {
  if (preset === "static" || enterMs <= 0 || clipDurationMs <= 0) return null;

  const safeOffsetMs = Math.max(0, Math.min(offsetMs, clipDurationMs));
  const remainingMs = clipDurationMs - safeOffsetMs;
  if (remainingMs <= 0) return null;
  const safeEnterMs = Math.max(1, Math.min(enterMs, remainingMs));
  const left = `${safeOffsetMs / clipDurationMs * 100}%`;
  const width = `${safeEnterMs / clipDurationMs * 100}%`;
  const label = attentionAnimationLabel(preset);

  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className="pointer-events-none absolute inset-y-0 z-10 flex min-w-2 items-center justify-center overflow-hidden border-r border-amber-200/80 bg-amber-300/70 text-black"
      style={{ left, width }}
      title={`Entrance: ${label} · ${safeEnterMs}ms`}
    >
      <Sparkles className="size-2.5 shrink-0" />
      <span className="ml-0.5 truncate text-[8px] font-semibold">{label}</span>
    </span>
  );
}
