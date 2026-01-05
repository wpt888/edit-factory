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
  // Initialize state with value from localStorage or default
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return defaultValue;

    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
    }
    return defaultValue;
  });

  // Sync to localStorage when value changes
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`Error writing localStorage key "${key}":`, error);
    }
  }, [key, value]);

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
