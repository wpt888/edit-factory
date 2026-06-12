// electron/src/preload.js
// Bridges native desktop capabilities into the renderer (http://localhost:3000).
// Runs with contextIsolation: true; only the explicit API below is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editFactory', {
  isDesktop: true,
  // Native multi-select video picker. Resolves to string[] of absolute
  // paths; [] when the user cancels.
  selectVideoFiles: () => ipcRenderer.invoke('dialog:select-videos'),
});
