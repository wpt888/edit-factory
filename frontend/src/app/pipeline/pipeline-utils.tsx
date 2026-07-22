"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function useDebouncedInput(
  value: string,
  onCommit: (nextValue: string) => void,
  delay = 300
) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedRef = useRef(value);

  // Parent value changes intentionally reset the editable draft.
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      setDraft(value);
      lastCommittedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flushDraft = useCallback((nextValue: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (nextValue === lastCommittedRef.current) return;
    lastCommittedRef.current = nextValue;
    onCommit(nextValue);
  }, [onCommit]);

  const updateDraft = useCallback((nextValue: string) => {
    setDraft(nextValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushDraft(nextValue);
    }, delay);
  }, [delay, flushDraft]);

  return { draft, updateDraft, flushDraft };
}

interface DebouncedInputProps extends Omit<ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string;
  onCommit: (nextValue: string) => void;
  debounceMs?: number;
}

export const DebouncedInput = memo(function DebouncedInput({
  value,
  onCommit,
  debounceMs = 300,
  onBlur,
  ...props
}: DebouncedInputProps) {
  const { draft, updateDraft, flushDraft } = useDebouncedInput(value, onCommit, debounceMs);

  return (
    <Input
      {...props}
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onBlur={(e) => {
        flushDraft(e.target.value);
        onBlur?.(e);
      }}
    />
  );
});

interface DebouncedTextareaProps extends Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> {
  value: string;
  onCommit: (nextValue: string) => void;
  debounceMs?: number;
}

export const DebouncedTextarea = memo(function DebouncedTextarea({
  value,
  onCommit,
  debounceMs = 300,
  onBlur,
  ...props
}: DebouncedTextareaProps) {
  const { draft, updateDraft, flushDraft } = useDebouncedInput(value, onCommit, debounceMs);

  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(e) => updateDraft(e.target.value)}
      onBlur={(e) => {
        flushDraft(e.target.value);
        onBlur?.(e);
      }}
    />
  );
});

// ── Pure helpers (hoisted so ScriptCard + PipelinePage can share them) ──

export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export const countWords = (text: string): number => {
  const cleaned = text.replace(/\[([^\[\]]+)\]/g, "");
  return cleaned.trim().split(/\s+/).filter(Boolean).length;
};

/** Average TTS speech rate in words per second (ElevenLabs default) */
export const WORDS_PER_SECOND = 2.3;

export const analyzeGroupTags = (text: string): Array<{ label: string; isPaired: boolean; isOpen: boolean; occurrences: number }> => {
  const matches = text.match(/\[([^\[\]]+)\]/g);
  if (!matches) return [];
  const counts: Record<string, number> = {};
  for (const m of matches) {
    const label = m.slice(1, -1);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts).map(([label, occurrences]) => ({
    label,
    occurrences,
    isPaired: occurrences % 2 === 0,
    isOpen: occurrences % 2 === 1,
  }));
};
