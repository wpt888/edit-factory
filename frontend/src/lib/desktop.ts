/**
 * Desktop-shell helpers — feature-detect the Electron preload bridge.
 */
import { apiGetWithRetry } from "@/lib/api";

const DESKTOP_MODE = process.env.NEXT_PUBLIC_DESKTOP_MODE === "true";

/**
 * Pick local video files.
 *
 * Returns: string[] of absolute paths ([] = user cancelled),
 *          or null = no picker available (caller should offer manual path entry).
 */
export async function pickLocalVideoFiles(): Promise<string[] | null> {
  // 1. Electron native dialog (desktop shell with preload bridge)
  if (typeof window !== "undefined" && window.editFactory?.selectVideoFiles) {
    try {
      return await window.editFactory.selectVideoFiles();
    } catch {
      return null;
    }
  }
  // 2. Desktop build without the bridge (old shell) — NEVER call browse-local:
  //    tkinter in a worker thread aborts the packaged backend (0xC0000409).
  if (DESKTOP_MODE) return null;
  // 3. Web/dev mode — server-side picker still available
  try {
    const res = await apiGetWithRetry("/segments/browse-local", { retry: 0 });
    if (!res.ok) return null;
    const data = await res.json();
    return data.file_paths || (data.file_path ? [data.file_path] : []);
  } catch {
    return null;
  }
}
