"use client";

import { useState, useEffect, useCallback } from "react";
import { handleApiError } from "@/lib/api";

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
  // Two-phase initialization: always start with defaultValue to match SSR,
  // then hydrate from localStorage in useEffect to avoid hydration mismatches
  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        setValue(JSON.parse(stored) as T);
      }
    } catch (error) {
      handleApiError(error, "Eroare la setari");
    }
    setHydrated(true);
  }, [key]);

  // Sync to localStorage when value changes (only after hydration to avoid
  // overwriting stored values with defaults on first render)
  useEffect(() => {
    if (!hydrated) return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      handleApiError(error, "Eroare la setari");
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
