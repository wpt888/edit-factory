// Ambient types for the Electron preload bridge (electron/src/preload.js).
export {};

declare global {
  interface Window {
    editFactory?: {
      isDesktop: boolean;
      /** Native multi-select video picker. [] = user cancelled. */
      selectVideoFiles: () => Promise<string[]>;
    };
  }
}
