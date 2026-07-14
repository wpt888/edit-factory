// Ambient types for the Electron preload bridge (electron/src/preload.js).
export {};

declare global {
  interface Window {
    editFactory?: {
      isDesktop: boolean;
      /** Open an HTTP(S) URL in the user's default browser. */
      openExternal: (url: string) => Promise<boolean>;
      /** Native multi-select video picker. [] = user cancelled. */
      selectVideoFiles: () => Promise<string[]>;
      listSystemFonts: () => Promise<
        Array<{
          family: string;
          fullName: string;
          postscriptName: string;
          style: string;
        }>
      >;
      /** Custom title bar controls (main window runs frameless). */
      window: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        /** Subscribe to maximize/restore changes; call the returned fn to unsubscribe. */
        onMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}
