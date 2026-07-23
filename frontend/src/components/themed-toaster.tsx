"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/components/theme-provider";

/** Sonner toaster that follows the app theme (layout.tsx can't — it's a server component). */
export function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" closeButton theme={theme} />;
}
