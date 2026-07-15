/** Desktop-shell helpers — feature-detect the Electron preload bridge. */

/**
 * Pick local video files.
 *
 * Returns: string[] of absolute paths ([] = user cancelled),
 *          or null = no desktop picker available (offer manual path entry).
 */
export async function pickLocalVideoFiles(): Promise<string[] | null> {
  // Electron native dialog (desktop shell with preload bridge).
  if (typeof window !== "undefined" && window.editFactory?.selectVideoFiles) {
    try {
      return await window.editFactory.selectVideoFiles();
    } catch {
      return null;
    }
  }
  // Legacy desktop shells can still use manual path entry. Web clients never
  // ask the server to open a native picker on the server machine.
  return null;
}
