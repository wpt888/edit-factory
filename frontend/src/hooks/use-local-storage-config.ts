"use client";

import { useState, useEffect, useCallback } from "react";


/**
 * Hook for persisting state to localStorage with type safety
 * @param key - The localStorage key
 * @param defaultValue - Default value if nothing in storage
 * @returns [value, setValue] tuple
 */
export function useLocalStorageConfig<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Lazy initialization: read from localStorage on first render to avoid
  // hydration mismatches and set-state-in-effect lint errors
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;
    try {
      const stored = localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : defaultValue;
    } catch { return defaultValue; }
  });
  const [hydrated] = useState(() => typeof window !== "undefined");

  // Sync to localStorage when value changes (only after hydration to avoid
  // overwriting stored values with defaults on first render)
  useEffect(() => {
    if (!hydrated) return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Show specific message for storage quota errors (Bug #115)
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.warn("localStorage quota exceeded for key:", key);
      } else {
        console.warn("Failed to persist setting to localStorage:", error);
      }
    }
  }, [key, value, hydrated]);

  // Wrapped setValue that handles function updates
  const setStoredValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === "function"
        ? (newValue as (prev: T) => T)(prev)
        : newValue;
      return resolved;
    });
  }, []);

  return [value, setStoredValue];
}

/**
 * Hook for loading/saving a complete config object
 * @param key - The localStorage key
 * @param defaultConfig - Default config object
 */
export function useConfigPersistence<T extends Record<string, unknown>>(
  key: string,
  defaultConfig: T
) {
  const [config, setConfig] = useLocalStorageConfig<T>(key, defaultConfig);

  const updateConfig = useCallback((partial: Partial<T>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, [setConfig]);

  const resetConfig = useCallback(() => {
    setConfig(defaultConfig);
  }, [setConfig, defaultConfig]);

  return { config, setConfig, updateConfig, resetConfig };
}
