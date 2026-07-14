// electron/src/preload.js
// Bridges native desktop capabilities into the renderer (http://localhost:3000).
// Runs with contextIsolation: true; only the explicit API below is exposed.
const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("error", (event) => {
  ipcRenderer.send("renderer:error", {
    type: "error",
    message: event.message || String(event.error || "Unknown renderer error"),
    stack: event.error?.stack || "",
    source: event.filename || "",
    line: event.lineno || 0,
    column: event.colno || 0,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  ipcRenderer.send("renderer:error", {
    type: "unhandledrejection",
    message: reason?.message || String(reason || "Unknown rejected promise"),
    stack: reason?.stack || "",
    source: "",
    line: 0,
    column: 0,
  });
});

contextBridge.exposeInMainWorld("editFactory", {
  isDesktop: true,
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  // Native multi-select video picker. Resolves to string[] of absolute
  // paths; [] when the user cancels.
  selectVideoFiles: () => ipcRenderer.invoke("dialog:select-videos"),
  // Browser-standard Local Font Access. The first call may show Chromium's
  // permission prompt; keep the full metadata so family names remain exact.
  listSystemFonts: async () => {
    if (typeof globalThis.queryLocalFonts !== "function") return [];
    const fonts = await globalThis.queryLocalFonts();
    return fonts.map(({ family, fullName, postscriptName, style }) => ({
      family,
      fullName,
      postscriptName,
      style,
    }));
  },
  // Custom title bar controls (main window is frameless — see main.js createWindow)
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizeChange: (cb) => {
      const handler = (_event, isMaximized) => cb(isMaximized);
      ipcRenderer.on("window:maximize-changed", handler);
      return () =>
        ipcRenderer.removeListener("window:maximize-changed", handler);
    },
  },
});
