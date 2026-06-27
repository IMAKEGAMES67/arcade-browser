const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcadeDesktop', {
  isDesktop: true,
  openInApp: (url) => ipcRenderer.invoke('open-in-app', url),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates')
});
