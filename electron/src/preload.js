// electron/src/preload.js
// Bridges native desktop capabilities into the renderer (http://localhost:3000).
// Runs with contextIsolation: true; only the explicit API below is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editFactory', {
  isDesktop: true,
  // Native multi-select video picker. Resolves to string[] of absolute
  // paths; [] when the user cancels.
  selectVideoFiles: () => ipcRenderer.invoke('dialog:select-videos'),
  // Custom title bar controls (main window is frameless — see main.js createWindow)
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb) => {
      const handler = (_event, isMaximized) => cb(isMaximized);
      ipcRenderer.on('window:maximize-changed', handler);
      return () => ipcRenderer.removeListener('window:maximize-changed', handler);
    },
  },
});
