"use client";

import { useState, useCallback, useEffect } from "react";
import {
  SubtitleSettings,
  DEFAULT_SUBTITLE_SETTINGS
} from "@/types/video-processing";
import { handleApiError } from "@/lib/api";

const STORAGE_KEY_PREFIX = "editai_subtitle_";

/**
 * Hook for managing subtitle settings with optional localStorage persistence
 * @param storageKey - Optional key suffix for localStorage (e.g., "home" -> "editai_subtitle_home")
 */
export function useSubtitleSettings(storageKey?: string) {
  const fullKey = storageKey ? `${STORAGE_KEY_PREFIX}${storageKey}` : null;

  // Two-phase initialization: always start with defaults to match SSR,
  // then hydrate from localStorage in useEffect to avoid hydration mismatches
  const [settings, setSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });

  // Hydrate from localStorage after mount
  useEffect(() => {
    if (!fullKey) return;

    try {
      const stored = localStorage.getItem(fullKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SUBTITLE_SETTINGS, ...parsed });
      }
    } catch (error) {
      handleApiError(error, "Eroare la setari");
    }
  }, [fullKey]);

  // Persist to localStorage when settings change
  useEffect(() => {
    if (typeof window === "undefined" || !fullKey) return;

    try {
      localStorage.setItem(fullKey, JSON.stringify(settings));
    } catch (error) {
      handleApiError(error, "Eroare la setari");
    }
  }, [settings, fullKey]);

  const updateSettings = useCallback((partial: Partial<SubtitleSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SUBTITLE_SETTINGS });
  }, []);

  // Individual setters for convenience
  const setFontSize = useCallback((fontSize: number) => {
    updateSettings({ fontSize: Math.max(12, Math.min(72, fontSize)) });
  }, [updateSettings]);

  const setFontFamily = useCallback((fontFamily: string) => {
    updateSettings({ fontFamily });
  }, [updateSettings]);

  const setTextColor = useCallback((textColor: string) => {
    updateSettings({ textColor });
  }, [updateSettings]);

  const setOutlineColor = useCallback((outlineColor: string) => {
    updateSettings({ outlineColor });
  }, [updateSettings]);

  const setOutlineWidth = useCallback((outlineWidth: number) => {
    updateSettings({ outlineWidth: Math.max(0, Math.min(10, outlineWidth)) });
  }, [updateSettings]);

  const setPositionY = useCallback((positionY: number) => {
    updateSettings({ positionY: Math.max(5, Math.min(95, positionY)) });
  }, [updateSettings]);

  return {
    settings,
    setSettings,
    updateSettings,
    resetSettings,
    // Individual setters
    setFontSize,
    setFontFamily,
    setTextColor,
    setOutlineColor,
    setOutlineWidth,
    setPositionY,
  };
}
