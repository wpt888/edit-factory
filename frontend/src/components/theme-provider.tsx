"use client";

import * as React from "react";

type Theme = "dark" | "light";

// Also read by the pre-hydration script in layout.tsx — keep the two in sync.
const STORAGE_KEY = "blipost-theme";

const ThemeContext = React.createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({ theme: "dark", setTheme: () => {} });

export function useTheme() {
  return React.useContext(ThemeContext);
}

/**
 * Minimal theme manager (no next-themes): dark is the product default, the
 * choice persists in localStorage, and a tiny inline script in layout.tsx
 * applies the stored theme before first paint so there is no flash.
 *
 * TODO(user): resolveInitialTheme() currently ignores the OS preference
 * (prefers-color-scheme). Decide whether a first-run user should get the
 * brand default (dark) or their system theme — see conversation notes.
 */
function resolveInitialTheme(): Theme {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server render assumes dark (the <html> class default); the effect below
  // reconciles with the stored preference right after mount.
  const [theme, setThemeState] = React.useState<Theme>("dark");

  React.useEffect(() => {
    setThemeState(resolveInitialTheme());
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
